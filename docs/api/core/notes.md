# Notes — Core API v2

`avi.notes` operates the same persistent user notes shown in Desktop and Avi Workspace. This is a backward-compatible addition to Plugin API v2 in Canary; older v2 hosts without this namespace require an Avi update. Domain methods are asynchronous and return detached JSON-like snapshots. They reject after plugin disposal and enforce the declared capabilities before reading or changing state.

| Method | Capability | Input / result |
| --- | --- | --- |
| `lists(options?)` | `notes.read` | `{folderPath?, archived?}` → list array |
| `get(id)` | `notes.read` | Note ID string → note; rejects if absent |
| `search(options?)` | `notes.read` | Search filters, offset/limit → `{notes, total}` |
| `readAttachment(input)` | `notes.read` | `{id, attachmentId, offset?, length?}` → bounded base64 chunk |
| `saveList(input)` | `notes.manage` | `{id?, name?, folderPath?, archived?, orderBy?, position?}` → list |
| `deleteList(input)` | `notes.manage` | `{id, archivedOnly?}` → `{deleted}` note count |
| `save(input)` | `notes.manage` | Note fields with optional ID → created/updated note |
| `reorder(input)` | `notes.manage` | `{listId?, ids}` → `{reordered}` |
| `addAttachment(input)` | `notes.manage` | `{id, path}` → note; copies a file from the Desktop host |
| `uploadAttachment(input)` | `notes.manage` | Bounded browser-style upload chunk or cancellation → upload progress / note |
| `generate(input)` | `notes.manage`, `threads.readMessages` | `{conversationId?, folderPath?, prompt}` → note, using the configured auxiliary model and recent conversation context |

See [Notes data shapes](../../Notes.md#data-shapes) and [Notes RPC](../rpc/notes.md) for field types, defaults, limits, archive semantics, upload protocol, and file chunking. `get` is the only scalar-input Core method; its RPC equivalent receives `{id}`. Core does not expose raw database objects or internal attachment paths.

```js
export default {
  apiVersion: 2,
  id: 'notes-example',
  name: 'Notes example',
  version: '1.0.0',
  capabilities: ['notes.read', 'notes.manage'],
  async activate(avi) {
    const list = await avi.notes.saveList({ name: 'Inbox', folderPath: null });
    await avi.notes.save({ listId: list.id, title: 'Review the release', description: '', priority: 'high' });
    const result = await avi.notes.search({ listIds: [list.id], done: false });
    console.log(result.total);
  },
};
```

Deletion permanently removes the affected notes and their copied files. File additions may succeed independently of other edits; do not automatically retry a mutation whose outcome is unknown. `generate` performs metered auxiliary inference and creates a list only when needed; it does not append messages to the conversation.
