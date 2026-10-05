# Built-in plugins

These are ordinary trusted Plugin API v2 packages, distributed outside ASAR through `extraResources`. `.avi-plugin.json` contains inert catalog metadata; `plugin.js` is imported only after enablement and restart. Do not write settings into this directory.

Prepare with `bun run built-ins:prepare`. Each plugin owns its dependencies and lockfile. Package on the target OS/architecture; native desktop dependencies and the standalone Electron overlay are not cross-platform build artifacts. No dependencies are downloaded at plugin runtime. Computer Use keeps `get-windows` on every OS, but preparation runs its native installer only on Windows; macOS uses its bundled executable and Linux uses system window utilities. Windows ARM64 still requires the upstream source-build fallback when no prebuilt addon is available.

Validate platform selection and installer failures locally with `bun scripts/test-prepare-built-in-plugins.mjs`. This simulates Windows/macOS/Linux on x64/ARM64 without downloading dependencies; it does not replace native-platform packaging or desktop-permission validation.

## Sources

- Chrome extension: adapted from the user-provided ChromeMcpElectron extension (protocol v2). The Avi bridge replaces its HTTP daemon/MCP transport. The extension name and local endpoint change to Avi / port 55334, avoiding conflict with the original daemon on 55333.
- Computer Use: JavaScript runtime from `@cypherpotato/computer-use-mcp` 1.8.0, MIT (license included). The wrapper registers native Avi tools rather than running its MCP server. The overlay executable resolves to the plugin's bundled Electron distribution instead of `require('electron')`, which resolves to the host API inside Electron. Session ownership and cancellation are handled by the wrapper.

Control cancellation cannot roll back native input or browser JavaScript already dispatched. Validate overlay/input permissions, screenshots, manual-input pausing and installer resources on each release platform. The desktop dependency directory is approximately 428 MiB uncompressed on Windows x64; installer compression changes the download size.
