importScripts("runtime.js");

const protocolVersion = 2;
const bindingName = "__chromeMcpHostCall";
const supportedUrl = /^(?:https?:|file:|about:blank$)/i;
const attachedTabs = new Set();
const tabState = new Map();
let instanceId;
const initialized = initialize();

chrome.runtime.onInstalled.addListener(() => initialized.then(ensureOffscreen));
chrome.runtime.onStartup.addListener(() => initialized.then(ensureOffscreen));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "chrome-mcp-heartbeat") ensureOffscreen();
});
chrome.tabs.onCreated.addListener(() => publishTabs());
chrome.tabs.onRemoved.addListener(tabId => {
  attachedTabs.delete(tabId);
  tabState.delete(tabId);
  publishTabs();
});
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url || change.title || change.status) publishTabs();
});
chrome.debugger.onEvent.addListener(handleDebuggerEvent);
chrome.debugger.onDetach.addListener(source => {
  attachedTabs.delete(source.tabId);
  publishTabs();
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.source === "offscreen") {
    handleOffscreenMessage(message).catch(() => {});
    return;
  }
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
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Maintain the localhost WebSocket connection to the persistent Chrome MCP daemon."
    }).catch(error => {
      if (!String(error.message).includes("Only a single offscreen")) throw error;
    });
  }
}

async function handleOffscreenMessage(message) {
  if (message.type === "connected") {
    await initialized;
    await sendHello();
  } else if (message.type === "message") {
    await handleDaemonMessage(message.payload);
  }
}

async function sendHello() {
  const tabs = await listTabs();
  send({ type: "hello", protocol: protocolVersion, instanceId, tabs });
}

async function handleDaemonMessage(message) {
  if (message.type === "ping") {
    send({ type: "pong", timestamp: message.timestamp });
    return;
  }
  if (message.type !== "request") return;
  try {
    const result = await dispatchRequest(message.method, message.params || {});
    send({ type: "response", id: message.id, result });
  } catch (error) {
    send({ type: "response", id: message.id, error: error.message || String(error) });
  }
}

async function dispatchRequest(method, params) {
  if (method === "listTabs") return listTabs();
  if (method === "runActions") return runActions(params.tabId, params.code, params.timeoutMs);
  throw new Error(`Unknown extension method: ${method}`);
}

async function listTabs() {
  return (await chrome.tabs.query({})).map(tabInfo);
}

function tabInfo(tab) {
  return { tabId: tab.id, windowId: tab.windowId, title: tab.title || "", url: tab.url || "about:blank", state: stateFor(tab.id).pendingDialog ? "user_input" : tab.status === "loading" ? "waiting" : "idle" };
}

async function publishTabs() {
  send({ type: "event", event: "tabsChanged", params: { tabs: await listTabs() } });
}

function send(payload) {
  chrome.runtime.sendMessage({ target: "offscreen", type: "send", payload }).catch(() => {});
}

async function attach(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!supportedUrl.test(tab.url || "")) {
    await publishTabs();
    throw new Error(`Chrome MCP cannot control the restricted URL ${tab.url || "in this tab"}. Select an http(s), file, or about:blank tab.`);
  }
  if (attachedTabs.has(tabId)) return;
  const restrictedFrame = /chrome-extension:\/\/|different extension|cannot access (?:contents|a .*url)/i;
  try {
    await chrome.debugger.attach({ tabId }, "1.3").catch(async error => {
      if (!restrictedFrame.test(error.message || "")) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500));
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
  await Promise.all([
    command(tabId, "Page.enable"),
    command(tabId, "Runtime.enable"),
    command(tabId, "Network.enable", { maxPostDataSize: 65536 }),
    command(tabId, "Console.enable")
  ]);
}

function command(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

function stateFor(tabId) {
  if (!tabState.has(tabId)) tabState.set(tabId, { colorScheme: "default", emulation: "none", viewport: null, pendingDialog: null, console: [], requests: new Map(), counter: 0 });
  return tabState.get(tabId);
}

function handleDebuggerEvent(source, method, params) {
  const tabId = source.tabId;
  if (!tabId) return;
  const state = stateFor(tabId);
  if (method === "Page.javascriptDialogOpening") {
    state.pendingDialog = { type: params.type, message: params.message, defaultValue: params.defaultPrompt || null, source: "native" };
    send({ type: "event", event: "tabState", params: { tabId, state: "user_input", pendingDialog: state.pendingDialog } });
    return;
  }
  if (method === "Page.javascriptDialogClosed") {
    state.pendingDialog = null;
    send({ type: "event", event: "tabState", params: { tabId, state: "idle" } });
    return;
  }
  if (method === "Runtime.bindingCalled" && params.name === bindingName) {
    handleHostCall(tabId, params.executionContextId, params.payload).catch(() => {});
    return;
  }
  if (method === "Runtime.consoleAPICalled") {
    state.console.push({ level: params.type, text: params.args.map(value => value.value ?? value.description ?? "").join(" "), timestamp: params.timestamp });
    state.console = state.console.slice(-100);
    return;
  }
  if (method === "Console.messageAdded") {
    state.console.push({ level: params.message.level, text: params.message.text, url: params.message.url, line: params.message.line });
    state.console = state.console.slice(-100);
    return;
  }
  if (method === "Network.requestWillBeSent") {
    const id = String(++state.counter);
    state.requests.set(params.requestId, { id, requestId: params.requestId, request: params.request, type: params.type, startedAt: params.timestamp, response: null, failed: false });
  } else if (method === "Network.responseReceived") {
    const record = state.requests.get(params.requestId);
    if (record) record.response = params.response;
  } else if (method === "Network.loadingFinished") {
    const record = state.requests.get(params.requestId);
    if (record) { record.finishedAt = params.timestamp; record.encodedDataLength = params.encodedDataLength; }
  } else if (method === "Network.loadingFailed") {
    const record = state.requests.get(params.requestId);
    if (record) { record.failed = true; record.errorText = params.errorText; }
  }
  if (state.requests.size > 150) state.requests.delete(state.requests.keys().next().value);
}

async function runActions(tabId, code, timeoutMs = 8000) {
  if (!Number.isInteger(tabId)) throw new Error("A concrete tab is required.");
  await attach(tabId);
  const state = stateFor(tabId);
  const snapshotOnly = /^\s*return\s+(?:await\s+)?browser\.snapshot\(\)\s*;?\s*$/.test(code);
  if (state.pendingDialog) {
    const dismissDialog = /^\s*return\s+(?:await\s+)?browser\.dismissDialog\(\)\s*;?\s*$/.test(code);
    const setDialog = /^\s*return\s+(?:await\s+)?browser\.setDialog\((.*)\)\s*;?\s*$/.exec(code);
    let dialogValue;
    if (setDialog) {
      try { dialogValue = JSON.parse(setDialog[1]); } catch {}
    }
    if (!dismissDialog && (!setDialog || (dialogValue !== true && typeof dialogValue !== "string"))) {
      return formatToolContent({ result: { ok: false, pendingDialog: state.pendingDialog, message: "A JavaScript dialog is pending. Resolve it with browser.setDialog(true), browser.setDialog(\"text\"), or browser.dismissDialog()." } });
    }
    const result = await dispatchHostMethod(tabId, dismissDialog ? "dismissDialog" : "setDialog", dismissDialog ? [] : [dialogValue]);
    await new Promise(resolve => setTimeout(resolve, 500));
    return formatToolContent({ result, postActionSnapshot: await snapshot(tabId) });
  }
  const runtime = createBrowserRuntimeScript(JSON.stringify(state.pendingDialog));
  await command(tabId, "Page.setWebLifecycleState", { state: "active" });
  await installHostBridge(tabId);
  const execution = command(tabId, "Runtime.evaluate", {
    expression: `${runtime}\nwindow.__browserMcpRun(${JSON.stringify(code)})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  const evaluated = await withTimeout(execution, timeoutMs).catch(async error => {
    if (!/context was destroyed|navigated or closed|Cannot find context/i.test(error.message || "")) throw error;
    await waitForTab(tabId);
    return { result: { value: { ok: true, navigated: true, message: "The page navigated during the action; its return value is unavailable." } } };
  });
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text || "Runtime evaluation failed.");
  let result = evaluated.result?.value;
  if (result?.type === "__browserMcpRuntimeNavigation") {
    await chrome.tabs.update(tabId, { url: normalizeUrl(result.url) });
    await waitForTab(tabId);
    result = result.result;
  }
  if (result?.type === "__browserMcpRuntimeDialog") {
    state.pendingDialog = { ...result.dialog, source: "runtime" };
    result = { ok: false, pendingDialog: result.dialog, message: "A JavaScript dialog is pending." };
  }
  const output = snapshotOnly ? { result } : { result, postActionSnapshot: state.pendingDialog ? { ok: false, message: "Post-action snapshot skipped while a JavaScript dialog is pending." } : await snapshot(tabId) };
  return formatToolContent(output);
}

async function installHostBridge(tabId) {
  await command(tabId, "Runtime.addBinding", { name: bindingName }).catch(() => {});
  await command(tabId, "Runtime.evaluate", { expression: `(() => {
    if (!window.__chromeMcpBridgeInstalled) {
      window.__chromeMcpBridgeInstalled = true;
      let nextId = 1;
      const pending = new Map();
      window.__chromeMcpHostResolve = (id, ok, value) => {
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        ok ? request.resolve(value) : request.reject(new Error(value));
      };
      window.__chromeMcpHostCallMethod = (method, args) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        window.${bindingName}(JSON.stringify({ id, method, args }));
      });
    }
    const call = window.__chromeMcpHostCallMethod;
    window.__browserMcpHost = {
      mouse: input => call("mouse", [input]),
      insertText: text => call("insertText", [text]),
      press: key => call("press", [key]),
      screenshot: () => call("screenshot", []),
      networkLogs: options => call("networkLogs", [options]),
      inspectNetworkRequest: id => call("inspectNetworkRequest", [id]),
      setColorScheme: scheme => call("setColorScheme", [scheme]),
      setDialog: value => call("setDialog", [value]),
      dismissDialog: () => call("dismissDialog", []),
      setEmulation: mode => call("setEmulation", [mode]),
      setViewport: (width, height) => call("setViewport", [width, height])
    };
  })()` });
}

async function handleHostCall(tabId, contextId, payload) {
  const request = JSON.parse(payload);
  try {
    const value = await dispatchHostMethod(tabId, request.method, request.args || []);
    await resolveHostCall(tabId, contextId, request.id, true, value);
  } catch (error) {
    await resolveHostCall(tabId, contextId, request.id, false, error.message || String(error));
  }
}

async function resolveHostCall(tabId, contextId, id, ok, value) {
  await command(tabId, "Runtime.evaluate", { expression: `window.__chromeMcpHostResolve(${JSON.stringify(id)}, ${ok}, ${JSON.stringify(value)})`, contextId, awaitPromise: false });
}

async function dispatchHostMethod(tabId, method, args) {
  const state = stateFor(tabId);
  if (method === "screenshot") {
    const { cssVisualViewport: viewport } = await command(tabId, "Page.getLayoutMetrics");
    const ratio = await command(tabId, "Runtime.evaluate", { expression: "devicePixelRatio", returnByValue: true });
    const width = Math.floor(viewport.clientWidth);
    const height = Math.floor(viewport.clientHeight);
    const shot = await command(tabId, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      clip: { x: viewport.pageX, y: viewport.pageY, width, height, scale: 1 / (ratio.result?.value || 1) }
    });
    return { __browserMcpScreenshot: true, path: `chrome-tab-${tabId}.png`, mimeType: "image/png", data: shot.data, width, height };
  }
  if (method === "mouse") return dispatchMouse(tabId, args[0] || {});
  if (method === "insertText") {
    await command(tabId, "Input.insertText", { text: String(args[0] ?? "") });
    return { ok: true };
  }
  if (method === "press") return pressKey(tabId, String(args[0] || ""));
  if (method === "networkLogs") return networkLogs(tabId, args[0] || {});
  if (method === "inspectNetworkRequest") return inspectNetworkRequest(tabId, args[0]);
  if (method === "setColorScheme") {
    const scheme = ["dark", "light"].includes(args[0]) ? args[0] : "default";
    await command(tabId, "Emulation.setEmulatedMedia", { features: scheme === "default" ? [] : [{ name: "prefers-color-scheme", value: scheme }] });
    state.colorScheme = scheme;
    return viewportState(tabId);
  }
  if (method === "setDialog" || method === "dismissDialog") {
    if (!state.pendingDialog) throw new Error("No pending JavaScript dialog.");
    const dialog = state.pendingDialog;
    if (dialog.source === "native") {
      await command(tabId, "Page.handleJavaScriptDialog", { accept: method === "setDialog", promptText: method === "setDialog" && typeof args[0] === "string" ? args[0] : undefined });
    }
    state.pendingDialog = null;
    return { ok: true, dialog, action: method === "setDialog" ? "set" : "dismiss" };
  }
  if (method === "setEmulation") {
    const mode = ["mobile", "tablet"].includes(args[0]) ? args[0] : "none";
    state.emulation = mode;
    state.viewport = mode === "mobile" ? { width: 390, height: 844 } : mode === "tablet" ? { width: 820, height: 1180 } : null;
    await applyViewport(tabId);
    return viewportState(tabId);
  }
  if (method === "setViewport") {
    const width = clamp(args[0], 280, 1600);
    const height = clamp(args[1], 360, 2200);
    if (state.emulation === "none") state.emulation = "mobile";
    state.viewport = { width, height };
    await applyViewport(tabId);
    return viewportState(tabId);
  }
  throw new Error(`Unknown host method: ${method}`);
}

async function dispatchMouse(tabId, input) {
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Pointer coordinates must be finite viewport CSS pixels.");
  const button = input.button === "right" ? "right" : "left";
  const buttons = button === "right" ? 2 : 1;
  const mouse = params => command(tabId, "Input.dispatchMouseEvent", { x, y, ...params });
  await mouse({ type: "mouseMoved", button: "none" });
  if (input.type === "scroll") {
    await mouse({ type: "mouseWheel", deltaX: 0, deltaY: Number(input.delta) || 0 });
  } else if (input.type === "click") {
    const clickCount = Math.max(1, Math.min(3, Number(input.clickCount) || 1));
    for (let count = 1; count <= clickCount; count++) {
      await mouse({ type: "mousePressed", button, buttons, clickCount: count });
      if (input.duration > 0) await new Promise(resolve => setTimeout(resolve, Math.min(Number(input.duration), 10000)));
      await mouse({ type: "mouseReleased", button, buttons: 0, clickCount: count });
    }
  } else if (input.type === "drag") {
    const toX = Number(input.toX);
    const toY = Number(input.toY);
    const duration = Math.min(Math.max(Number(input.duration) || 500, 0), 10000);
    const steps = Math.max(8, Math.ceil(duration / 25));
    await mouse({ type: "mousePressed", button, buttons, clickCount: 1 });
    for (let index = 1; index <= steps; index++) {
      await command(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", button, buttons, x: x + ((toX - x) * index / steps), y: y + ((toY - y) * index / steps) });
      await new Promise(resolve => setTimeout(resolve, duration / steps));
    }
    await command(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", button, buttons: 0, clickCount: 1, x: toX, y: toY });
  }
  return { ok: true };
}

const namedKeys = {
  Enter: { keyCode: 13, text: "\r" },
  Tab: { keyCode: 9 },
  Escape: { keyCode: 27 },
  Backspace: { keyCode: 8 },
  Delete: { keyCode: 46 },
  Space: { keyCode: 32, key: " ", text: " " },
  ArrowLeft: { keyCode: 37 },
  ArrowUp: { keyCode: 38 },
  ArrowRight: { keyCode: 39 },
  ArrowDown: { keyCode: 40 },
  Home: { keyCode: 36 },
  End: { keyCode: 35 },
  PageUp: { keyCode: 33 },
  PageDown: { keyCode: 34 }
};
const modifierBits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

async function pressKey(tabId, combo) {
  const parts = combo.split("+").map(part => part.trim()).filter(Boolean);
  const name = parts.pop();
  const modifiers = parts.reduce((mask, part) => {
    if (!modifierBits[part]) throw new Error(`Unknown modifier "${part}". Use Alt, Control, Meta or Shift.`);
    return mask | modifierBits[part];
  }, 0);
  let definition = namedKeys[name];
  if (!definition && name?.length === 1) {
    const upper = name.toUpperCase();
    definition = { keyCode: upper.charCodeAt(0), text: name, code: /[A-Z]/.test(upper) ? `Key${upper}` : /\d/.test(name) ? `Digit${name}` : undefined };
  }
  if (!definition) throw new Error(`Unknown key "${name}". Use a single character or one of: ${Object.keys(namedKeys).join(", ")}.`);
  const text = modifiers & ~modifierBits.Shift ? undefined : definition.text;
  const base = { key: definition.key || name, code: definition.code || name, windowsVirtualKeyCode: definition.keyCode, modifiers };
  await command(tabId, "Input.dispatchKeyEvent", { ...base, type: text ? "keyDown" : "rawKeyDown", text });
  await command(tabId, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  return { ok: true };
}

async function applyViewport(tabId) {
  const state = stateFor(tabId);
  if (state.emulation === "none") {
    await command(tabId, "Emulation.clearDeviceMetricsOverride");
    await command(tabId, "Emulation.setTouchEmulationEnabled", { enabled: false });
    return;
  }
  await command(tabId, "Emulation.setDeviceMetricsOverride", { ...state.viewport, deviceScaleFactor: state.emulation === "mobile" ? 3 : 2, mobile: true });
  await command(tabId, "Emulation.setTouchEmulationEnabled", { enabled: true, configuration: "mobile" });
}

function viewportState(tabId) {
  const state = stateFor(tabId);
  return { colorScheme: state.colorScheme, emulation: state.emulation, viewport: state.viewport };
}

function networkLogs(tabId, options) {
  const method = String(options.filterMethod || "").toUpperCase();
  const pathFilter = String(options.filterPath || "");
  const requests = [...stateFor(tabId).requests.values()].map(record => ({
    id: record.id,
    method: record.request.method,
    path: safePath(record.request.url),
    status: record.response?.status ?? null,
    ok: record.response ? record.response.status >= 200 && record.response.status < 400 : null,
    type: record.type,
    mimeType: record.response?.mimeType ?? null,
    sizeBytes: record.encodedDataLength ?? null,
    fromCache: Boolean(record.response?.fromDiskCache || record.response?.fromServiceWorker),
    failed: record.failed,
    url: stripQuery(record.request.url)
  })).filter(record => (!method || record.method === method) && (!pathFilter || record.path.includes(pathFilter))).slice(-100);
  return { count: requests.length, requests };
}

async function inspectNetworkRequest(tabId, id) {
  const record = [...stateFor(tabId).requests.values()].find(item => item.id === String(id));
  if (!record) throw new Error(`Network request not found: ${id}`);
  let body = null;
  try {
    const response = await command(tabId, "Network.getResponseBody", { requestId: record.requestId });
    body = response.base64Encoded ? { base64: response.body } : { text: response.body.slice(0, 12000) };
  } catch (error) {
    body = { error: error.message };
  }
  return { ok: true, request: record.request, response: record.response, failed: record.failed, errorText: record.errorText || null, body };
}

async function snapshot(tabId) {
  const evaluated = await command(tabId, "Runtime.evaluate", { expression: `${createBrowserRuntimeScript(JSON.stringify(stateFor(tabId).pendingDialog))}\nwindow.__browserMcp.snapshot()`, returnByValue: true });
  return evaluated.result?.value;
}

async function waitForTab(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(reject, new Error("Tab navigation timed out.")), timeoutMs);
    const listener = (updatedId, info) => { if (updatedId === tabId && info.status === "complete") finish(resolve); };
    const finish = (callback, value) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); callback(value); };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function formatToolContent(value) {
  const images = [];
  const cleaned = collectScreenshots(value, images);
  return { text: JSON.stringify(cleaned, null, 2), images };
}

function collectScreenshots(value, images) {
  if (!value || typeof value !== "object") return value;
  if (value.__browserMcpScreenshot && value.data) {
    images.push({ data: value.data, mimeType: value.mimeType || "image/png" });
    return { path: value.path || "screenshot.png", mimeType: value.mimeType || "image/png" };
  }
  if (Array.isArray(value)) return value.map(item => collectScreenshots(item, images));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, collectScreenshots(item, images)]));
}

function withTimeout(promise, timeoutMs) {
  const timeout = Math.min(Math.max(Number(timeoutMs) || 8000, 100), 300000);
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Action timed out after ${timeout} milliseconds.`)), timeout))]);
}

function normalizeUrl(value) { const text = String(value || "about:blank").trim(); return text === "about:blank" || /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`; }
function stripQuery(value) { try { const url = new URL(value); url.search = ""; url.hash = ""; return url.toString(); } catch { return String(value || "").split(/[?#]/, 1)[0]; } }
function safePath(value) { try { return new URL(value).pathname; } catch { return ""; } }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Math.round(Number(value) || min))); }
