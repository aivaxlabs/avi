# Auxiliary panels

Runtime panels remain declarative. Plugins cannot inject React components, HTML scripts, or renderer JavaScript.

## Built-in desktop Files actions

The desktop preload bridge exposes `files.read`, `files.open`, `files.reveal`, and `files.copyPath` through the existing logical `files:*` handlers. Their payload contains `folderPath`, `filePath`, and optional `allowExternalReference`. Absolute paths and `file://` URLs require `allowExternalReference: true`; relative traversal remains rejected without that opt-in. The desktop requests confirmation before enabling it. `files.reveal` resolves the physical path before selecting the item in the OS file manager. `shell.openTerminal(targetPath)` starts the configured interactive shell with that working directory, not a one-shot command.

These desktop operations are not new plugin capabilities or remotely exposed RPC methods; the public plugin panel registration contract below is unchanged.

## Built-in desktop Git Review actions

`window.chatApp.gitReview` uses the `avi:invoke` gateway. These desktop operations are documented alongside Core panels, not exposed as new plugin capabilities or remote RPC methods. `conversationId` determines the workspace; repository paths must belong to its discovered catalog.

| Method / logical channel | Payload | Result |
| --- | --- | --- |
| `repositories` / `git-review:repositories` | `{ conversationId, refresh? }` | `{ root, repositories: [{ id, name, path, directory }] }` |
| `index` / `git-review:index` | `{ conversationId, repositoryPath, refresh? }` | Metadata, `hasHead`, `version`, `conflicts`, lightweight `files` without diffs |
| `file` / `git-review:file` | `{ conversationId, repositoryPath, filePath, staged?, unstaged? }` | Status, `diff`, destination `content`, `binary`, optional `message` |
| `mutate` / `git-review:mutate` | `{ conversationId, repositoryPath, action, path?, message?, confirmed?, version? }` | Action result or rejected request |
| `plan` / `git-review:plan` | `{ conversationId, repositoryPath, model?, messageOnly? }` | AI commit plan for the selected repository |
| `commit` / `git-review:commit` | `{ conversationId, repositoryPath, commits }` | Executed plan covering current changed files |
| `push` / `git-review:push` | `{ conversationId, repositoryPath }` | `{ pushed, message, conflicts, branch, canResolveWithAgent }` |

The desktop panel uses the existing status strip and spinner while action promises and index refreshes are pending, with separate commit/push labels and `aria-busy`. Progress is indeterminate; these IPC methods do not emit progress events.

`plan` with `messageOnly: true` generates exactly one message from staged previews only (128,000-character input limit), without staging or committing. The desktop Generate commits action instead uses the existing side-chat fork and chat-send flow with the selected repository and multi-commit workflow marker.

File previews with `unstaged: true` compare the working tree against the index; `staged: true` compares the index against HEAD and takes precedence. With neither flag, the legacy combined preview remains available.

Actions are `stage`, `unstage`, `discard`, `ignore`, and `commit`. `path` is a repository-relative file/folder or `.` for all current changes. Manual commit requires staged changes and a message of 1–10,000 characters; it never stages implicitly. Discard requires `confirmed: true` and the reviewed index `version`, and rejects symbolic links, directories/submodules, and sensitive configuration before mutation. Ignore appends an anchored literal rule without replacing existing entries or untracking files. Pathspecs are literal; mutation invalidates repository-scoped caches.

Discovery coalesces requests for 30 seconds; status caches for 1.5 seconds. Explicit refresh bypasses TTLs. Versions include HEAD, status, Git index metadata, and changed-file metadata. Preview cache keys include canonical repository, path, scope, version, and file metadata, with at most 12 entries. Legacy `state(conversationId)` remains available for eager review; the UI uses split catalog/index/file requests. Panel expansion is transient local layout state; plugin registration is unchanged.

## API

```ts
avi.panels.register(descriptor): PanelRegistration
avi.panels.list(): PanelSummary[]
```

Registration requires `panels.register`. Listing all runtime panels requires `panels.manage`.

```js
const panel = avi.panels.register({
  id: 'acme-status',
  title: 'Acme status',
  async load(context) {
    return {
      sections: [{
        id: 'service',
        title: 'Service',
        items: [{ id: 'health', label: 'Health', value: 'Online' }],
        actions: [{ id: 'refresh', label: 'Refresh', kind: 'primary' }],
      }],
    };
  },
  async invokeAction(action, input, context) {
    if (action !== 'refresh') throw new Error(`Unknown action: ${action}`);
    panel.refresh();
    return { refreshed: true };
  },
});
```

Panel IDs are exposed to the renderer as `plugin:<plugin-id>:<panel-id>`.

## Registration handle

```ts
panel.id: string
panel.disposed: boolean
panel.refresh(): AviEvent
panel.dispose(): void
```

`refresh()` emits `panel.refresh.requested` for observers. The renderer also reloads a panel through its existing declarative panel flow when opened or an action completes.

The `load` and `invokeAction` contexts contain the current conversation snapshot and `workspacePath`.
