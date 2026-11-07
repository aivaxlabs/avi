# Troubleshooting

| Symptom | Cause and action |
| --- | --- |
| `Tab ID expired or not found` | Call `chrome_get_context` again and use the new ID. |
| Empty tab list | The extension is not connected in that profile. Ask the user to install or reload the Avi extension. |
| `Reload the Avi Chrome extension` | Avi and the extension use different protocol versions after an update. Ask the user to reload it in `chrome://extensions`. |
| `Could not attach ... Close DevTools` | DevTools is open on that tab. Ask the user to close it. |
| Attach error naming a `chrome-extension://` frame | Another extension injected a frame. Ask the user to close its popup or disable it for the site, then reload the tab. If the error says the frame is gone, retry once. |
| `No element matches` | The ref is from an older snapshot or the page changed. Take a new snapshot. |
| Result has `coveredBy` | An overlay, modal or banner intercepted the click. Close it first. |
| `Focused element is not editable` | Click the field first, or use `browser.fill(target, text)`. |
| Typed text disappears or the mask breaks | Use `{ keys: true }` on `type` or `fill`. |
| `x is not defined` for a page variable | Your code runs in an isolated world. Use `browser.evaluate`. |
| `Action timed out` | Raise `timeout_ms`, split the work into shorter calls, or wait for a condition instead of sleeping. The action may have partly run; inspect before retrying. |
| Screenshot timed out | Chrome does not paint some background tabs. Activate the tab with `chrome_manage_tab` and retry. |
| `A JavaScript dialog blocks the page` | See [dialogs](./dialogs.md). |
| Nothing happens on click in a cross-origin iframe | Script the frame with `frame_id` ([frames](./frames.md)). |

Chrome shows a "started debugging this browser" banner while Avi is attached. Closing it detaches Avi from the tab; the next action reattaches, but routes and emulation set earlier are lost.
