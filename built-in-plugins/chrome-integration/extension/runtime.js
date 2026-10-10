const browserRuntimeVersion = 2;

function createBrowserRuntimeScript(pendingDialogJson) {
  return `
(() => {
  const pendingDialog = ${pendingDialogJson || "null"};

  if (window.__browserMcpRuntimeVersion !== ${browserRuntimeVersion}) {
    window.__browserMcpRuntimeVersion = ${browserRuntimeVersion};
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const actionGapMs = 50;
    let actionChain = Promise.resolve();
    let lastActionEndedAt = 0;
    const withActionGap = action => {
      const run = async () => {
        const elapsed = Date.now() - lastActionEndedAt;
        if (lastActionEndedAt > 0 && elapsed < actionGapMs) {
          await sleep(actionGapMs - elapsed);
        }
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
    const editableTags = new Set(["input", "textarea"]);
    const maxSnapshotNodes = 160;
    const snapshotSelector = "a, button, input, textarea, select, iframe, frame, [role], h1, h2, h3, label, summary, [onclick], [tabindex], [contenteditable='true']";
    const maxConsoleLogItems = 50;
    const consoleLevels = ["debug", "log", "info", "warn", "error"];
    const isFrame = element => element?.tagName === "IFRAME" || element?.tagName === "FRAME";
    const frameDocument = frame => {
      try {
        return frame.contentDocument;
      } catch {
        return null;
      }
    };
    const viewportRect = element => {
      const rect = element.getBoundingClientRect();
      let x = rect.left;
      let y = rect.top;
      let frame = element.ownerDocument?.defaultView?.frameElement;
      while (frame) {
        const frameRect = frame.getBoundingClientRect();
        x += frameRect.left + frame.clientLeft;
        y += frameRect.top + frame.clientTop;
        frame = frame.ownerDocument?.defaultView?.frameElement;
      }

      return { x, y, width: rect.width, height: rect.height, centerX: x + rect.width / 2, centerY: y + rect.height / 2 };
    };
    const getPointTarget = (x, y) => {
      let root = document;
      let target = null;
      while (root) {
        const origin = target ? viewportRect(target) : { x: 0, y: 0 };
        const offsetX = target ? origin.x + target.clientLeft : 0;
        const offsetY = target ? origin.y + target.clientTop : 0;
        let element = root.elementFromPoint(x - offsetX, y - offsetY);
        while (element?.shadowRoot) {
          const inner = element.shadowRoot.elementFromPoint(x - offsetX, y - offsetY);
          if (!inner || inner === element) break;
          element = inner;
        }

        if (!element) break;
        target = element;
        root = isFrame(element) ? frameDocument(element) : null;
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
      if (!element) {
        return null;
      }

      const text = (element.innerText || element.textContent || element.value || "").trim().replace(/\\s+/g, " ").slice(0, 160);
      return {
        tag: element.tagName ? element.tagName.toLowerCase() : null,
        id: element.id || null,
        name: element.getAttribute?.("name") || null,
        role: element.getAttribute?.("role") || null,
        type: element.getAttribute?.("type") || null,
        ariaLabel: element.getAttribute?.("aria-label") || null,
        text
      };
    };
    const serializeConsoleValue = value => {
      if (value instanceof Error) {
        return {
          type: "error",
          name: value.name,
          message: value.message,
          stack: value.stack || null
        };
      }

      if (value instanceof Node) {
        return {
          type: "node",
          value: describeElement(value)
        };
      }

      if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
        return value;
      }

      if (value === undefined || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
        return String(value);
      }

      try {
        const seen = new WeakSet();
        const json = JSON.stringify(value, (_key, current) => {
          if (current instanceof Error) {
            return {
              type: "error",
              name: current.name,
              message: current.message,
              stack: current.stack || null
            };
          }

          if (current instanceof Node) {
            return {
              type: "node",
              value: describeElement(current)
            };
          }

          if (typeof current === "bigint" || typeof current === "symbol" || typeof current === "function") {
            return String(current);
          }

          if (current && typeof current === "object") {
            if (seen.has(current)) {
              return "[Circular]";
            }
            seen.add(current);
          }

          return current;
        });

        if (json === undefined) {
          return String(value);
        }

        return json.length > 4000
          ? { type: "object", preview: json.slice(0, 4000), truncated: true }
          : JSON.parse(json);
      } catch {
        return String(value);
      }
    };
    const formatConsoleValue = value => {
      const serialized = serializeConsoleValue(value);
      if (serialized === null || ["string", "number", "boolean"].includes(typeof serialized)) {
        return String(serialized);
      }

      if (serialized?.type === "error") {
        return serialized.stack || serialized.message || serialized.name || "Error";
      }

      try {
        return JSON.stringify(serialized);
      } catch {
        return String(value);
      }
    };
    const pushConsoleEntry = entry => {
      const logs = window.__browserMcpConsoleLogs || [];
      logs.push({
        timestamp: new Date().toISOString(),
        url: location.href,
        ...entry
      });
      if (logs.length > maxConsoleLogItems) {
        logs.splice(0, logs.length - maxConsoleLogItems);
      }
      window.__browserMcpConsoleLogs = logs;
    };
    if (!window.__browserMcpConsoleCaptureInstalled) {
      window.__browserMcpConsoleCaptureInstalled = true;
      window.__browserMcpConsoleLogs = window.__browserMcpConsoleLogs || [];
      for (const level of consoleLevels) {
        const original = console[level];
        if (typeof original !== "function") {
          continue;
        }

        console[level] = (...args) => {
          try {
            pushConsoleEntry({
              level,
              type: "console",
              text: args.map(formatConsoleValue).join(" "),
              args: args.map(serializeConsoleValue)
            });
          } catch {
          }
          return original.apply(console, args);
        };
      }
      window.addEventListener("error", event => {
        pushConsoleEntry({
          level: "error",
          type: "error",
          text: event.message || formatConsoleValue(event.error),
          args: [serializeConsoleValue(event.error || event.message)],
          source: event.filename || null,
          line: event.lineno || null,
          column: event.colno || null,
          stack: event.error?.stack || null
        });
      });
      window.addEventListener("unhandledrejection", event => {
        pushConsoleEntry({
          level: "error",
          type: "unhandledrejection",
          text: formatConsoleValue(event.reason),
          args: [serializeConsoleValue(event.reason)],
          stack: event.reason?.stack || null
        });
      });
    }
    const ensureOverlay = () => {
      let overlay = document.getElementById("__browserMcpOverlay");
      if (overlay) {
        return overlay;
      }

      overlay = document.createElement("div");
      overlay.id = "__browserMcpOverlay";
      const pointer = document.createElement("div");
      const label = document.createElement("div");
      pointer.dataset.pointer = "";
      label.dataset.label = "";
      overlay.append(pointer, label);
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: "2147483647"
      });

      Object.assign(pointer.style, {
        width: "18px",
        height: "18px",
        border: "2px solid #0ea5e9",
        borderRadius: "50%",
        boxShadow: "0 0 0 4px rgba(14, 165, 233, 0.22)",
        opacity: "0",
        position: "absolute",
        transform: "translate(-50%, -50%)",
        transition: "left 120ms ease, top 120ms ease, opacity 120ms ease"
      });

      Object.assign(label.style, {
        background: "rgba(15, 23, 42, 0.92)",
        borderRadius: "6px",
        color: "white",
        font: "12px/1.3 system-ui, sans-serif",
        opacity: "0",
        padding: "4px 7px",
        position: "absolute",
        transform: "translate(10px, 10px)",
        transition: "opacity 120ms ease"
      });

      document.documentElement.appendChild(overlay);
      return overlay;
    };
    const showInteraction = (x, y, labelText) => {
      const overlay = ensureOverlay();
      const pointer = overlay.querySelector("[data-pointer]");
      const label = overlay.querySelector("[data-label]");
      pointer.style.left = \`\${x}px\`;
      pointer.style.top = \`\${y}px\`;
      pointer.style.opacity = "1";
      label.style.left = \`\${x}px\`;
      label.style.top = \`\${y}px\`;
      label.textContent = labelText;
      label.style.opacity = "1";
      clearTimeout(window.__browserMcpOverlayTimer);
      window.__browserMcpOverlayTimer = setTimeout(() => {
        pointer.style.opacity = "0";
        label.style.opacity = "0";
      }, 800);
    };
    const pointerAction = async (label, input) => {
      showInteraction(input.x, input.y, label);
      const target = getPointTarget(input.x, input.y);
      await requireHost().mouse(input);
      return { ok: true, target: describeElement(target), url: location.href };
    };
    const typeText = async text => {
      const active = deepActiveElement();
      const tag = active?.tagName?.toLowerCase();
      if (!active || (!editableTags.has(tag) && !active.isContentEditable && !isFrame(active))) {
        throw new Error(\`Focused element is not editable: \${tag || "none"}. Click the input first.\`);
      }

      const rect = viewportRect(active);
      showInteraction(Math.max(0, rect.x), Math.max(0, rect.y), "type");
      await requireHost().insertText(String(text));
      return { ok: true, target: describeElement(active) };
    };
    const snapshot = () => {
      const consoleLogs = (window.__browserMcpConsoleLogs || []).slice(-maxConsoleLogItems);
      const consoleErrorCount = consoleLogs.filter(entry => entry.level === "error").length;
      const consoleWarningCount = consoleLogs.filter(entry => entry.level === "warn").length;
      const latestConsoleIssue = [...consoleLogs].reverse().find(entry => entry.level === "error" || entry.level === "warn");
      const lines = [
        \`URL: \${location.href}\`,
        \`Title: \${document.title}\`,
        \`Viewport: \${innerWidth}x\${innerHeight}\`,
        \`Pending dialog: \${window.__browserMcpPendingDialog ? JSON.stringify(window.__browserMcpPendingDialog) : "none"}\`,
        \`Console: recent=\${consoleLogs.length} errors=\${consoleErrorCount} warnings=\${consoleWarningCount}\`,
        ...(latestConsoleIssue ? [
          \`Console latest issue: [\${latestConsoleIssue.level}] \${String(latestConsoleIssue.text || "").replace(/\\s+/g, " ").slice(0, 240)}\`
        ] : []),
        ""
      ];
      const nodes = [];
      const texts = [];
      const collect = (root, depth) => {
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) collect(element.shadowRoot, depth);
          if (nodes.length >= maxSnapshotNodes || !element.matches(snapshotSelector)) continue;
          const rect = viewportRect(element);
          const style = getComputedStyle(element);
          const visible = rect.width > 0 &&
            rect.height > 0 &&
            rect.y + rect.height >= 0 &&
            rect.x + rect.width >= 0 &&
            rect.y <= innerHeight &&
            rect.x <= innerWidth &&
            style.visibility !== "hidden" &&
            style.display !== "none";
          if (!visible) continue;
          nodes.push({ element, rect, depth });
          if (isFrame(element)) {
            const inner = frameDocument(element);
            if (inner?.documentElement) {
              collect(inner, depth + 1);
              const text = (inner.body?.innerText || "").trim();
              if (text) texts.push(text);
            }
          }
        }
      };
      collect(document, 0);

      for (const { element, rect, depth } of nodes) {
        const frameNote = isFrame(element)
          ? frameDocument(element) ? " (frame)" : " (cross-origin frame: DOM unavailable; use screenshot and coordinate clicks)"
          : "";
        const parts = [
          element.tagName.toLowerCase(),
          element.id ? \`#\${element.id}\` : "",
          element.getAttribute("role") ? \`[role=\${element.getAttribute("role")}]\` : "",
          element.getAttribute("name") ? \`[name=\${element.getAttribute("name")}]\` : "",
          element.getAttribute("type") ? \`[type=\${element.getAttribute("type")}]\` : ""
        ].filter(Boolean);
        const label = (
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.innerText ||
          element.value ||
          element.textContent ||
          ""
        ).trim().replace(/\\s+/g, " ").slice(0, 220);
        const text = isFrame(element) ? element.getAttribute("title") || element.src || "" : label;
        lines.push(\`\${"  ".repeat(depth)}\${Math.round(rect.x)},\${Math.round(rect.y)} \${Math.round(rect.width)}x\${Math.round(rect.height)} \${parts.join("")}\${text ? \` "\${text.slice(0, 220)}"\` : ""}\${frameNote}\`);
      }

      const bodyText = [document.body?.innerText || "", ...texts].join(" ").trim().replace(/\\s+/g, " ").slice(0, 4000);
      if (bodyText) {
        lines.push("", \`Text: \${bodyText}\`);
      }

      return lines.join("\\n");
    };
    const requireHost = () => {
      if (!window.__browserMcpHost) {
        throw new Error("Browser MCP host bridge is unavailable.");
      }

      return window.__browserMcpHost;
    };
    const raiseDialog = (type, message, defaultValue = null) => {
      const error = new Error("A JavaScript dialog is pending.");
      error.__browserMcpDialog = {
        type,
        message: message == null ? "" : String(message),
        defaultValue
      };
      throw error;
    };

    window.__browserMcpRaiseDialog = raiseDialog;

    window.__browserMcp = {
      navigate: url => {
        window.__browserMcpPendingNavigation = url;
        return { ok: true, url };
      },
      leftClick: (x, y, duration = 0) => withActionGap(() => pointerAction("click", { type: "click", x, y, button: "left", duration })),
      rightClick: (x, y, duration = 0) => withActionGap(() => pointerAction("right click", { type: "click", x, y, button: "right", duration })),
      doubleClick: (x, y) => withActionGap(() => pointerAction("double click", { type: "click", x, y, button: "left", clickCount: 2 })),
      hover: (x, y) => withActionGap(() => pointerAction("hover", { type: "move", x, y })),
      drag: (fromX, fromY, toX, toY, duration = 500, isLeftClick = true) => withActionGap(async () => {
        showInteraction(fromX, fromY, isLeftClick ? "drag" : "right drag");
        await requireHost().mouse({ type: "drag", x: fromX, y: fromY, toX, toY, duration, button: isLeftClick ? "left" : "right" });
        showInteraction(toX, toY, "drop");
        return { ok: true, target: describeElement(getPointTarget(toX, toY)), url: location.href };
      }),
      scroll: (x, y, delta) => withActionGap(() => pointerAction("scroll", { type: "scroll", x, y, delta })),
      type: text => withActionGap(() => typeText(text)),
      press: key => withActionGap(async () => {
        await requireHost().press(String(key));
        return { ok: true, key: String(key), target: describeElement(deepActiveElement()) };
      }),
      rect: element => viewportRect(element),
      frames: () => [...document.querySelectorAll("iframe, frame")].map(frame => ({
        src: frame.src || null,
        sameOrigin: Boolean(frameDocument(frame)),
        rect: viewportRect(frame)
      })),
      sleep,
      snapshot,
      screenshot: () => requireHost().screenshot(),
      consoleLogs: () => (window.__browserMcpConsoleLogs || []).slice(-maxConsoleLogItems),
      networkLogs: options => requireHost().networkLogs(options || {}),
      inspectNetworkRequest: id => requireHost().inspectNetworkRequest(id),
      setColorScheme: scheme => requireHost().setColorScheme(scheme),
      setDialog: value => requireHost().setDialog(value),
      dismissDialog: () => requireHost().dismissDialog(),
      setEmulation: mode => requireHost().setEmulation(mode),
      setViewport: (width, height) => requireHost().setViewport(width, height)
    };
  }

  window.__browserMcpRun = async code => {
    window.__browserMcpPendingNavigation = null;
    window.__browserMcpPendingDialog = pendingDialog;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const nativeDialogs = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
    window.alert = message => window.__browserMcpRaiseDialog("alert", message);
    window.confirm = message => window.__browserMcpRaiseDialog("confirm", message);
    window.prompt = (message, defaultValue = "") => window.__browserMcpRaiseDialog("prompt", message, defaultValue == null ? "" : String(defaultValue));
    let result;
    try {
      result = await new AsyncFunction("browser", code)(window.__browserMcp);
    } catch (error) {
      if (error?.__browserMcpDialog) {
        return {
          type: "__browserMcpRuntimeDialog",
          dialog: error.__browserMcpDialog
        };
      }

      throw error;
    } finally {
      window.alert = nativeDialogs.alert;
      window.confirm = nativeDialogs.confirm;
      window.prompt = nativeDialogs.prompt;
    }
    const nextNavigation = window.__browserMcpPendingNavigation;
    window.__browserMcpPendingNavigation = null;
    if (nextNavigation) {
      return {
        type: "__browserMcpRuntimeNavigation",
        url: nextNavigation,
        result
      };
    }
    return result;
  };
})();
`;
}

