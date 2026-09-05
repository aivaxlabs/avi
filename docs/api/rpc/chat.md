# RPC chat and Goals

These methods are available on `WS /rpc/conversations/streams/:thread-id`. The server infers and enforces `conversationId` from the URL, so omit it unless a method table states otherwise. Responses use the shared objects in [RPC types](types.md).

## `chat:send`

Sends a user message, steers or queues it behind an active run, or waits for an owned semaphore.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Configured model ID. |
| `text` | string | No | Message text. May be empty when attachments are present. |
| `attachments` | [`Attachment[]`](types.md#attachment) | No | Message attachments. Defaults to `[]`. |
| `steer` | boolean | No | Prefer steering an active run instead of ordinary queueing. Defaults to `false`. |
| `reasoningEffort` | string \| null | No | Provider-specific reasoning effort. Defaults to `null`. |
| `permissionMode` | [`PermissionMode`](types.md#common-scalar-types) | No | Tool approval behavior. Defaults to `"approve_for_me"`. |
| `workMode` | `"plan"` \| `"goal"` \| null | No | Explicit Plan or active-Goal work mode. Defaults to `null`. |
| `ultraMode` | boolean | No | Enables Ultra orchestration. Defaults to `false`; it cannot be combined with Plan mode. |
| `queuePriority` | boolean | No | When queueing during an active run, insert before non-priority messages. Defaults to `false`. |
| `project` | object | No | Project metadata forwarded to the run. Defaults to `{}`. |

`userInitiated` is always forced to `true`. Supplying a non-null `goalId` is rejected; start a Goal with `goals:start` or continue it with `workMode: "goal"`.

The base prompt keeps the main implementation with the agent and encourages parallel delegation of independent exploration, research, analysis, and tests. It prefers multiple bounded assignments when several independent tasks exist, prohibits duplicating delegated work, and requires inspecting, guiding, and integrating sub-agent work. Session-specific instructions define any different division of work or scope restrictions. The effective Ultra mode additionally requires the orchestrator to retain the main and most demanding implementation, using sub-agents for bounded, less demanding supporting tasks and independent critique; Plan delegation remains read-only. Mode-specific responsibilities are injected only for the active mode. This is an instruction policy, not a tool-availability restriction; the request schema is unchanged.

### Result

[`SendResult`](types.md#sendresult). Use `queued` and `message.status` to distinguish immediate, steered, queued, and semaphore-waiting messages.

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "chat:send",
  "params": {
    "model": "provider:model",
    "text": "Inspect the failing tests",
    "permissionMode": "approve_for_me",
    "queuePriority": true
  }
}
```

### Errors

- `Set workMode to goal or use goals:start instead of supplying goalId.`
- `This conversation is replacing a message. Try again when it finishes.`
- `Ultra mode cannot be used with Plan mode.`
- `The selected model is no longer configured. Choose another model in Settings.`
- `Write a message or attach a file.`

## `chat:replace-user-message`

Replaces an editable user message, deletes subsequent run history, reconciles active Goal state, and sends the replacement.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messageId` | string | Yes | User message to replace. Queued, steered, hidden, and agent-authored messages are not editable. |
| `model` | string | Yes | Model used for the replacement run. |
| `text` | string | Yes | Replacement text. |
| `attachments` | [`Attachment[]`](types.md#attachment) | No | Replacement attachments. |
| `reasoningEffort` | string \| null | No | Provider-specific reasoning effort. |
| `permissionMode` | [`PermissionMode`](types.md#common-scalar-types) | No | Tool approval behavior. |
| `workMode` | `"plan"` \| `"goal"` \| null | No | Replacement work mode. |
| `ultraMode` | boolean | No | Enables Ultra orchestration. |

### Result

[`SendResult`](types.md#sendresult).

### Errors

- `This message cannot be edited.`
- `This conversation is already replacing a message.`
- The applicable `chat:send` validation errors.

## `chat:retry`

Retries an assistant response. With `resumeFromFailure`, Avi uses the same persisted-message serialization as ordinary continuation: confirmed tool results, media, and model/interface-compatible provider continuation are preserved, and only tools without recorded results execute again. Recovery includes the source user prompt when it has status `error`, `aborted`, or `waiting_mcp`, including an interruption before MCP initialization finished. If compaction already covered that prompt, recovery uses the checkpoint instead of replaying discarded history.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model used for the retry. |
| `assistantMessageId` | string | Yes | Assistant message to retry. |
| `resumeFromFailure` | boolean | No | Resume from preserved failure/tool history instead of restarting the response. Defaults to `false`. |
| `permissionMode` | [`PermissionMode`](types.md#common-scalar-types) | No | Tool approval behavior. Defaults to `"approve_for_me"`. |

### Result

| Field | Type | Description |
| --- | --- | --- |
| `conversation` | [`Conversation`](types.md#conversation) | Updated conversation. |
| `message` | [`Message`](types.md#message) \| null | Target assistant message when recovery starts. `null` for a full restart or an already-active run. |
| `queued` | boolean | `true` when a run is already active; this call does not enqueue another retry. `false` when starting recovery or a full restart. |

An invalid recovery target or missing eligible prompt/checkpoint rejects the request through the normal RPC error envelope; it no longer returns a successful no-op. Use the conversation's `run-state` events to track execution, because a run can finish before the reply arrives. The returned recovery message is the pre-resume snapshot; message events carry its updated status.

## `chat:expand-prompt`

Expands a draft through the configured auxiliary model and replaces supported `%...%` placeholders.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | Yes | Draft prompt to expand. Must contain non-whitespace text. |

### Result

A string containing the expanded prompt.

### Errors

- `Write a prompt before expanding it.`
- `Configure an auxiliary model to expand prompts.`
- `The configured auxiliary model is unavailable.`
- `Conversation not found.`
- Placeholder or auxiliary JSON validation errors.
- `The auxiliary model attempted to call a tool.`

## `chat:resolve-approval`

Resolves a pending tool approval for this conversation. `allow_all` also persists permission guidance.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `approvalId` | string | Yes | Pending approval ID. |
| `decision` | `"allow"` \| `"allow_all"` \| `"disallow"` | Yes | Approval decision. |

### Result

Boolean: `true` when a matching pending approval was resolved; `false` when it does not exist, belongs to another conversation, or the decision is invalid.

Successful resolution can emit a [`permission-resolved`](streaming.md#conversation-event-types) event.

## `chat:question-activity`

Restarts the 60-second inactivity timeout of a pending structured question without submitting answers. Plan-mode questions remain exempt from expiration.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `conversationId` | string | Yes | Conversation owning the request (injected by conversation-scoped RPC). |
| `questionId` | string | Yes | Pending question request ID. |

Returns `true` for a matching pending request, including Plan mode; `false` for a missing or differently scoped request. Resolved or expired questions are never reopened. Clients should report pointer movement, clicks, keyboard input, and scrolling inside the question UI, not unrelated page activity.

Desktop bridge: `window.chatApp.chat.questionActivity({ conversationId, questionId })`. Quick Chat uses `window.chatApp.quickChat.questionActivity({ sessionId, questionId })` through the local-only `quick-chat:question-activity` channel, which enforces window ownership of the session and returns the same boolean result.

## `chat:answer-question`

Answers or cancels a pending structured question request.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `questionId` | string | Yes | Pending question request ID. |
| `cancelled` | boolean | No | Cancel without submitting answers. Defaults to `false`. |
| `answers` | object[] | Yes unless cancelled | Exactly one answer per requested question, in the same order. Each object contains `question` and `answer`. |
| `answers[].question` | string | Yes | Must match the corresponding pending question text. |
| `answers[].answer` | string \| string[] | Yes | Non-empty string for text/single-choice questions; non-empty deduplicated string array for multiple-choice questions. |

### Result

Boolean: `true` when the matching pending request was handled; `false` when it does not exist or belongs to another conversation.

### Errors

- `Every question must have exactly one answer.`
- `Answer <number> does not match its question.`
- `Answer <number> must contain selected options.`
- `Answer <number> must be non-empty.`

## `chat:context-usage`

Calculates current context-window usage.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | No | Model used to resolve a context limit. |
| `contextLimit` | number | No | Explicit context-window limit override. |

### Result

[`ContextUsage`](types.md#contextusage).

## `chat:compress-quick`

Removes replaceable historical tool-result content without calling a model.

### Params

Omit `params`; the URL supplies `conversationId`.

### Result

| Field | Type | Description |
| --- | --- | --- |
| `conversation` | [`Conversation`](types.md#conversation) | Updated conversation. |
| `messages` | [`Message[]`](types.md#message) | Updated persisted messages. |
| `replacedResults` | number | Number of tool results replaced. |
| `charactersRemoved` | number | Number of characters removed from stored context. |

### Errors

- `Wait for the current response to finish before compressing context.`
- `Conversation not found.`

## `chat:compress`

Creates and persists a context checkpoint using the configured compactation model, falling back to the chat model. A compression message records a `context-compression` segment with `inputTokens` and `outputTokens`.

The request contains normalized conversation and in-flight tool messages followed by a final user checkpoint instruction. Provider-specific reasoning/continuation metadata is excluded while semantic content and paired tool calls/results are retained. Context-window retries use full in-flight tool history, then remove the oldest 30%, then 60%, then retain the 60% cut while also pruning intermediate assistant messages. The chat-model fallback uses the same sequence. The request and response schema is unchanged.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | No | Model used to summarize context. |

### Result

Updated [`Conversation`](types.md#conversation), including `contextCheckpoint`, `checkpointMessageId`, and `contextTokens`.

### Errors

- Active-run compression errors.
- `The model returned an empty context checkpoint.`
- `The model attempted to call a tool while compressing the context.`

## `chat:cancel-queued`

Cancels one queued or steered message owned by this conversation.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messageId` | string | Yes | Queued or steered user message ID. |

### Result

| Field | Type | Description |
| --- | --- | --- |
| `conversation` | [`Conversation`](types.md#conversation) | Updated conversation. |
| `cancelled` | boolean | `true` when the message was cancelled. A non-queued or foreign message returns `false` with unchanged order. |
| `queueOrder` | [`QueueOrder`](types.md#queueorder) | Current combined order. |
| `steerMessageIds` | string[] | Current steer-group IDs. |
| `queuedMessageIds` | string[] | Current ordinary queue IDs. |

## `chat:reorder-queued`

Reorders one queue group and can promote an ordinary queued message to steering. The supplied `messageIds` must cover the target group exactly; otherwise no reorder occurs. If no run is active, promotion or `dispatchNext` can start the next run.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `messageIds` | string[] | No | Complete desired order for the selected group. Defaults to `[]`. |
| `queueType` | `"queue"` \| `"steer"` | Yes | Group being reordered. |
| `steerMessageId` | string \| null | No | Ordinary queued message to promote to steering. Defaults to `null`. |
| `dispatchNext` | boolean | No | Start the next message when no run is active. Defaults to `false`. |

### Result

| Field | Type | Description |
| --- | --- | --- |
| `reordered` | boolean | Whether the requested order was valid and applied. |
| `steered` | boolean | Whether `steerMessageId` was promoted. |
| `queueOrder` | [`QueueOrder`](types.md#queueorder) | Current combined order. |
| `steerMessageIds` | string[] | Current steer-group IDs. |
| `queuedMessageIds` | string[] | Current ordinary queue IDs. |

## `chat:run-semaphore-now`

Bypasses the current semaphore wait and runs this thread now.

### Params

Omit `params`, or set `params.payload` to the same conversation ID as the URL.

### Result

`true`.

### Errors

- `This thread is not waiting for a semaphore.`

## `chat:cancel-semaphore`

Cancels this thread's semaphore wait.

### Params

Omit `params`, or set `params.payload` to the same conversation ID as the URL.

### Result

Boolean: `true` when a wait existed and was cancelled; otherwise `false`.

## `chat:stop`

Stops the thread and its sub-agents, pauses an active Goal, and preserves queued messages.

### Params

Omit `params`, or set `params.payload` to the same conversation ID as the URL.

### Result

Always `true`.

## `goals:start`

Creates an active Goal and sends its initial prompt.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | Yes | Model used for the Goal run. |
| `specification` | string | Yes | Complete Goal objective and acceptance criteria. |
| `reasoningEffort` | string \| null | No | Provider-specific reasoning effort. |
| `permissionMode` | [`PermissionMode`](types.md#common-scalar-types) | No | Tool approval behavior. |
| `project` | object | No | Project metadata forwarded to the run. |
| `attachments` | [`Attachment[]`](types.md#attachment) | No | Initial Goal attachments. |
| `ultraMode` | boolean | No | Enables Ultra orchestration for the Goal. |

The initial prompt is always sent; clients cannot disable it.

### Result

All [`SendResult`](types.md#sendresult) fields plus:

| Field | Type | Description |
| --- | --- | --- |
| `goal` | [`Goal`](types.md#goal) | Newly active Goal. |

### Errors

- `Goal specification is required.`
- `This conversation already has an active Goal.`
- Applicable send/model validation errors.

## `goals:change`

Changes the active Goal lifecycle.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `"pause"` \| `"resume"` \| `"edit"` \| `"stop"` \| `"completed"` \| `"blocked"` \| `"discard"` | Yes | Lifecycle operation. |
| `specification` | string | For `edit` | Replacement Goal specification. |
| `summary` | string | For `completed`/`blocked` | Required completion or blocker summary. |
| `stopRun` | boolean | No | Whether to stop the active run when changing state. Defaults to `true`. |

`stop` cancels messages queued for the Goal and can emit `message-delete` events.

### Result

| Field | Type | Description |
| --- | --- | --- |
| `result` | [`Goal`](types.md#goal) \| Goal metrics | Goal object for `pause`, `resume`, `edit`, `stop`, and `discard`; metrics object for `completed` and `blocked`. |
| `conversation` | [`Conversation`](types.md#conversation) \| null | Updated conversation. |

The completed/blocked metrics object has these fields:

| Field | Type | Description |
| --- | --- | --- |
| `goal_id` | string | Goal ID. |
| `status` | `"completed"` \| `"blocked"` | Final status. |
| `tokens_transacted` | number | Tokens transacted during the Goal. |
| `started_at` | ISO 8601 string | Goal start time. |
| `elapsed_ms` | number | Total elapsed wall-clock milliseconds. |
| `active_time_ms` | number | Milliseconds spent active rather than paused. |
| `summary` | string | Completion or blocker summary. |
| `final_response_instruction` | string | Instruction used to produce the final response. |

### Errors

- `This conversation does not have an active Goal.`
- `Only a completed, blocked, or cancelled Goal can be discarded.`
- `The Goal is already paused.`
- `The Goal is not paused.`
- `Goal specification is required.`
- `A completion or blocker summary is required.`
- `Unknown Goal action.`
