# Tabs and navigation

`chrome_manage_tab` changes tabs and waits for loading to finish. It returns the resulting tab, including its `tab_id`, or a `warning` when loading timed out (the action still happened).

| `action` | Needs | Effect |
| --- | --- | --- |
| `open` | `url` (default `about:blank`); optional `tab_id`, `active`, `new_window` | New tab, placed after `tab_id` in its profile. Without `tab_id`, exactly one profile must be connected. |
| `navigate` | `tab_id`, `url` | Loads the URL. Use it also to leave restricted pages such as `chrome://` URLs. |
| `reload` | `tab_id`; optional `bypass_cache` | Reloads. |
| `back`, `forward` | `tab_id` | History navigation. |
| `activate` | `tab_id` | Focuses the tab and its window. |
| `close` | `tab_id` | Closes the tab; its ID expires. |

URLs without a scheme get `https://`.

Within `chrome_run_actions`, `browser.navigate(url)` navigates the current tab after the code returns and waits for loading, so read the destination in the next call. Clicking links works as usual; when the page navigates mid-action, the result says `navigated: true` and the snapshot shows the new page.

## Popups and new tabs

When an action opens a tab (a `target=_blank` link, `window.open`, an OAuth popup), the output ends with `New tabs opened by this action (tab_id): ...`. Use that ID directly. `chrome_get_context` also reports `opener_tab_id` and which tab is `active`.

Popup windows that the page opens are ordinary tabs. Pages that need popups may require `browser.setPermission("popups", "allow")` ([state](./state.md)).

## Restricted pages

`chrome://`, the Chrome Web Store, other extensions' pages and the built-in PDF viewer cannot be scripted (`controllable: false`). Navigate those tabs elsewhere or open a new tab.
