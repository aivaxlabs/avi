# Notes

Notes are persistent user notes, separate from an agent’s internal task checklist. Open **Notes** from the auxiliary panel’s **+** menu. Lists belong to a working folder; the panel shows the current folder by default. Use **Filter by → All working folders** to browse other folders.

## Empty-chat overview

An empty Desktop chat shows **Due today**: up to three unfinished notes in the current working folder, ordered by deadline, with the total count. Only deadlines within the current local calendar day are included; overdue notes from previous days, archived notes, and archived lists are excluded. The summary refreshes on note changes, window focus, and every minute while visible. Select a note or the section shortcut to open the Notes panel.

**Bot inbox** shows the three most recently updated open inbox items across all bots and the total open count. The sections sit side by side when both contain items and space permits; empty sections collapse into a compact row beneath the overview. Completed items are excluded. Selecting a message opens its inbox detail; the section shortcut opens the full Inbox.

## Lists and notes

Create a list with the toolbar’s **+**, then select **New note** in the list header. The header also contains the list’s **...** menu; both controls remain available when the list is collapsed. A note has a title, text, priority (`none`, `low`, `medium`, `high`, `urgent`), optional deadline, ordered subtasks, and files. Click its title to edit it or move it to another visible list. Enable all folders to move it to a list in another folder.

The Desktop note editor uses the shared app dialog backdrop, header, and footer, with **Details**, **Sub-tasks**, and **Attachments** tabs. Escape or clicking the backdrop closes the editor when no save is in progress; keyboard focus stays inside the dialog and returns to the opener on close. Drafts are preserved when switching tabs; Save validates all tabs and reveals any required field that needs attention. The note menu opens the relevant tab directly. Save and Cancel remain visible while tab content scrolls.

Desktop list and note menus use shared dropdown styling and icons. Arrow keys, Home and End navigate enabled actions; Escape closes the menu and restores trigger focus. Selection, outside interaction, panel scrolling and window resizing dismiss the menu. Filters use the same surface with native form controls.

Each note’s **...** dropdown contains **Mention in chat**, with an **@** icon. It adds a snapshot of the note’s title, ID, text, priority, deadline, completion state and ordered subtasks to the current composer, without sending a message or changing the note. Copied file attachments are not included. The snapshot does not automatically update when the note changes.

Priority and deadline appear separately with icons and labels. High/urgent priorities are emphasized; unfinished, non-archived notes show **Overdue** or **Due today** as appropriate. Deadline labels use local time, refresh every minute, and retain the full timestamp in their tooltip. Completed or archived notes keep their deadline without an overdue warning.

The checkbox beside a note marks it done; it does not archive it. The note menu changes completion status, opens deadline/subtask/attachment editing, and archives or restores the note. Archived notes and lists are hidden by default. The status filter can show not done, done, archived, all, or all non-archived notes.

Search matches titles, text, and subtask text. Additional filters select priority and an inclusive local-date range for creation, update, or due time. Deadlines are stored as UTC instants and displayed in local time. The panel loads up to 5,000 notes within the selected folder scope and warns when that limit is exceeded.

List menus rename, archive/restore, change ordering, delete archived notes, and delete the entire list. Deletion requires confirmation and permanently removes the affected notes and stored file copies. Archiving a list hides its notes without changing their individual archive flags.

**Urgency** is the default ordering: unfinished notes first, then a weighted combination of priority and deadline proximity (including overdue time). Other choices are newest creation/update, highest priority, earliest deadline, and manual order. Drag a list or note grip to reorder; menu actions provide keyboard-accessible move up/down alternatives. Reordering notes switches that list to manual order. Subtasks use move up/down buttons.

## Files

Save a new note before attaching files. **Add files** copies selected files into `~/.aivax/note-attachments`; each note accepts up to 50 files, each up to 50 MiB. Removing a copy never deletes the original source file. Download buttons export a copy using a save dialog. Attachment additions and removals are saved immediately, independently of the editor’s Save/Cancel buttons.

Metadata is stored in the existing `~/.aivax/aivax.sqlite` database. Notes remain available after restarting Avi.

## `/note`

Type `/note` followed by the note text and send it, or select the command while composing text. This invokes the configured **auxiliary model**, not the conversation model. It does not append the command or the generated note to chat history, start an agent run, or send it as a queued/steered message.

The auxiliary model receives the current working folder, recent visible conversation context, available non-archived lists in that folder, and the supplied note text. It chooses an existing list or creates an appropriate list, then returns one note. Its usage is recorded as auxiliary inference. Configure an auxiliary model before using this command; manual Notes editing does not require a model.

The draft remains intact on failure. If the user edits the draft while generation runs, the newer text is not cleared. Chat attachments are not included: remove them from the composer and add files to the saved note instead.

## Avi Workspace and Core API

Avi Workspace exposes Notes in its auxiliary panel and supports `/note` through the global RPC connection. Actions are gated by discovery. Lists refresh after edits and every five seconds while mounted; note content and file bytes are kept in browser memory only. Browser files upload/download in 256 KiB chunks; no host filesystem paths are sent. Manual note/list ordering uses move up/down controls.

Trusted plugins use [`avi.notes`](api/core/notes.md), with `notes.read` and `notes.manage` capabilities. Auxiliary generation additionally requires `threads.readMessages`.

## Agent tools

- `note_lists`: discover lists across all folders or a specified folder, optionally including archived lists.
- `note_create`: create a note with `title`, `listId`, and `description`; optional priority, deadline, subtasks, completion/archive state, and position.
- `note_edit`: edit any note field, move its list, replace ordered subtasks, remove attachments by ID, or add local paths with `addAttachmentPaths`. Omitted fields remain unchanged. File additions are sequential; a later failure does not undo earlier successful additions or field edits.
- `note_search`: search and filter with optional list IDs, folder, status, priority, timestamps, ordering, and pagination.

Read tools are available in Plan mode; mutations are not. Notes tools are also exposed through management MCP. Their presence does not require agents to create or maintain notes during ordinary work.

## Public IPC / RPC contract

The renderer bridge is `window.chatApp.notes`. The following logical methods are available through the global RPC socket as well as local IPC; normal authentication, operation-ID replay protection, and response envelopes apply. See [RPC overview](api/rpc/overview.md).

| Method | Payload | Result |
| --- | --- | --- |
| `notes:get` | `{id}` | One complete note snapshot; rejects unknown IDs. |
| `notes:upload-attachment` | `{id, name?, size?, uploadId?, offset?, data?, cancel?}` | Bounded upload progress or finalized note; see [Notes RPC](api/rpc/notes.md). |
| `notes:lists` | `{folderPath?, archived?}` | List array. Omit folder for all; `null` means no folder. Archive default `false`; `null` includes both. |
| `notes:save-list` | `{id?, name?, folderPath?, archived?, orderBy?, position?}` | Saved list. New lists require name. |
| `notes:delete-list` | `{id, archivedOnly?: false}` | `{deleted}` note count. `true` retains the list and deletes only individually archived notes. Remote callers must obtain user intent before deleting. |
| `notes:search` | Filters below | `{notes, total}` |
| `notes:save` | Note fields below | Saved note. Omitting ID creates; supplying ID updates. |
| `notes:reorder` | `{listId?, ids: string[]}` | `{reordered}`. With listId reorders its notes and sets manual order; otherwise reorders lists. Unlisted items follow listed items. |
| `notes:generate` | `{conversationId?, folderPath?, prompt}` | Created note; conversation folder takes precedence. Uses auxiliary inference. |
| `notes:add-attachment` | `{id, path}` | Note with added file copy. Path is local to the Desktop host. |
| `notes:read-attachment` | `{id, attachmentId, offset?: 0, length?: 262144}` | `{name, size, offset, bytesRead, data}`. Base64 chunk, length 1–262144 bytes. Repeat with advanced offset until complete. |

Local-only dialog methods: `notes:pick-attachments` takes `{id}` and returns the updated note; `notes:export-attachment` takes `{id, attachmentId}` and returns `{canceled}`. Local subscribers use `notes.onChanged(callback)` (returns unsubscribe) for `notes:changed`; remote clients refresh after operations or poll as needed.

### Data shapes

A list contains `id`, `name` (1–200 characters), `folderPath` (string or null), `archived`, `orderBy`, `position`, `createdAt`, and `updatedAt`.

A note contains `id`, `listId`, `title` (1–500 characters), `description` (up to 200,000 characters), `priority`, `dueAt` (ISO instant or null), `done`, `archived`, `position`, `subtasks`, `attachments`, `createdAt`, and `updatedAt`. `subtasks` is an ordered full replacement, up to 500 objects `{id?, text, done}`; text is 1–2,000 characters and omitted IDs are generated. Attachments are read-only metadata `{id, name, size}`. Pass `removeAttachmentIds` to `notes:save` to delete selected copies. Use the dedicated attachment operation to add files.

Search accepts `query`, `listIds`, `folderPath`, `done`, `archived`, `priority`, `createdAfter`, `createdBefore`, `updatedAfter`, `updatedBefore`, `dueAfter`, `dueBefore`, `orderBy`, `offset` (default 0), and `limit` (default 500, maximum 5,000). Timestamp bounds are inclusive. `archived:false` excludes archived notes and archived lists; `true` returns individually archived notes; `null` includes all. Ordering values: `urgency`, `createdAt`, `updatedAt`, `priority`, `dueAt`, `manual`.
