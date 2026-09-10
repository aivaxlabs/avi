function createBrowserRuntimeScript(pendingDialogJson) {
  return `
(() => {
  const pendingDialog = ${pendingDialogJson || "null"};

  if (!window.__browserMcp) {
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
    const maxConsoleLogItems = 50;
    const consoleLevels = ["debug", "log", "info", "warn", "error"];
    const buttonMask = button => button === 0 ? 1 : button === 2 ? 2 : 4;
    const getPointTarget = (x, y) => document.elementFromPoint(x, y) || document.body || document.documentElement;
    const eventInit = (x, y, button, buttons) => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      button,
      buttons,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y
    });
    const dispatchPointer = (target, type, x, y, button, buttons) => {
      if (typeof PointerEvent === "function") {
        target.dispatchEvent(new PointerEvent(type, {
          ...eventInit(x, y, button, buttons),
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          width: 1,
          height: 1,
          pressure: buttons ? 0.5 : 0
        }));
      }
    };
    const dispatchMouse = (target, type, x, y, button, buttons) =>
      target.dispatchEvent(new MouseEvent(type, eventInit(x, y, button, buttons)));
    const dispatchAt = (type, x, y, button = 0, buttons = 0) => {
      const target = getPointTarget(x, y);
      const pointerType = type === "mousemove" ? "pointermove" : type === "mousedown" ? "pointerdown" : type === "mouseup" ? "pointerup" : type;
      dispatchPointer(target, pointerType, x, y, button, buttons);
      dispatchMouse(target, type, x, y, button, buttons);
      return target;
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
    const click = async (x, y, button, duration = 0) => {
      showInteraction(x, y, button === 2 ? "right click" : "click");
      const target = dispatchAt("mousemove", x, y, button, 0);
      target.focus?.({ preventScroll: true });
      dispatchAt("mousedown", x, y, button, buttonMask(button));
      if (duration > 0) {
        await sleep(duration);
      }
      dispatchAt("mouseup", x, y, button, 0);
      dispatchMouse(target, button === 2 ? "contextmenu" : "click", x, y, button, 0);
      return { ok: true, target: describeElement(target), url: location.href };
    };
    const hover = (x, y) => {
      showInteraction(x, y, "hover");
      const target = dispatchAt("mousemove", x, y, 0, 0);
      if (window.__browserMcpLastHoverTarget !== target) {
        if (window.__browserMcpLastHoverTarget) {
          dispatchPointer(window.__browserMcpLastHoverTarget, "pointerout", x, y, 0, 0);
          dispatchPointer(window.__browserMcpLastHoverTarget, "pointerleave", x, y, 0, 0);
          dispatchMouse(window.__browserMcpLastHoverTarget, "mouseout", x, y, 0, 0);
          dispatchMouse(window.__browserMcpLastHoverTarget, "mouseleave", x, y, 0, 0);
        }

        dispatchPointer(target, "pointerover", x, y, 0, 0);
        dispatchPointer(target, "pointerenter", x, y, 0, 0);
        dispatchMouse(target, "mouseover", x, y, 0, 0);
        dispatchMouse(target, "mouseenter", x, y, 0, 0);
        window.__browserMcpLastHoverTarget = target;
      }
      return { ok: true, target: describeElement(target), url: location.href };
    };
    const typeText = text => {
      const active = document.activeElement;
      if (!active) {
        throw new Error("No focused element to type into.");
      }

      const tag = active.tagName?.toLowerCase();
      showInteraction(
        Math.max(0, active.getBoundingClientRect().left),
        Math.max(0, active.getBoundingClientRect().top),
        "type"
      );

      for (const char of String(text)) {
        active.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true, cancelable: true }));
        active.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true, cancelable: true }));

        if (editableTags.has(tag)) {
          const start = active.selectionStart ?? active.value.length;
          const end = active.selectionEnd ?? active.value.length;
          active.value = active.value.slice(0, start) + char + active.value.slice(end);
          active.selectionStart = active.selectionEnd = start + char.length;
          active.dispatchEvent(new InputEvent("input", { data: char, inputType: "insertText", bubbles: true }));
        } else if (active.isContentEditable) {
          document.execCommand("insertText", false, char);
          active.dispatchEvent(new InputEvent("input", { data: char, inputType: "insertText", bubbles: true }));
        } else {
          throw new Error(\`Focused element is not editable: \${tag || "unknown"}.\`);
        }

        active.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true, cancelable: true }));
      }

      active.dispatchEvent(new Event("change", { bubbles: true }));
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
      const nodes = [...document.querySelectorAll("a, button, input, textarea, select, [role], h1, h2, h3, label, summary, [onclick], [tabindex], [contenteditable='true']")]
        .filter(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom >= 0 &&
            rect.right >= 0 &&
            rect.top <= innerHeight &&
            rect.left <= innerWidth &&
            style.visibility !== "hidden" &&
            style.display !== "none";
        })
        .slice(0, 120);

      for (const element of nodes) {
        const rect = element.getBoundingClientRect();
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
        lines.push(\`\${Math.round(rect.left)},\${Math.round(rect.top)} \${Math.round(rect.width)}x\${Math.round(rect.height)} \${parts.join("")}\${label ? \` "\${label}"\` : ""}\`);
      }

      const bodyText = (document.body?.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 3000);
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
      leftClick: (x, y, duration = 0) => withActionGap(() => click(x, y, 0, duration)),
      rightClick: (x, y, duration = 0) => withActionGap(() => click(x, y, 2, duration)),
      hover: (x, y) => withActionGap(() => hover(x, y)),
      drag: (fromX, fromY, toX, toY, duration = 500, isLeftClick = true) => withActionGap(async () => {
        const button = isLeftClick ? 0 : 2;
        const buttons = buttonMask(button);
        showInteraction(fromX, fromY, isLeftClick ? "drag" : "right drag");
        dispatchAt("mousemove", fromX, fromY, button, 0);
        dispatchAt("mousedown", fromX, fromY, button, buttons);
        const steps = Math.max(8, Math.ceil(duration / 25));
        for (let index = 1; index <= steps; index++) {
          const x = fromX + ((toX - fromX) * index / steps);
          const y = fromY + ((toY - fromY) * index / steps);
          dispatchAt("mousemove", x, y, button, buttons);
          await sleep(duration / steps);
        }
        const target = dispatchAt("mouseup", toX, toY, button, 0);
        showInteraction(toX, toY, "drop");
        return { ok: true, target: describeElement(target), url: location.href };
      }),
      scroll: (x, y, delta) => withActionGap(() => {
        showInteraction(x, y, "scroll");
        const target = getPointTarget(x, y);
        target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: delta }));
        const scroller = target.closest?.("[style*='overflow'], [role='region']") || document.scrollingElement || document.documentElement;
        scroller.scrollBy({ top: delta, left: 0, behavior: "auto" });
        return { ok: true, scrollX, scrollY, target: describeElement(target) };
      }),
      type: text => withActionGap(() => typeText(text)),
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

