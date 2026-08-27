# Archive

Archive keeps the active conversation list small and applies local retention policies. It is not a backup system.

## Default retention

- archive old ordinary threads after 7 days;
- permanently delete archived threads after 30 days;
- permanently delete eligible disposable conversations, such as side chats and sub-agents, after 1 day;
- keep 7 days of bot conversation history.

Available values are 7, 30, or Never for automatic archiving; 30, 60, or Never for archived deletion; 1, 7, 30, or Never for disposable deletion; and 3, 7, or 30 days for bot history. Changes are saved immediately.

## Archive operations

Open **Settings → Maintenance → Archive** to:

- search archived conversations by title or first prompt;
- restore a thread;
- permanently delete a thread;
- review active, archived, and total conversation counts;
- view conversation and temporary-storage size;
- run **Run forced cleanup**;
- run **Delete temporary storage**.

Permanent deletion requires confirmation, includes child conversations, and cannot be undone. Archiving or restoring a parent thread includes its persisted side chats and sub-agents.

The **Maintenance** settings page also contains a **Semaphores** tab for inspecting and resetting agent semaphores; see [Sub-agents](Sub-agents.md).

## Maintenance

Archive maintenance runs once at Avi startup. Startup maintenance applies the configured age limits to ordinary archived and disposable conversations and prunes bot history.

**Run forced cleanup** is intentionally more destructive. It first archives ordinary threads eligible under the automatic archive policy, then permanently deletes the entire archive, including side chats and sub-agents that are archived with their parent thread. Active, non-archived side chats and sub-agents are preserved. It also prunes bot conversation history using the configured retention window. Bot definitions and their most recent retained conversation round remain available.

Bot history pruning starts at the first human message or `<bot-activation>` message inside the configured retention window and deletes every older message. If no activity falls inside the window, Avi keeps the bot's most recent round as minimal context. Bots with an active or resumable run, pending queue, or active Goal are skipped until a later maintenance run.

Deleting temporary storage can remove temporary attachments, tool outputs, logs, and cached media. It does not delete every saved conversation, but artifacts that were only temporary will no longer be available.

## Safety notes

- **Never** disables only the selected automatic policy. It does not protect conversations that are already archived from **Run forced cleanup**.
- Archived threads do not appear in the normal Sidebar or standard conversation search.
- Keep an independent backup if conversation history is important.
- Copy valuable side-chat conclusions before running forced cleanup.
- Review all retention values before running forced cleanup; permanent deletion cannot be undone.
