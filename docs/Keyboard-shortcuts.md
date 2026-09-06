# Keyboard shortcuts

Open **Settings → Keyboard shortcuts**, immediately after **Personalization**, to edit each binding. Each row aligns the action, pattern, scope, and save/reset/disable controls. Reset and disable icon buttons include accessible labels and hover descriptions. One **Save changes** button in the standard settings footer, outside the scrolling list, applies all edits together. **Reset default** restores the original pattern and scope in the draft, and **Disable** clears the draft pattern; neither persists until you save. Colliding bindings are highlighted together with the conflicting action names, and saving is blocked until resolved. Plugin bindings identify their providing plugin. Duplicate patterns are rejected without changing the saved configuration.

To record a binding, focus its field and press the actual key combination, then choose **Save**. Free text and pasted strings are not accepted. Backspace/Delete without modifiers clears the field; Escape leaves it; Tab/Shift+Tab moves between controls. Modifier-only presses do not replace the binding.

`Control` means Command on macOS and Ctrl on Windows/Linux. Patterns accept Control, Alt and Shift plus a letter, digit, arrow, function key or navigation key. Use `Control+Plus` (or `Control++`) for zoom in. Global capture depends on OS availability; an unavailable registration is reported in Settings and remains usable inside Avi.

| Default | Action | Scope |
|---|---|---|
| Control+Q / Control+E | Previous / next configured model slider level | In-App |
| Shift+Down / Shift+Up | Previous / next supported reasoning level | In-App |
| Control+Alt+S | Open Quick Chat | Global |
| Control+K | Search threads | In-App |
| Control+B | Toggle sidebar | In-App |
| Control+J | Toggle side panel | In-App |
| Control+N | New thread in current folder | In-App |
| Control+Shift+N | New thread in home folder | In-App |
| Control+F | Find in current chat | In-App |
| Control+Plus / Control+- / Control+0 | Increase / decrease / reset window zoom | In-App |

Model and reasoning commands target the focused composer, or the main composer when none is focused, and stop at the configured boundaries. Model stepping requires a configured intelligence slider. Sidebar, thread, and panel commands apply to the main workspace. Only Quick Chat and plugin commands declaring `supportsGlobal` offer global mode. Other bindings cannot be promoted to desktop shortcuts.

Find searches the currently rendered visible message text, without case sensitivity. Use Enter/Shift+Enter or Next/Previous to navigate; Escape closes it. **Include older messages** expands the chat history and updates results. Collapsed content must be expanded to be searched. This is not a semantic search or a search of attachments. Matches spanning separate rendered text nodes are not combined.

Bindings are installation-wide and persist across restarts. Plugin changes follow the normal plugin restart lifecycle. On startup, a newly introduced conflicting contribution is inactive and reports the conflict in Settings.

Remote administrators can inspect and configure bindings through [the shortcuts RPC API](api/rpc/shortcuts.md).
