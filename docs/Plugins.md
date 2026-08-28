# Plugins

Plugins extend Avi with trusted JavaScript executed in the Electron main process. A package has an ECMAScript module entrypoint named `plugin.js` and can be installed from a `.js` file or a `.zip` archive containing that entrypoint and optional supporting files.

> **Security boundary:** plugins are not sandboxed. Importing a plugin executes code with Avi's operating-system and main-process privileges. Review all source before installation.

The only public contract is **Plugin API v2**. Older API versions are rejected.

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

See [Plugin API v2](./api/overview.md) for the complete runtime contract.

## Static contributions

Definitions may still declare validated static contribution arrays:

```js
contributions: {
  context: [],
  mcps: [],
  tools: [],
  auxiliaryPanels: [],
  themes: [],
  personalities: [],
  providers: [],
}
```

Use static contributions for resources known at load time. Use runtime registration in `activate(avi)` for per-thread resources, dynamic tools, event subscriptions, storage, interceptors, or deterministic cleanup.

A definition can also declare a top-level `settings` array. Avi renders its sections and JSON Schema-backed editors under **Settings → Plugins** while the plugin retains its `getValue`, `validate`, and `setValue` handlers in the main process. Plugins cannot inject HTML or renderer JavaScript. See [Plugin settings](./api/settings.md).

Contribution descriptors remain JSON-like, and functions are accepted only in documented top-level handlers. IDs use this ASCII pattern:

```text
^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$
```

Use lowercase kebab-case IDs. Collisions are checked case-insensitively.

### Context

A static context item is `{ path, content }`. Paths are relative, cannot escape with `..`, and are materialized under `plugins/.avi/<plugin-id>/context/`. This is managed output; edit the plugin source, not the materialized files.

### MCP servers

An MCP item is `{ id, name, config }`. Config uses Avi's existing `stdio`, `streamable-http`, or legacy `sse` shape. Plugin MCP servers are managed and read-only in ordinary settings. Never hard-code credentials in plugin source.

### Chat tools

A static tool is `{ name, description, inputSchema, execute }`. Runtime tools add scoping, annotations, handles, and cleanup; see [Tools](./api/tools.md).

### Auxiliary panels

A static panel is `{ id, title, load, invokeAction? }`. Panels return declarative sections, items, and actions. They cannot inject React, HTML scripts, or renderer JavaScript. See [Panels](./api/panels.md).

### Themes

A theme is `{ id, name, tagline, css, emptyChatBackground? }`. Theme CSS is trusted global presentation input and must be reviewed for remote URLs, overlays, unreadable states, and overly broad selectors.

### Personalities

A personality is `{ id, name, description, instructions }`. Instructions become model context when selected but do not grant tools, permissions, or runtime authority.

### Model providers and usage

A provider contribution uses `{ descriptor, createBody, request, eventsFrom }` with optional `getContributions`, `getState`, `invokeAction`, `refresh`, and `remove`. Avi awaits `refresh` after provider configuration is saved, enabling asynchronous discovery before the synchronous model catalog is read. Its `getContributions` result can include `usageProviders` alongside models, tools, and auxiliary panels.

Plugins can also register standalone account usage with `avi.providers.usages.register()` and the `providers.usages.register` capability. Usage providers expose limits, formatted counters, and confirmed reset callbacks in the composer without adding user-manageable settings. Dynamic provider registration, usage providers, and write-only credential management are documented in [Providers](./api/providers.md).

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

- [Overview and capabilities](./api/overview.md)
- [Lifecycle](./api/lifecycle.md)
- [Threads and runs](./api/threads.md)
- [Bots](./api/bots.md)
- [Tools](./api/tools.md)
- [Events](./api/events.md)
- [Tool interceptors](./api/interceptors.md)
- [Panels](./api/panels.md)
- [Plugin settings](./api/settings.md)
- [Providers](./api/providers.md)
- [Context](./api/context.md)
- [Storage](./api/storage.md)
- [Errors](./api/errors.md)
