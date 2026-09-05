# RPC working folders

All methods on this page use the global `WS /rpc` socket. Shared result types are defined in [RPC shared types](types.md).

## `folders:list`

Lists distinct working folders referenced by visible regular threads. The home directory is always included.

**Params:** none.

**Result:** `Folder[]`. Every item contains `path`, `name`, `displayPath`, `gitBranch`, and `color` as documented in [`Folder`](types.md#folder).

```json
{"jsonrpc":"2.0","id":1,"method":"folders:list"}
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
  "jsonrpc": "2.0",
  "id": 2,
  "method": "folders:threads",
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
  "jsonrpc": "2.0",
  "id": 3,
  "method": "folders:save-color",
  "params": { "path": "C:\\Code\\project", "color": "#FFAA00" }
}
```

The corresponding result entry is `"#ffaa00"`.
