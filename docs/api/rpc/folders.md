# RPC working folders

All methods on this page use the global `WS /rpc` socket. Shared result types are defined in [RPC shared types](types.md).

## `folders:list`

Lists distinct working folders referenced by visible regular threads. The home directory is always included.

**Params:** none.

**Result:** `Folder[]`. Every item contains `path`, `name`, `displayPath`, `gitBranch`, and `color` as documented in [`Folder`](types.md#folder).

```json
{"jsonrpc":"2.0","id":1,"method":"folders:list"}
```

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
