# Dialogs and confirmation

## JavaScript dialogs

`alert`, `confirm` and `prompt` are captured in every frame. When one opens, the call returns `pendingDialog` and the session state becomes `user_input`. No dialog box is shown to the user, so you must answer it.

Answer in a separate call whose whole code is one of:

- `return await browser.setDialog(true);` accepts an alert or confirm.
- `return await browser.setDialog("text");` accepts a prompt with that text.
- `return await browser.dismissDialog();` cancels.

While a dialog is pending, any other script returns `pendingDialog` without running.

A dialog can also be reported:

- by `browser_toggle_session` and `browser.navigate`, when the page opens it while loading; the page finishes loading after the answer;
- next to `result`, when it opens after the script returned, for example from a timer.

Read the dialog message before answering. Accept a confirmation only when the task already decided the answer, for example deleting an item the user asked to delete.

`browser_import_session` fails when the page keeps opening dialogs while it loads.

## Held actions

When the daemon was started with a confirmation list, a listed helper is not executed and the call returns `{ confirmationRequired: true, confirmationId, action, message }`.

- `browser.confirm(id)` executes it with the original arguments. It must run in a later call than the one that was held.
- `browser.deny(id)` discards it.

Each session keeps one held action; a newer one replaces it. A held helper whose target was a DOM element cannot be confirmed: use a ref or a selector.
