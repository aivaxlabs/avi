# Network

## Inspecting

| Helper | Description |
| --- | --- |
| `browser.network("requests", { filter?, method?, type?, status?, clear? })` | Lists recorded requests. `clear` removes the listed requests from the record. |
| `browser.network("request", id)` | Request and response details, including bodies. |
| `browser.networkLogs({ filterMethod?, filterPath? })` | Compact request list. |
| `browser.inspectNetworkRequest(id)` | Details of one request from that list. |

```javascript
const logs = await browser.networkLogs({ filterMethod: "POST", filterPath: "/api/" });
return await browser.inspectNetworkRequest(logs.requests[0].id);
```

## Mocking and blocking

`browser.network("route", url, options)` intercepts requests whose URL contains `url`, or matches it as a `*` glob.

| Option | Effect |
| --- | --- |
| `body`, `status` | Mocks the response. The request never reaches the server. |
| `abort: true` | Blocks the request. |
| `headers` | Response headers for a mock; extra request headers otherwise. |
| `resourceType` | Limits the match to one resource type. |

```javascript
await browser.network("route", "*/api/user", { body: { name: "Ada" }, status: 200 });
```

A mocked body is served as JSON when it parses as JSON and as plain text otherwise. Pass `headers: { "Content-Type": "text/html" }` to mock a document. Routing a URL again replaces its route, and when several routes match the newest one wins.

`browser.network("unroute", url?)` removes one route, or all of them. Remove your routes before handing the page back to the user.

A mock the browser refuses is reported in `browser.consoleLogs()` and the request fails.

Interception starts with the first `route` call and stays on until the session closes, which adds a small delay per request.
