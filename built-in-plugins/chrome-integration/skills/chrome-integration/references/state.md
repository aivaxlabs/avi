# Session state

These helpers change the user's real browser profile. Logging the user out, deleting cookies or changing permissions has effects beyond the task; only do it when the task requires it.

## Cookies

- `browser.cookies({ url?, urls?, name?, domain? })` returns cookies for the current page (or the given URLs), including `httpOnly` ones, with `expires` as an ISO date or `"session"`.
- `browser.setCookies([{ name, value, domain?, url?, path?, secure?, httpOnly?, sameSite?, expires? }])` sets cookies. Without `domain` or `url`, the current page URL is used. `expires` is a Unix time in seconds or an ISO date.
- `browser.clearCookies({ name?, domain?, url? })` deletes the matching cookies of the current page.

Treat cookie values as secrets: do not print them in chat unless the user asks.

## Storage

- Read or write `localStorage` and `sessionStorage` directly in your code.
- `browser.clearStorage({ origin?, types? })` clears site data for an origin (current page by default). `types` is a list such as `["local_storage", "indexeddb", "cache_storage", "service_workers", "cookies"]`; default is everything.

## Permissions

`browser.setPermission(name, setting, origin?)` sets a Chrome site setting for the page's site (or `origin`). Reload the page when it already asked.

- Names: `geolocation`, `camera`, `microphone`, `notifications`, `popups`, `downloads` (multiple automatic downloads), `clipboard`, `images`, `javascript`, `cookies`.
- Settings: `allow`, `block`, `ask`; `cookies` also accepts `session_only`. `default` removes every rule Avi set for that permission.

Geolocation also needs a position: see [emulation](./emulation.md).
