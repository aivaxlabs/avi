# Reading and waiting

## Snapshot

`browser.snapshot(options?)` returns a header (URL, title, viewport, pending dialog, console counts) and the accessibility tree. Elements you can act on carry a ref:

```text
- heading "Sign in" [level=1, ref=e1]
- textbox "Email" [ref=e2]
- button "Continue" [ref=e4]
```

Options: `interactive` (only elements with a ref), `compact`, `depth`, `selector` (only that subtree), `urls` (link targets), `maxLength`. A long snapshot ends with a `[truncated ...]` line; narrow it with `{ interactive: true, compact: true, selector, depth }` before raising `maxLength`.

The console counters in the header cover the current document only.

## Reading

| Helper | Description |
| --- | --- |
| `browser.get(what, target?, extra?)` | `text`, `html`, `value`, `attr` (`extra` is the name), `styles` (`extra` is a property list), `box`, `count` (`target` is a selector), `url`, or `title`. |
| `browser.is(state, target)` | `visible`, `enabled`, or `checked`. |
| `browser.read(url?, { filter?, outline?, raw?, maxLength? })` | The page as Markdown. With a URL it navigates first. `outline` lists the headings, `filter` keeps the matching sections. |
| `browser.shadowelements(target?)` | Refs of the elements inside shadow roots ([frames](./frames.md)). |
| `browser.highlight(target)` | Outlines an element for 3 seconds, to show it to the user. |
| `browser.inspect()` | Opens DevTools for the session. |
| `browser.consoleLogs()` | Recent console entries, uncaught exceptions and browser messages such as failed resources. Keeps the entries of earlier pages. |
| `browser.errors({ clear? })` | Uncaught exceptions and unhandled promise rejections, with stack, line and column. |

Use `read` for long text content and `snapshot` for structure and refs.

## Waiting

| Helper | Description |
| --- | --- |
| `browser.wait(ms)`, `browser.sleep(ms)` | Waits a fixed time. |
| `browser.wait(target, { state?, timeout? })` | Until the target is `visible` (default), `hidden`, `attached`, or `detached`. |
| `browser.wait({ text, timeout? })` | Until the page contains the text. |
| `browser.wait({ url, timeout? })` | Until the URL matches a `*` glob. |
| `browser.wait({ load, timeout? })` | `load`, `domcontentloaded`, or `networkidle`. |
| `browser.wait({ fn, timeout? })` | Until a JavaScript expression, evaluated in the page's own world, is truthy. |
| `browser.wait({ download, timeout? })` | Until a download finishes ([files](./files.md)). |

Wait for a condition instead of a fixed time. The default and maximum wait is the time left in `timeout_ms`, so raise `timeout_ms` for long waits.
