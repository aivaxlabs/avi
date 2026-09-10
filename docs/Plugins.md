# Plugins

Plugins extend Avi with trusted JavaScript executed in the Electron main process. A package has an ECMAScript module entrypoint named `plugin.js` and can be installed from a `.js` file or a `.zip` archive containing that entrypoint and optional supporting files.

> **Security boundary:** plugins are not sandboxed. Importing a plugin executes code with Avi's operating-system and main-process privileges. Review all source before installation.

The only public contract is **Plugin API v2**. Older API versions are rejected.

The [`avi.notes` Core domain](api/core/notes.md) exposes persistent user notes with `notes.read` and `notes.manage` capabilities, including list/note editing, search, ordering, attachments and auxiliary generation.

## Minimal plugin

```js
export default ({ apiVersion, definePlugin }) => definePlugin({
  apiVersion,
  id: 'hello-avi',
  name: 'Hello Avi',
  version: '1.0.0',
  capabilities: [],
});
```

A runtime plugin declares capabilities and registers resources during activation:

```js
export default ({ definePlugin }) => definePlugin({
  apiVersion: 2,
  id: 'acme-tools',
  name: 'Acme tools',
  version: '1.0.0',
  capabilities: ['tools.register', 'events.subscribe', 'storage'],

  async activate(avi) {
    avi.tools.register({
      name: 'acme_status',
      description: 'Read Acme service status.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnly: true },
      async execute(_input, context) {
        const response = await fetch('https://status.acme.example/api', {
          signal: context.signal,
        });
        if (!response.ok) throw new Error(`Status request failed (${response.status}).`);
        return JSON.stringify(await response.json());
      },
    });
  },
});
```

See [Core API — Plugin API v2](./api/core/overview.md) for the complete runtime contract.

Bot integrations use `bot.inbox.list/reply/complete` and `bot.activity.list`. These replace the former `bot.workState.get()` and work-item types; older bot data is not migrated. This bot-domain change is breaking for existing plugins using work state, while the runtime still accepts Plugin API v2. See [Bots](./api/core/bots.md) for capabilities, messages, attachments, and protected approvals.

## Built-in and installed plugins

**Settings → Plugins** separates **Built-in** plugins shipped with Avi from **Installed** JavaScript/ZIP packages. Built-ins use the same trusted Plugin API v2, tools, context and lifecycle as other plugins, but start disabled. Enable or disable them and restart Avi to apply the change. Disabling does not stop a currently loaded plugin until restart.

Built-in sources are distributed in `resources/built-in-plugins/` (`built-in-plugins/` in development). Avi reads `.avi-plugin.json` metadata without importing disabled code. Enablement is stored separately in `plugins/.avi-built-in-state.json`; managed context and storage remain under the ordinary plugin directory. Updates replace bundled sources, not the saved enablement state. Built-in IDs are reserved and cannot be removed or overwritten through sideloading.

### Chrome Integration

Provides `chrome_get_context`, `chrome_run_actions`, a `chrome-integration` skill and a settings page with the default action timeout. Its WebSocket bridge runs only while the plugin is active, on `127.0.0.1:55334`; no external Node installation or MCP daemon is required.

Open its Settings page and click **Install extension in Chrome**. This opens the bundled extension folder and copies its path. In each desired Chrome profile, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. There is no Chrome Web Store listing or silent installation. Reload the extension after an Avi update. Chrome may display a debugger-access banner. A port conflict makes activation fail explicitly.

The tools use live ephemeral tab IDs, snapshots, screenshots, JavaScript actions, console/network inspection, dialogs and responsive emulation. Browser actions require the usual Avi permissions. Cancellation stops waiting but cannot undo already dispatched browser actions.

### Computer Use

Provides `computer_get_context`, `computer_focus_window`, `computer_toggle_session`, `computer_use` and a `computer-use` skill. The bundled backend preserves monitor-local screenshot coordinates, a visible overlay, Escape to stop, and a five-second pause after manual input when the input monitor is available. Control sessions are owned by their initiating conversation. Cancellation ends that conversation's session; native input already dispatched cannot be rolled back.

The desktop backend includes its own Electron overlay and native input/image/window dependencies; these increase installer size. macOS may require Accessibility and Screen Recording permissions; Linux focus support uses `xdotool` when available. Native behavior must be validated on each supported release platform.

Run `bun run built-ins:prepare` before using enabled built-ins from a fresh development checkout. `bun run package` prepares dependencies automatically and requires packaging on the target OS and architecture. All runtime dependencies are included in the dedicated resources directory; the user's reference project paths are never used at runtime.

## Other reference plugins

### Child Processes

The included **Child Processes** plugin starts configured programs or shell commands when Avi starts and applies saved configuration changes immediately. Each entry uses one command line containing the program and its arguments, plus an optional working directory (defaulting to `$HOME`), retry delay, and finite or unlimited retries. A process is retried only after an unsuccessful exit.

Each managed program runs under a dedicated supervisor connected to Avi. Normal shutdown asks the supervisor to terminate the complete process tree; if Avi exits unexpectedly, closure of the inherited IPC channel triggers the same cleanup. On Windows the supervisor uses `taskkill /T /F`; on macOS and Linux it terminates the managed process group.

Open the plugin's **Child Processes** auxiliary panel to start, stop, or restart each process independently and inspect combined timestamped stdout, stderr, lifecycle, retry, and non-zero exit messages. A manual stop lasts until the process is started from the panel or Avi starts again. The in-memory log retains only the newest 1 MiB per configured process and can be cleared from the panel.

Configuration is persisted in Avi's isolated plugin storage. Because plugins are trusted main-process code, only configure programs and commands you trust.

## Static contributions

Definitions may still declare validated static contribution arrays:

```js
contributions: {
  context: [],
  mcps: [],
  tools: [],
  auxiliaryPanels: [],
  shortcuts: [],
  themes: [],
  personalities: [],
  providers: [],
}
```

Use static contributions for resources known at load time. Use runtime registration in `activate(avi)` for per-thread resources, dynamic tools, event subscriptions, storage, interceptors, or deterministic cleanup.

A definition can also declare a top-level `settings` array. Avi renders its sections and JSON Schema-backed editors under **Settings → Plugins** while the plugin retains its `getValue`, `validate`, and `setValue` handlers in the main process. Plugins cannot inject HTML or renderer JavaScript. See [Plugin settings](./api/core/settings.md).

Contribution descriptors remain JSON-like, and functions are accepted only in documented top-level handlers. IDs use this ASCII pattern:

```text
^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$
```

Use lowercase kebab-case IDs. Collisions are checked case-insensitively.

### Keyboard shortcuts

Plugin API v2 supports static `shortcuts` contributions:

```js
shortcuts: [{
  id: 'open-status',
  title: 'Open plugin status',
  pattern: 'Control+Alt+P',
  supportsGlobal: true,
  global: false,
  async execute() {
    // Perform the plugin action in the main process.
  },
}]
```

`id`, `title`, `pattern` (including an empty string), and `execute` are required. `supportsGlobal` and `global` are optional booleans, defaulting to false. Global defaults require `supportsGlobal: true`. IDs are collision-checked case-insensitively across plugins. Only serializable descriptors reach the renderer; `execute()` receives no arguments and its return value is ignored. Rejected handlers report an error to the app. Plugins are trusted code and must bound their own work.

Bindings appear in **Settings → Keyboard shortcuts** with the plugin ID and can be edited, disabled, or reset. User overrides are stored separately from plugin sources. Conflicting patterns do not prevent plugin loading: the later conflicting binding is inactive and displays an error until edited. Contribution installation, removal, and enabled-state changes follow the normal restart lifecycle. Desktop registrations are released when Avi exits. See [Keyboard shortcuts](Keyboard-shortcuts.md).

### Context

A static context item is `{ path, content }`. Paths are relative, cannot escape with `..`, and are materialized under `plugins/.avi/<plugin-id>/context/`. This is managed output; edit the plugin source, not the materialized files.

### MCP servers

An MCP item is `{ id, name, config }`. Config uses Avi's existing `stdio`, `streamable-http`, or legacy `sse` shape. Plugin MCP servers are managed and read-only in ordinary settings. Never hard-code credentials in plugin source.

### Chat tools

A static tool is `{ name, description, inputSchema, forcedTruncationLength?, execute }`. `forcedTruncationLength` is a positive estimated-token limit that overrides the global tool-output setting for that tool. Runtime tools add scoping, annotations, handles, and cleanup; see [Tools](./api/core/tools.md).

### Auxiliary panels

A static panel is `{ id, title, load, invokeAction? }`. Panels return declarative sections, items, and actions. They cannot inject React, HTML scripts, or renderer JavaScript. See [Panels](./api/core/panels.md).

### Themes

A theme is `{ id, name, tagline, css, emptyChatBackground? }`. Theme CSS should define `--background-transparent-0` through `--background-transparent-5` as translucent counterparts of its six background surfaces; Avi uses those tokens for the transparent Sidebar. Theme CSS is trusted global presentation input and must be reviewed for remote URLs, overlays, unreadable states, and overly broad selectors.

### Personalities

A personality is `{ id, name, description, instructions }`. Instructions become model context when selected but do not grant tools, permissions, or runtime authority.

### Model providers and usage

A provider contribution uses `{ descriptor, createBody, request, eventsFrom }` with optional `getContributions`, `getState`, `invokeAction`, `refresh`, and `remove`. Avi awaits `refresh` after provider configuration is saved, enabling asynchronous discovery before the synchronous model catalog is read. Its `getContributions` result can include `usageProviders` alongside models, tools, and auxiliary panels.

Plugins can also register standalone account usage with `avi.providers.usages.register()` and the `providers.usages.register` capability. Usage providers expose limits, formatted counters, and confirmed reset callbacks in the composer without adding user-manageable settings. Dynamic provider registration, usage providers, and write-only credential management are documented in [Providers](./api/core/providers.md).

## Loading and installation

- Packages live at `$INSTALL_DIR/plugins/<plugin-id>/`.
- Enabled entrypoints are `plugin.js`; disabled entrypoints are `plugin.js.disabled`.
- Imports and factories have a 10-second timeout.
- Import, validation, collision, materialization, or activation failure rejects the plugin.
- Definitions require a strict semantic `version`.
- Installation stages and validates the package before replacing an existing version.
- Downgrades require native confirmation.
- Enable, disable, update, and removal currently require restart to change packages already loaded in the main process.
- Startup and activation failures are recorded in plugin status, `trace.log`, and startup warnings.

ZIP packages are bounded by entry count and uncompressed size and reject symbolic links, duplicate case-insensitive paths, absolute paths, and path traversal.

`$INSTALL_DIR` can require elevated filesystem permission and can be replaced by an installer or updater.

## API reference

- [All API surfaces](./api/overview.md)
- [Core API overview and capabilities](./api/core/overview.md)
- [Lifecycle](./api/core/lifecycle.md)
- [Threads and runs](./api/core/threads.md)
- [Bots](./api/core/bots.md)
- [Tools](./api/core/tools.md)
- [Events](./api/core/events.md)
- [Tool interceptors](./api/core/interceptors.md)
- [Panels](./api/core/panels.md)
- [Plugin settings](./api/core/settings.md)
- [Providers](./api/core/providers.md)
- [Context](./api/core/context.md)
- [Storage](./api/core/storage.md)
- [Errors](./api/core/errors.md)
