# Interaction

Every helper takes a target: `"@12"`, a CSS selector, `"text=..."`, an element or `{x, y}`. Pointer helpers return `{ ok, target }`; when another element covers the target's center they also return `coveredBy` — close that overlay or cookie banner first.

## Pointer

- `browser.click(target, { button?: "left"|"right"|"middle", clickCount?, duration? })`. `duration` holds the button down (long press) in milliseconds.
- `browser.doubleClick(target)`, `browser.rightClick(target)`, `browser.hover(target)`.
- `browser.scroll(target?, { deltaX?, deltaY? })` sends a wheel at the target (default: viewport center, `deltaY: 400`). Scroll inside a specific list by targeting it. Negative values scroll up or left.
- `browser.drag(from, to, { duration?, button? })` drags with real mouse movement. HTML5 drag-and-drop (`draggable`, `dataTransfer`) is detected and completed automatically; the result says `html5: true` when used.
- Coordinate forms remain available: `click(x, y)`, `leftClick(x, y)`, `hover(x, y)`, `scroll(x, y, deltaY)`, `drag(x1, y1, x2, y2)`.

## Text

- `browser.fill(target, text)` clicks the field, selects its content and replaces it. It works for inputs, textareas and contenteditable editors. `fill(target, "")` clears. Date, time, color and range inputs receive the value directly.
- `browser.type(text)` inserts text into the focused field.
- `{ keys: true, delay? }` on `type` or `fill` types character by character with real key events. Use it for masked inputs, autocompletes, search-as-you-type and fields that ignore pasted text.
- Password values are masked in snapshots.

## Keys

- `browser.press("Enter")`, `press("Control+A")`, `press("Shift+Tab")`, `press("ControlOrMeta+C")`.
- Names: letters, digits, punctuation, `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Insert`, `Space`, arrows, `Home`, `End`, `PageUp`, `PageDown`, `F1`–`F24`, `Numpad0`–`Numpad9`, `NumpadEnter`, `CapsLock`, `ContextMenu`. Modifiers: `Control`/`Ctrl`, `Shift`, `Alt`, `Meta`/`Cmd`, `ControlOrMeta`.
- Hold keys with `browser.keyDown("Shift")` … `browser.keyUp("Shift")`; held modifiers apply to clicks in between (for example multi-select).

## Forms

- `browser.select(target, valueOrLabel | [values])` sets a native `<select>` by value or visible label and fires `input`/`change`. Custom dropdowns are ordinary elements: click to open, snapshot, click the option.
- `browser.check(target, checked = true)` clicks a checkbox, radio or `aria-checked` switch only when its state differs, and returns the final state.
- Submit by clicking the submit button, or `press("Enter")` in a field.

## Touch

`browser.tap(target, { duration? })` and `browser.swipe(from, to, { duration? })` send touch events. Pages only react to touch when touch emulation is on ([emulation](./emulation.md)).
