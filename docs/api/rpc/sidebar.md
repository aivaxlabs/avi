# RPC sidebar status and tags

All methods on this page use the global `WS /rpc` socket. Shared result types are defined in [RPC shared types](types.md). Calls are ORPC `REQ` frames on the `avi-orpc-draft2` subprotocol; the wire method is the dotted form of the heading name and the JSON shown in examples is the frame content. See the [RPC overview](overview.md).

## `sidebar:status`

Returns the authoritative status snapshot behind Avi's sidebar Working and Review groups, so remote clients can group threads without re-deriving run state from conversation events.

**Params:** none.

**Result:** [`SidebarStatus`](types.md#sidebarstatus). The running, approval, input, and semaphore arrays derive from live chat-runner state. `completedUnseenConversationIds` is ephemeral remote state described under [`sidebar:mark-seen`](#sidebarmark-seen).

```json
{
  "operationId": "1a2b3c4d-5e6f-4a70-8b81-9c0d1e2f3a4b",
  "expiresAt": 1790000000000
}
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
  "operationId": "2b3c4d5e-6f7a-4b81-9c92-0d1e2f3a4b5c",
  "expiresAt": 1790000000000,
  "params": { "conversationId": "6f1c2a58-0f5e-4a72-9c8f-2b0c48b1a77e" }
}
```

## `tags:list`

Returns the persisted tag catalog used by Avi's sidebar tag filter and tags manager. Returns the default catalog when it was never customized.

**Params:** none.

**Result:** an object whose `tags` field holds [`Tag[]`](types.md#tag).

```json
{
  "operationId": "3c4d5e6f-7a8b-4c92-0da3-1e2f3a4b5c6d",
  "expiresAt": 1790000000000
}
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
  "operationId": "4d5e6f7a-8b9c-4da3-1eb4-2f3a4b5c6d7e",
  "expiresAt": 1790000000000,
  "params": { "tags": [{ "id": "review", "name": "Review", "color": "#e3b341" }] }
}
```
