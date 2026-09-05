# Application updates

RPC v1 exposes GitHub release updates on authenticated **`WS /rpc`** connections. These methods are not available on conversation sockets. `rpc:discover` advertises the `app-updates` capability.

| Method | Params | Result |
| --- | --- | --- |
| `app:update-state` | None | Current `UpdateState`, without a network request. |
| `app:check-for-updates` | None | `UpdateState` after checking the latest stable release of `aivaxlabs/avi`. |
| `app:install-update` | None | `UpdateState` after downloading and handing off installation. The desktop app then shuts down, closing RPC connections. |

The installation method is an explicit administrative action: finish active work before calling it. It accepts no URL, file path, command, or version override. Only the newer release and matching platform asset selected by Avi can be installed. Repeated calls while an operation is active do not start another download or installer.

## UpdateState

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | `idle`, `checking`, `available`, `downloading`, `installing`, or `error`. |
| `currentVersion` | string | Running application version. |
| `latestVersion` | string or null | Version found in the release check. |
| `available` | boolean | A newer release is available. |
| `supported` | boolean | This installation supports in-app installation. |
| `unsupportedReason` | string or null | Why in-app installation is unavailable. |
| `progress` | number or null | Download percentage, when known. |
| `error` | string or null | Check, download, or installation-handoff failure. |
| `releaseUrl` | string or null | GitHub release page. |

Poll `app:update-state` for progress. There is no global WebSocket update notification. After installation and relaunch, reconnect and read the state again; an `installing` result confirms handoff, not completion of the external installer.

The local preload bridge exposes the same operations as `window.chatApp.app.updateState()`, `.checkForUpdates()`, and `.installUpdate()`. `.onUpdate(callback)` delivers state changes and returns an unsubscribe function.

See [Automatic updates](../../Automatic%20updates.md) for platform requirements, release asset names, and publishing instructions.
