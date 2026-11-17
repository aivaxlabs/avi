# Troubleshooting

| Symptom | Cause and action |
| --- | --- |
| `No active browser session` | Start one with `browser_toggle_session`. |
| `Multiple browser sessions are active` | Pass `session_id`. List them with `browser_get_context`. |
| `Browser session not found` | The session was stopped or its page closed itself. Start a new one. |
| `Stale ref` | The element is gone. Take a new snapshot and use a fresh ref. |
| A click reports that the element is covered | An overlay, modal or banner sits at the click point. Close it first. |
| Result has `pendingDialog` | Answer it first ([dialogs](./dialogs.md)). |
| Result has `confirmationRequired` | The action was held ([dialogs](./dialogs.md)). |
| Result has `timedOut` | Raise `timeout_ms`, split the work, or wait for a condition. The page may have been reloaded; inspect before retrying. |
| Result is `{ navigated: true }` | The page changed document mid-script. Continue in a new call ([sessions](./sessions.md)). |
| A selector does not match inside a component | It crosses a shadow boundary ([frames](./frames.md)). |
| `File already exists` | Downloads and HAR files are never overwritten. Choose another path. |
| The tools are missing or the MCP server is not connected | On the first run the daemon is downloaded in the background and connects only after Avi restarts. Otherwise the install failed (it needs npm, bun or pnpm and network access) or the daemon stopped. Tell the user to restart Avi. |

`browser.inspect()` opens DevTools for the session; it works together with your actions.
