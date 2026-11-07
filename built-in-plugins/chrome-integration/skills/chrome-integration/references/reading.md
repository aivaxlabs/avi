# Reading and waiting

## Snapshot

`browser.snapshot(options?)` returns URL, title, viewport, scroll position, page size, console error counts since the last load, cross-origin frames, then one line per interactive or heading element:

`@12 340,210 120x32 button[type=submit][disabled] "Sign in"`

That is the ref, top-level viewport position and size, tag and attributes, label, and `value="..."` for fields. States `[disabled]`, `[checked]`, `[selected]` and `[expanded=...]` are shown. Visible page text follows (4000 characters by default).

Options:

- `{ full: true }` includes elements outside the viewport (marked `offscreen`), up to 500.
- `{ maxNodes, maxText }` raise limits (2000 elements, 50000 characters).
- `{ selector: "main" }` limits the snapshot to one element's subtree.

When the snapshot ends with `… N more elements`, narrow with `selector` or raise `maxNodes`. A fresh snapshot comes back after every action unless you pass `snapshot: false` to `chrome_run_actions`.

## Queries

- `browser.query(target)` returns the first matching element or `null`; `browser.queryAll(target)` returns all. Both search open shadow roots and same-origin frames.
- `browser.rect(target)` returns `{x, y, width, height, centerX, centerY}` in top-level viewport pixels.
- Plain DOM APIs work too: `return [...document.querySelectorAll("table tr")].map(row => row.innerText);`. Inside same-origin frames, `getBoundingClientRect()` is frame-relative; use `browser.rect()` for coordinates.

## Waiting

Do not use fixed sleeps when a condition exists.

- `browser.waitFor(target, { state?, timeout? })` waits until the element is `visible` (default), `attached`, `hidden` or `detached`. Timeout defaults to 5000 ms.
- `browser.waitFor(() => condition, { timeout })` polls a function until it returns a truthy value, which is returned.
- `browser.waitForResponse(...)` and `browser.waitForNetworkIdle(...)` wait for network activity ([network](./network.md)).
- `browser.sleep(ms)` only for an observed need such as an animation.
- Keep the total under the call's `timeout_ms`.

## Page JavaScript

Your code cannot see page variables. `browser.evaluate(fn, ...args)` runs `fn` in the page's own world and returns its JSON result: `await browser.evaluate(() => window.store.getState().user)`. Arguments must be JSON-serializable. A string runs as an expression.

## Console

`browser.consoleLogs({ level?, search?, limit?, sinceLoad?, clear? })` returns console messages, uncaught exceptions and browser log entries (network, security, deprecation) collected by the debugger, including those before your first action and from iframes. `level` accepts `error`, `warn`, `info`, `log`, `debug` or a list. Messages before the debugger first attached to the tab are not available.
