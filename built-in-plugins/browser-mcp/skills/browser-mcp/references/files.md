# Files

File paths are paths on the user's machine. Relative paths resolve against the daemon's working directory, so pass absolute paths.

## Upload

`browser.upload(target, ...files)` sets files on a file input, or on the chooser opened by the target (for example a button). More than one file requires an input with `multiple`. A missing file fails with `File not found`.

## Download

`browser.download(target, file?)` clicks the target and waits for the download. It returns the download details with its `path`. Without `file`, the download is saved under the system temp directory in `browser-mcp-downloads`; with `file`, it is copied there. An existing `file` is not overwritten: choose another path.

For a download started by something other than one click, trigger it and then `await browser.wait({ download: true })`.

## Screenshot

`browser.screenshot()` returns the image to you and its `path` under the system temp directory in `browser-mcp-screenshots`. Use a snapshot to act; use a screenshot to check appearance or to show the user.

## HAR

`browser.network("har", "start")` starts recording and `browser.network("har", "stop", file?)` writes a HAR 1.2 file and returns its path. An existing `file` is not overwritten.

## Clipboard

`browser.clipboard(action, text?)` with `read`, `write`, `copy` or `paste` uses the system clipboard of the logged-in user. `write` replaces what the user had copied. Use it only when the task needs the clipboard.

Downloads, HAR files and uploads are not confined to a folder. Write only where the task asks.
