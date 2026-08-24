# Plugin API v2

Avi plugins are trusted ECMAScript modules loaded in the Electron main process. The public API is version 2; older API versions are rejected.

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

The definition supports `apiVersion`, `id`, `name`, `version`, optional `description`, `capabilities`, `activate`, `deactivate`, and `contributions`.

## Runtime namespaces

`activate(avi)` receives:

- `avi.app`
- `avi.threads`
- `avi.bots`
- `avi.tools`
- `avi.interceptors`
- `avi.events`
- `avi.panels`
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
tools.register
tools.intercept
events.subscribe
events.readContent
events.readReasoning
panels.register
panels.manage
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

## Security boundary

Plugins are not sandboxed. They can use Node.js, access files and network resources available to Avi, and inspect process data. Install only reviewed code. Panels remain declarative and cannot inject renderer JavaScript. Provider credentials exposed through `avi.providers` are write-only.

## Related documents

- [Shared types](./types.md)
- [Lifecycle](./lifecycle.md)
- [Threads](./threads.md)
- [Bots](./bots.md)
- [Tools](./tools.md)
- [Events](./events.md)
- [Tool interceptors](./interceptors.md)
- [Panels](./panels.md)
- [Providers](./providers.md)
- [Context](./context.md)
- [Storage](./storage.md)
- [Errors](./errors.md)
