# Environment

| Helper | Description |
| --- | --- |
| `browser.set("viewport", width, height)` | Resizes the emulated viewport, enabling mobile emulation first when needed. |
| `browser.set("device", name)` | `mobile`, `tablet`, or `desktop`. |
| `browser.set("geo", latitude, longitude)` | Overrides geolocation. Without arguments, clears the override. |
| `browser.set("offline", boolean)` | Turns the network off or on. |
| `browser.set("headers", object)` | Extra HTTP headers for every request. |
| `browser.set("credentials", username, password)` | HTTP Basic credentials for every request. |
| `browser.set("media", { colorScheme?, reducedMotion? })` | Emulates `prefers-color-scheme` and `prefers-reduced-motion`. |
| `browser.setViewport(width, height)`, `browser.setEmulation(mode)`, `browser.setColorScheme(scheme)` | Shortcuts for the settings above. |

Viewport emulation uses mobile metrics, so a page without `<meta name="viewport">` is laid out 980 px wide, as on a phone.

`set("credentials")` sends the `Authorization` header to every origin the page loads, including third parties. Use it only on pages whose resources you trust, and prefer a login profile ([state](./state.md)) when the site has a login form.

Settings last for the session. Restore the ones you changed, such as `offline` and `headers`, before handing the page back to the user.
