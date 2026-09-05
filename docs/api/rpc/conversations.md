# RPC threads, messages, and composer state

Thread administration uses the global `WS /rpc` endpoint. Thread-local reads and composer state use `WS /rpc/conversations/streams/:thread-id`; that endpoint infers the conversation ID from the URL. Methods marked **Both** are available on both endpoints.

See [shared types](types.md) for complete response object fields. Scalar parameters use `params.payload` as described in the [RPC overview](overview.md#parameters).

## Method availability

| Method | Socket |
| --- | --- |
| `conversations:list` | Global |
| `conversations:create` | Global |
| `conversations:update` | Both |
| `conversations:archive` | Global |
| `conversations:delete` | Global |
| `conversations:fork` | Global |
| `conversations:search` | Global |
| `conversations:set-tags` | Global |
| `composer-state:get` | Conversation |
| `composer-state:save` | Conversation |
| `conversations:messages` | Conversation |
| `conversations:tool-call-details` | Conversation |
| `conversations:context` | Conversation |
| `mentions:list` | Conversation |
| `context:commands` | Conversation |
| `files:diff` | Conversation |
| `attachments:read` | Conversation |
| `tasks:list` | Conversation |

## `conversations:list`

Returns visible top-level and child threads, ordered by `updatedAt` descending. Archived conversations and conversations without a non-hidden message are omitted. `gitBranch` and `workStatus` are refreshed before return.

### Params

Omit `params`.

### Result

[`Conversation[]`](types.md#conversation).

## `conversations:create`

Creates a thread. Every field is optional.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | No | Display title. Defaults to `"New chat"`. |
| `model` | string | No | Model identifier. Defaults to an empty string. |
| `projectPath` | string | No | Working folder. Defaults to the server user's home folder. |
| `gitBranch` | string \| null | No | Associated Git branch. Defaults to `null`. |
| `conversationType` | `"thread"` \| `"side-chat"` \| `"subagent"` \| `"rubber-duck"` | No | Conversation kind. Defaults to `"thread"`. |
| `createdBy` | `"user"` \| `"agent"` | No | Creator classification. Invalid values become `"user"`. |
| `parentConversationId` | string \| null | No | Parent thread ID for a child conversation. Defaults to `null`. |
| `initialPrompt` | string \| null | No | Initial prompt metadata. Defaults to `null`. This method does not run the prompt. |
| `orchestrationMode` | `"plan"` \| `"ultra"` \| null | No | Initial orchestration mode. Invalid values become `null`. |
| `autoForwardToParent` | boolean | No | Whether agent output is automatically forwarded to its parent. Defaults to `false`. |
| `titleStatus` | string | No | Title-generation status. Defaults to `"pending"`. |

### Result

The created [`Conversation`](types.md#conversation).

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "conversations:create",
  "params": {
    "title": "API thread",
    "model": "provider:model",
    "projectPath": "C:\\Code\\project"
  }
}
```

## `conversations:update`

Updates selected thread metadata. On the conversation socket, `id` is inferred from the URL; supplying a different ID is rejected.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Global only | Conversation ID. Inferred and enforced on the conversation socket. |
| `title` | string \| null | No | New title. `null` preserves the existing value. |
| `model` | string \| null | No | New model identifier. `null` preserves the existing value. |
| `titleStatus` | string \| null | No | New title status. `null` preserves the existing value. |
| `orchestrationMode` | `"plan"` \| `"ultra"` \| null | No | Omission preserves the current mode; `null` clears it. Any other supplied value is normalized to `null`. |
| `contextCheckpoint` | string \| null | No | New compacted-context checkpoint. `null` preserves the existing value. |
| `checkpointMessageId` | string \| null | No | New checkpoint message ID. `null` preserves the existing value. |
| `contextTokens` | number \| null | No | New checkpoint token count. `null` preserves the existing value. |

### Result

Updated [`Conversation`](types.md#conversation), or `null` when the ID does not exist. This method does not throw merely because the ID is unknown.

## `conversations:archive`

Archives a conversation, stops active runs in it and its children, and clears their semaphore waits.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | string | Yes | Conversation ID. |

### Result

Fresh visible [`Conversation[]`](types.md#conversation), using the same filtering and ordering as `conversations:list`.

## `conversations:delete`

Stops the conversation and children, clears their semaphore waits, hard-deletes child conversations, and soft-deletes the selected parent conversation.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | string | Yes | Conversation ID. |

### Result

Fresh visible [`Conversation[]`](types.md#conversation), using the same filtering and ordering as `conversations:list`.

## `conversations:fork`

Copies the visible message history and context checkpoint into a new thread titled `<source title> - Copy`. Streaming messages are copied as completed partial-response snapshots; the source execution is unchanged and no execution is started in the copy.

### Params

The scalar form uses `params.payload` with the source conversation ID. To fork through a particular message, put this object in `params.payload`:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `conversationId` | string | Yes | Source conversation ID. |
| `throughMessageId` | string | No | Copies messages through this message when it exists. If omitted, all non-hidden messages and the context-checkpoint boundary (even when hidden) are copied. |

### Result

`null` when the source is invalid; otherwise:

| Field | Type | Description |
| --- | --- | --- |
| `conversation` | [`Conversation`](types.md#conversation) | New copied conversation. Load its copied history through `conversations:messages`. |

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "conversations:fork",
  "params": {
    "payload": {
      "conversationId": "source-thread",
      "throughMessageId": "message-42"
    }
  }
}
```

## `conversations:search`

Searches messages and returns at most 20 deduplicated conversations, ordered by score and then `updatedAt` descending. Avi uses semantic assistant-message search when configured and falls back to local lexical search if that path fails.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | string | Yes | Search query. |

### Result

[`ConversationSearchResult[]`](types.md#conversationsearchresult).

## `conversations:set-tags`

Replaces a conversation's tags. Empty strings are removed and duplicates are removed while preserving the first occurrence.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `conversationId` | string | Yes | Conversation ID. |
| `tags` | string[] | Yes | Complete replacement tag list. |

### Result

Updated [`Conversation`](types.md#conversation), or `null` when the conversation does not exist.

## `composer-state:get`

Returns the persisted composer draft for the URL conversation. Legacy video attachments may be materialized and persisted during this read.

### Params

Omit `params`, or set `params.payload` to the same conversation ID as the URL.

### Result

[`ComposerState`](types.md#composerstate), or `null` when no state has been saved.

## `composer-state:save`

Persists the composer draft for the URL conversation.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `permissionMode` | [`PermissionMode`](types.md#common-scalar-types) | No | Defaults to `"approve_for_me"`. |
| `model` | string | No | Selected model. Defaults to an empty string. |
| `reasoningEffort` | string \| null | No | Provider-specific reasoning effort. Defaults to `null`. |
| `workMode` | `"plan"` \| `"goal"` \| null | No | Work mode. Invalid values become `null`. |
| `ultraMode` | boolean | No | Ultra mode flag. Defaults to `false` and is forced to `false` when `workMode` is `"plan"`. |
| `draftText` | string | No | Draft text. Defaults to an empty string. |
| `attachments` | [`Attachment[]`](types.md#attachment) | No | Draft attachments. Defaults to `[]`. |

### Result

The re-read [`ComposerState`](types.md#composerstate).

### Errors

- `Conversation not found.`

## `conversations:messages`

Returns a bounded page of persisted messages for the URL conversation. The initial page contains the newest messages in chronological order. Reading can migrate legacy video attachments.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | integer | No | Page size from 1 to 500. Defaults to 100. |
| `cursor` | string | No | Opaque cursor returned by the previous page. Cursors are scoped to the URL conversation. |

### Result

[`MessagePage`](types.md#messagepage). Tool-call segments are lightweight projections: `argumentsText`, `resultText`, and `mediaContent` are omitted, while `conversationId`, `messageId`, `detailsAvailable`, `hasArguments`, `hasResult`, and `hasMediaContent` describe the deferred details.

## `conversations:tool-call-details`

Returns the deferred payload for one tool-call segment owned by the URL conversation.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messageId` | string | Yes | Message containing the tool-call segment. |
| `segmentId` | string | Yes | Tool-call segment ID. |

Only these fields are accepted. The URL supplies `conversationId`.

### Result

[`ToolCallDetails`](types.md#toolcalldetails).

### Errors

- `Message not found in conversation.`
- `Tool call not found.`

## `conversations:context`

Returns the authoritative recovery snapshot for the URL conversation, including bounded messages, the composer snapshot, context usage, queue state, active run state, approvals, questions, semaphore state, tasks, and child conversations. Queue calculations always use the complete history, not only the returned message page.

### Params

The same `limit` and `cursor` fields as `conversations:messages`.

### Result

[`ConversationContext`](types.md#conversationcontext). Its messages use the same lightweight tool-call projection as `conversations:messages`; retrieve deferred fields through `conversations:tool-call-details`.

### Errors

- `Conversation not found.`

## Conversation-scoped workspace helpers

`mentions:list` accepts optional `query` and returns `{ paths, servers }`. `context:commands` takes no parameters and returns the available skills/workflows/commands. `files:diff` accepts only `filePath` and returns Avi's workspace diff response. All three methods force the URL conversation's `projectPath`; caller-provided folder paths are ignored.

## `attachments:read`

Reads an attachment only after validating `messageId` and `attachmentId` ownership against the URL conversation's messages. It never accepts a filesystem path, and only the documented parameters are accepted; any other field is rejected.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messageId` | string | Yes | Owning message ID. |
| `attachmentId` | string | Yes | Attachment ID on that message. |
| `offset` | non-negative integer | No | Byte offset. Defaults to 0. |
| `limit` | integer | No | Decoded bytes from 1 to 524288. Defaults to 262144. |

### Result

`{ messageId, attachmentId, name, mime, size, offset, data, cursor, hasMore }`, where `data` is base64 and `cursor` is the next byte offset or `null`.

## `tasks:list`

Returns the current task list for the URL conversation.

### Params

Omit `params`, or set `params.payload` to the same conversation ID as the URL.

### Result

[`Task[]`](types.md#task).
