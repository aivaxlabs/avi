---
description: Applies to src/main, src/providers, src/preload, and related runtime scripts and tests.
embeddable: false
---
# Main-process guide

## Scope and architecture
- `main.js` only enforces the single-instance lifecycle, rotates tracing, and imports `runtime.js` after Electron is ready. Keep feature initialization in `runtime.js` or the responsible module.
- `runtime.js` is the composition root for windows, database-backed services, `ChatRunner`, `QuickChatRunner`, providers, MCP, plugins, tray/shutdown, and logical IPC handlers.
- `chat-runner.js` owns conversation execution and tool orchestration. `model-provider.js` owns provider selection, globally qualified `<providerId>:<modelId>` identities, connection retries, abort propagation, and stream aggregation.
- `database.js` owns persisted application state and Electron secure storage. Tests importing it may need Electron rather than plain Bun.

## Cross-process and security boundaries
- Ordinary application requests use the single `ipcRenderer.invoke('avi:invoke', { channel, payload })` gateway. Register logical handlers through the existing `applicationIpc.handle(...)` map in `runtime.js`; do not add independent `ipcMain.handle` endpoints without an architectural reason.
- The renderer-facing contract is `window.chatApp` in `src/preload/preload.cjs`. Add or change a capability coherently across the runtime handler, preload method, renderer caller, and event subscription/cleanup when applicable.
- Preserve BrowserWindow security settings and trusted-navigation checks: context isolation stays enabled, Node integration stays disabled, and renderer code receives no direct Electron/Node access.
- Keep structured success/error envelopes and cancellation semantics consistent with the existing gateway and runners.

## Providers and tools
- Built-in provider implementations live in `src/providers/` and must pass the descriptor/handler contract in `provider-api.js`. Keep endpoint-specific bodies, requests, authentication, and event conversion in those implementations.
- Keep shared provider configuration, model qualification, contributions, retries, and streaming behavior in `model-provider.js`; do not duplicate retry loops inside provider request implementations.
- Provider-contributed models, tools, and auxiliary panels are application-controlled descriptors. Keep descriptor data serializable and namespace runtime panel identity as `<providerId>:<panelId>`.
- Reuse the existing tool composition, approval, interruption, and trace patterns. Do not bypass permission handling when adding a tool path.

## Validation
- Run `bun run syntax` after changing `src/main` or scripts.
- Select focused tests by affected module, for example: `bun run test:context`, `bun run test:plugins`, `bun run test:default-models`, `bun run test:server-retry`, `bun run test:mcp`, `bun run test:remote`, `bun run test:interruptions`, or `bun scripts/test-quick-chat.mjs`.
- `bun run syntax` does not parse `src/providers/`; pair provider changes with the provider-specific test and `bun run build` or another direct parse/runtime check.
- Use package-defined Electron tests for Electron/native boundaries (`test:aivax`, `test:prompt-expansion`, `test:archive`, `test:search`). For broader IPC/window changes, run the `CHAT_APP_SMOKE_TEST=1` Electron smoke described in the root guide.
