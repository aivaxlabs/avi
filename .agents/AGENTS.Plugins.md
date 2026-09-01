---
description: Applies to plugins, the public plugin contract, and plugin host integration.
embeddable: false
---
# Plugin guide

## Security and loading boundary
- Plugins are trusted, unsandboxed ESM executed with Electron main-process privileges. Never install, enable, or execute an unreviewed external plugin merely to inspect it.
- A source plugin lives at `plugins/<plugin-id>/plugin.js`, exports a default API v2 definition or factory, and declares an ID matching its directory. Use `plugins/pitch-black-theme/plugin.js` as the smallest checked-in example.
- Plugins cannot inject arbitrary renderer JavaScript. UI contributions are declarative descriptors interpreted by Avi; theme CSS is still trusted CSS.
- `docs/Plugins.md` and `docs/api/` are the authoritative public contract. Keep them synchronized with `src/main/plugin-api.js`, `src/main/plugin-manager.js`, `src/main/plugin-runtime.js`, `src/main/plugin-domain-api.js`, and runtime wiring.

## API v2 conventions
- Definitions use `apiVersion: 2`, an explicit `capabilities` array, optional `activate(avi)` and `deactivate(reason)`, and optional static contributions.
- Prefer runtime registration for dynamic tools, scoped context, panels, provider types, events, interceptors, and resources that need deterministic cleanup.
- Every runtime registration must return or use a tracked `Disposable`; Avi removes tracked resources during deactivation.
- Keep events observational. Behavior-changing hooks belong in the typed interceptor API.
- Never expose database rows, ChatRunner, BotManager, Electron objects, credentials, or mutable runtime state as public API values. Use handles and detached snapshots.

## Contribution conventions
- Static contribution types are `context`, `mcps`, `tools`, `auxiliaryPanels`, `themes`, `personalities`, and `providers`.
- Keep non-function descriptor data JSON-like and use the exact documented shapes. IDs should be lowercase kebab-case and are collision-checked case-insensitively.
- Keep executable behavior in documented top-level handlers. Do not add arbitrary functions to serializable descriptors or bypass application-controlled tool, provider, panel, and permission handling.

## Managed output
- `plugins/.avi/<plugin-id>/context/` is materialized from accepted static context contributions.
- Runtime context is stored under the plugin's managed `runtime-context/` root.
- Plugin KV storage is isolated under `plugins/.avi-storage/<plugin-id>/storage.json` so context rematerialization does not erase it.
- Never edit managed output directly. Change the plugin source or use the public runtime API.

## Validation
- Run `bun run test:plugins` after changing definitions, lifecycle, capabilities, storage, registrations, loading, validation, installation, collisions, timeouts, ZIP safety, or context materialization.
- Run `bun run test:context` when plugin context discovery, scoping, or precedence changes.
- Run `bun run syntax` for host changes under `src/main`; validate each edited plugin entrypoint directly because the syntax script does not scan `plugins/`.
- Treat application startup with the source plugin as a supplementary trusted-code smoke, not a replacement for focused plugin tests.
