# Files

Paths are absolute paths on the user's computer. Only use files the task provides or that you created.

## Upload

- `browser.upload(target, path | [paths])` sets files on an `<input type=file>`, its `<label>`, or a button that opens the file chooser (the click is intercepted, so no system dialog appears). It fires the page's `change` event and returns the file names.
- Hidden file inputs work: target them with a selector such as `'input[type=file]'`.
- `browser.dropFiles(target, paths)` drops files onto a drag-and-drop zone.

## Downloads

Downloads go to the profile's download folder.

- Start the download (click the link or button), then `await browser.waitForDownload({ url?, timeout? })` in the same call. It resolves with `{ id, filename, state, bytesReceived, totalBytes, error, danger }`; `filename` is the saved absolute path.
- `browser.download(url, { filename?, conflict?, timeout? })` downloads a URL directly using the browser's cookies. `filename` is relative to the downloads folder; `conflict` is `uniquify` (default), `overwrite` or `prompt`.
- `browser.downloads({ limit?, state? })` lists recent downloads.
- A `danger` value means Chrome is holding the file for the user to keep or discard. Tell the user; do not try to bypass it.
- Read a downloaded file's contents with your own file tools.

## Screenshots

`browser.screenshot(options?)` attaches an image to the result and returns its size.

- Default: the visible viewport, in the same CSS pixels as action coordinates.
- `{ fullPage: true }` captures the whole page (capped at 16384 px tall, `truncated: true` when cut).
- `{ element: target }` captures one element; `{ clip: {x, y, width, height} }` a viewport area.
- `{ format: "jpeg"|"webp", quality }` reduces size.
- Return several screenshots in one object when comparing states.

## PDF

`browser.pdf({ path?, landscape?, background?, scale?, paperWidth?, paperHeight?, margin?, pageRanges? })` prints the page to PDF and returns `{ path, bytes }`. A relative `path` is resolved against the conversation's working folder; without `path` it goes to a temporary folder. Paper sizes and margins are in inches.

## Clipboard

`browser.clipboard.write(text)` and `await browser.clipboard.read()` (returns `{ text }`) use the system clipboard, which affects the user. Paste with `press("ControlOrMeta+V")`.
