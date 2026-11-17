# Sessions and navigation

## Sessions

| Tool | Use |
| --- | --- |
| `browser_toggle_session` `{ action: "start", start_url }` | Opens a browser window. Returns `process_id`, `session_id` and `title`. Use `about:blank` for an empty page. |
| `browser_toggle_session` `{ action: "stop", session_id }` | Closes that window. |
| `browser_get_context` | Lists sessions with `session_id`, `title`, `state` and the URL without its query. |
| `browser_import_session` `{ session }` | Opens a new window from a Session Copy extension payload (URL, cookies, `localStorage`, `sessionStorage`). |

States: `idle` is ready, `waiting` is loading or running an action, `user_input` has a JavaScript dialog pending ([dialogs](./dialogs.md)).

With more than one session, `browser_run_actions` without `session_id` fails with `Multiple browser sessions are active`. A page that calls `window.close()` ends its session.

`browser.session("current")` and `browser.session("list")` return the same information from inside a script.

## Navigation

| Helper | Description |
| --- | --- |
| `browser.navigate(url)` | Loads a URL and waits for it. Rejects `javascript:` URLs. |
| `browser.back()`, `browser.forward()`, `browser.reload()` | History navigation. |
| `browser.pushstate(url)` | Client-side navigation through `history.pushState`, within the current origin. |

A script runs inside the page, so it ends when the page loads another document. Make the navigating call (`navigate`, `back`, `forward`, `reload`, or a click that follows a link) the last statement and continue in a follow-up call. Statements after it may not run; the call then returns the result of the last helper, or `{ navigated: true }` when there was none.

A page cannot veto navigation with `beforeunload`: the browser always leaves the page and no dialog is reported.

## Timeouts

`timeout_ms` covers the whole script. Waits never outlast it: their default and maximum timeout is the time left.

A helper still loading a document when the time runs out is left to finish, for up to 15 seconds. Any other script that times out is stopped by reloading the page, so the result has `timedOut` and the page state may be lost. Inspect before retrying.
