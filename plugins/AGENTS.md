---
description: Rules and onboarding context for Avi's trusted install-wide plugin sources and managed plugin context output.
---
# Plugin guide

## Security and loading boundary
- Plugins are trusted, unsandboxed ESM executed with Electron main-process privileges. Never install, enable, or execute an unreviewed external plugin merely to inspect it.
- A source plugin lives at `plugins/<plugin-id>/plugin.js`, exports a default API v1 definition or factory, and declares an ID matching its directory. Use `plugins/pitch-black-theme/plugin.js` as the smallest checked-in example.
- Plugins cannot inject arbitrary renderer JavaScript. UI contributions are declarative descriptors interpreted by Avi; theme CSS is still trusted CSS.
- `docs/Plugins.md` is the authoritative public contract. Keep it synchronized with changes to `src/main/plugin-api.js`, `src/main/plugin-manager.js`, plugin runtime wiring, or contribution schemas.

## Contribution conventions
- Use only the validated contribution types: `context`, `mcps`, `tools`, `auxiliaryPanels`, `themes`, `personalities`, and `providers`.
- Keep non-function descriptor data JSON-like and use the exact documented shapes. IDs should be lowercase kebab-case and are collision-checked case-insensitively.
- Keep executable behavior in the documented top-level handlers. Do not add arbitrary functions to serializable descriptors or bypass application-controlled tool, provider, panel, and permission handling.
- Plugin storage and contribution changes take effect on application restart; do not invent disposal or live-reload lifecycle behavior not present in API v1.

## Managed output
- `plugins/.avi/<plugin-id>/context/` is materialized from accepted context contributions and managed by `PluginManager`. Never edit, move, or add instruction files inside `plugins/.avi/`.
- Change the plugin source contribution and restart/revalidate instead. The manager owns cleanup of stale materialized roots.

## Validation
- Run `bun run test:plugins` after changing plugin definitions, loading, validation, installation, collisions, timeouts, ZIP safety, or context materialization.
- Run `bun run test:context` when plugin context discovery or precedence changes.
- Run `bun run syntax` for host changes under `src/main`; validate each edited plugin entrypoint directly because the syntax script does not scan `plugins/`.
- Treat application startup with the source plugin as a supplementary trusted-code smoke, not a replacement for focused plugin tests.
