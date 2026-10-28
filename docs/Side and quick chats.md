# Side and quick chats

Side Chat and Quick Chat are both temporary surfaces, but they have different storage, context, visibility, and permission behavior.

## Comparison

| | Side Chat | Quick Chat |
|---|---|---|
| Origin | Fork of an existing thread | Independent window, optionally opened from a folder |
| Storage | SQLite while the side chat remains open | Temporary thread, hard-deleted on close unless forked |
| Initial context | Copies visible history and checkpoint | Same directory context as a thread, plus Quick Chat instructions |
| Visibility | Private and absent from the orchestration team directory | Absent until **Fork in thread** |
| Closing | Interrupts and hard-deletes the child thread | Interrupts and hard-deletes the thread unless it was forked |
| Initial model | Inherited from the fork | Requires a configured Quick chat model; the composer can change it |
| Tool permissions | Has its own composer state; approvals appear inline in its panel | Same composer permission mode, approvals, compaction, and retry as a thread |

## Side Chat

Create one with `/side` or **Side chat** in the auxiliary panel. The fork copies visible messages and the current checkpoint, but not queued, steered, or hidden messages. A copied streaming message is normalized to completed. Copied messages provide context, not the Side Chat's composer selection: Goal, Plan, and Ultra from the parent are not selected when the Side Chat opens. After a message is sent in the Side Chat, its own latest user message determines the restored selection. A Goal explicitly started in the Side Chat remains its own Goal, separate from the parent's.

Names increment as **Side chat 1**, **Side chat 2**, and so on. You cannot create a side chat from another side chat or from a sub-agent. Opening a parent lists its side chats without loading their histories; opening a side-chat tab loads its recent messages and fetches older pages as you scroll upward. The compact side-chat composer omits the parent workspace and Git branch controls. Background side-chat status continues updating while its tab or the auxiliary panel is inactive without re-rendering the main conversation for text-only streaming updates. Closing the panel interrupts active work and permanently deletes the side-chat thread.

Side chats are private: ordinary and sub-agent threads cannot inspect, interrupt, or send prompts to them. Use a side chat to explore an alternative without adding it to the main thread, and copy any important conclusion before closing it.

A side chat defaults to exploration and discussion, preferring to propose delegating actions, changes, and implementations to the parent thread. This is a preference, not a read-only restriction: when you explicitly ask it to perform work in the side chat, it can edit files, execute scripts or commands, and perform operations with its available tools and configured permissions. It may inspect the parent thread and its sub-agents, but sends them instructions only when explicitly asked to. Answers stay concise without cutting explicitly requested execution or validation short.

## Quick Chat

First select **Settings → Models → Auxiliar models → Quick chat model**. There is no automatic model fallback.

Open **Quick chat** from the Sidebar, the tray, or a folder's right-click menu. The folder action opens the window already in that directory. The window can be maximized. It uses the same chat and composer as a normal thread: model switching, directory selection, attachments, recording, queueing, approvals, compaction, retry, Goals, and structured questions.

A new window starts in the chosen directory, or in `$HOME` when opened without one. The composer directory picker and the `set_directory` tool both change it. The next step then loads that directory's instructions, skills, workflows, and MCP servers. Sibling tool calls in the same step still use the previous directory.

Quick Chat instructions are added on top of that context. They still emphasize speed and restraint: implement changes, edit files, execute scripts or commands, and perform operations, including on external systems, only when you explicitly request them. A question or discussion alone does not authorize actions. An explicit request covers the tool steps needed to complete it. Quick Chat can inspect threads across folders, but it is not focused on any single thread. It can create threads and direct main threads or their sub-agents when your request or the Quick Chat instructions call for it.

The window is temporary. Closing it interrupts the run and permanently deletes the conversation, including from search and Archive. After the first message, **Fork in thread** floats above the composer and converts that same conversation into an ordinary thread, then opens it in the main window. Forked threads are kept when the Quick Chat window closes.

Model rules for the main role apply to the window. Side Chat remains a separate full chat and also uses the `main` role.

`quick_chat_invoke` is different: it still runs one headless turn in `$HOME` with reduced instructions, full access, and no `set_directory`, then discards the session. Quick questions stay read-only and do not load directory instructions or Quick Chat instructions.

## Quick questions

A Quick question is a small popover for asking about something you selected, answered by the **Quick chat model**. It is available from:

- Text selected in a chat or side chat.
- Code selected in a Files preview, and the **Quick question** item in the Files tree context menu for a file or folder.
- Code selected in a Git Review diff, and the **Quick question** item in the Git Review tree context menu for a changed file, folder, or repository root.
- Text selected in a bot Inbox work log, including completed ones.
- The gauge button on an active or paused Goal strip, which asks about the Goal's progress immediately.

The question receives the selection plus where it came from: the folder, the source thread, or the bot and work log. File references include the file's text (up to 40,000 characters), folder references include a listing, and Git Review tree items include the file diff or the list of changed files. For text selected in a chat or side chat, the question also receives the source thread history up to and including the selected message (from its latest compaction checkpoint), so the model does not need to inspect the thread. When that history reaches the automatic compaction threshold minus 10% of the Quick chat model's context, older tool results are quick-compressed for the question only; the source thread is not changed. A Goal progress question receives the source thread history through its latest message, including the in-progress turn without unanswered tool calls, plus the Goal specification, status, active time, tokens transacted, task list, and sub-agents. It offers no tools and asks for progress percentage, estimated time to completion, current work, completed work, remaining work, and difficulties. Press **Enter** to ask and **Shift+Enter** for a new line. You can keep asking follow-ups in the same popover; the selection stays in context.

Quick questions are read-only. Instructions favor short, direct, accurate answers, and the model can use only `file_search`, `read_file`, `read_media_file`, `read_url`, `web_search`, `memory_search`, `chat_list_folders`, `chat_list_threads`, `chat_inspect_thread`, and `bots_read_work_log` when the selection is not enough. Availability of media, web, memory, and Semantic Grep tools follows the same rules as Quick Chat. MCP, plugin, and provider tools are not offered.

**Fork to thread** creates an ordinary thread in the source folder with the questions, answers, and selected context, then opens it so you can continue with full tools. A question about chat text forks the source thread through the selected message and appends the questions and answers after it, keeping the prior conversation. **Close** or **Esc** stops any answer and discards the session. Unforked sessions are never saved and are discarded when the main window reloads or closes.

## Which one to use

- Use **Side Chat** for a question or alternative that depends on the current conversation.
- Use a **Quick question** for a short read-only question about a selection.
- Use **Quick Chat** for a short independent interaction that should not enter history.
- Use **New chat** for work that must persist in the Sidebar, search, and Archive.

See [Archive](Archive.md) for disposable-thread retention.
