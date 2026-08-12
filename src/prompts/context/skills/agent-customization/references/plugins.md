# Plugins in Avi

Use a plugin when one trusted, install-wide JavaScript extension needs to contribute multiple Avi capabilities or main-process behavior. For static guidance alone, prefer instructions, a workflow, or a skill. For a standalone external integration, prefer MCP.

Read `docs/Plugins.md` before authoring or reviewing a plugin. The executable contract is a trusted ESM `plugin.js` loaded from `$INSTALL_DIR/plugins/<plugin-id>/plugin.js`. Installation accepts a `.js` source or a `.zip` package with optional supporting files.

## Version 1 contract

The default export is an object or async factory receiving:

```js
{ apiVersion: 1, definePlugin }
```

The returned definition is:

```js
{
  apiVersion: 1,
  id: 'example-plugin',
  name: 'Example plugin',
  version: '1.0.0',
  contributions: {
    context: [],
    mcps: [],
    tools: [],
    auxiliaryPanels: [],
    themes: [],
    personalities: [],
    providers: [],
  },
}
```

All contribution arrays are optional. IDs should be lowercase kebab-case and must satisfy the ASCII plugin ID pattern. Plugin, tool, provider, panel, theme, and personality collisions are rejected case-insensitively. Descriptor data must be plain and serializable. Functions are allowed only as top-level contribution handlers.

The whole plugin is rejected when import, factory execution, validation, collision checks, or context materialization fails. Independent valid files can still load. Failures are logged and surfaced as startup warnings. Loaded status preserves optional plugin `description`, reports `status: 'loaded'`, directory, filename, nonempty capabilities, and contribution counts. The host's `getProviderTypes()` returns complete registry-ready provider objects.

## Contribution boundaries

- `context`: `{ path, content }` UTF-8 files materialized under `plugins/.avi/<plugin-id>/context`; this tree is managed and must not be edited.
- `mcps`: exactly `{ id, name, config }`; `config` uses only Avi's documented `stdio`, `streamable-http`, or `sse` and authentication fields. Plugin MCPs are managed/read-only and cannot be replaced by a same-name global user server.
- `tools`: exactly `{ name, description, inputSchema, execute }`. A dynamic provider/MCP tool with the same name wins for that invocation, and Avi omits only the conflicting plugin tool.
- `auxiliaryPanels`: exactly `{ id, title, load, invokeAction? }`; `load` returns declarative sections/items/actions state, never renderer JavaScript.
- `themes`: exactly `{ id, name, tagline, css }`; CSS is trusted and Avi injects it only while that plugin theme is selected.
- `personalities`: exactly `{ id, name, description, instructions }`.
- `providers`: existing `defineProvider` shape with serializable `descriptor: { id, name, ... }`, required `createBody`, `request`, and `eventsFrom`, and optional `getContributions`, `getState`, `invokeAction`, and `remove`.

Plugin context command precedence is workspace → global → installation → plugins once the plugin root is registered. Ordinary instruction authority is unchanged.

## Security and installation

Plugins run with Avi main-process privileges and are not sandboxed. Review the entire source, dependencies it launches, endpoints, CSS, schemas, file/process/network behavior, and credential handling. Never hard-code secrets.

Installation stages and executes one reviewed `.js` entrypoint or a reviewed `.zip` package for validation, then writes `$INSTALL_DIR/plugins/<id>/plugin.js`. The source filename is ignored. Reinstalling the same or a newer version atomically replaces the folder; an older version requires confirmation. Settings can disable a plugin by renaming its entrypoint to `plugin.js.disabled`, re-enable it, or remove the entire folder. Disabled code remains listed through host-written metadata but is never imported or executed. Loaded contributions remain active until restart because plugins run in the main process. Installation-directory permissions and installers/updaters can affect these files.

Never install or execute third-party plugin code without explicit user authority. Use the `/create-plugin` workflow to implement minimally and validate through the real loader before sideloading.

## Parameters are JavaScript, not frontmatter

Workflow and skill frontmatter only controls catalog metadata such as `name`, `description`, and `user-invocable`. It does not define plugin options, tool schemas, permissions, contribution fields, or lifecycle behavior. Plugin parameters come exclusively from the JavaScript contract documented in `docs/Plugins.md` and enforced by the loader.
