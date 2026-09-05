# RPC conversation notifications

Connect to the isolated, bidirectional conversation endpoint:

```http
GET /rpc/conversations/streams/<thread-id> HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Authorization: Bearer <api-key>
```

Requests accepted by this socket are documented under [threads and messages](conversations.md), [child conversations](child-threads.md), and [chat and Goals](chat.md). This page documents server notifications.

## `conversation:ready`

Avi sends this notification immediately after a successful WebSocket upgrade.

| Field | Type | Description |
| --- | --- | --- |
| `sequence` | `0` | Initial sequence marker for this socket. |
| `conversationId` | string | Conversation ID inferred from the URL. |
| `recoveryMethod` | `"conversations:context"` | Method to call for authoritative recovery state. |

```json
{
  "jsonrpc": "2.0",
  "method": "conversation:ready",
  "params": {
    "sequence": 0,
    "conversationId": "thread-id",
    "recoveryMethod": "conversations:context"
  }
}
```

## `conversation:event`

Detailed chat events are wrapped in this notification.

| Field | Type | Description |
| --- | --- | --- |
| `sequence` | number | Per-socket event sequence. Starts at 1 and increments for every forwarded event. |
| `conversationId` | string | URL conversation ID. Events for other conversations are not forwarded. |
| `event` | object | Original `chat:event` payload. It always contains the same `conversationId`. |

```json
{
  "jsonrpc": "2.0",
  "method": "conversation:event",
  "params": {
    "sequence": 17,
    "conversationId": "thread-id",
    "event": {
      "type": "message",
      "conversationId": "thread-id",
      "message": {}
    }
  }
}
```

## Conversation event types

Every event includes `type` and `conversationId`; the table lists its additional fields.

| `event.type` | Additional fields | Description |
| --- | --- | --- |
| `message` | `message`: [`Message`](types.md#message) | New or updated persisted message. An explicit user Stop persists `stoppedByUser: true` on the aborted message. Streamed text, reasoning, tool calls, and tool results arrive through message segment updates. Tool-call segments are lightweight projections; retrieve omitted arguments, result, and media through [`conversations:tool-call-details`](conversations.md#conversationstool-call-details). |
| `conversation` | `conversation`: [`Conversation`](types.md#conversation) | Updated conversation metadata or state. |
| `message-delete` | `messageId`: string | A persisted or queued message was deleted. |
| `run-state` | `running`: boolean; `startedAt`?: number | Authoritative active-run state, including tool execution and finalization. `startedAt` is Unix time in milliseconds and is present only when `running` is true. Persisted message status does not replace this state: a message may finish before the run does or remain `streaming` after a crash. |
| `block-state` | `blocked`: boolean | Whether the conversation is currently blocked. |
| `queue-order` | `steerMessageIds`: string[]; `queuedMessageIds`: string[]; `messageIds`: string[] | Current steer, ordinary queue, and combined message order. |
| `mcp-waiting` | `waiting`: boolean | Whether startup is waiting for MCP configuration or connection. |
| `tasks` | `tasks`: [`Task[]`](types.md#task) | Complete current task list. |
| `error` | `message`: string | Conversation-level execution error. |
| `permission-request` | `approvalId`: string; `toolName`: string; `invocationSummary`: string; `workspacePath`: string; `input`: any JSON value | Tool execution requires a decision. Resolve with [`chat:resolve-approval`](chat.md#chatresolve-approval). |
| `permission-cancelled` | `approvalId`: string | A pending approval is no longer actionable. |
| `permission-resolved` | `approvalId`: string; `decision`: string | An approval was resolved. |
| `question-request` | `questionId`: string; `questions`: [`Question[]`](types.md#question) | Structured user input is required. Answer with [`chat:answer-question`](chat.md#chatanswer-question). |
| `question-cancelled` | `questionId`: string; `reason`?: `"afk"` | A pending question request was cancelled. |
| `subagent-created` | `subagent`: [`Conversation`](types.md#conversation) | A sub-agent conversation was created for this parent. |
| `rubber-duck-created` | `rubberDuck`: [`Conversation`](types.md#conversation); `rootConversationId`: string | A Rubber Duck conversation was created for this root thread. |

`semaphore-state` is a global internal chat event without `conversationId`. It is deliberately **not** forwarded to conversation WebSockets. Recover the current owned wait and global semaphore snapshot through [`conversations:context`](conversations.md#conversationscontext).

The global `WS /rpc` endpoint does not receive `conversation:ready` or `conversation:event` notifications.

## Reconnection and recovery

Sequence numbers are scoped to one socket and do not continue across reconnects. After reconnecting:

1. Wait for `conversation:ready` with `sequence: 0`.
2. Call `conversations:context` on the same socket.
3. Replace local conversation, message, queue, run, approval, question, semaphore, task, and child-thread state with that result.
4. Process newly received `conversation:event` notifications in increasing sequence order.

The context snapshot is authoritative; clients should not infer missed events from sequence values across different sockets.
