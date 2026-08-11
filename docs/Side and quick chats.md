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

Names increment as **Side chat 1**, **Side chat 2**, and so on. You cannot create a side chat from another side chat or from a sub-agent. Closing the panel interrupts active work and permanently deletes the side-chat thread.

Side chats are private: ordinary and sub-agent threads cannot inspect, interrupt, or send prompts to them. Use a side chat to explore an alternative without adding it to the main thread, and copy any important conclusion before closing it.

## Quick Chat

First select **Settings → Default models → Quick chat model**. There is no automatic model fallback.

Open **Quick chat** from the Sidebar or tray. The window supports model switching, attachments and drag-and-drop, audio recording, stopping a response, and answering structured questions. Its conversation disappears when the window closes and is never added to Archive or conversation search.

Quick Chat uses `$HOME` as the tool and MCP workspace. Although its instructions emphasize speed and restraint, all available normal tools, provider tools, and MCP tools run in Full access without approval dialogs. Ephemeral storage does not mean the session cannot cause external effects; review the requested work and configured integrations before using Quick Chat.

Quick Chat can create ordinary threads or sub-agents and can keep Tasks or Goal state in memory. Session-only state does not survive closing the window.

## Which one to use

- Use **Side Chat** for a question or alternative that depends on the current conversation.
- Use **Quick Chat** for a short independent interaction that should not enter history.
- Use **New chat** for work that must persist in the Sidebar, search, and Archive.

See [Archive](Archive.md) for disposable-thread retention.
