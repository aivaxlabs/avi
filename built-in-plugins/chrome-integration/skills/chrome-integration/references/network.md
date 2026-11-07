# Network

Network activity is recorded from the moment the debugger attaches to the tab, including iframes. The latest 500 requests are kept.

## Inspecting

- `browser.networkLogs({ url?, method?, status?, type?, failed?, since?, limit? })` lists requests with `id`, method, URL without query, status, type (`Document`, `XHR`, `Fetch`, `Script`, ...), MIME type, size, duration and errors. `url` matches a substring, or a glob when it contains `*`. `since` takes a request `id` to see only newer requests.
- `browser.inspectNetworkRequest(id, { maxBytes? })` returns full URL, request headers and body, response headers, and the response body (20000 characters by default, up to 2 MB). Binary bodies come as base64. Bodies of old or streamed requests may be gone.

## Waiting

- Start the action and wait in the same call:
  ```js
  const response = browser.waitForResponse({ url: "/api/orders", method: "POST" }, { timeout: 15000 });
  await browser.click("text=Place order");
  return await response;
  ```
  Create the wait before the action so a fast response is not missed. A string filter is a URL substring.
- `browser.waitForNetworkIdle({ idleMs?, timeout? })` waits until no request has been in flight for `idleMs` (500 by default).

## Mocking and blocking

`browser.route(rule)` intercepts matching requests until removed and returns its `id`. Rules apply in creation order; the first match wins.

- Block: `{ url: "*://*.ads.example/*", action: "block" }`.
- Fake a response: `{ url: "*/api/user", action: "fulfill", status: 200, json: { name: "Test" } }`. Use `body` for text, `bodyBase64` for binary, `headers`, `contentType`.
- Modify: `{ url: "*/api/*", action: "continue", setHeaders: { "x-debug": "1" } }`, with `setUrl`, `setMethod` or `setPostData`. A header set to `null` is removed.
- Optional match fields: `method`, `resourceType`, `times` (remove after N hits).
- `browser.unroute(id)` removes one rule; `browser.unroute()` removes all.

Routes persist for the tab until removed, the debugger detaches or Avi restarts. Remove them when the task is done.

## Other controls

- `browser.setExtraHeaders({ name: value })` adds headers to every request; `{}` clears.
- `browser.setNetworkConditions("offline" | "slow3g" | "fast3g" | "none")` or `{ offline, latency, downloadKbps, uploadKbps }`.
- `browser.setCacheDisabled(true)`.
- `browser.setHttpCredentials({ username, password })` answers HTTP Basic or Digest prompts; `null` disables.

Calling the site's API directly with `fetch()` from your code uses the page origin and its cookies, which is often faster than clicking through screens.
