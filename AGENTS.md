# Avi project guide

## Project overview
- Avi is a local Electron desktop workspace for AI conversations, providers, tools, MCP servers, context discovery, and multi-agent orchestration.
- The project is an ESM JavaScript application. Bun runs scripts and dependency management, Electron hosts privileged runtime code, React renders the UI, Vite builds the renderer, and Cascadium compiles XCSS.
- Start architecture discovery at `src/main/main.js`, `src/main/runtime.js`, `src/preload/preload.cjs`, and `src/renderer/main.jsx`. User-facing behavior is documented under `docs/`.

## Architecture and boundaries
- `src/main/` owns Electron lifecycle, persistence, providers, chat execution, tools, MCP, plugins, filesystem operations, and IPC handlers. Read `src/main/AGENTS.md` before changing this boundary.
- `src/preload/preload.cjs` is the only renderer privilege bridge. Renderer code consumes `window.chatApp`; it must not import Electron or Node APIs.
- `src/renderer/` contains the main and Quick Chat React applications. Styles are authored under `src/styles/`; read `src/renderer/AGENTS.md` before UI or style work.
- `src/providers/` contains built-in provider implementations registered by `src/providers/index.js`. Keep provider-specific protocol/authentication behavior there; shared selection, retries, and stream handling belong in `src/main/model-provider.js`.
- `src/prompts/` contains base/personality prompts and the authoring source for context shipped with Avi. Read `src/prompts/AGENTS.md` before changing prompts or bundled context.
- `plugins/` contains trusted install-wide plugin sources and managed materialized context. Read `plugins/AGENTS.md` before plugin work.
- `src/shared/` is code shared across runtime boundaries. `scripts/` contains builds and focused executable tests. `dist/`, `artifacts/`, and `plugins/.avi/` are generated or managed output.

## Commands
Run commands from the repository root.

- Install dependencies: `bun install`
- Develop with Vite, Cascadium watch, and Electron: `bun run dev`
- Develop with renderer DevTools: `bun run dev:devtools`
- Build the renderer: `bun run build`
- Parse-check `scripts/` and `src/main/`: `bun run syntax`
- Package installers: `bun run package -- --publish never`
- Run a focused test through its `package.json` script when available. Tests live in `scripts/test-*.mjs`; some focused tests intentionally have no package alias.

Do not run provider/network/AI-consuming tests unless the changed behavior requires them and the needed account or endpoint is configured. Packaging is a release-level validation, not the default check for ordinary changes.

## Project-wide conventions
- Make the smallest coherent change and preserve the existing cross-process separation.
- Keep the IPC API synchronized across `src/preload/preload.cjs`, the logical handlers in `src/main/runtime.js`, and renderer callers.
- Treat `src/renderer/styles.css` as tracked generated output. Edit `src/styles/**/*.xcss` and regenerate it with `bun run styles`.
- Do not edit `dist/`, `artifacts/`, or `plugins/.avi/` as source.
- Electron-dependent modules can fail under plain Bun because native modules and Electron exports require the Electron runtime. Use the repository's Electron-based test command or `bun x electron ...` when the target imports Electron/native persistence code.
- Keep user documentation aligned when changing visible behavior, settings, context discovery, provider configuration, or plugin contracts. `docs/Plugins.md` is the authoritative public plugin contract.

## Validation
1. Run the narrowest affected `scripts/test-*.mjs` or `bun run test:<area>` command.
2. Run `bun run syntax` for main-process or script changes; it does not cover JSX, preload, or `src/providers/`.
3. Run `bun run styles` after XCSS changes and include the regenerated `src/renderer/styles.css` diff.
4. Run `bun run build` for renderer, preload-facing, or packaging-boundary changes.
5. Use the Electron smoke path for IPC/window/runtime changes: in PowerShell, set `CHAT_APP_SMOKE_TEST=1`, run `bun x electron .`, then remove the variable.
6. Review the final diff and report unrelated failures separately.

## Instruction map
- `src/main/AGENTS.md`: Electron runtime, IPC, providers, chat/tools, persistence, and main-process validation.
- `src/renderer/AGENTS.md`: React UI, preload API consumption, XCSS sources, accessibility, and renderer validation.
- `src/prompts/AGENTS.md`: base/personality prompts plus shipped Avi instructions, workflows, skills, discovery conventions, and packaging.
- `plugins/AGENTS.md`: trusted plugin API v1, contribution contracts, materialized context, and plugin tests.
