# Secret Vault

The Secret Vault stores logins, passwords, API keys, tokens, and other credentials on your device. Open **Secret Vault** from the Activity Bar, below Scheduled jobs.

## Storage

Each entry has a name, a value, an optional description, and creation and update dates. Entries are kept in `~/.aivax/secure-storage.json` under `secret-vault`, encrypted with Electron `safeStorage`, which uses the operating system's secure storage (DPAPI on Windows, Keychain on macOS, the Secret Service or kwallet on Linux). The vault is not synced or sent to AIVAX.

Names use letters, digits, `.`, `_`, `-`, and `@`, up to 128 characters. Store one value per entry, for example `user_john_doe_gmail.email` and `user_john_doe_gmail.password`.

## Managing entries

The page lists entries by name with their description and update date, and filters by name or description. **New secret** adds an entry. Opening one lets you:

- **Reveal secret** to show the value, or **Hide secret** to mask it again.
- **Copy** the value to the clipboard.
- Change the name, description, or value. Leave the value untouched to keep it.
- **Delete** the entry after a confirmation.

## Agents

Threads, Quick Chat, and bots receive three tools and a short instruction to use them:

- `secret_vault_put({ name, content?, description?, overwrite? })` saves an entry. An existing name is replaced only with `overwrite: true`; an empty or omitted `content` removes the entry. Agents are told to save every credential you share or that they create, one value per entry.
- `secret_vault_list({ filter? })` lists names, descriptions, and dates, never values.
- `secret_vault_get({ name })` returns a placeholder instead of the value, for example:

  ```text
  Key exported as {{user_john_doe_gmail.email:NOSKEJUB92}}, expires at 2026-10-30T13:37:12.000Z
  ```

The placeholder is valid for 1 minute and only in the thread that requested it. When it appears anywhere in the arguments of a later tool call, such as a terminal command, a request body, or an environment variable export, Avi substitutes the value in memory for that execution only. The chat, the stored tool call, approval prompts, and plugin interceptors keep showing the placeholder. Placeholders are not resolved in chat, thread, bot, memory, scheduler, task, goal, or Secret Vault tools, so a value cannot be copied into a message, another thread, or memory.

After a value is substituted, any later tool output in that thread that contains it shows `[secret:<name>]` instead. Values shorter than 4 characters are not masked. Agents are instructed not to print the placeholder or value and not to write either to a file.

`secret_vault_put` follows the current permission mode; its arguments contain the raw value, so the value appears in that tool call in the chat. Smart Approve never sends it to the decision model. `secret_vault_list` and `secret_vault_get` never need approval. The tools are not available in Plan mode or through Remote MCP.

## Limits

- Masking only applies to outputs; a program run with the value can still write it to a file or send it elsewhere.
- Entries cannot be read when the operating system's secure storage is unavailable.
