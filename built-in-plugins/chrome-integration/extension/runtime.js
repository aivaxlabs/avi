const browserRuntimeVersion = 3;

// Serialized with toString() and evaluated inside the page, so it must stay self-contained.
function installBrowserRuntime(bindingName, version) {
  if (window.__browserMcpRuntimeVersion === version) return;
  window.__browserMcpRuntimeVersion = version;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pendingCalls = new Map();
  let nextCallId = 1;
  let offset = { x: 0, y: 0 };
  let pendingNavigation = null;

  window.__chromeMcpHostResolve = (id, ok, value) => {
    const call = pendingCalls.get(id);
    if (!call) return;
    pendingCalls.delete(id);
    ok ? call.resolve(value) : call.reject(new Error(value));
  };

  const host = (method, ...args) => new Promise((resolve, reject) => {
    const binding = window[bindingName];
    if (typeof binding !== "function") {
      reject(new Error("The Avi host bridge is unavailable in this frame. Retry the action."));
      return;
    }
    const id = nextCallId++;
    pendingCalls.set(id, { resolve, reject });
    binding(JSON.stringify({ id, method, args }));
  });

  const refs = new Map();
  const refIds = new WeakMap();
  let nextRef = 1;
  window.__browserMcpRefs = refs;

  const refFor = element => {
    let id = refIds.get(element);
    if (!id) {
      id = nextRef++;
      refIds.set(element, id);
      refs.set(id, new WeakRef(element));
      if (refs.size > 5000) refs.delete(refs.keys().next().value);
    }
    return id;
  };

  let actionChain = Promise.resolve();
  let lastActionEndedAt = 0;
  const act = action => {
    const run = async () => {
      const elapsed = Date.now() - lastActionEndedAt;
      if (elapsed < 50) await sleep(50 - elapsed);
      try {
        return await action();
      } finally {
        lastActionEndedAt = Date.now();
      }
    };
    const result = actionChain.then(run, run);
    actionChain = result.catch(() => {});
    return result;
  };

  const isFrame = element => element?.tagName === "IFRAME" || element?.tagName === "FRAME";
  const frameDocument = frame => {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  };
  const normalize = text => String(text ?? "").replace(/\s+/g, " ").trim();

  const viewportRect = element => {
    const rect = element.getBoundingClientRect();
    let x = rect.left;
    let y = rect.top;
    let view = element.ownerDocument?.defaultView;
    while (view && view !== window) {
      const frame = view.frameElement;
      if (!frame) break;
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.left + frame.clientLeft;
      y += frameRect.top + frame.clientTop;
      view = frame.ownerDocument.defaultView;
    }
    x += offset.x;
    y += offset.y;
    return { x, y, width: rect.width, height: rect.height, centerX: x + rect.width / 2, centerY: y + rect.height / 2 };
  };

  const getPointTarget = (x, y) => {
    let root = document;
    let localX = x - offset.x;
    let localY = y - offset.y;
    let target = null;
    while (root) {
      let element = root.elementFromPoint(localX, localY);
      while (element?.shadowRoot) {
        const inner = element.shadowRoot.elementFromPoint(localX, localY);
        if (!inner || inner === element) break;
        element = inner;
      }
      if (!element) break;
      target = element;
      root = isFrame(element) ? frameDocument(element) : null;
      if (root) {
        const frameRect = element.getBoundingClientRect();
        localX -= frameRect.left + element.clientLeft;
        localY -= frameRect.top + element.clientTop;
      }
    }
    return target || document.body || document.documentElement;
  };

  const deepActiveElement = () => {
    let active = document.activeElement;
    while (active) {
      const inner = active.shadowRoot?.activeElement || (isFrame(active) ? frameDocument(active)?.activeElement : null);
      if (!inner || inner === active) break;
      active = inner;
    }
    return active;
  };

  const describeElement = element => {
    if (!element?.tagName) return null;
    return {
      ref: `@${refFor(element)}`,
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      name: element.getAttribute("name") || null,
      role: element.getAttribute("role") || null,
      type: element.getAttribute("type") || null,
      ariaLabel: element.getAttribute("aria-label") || null,
      text: normalize(element.innerText || element.textContent || element.value).slice(0, 160)
    };
  };

  function* searchRoots(root) {
    yield root;
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) yield* searchRoots(element.shadowRoot);
      if (isFrame(element)) {
        const inner = frameDocument(element);
        if (inner) yield* searchRoots(inner);
      }
    }
  }

  const isVisible = element => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const queryAll = selector => {
    if (selector?.nodeType === 1) return [selector];
    const text = String(selector);
    const ref = /^@(\d+)$/.exec(text);
    if (ref) {
      const element = refs.get(Number(ref[1]))?.deref();
      return element?.isConnected ? [element] : [];
    }
    const textQuery = /^text=(?:"(.*)"|(.*))$/s.exec(text);
    if (!textQuery) return [...searchRoots(document)].flatMap(root => [...root.querySelectorAll(text)]);
    const exact = textQuery[1] !== undefined;
    const needle = normalize(exact ? textQuery[1] : textQuery[2]).toLowerCase();
    const results = [];
    for (const root of searchRoots(document)) {
      const matches = [...root.querySelectorAll("*")].filter(element => {
        if (/^(SCRIPT|STYLE|NOSCRIPT|HTML|BODY|HEAD)$/.test(element.tagName) || !isVisible(element)) return false;
        const value = normalize(element.innerText || element.value || element.getAttribute("aria-label")).toLowerCase();
        return exact ? value === needle : value.includes(needle);
      });
      results.push(...matches.filter((element, index) => !matches[index + 1] || !element.contains(matches[index + 1])));
    }
    return results;
  };

  const resolveElement = target => {
    const element = queryAll(target)[0];
    if (!element) throw new Error(`No element matches ${JSON.stringify(String(target))}. Take a snapshot and use an observed @ref or selector.`);
    return element;
  };

  const resolveTarget = target => {
    if (target && typeof target === "object" && target.nodeType !== 1 && Number.isFinite(Number(target.x)) && Number.isFinite(Number(target.y))) {
      const x = Number(target.x);
      const y = Number(target.y);
      return { x, y, element: getPointTarget(x, y) };
    }
    const element = resolveElement(target);
    let rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > view.innerHeight || rect.left > view.innerWidth) {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    }
    rect = viewportRect(element);
    if (rect.width <= 0 || rect.height <= 0) throw new Error(`The element ${JSON.stringify(String(target))} has no visible box.`);
    const resolved = { x: rect.centerX, y: rect.centerY, element };
    const hit = getPointTarget(resolved.x, resolved.y);
    if (hit && hit !== element && !element.contains(hit) && !hit.contains(element) && hit.control !== element) resolved.coveredBy = hit;
    return resolved;
  };

  const ensureOverlay = () => {
    let overlay = document.getElementById("__browserMcpOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "__browserMcpOverlay";
    overlay.append(document.createElement("div"), document.createElement("div"));
    Object.assign(overlay.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
    Object.assign(overlay.firstChild.style, {
      position: "absolute", width: "18px", height: "18px", border: "2px solid #0ea5e9", borderRadius: "50%",
      boxShadow: "0 0 0 4px rgba(14, 165, 233, 0.22)", transform: "translate(-50%, -50%)", opacity: "0", transition: "opacity 120ms ease"
    });
    Object.assign(overlay.lastChild.style, {
      position: "absolute", padding: "4px 7px", borderRadius: "6px", background: "rgba(15, 23, 42, 0.92)", color: "white",
      font: "12px/1.3 system-ui, sans-serif", transform: "translate(10px, 10px)", opacity: "0", transition: "opacity 120ms ease"
    });
    document.documentElement.appendChild(overlay);
    return overlay;
  };

  const showInteraction = (x, y, labelText) => {
    try {
      const overlay = ensureOverlay();
      for (const part of overlay.children) {
        part.style.left = `${x - offset.x}px`;
        part.style.top = `${y - offset.y}px`;
        part.style.opacity = "1";
      }
      overlay.lastChild.textContent = labelText;
      clearTimeout(window.__browserMcpOverlayTimer);
      window.__browserMcpOverlayTimer = setTimeout(() => {
        for (const part of overlay.children) part.style.opacity = "0";
      }, 800);
    } catch {}
  };

  const pointer = async (label, target, input) => {
    const resolved = resolveTarget(target);
    showInteraction(resolved.x, resolved.y, label);
    await host("mouse", { ...input, x: resolved.x, y: resolved.y });
    return {
      ok: true,
      target: describeElement(resolved.element),
      ...(resolved.coveredBy ? { coveredBy: describeElement(resolved.coveredBy) } : {})
    };
  };

  const points = args => typeof args[0] === "number" ? [{ x: args[0], y: args[1] }, ...args.slice(2)] : args;

  const setNativeValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter ? setter.call(element, value) : (element.value = value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const isEditable = element => {
    const tag = element?.tagName;
    return tag === "TEXTAREA" || element?.isContentEditable ||
      (tag === "INPUT" && !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(element.type));
  };

  const elementValue = element => {
    if (element.tagName === "SELECT") return [...element.selectedOptions].map(option => option.label).join(", ");
    if (element.tagName === "INPUT" && element.type === "password") return element.value ? "••••" : "";
    return element.value;
  };

  const snapshotSelector = "a, button, input, textarea, select, iframe, frame, [role], h1, h2, h3, label, summary, [onclick], [tabindex], [contenteditable='true']";

  const snapshot = async (options = {}) => {
    const full = Boolean(options.full);
    const maxNodes = Math.min(Math.max(Number(options.maxNodes) || (full ? 500 : 160), 1), 2000);
    const maxText = Math.min(Math.max(Number(options.maxText ?? 4000), 0), 50000);
    const scope = options.selector ? resolveElement(options.selector) : document;
    const status = await host("status").catch(() => null);
    const scrolling = document.scrollingElement || document.documentElement;
    const lines = [
      `URL: ${location.href}`,
      `Title: ${document.title}`,
      `Viewport: ${innerWidth}x${innerHeight} scroll=${Math.round(scrollX)},${Math.round(scrollY)} page=${scrolling.scrollWidth}x${scrolling.scrollHeight}`,
      ...(status ? [
        `Console since load: errors=${status.errors} warnings=${status.warnings}${status.latest ? ` latest=${status.latest}` : ""}`,
        ...(status.lastDialog ? [`Last handled dialog: ${JSON.stringify(status.lastDialog)}`] : []),
        ...(status.frames?.length ? [
          "Cross-origin frames (pass frame_id to chrome_run_actions to script inside):",
          ...status.frames.map(frame => `  ${frame.frame_id} ${frame.rect ? `${frame.rect.x},${frame.rect.y} ${frame.rect.width}x${frame.rect.height}` : "hidden"} ${frame.url}`)
        ] : [])
      ] : []),
      ""
    ];
    const texts = [];
    let shown = 0;
    let skipped = 0;
    const collect = (root, depth) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) collect(element.shadowRoot, depth);
        if (!element.matches(snapshotSelector)) continue;
        const rect = viewportRect(element);
        const style = element.ownerDocument.defaultView.getComputedStyle(element);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") continue;
        const offscreen = rect.y + rect.height < 0 || rect.x + rect.width < 0 || rect.y > innerHeight || rect.x > innerWidth;
        if (offscreen && !full) continue;
        if (shown >= maxNodes) {
          skipped++;
          continue;
        }
        shown++;
        const inner = isFrame(element) ? frameDocument(element) : null;
        const attributes = [
          element.tagName.toLowerCase(),
          element.id ? `#${element.id}` : "",
          ...["role", "name", "type"].map(name => element.getAttribute(name) ? `[${name}=${element.getAttribute(name)}]` : ""),
          element.disabled || element.getAttribute("aria-disabled") === "true" ? "[disabled]" : "",
          element.checked || element.getAttribute("aria-checked") === "true" ? "[checked]" : "",
          element.getAttribute("aria-selected") === "true" ? "[selected]" : "",
          element.getAttribute("aria-expanded") ? `[expanded=${element.getAttribute("aria-expanded")}]` : ""
        ].join("");
        const label = isFrame(element)
          ? element.getAttribute("title") || element.src || ""
          : normalize(element.getAttribute("aria-label") || element.innerText || element.getAttribute("placeholder") || element.textContent).slice(0, 200);
        const value = /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) && elementValue(element) ? ` value="${normalize(elementValue(element)).slice(0, 80)}"` : "";
        const note = isFrame(element) ? inner ? " (frame)" : " (cross-origin frame: script it with the frame_id listed under Frames)" : "";
        lines.push(`${"  ".repeat(depth)}@${refFor(element)} ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)} ${attributes}${label ? ` "${label}"` : ""}${value}${offscreen ? " offscreen" : ""}${note}`);
        if (inner?.documentElement) {
          collect(inner, depth + 1);
          const text = normalize(inner.body?.innerText);
          if (text) texts.push(text);
        }
      }
    };
    collect(scope, 0);
    if (skipped) lines.push(`... ${skipped} more elements. Use snapshot({ full: true, maxNodes }) or snapshot({ selector }) to see them.`);
    const text = normalize([scope.body?.innerText ?? scope.innerText ?? "", ...texts].join(" "));
    if (text && maxText) lines.push("", `Text${text.length > maxText ? ` (first ${maxText} of ${text.length} characters)` : ""}: ${text.slice(0, maxText)}`);
    return lines.join("\n");
  };

  const serialize = (value, depth = 0) => {
    if (value?.nodeType === 1) return describeElement(value);
    if (value instanceof NodeList || value instanceof HTMLCollection) value = [...value];
    if (Array.isArray(value)) return depth > 6 ? "[Array]" : value.map(item => serialize(item, depth + 1));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return depth > 6 ? "[Object]" : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item, depth + 1)]));
    }
    return value;
  };

  const browser = {
    navigate: url => {
      pendingNavigation = String(url);
      return { ok: true, url: pendingNavigation };
    },

    click: (...args) => {
      const [target, options = {}] = points(args);
      return act(() => pointer(options.clickCount === 2 ? "double click" : "click", target, {
        type: "click", button: options.button || "left", clickCount: options.clickCount || 1, duration: options.duration || 0
      }));
    },
    doubleClick: (...args) => browser.click(points(args)[0], { clickCount: 2 }),
    rightClick: (...args) => {
      const [target, duration] = points(args);
      return browser.click(target, { button: "right", duration: typeof duration === "number" ? duration : duration?.duration });
    },
    leftClick: (x, y, duration = 0) => browser.click({ x, y }, { duration }),
    hover: (...args) => act(() => pointer("hover", points(args)[0], { type: "move" })),
    scroll: (...args) => {
      const [target, options] = typeof args[0] === "number" ? [{ x: args[0], y: args[1] }, { deltaY: args[2] }] : args;
      return act(() => pointer("scroll", target ?? { x: innerWidth / 2, y: innerHeight / 2 }, {
        type: "scroll", deltaX: Number(options?.deltaX) || 0, deltaY: Number(options?.deltaY ?? 400) || 0
      }));
    },
    drag: (...args) => {
      const [from, to, options = {}] = typeof args[0] === "number"
        ? [{ x: args[0], y: args[1] }, { x: args[2], y: args[3] }, { duration: args[4], button: args[5] === false ? "right" : "left" }]
        : args;
      return act(async () => {
        const start = resolveTarget(from);
        const end = resolveTarget(to);
        showInteraction(start.x, start.y, "drag");
        const result = await host("mouse", { type: "drag", x: start.x, y: start.y, toX: end.x, toY: end.y, duration: options.duration ?? 500, button: options.button || "left" });
        showInteraction(end.x, end.y, "drop");
        return { ...result, source: describeElement(start.element), target: describeElement(end.element) };
      });
    },
    tap: (target, options = {}) => act(async () => {
      const resolved = resolveTarget(target);
      showInteraction(resolved.x, resolved.y, "tap");
      await host("touch", { type: "tap", x: resolved.x, y: resolved.y, duration: options.duration || 0 });
      return { ok: true, target: describeElement(resolved.element) };
    }),
    swipe: (from, to, options = {}) => act(async () => {
      const start = resolveTarget(from);
      const end = resolveTarget(to);
      showInteraction(start.x, start.y, "swipe");
      await host("touch", { type: "swipe", x: start.x, y: start.y, toX: end.x, toY: end.y, duration: options.duration ?? 300 });
      return { ok: true };
    }),

    type: (text, options = {}) => act(async () => {
      const active = deepActiveElement();
      if (!isEditable(active) && !isFrame(active)) {
        throw new Error(`Focused element is not editable: ${active?.tagName?.toLowerCase() || "none"}. Click the field first or use browser.fill(target, text).`);
      }
      await host(options.keys ? "typeKeys" : "insertText", String(text), options.delay || 0);
      return { ok: true, target: describeElement(active) };
    }),
    fill: (target, value, options = {}) => act(async () => {
      const resolved = resolveTarget(target);
      const element = resolved.element.control ?? resolved.element;
      const text = String(value ?? "");
      if (element.tagName === "SELECT") throw new Error("Use browser.select(target, values) for <select> elements.");
      if (element.tagName === "INPUT" && /^(date|time|datetime-local|month|week|color|range)$/i.test(element.type)) {
        setNativeValue(element, text);
        return { ok: true, target: describeElement(element), value: element.value };
      }
      await host("mouse", { type: "click", x: resolved.x, y: resolved.y, button: "left", clickCount: 1 });
      const active = deepActiveElement();
      if (!isEditable(active)) throw new Error(`The click focused a non-editable element (${active?.tagName?.toLowerCase() || "none"}).`);
      if (typeof active.select === "function") {
        active.select();
      } else {
        const range = active.ownerDocument.createRange();
        range.selectNodeContents(active);
        const selection = active.ownerDocument.defaultView.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (text) await host(options.keys ? "typeKeys" : "insertText", text, options.delay || 0);
      else await host("key", "Delete", "press");
      return { ok: true, target: describeElement(active), value: active.value ?? normalize(active.innerText) };
    }),
    press: combo => act(async () => ({ ...(await host("key", String(combo), "press")), target: describeElement(deepActiveElement()) })),
    keyDown: key => act(() => host("key", String(key), "down")),
    keyUp: key => act(() => host("key", String(key), "up")),
    select: (target, values) => act(async () => {
      const element = resolveElement(target);
      if (element.tagName !== "SELECT") throw new Error("browser.select() only accepts <select> elements. Click custom dropdowns instead.");
      const wanted = [values].flat().map(String);
      const options = [...element.options];
      const chosen = wanted.map(value => options.find(option => option.value === value) || options.find(option => normalize(option.label) === normalize(value)));
      if (chosen.some(option => !option)) {
        throw new Error(`Option not found. Available: ${options.slice(0, 30).map(option => JSON.stringify(option.label)).join(", ")}`);
      }
      if (!element.multiple && chosen.length > 1) throw new Error("This <select> accepts a single value.");
      for (const option of options) option.selected = chosen.includes(option);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, selected: [...element.selectedOptions].map(option => ({ value: option.value, label: option.label })) };
    }),
    check: (target, checked = true) => act(async () => {
      const element = resolveElement(target);
      const state = () => element.checked ?? element.getAttribute("aria-checked") === "true";
      if (state() !== checked) await pointer("check", element, { type: "click", button: "left", clickCount: 1 });
      return { ok: state() === checked, checked: state(), target: describeElement(element) };
    }),
    upload: (target, files) => act(async () => {
      const paths = [files].flat().map(String);
      const element = resolveElement(target);
      const input = element.control ?? element;
      if (input.tagName === "INPUT" && input.type === "file") {
        await host("uploadRef", refFor(input), paths);
        return { ok: true, target: describeElement(input), files: [...input.files].map(file => file.name) };
      }
      await host("armFileChooser");
      await pointer("upload", element, { type: "click", button: "left", clickCount: 1 });
      return host("awaitFileChooser", paths, 5000);
    }),
    dropFiles: (target, files) => act(async () => {
      const resolved = resolveTarget(target);
      showInteraction(resolved.x, resolved.y, "drop files");
      await host("dropFiles", resolved.x, resolved.y, [files].flat().map(String));
      return { ok: true, target: describeElement(resolved.element) };
    }),

    query: selector => queryAll(selector)[0] ?? null,
    queryAll,
    rect: target => viewportRect(resolveElement(target)),
    waitFor: async (target, options = {}) => {
      const timeout = Number(options.timeout ?? 5000);
      const state = options.state || "visible";
      const deadline = Date.now() + timeout;
      for (;;) {
        if (typeof target === "function") {
          const value = await target();
          if (value) return value;
        } else {
          const elements = queryAll(target);
          const visible = elements.find(isVisible);
          if (state === "attached" && elements[0]) return describeElement(elements[0]);
          if (state === "visible" && visible) return describeElement(visible);
          if (state === "hidden" && !visible) return { ok: true, state };
          if (state === "detached" && !elements.length) return { ok: true, state };
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out after ${timeout} ms waiting for ${typeof target === "function" ? "the condition" : JSON.stringify(String(target))}${typeof target === "function" ? "" : ` to be ${state}`}.`);
        }
        await sleep(100);
      }
    },
    sleep,
    evaluate: (fn, ...args) => host("pageEval", typeof fn === "function" ? `(${fn})(...${JSON.stringify(args)})` : String(fn)),

    snapshot,
    screenshot: (options = {}) => {
      if (!options.element) return host("screenshot", options);
      const resolved = resolveTarget(options.element);
      const rect = viewportRect(resolved.element);
      return host("screenshot", { ...options, element: undefined, clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    },
    pdf: (options = {}) => host("pdf", options),
    frames: () => host("frames"),

    consoleLogs: (options = {}) => host("consoleLogs", options),
    networkLogs: (options = {}) => host("networkLogs", options),
    inspectNetworkRequest: (id, options = {}) => host("inspectNetworkRequest", id, options),
    waitForResponse: (filter, options = {}) => host("waitForResponse", filter, options),
    waitForNetworkIdle: (options = {}) => host("waitForNetworkIdle", options),
    route: rule => host("route", rule),
    unroute: id => host("unroute", id),
    setExtraHeaders: headers => host("setExtraHeaders", headers),
    setNetworkConditions: conditions => host("setNetworkConditions", conditions),
    setCacheDisabled: disabled => host("setCacheDisabled", disabled),
    setHttpCredentials: credentials => host("setHttpCredentials", credentials),

    cookies: (options = {}) => host("cookies", options),
    setCookies: cookies => host("setCookies", cookies),
    clearCookies: (options = {}) => host("clearCookies", options),
    clearStorage: (options = {}) => host("clearStorage", options),
    setPermission: (name, setting, origin) => host("setPermission", name, setting, origin),

    setViewport: (width, height, options) => host("setViewport", width, height, options),
    setEmulation: mode => host("setEmulation", mode),
    setTouch: enabled => host("setTouch", enabled),
    setColorScheme: scheme => host("setColorScheme", scheme),
    setMedia: media => host("setMedia", media),
    setUserAgent: (userAgent, options) => host("setUserAgent", userAgent, options),
    setLocale: locale => host("setLocale", locale),
    setTimezone: timezone => host("setTimezone", timezone),
    setGeolocation: coordinates => host("setGeolocation", coordinates),
    setCPUThrottling: rate => host("setCPUThrottling", rate),
    resetEmulation: () => host("resetEmulation"),

    handleDialogs: policy => host("handleDialogs", policy),
    setDialog: value => host("setDialog", value),
    dismissDialog: () => host("dismissDialog"),

    downloads: (options = {}) => host("downloads", options),
    waitForDownload: (options = {}) => host("waitForDownload", options),
    download: (url, options = {}) => host("download", new URL(url, location.href).href, options),
    clipboard: {
      read: () => host("clipboardRead"),
      write: text => host("clipboardWrite", String(text))
    }
  };

  window.__browserMcp = browser;
  window.__browserMcpRun = async (run, options = {}) => {
    offset = options.offset || { x: 0, y: 0 };
    pendingNavigation = null;
    const result = serialize(await run(browser));
    const navigation = pendingNavigation;
    pendingNavigation = null;
    return navigation ? { type: "__browserMcpRuntimeNavigation", url: navigation, result } : result;
  };
}
