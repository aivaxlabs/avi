# RPC shared types

RPC results are detached JSON values. Timestamps are ISO 8601 strings unless a field explicitly uses Unix milliseconds. Filesystem paths are absolute platform-native paths.

## Common scalar types

| Type | Values and meaning |
|---|---|
| `PermissionMode` | `"ask_for_approval"`, `"approve_for_me"`, or `"full_access"`. |
| `WorkMode` | `"plan"`, `"goal"`, or `null`. |
| `ConversationType` | `"thread"`, `"side"`, `"subagent"`, `"rubber_duck"`, or `"bot"`. |
| `GoalStatus` | `"active"`, `"paused"`, `"completed"`, `"blocked"`, `"cancelled"`, or `"discarded"`. |

## `Conversation`

Returned by conversation, folder, child-thread, bot-thread, queue, compaction, and Goal methods.

| Field | Type | Description |
|---|---|---|
| `id` | string | Conversation UUID. |
| `title` | string | Display title. |
| `model` | string | Configured model ID. |
| `titleStatus` | string | Title generation state, normally `pending` or `generated`. |
| `projectPath` | string | Absolute working-folder path. |
| `projectName` | string | Folder basename, or `~/` for the home directory. |
| `projectDisplayPath` | string | User-facing absolute or home-relative path. |
| `isWorkspace` | boolean, optional | Identifies a direct child of `~/.aivax/workspaces`. Included in refreshed regular-thread metadata and live `conversation` events; recalculated from `projectPath` on each event. |
| `gitBranch` | string or `null` | Current Git branch when detectable. RPC list results refresh this value from Git. |
| `conversationType` | `ConversationType` | Thread category. |
| `isSideChat` | boolean | Whether `conversationType` is `side`. |
| `isSubagent` | boolean | Whether `conversationType` is `subagent`. |
| `isRubberDuck` | boolean | Whether `conversationType` is `rubber_duck`. |
| `isBot` | boolean | Whether `conversationType` is `bot`. |
| `createdBy` | `"user"` or `"agent"` | Originator. |
| `parentConversationId` | string or `null` | Parent ID for child conversations. |
| `initialPrompt` | string or `null` | Initial sub-agent or Rubber Duck prompt/context. |
| `orchestrationMode` | `"plan"`, `"ultra"`, or `null` | Persisted orchestration mode. Goal mode is represented by `goal`. |
| `autoForwardToParent` | boolean | Whether completed sub-agent output is forwarded to its parent. |
| `nextSubagentNameIndex` | number | Internal next-name cursor for generated sub-agent names. |
| `contextCheckpoint` | string | Current compacted context checkpoint. Empty when no checkpoint exists. |
| `checkpointMessageId` | string or `null` | Last message included in the checkpoint. |
| `contextTokens` | number | Persisted context-token estimate. |
| `lastReasoningEffort` | string or `null` | Reasoning effort used by the latest relevant message. |
| `lastReasoningAt` | string or `null` | Timestamp of the latest reasoning-effort record. |
| `tags` | string[] | Normalized unique tag IDs. |
| `goal` | `Goal` or `null` | Latest Goal associated with the conversation. |
| `workStatus` | `"blocked"` or `null` | Derived blocked state. |
| `firstPrompt` | string | First visible user prompt, or an empty string. |
| `lastMessageRole` | string or `null` | Role of the latest visible message. |
| `lastMessageStatus` | string or `null` | Status of the latest visible message. |
| `needsAttention` | boolean | Whether the latest message indicates an error, interruption, streaming residue, or unanswered user input. |
| `createdAt` | string | Creation time. |
| `updatedAt` | string | Last update time. |
| `archivedAt` | string or `null` | Archive time. |
| `isArchived` | boolean | Whether the conversation is archived. |

## `Message`

| Field | Type | Description |
|---|---|---|
| `id` | string | Message UUID. |
| `conversationId` | string | Owning conversation. |
| `role` | string | Message role. Common values are `user`, `assistant`, `system`, and `tool`. |
| `model` | string or `null` | Model associated with the message. |
| `reasoningEffort` | string or `null` | Requested reasoning effort. |
| `permissionMode` | `PermissionMode` or `null` | Permission mode used for the run. |
| `workMode` | `WorkMode` | Plan/Goal mode used for the message. |
| `ultraMode` | boolean | Whether Ultra mode was enabled. |
| `goalId` | string or `null` | Associated Goal ID. |
| `hidden` | boolean | Whether the message is hidden from ordinary conversation history. |
| `fromAgent` | boolean | Whether it originated from an agent rather than the user. |
| `queuePriority` | boolean | Whether it was inserted ahead of ordinary queued messages. |
| `queuePosition` | integer or `null` | Persisted position inside its queue group. |
| `stoppedByUser` | boolean | Whether an aborted message resulted from an explicit user Stop action. |
| `status` | string | Lifecycle state, including `queued`, `steered`, `sent`, `waiting_mcp`, `streaming`, `completed`, `aborted`, or `error`. |
| `content` | string | Textual content and serialized textual blocks. |
| `segments` | object[] | Timeline segments. Shapes depend on `type`, such as content, reasoning, tool call/result, error, provider continuation, or context compression. RPC tool-call segments omit `argumentsText`, `resultText`, and `mediaContent`; they include `conversationId`, `messageId`, `detailsAvailable`, `hasArguments`, `hasResult`, and `hasMediaContent` for deferred retrieval. Preserve unknown fields. |
| `edits` | object[] | Persisted edit history. |
| `attachments` | `Attachment[]` | Attached media/files/context markers. |
| `continuations` | object[] | Provider continuation metadata. |
| `usage` | object | Provider usage data. Common numeric fields include `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`, and `durationMs`. |
| `createdAt` | string or `null` | Creation time. |
| `updatedAt` | string | Last update time. |

## `ToolCallDetails`

Returned by `conversations:tool-call-details`.

| Field | Type | Description |
|---|---|---|
| `conversationId` | string | Owning conversation. |
| `messageId` | string | Message containing the segment. |
| `segmentId` | string | Tool-call segment ID. |
| `argumentsText` | string | Serialized tool input; empty when absent. |
| `hasResult` | boolean | Whether the segment contains a result field. |
| `resultText` | string or `null` | Serialized tool output, or `null` while no result exists. |
| `mediaContent` | object[] | Tool media payloads, or an empty array when absent. |

## `Attachment`

All attachment variants share these fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Attachment UUID. |
| `name` | string | Original/display name. |
| `mime` | string | MIME type. |
| `size` | number | Size in bytes. |
| `kind` | string | Discriminator described below. |
| `path` | string | Local materialized path when available. |
| `temporary` | boolean, optional | Whether Avi may clean up the materialized file. |
| `source` | string, optional | Origin such as `clipboard` or `pasted_text`. |

Variant fields:

| `kind` | Additional fields |
|---|---|
| `image_url` | `dataUrl?: string` containing an embedded image when not path-backed. |
| `video_url` | Usually path-backed; legacy inputs may contain `dataUrl`. |
| `input_audio` | `base64: string`, `format: "mp3"`. |
| `text_inline` | `text: string`. |
| `file` | `dataUrl: string`, including PDF/file data. |
| `file_reference` | No required extra field; content remains at `path`. |
| `context_marker` | Marker metadata may be added by the composer; no binary payload is required. |

Avi can normalize or materialize attachments before persistence. Clients must use the returned attachment object as authoritative.

Historical message attachments returned by `conversations:messages`, `conversations:context` (including its queue), and `conversation:event` message events omit `dataUrl`, `base64`, and `text`. Their metadata and IDs remain available; retrieve content using `attachments:read` with the owning message and attachment IDs. This keeps embedded media out of relay history frames. Composer draft attachments and attachment-read chunks retain their content.

## `Goal`

| Field | Type | Description |
|---|---|---|
| `id` | string | Goal UUID. |
| `conversationId` | string | Owning conversation. |
| `specification` | string | Current Goal specification. |
| `status` | `GoalStatus` | Lifecycle state. |
| `revision` | number | Specification revision, starting at 1. |
| `model` | string | Model used by the Goal. |
| `reasoningEffort` | string or `null` | Reasoning effort. |
| `permissionMode` | `PermissionMode` | Permission mode. |
| `activeElapsedMs` | number | Accumulated active time in milliseconds. |
| `resumedAt` | string or `null` | Start of the current active interval. |
| `resultSummary` | string or `null` | Completion, blocker, or cancellation summary. |
| `tokensTransacted` | number or `null` | Sum of recorded assistant input/output tokens for the Goal. |
| `startedAt` | string | Start time. |
| `updatedAt` | string | Last change time. |
| `endedAt` | string or `null` | Terminal time. |

## `ComposerState`

| Field | Type | Description |
|---|---|---|
| `conversationId` | string | Owning conversation. |
| `permissionMode` | `PermissionMode` | Draft permission mode. |
| `model` | string | Draft model ID. |
| `reasoningEffort` | string or `null` | Draft reasoning effort. |
| `workMode` | `WorkMode` | Draft Plan/Goal mode. |
| `ultraMode` | boolean | Draft Ultra flag; forced to `false` when `workMode` is `plan`. |
| `draftText` | string | Composer text. |
| `attachments` | `Attachment[]` | Draft attachments. |
| `updatedAt` | string | Last save time. |

## `Task`

| Field | Type | Description |
|---|---|---|
| `title` | string | Short task title. |
| `description` | string | Full task description. |
| `done` | boolean | Compatibility completion flag. |
| `status` | `"pending"`, `"completed"`, or `"inconclusive"` | Normalized task status. |
| `result` | string or `null` | Result or blocker explanation. `inconclusive` tasks require a non-empty result. |

## Queue types

### `QueueOrder`

| Field | Type | Description |
|---|---|---|
| `steerMessageIds` | string[] | Ordered message IDs that will steer the active run first. |
| `queuedMessageIds` | string[] | Ordered ordinary queue. |
| `messageIds` | string[] | Combined order: steer IDs followed by queued IDs. |
| `queueOrder` | string[] | Alias of `messageIds` included by request results. |

### `SendResult`

| Field | Type | Description |
|---|---|---|
| `conversation` | `Conversation` | Updated conversation. |
| `message` | `Message` | Created user message. |
| `assistantMessage` | `Message` \| null | Initial streaming assistant message when the send started a run immediately; `null` when queued or steered. |
| `queued` | boolean | `true` when queued/steered instead of starting immediately. |
| `queueOrder` | string[], optional | Present when `queued` is true. |
| `steerMessageIds` | string[], optional | Present when `queued` is true. |
| `queuedMessageIds` | string[], optional | Present when `queued` is true. |

## `MessagePage`

| Field | Type | Description |
|---|---|---|
| `messages` | `Message[]` | Chronological messages in this page. The initial page is the newest bounded slice. |
| `cursor` | string or `null` | Opaque cursor for the next older page. |
| `hasMore` | boolean | Whether older messages remain. |

## `ConversationContext`

Returned by `conversations:context` for recovery.

| Field | Type | Description |
|---|---|---|
| `conversation` | `Conversation` | Authoritative conversation snapshot. |
| `messages` | `Message[]` | Bounded chronological message page. |
| `messagePage` | object | `{ cursor, hasMore }` metadata for retrieving older messages. |
| `model` | string | Current model ID. |
| `reasoningEffort` | string or `null` | Last reasoning effort. |
| `queue.steer` | `Message[]` | Messages with status `steered`. |
| `queue.queued` | `Message[]` | Messages with status `queued`. |
| `run.active` | boolean | Whether a run is active. |
| `run.startedAt` | number or `null` | Active run start as Unix milliseconds. |
| `approvals` | `PendingApproval[]` | Pending tool approvals for this conversation. |
| `questions` | `PendingQuestion[]` | Pending interactive questions. |
| `semaphoreWaits` | `SemaphoreWait[]` | Current semaphore waits. |
| `tasks` | `Task[]` | Task state. |
| `sideChats` | `Conversation[]` | Direct side chats. |
| `subagents` | `Conversation[]` | Direct sub-agents. |
| `rubberDucks` | `Conversation[]` | Rubber Duck sessions in the conversation tree. |
| `composer` | `ComposerState` | Persisted composer snapshot. When nothing is persisted, Desktop-equivalent defaults derived from preferences and the conversation, without `updatedAt`. |
| `contextUsage` | object | `{ tokens, limit }`: `tokens` is the conversation's stored context token count and `limit` is the selected model's input context window, or `null` when unknown. |

## Approvals and questions

### `PendingApproval`

| Field | Type | Description |
|---|---|---|
| `type` | `"permission-request"` | Event discriminator. |
| `conversationId` | string | Owning conversation. |
| `approvalId` | string | Approval UUID. |
| `toolName` | string | Tool awaiting approval. |
| `invocationSummary` | string | Human-readable operation summary. |
| `workspacePath` | string | Workspace used by the operation. |
| `input` | any JSON value | Tool input; shape depends on the tool schema. |

### `Question`

| Field | Type | Description |
|---|---|---|
| `type` | `"single_choice"`, `"multiple_choice"`, or `"free_text"` | Answer mode. |
| `question` | string | Prompt and correlation text. |
| `options` | string[], optional | Valid options for choice questions. |

### `PendingQuestion`

| Field | Type | Description |
|---|---|---|
| `type` | `"question-request"` | Event discriminator. |
| `conversationId` | string | Owning conversation. |
| `questionId` | string | Pending question UUID. |
| `questions` | `Question[]` | Questions that must be answered in order. |

## Semaphores

### `SemaphoreWait`

| Field | Type | Description |
|---|---|---|
| `conversationId` | string | Waiting conversation. |
| `name` | string | Semaphore name. |
| `count` | positive integer | Requested permits. |
| `maxCount` | positive integer | Semaphore capacity. |
| `position` | positive integer | One-based queue position. |

### `SemaphoreSnapshot`

| Field | Type | Description |
|---|---|---|
| `name` | string | Semaphore name. |
| `maxCount` | number | Capacity. |
| `waitingCount` | number | Total queued permit demand. |
| `holders` | object[] | Each item has `conversationId`, `count`, and optional `blocked` summary. |
| `queue` | object[] | Each item has `conversationId` and one-based `position`. |

## `ContextUsage`

| Field | Type | Description |
|---|---|---|
| `tokens` | number | Persisted tokens currently used. |
| `limit` | number or `null` | Effective context limit. |
| `measuredCharacters` | number | Total directly measured characters before scaling. |
| `usedCharacters` | number | Token estimate converted at four characters per token. |
| `segments` | `ContextUsageSegment[]` | Distributed usage categories. |

Each `ContextUsageSegment` has:

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable category ID, sometimes suffixed with an MCP server name. |
| `label` | string | Display label. |
| `server` | string, optional | MCP server for server-specific categories. |
| `characters` | number | Directly measured characters plus residuals for `other`. |
| `contextCharacters` | number | Characters assigned to current token usage after scaling. |
| `tokens` | number | Estimated tokens for the segment. |
| `percent` | number | Fraction from 0 to 1 of used context. |

## Search and folders

### `Folder`

| Field | Type | Description |
|---|---|---|
| `path` | string | Absolute folder path. |
| `name` | string | Folder basename or `~/`. |
| `displayPath` | string | User-facing path. |
| `gitBranch` | string or `null` | Current Git branch. |
| `color` | string or `null`, optional | Lowercase `#rrggbb` folder color. Present in `folders:list`. |
| `isWorkspace` | boolean | Whether the folder is a direct child of `~/.aivax/workspaces`. |

### `ConversationSearchResult`

| Field | Type | Description |
|---|---|---|
| `score` | number | Relevance score. Scores are only comparable within one response. |
| `conversationId` | string | Matching thread. |
| `messageId` | string or `null` | Representative message. |
| `title` | string | Conversation title. |
| `role` | string | Representative message role. Semantic results use `assistant`. |
| `content` | string | Searchable/display content. |
| `updatedAt` | string | Representative update time. |
| `folderPath` | string | Absolute working folder. |
| `folderName` | string | Folder basename or `~/`. |
| `folderDisplayPath` | string | User-facing folder path. |

## Tags and sidebar status

### `Tag`

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable unique tag ID. |
| `name` | string | Display name. |
| `color` | string | Lowercase `#rrggbb` color. |

### `SidebarStatus`

Returned by `sidebar:status`. Every field is a `string[]` of unique conversation IDs in no guaranteed order.

| Field | Description |
|---|---|
| `runningConversationIds` | Conversations with an active run. |
| `approvalPendingConversationIds` | Conversations with a pending permission request. |
| `inputPendingConversationIds` | Conversations with pending agent questions awaiting user input. |
| `semaphoreWaitingConversationIds` | Conversations waiting for a semaphore permit. |
| `completedUnseenConversationIds` | Completed runs not yet acknowledged through `sidebar:mark-seen`. Ephemeral remote state; see [sidebar status and tags](sidebar.md#sidebarmark-seen). |
