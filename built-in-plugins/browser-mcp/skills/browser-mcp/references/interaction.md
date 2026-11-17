# Interaction

| Helper | Description |
| --- | --- |
| `browser.click(target, { button?, count?, duration? })` | Clicks an element. |
| `browser.dblclick(target)` | Double clicks. |
| `browser.leftClick(target, duration?)`, `browser.rightClick(target, duration?)` | Left or right click, optionally holding the button. |
| `browser.hover(target)` | Moves the pointer over an element. |
| `browser.fill(target, text)` | Replaces the value of an input, textarea or contenteditable element. |
| `browser.focus(target)` | Focuses an element. |
| `browser.type(text)` | Types into the focused element. |
| `browser.press(key)` | Presses a key or chord: `Enter`, `Tab`, `Escape`, `ArrowDown`, `Control+a`, `Shift+Tab`. |
| `browser.keyboard(action, value)` | `type`, `inserttext`, `down` or `up`. |
| `browser.mouse(action, ...)` | `move` (x, y), `down` (button?), `up` (button?) or `wheel` (deltaY, deltaX?). |
| `browser.select(target, ...values)` | Selects options by value or label. Also drives ARIA comboboxes. |
| `browser.check(target)`, `browser.uncheck(target)` | Sets a checkbox, radio or switch. Fails when the click does not change the state. |
| `browser.drag(from, to, duration?, isLeftClick?)` | Drags between two targets or coordinates. |
| `browser.scroll(target, deltaY, deltaX?)` | Scrolls with the mouse wheel over a target. |

Prefer `fill` for form fields. `type` needs a focused element: use `focus` or `click` first.

Pointer helpers (`click`, `leftClick`, `rightClick`, `dblclick`, `hover`, `scroll`, `drag`) accept viewport CSS pixels in place of a target. A point with no element under it is an error, except as the destination of `drag`.

The `target` returned by pointer and focus helpers describes the element without the value of text fields. Read a value with `browser.get("value", target)`.

Keys and mouse buttons left down by `keyboard("down")` or `mouse("down")` are released when the script ends.

## Locating without a ref

`browser.find(strategy, value, action?, text?, { name?, exact? })` locates an element and acts on it in one call.

- `strategy`: `role`, `text`, `label`, `placeholder`, `alt`, `title`, `testid`, `first`, `last`, or `nth`.
- `action`: `click` (default), `dblclick`, `fill`, `focus`, `hover`, `check`, `uncheck`, or `text`. `text` is the value for `fill`.
- `first` and `last` take a selector as `value`. `nth` takes the index first: `browser.find("nth", 2, "li.item", "click")`.

```javascript
await browser.find("role", "button", "click", undefined, { name: "Save" });
await browser.find("label", "Email", "fill", "user@example.com");
```
