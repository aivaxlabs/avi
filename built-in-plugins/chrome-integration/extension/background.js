importScripts("runtime.js");

const protocolVersion = 3;
const bindingName = "__aviBrowserHost";
const worldName = "__avi_browser__";
const frameGuardKey = "__aviForeignFrameGuard";
const supportedUrl = /^(?:https?:|file:|about:blank$)/i;
const isMac = /Mac/i.test(navigator.userAgent);
const attachedTabs = new Set();
const attaching = new Map();
const tabState = new Map();
let instanceId;
const initialized = initialize();

chrome.runtime.onInstalled.addListener(() => initialized.then(ensureOffscreen));
chrome.runtime.onStartup.addListener(() => initialized.then(ensureOffscreen));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "chrome-mcp-heartbeat") ensureOffscreen();
});
chrome.tabs.onCreated.addListener(tab => {
  if (tab.openerTabId) tabState.get(tab.openerTabId)?.openedTabs?.push(tab.id);
  publishTabs();
});
chrome.tabs.onRemoved.addListener(tabId => {
  attachedTabs.delete(tabId);
  tabState.delete(tabId);
  publishTabs();
});
chrome.tabs.onActivated.addListener(() => publishTabs());
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url || change.title || change.status) publishTabs();
});
chrome.debugger.onEvent.addListener(handleDebuggerEvent);
chrome.webNavigation.onCommitted.addListener(details => {
  if (attachedTabs.has(details.tabId)) injectFrameGuard({ tabId: details.tabId, frameIds: [details.frameId] }, blockForeignFrames);
});
chrome.debugger.onDetach.addListener(source => {
  attachedTabs.delete(source.tabId);
  injectFrameGuard({ tabId: source.tabId, allFrames: true }, releaseForeignFrames);
  const state = tabState.get(source.tabId);
  if (state) {
    state.sessions.clear();
    state.worlds.clear();
    state.mainWorlds.clear();
    state.inflight.clear();
    state.modifiers = 0;
    state.pendingDialog = null;
  }
  publishTabs();
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.source === "offscreen") handleOffscreenMessage(message).catch(() => {});
});

async function initialize() {
  const stored = await chrome.storage.local.get("instanceId");
  instanceId = stored.instanceId || crypto.randomUUID();
  await chrome.storage.local.set({ instanceId });
  chrome.alarms.create("chrome-mcp-heartbeat", { periodInMinutes: 0.5 });
  await ensureOffscreen();
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS", "CLIPBOARD"],
    justification: "Maintain the localhost WebSocket connection to Avi and access the clipboard on request."
  }).catch(error => {
    if (!String(error.message).includes("Only a single offscreen")) throw error;
  });
}

async function handleOffscreenMessage(message) {
  if (message.type === "connected") {
    await initialized;
    send({ type: "hello", protocol: protocolVersion, instanceId, tabs: await listTabs() });
  } else if (message.type === "message") {
    await handleDaemonMessage(message.payload);
  }
}

async function handleDaemonMessage(message) {
  if (message.type === "ping") {
    send({ type: "pong", timestamp: message.timestamp });
    return;
  }
  if (message.type !== "request") return;
  try {
    send({ type: "response", id: message.id, result: await dispatchRequest(message.method, message.params || {}) });
  } catch (error) {
    send({ type: "response", id: message.id, error: error.message || String(error) });
  }
}

async function dispatchRequest(method, params) {
  if (method === "listTabs") return listTabs();
  if (method === "runActions") return runActions(params);
  if (method === "manageTab") return manageTab(params);
  throw new Error(`Unknown extension method: ${method}`);
}

async function listTabs() {
  return (await chrome.tabs.query({})).map(tabInfo);
}

function tabInfo(tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || "",
    url: tab.url || tab.pendingUrl || "about:blank",
    state: tabState.get(tab.id)?.pendingDialog ? "user_input" : tab.status === "loading" ? "waiting" : "idle",
    active: Boolean(tab.active),
    openerTabId: tab.openerTabId ?? null
  };
}

async function publishTabs() {
  send({ type: "event", event: "tabsChanged", params: { tabs: await listTabs() } });
}

function send(payload) {
  chrome.runtime.sendMessage({ target: "offscreen", type: "send", payload }).catch(() => {});
}

function defaultEmulation(previous) {
  return {
    mode: "none", viewport: null, touch: false, colorScheme: "default", media: "", features: {},
    userAgent: null, uaSource: null, platform: undefined, acceptLanguage: undefined, userAgentMetadata: undefined,
    originalUserAgent: previous?.originalUserAgent ?? null,
    locale: "", timezone: "", geolocation: null, cpu: 1, network: null, headers: {}, cacheDisabled: false
  };
}

function stateFor(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      sessions: new Map(), worlds: new Map(), mainWorlds: new Map(), mainFrameId: null, frameAliases: new Map(), nextFrame: 1,
      console: [], consoleCounter: 0, consoleMark: 0,
      requests: new Map(), requestCounter: 0, inflight: new Map(), responseWaiters: new Set(),
      routes: [], routeCounter: 0, credentials: null, authAttempts: new Map(),
      pendingDialog: null, dialogPolicy: "manual", lastDialog: null, onDialog: null,
      modifiers: 0, dragData: null, fileChooser: null, blobs: new Map(), blobCounter: 0, openedTabs: null,
      emulation: defaultEmulation()
    });
  }
  return tabState.get(tabId);
}

function command(tabId, method, params = {}, sessionId) {
  return chrome.debugger.sendCommand(sessionId ? { tabId, sessionId } : { tabId }, method, params);
}

function sessionIds(state) {
  return ["", ...state.sessions.keys()];
}

function allSessions(tabId, method, params) {
  return Promise.all(sessionIds(stateFor(tabId)).map(sessionId => command(tabId, method, params, sessionId || undefined)
    .catch(error => sessionId ? null : Promise.reject(error))));
}

async function attach(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!supportedUrl.test(tab.url || "")) {
    await publishTabs();
    throw new Error(`Avi cannot control the restricted URL ${tab.url || "in this tab"}. Select an http(s), file or about:blank tab, or navigate this one with chrome_manage_tab.`);
  }
  if (attachedTabs.has(tabId)) return;
  if (!attaching.has(tabId)) attaching.set(tabId, connectDebugger(tabId, tab).finally(() => attaching.delete(tabId)));
  return attaching.get(tabId);
}

async function connectDebugger(tabId, tab) {
  const restrictedFrame = /chrome-extension:\/\/|different extension|cannot access (?:contents|a .*url)/i;
  await injectFrameGuard({ tabId, allFrames: true }, blockForeignFrames);

  try {
    await chrome.debugger.attach({ tabId }, "1.3").catch(async error => {
      if (!restrictedFrame.test(error.message || "")) throw error;
      await sleep(1500);
      await chrome.debugger.attach({ tabId }, "1.3");
    });
  } catch (error) {
    const message = error.message || String(error);
    if (restrictedFrame.test(message)) {
      await publishTabs();
      const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
      const blocked = [...new Set((frames || [])
        .map(frame => frame.url)
        .filter(url => !/^(https?:|about:|data:|blob:)/.test(url) && !url.startsWith(`chrome-extension://${chrome.runtime.id}/`)))];
      const culprit = blocked.length ? `the page contains restricted frame(s) ${blocked.join(", ")}` : "a restricted frame was present while attaching and is gone now, so retrying should work";
      throw new Error(`Chrome refused debugger access to ${tab.url} (${message}): ${culprit}. Frames from other extensions (chrome-extension://<id>) block debugging until that extension's popup or overlay is closed or the extension is disabled for this site.`);
    }
    throw new Error(`Could not attach to tab ${tabId}. Close DevTools and retry. ${message}`);
  }
  attachedTabs.add(tabId);
  const state = stateFor(tabId);
  state.sessions.clear();
  state.worlds.clear();
  state.mainWorlds.clear();
  await setupSession(tabId);
  state.mainFrameId = (await command(tabId, "Page.getFrameTree")).frameTree.frame.id;
  await command(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
}

function injectFrameGuard(target, func) {
  return chrome.scripting.executeScript({ target, func, args: [frameGuardKey], injectImmediately: true }).catch(() => {});
}

function blockForeignFrames(key) {
  if (globalThis[key]) return;
  const watched = new WeakSet();

  const isForeign = url => {
    if (!url?.startsWith("chrome-extension://")) return false;
    try { return new URL(url).host !== chrome.runtime.id; } catch { return false; }
  };

  const shadowOf = element => {
    try { return chrome.dom.openOrClosedShadowRoot(element); } catch { return element.shadowRoot; }
  };

  const visit = element => {
    if (/^I?FRAME$/.test(element.tagName) && isForeign(element.src || element.getAttribute("src"))) {
      if (element.tagName === "FRAME") element.setAttribute("src", "about:blank");
      else if (element.getAttribute("srcdoc") !== "") element.setAttribute("srcdoc", "");
    }
    const shadow = shadowOf(element);
    if (shadow) watch(shadow);
  };

  const scan = node => {
    if (node.nodeType === Node.ELEMENT_NODE) visit(node);
    else if (node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) visit(walker.currentNode);
  };

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") visit(record.target);
      record.addedNodes.forEach(scan);
    }
  });

  const watch = root => {
    if (watched.has(root)) return;
    watched.add(root);
    observer.observe(root, { attributeFilter: ["src"], attributes: true, childList: true, subtree: true });
    scan(root);
  };

  globalThis[key] = observer;
  watch(document);
}

function releaseForeignFrames(key) {
  globalThis[key]?.disconnect();
  delete globalThis[key];
}

async function setupSession(tabId, sessionId) {
  const run = (method, params) => command(tabId, method, params, sessionId).catch(() => null);
  try {
    await run("Runtime.addBinding", { name: bindingName, executionContextName: worldName });
    await Promise.all([
      run("Page.enable"),
      run("Runtime.enable"),
      run("Network.enable", { maxPostDataSize: 65536 }),
      run("Log.enable"),
      run("DOM.enable"),
      run("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "iframe" }, { exclude: true }] })
    ]);
    await replayEmulation(tabId, sessionId);
  } finally {
    if (sessionId) await run("Runtime.runIfWaitingForDebugger");
  }
}

function handleDebuggerEvent(source, method, params) {
  const tabId = source.tabId;
  if (!tabId) return;
  const state = stateFor(tabId);
  const sessionId = source.sessionId || "";

  if (method === "Target.attachedToTarget") {
    if (params.targetInfo.type === "iframe") {
      state.sessions.set(params.sessionId, { targetId: params.targetInfo.targetId });
      setupSession(tabId, params.sessionId).catch(() => {});
    } else {
      command(tabId, "Runtime.runIfWaitingForDebugger", {}, params.sessionId).catch(() => {});
    }
  } else if (method === "Target.detachedFromTarget") {
    state.sessions.delete(params.sessionId);
    forgetContexts(state, params.sessionId);
  } else if (method === "Runtime.executionContextCreated") {
    const context = params.context;
    const frameId = context.auxData?.frameId;
    if (!frameId) return;
    if (context.name === worldName) state.worlds.set(`${sessionId}|${frameId}`, context.id);
    else if (context.auxData.isDefault) state.mainWorlds.set(`${sessionId}|${frameId}`, context.id);
  } else if (method === "Runtime.executionContextDestroyed") {
    forgetContexts(state, sessionId, params.executionContextId);
  } else if (method === "Runtime.executionContextsCleared") {
    forgetContexts(state, sessionId);
  } else if (method === "Runtime.bindingCalled" && params.name === bindingName) {
    handleHostCall({ tabId, sessionId: sessionId || undefined, contextId: params.executionContextId }, params.payload).catch(() => {});
  } else if (method === "Runtime.consoleAPICalled") {
    const frame = params.stackTrace?.callFrames?.[0];
    pushConsole(state, { level: params.type, text: params.args.map(remoteObjectText).join(" "), url: frame?.url, line: frame ? frame.lineNumber + 1 : undefined });
  } else if (method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails;
    pushConsole(state, { level: "error", text: details.exception?.description || details.text, url: details.url, line: details.lineNumber + 1 });
  } else if (method === "Log.entryAdded") {
    pushConsole(state, { level: params.entry.level, text: params.entry.text, url: params.entry.url, line: params.entry.lineNumber, source: params.entry.source });
  } else if (method === "Page.frameNavigated") {
    if (!sessionId && !params.frame.parentId) {
      state.mainFrameId = params.frame.id;
      state.consoleMark = state.consoleCounter;
    }
  } else if (method === "Page.javascriptDialogOpening") {
    handleDialogOpening(tabId, sessionId, params);
  } else if (method === "Page.javascriptDialogClosed") {
    if (state.pendingDialog && state.pendingDialog.sessionId === sessionId) {
      state.pendingDialog = null;
      publishTabs();
    }
  } else if (method === "Page.fileChooserOpened") {
    state.fileChooser?.resolve({ ...params, sessionId });
  } else if (method === "Input.dragIntercepted") {
    state.dragData = params.data;
  } else if (method === "Fetch.requestPaused") {
    handleRequestPaused(tabId, sessionId, params).catch(() => {});
  } else if (method === "Fetch.authRequired") {
    handleAuthRequired(tabId, sessionId, params).catch(() => {});
  } else if (method.startsWith("Network.")) {
    handleNetworkEvent(state, sessionId, method, params);
  }
}

function forgetContexts(state, sessionId, contextId) {
  for (const map of [state.worlds, state.mainWorlds]) {
    for (const [key, id] of map) {
      if (key.startsWith(`${sessionId}|`) && (contextId === undefined || id === contextId)) map.delete(key);
    }
  }
}

function remoteObjectText(value) {
  if (value.value !== undefined) return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
  if (value.unserializableValue) return value.unserializableValue;
  const preview = value.preview;
  if (preview?.properties) {
    const array = preview.subtype === "array";
    const items = preview.properties.map(property => array ? property.value : `${property.name}: ${property.value}`);
    return `${array ? "[" : "{"}${items.join(", ")}${preview.overflow ? ", ..." : ""}${array ? "]" : "}"}`;
  }
  return value.description ?? value.type;
}

function pushConsole(state, entry) {
  const level = { warning: "warn", verbose: "debug", assert: "error", trace: "debug", dir: "log", table: "log" }[entry.level] || entry.level || "log";
  state.console.push({ id: ++state.consoleCounter, time: new Date().toISOString(), ...entry, level, url: entry.url ? stripQuery(entry.url) : undefined, text: String(entry.text ?? "").slice(0, 4000) });
  if (state.console.length > 500) state.console.splice(0, state.console.length - 500);
}

function handleDialogOpening(tabId, sessionId, params) {
  const state = stateFor(tabId);
  const dialog = { type: params.type, message: params.message, defaultValue: params.defaultPrompt ?? null, url: stripQuery(params.url) };
  if (state.dialogPolicy !== "manual") {
    const { accept, promptText } = state.dialogPolicy;
    command(tabId, "Page.handleJavaScriptDialog", { accept, promptText: accept ? promptText ?? dialog.defaultValue ?? "" : undefined }, sessionId || undefined).catch(() => {});
    state.lastDialog = { ...dialog, action: accept ? "accepted" : "dismissed" };
    return;
  }
  state.pendingDialog = { ...dialog, sessionId };
  state.onDialog?.(state.pendingDialog);
  publishTabs();
}

function publicDialog(dialog) {
  if (!dialog) return null;
  const { sessionId: _sessionId, ...rest } = dialog;
  return rest;
}

function normalizeDialogPolicy(policy) {
  if (policy === "accept" || policy === true) return { accept: true };
  if (policy === "dismiss" || policy === false) return { accept: false };
  if (policy && typeof policy === "object") return { accept: policy.accept !== false, promptText: policy.promptText == null ? undefined : String(policy.promptText) };
  if (policy === "manual" || policy == null) return "manual";
  throw new Error('Dialog policy must be "accept", "dismiss", "manual" or { accept, promptText }.');
}

async function resolveDialog(tabId, accept, promptText) {
  const state = stateFor(tabId);
  const dialog = state.pendingDialog;
  if (!dialog) throw new Error("No pending JavaScript dialog.");
  await command(tabId, "Page.handleJavaScriptDialog", { accept, promptText: accept && typeof promptText === "string" ? promptText : undefined }, dialog.sessionId || undefined);
  state.pendingDialog = null;
  state.lastDialog = { ...publicDialog(dialog), action: accept ? "accepted" : "dismissed" };
  publishTabs();
  return { ok: true, dialog: publicDialog(dialog), action: state.lastDialog.action };
}

function parseLiteral(text) {
  const value = String(text ?? "").trim();
  if (!value) return undefined;
  const quoted = /^'([\s\S]*)'$/.exec(value) || /^`([\s\S]*)`$/.exec(value);
  if (quoted) return quoted[1];
  return JSON.parse(value);
}

async function resolveDialogFromCode(tabId, code) {
  const state = stateFor(tabId);
  const call = /^\s*(?:return\s+)?(?:await\s+)?browser\.(setDialog|dismissDialog|handleDialogs)\(([\s\S]*)\)\s*;?\s*$/.exec(code);
  let value;
  try {
    value = call ? parseLiteral(call[2]) : undefined;
  } catch {
    value = Symbol.for("invalid");
  }
  let result;
  if (call?.[1] === "dismissDialog" || (call?.[1] === "setDialog" && value === false)) {
    result = await resolveDialog(tabId, false);
  } else if (call?.[1] === "setDialog" && (value === true || typeof value === "string")) {
    result = await resolveDialog(tabId, true, value);
  } else if (call?.[1] === "handleDialogs" && typeof value !== "symbol") {
    state.dialogPolicy = normalizeDialogPolicy(value);
    result = state.dialogPolicy === "manual"
      ? { ok: true, policy: "manual", pendingDialog: publicDialog(state.pendingDialog) }
      : await resolveDialog(tabId, state.dialogPolicy.accept, state.dialogPolicy.promptText);
  } else {
    return formatToolContent(tabId, {
      result: {
        ok: false,
        pendingDialog: publicDialog(state.pendingDialog),
        message: 'A JavaScript dialog blocks the page. Send only one of: return browser.setDialog(true); return browser.setDialog("text"); return browser.dismissDialog(); return browser.handleDialogs("accept").'
      }
    });
  }
  await sleep(400);
  const postActionSnapshot = state.pendingDialog ? "Skipped: another JavaScript dialog is pending." : await snapshotOf(tabId, mainTarget(state)).catch(error => `Snapshot unavailable: ${error.message}`);
  return formatToolContent(tabId, { result, postActionSnapshot });
}

function mainTarget(state) {
  return { sessionId: undefined, frameId: state.mainFrameId, offset: { x: 0, y: 0 } };
}

async function ensureWorld(tabId, target) {
  const state = stateFor(tabId);
  const key = `${target.sessionId || ""}|${target.frameId}`;
  if (state.worlds.has(key)) return state.worlds.get(key);
  const { executionContextId } = await command(tabId, "Page.createIsolatedWorld", { frameId: target.frameId, worldName, grantUniveralAccess: false }, target.sessionId);
  state.worlds.set(key, executionContextId);
  return executionContextId;
}

function describeException(details) {
  return String(details.exception?.description || details.text || "Runtime evaluation failed.").split("\n").slice(0, 6).join("\n");
}

async function evaluateInWorld(tabId, target, expression) {
  const run = async () => {
    const contextId = await ensureWorld(tabId, target);
    const install = await command(tabId, "Runtime.evaluate", { expression: `(${installBrowserRuntime})(${JSON.stringify(bindingName)}, ${browserRuntimeVersion})`, contextId }, target.sessionId);
    if (install.exceptionDetails) throw new Error(describeException(install.exceptionDetails));
    const evaluated = await command(tabId, "Runtime.evaluate", { expression, contextId, awaitPromise: true, returnByValue: true, userGesture: true }, target.sessionId);
    if (evaluated.exceptionDetails) throw new Error(describeException(evaluated.exceptionDetails));
    return evaluated.result?.value;
  };
  try {
    return await run();
  } catch (error) {
    if (!/Cannot find context|context with specified id/i.test(error.message || "")) throw error;
    stateFor(tabId).worlds.delete(`${target.sessionId || ""}|${target.frameId}`);
    return run();
  }
}

function snapshotOf(tabId, target, options = {}) {
  return evaluateInWorld(tabId, target, `window.__browserMcpRun(browser => browser.snapshot(${JSON.stringify(options)}), ${JSON.stringify({ offset: target.offset })})`);
}

async function runActions({ tabId, code, timeoutMs = 8000, frameId, snapshot: includeSnapshot = true }) {
  if (!Number.isInteger(tabId)) throw new Error("A concrete tab is required.");
  await attach(tabId);
  const state = stateFor(tabId);
  if (state.pendingDialog) return resolveDialogFromCode(tabId, code);
  await command(tabId, "Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  const target = await resolveFrame(tabId, frameId);
  const body = /^\s*async\s*(?:\(\s*\w*\s*\)|\w+)\s*=>/.test(code) ? `return (${code})(browser);` : code;
  const snapshotOnly = /^\s*return\s+(?:await\s+)?browser\.snapshot\([^;]*\)\s*;?\s*$/.test(code);
  state.openedTabs = [];
  const dialogOpened = new Promise(resolve => { state.onDialog = resolve; });
  try {
    const execution = evaluateInWorld(tabId, target, `window.__browserMcpRun(async (browser) => {\n${body}\n}, ${JSON.stringify({ offset: target.offset })})`);
    execution.catch(() => {});
    const outcome = await withTimeout(Promise.race([execution.then(value => ({ value })), dialogOpened.then(dialog => ({ dialog }))]), timeoutMs)
      .catch(async error => {
        if (!/context was destroyed|navigated or closed|Cannot find context|Inspected target navigated/i.test(error.message || "")) throw error;
        await waitForLoad(tabId, 15000).catch(() => {});
        return { value: { ok: true, navigated: true, message: "The page navigated during the action; its return value is unavailable." }, navigated: true };
      });
    if (outcome.dialog) {
      return formatToolContent(tabId, {
        result: {
          ok: false,
          pendingDialog: publicDialog(outcome.dialog),
          message: "A JavaScript dialog opened and blocks the page. Resolve it with browser.setDialog(true | \"text\") or browser.dismissDialog() in a separate call; the rest of this code continues afterwards."
        }
      });
    }
    let result = outcome.value;
    let navigated = outcome.navigated;
    if (result?.type === "__browserMcpRuntimeNavigation") {
      await chrome.tabs.update(tabId, { url: normalizeUrl(result.url) });
      await waitForLoad(tabId, 30000);
      result = result.result;
      navigated = true;
    }
    const output = { result };
    if (includeSnapshot && !snapshotOnly) {
      output.postActionSnapshot = state.pendingDialog
        ? "Skipped: a JavaScript dialog is pending."
        : await snapshotOf(tabId, navigated ? mainTarget(state) : target)
          .catch(() => snapshotOf(tabId, mainTarget(state)))
          .catch(error => `Snapshot unavailable: ${error.message}`);
    }
    return formatToolContent(tabId, output);
  } finally {
    state.onDialog = null;
  }
}

async function collectFrames(tabId) {
  const state = stateFor(tabId);
  const byId = new Map();
  for (const sessionId of sessionIds(state)) {
    const ownRoot = sessionId ? state.sessions.get(sessionId)?.targetId : state.mainFrameId;
    const tree = await command(tabId, "Page.getFrameTree", {}, sessionId || undefined).then(result => result.frameTree).catch(() => null);
    const walk = (node, parentId) => {
      const frame = node.frame;
      const previous = byId.get(frame.id);
      if (!previous || frame.id === ownRoot || (sessionId && !previous.sessionId)) {
        byId.set(frame.id, {
          id: frame.id,
          parentId: frame.parentId ?? parentId ?? previous?.parentId ?? null,
          url: frame.url + (frame.urlFragment || ""),
          name: frame.name || null,
          origin: frame.securityOrigin,
          sessionId
        });
      }
      for (const child of node.childFrames || []) walk(child, frame.id);
    };
    if (tree) walk(tree, null);
  }
  const mainOrigin = byId.get(state.mainFrameId)?.origin;
  return [...byId.values()].map(frame => {
    if (frame.id !== state.mainFrameId && !state.frameAliases.has(frame.id)) state.frameAliases.set(frame.id, `f${state.nextFrame++}`);
    return { ...frame, alias: frame.id === state.mainFrameId ? "main" : state.frameAliases.get(frame.id), crossOrigin: frame.origin !== mainOrigin || frame.origin === "null" };
  });
}

async function frameBox(tabId, frames, frame, reveal = false) {
  const state = stateFor(tabId);
  if (frame.id === state.mainFrameId) return { x: 0, y: 0, width: null, height: null };
  const parent = frames.find(item => item.id === frame.parentId);
  if (!parent) throw new Error(`Frame ${frame.alias} has no known parent.`);
  const ownerSession = parent.sessionId || undefined;
  const { backendNodeId } = await command(tabId, "DOM.getFrameOwner", { frameId: frame.id }, ownerSession);
  if (reveal) await command(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId }, ownerSession).catch(() => {});
  const { model } = await command(tabId, "DOM.getBoxModel", { backendNodeId }, ownerSession);
  const sessionRoot = ownerSession ? state.sessions.get(ownerSession)?.targetId : state.mainFrameId;
  const base = sessionRoot && sessionRoot !== state.mainFrameId
    ? await frameBox(tabId, frames, frames.find(item => item.id === sessionRoot))
    : { x: 0, y: 0 };
  const [x1, y1, x2, , , y3] = model.content;
  return { x: base.x + x1, y: base.y + y1, width: x2 - x1, height: y3 - y1 };
}

async function resolveFrame(tabId, alias) {
  const state = stateFor(tabId);
  if (!alias || alias === "main") return mainTarget(state);
  const frames = await collectFrames(tabId);
  const frame = frames.find(item => item.alias === alias);
  if (!frame) throw new Error(`Frame "${alias}" was not found. Read frame IDs from a fresh snapshot or browser.frames().`);
  const box = await frameBox(tabId, frames, frame, true);
  return { sessionId: frame.sessionId || undefined, frameId: frame.id, offset: { x: box.x, y: box.y } };
}

async function listFrames(tabId, crossOriginOnly) {
  const state = stateFor(tabId);
  const frames = await collectFrames(tabId);
  const listed = frames.filter(frame => frame.id !== state.mainFrameId && (!crossOriginOnly || frame.crossOrigin)).slice(0, 30);
  return Promise.all(listed.map(async frame => ({
    frame_id: frame.alias,
    parent_frame_id: frames.find(item => item.id === frame.parentId)?.alias ?? null,
    url: stripQuery(frame.url),
    name: frame.name,
    cross_origin: frame.crossOrigin,
    rect: await frameBox(tabId, frames, frame).then(box => roundRect(box)).catch(() => null)
  })));
}

function roundRect(box) {
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

async function handleHostCall(caller, payload) {
  const request = JSON.parse(payload);
  let ok = true;
  let value;
  try {
    value = await dispatchHostMethod(caller, request.method, request.args || []);
  } catch (error) {
    ok = false;
    value = error.message || String(error);
  }
  await command(caller.tabId, "Runtime.evaluate", {
    expression: `window.__chromeMcpHostResolve(${JSON.stringify(request.id)}, ${ok}, ${JSON.stringify(value ?? null)})`,
    contextId: caller.contextId
  }, caller.sessionId).catch(() => {});
}

async function dispatchHostMethod(caller, method, args) {
  const { tabId } = caller;
  const state = stateFor(tabId);
  const handlers = {
    status: async () => {
      const recent = state.console.filter(entry => entry.id > state.consoleMark);
      const latest = [...recent].reverse().find(entry => entry.level === "error" || entry.level === "warn");
      return {
        errors: recent.filter(entry => entry.level === "error").length,
        warnings: recent.filter(entry => entry.level === "warn").length,
        latest: latest ? `[${latest.level}] ${latest.text.replace(/\s+/g, " ").slice(0, 200)}` : null,
        lastDialog: state.lastDialog,
        frames: await listFrames(tabId, true).catch(() => [])
      };
    },
    frames: () => listFrames(tabId, false),
    mouse: input => dispatchMouse(tabId, input || {}),
    touch: input => dispatchTouch(tabId, input || {}),
    insertText: async text => {
      await command(tabId, "Input.insertText", { text: String(text ?? "") });
      return { ok: true };
    },
    typeKeys: (text, delay) => typeKeys(tabId, String(text ?? ""), Number(delay) || 0),
    key: (combo, phase) => keyAction(tabId, String(combo || ""), phase),
    uploadRef: (ref, files) => uploadToRef(caller, ref, files),
    armFileChooser: async () => {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      state.fileChooser = { promise, resolve };
      await allSessions(tabId, "Page.setInterceptFileChooserDialog", { enabled: true });
      return { ok: true };
    },
    awaitFileChooser: (files, timeout) => awaitFileChooser(tabId, files, timeout),
    dropFiles: async (x, y, files) => {
      const data = { items: [], files: [files].flat().map(String), dragOperationsMask: 1 };
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await command(tabId, "Input.dispatchDragEvent", { type, x, y, data, modifiers: state.modifiers });
      }
      return { ok: true };
    },
    screenshot: options => screenshot(tabId, options || {}),
    pdf: async (options = {}) => {
      const { data } = await command(tabId, "Page.printToPDF", {
        printBackground: options.background ?? true,
        landscape: Boolean(options.landscape),
        scale: options.scale,
        paperWidth: options.paperWidth,
        paperHeight: options.paperHeight,
        marginTop: options.margin ?? options.marginTop,
        marginBottom: options.margin ?? options.marginBottom,
        marginLeft: options.margin ?? options.marginLeft,
        marginRight: options.margin ?? options.marginRight,
        pageRanges: options.pageRanges,
        preferCSSPageSize: options.preferCSSPageSize
      });
      return addBlob(state, { kind: "file", data, mimeType: "application/pdf", name: options.name || "page.pdf", path: options.path });
    },
    consoleLogs: (options = {}) => {
      const levels = options.level ? [options.level].flat().map(level => level === "warning" ? "warn" : level) : null;
      const search = options.search ? String(options.search).toLowerCase() : null;
      const entries = state.console.filter(entry => (!levels || levels.includes(entry.level))
        && (!search || entry.text.toLowerCase().includes(search))
        && (!options.sinceLoad || entry.id > state.consoleMark));
      const limit = clamp(options.limit ?? 50, 1, 500);
      if (options.clear) state.console = [];
      return { count: Math.min(entries.length, limit), total: entries.length, entries: entries.slice(-limit) };
    },
    networkLogs: options => networkLogs(state, options || {}),
    inspectNetworkRequest: (id, options) => inspectNetworkRequest(tabId, id, options || {}),
    waitForResponse: (filter, options = {}) => new Promise((resolve, reject) => {
      const waiter = { filter: normalizeFilter(filter), resolve };
      const timeout = clamp(options.timeout ?? 10000, 100, 300000);
      waiter.timer = setTimeout(() => {
        state.responseWaiters.delete(waiter);
        reject(new Error(`No response matched ${JSON.stringify(filter)} within ${timeout} ms.`));
      }, timeout);
      state.responseWaiters.add(waiter);
    }),
    waitForNetworkIdle: (options = {}) => waitForNetworkIdle(state, options),
    route: async (rule = {}) => {
      if (!["block", "fulfill", "continue"].includes(rule.action || "continue")) throw new Error('Route action must be "block", "fulfill" or "continue".');
      const route = { ...rule, action: rule.action || "continue", method: rule.method ? String(rule.method).toUpperCase() : undefined, id: `r${++state.routeCounter}`, hits: 0 };
      state.routes.push(route);
      await updateFetch(tabId);
      return { ok: true, id: route.id, routes: state.routes.map(publicRoute) };
    },
    unroute: async id => {
      state.routes = id ? state.routes.filter(route => route.id !== id) : [];
      await updateFetch(tabId);
      return { ok: true, routes: state.routes.map(publicRoute) };
    },
    setExtraHeaders: async headers => {
      state.emulation.headers = Object.fromEntries(Object.entries(headers || {}).map(([name, value]) => [name, String(value)]));
      await allSessions(tabId, "Network.setExtraHTTPHeaders", { headers: state.emulation.headers });
      return { ok: true, headers: Object.keys(state.emulation.headers) };
    },
    setNetworkConditions: async conditions => {
      state.emulation.network = networkConditions(conditions);
      await allSessions(tabId, "Network.emulateNetworkConditions", state.emulation.network || { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      return { ok: true, network: state.emulation.network };
    },
    setCacheDisabled: async disabled => {
      state.emulation.cacheDisabled = Boolean(disabled);
      await allSessions(tabId, "Network.setCacheDisabled", { cacheDisabled: state.emulation.cacheDisabled });
      return { ok: true, cacheDisabled: state.emulation.cacheDisabled };
    },
    setHttpCredentials: async credentials => {
      state.credentials = credentials ? { username: String(credentials.username ?? ""), password: String(credentials.password ?? "") } : null;
      state.authAttempts.clear();
      await updateFetch(tabId);
      return { ok: true, enabled: Boolean(state.credentials) };
    },
    cookies: async (options = {}) => (await readCookies(tabId, options)).map(publicCookie),
    setCookies: async cookies => {
      const url = (await chrome.tabs.get(tabId)).url;
      const list = [cookies].flat().map(cookie => ({
        name: String(cookie.name),
        value: String(cookie.value ?? ""),
        ...(cookie.domain ? { domain: cookie.domain } : { url: cookie.url || url }),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expires: typeof cookie.expires === "string" ? Date.parse(cookie.expires) / 1000 : cookie.expires
      }));
      await command(tabId, "Network.setCookies", { cookies: list });
      return { ok: true, count: list.length };
    },
    clearCookies: async (options = {}) => {
      const cookies = await readCookies(tabId, options);
      for (const cookie of cookies) await command(tabId, "Network.deleteCookies", { name: cookie.name, domain: cookie.domain, path: cookie.path });
      return { ok: true, deleted: cookies.length };
    },
    clearStorage: async (options = {}) => {
      const origin = options.origin || new URL((await chrome.tabs.get(tabId)).url).origin;
      const storageTypes = options.types ? [options.types].flat().join(",") : "all";
      await command(tabId, "Storage.clearDataForOrigin", { origin, storageTypes });
      return { ok: true, origin, storageTypes };
    },
    setPermission: (name, setting, origin) => setPermission(tabId, name, setting, origin),
    setViewport: async (width, height, options = {}) => {
      const emulation = state.emulation;
      emulation.viewport = width == null ? null : {
        width: clamp(width, 200, 7680),
        height: clamp(height ?? 800, 200, 4320),
        deviceScaleFactor: Number(options.deviceScaleFactor) || 0,
        mobile: Boolean(options.mobile)
      };
      if (options.touch !== undefined) emulation.touch = Boolean(options.touch);
      emulation.mode = emulation.viewport ? "custom" : "none";
      await applyMetrics(tabId);
      return emulationState(emulation);
    },
    setEmulation: mode => setEmulationMode(tabId, mode),
    setTouch: async enabled => {
      state.emulation.touch = Boolean(enabled);
      await applyMetrics(tabId);
      return emulationState(state.emulation);
    },
    setColorScheme: async scheme => {
      state.emulation.colorScheme = ["dark", "light"].includes(scheme) ? scheme : "default";
      await applyMedia(tabId);
      return emulationState(state.emulation);
    },
    setMedia: async (media = {}) => {
      if (media.type !== undefined) state.emulation.media = ["print", "screen"].includes(media.type) ? media.type : "";
      if (media.features !== undefined) state.emulation.features = media.features || {};
      await applyMedia(tabId);
      return emulationState(state.emulation);
    },
    setUserAgent: async (userAgent, options = {}) => {
      const emulation = state.emulation;
      await rememberUserAgent(tabId);
      emulation.userAgent = userAgent ? String(userAgent) : null;
      emulation.uaSource = userAgent ? "user" : null;
      emulation.platform = options.platform;
      emulation.acceptLanguage = options.acceptLanguage;
      emulation.userAgentMetadata = options.metadata;
      await allSessions(tabId, "Emulation.setUserAgentOverride", userAgentParams(emulation));
      return emulationState(emulation);
    },
    setLocale: async locale => {
      const emulation = state.emulation;
      emulation.locale = locale ? String(locale) : "";
      emulation.acceptLanguage = emulation.locale ? `${emulation.locale},${emulation.locale.split("-")[0]};q=0.9` : undefined;
      await rememberUserAgent(tabId);
      for (const sessionId of sessionIds(state)) {
        await command(tabId, "Emulation.setLocaleOverride", {}, sessionId || undefined).catch(() => {});
        if (emulation.locale) await command(tabId, "Emulation.setLocaleOverride", { locale: emulation.locale }, sessionId || undefined);
      }
      await allSessions(tabId, "Emulation.setUserAgentOverride", userAgentParams(emulation));
      return emulationState(emulation);
    },
    setTimezone: async timezone => {
      state.emulation.timezone = timezone ? String(timezone) : "";
      await allSessions(tabId, "Emulation.setTimezoneOverride", { timezoneId: state.emulation.timezone });
      return emulationState(state.emulation);
    },
    setGeolocation: async coordinates => {
      state.emulation.geolocation = coordinates
        ? { latitude: Number(coordinates.latitude), longitude: Number(coordinates.longitude), accuracy: Number(coordinates.accuracy ?? 10) }
        : null;
      await (state.emulation.geolocation
        ? allSessions(tabId, "Emulation.setGeolocationOverride", state.emulation.geolocation)
        : allSessions(tabId, "Emulation.clearGeolocationOverride", {}));
      return emulationState(state.emulation);
    },
    setCPUThrottling: async rate => {
      state.emulation.cpu = Math.min(Math.max(Number(rate) || 1, 1), 20);
      await command(tabId, "Emulation.setCPUThrottlingRate", { rate: state.emulation.cpu });
      return emulationState(state.emulation);
    },
    resetEmulation: () => resetEmulation(tabId),
    handleDialogs: async policy => {
      state.dialogPolicy = normalizeDialogPolicy(policy);
      return { ok: true, policy: state.dialogPolicy };
    },
    setDialog: value => resolveDialog(tabId, value !== false, value),
    dismissDialog: () => resolveDialog(tabId, false),
    downloads: async (options = {}) => (await chrome.downloads.search({ orderBy: ["-startTime"], limit: clamp(options.limit ?? 20, 1, 200), ...(options.state ? { state: options.state } : {}) })).map(downloadSummary),
    waitForDownload: (options = {}) => waitForDownload(options),
    download: async (url, options = {}) => {
      const id = await chrome.downloads.download({ url, filename: options.filename, conflictAction: options.conflict || "uniquify", saveAs: false });
      return awaitDownload(id, clamp(options.timeout ?? 60000, 1000, 600000));
    },
    clipboardRead: () => clipboard("read"),
    clipboardWrite: text => clipboard("write", text),
    pageEval: expression => evaluateInPage(caller, expression)
  };
  const handler = handlers[method];
  if (!handler) throw new Error(`Unknown host method: ${method}`);
  return handler(...args.map(arg => arg ?? undefined));
}

function addBlob(state, blob) {
  const token = `blob-${++state.blobCounter}`;
  state.blobs.set(token, blob);
  return { __aviBlob: token, kind: blob.kind, mimeType: blob.mimeType, ...(blob.width ? { width: blob.width, height: blob.height } : {}) };
}

async function evaluateInPage(caller, expression) {
  const state = stateFor(caller.tabId);
  const session = caller.sessionId || "";
  const worldKey = [...state.worlds].find(([key, id]) => id === caller.contextId && key.startsWith(`${session}|`))?.[0];
  const contextId = worldKey ? state.mainWorlds.get(worldKey) : undefined;
  if (!contextId && caller.sessionId) throw new Error("The page context of this frame is not ready yet. Retry.");
  const evaluated = await command(caller.tabId, "Runtime.evaluate", { expression: String(expression), contextId, awaitPromise: true, returnByValue: true, userGesture: true }, caller.sessionId);
  if (evaluated.exceptionDetails) throw new Error(describeException(evaluated.exceptionDetails));
  return evaluated.result?.value ?? null;
}

async function screenshot(tabId, options) {
  const state = stateFor(tabId);
  const { cssVisualViewport: viewport, cssContentSize: content } = await command(tabId, "Page.getLayoutMetrics");
  const ratio = (await command(tabId, "Runtime.evaluate", { expression: "devicePixelRatio", returnByValue: true })).result?.value || 1;
  const format = ["jpeg", "webp"].includes(options.format) ? options.format : "png";
  let clip;
  let truncated = false;
  if (options.fullPage) {
    const height = Math.ceil(content.height);
    truncated = height > 16384;
    clip = { x: 0, y: 0, width: Math.ceil(content.width), height: Math.min(height, 16384) };
  } else if (options.clip) {
    clip = {
      x: viewport.pageX + Math.max(0, Number(options.clip.x) || 0),
      y: viewport.pageY + Math.max(0, Number(options.clip.y) || 0),
      width: Math.max(1, Math.ceil(Number(options.clip.width) || 1)),
      height: Math.max(1, Math.ceil(Number(options.clip.height) || 1))
    };
  } else {
    clip = { x: viewport.pageX, y: viewport.pageY, width: Math.floor(viewport.clientWidth), height: Math.floor(viewport.clientHeight) };
  }
  const shot = await withTimeout(command(tabId, "Page.captureScreenshot", {
    format,
    quality: format === "png" ? undefined : clamp(options.quality ?? 80, 1, 100),
    fromSurface: true,
    captureBeyondViewport: Boolean(options.fullPage),
    clip: { ...clip, scale: 1 / ratio }
  }), 20000, "Screenshot timed out. Chrome may not paint background tabs; activate the tab with chrome_manage_tab and retry.");
  return { ...addBlob(state, { kind: "image", data: shot.data, mimeType: `image/${format}`, width: clip.width, height: clip.height }), ...(truncated ? { truncated: true } : {}) };
}

async function uploadToRef(caller, ref, files) {
  const { result } = await command(caller.tabId, "Runtime.evaluate", { expression: `window.__browserMcpRefs.get(${Number(ref)})?.deref()`, contextId: caller.contextId }, caller.sessionId);
  if (!result?.objectId) throw new Error("The file input is no longer attached to the page.");
  try {
    await command(caller.tabId, "DOM.setFileInputFiles", { files: [files].flat().map(String), objectId: result.objectId }, caller.sessionId);
  } finally {
    command(caller.tabId, "Runtime.releaseObject", { objectId: result.objectId }, caller.sessionId).catch(() => {});
  }
  return { ok: true };
}

async function awaitFileChooser(tabId, files, timeout) {
  const state = stateFor(tabId);
  try {
    if (!state.fileChooser) throw new Error("The file chooser interception was not armed.");
    const event = await withTimeout(state.fileChooser.promise, clamp(timeout ?? 5000, 500, 60000), "No file chooser opened after the click. Target the <input type=file> itself or the control that opens it.");
    const paths = [files].flat().map(String);
    await command(tabId, "DOM.setFileInputFiles", { files: paths, backendNodeId: event.backendNodeId }, event.sessionId || undefined);
    return { ok: true, mode: event.mode, files: paths.map(path => path.split(/[\\/]/).pop()) };
  } finally {
    state.fileChooser = null;
    await allSessions(tabId, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
  }
}

async function dispatchMouse(tabId, input) {
  const state = stateFor(tabId);
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Pointer coordinates must be finite viewport CSS pixels.");
  const button = ["right", "middle"].includes(input.button) ? input.button : "left";
  const buttons = { left: 1, right: 2, middle: 4 }[button];
  const mouse = params => command(tabId, "Input.dispatchMouseEvent", { x, y, modifiers: state.modifiers, ...params });
  await mouse({ type: "mouseMoved", button: "none" });
  if (input.type === "scroll") {
    await mouse({ type: "mouseWheel", deltaX: Number(input.deltaX) || 0, deltaY: Number(input.deltaY ?? input.delta) || 0 });
  } else if (input.type === "click") {
    const clickCount = Math.max(1, Math.min(3, Number(input.clickCount) || 1));
    for (let count = 1; count <= clickCount; count++) {
      await mouse({ type: "mousePressed", button, buttons, clickCount: count });
      if (input.duration > 0) await sleep(Math.min(Number(input.duration), 10000));
      await mouse({ type: "mouseReleased", button, buttons: 0, clickCount: count });
    }
  } else if (input.type === "drag") {
    return dragMouse(tabId, { x, y, toX: Number(input.toX), toY: Number(input.toY), duration: input.duration, button, buttons });
  }
  return { ok: true };
}

async function dragMouse(tabId, { x, y, toX, toY, duration: requested, button, buttons }) {
  const state = stateFor(tabId);
  const duration = Math.min(Math.max(Number(requested) || 500, 0), 10000);
  const steps = Math.max(8, Math.ceil(duration / 25));
  const move = (pointX, pointY) => command(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", button, buttons, x: pointX, y: pointY, modifiers: state.modifiers });
  state.dragData = null;
  await command(tabId, "Input.setInterceptDrags", { enabled: true }).catch(() => {});
  let html5 = false;
  try {
    await command(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", button, buttons, clickCount: 1, x, y, modifiers: state.modifiers });
    for (let index = 1; index <= steps && !state.dragData; index++) {
      await move(x + ((toX - x) * index / steps), y + ((toY - y) * index / steps));
      await sleep(duration / steps);
    }
    if (state.dragData) {
      html5 = true;
      const data = state.dragData;
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await command(tabId, "Input.dispatchDragEvent", { type, x: toX, y: toY, data, modifiers: state.modifiers });
      }
    }
    await command(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button, buttons: 0, clickCount: 1, x: toX, y: toY, modifiers: state.modifiers });
  } finally {
    state.dragData = null;
    await command(tabId, "Input.setInterceptDrags", { enabled: false }).catch(() => {});
  }
  return { ok: true, html5 };
}

async function dispatchTouch(tabId, input) {
  const state = stateFor(tabId);
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Touch coordinates must be finite viewport CSS pixels.");
  const touch = (type, touchPoints) => command(tabId, "Input.dispatchTouchEvent", { type, touchPoints, modifiers: state.modifiers });
  await touch("touchStart", [{ x, y }]);
  if (input.type === "swipe") {
    const duration = Math.min(Math.max(Number(input.duration) || 300, 0), 10000);
    const steps = Math.max(6, Math.ceil(duration / 20));
    for (let index = 1; index <= steps; index++) {
      await touch("touchMove", [{ x: x + ((input.toX - x) * index / steps), y: y + ((input.toY - y) * index / steps) }]);
      await sleep(duration / steps);
    }
  } else if (input.duration > 0) {
    await sleep(Math.min(Number(input.duration), 10000));
  }
  await touch("touchEnd", []);
  return { ok: true };
}

const modifierBits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const modifierAliases = { Ctrl: "Control", Cmd: "Meta", Command: "Meta", Option: "Alt", Super: "Meta", Win: "Meta", ControlOrMeta: isMac ? "Meta" : "Control" };
const keyAliases = { Esc: "Escape", Return: "Enter", Del: "Delete", Ins: "Insert", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Spacebar: "Space", PgUp: "PageUp", PgDn: "PageDown" };
const namedKeys = {
  Enter: { keyCode: 13, text: "\r" }, Tab: { keyCode: 9 }, Escape: { keyCode: 27 }, Backspace: { keyCode: 8 },
  Delete: { keyCode: 46 }, Insert: { keyCode: 45 }, Space: { keyCode: 32, key: " ", text: " " },
  ArrowLeft: { keyCode: 37 }, ArrowUp: { keyCode: 38 }, ArrowRight: { keyCode: 39 }, ArrowDown: { keyCode: 40 },
  Home: { keyCode: 36 }, End: { keyCode: 35 }, PageUp: { keyCode: 33 }, PageDown: { keyCode: 34 },
  CapsLock: { keyCode: 20 }, NumLock: { keyCode: 144 }, ScrollLock: { keyCode: 145 }, Pause: { keyCode: 19 },
  PrintScreen: { keyCode: 44 }, ContextMenu: { keyCode: 93 },
  Shift: { keyCode: 16, code: "ShiftLeft", location: 1 }, Control: { keyCode: 17, code: "ControlLeft", location: 1 },
  Alt: { keyCode: 18, code: "AltLeft", location: 1 }, Meta: { keyCode: 91, code: "MetaLeft", location: 1 },
  NumpadEnter: { keyCode: 13, key: "Enter", text: "\r", location: 3 },
  NumpadAdd: { keyCode: 107, key: "+", text: "+", location: 3 }, NumpadSubtract: { keyCode: 109, key: "-", text: "-", location: 3 },
  NumpadMultiply: { keyCode: 106, key: "*", text: "*", location: 3 }, NumpadDivide: { keyCode: 111, key: "/", text: "/", location: 3 },
  NumpadDecimal: { keyCode: 110, key: ".", text: ".", location: 3 }
};
for (let index = 1; index <= 24; index++) namedKeys[`F${index}`] = { keyCode: 111 + index };
for (let digit = 0; digit <= 9; digit++) namedKeys[`Numpad${digit}`] = { keyCode: 96 + digit, key: String(digit), text: String(digit), location: 3 };
const punctuation = { "-": ["Minus", 189], "=": ["Equal", 187], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], "\\": ["Backslash", 220], ";": ["Semicolon", 186], "'": ["Quote", 222], ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191], "`": ["Backquote", 192] };
const shiftedPunctuation = { "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/", "~": "`" };
const macCommands = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo" };

function characterKey(char) {
  if (/^[a-z]$/i.test(char)) return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0), text: char, shift: char !== char.toLowerCase() };
  if (/^\d$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: 48 + Number(char), text: char };
  if (punctuation[char]) return { key: char, code: punctuation[char][0], keyCode: punctuation[char][1], text: char };
  const base = shiftedPunctuation[char];
  if (base) {
    const definition = characterKey(base);
    return { ...definition, key: char, text: char, shift: true };
  }
  return null;
}

function keyDefinition(name) {
  const resolved = keyAliases[name] || name;
  if (namedKeys[resolved]) return { key: namedKeys[resolved].key || resolved, code: namedKeys[resolved].code || resolved, ...namedKeys[resolved] };
  if ([...resolved].length === 1) return characterKey(resolved) || { key: resolved, text: resolved, keyCode: 0 };
  throw new Error(`Unknown key "${name}". Use a single character or a key name such as Enter, Tab, Escape, ArrowDown, F5, Home, PageDown, Numpad1 or Shift.`);
}

async function keyEvent(tabId, type, definition, modifiers, commands) {
  await command(tabId, "Input.dispatchKeyEvent", {
    type,
    key: definition.key,
    code: definition.code,
    windowsVirtualKeyCode: definition.keyCode,
    nativeVirtualKeyCode: definition.keyCode,
    location: definition.location,
    modifiers,
    ...(type === "keyDown" ? { text: definition.text, unmodifiedText: definition.text } : {}),
    ...(commands?.length ? { commands } : {})
  });
}

async function keyAction(tabId, combo, phase = "press") {
  const state = stateFor(tabId);
  const parts = combo.split(/\+(?=.)/).map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error("A key is required.");
  const keyName = parts.pop();
  const modifiers = parts.map(part => {
    const name = modifierAliases[part] || part;
    if (!modifierBits[name]) throw new Error(`Unknown modifier "${part}". Use Alt, Control, Meta, Shift or ControlOrMeta.`);
    return name;
  });
  let definition = keyDefinition(modifierAliases[keyName] || keyName);
  const isModifierKey = Boolean(modifierBits[definition.key]);
  if (phase === "down" || phase === "up") {
    if (modifiers.length) throw new Error("keyDown and keyUp accept a single key.");
    if (isModifierKey) state.modifiers = phase === "down" ? state.modifiers | modifierBits[definition.key] : state.modifiers & ~modifierBits[definition.key];
    const type = phase === "up" ? "keyUp" : definition.text && !(state.modifiers & ~modifierBits.Shift) ? "keyDown" : "rawKeyDown";
    await keyEvent(tabId, type, definition, state.modifiers);
    return { ok: true, key: definition.key, phase, heldModifiers: Object.keys(modifierBits).filter(name => state.modifiers & modifierBits[name]) };
  }
  let mask = state.modifiers;
  for (const name of modifiers) {
    mask |= modifierBits[name];
    await keyEvent(tabId, "rawKeyDown", keyDefinition(name), mask);
  }
  if (mask & modifierBits.Shift && /^[a-z]$/.test(definition.key)) definition = { ...definition, key: definition.key.toUpperCase(), text: definition.key.toUpperCase() };
  const text = mask & ~modifierBits.Shift ? undefined : definition.text;
  const macCommand = isMac && mask & modifierBits.Meta ? (mask & modifierBits.Shift && definition.key.toLowerCase() === "z" ? "redo" : macCommands[definition.key.toLowerCase()]) : null;
  await keyEvent(tabId, text ? "keyDown" : "rawKeyDown", { ...definition, text }, mask, macCommand ? [macCommand] : null);
  await keyEvent(tabId, "keyUp", definition, mask);
  for (const name of modifiers.reverse()) {
    mask &= ~modifierBits[name];
    await keyEvent(tabId, "keyUp", keyDefinition(name), mask | state.modifiers);
  }
  return { ok: true, key: combo };
}

async function typeKeys(tabId, text, delay) {
  const state = stateFor(tabId);
  for (const char of text) {
    if (char === "\n" || char === "\r") {
      await keyAction(tabId, "Enter");
    } else if (char === "\t") {
      await keyAction(tabId, "Tab");
    } else {
      const definition = characterKey(char);
      if (definition) {
        const modifiers = state.modifiers | (definition.shift ? modifierBits.Shift : 0);
        await keyEvent(tabId, "keyDown", definition, modifiers);
        await keyEvent(tabId, "keyUp", definition, modifiers);
      } else {
        await command(tabId, "Input.insertText", { text: char });
      }
    }
    if (delay > 0) await sleep(Math.min(delay, 1000));
  }
  return { ok: true, typed: [...text].length };
}

function handleNetworkEvent(state, sessionId, method, params) {
  const key = `${sessionId}|${params.requestId}`;
  if (method === "Network.requestWillBeSent") {
    const previous = state.requests.get(key);
    if (previous && params.redirectResponse) {
      previous.response = params.redirectResponse;
      previous.finished = true;
      state.requests.delete(key);
      state.requests.set(`${key}|${previous.id}`, previous);
    }
    state.requests.set(key, {
      id: String(++state.requestCounter), sessionId, requestId: params.requestId, request: params.request, type: params.type,
      startedAt: params.wallTime * 1000, timestamp: params.timestamp, response: null, failed: false, finished: false
    });
    if (!/^(WebSocket|EventSource)$/.test(params.type || "")) state.inflight.set(key, Date.now());
    while (state.requests.size > 500) {
      const oldest = state.requests.keys().next().value;
      state.requests.delete(oldest);
      state.inflight.delete(oldest);
    }
    return;
  }
  // Cross-origin frame navigations start in the parent session and finish in the frame's own session.
  const recordKey = state.requests.has(key) ? key : [...state.requests.keys()].find(item => item.endsWith(`|${params.requestId}`));
  const record = state.requests.get(recordKey);
  if (!record) return;
  if (method === "Network.responseReceived") {
    record.response = params.response;
    record.type = params.type || record.type;
  } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    record.finished = true;
    record.durationMs = Math.round((params.timestamp - record.timestamp) * 1000);
    if (method === "Network.loadingFinished") {
      record.encodedDataLength = params.encodedDataLength;
    } else {
      record.failed = true;
      record.errorText = params.errorText;
    }
    state.inflight.delete(recordKey);
    for (const waiter of state.responseWaiters) {
      if (!requestMatches(waiter.filter, record)) continue;
      clearTimeout(waiter.timer);
      state.responseWaiters.delete(waiter);
      waiter.resolve(requestSummary(record));
    }
  }
}

function normalizeFilter(filter) {
  return typeof filter === "string" ? { url: filter } : filter || {};
}

function urlMatches(pattern, url) {
  const text = String(pattern);
  if (!text.includes("*")) return url.includes(text);
  return new RegExp(`^${text.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*+/g, ".*")}$`).test(url);
}

function requestMatches(filter, record) {
  if (filter.method && record.request.method !== String(filter.method).toUpperCase()) return false;
  if (filter.status && record.response?.status !== Number(filter.status)) return false;
  if (filter.type && String(record.type).toLowerCase() !== String(filter.type).toLowerCase()) return false;
  if (filter.url && !urlMatches(filter.url, record.request.url)) return false;
  return true;
}

function requestSummary(record) {
  return {
    id: record.id,
    method: record.request.method,
    url: stripQuery(record.request.url),
    status: record.response?.status ?? null,
    ok: record.response ? record.response.status >= 200 && record.response.status < 400 : null,
    type: record.type,
    mimeType: record.response?.mimeType ?? null,
    sizeBytes: record.encodedDataLength ?? null,
    durationMs: record.durationMs ?? null,
    fromCache: Boolean(record.response?.fromDiskCache || record.response?.fromServiceWorker),
    failed: record.failed,
    ...(record.errorText ? { errorText: record.errorText } : {})
  };
}

function networkLogs(state, options) {
  const filter = { method: options.method ?? options.filterMethod, status: options.status, type: options.type, url: options.url };
  const path = options.path ?? options.filterPath;
  const requests = [...state.requests.values()].filter(record => requestMatches(filter, record)
    && (!path || safePath(record.request.url).includes(path))
    && (options.failed === undefined || record.failed === Boolean(options.failed))
    && (!options.since || Number(record.id) > Number(options.since)));
  const limit = clamp(options.limit ?? 100, 1, 500);
  return { count: Math.min(requests.length, limit), total: requests.length, requests: requests.slice(-limit).map(requestSummary) };
}

async function inspectNetworkRequest(tabId, id, options) {
  const state = stateFor(tabId);
  const record = [...state.requests.values()].find(item => item.id === String(id));
  if (!record) throw new Error(`Network request not found: ${id}. List requests with browser.networkLogs().`);
  const maxBytes = clamp(options.maxBytes ?? 20000, 0, 2000000);
  const sessionId = record.sessionId || undefined;
  let body;
  try {
    const response = await command(tabId, "Network.getResponseBody", { requestId: record.requestId }, sessionId);
    body = response.base64Encoded
      ? { base64: response.body.slice(0, Math.ceil(maxBytes * 4 / 3)), bytes: Math.floor(response.body.length * 3 / 4), truncated: response.body.length > Math.ceil(maxBytes * 4 / 3) }
      : { text: response.body.slice(0, maxBytes), length: response.body.length, truncated: response.body.length > maxBytes };
  } catch (error) {
    body = { error: error.message };
  }
  let postData = record.request.postData;
  if (!postData && record.request.hasPostData) {
    postData = (await command(tabId, "Network.getRequestPostData", { requestId: record.requestId }, sessionId).catch(() => null))?.postData;
  }
  const response = record.response;
  return {
    ...requestSummary(record),
    request: { url: record.request.url, method: record.request.method, headers: record.request.headers, postData: postData?.slice(0, maxBytes) ?? null },
    response: response ? {
      status: response.status, statusText: response.statusText, headers: response.headers, mimeType: response.mimeType,
      protocol: response.protocol, remoteAddress: response.remoteIPAddress ? `${response.remoteIPAddress}:${response.remotePort}` : null
    } : null,
    body
  };
}

async function waitForNetworkIdle(state, options) {
  const idleMs = clamp(options.idleMs ?? 500, 100, 10000);
  const timeout = clamp(options.timeout ?? 15000, 500, 300000);
  const deadline = Date.now() + timeout;
  let quietSince = Date.now();
  for (;;) {
    const now = Date.now();
    const pending = [...state.inflight.values()].filter(started => now - started < 30000).length;
    if (pending) quietSince = now;
    if (now - quietSince >= idleMs) return { ok: true, idleMs };
    if (now >= deadline) throw new Error(`The network did not become idle within ${timeout} ms (${pending} requests in flight).`);
    await sleep(100);
  }
}

function publicRoute(route) {
  const { hits, id, action, url, method, resourceType, times } = route;
  return { id, action, url: url ?? "*", method: method ?? null, resourceType: resourceType ?? null, times: times ?? null, hits };
}

async function updateFetch(tabId, sessions) {
  const state = stateFor(tabId);
  const enabled = state.routes.length > 0 || state.credentials !== null;
  await Promise.all((sessions ?? sessionIds(state)).map(sessionId => (enabled
    ? command(tabId, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }], handleAuthRequests: state.credentials !== null }, sessionId || undefined)
    : command(tabId, "Fetch.disable", {}, sessionId || undefined)).catch(() => {})));
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function handleRequestPaused(tabId, sessionId, params) {
  const state = stateFor(tabId);
  const session = sessionId || undefined;
  const { request, requestId } = params;
  const route = state.routes.find(item => (!item.url || urlMatches(item.url, request.url))
    && (!item.method || item.method === request.method)
    && (!item.resourceType || String(item.resourceType).toLowerCase() === String(params.resourceType).toLowerCase()));
  try {
    if (!route) {
      await command(tabId, "Fetch.continueRequest", { requestId }, session);
      return;
    }
    route.hits++;
    if (route.times && route.hits >= route.times) state.routes = state.routes.filter(item => item !== route);
    if (route.action === "block") {
      await command(tabId, "Fetch.failRequest", { requestId, errorReason: route.errorReason || "BlockedByClient" }, session);
    } else if (route.action === "fulfill") {
      const hasJson = route.json !== undefined;
      const headers = { "content-type": route.contentType || (hasJson ? "application/json" : "text/plain; charset=utf-8"), ...route.headers };
      await command(tabId, "Fetch.fulfillRequest", {
        requestId,
        responseCode: Number(route.status) || 200,
        responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })),
        body: route.bodyBase64 ?? toBase64(hasJson ? JSON.stringify(route.json) : route.body ?? "")
      }, session);
    } else {
      const overrides = { requestId };
      if (route.setUrl) overrides.url = route.setUrl;
      if (route.setMethod) overrides.method = String(route.setMethod).toUpperCase();
      if (route.setPostData !== undefined) overrides.postData = toBase64(typeof route.setPostData === "string" ? route.setPostData : JSON.stringify(route.setPostData));
      if (route.setHeaders) {
        overrides.headers = Object.entries({ ...request.headers, ...route.setHeaders })
          .filter(([, value]) => value !== null)
          .map(([name, value]) => ({ name, value: String(value) }));
      }
      await command(tabId, "Fetch.continueRequest", overrides, session);
    }
  } catch {
    await command(tabId, "Fetch.continueRequest", { requestId }, session).catch(() => {});
  }
  if (route && !state.routes.length && !state.credentials) await updateFetch(tabId).catch(() => {});
}

async function handleAuthRequired(tabId, sessionId, params) {
  const state = stateFor(tabId);
  const origin = params.authChallenge?.origin || params.request.url;
  const attempts = (state.authAttempts.get(origin) || 0) + 1;
  state.authAttempts.set(origin, attempts);
  const response = !state.credentials ? { response: "Default" }
    : attempts > 2 ? { response: "CancelAuth" }
    : { response: "ProvideCredentials", username: state.credentials.username, password: state.credentials.password };
  await command(tabId, "Fetch.continueWithAuth", { requestId: params.requestId, authChallengeResponse: response }, sessionId || undefined);
}

async function readCookies(tabId, options) {
  const urls = options.urls ?? (options.url ? [options.url] : undefined);
  const { cookies } = await command(tabId, "Network.getCookies", urls ? { urls } : {});
  return cookies.filter(cookie => (!options.name || cookie.name === options.name) && (!options.domain || cookie.domain.replace(/^\./, "").endsWith(String(options.domain).replace(/^\./, ""))));
}

function publicCookie(cookie) {
  return {
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
    expires: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : "session",
    httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite ?? null
  };
}

const permissionTypes = {
  geolocation: "location", location: "location", camera: "camera", microphone: "microphone", notifications: "notifications",
  popups: "popups", downloads: "automaticDownloads", automaticDownloads: "automaticDownloads", clipboard: "clipboard",
  images: "images", javascript: "javascript", cookies: "cookies"
};

async function setPermission(tabId, name, setting, origin) {
  const type = permissionTypes[name];
  if (!type || !chrome.contentSettings?.[type]) throw new Error(`Unknown permission "${name}". Use one of: ${Object.keys(permissionTypes).join(", ")}.`);
  if (setting === "default") {
    await chrome.contentSettings[type].clear({});
    return { ok: true, permission: name, setting, note: "Cleared every rule Avi set for this permission." };
  }
  if (!["allow", "block", "ask", "session_only"].includes(setting)) throw new Error('Permission setting must be "allow", "block", "ask", "session_only" or "default".');
  const url = new URL(origin || (await chrome.tabs.get(tabId)).url);
  const primaryPattern = url.protocol === "file:" ? "file:///*" : `${url.protocol}//${url.hostname}/*`;
  await chrome.contentSettings[type].set({ primaryPattern, setting });
  return { ok: true, permission: name, setting, pattern: primaryPattern, note: "Reload the page if it already requested this permission." };
}

function emulationState(emulation) {
  return {
    mode: emulation.mode, viewport: emulation.viewport, touch: emulation.touch, colorScheme: emulation.colorScheme,
    media: emulation.media || null, features: emulation.features, userAgent: emulation.userAgent, locale: emulation.locale || null,
    timezone: emulation.timezone || null, geolocation: emulation.geolocation, cpuThrottling: emulation.cpu, network: emulation.network
  };
}

async function applyMetrics(tabId) {
  const emulation = stateFor(tabId).emulation;
  if (emulation.viewport) await command(tabId, "Emulation.setDeviceMetricsOverride", emulation.viewport);
  else await command(tabId, "Emulation.clearDeviceMetricsOverride");
  await command(tabId, "Emulation.setTouchEmulationEnabled", emulation.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}

async function applyMedia(tabId) {
  const emulation = stateFor(tabId).emulation;
  const features = { ...emulation.features, ...(emulation.colorScheme !== "default" ? { "prefers-color-scheme": emulation.colorScheme } : {}) };
  await command(tabId, "Emulation.setEmulatedMedia", { media: emulation.media || "", features: Object.entries(features).map(([name, value]) => ({ name, value: String(value) })) });
}

function userAgentParams(emulation) {
  return {
    userAgent: emulation.userAgent || emulation.originalUserAgent || navigator.userAgent,
    ...(emulation.platform ? { platform: emulation.platform } : {}),
    ...(emulation.acceptLanguage ? { acceptLanguage: emulation.acceptLanguage } : {}),
    ...(emulation.userAgent && emulation.userAgentMetadata ? { userAgentMetadata: emulation.userAgentMetadata } : {})
  };
}

async function rememberUserAgent(tabId) {
  const emulation = stateFor(tabId).emulation;
  if (emulation.originalUserAgent) return;
  emulation.originalUserAgent = (await command(tabId, "Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true })).result?.value || navigator.userAgent;
}

function mobileUserAgent(kind) {
  const major = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] || "140";
  const model = kind === "tablet" ? "Pixel Tablet" : "Pixel 8";
  return {
    userAgent: `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 ${kind === "tablet" ? "" : "Mobile "}Safari/537.36`,
    metadata: { brands: navigator.userAgentData?.brands || [], platform: "Android", platformVersion: "14.0.0", architecture: "", model, mobile: kind !== "tablet" }
  };
}

async function setEmulationMode(tabId, mode) {
  const emulation = stateFor(tabId).emulation;
  const presets = {
    mobile: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
    tablet: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true }
  };
  await rememberUserAgent(tabId);
  if (presets[mode]) {
    emulation.mode = mode;
    emulation.viewport = presets[mode];
    emulation.touch = true;
    if (emulation.uaSource !== "user") {
      const agent = mobileUserAgent(mode);
      Object.assign(emulation, { userAgent: agent.userAgent, userAgentMetadata: agent.metadata, platform: "Linux armv8l", uaSource: "emulation" });
    }
  } else {
    emulation.mode = "none";
    emulation.viewport = null;
    emulation.touch = false;
    if (emulation.uaSource === "emulation") Object.assign(emulation, { userAgent: null, userAgentMetadata: undefined, platform: undefined, uaSource: null });
  }
  await applyMetrics(tabId);
  await allSessions(tabId, "Emulation.setUserAgentOverride", userAgentParams(emulation));
  return emulationState(emulation);
}

async function resetEmulation(tabId) {
  const state = stateFor(tabId);
  const hadUserAgent = Boolean(state.emulation.userAgent || state.emulation.acceptLanguage);
  state.emulation = defaultEmulation(state.emulation);
  await Promise.all([
    applyMetrics(tabId),
    applyMedia(tabId),
    hadUserAgent ? allSessions(tabId, "Emulation.setUserAgentOverride", userAgentParams(state.emulation)) : null,
    allSessions(tabId, "Emulation.setLocaleOverride", {}),
    allSessions(tabId, "Emulation.setTimezoneOverride", { timezoneId: "" }),
    allSessions(tabId, "Emulation.clearGeolocationOverride", {}),
    command(tabId, "Emulation.setCPUThrottlingRate", { rate: 1 }),
    allSessions(tabId, "Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    allSessions(tabId, "Network.setExtraHTTPHeaders", { headers: {} }),
    allSessions(tabId, "Network.setCacheDisabled", { cacheDisabled: false })
  ].map(task => Promise.resolve(task).catch(() => {})));
  return emulationState(state.emulation);
}

async function replayEmulation(tabId, sessionId) {
  const state = stateFor(tabId);
  const emulation = state.emulation;
  const run = (method, params) => command(tabId, method, params, sessionId);
  const tasks = [];
  if (emulation.userAgent || emulation.acceptLanguage) tasks.push(run("Emulation.setUserAgentOverride", userAgentParams(emulation)));
  if (emulation.locale) tasks.push(run("Emulation.setLocaleOverride", { locale: emulation.locale }));
  if (emulation.timezone) tasks.push(run("Emulation.setTimezoneOverride", { timezoneId: emulation.timezone }));
  if (emulation.geolocation) tasks.push(run("Emulation.setGeolocationOverride", emulation.geolocation));
  if (emulation.network) tasks.push(run("Network.emulateNetworkConditions", emulation.network));
  if (Object.keys(emulation.headers).length) tasks.push(run("Network.setExtraHTTPHeaders", { headers: emulation.headers }));
  if (emulation.cacheDisabled) tasks.push(run("Network.setCacheDisabled", { cacheDisabled: true }));
  if (state.routes.length || state.credentials) tasks.push(updateFetch(tabId, [sessionId || ""]));
  if (!sessionId) {
    if (emulation.viewport || emulation.touch) tasks.push(applyMetrics(tabId));
    if (emulation.media || emulation.colorScheme !== "default" || Object.keys(emulation.features).length) tasks.push(applyMedia(tabId));
    if (emulation.cpu !== 1) tasks.push(run("Emulation.setCPUThrottlingRate", { rate: emulation.cpu }));
  }
  await Promise.all(tasks.map(task => task.catch(() => {})));
}

function networkConditions(conditions) {
  const presets = {
    offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
    slow3g: { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
    fast3g: { offline: false, latency: 563, downloadThroughput: 180000, uploadThroughput: 84375 }
  };
  if (!conditions || conditions === "none") return null;
  if (typeof conditions === "string") {
    if (!presets[conditions]) throw new Error('Network preset must be "offline", "slow3g", "fast3g" or "none".');
    return presets[conditions];
  }
  return {
    offline: Boolean(conditions.offline),
    latency: Number(conditions.latency) || 0,
    downloadThroughput: conditions.downloadKbps ? conditions.downloadKbps * 125 : -1,
    uploadThroughput: conditions.uploadKbps ? conditions.uploadKbps * 125 : -1
  };
}

function downloadSummary(item) {
  return {
    id: item.id,
    url: stripQuery(item.finalUrl || item.url),
    filename: item.filename || null,
    mime: item.mime || null,
    state: item.state,
    bytesReceived: item.bytesReceived,
    totalBytes: item.totalBytes,
    error: item.error ?? null,
    danger: ["safe", "accepted"].includes(item.danger) ? null : item.danger,
    startTime: item.startTime,
    endTime: item.endTime ?? null,
    exists: item.exists
  };
}

function trackDownloads(timeout, accept) {
  return new Promise((resolve, reject) => {
    const ids = new Set();
    const finish = (error, value) => {
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(created);
      chrome.downloads.onChanged.removeListener(changed);
      error ? reject(error) : resolve(value);
    };
    const settle = async id => {
      const [item] = await chrome.downloads.search({ id });
      if (!item) return;
      if (item.state !== "in_progress") finish(null, downloadSummary(item));
      else if (!["safe", "accepted"].includes(item.danger)) finish(null, { ...downloadSummary(item), note: "Chrome is waiting for the user to keep or discard this file." });
    };
    const created = item => {
      if (accept(item)) {
        ids.add(item.id);
        settle(item.id);
      }
    };
    const changed = delta => {
      if (ids.has(delta.id) && (delta.state || delta.danger)) settle(delta.id);
    };
    const timer = setTimeout(() => finish(new Error(`No download finished within ${timeout} ms. Check browser.downloads() for in-progress items.`)), timeout);
    chrome.downloads.onCreated.addListener(created);
    chrome.downloads.onChanged.addListener(changed);
    accept.track?.(ids, settle);
  });
}

function waitForDownload(options) {
  const timeout = clamp(options.timeout ?? 30000, 500, 600000);
  return trackDownloads(timeout, item => !options.url || urlMatches(options.url, item.finalUrl || item.url));
}

function awaitDownload(id, timeout) {
  const accept = item => item.id === id;
  accept.track = (ids, settle) => {
    ids.add(id);
    settle(id);
  };
  return trackDownloads(timeout, accept);
}

async function clipboard(op, text) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "clipboard", op, text });
  if (!response) throw new Error("The clipboard helper did not answer. Reload the Avi extension.");
  if (response.error) throw new Error(response.error);
  return response;
}

async function manageTab({ action, tabId, url, active, bypassCache, newWindow, timeoutMs = 30000 }) {
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : null;
  if (action !== "open" && !tab) throw new Error("tab_id is required for this action.");
  let target = tab;
  if (action === "open") {
    const link = normalizeUrl(url || "about:blank");
    target = newWindow
      ? (await chrome.windows.create({ url: link, focused: active !== false })).tabs[0]
      : await chrome.tabs.create({ url: link, active: active !== false, ...(tab ? { windowId: tab.windowId, openerTabId: tab.id, index: tab.index + 1 } : {}) });
  } else if (action === "navigate") {
    if (!url) throw new Error("url is required to navigate.");
    await chrome.tabs.update(tab.id, { url: normalizeUrl(url) });
  } else if (action === "reload") {
    await chrome.tabs.reload(tab.id, { bypassCache: Boolean(bypassCache) });
  } else if (action === "back" || action === "forward") {
    await attach(tab.id);
    const { currentIndex, entries } = await command(tab.id, "Page.getNavigationHistory");
    const entry = entries[currentIndex + (action === "back" ? -1 : 1)];
    if (!entry) throw new Error(`There is no ${action === "back" ? "previous" : "next"} page in this tab's history.`);
    await command(tab.id, "Page.navigateToHistoryEntry", { entryId: entry.id });
  } else if (action === "activate") {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { tab: tabInfo(await chrome.tabs.get(tab.id)) };
  } else if (action === "close") {
    await chrome.tabs.remove(tab.id);
    return { closed: true, tabId: tab.id };
  } else {
    throw new Error(`Unknown tab action "${action}". Use open, navigate, reload, back, forward, activate or close.`);
  }
  const warning = await waitForLoad(target.id, clamp(timeoutMs, 1000, 120000)).then(() => null, error => error.message);
  return { tab: tabInfo(await chrome.tabs.get(target.id)), ...(warning ? { warning } : {}) };
}

function waitForLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let seenLoading = false;
    const finish = error => {
      clearTimeout(timer);
      clearTimeout(grace);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    };
    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "loading") seenLoading = true;
      if (info.status === "complete" && seenLoading) finish();
    };
    const timer = setTimeout(() => finish(new Error(`The tab did not finish loading within ${timeoutMs} ms.`)), timeoutMs);
    const grace = setTimeout(async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) finish(new Error("The tab was closed."));
      else if (!seenLoading && tab.status === "complete") finish();
    }, 700);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === "loading") seenLoading = true; }).catch(() => {});
  });
}

function formatToolContent(tabId, value) {
  const state = stateFor(tabId);
  const images = [];
  const files = [];
  const collect = item => {
    if (!item || typeof item !== "object") return item;
    if (item.__aviBlob) {
      const blob = state.blobs.get(item.__aviBlob);
      if (!blob) return { error: "The captured data is no longer available." };
      if (blob.kind === "image") {
        images.push({ data: blob.data, mimeType: blob.mimeType });
        return { screenshot: images.length, mimeType: blob.mimeType, width: blob.width, height: blob.height, ...(item.truncated ? { truncated: true } : {}) };
      }
      const marker = `__AVI_FILE_${files.length}__`;
      files.push({ marker, name: blob.name, mimeType: blob.mimeType, data: blob.data, path: blob.path });
      return { path: marker, mimeType: blob.mimeType, bytes: Math.floor(blob.data.length * 3 / 4) };
    }
    if (Array.isArray(item)) return item.map(collect);
    return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, collect(entry)]));
  };
  const cleaned = collect(value);
  state.blobs.clear();
  const openedTabs = state.openedTabs || [];
  state.openedTabs = null;
  return { text: JSON.stringify(cleaned, null, 2), images, files, openedTabs };
}

function withTimeout(promise, timeoutMs, message) {
  const timeout = Math.min(Math.max(Number(timeoutMs) || 8000, 100), 600000);
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message || `Action timed out after ${timeout} milliseconds.`)), timeout); })
  ]).finally(() => clearTimeout(timer));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function normalizeUrl(value) { const text = String(value || "about:blank").trim(); return text === "about:blank" || /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`; }
function stripQuery(value) { try { const url = new URL(value); url.search = ""; url.hash = ""; return url.toString(); } catch { return String(value || "").split(/[?#]/, 1)[0]; } }
function safePath(value) { try { return new URL(value).pathname; } catch { return ""; } }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Math.round(Number(value) || min))); }
