# Session state

## Cookies and storage

| Helper | Description |
| --- | --- |
| `browser.cookies("get", { all?, urls? })` | Cookies of the current page, of `urls`, or all of them. |
| `browser.cookies("set", name, value, options?)` | Writes a cookie. |
| `browser.cookies("clear", { all? })` | Clears the cookies of the current page, or all of them. |
| `browser.storage(kind, action, key?, value?)` | `kind` is `local` or `session`; `action` is `get`, `set`, or `clear`. |

## Saved states

`browser.state(action, ...)` stores the cookies and storage of the session under a name, encrypted on the user's machine.

| Action | Arguments |
| --- | --- |
| `save`, `load`, `show`, `clear` | `name` |
| `list` | none |
| `rename` | `from`, `to` |
| `clean` | `days` |

`load` navigates the page, so make it the last statement of the script.

## Login profiles

`browser.auth(action, name?, options?)` stores a login, encrypted, and replays it.

- `save`: `{ url, username, password, usernameSelector?, passwordSelector?, submitSelector? }`.
- `login`: opens the URL, fills the form and submits it. Make it the last statement.
- `show`, `delete`, `list`.

After `login`, the password is replaced by `[redacted]` in every tool result, recorded request and HAR file of every session until the daemon exits.

Redaction is partial. It covers passwords of 6 to 384 characters in their usual encodings. When `login` returns a `warning`, the password is not fully covered: tell the user. A script can still read the password from the page field, so never return or log field values after a login.

Use only credentials the user gave you for this task. Prefer a saved profile over typing a password with `fill`, which is not redacted.
