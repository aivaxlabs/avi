# RPC sidebar status and tags

All methods on this page use the global `WS /rpc` socket. Shared result types are defined in [RPC shared types](types.md).

## `sidebar:status`

Returns the authoritative status snapshot behind Avi's sidebar Working and Review groups, so remote clients can group threads without re-deriving run state from conversation events.

**Params:** none.

**Result:** [`SidebarStatus`](types.md#sidebarstatus). The running, approval, input, and semaphore arrays derive from live chat-runner state. `completedUnseenConversationIds` is ephemeral remote state described under [`sidebar:mark-seen`](#sidebarmark-seen).

```json
{"jsonrpc":"2.0","id":1,"method":"sidebar:status"}
```

## `sidebar:mark-seen`

Acknowledges a completed conversation and removes it from `completedUnseenConversationIds`.

The completed-unseen set is in-memory state of one Avi instance's remote server. It is shared by every connected RPC client, never persisted, and resets when Avi restarts. Entries are added when a run completes without user interruption or a semaphore wait, removed when the conversation starts a new run or the user stops it, and removed by this method. Avi's Desktop window keeps a separate session-local view of the same events and does not update this set, so remote clients must acknowledge the conversations they inspect themselves. Acknowledging an unknown conversation ID is a no-op.

**Params:**

| Field | Type | Required | Description |
|---|---|---:|---|
| `conversationId` | string | yes | Conversation to acknowledge. |

**Result:** an object with the updated array, for example `{"completedUnseenConversationIds":[]}`.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "sidebar:mark-seen",
  "params": { "conversationId": "6f1c2a58-0f5e-4a72-9c8f-2b0c48b1a77e" }
}
```

## `tags:list`

Returns the persisted tag catalog used by Avi's sidebar tag filter and tags manager. Returns the default catalog when it was never customized.

**Params:** none.

**Result:** an object whose `tags` field holds [`Tag[]`](types.md#tag).

```json
{"jsonrpc":"2.0","id":3,"method":"tags:list"}
```

## `tags:save`

Replaces the persisted tag catalog. Tag IDs absent from the new catalog are pruned from every conversation that referenced them.

**Params:**

| Field | Type | Required | Description |
|---|---|---:|---|
| `tags` | `TagInput[]` | yes | Complete replacement catalog. `id` is optional and generated when missing or duplicated; `name` is required and entries without one are dropped; `color` accepts `#rrggbb` case-insensitively, is normalized to lowercase, and falls back to the default color when invalid. Omitting `tags` resets the catalog to the defaults; an empty array stores an empty catalog. |

**Result:** an object whose `tags` field holds the normalized persisted [`Tag[]`](types.md#tag).

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tags:save",
  "params": { "tags": [{ "id": "review", "name": "Review", "color": "#e3b341" }] }
}
```
