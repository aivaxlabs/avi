# RPC working folders

All methods on this page use the global `WS /rpc` socket. Shared result types are defined in [RPC shared types](types.md). Calls are ORPC `REQ` frames on the `avi-orpc-draft2` subprotocol; the wire method is the dotted form of the heading name and the JSON shown in examples is the frame content. See the [RPC overview](overview.md).

## `folders:list`

Lists distinct working folders referenced by visible regular threads. The home directory is always included.

**Params:** none.

**Result:** `Folder[]`. Every item contains `path`, `name`, `displayPath`, `gitBranch`, and `color` as documented in [`Folder`](types.md#folder).

```json
{
  "operationId": "6c4e1f3a-9b52-4d7f-8d80-2f3e4b5c6d7e",
  "expiresAt": 1790000000000
}
```

## `workspaces:get`

Params: `{ path: string }`, an absolute direct child of `~/.aivax/workspaces`. Returns `{ path, name, folders: [{ name, path, available }] }`. Broken directory links have `available: false`. Ordinary workspace files are not returned or modified.

## `workspaces:save`

Creates or edits a workspace through global authenticated RPC. Creation params: `{ name: string, folders: [{ path: string, name?: string }] }`. Editing params: `{ path: string, folders: [{ path: string, name?: string }] }`. `folders` is the complete desired link list; empty is valid. Editing does not rename the workspace. Returns a `Folder` with `isWorkspace: true` and `folders` as above.

Workspace names have a 120-character limit. Separators, reserved device names, trailing dots/spaces, and control characters are rejected. Targets must be existing absolute directories, except retained broken links. Link names default to the target basename, must be non-hidden and unique, and cannot overwrite existing entries. Duplicate targets and self/ancestor targets are rejected. To replace a link target using the same name, first remove it and save. Saves are serialized; failed link mutations are rolled back. Removal unlinks entries, never recursively deletes original folders. Windows uses junctions; other platforms use directory symlinks.

The desktop editor uses compact folder rows with inline-editable link names; RPC payloads and save semantics are unchanged.

Desktop bridge: `window.chatApp.workspaces.get(payload)` and `.save(payload)`. MCP configuration remains scoped to the selected folder and global configuration, not recursively merged from linked children. File search and context follow links with existing traversal limits and exclusions.

## `folders:threads`

Lists visible regular threads whose resolved `projectPath` exactly matches a folder.

**Params:** scalar folder path wrapped in `payload`.

| Field | Type | Required | Description |
|---|---|---:|---|
| `params.payload` | string | no | Folder path. Empty or omitted uses the user's home directory. Relative paths are resolved by Avi. |

**Result:** [`Conversation[]`](types.md#conversation), ordered by most recently updated first.

```json
{
  "operationId": "0b8df0a2-6c39-4ac0-9e51-5f0d0e0f0a01",
  "expiresAt": 1790000000000,
  "params": { "payload": "C:\\Code\\project" }
}
```

## `folders:save-color`

Sets or clears the color associated with a folder.

**Params:**

| Field | Type | Required | Description |
|---|---|---:|---|
| `path` | string | yes | Folder path. Avi resolves it to an absolute path. |
| `color` | string or `null` | no | A `#rrggbb` color, case-insensitive. Any missing, empty, or invalid value clears the color. |

**Result:** `Record<string, string>` containing all persisted folder colors. Keys are resolved absolute paths; values are lowercase `#rrggbb` strings.

```json
{
  "operationId": "7d9c2b4e-1a63-4e80-9f91-3a4b5c6d7e8f",
  "expiresAt": 1790000000000,
  "params": { "path": "C:\\Code\\project", "color": "#FFAA00" }
}
```

The corresponding result entry is `"#ffaa00"`.

## `composer-draft:get`

Returns the new-thread composer draft for a working folder. Drafts are keyed internally as `<resolved folder path>/00000000-0000-0000-0000-000000000000`, the zero thread ID representing a thread that does not exist yet. Attachments with an absolute local `path` that no longer exists are removed and the draft is re-saved.

**Params:** `payload` is the absolute folder path.

**Result:** `null` when no draft exists, otherwise `{ projectPath, permissionMode, model, reasoningEffort, workMode, ultraMode, draftText, attachments, updatedAt }` with the same field semantics as [`ComposerState`](types.md#composerstate).

## `composer-draft:save`

Replaces the new-thread composer draft for a working folder. Attachments are stored as given; local files are referenced by `path`, never copied. Remote calls accept embedded attachments up to 10 MiB per file, as for `composer-state:save`.

**Params:** `{ projectPath: string, permissionMode?, model?, reasoningEffort?, workMode?, ultraMode?, draftText?, attachments? }`. `projectPath` must be absolute; other fields are normalized like [`composer-state:save`](conversations.md#composer-statesave).

**Result:** the re-read draft, as returned by `composer-draft:get`.

**Errors:** `An absolute projectPath is required.`
