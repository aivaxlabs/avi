# Archive

Archive keeps the active conversation list small and applies local retention policies. It is not a backup system.

## Default retention

- archive old ordinary threads after 7 days;
- permanently delete archived threads after 30 days;
- permanently delete eligible disposable conversations, such as side chats and sub-agents, after 1 day.

Available values are 7, 30, or Never for automatic archiving; 30, 60, or Never for archived deletion; and 1, 7, 30, or Never for disposable deletion. Changes are saved immediately.

## Archive operations

Open **Settings → Archive** to:

- search archived conversations by title or first prompt;
- restore a thread;
- permanently delete a thread;
- review active, archived, and total conversation counts;
- view conversation and temporary-storage size;
- run **Run forced cleanup**;
- run **Delete temporary storage**.

Permanent deletion requires confirmation, includes child conversations, and cannot be undone. Archiving or restoring a parent thread includes its persisted side chats and sub-agents.

## Maintenance

Archive maintenance runs once at Avi startup. **Run forced cleanup** immediately applies the configured policies to eligible records.

Deleting temporary storage can remove temporary attachments, tool outputs, logs, and cached media. It does not delete every saved conversation, but artifacts that were only temporary will no longer be available.

## Safety notes

- **Never** disables only the selected policy.
- Archived threads do not appear in the normal Sidebar or standard conversation search.
- Keep an independent backup if conversation history is important.
- Copy valuable side-chat conclusions before closing the side chat.
- Review all retention values before running forced cleanup.
