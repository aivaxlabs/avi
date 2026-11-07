# Dialogs

`alert`, `confirm`, `prompt` and "Leave site?" (`beforeunload`) dialogs block the page until answered.

## Manual (default)

When a dialog opens during an action, the call returns `pendingDialog` with its `type`, `message` and `defaultValue`, and the tab state becomes `user_input`. Answer it in a separate call whose whole code is one of:

- `return browser.setDialog(true);` accepts (OK, Leave).
- `return browser.setDialog("text");` accepts a prompt with that text.
- `return browser.dismissDialog();` cancels.
- `return browser.handleDialogs("accept");` accepts it and every later one.

Any other code is refused while a dialog is pending. The interrupted code continues after the answer; check the next snapshot.

## Automatic

`browser.handleDialogs(policy)` answers future dialogs automatically: `"accept"`, `"dismiss"`, `{ accept: true, promptText: "..." }`, or `"manual"` to restore the default. The snapshot then shows `Last handled dialog` so you can read what was answered.

Use automatic acceptance only when the task already decided the answer, for example deleting items the user asked to delete.
