# Side and quick chats

Side Chat and Quick Chat are both temporary surfaces, but they have different storage, context, visibility, and permission behavior.

## Comparison

| | Side Chat | Quick Chat |
|---|---|---|
| Origin | Fork of an existing thread | Independent window |
| Storage | SQLite while the side chat remains open | In-memory session only |
| Initial context | Copies visible history and checkpoint | Reduced instructions; tools use `$HOME` |
| Visibility | Private and absent from the orchestration team directory | Absent from conversations, search, and Archive |
| Closing | Interrupts and hard-deletes the child thread | Discards the in-memory session |
| Initial model | Inherited from the fork | Requires a configured Quick chat model |
| Tool permissions | Has its own composer state | Available tools run in Full access without approval dialogs |

## Side Chat

Create one with `/side` or **Side chat** in the auxiliary panel. The fork copies visible messages and the current checkpoint, but not queued, steered, or hidden messages. A copied streaming message is normalized to completed.

Names increment as **Side chat 1**, **Side chat 2**, and so on. You cannot create a side chat from another side chat or from a sub-agent. Opening a parent lists its side chats without loading their histories; opening a side-chat tab loads its recent messages and fetches older pages as you scroll upward. The compact side-chat composer omits the parent workspace and Git branch controls. Background side-chat status continues updating while its tab or the auxiliary panel is inactive without re-rendering the main conversation for text-only streaming updates. Closing the panel interrupts active work and permanently deletes the side-chat thread.

Side chats are private: ordinary and sub-agent threads cannot inspect, interrupt, or send prompts to them. Use a side chat to explore an alternative without adding it to the main thread, and copy any important conclusion before closing it.

A side chat defaults to exploration and discussion, preferring to propose delegating actions, changes, and implementations to the parent thread. This is a preference, not a read-only restriction: when you explicitly ask it to perform work in the side chat, it can edit files, execute scripts or commands, and perform operations with its available tools and configured permissions. It may inspect the parent thread and its sub-agents, but sends them instructions only when explicitly asked to. Answers stay concise without cutting explicitly requested execution or validation short.

## Quick Chat

First select **Settings → Models → Auxiliar models → Quick chat model**. There is no automatic model fallback.

Open **Quick chat** from the Sidebar or tray. The window supports model switching, attachments and drag-and-drop, audio recording, stopping a response, and answering structured questions. Its conversation disappears when the window closes and is never added to Archive or conversation search.

Quick Chat uses `$HOME` as the tool and MCP workspace. Although its instructions emphasize speed and restraint, all available normal tools, provider tools, and MCP tools run in Full access without approval dialogs. Ephemeral storage does not mean the session cannot cause external effects; review the requested work and configured integrations before using Quick Chat.

Quick Chat can implement changes, edit files, execute scripts or commands, and perform operations, including on external systems, when you explicitly request them. A question or discussion alone does not authorize actions. An explicit request covers the tool steps needed to complete it; you do not need to name each tool or move the work to a full thread. Quick Chat can inspect threads across all folders, but it is not focused on any single thread, and it directs main threads or their sub-agents only when explicitly asked to. Answers stay concise without leaving requested work unfinished.

Quick Chat can create ordinary threads or sub-agents and can keep Tasks or Goal state in memory. Session-only state does not survive closing the window.

Model rules do not apply to Quick Chat. Side Chat is a full chat for rule matching and uses the `main` role.

## Which one to use

- Use **Side Chat** for a question or alternative that depends on the current conversation.
- Use **Quick Chat** for a short independent interaction that should not enter history.
- Use **New chat** for work that must persist in the Sidebar, search, and Archive.

See [Archive](Archive.md) for disposable-thread retention.
