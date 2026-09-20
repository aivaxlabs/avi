# Keyboard shortcuts RPC

Available on the authenticated global `/rpc` socket, not conversation sockets. Settings apply to this Avi installation. Query `rpc:discover` for availability.

## `shortcuts:list`

No parameters. Returns an array of binding snapshots:

- `id`, `title`, `pattern`: stable identity, display title and normalized current pattern; empty pattern disables the binding.
- `defaultPattern`, `defaultGlobal`: defaults restored by reset.
- `supportsGlobal`, `global`: whether desktop capture is supported and requested.
- `active`: whether the in-app binding can execute.
- `globalRegistered` (optional): actual OS registration outcome.
- `pluginId`, `contributionId` (optional): plugin provenance and local contribution identity.
- `error` (optional): conflict or OS registration failure.

Built-in IDs are `model.previous`, `model.next`, `reasoning.previous`, `reasoning.next`, `quick-chat`, `threads.search`, `sidebar.toggle`, `panel.toggle`, `thread.new`, `thread.home`, `chat.find`, `zoom.in`, `zoom.out`, and `zoom.reset`. Plugin IDs use `plugin:<pluginId>:<contributionId>`.

The in-app `chat.find` action opens a compact, centered floating search panel above the composer. Results use CSS highlights without changing native text selection. Typing retains input focus and updates matches after a 50 ms debounce; this does not change the RPC request or response contract.

## `shortcuts:save`

Parameters: `{ id, pattern, global }`, or `{ id, reset: true }`. `pattern` must be a string and `global` a boolean for non-reset requests. Empty pattern disables. Reset removes the stored override. Returns the complete updated snapshot array.

For atomic multi-binding updates, pass `{ changes: [{ id, pattern, global }, { id, reset: true }] }`. The non-empty array may include each ID once. All changes are validated together and persisted in one write, allowing two bindings to exchange patterns without an intermediate conflict. Existing single-binding requests remain supported.

Unknown IDs, invalid patterns, unsupported global scope and duplicate patterns fail without persisting any edit. OS reservation failures are returned as binding errors after saving; in-app capture remains available. No remote execute method is exposed. Poll `shortcuts:list` to observe changes; global RPC has no shortcut-change notification.

See [Keyboard shortcuts](../../Keyboard-shortcuts.md) for defaults and pattern syntax.
