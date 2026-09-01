# RPC child conversations

This page covers side chats, sub-agent listings, and Rubber Duck listings. Shared objects use the [`Conversation`](types.md#conversation) and [`Message`](types.md#message) types.

## ID behavior by socket

On global `WS /rpc`, parent/child IDs are explicit parameters. On `WS /rpc/conversations/streams/:thread-id`, Avi derives the parent ID from the URL:

- scalar list methods should omit `params`;
- `side-chats:create` should omit `parentConversationId`;
- a conflicting `parentConversationId` is rejected.

## `side-chats:list`

Available on both sockets.

**Global params:** scalar parent ID wrapped in `params.payload`.

| Field | Type | Required | Description |
|---|---|---:|---|
| `params.payload` | string | yes on global | Parent conversation ID. |

**Conversation-socket params:** none.

**Result:** `Conversation[]`, containing direct side chats ordered by creation time.

## `side-chats:create`

Available on both sockets. Forks the parent's visible history into a new side chat and appends hidden side-chat instructions.

**Params:**

| Field | Type | Required | Description |
|---|---|---:|---|
| `parentConversationId` | string | global only | Parent conversation. Inferred from the conversation socket URL. |

**Result:** `null` when the parent does not exist or is already a side chat/sub-agent; otherwise:

| Field | Type | Description |
|---|---|---|
| `conversation` | `Conversation` | Created side chat. |
| `messages` | `Message[]` | Forked messages, including Avi's hidden side-chat instruction message. |

**Errors:** creation is rejected while forced archive cleanup is running.

Conversation-socket example:

```json
{"jsonrpc":"2.0","id":10,"method":"side-chats:create"}
```

## `side-chats:close`

Available only on global `WS /rpc`.

**Params:** scalar side-chat ID wrapped in `params.payload`.

| Field | Type | Required | Description |
|---|---|---:|---|
| `params.payload` | string | yes | Side-chat conversation ID. |

**Result:** boolean. `true` means the side chat was stopped, detached from semaphores, and hard-deleted. `false` means the ID was missing or did not identify a side chat.

## `subagents:list`

Available on both sockets.

**Global params:** scalar parent ID in `params.payload`. **Conversation-socket params:** none.

**Result:** `Conversation[]` containing direct sub-agents ordered by creation time. Each item has `conversationType: "subagent"` and its parent in `parentConversationId`.

## `rubber-ducks:list`

Available on both sockets.

**Global params:** scalar subject/parent ID in `params.payload`. **Conversation-socket params:** none.

**Result:** `Conversation[]` containing non-archived Rubber Duck sessions in the subject's recursive Rubber Duck tree, ordered by creation time.

RPC can list these sessions but does not create them. Creation is performed through Avi's orchestration tools.
