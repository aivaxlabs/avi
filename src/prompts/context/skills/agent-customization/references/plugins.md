# Plugins in Avi

Use a plugin when a trusted, install-wide JavaScript extension needs runtime integration or multiple Avi capabilities. Prefer instructions, workflows, skills, or MCP when trusted main-process code is unnecessary.

Read `docs/Plugins.md` and the relevant `docs/api/*.md` document before authoring or reviewing a plugin.

## Version 2 contract

The default export is an object or factory receiving:

```js
{ apiVersion: 2, definePlugin }
```

A runtime definition is:

```js
export default ({ definePlugin }) => definePlugin({
  apiVersion: 2,
  id: 'example-plugin',
  name: 'Example plugin',
  version: '1.0.0',
  capabilities: ['tools.register', 'events.subscribe', 'storage'],
  async activate(avi) {
    // Register runtime resources.
  },
  async deactivate(reason) {
    // Optional final flush.
  },
  contributions: {},
});
```

Unknown API versions, fields, capabilities, contribution types, IDs, or descriptor fields are rejected. Import, factory, validation, collision, materialization, or activation failure rejects the plugin.

## Runtime namespaces

`activate(avi)` exposes scoped services for app information, threads, bots, tools, events, tool interceptors, panels, providers, context, storage, and lifecycle. Reads return detached snapshots; entity handles expose validated operations and never reveal internal services.

Every privileged namespace checks the definition's explicit capabilities. Capabilities are contract and audit controls, not an OS sandbox.

Runtime registrations return `Disposable` resources and are cleaned automatically on deactivation. Use `avi.lifecycle.onDeactivate()` for timers or external connections.

## Static contributions

The validated static arrays remain available:

- `context`: `{ path, content }` managed UTF-8 context files.
- `mcps`: `{ id, name, config }` managed MCP server definitions.
- `tools`: `{ name, description, inputSchema, execute }` global static tools.
- `auxiliaryPanels`: `{ id, title, load, invokeAction? }` declarative panels.
- `themes`: `{ id, name, tagline, css, emptyChatBackground? }` trusted CSS themes.
- `personalities`: `{ id, name, description, instructions }`.
- `providers`: provider descriptor and required request/stream handlers.

Use runtime registration for dynamic scope or deterministic cleanup.

## Security and installation

Plugins run unsandboxed with Avi main-process privileges. Review source, dependencies, endpoints, CSS, schemas, file/process/network behavior, and credential handling. Never hard-code secrets.

Installation accepts a reviewed `.js` or `.zip`, stages and validates it, and stores it at `$INSTALL_DIR/plugins/<id>/plugin.js`. Disabled plugins use `plugin.js.disabled` and are never imported. Package enable, disable, update, and removal currently require restart to affect loaded code.

Never install or execute third-party plugin code without explicit authority. Use `/create-plugin` to implement minimally and validate before sideloading.

## Parameters are JavaScript, not frontmatter

Workflow and skill frontmatter controls catalog metadata only. Plugin capabilities, options, schemas, lifecycle, registrations, and handlers come exclusively from the JavaScript contract.
