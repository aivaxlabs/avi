# Core API — Plugin API v2

Avi plugins are trusted ECMAScript modules loaded in the Electron main process. The public API is version 2; older API versions are rejected.

Built-in plugins use the same API v2 contract. Their sources live in the installer-managed `built-in-plugins` resource directory, while enablement and managed output remain separate. They are disabled by default and cannot be removed or replaced by sideloading. See [Built-in plugins](../../Plugins.md#built-in-and-installed-plugins).

## Entrypoint

Every package exposes `plugin.js` with a default definition or a factory receiving the authoring helper:

```js
export default ({ apiVersion, definePlugin }) => definePlugin({
  apiVersion,
  id: 'acme-integration',
  name: 'Acme integration',
  version: '1.0.0',
  capabilities: [
    'tools.register',
    'events.subscribe',
    'storage',
  ],
  async activate(avi) {
    // Register runtime resources here.
  },
  async deactivate(reason) {
    // Optional final flush.
  },
});
```

The definition supports `apiVersion`, optional `minApiVersion`, `id`, `name`, `version`, optional `description`, `capabilities`, `activate`, `deactivate`, `contributions`, and declarative `settings`. The factory argument exposes `apiVersion` (current) and `minApiVersion` (oldest supported). See [API version compatibility](../../Plugins.md#api-version-compatibility).

## Runtime namespaces

`activate(avi)` receives:

- `avi.app`
- `avi.threads`
- `avi.semaphores`
- `avi.scheduler`
- `avi.bots`
- `avi.tools`
- `avi.interceptors`
- `avi.events`
- `avi.panels`
- `avi.actionPages`
- `avi.providers`
- `avi.providers.usages`
- `avi.context`
- `avi.storage`
- `avi.lifecycle`

All domain operations are asynchronous unless documented otherwise. Reads return detached JSON-like snapshots. Entity handles contain IDs and validated methods, not database rows or main-process service objects.

## Capabilities

Plugins must declare every privileged namespace they use:

```text
threads.read
threads.readMessages
threads.create
threads.update
threads.run
threads.delete
bots.read
bots.manage
bots.run
bots.readState
bots.approvals.resolve
scheduler.read
scheduler.manage
tools.register
tools.intercept
events.subscribe
events.readContent
events.readReasoning
panels.register
panels.manage
actionPages.register
providers.read
providers.manage
providers.types.register
providers.usages.register
providers.credentials.write
context.read
context.readContents
context.register
storage
```

Unknown or duplicate capabilities reject the plugin. Calling an API without its capability throws `AviError` with code `CAPABILITY_REQUIRED`.

Capabilities provide a stable contract, auditability, and UI transparency. They are not an operating-system sandbox: plugin code still runs with Avi main-process privileges.

## Existing contributions

The v2 definition still accepts the validated contribution arrays `context`, `mcps`, `tools`, `auxiliaryPanels`, `themes`, `personalities`, and `providers`. Runtime registration in `activate()` is preferred when the resource needs dynamic scope or cleanup.

## Declarative settings

The optional top-level `settings` array adds application-rendered sections to the plugin's card under **Settings → Plugins**. Options declare JSON Schemas while `getValue`, `validate`, and `setValue` handlers remain in the main process. This is a backward-compatible Plugin API v2 extension and requires no capability. See [Plugin settings](./settings.md).

## Security boundary

Plugins are not sandboxed. They can use Node.js, access files and network resources available to Avi, and inspect process data. Install only reviewed code. Panels remain declarative and cannot inject renderer JavaScript. HTML [action pages](./action-pages.md) run plugin HTML, CSS, and JavaScript only inside a sandboxed, opaque-origin iframe that reaches the plugin solely through `window.avi.invoke()`. Provider credentials exposed through `avi.providers` are write-only.

## Electron main-process modules

Plugin code runs in Avi's Electron main process after the app is ready, so it can `import('electron')` and use main-process modules such as `BrowserWindow`, `screen`, `globalShortcut`, `desktopCapturer`, and `nativeImage`. This is how a plugin owns its desktop runtime without bundling a second Electron. No capability is required, and the Plugin API does not wrap these modules.

Rules:

- Release everything you create in `avi.lifecycle.onDeactivate()` or `deactivate()`: destroy windows, unregister the accelerators you registered, and remove listeners added to shared objects such as `screen` or `app`.
- Use your own windows, preload scripts, and IPC channels. Do not modify Avi's windows, `webContents`, sessions, or IPC handlers; they are not part of the public contract.
- `globalShortcut` is shared with Avi. `register()` returns `false` when the accelerator is already taken, so handle that case. Unregister only your own accelerators and never call `unregisterAll()`.
- Open windows keep Avi running after its main window closes. Destroy them when they are no longer needed.
- Renderer-only modules such as `ipcRenderer` and `contextBridge` are available only in your preload scripts.

```js
async activate(avi) {
  const { BrowserWindow } = await import('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  avi.lifecycle.onDeactivate(() => win.destroy());
}
```

## Related documents

- [All API surfaces](../overview.md)
- [Shared types](./types.md)
- [Lifecycle](./lifecycle.md)
- [Threads](./threads.md)
- [Bots](./bots.md)
- [Scheduler](./scheduler.md)
- [Tools](./tools.md)
- [Action pages](./action-pages.md)
- [Events](./events.md)
- [Tool interceptors](./interceptors.md)
- [Panels](./panels.md)
- [Plugin settings](./settings.md)
- [Providers](./providers.md)
- [Context](./context.md)
- [Storage](./storage.md)
- [Errors](./errors.md)
