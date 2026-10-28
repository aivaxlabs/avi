# RPC bots

Bot methods are available only on the global `WS /rpc` endpoint. Scalar bot IDs use `params.payload` as described in the [RPC overview](overview.md#request-envelope). Desktop folder pickers are not exposed; clients provide `workingFolder` directly. Calls are ORPC `REQ` frames on the `avi-orpc-draft2` subprotocol; the wire method is the dotted form of the heading name and the JSON shown in examples is the frame content.

## Global activation settings and statistics

- `bots:settings` (no payload): returns `{ maxConcurrentBots, executionMode, activationWindow, crossBotInbox }` from the existing `botSettings` preferences.
- `bots:save-settings`: accepts partial settings. `maxConcurrentBots` is an integer 1–128; `executionMode` is `direct` or `orchestrator`; `crossBotInbox` is a boolean (default `false`) that gives bot conversations `bots_list`, `bots_read_work_log`, and `bots_send_work_log_message`; `activationWindow` is null or `{ days: number[], startMinute: number | null, endMinute: number | null }`. Days are 0–6, minutes 0–1439, equal bounds are invalid. Returns normalized settings and reevaluates pending activations without interrupting work.
- `bots:statistics`: accepts `{ days: 1 | 7 | 30 }` (default 7). Returns `{ days, from, to, totals, bots, timeline }`. Bot rows include `id`, `name`, `conversationId`, `descendants`, `scheduleState`, `running`, and `totals`. Totals include tokens, input/cached/output/reasoning tokens, responses, createdThreads, cost, pricedResponses and unpricedResponses. Timeline entries contain UTC date, usageMessages, tokens, cost and per-bot consumption. Costs are null for incomplete pricing; timestamps describe response usage, not activation duration. Archived descendants with retained messages are included.

`bots:list` additionally exposes `queued`, `effectiveExecutionMode`, and distinct `scheduleState` values `queued` and `outside-window`. These are activation admission states, not model inference. `bots:activate` can return `{ queued: true, reason }` instead of true when deferred; null means it did not start. Requests are deduplicated and do not create assistant placeholders until admitted. Global restrictions never gate existing work or restart resumptions. Pending requests are in-memory and do not survive restart.

Bot create/update accepts `executionMode: "direct" | "orchestrator" | null`; null inherits the global default. It also accepts `permissionMode: "read_only" | "approve_for_me" | "full_access"`; `read_only` blocks every tool call that requires approval instead of queuing it; new/migrated bots and invalid values default to `approve_for_me`, and omitted update fields preserve the stored value. Full access skips automatic tool approvals, including destructive tools, for new activations, restart resumptions, Inbox continuations, and bot-composer messages. Existing turns and pending approvals are unchanged; generic `chat:send`/`chat:retry` retain their per-call permission contract.

## Bot response types

### `SnoozeState`

| Field | Type | Description |
| --- | --- | --- |
| `active` | boolean | Whether scheduler snooze is active. |
| `mode` | `"until"` \| `"until-restart"` \| null | Snooze mode. |
| `until` | ISO 8601 string \| null | End time for a timed snooze. |

### `BotRecord`

The stored bot record returned by `bots:create` and `bots:update`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Bot ID. |
| `conversationId` | string | Bot's main conversation ID. |
| `name` | string | Display name. |
| `iconSeed` | string | Legacy avatar seed, retained for compatibility. Avi displays `https://orb.aivax.net/<bot-id>` using `id`, independently of this value. |
| `personality` | string \| null | Personality ID, or `null` to inherit the global personality. |
| `workingFolder` | string \| null | Configured working folder, or `null` for the bot default. |
| `model` | string | Configured model ID. |
| `reasoningEffort` | string \| null | Provider-specific reasoning effort. |
| `contextSize` | number \| null | Context-window override. |
| `activationPeriodMinutes` | number | Minutes between activation checks; at least 1. |
| `activationMode` | `"static"` \| `"smart"` | Periodic activation strategy. |
| `permissionMode` | `"read_only"` \| `"approve_for_me"` \| `"full_access"` | Persisted tool approval mode; defaults to `"approve_for_me"`. |
| `maxActivations` | number | Consecutive activation limit; 0 disables the limit. |
| `activationWindow` | object | Local-time schedule window. `days` contains unique weekday numbers from 0 (Sunday) through 6; `startMinute` and `endMinute` are nullable minutes from midnight. |
| `instructions` | string | Responsibilities and boundaries injected into activations. |
| `workQueue` | string[] | Ordered round-robin activation tasks. |
| `workQueueIndex` | number | Current work-queue position. |
| `enabled` | boolean | Whether scheduling may activate the bot. |
| `status` | `"active"` \| `"sleeping"` \| `"paused"` | Persisted scheduler status. |
| `nextActivationAt` | ISO 8601 string \| null | Next scheduled activation. |
| `idleUntil` | ISO 8601 string \| null | Smart-mode idle deadline. |
| `snoozeUntil` | ISO 8601 string \| null | Per-bot timed snooze deadline. |
| `activeAssistantMessageId` | string \| null | Active run's assistant message ID. |
| `priorityAutoContinue` | boolean | Whether a finished run immediately continues with the next priority queue item. Defaults to `true`. |
| `lastActivationKind` | `"work"` \| `"priority"` \| null | Kind of the latest activation, used to alternate between both queues. |
| `lastActivationAt` | ISO 8601 string \| null | Start time of the latest activation. |
| `createdAt` | ISO 8601 string | Creation time. |
| `updatedAt` | ISO 8601 string | Last update time. |

The **Overview** page opens on **Inbox** by default. This view aggregates `botDataByBot[bot.id].inbox` from the existing `bots:list` snapshot. Avi also displays the bot's Orb beside its name on bot-authored messages in the work-log reader, using the existing bot ID without additional RPC fields. Clients can join each entry with its bot's name and avatar, sort by `updatedAt` descending, and group by local date without a separate aggregation endpoint. Use the existing reply, completion, and approval operations for the selected bot and pendency; section-level Inbox errors must not hide healthy bots.

### `BotSnapshot`

`bots:list` returns every [`BotRecord`](#botrecord) field plus:

| Field | Type | Description |
| --- | --- | --- |
| `resolvedWorkingFolder` | string | Effective working folder after defaults. |
| `resolvedDataFolder` | string | Effective bot data folder. |
| `conversation` | [`Conversation`](types.md#conversation) \| null | Bot's current main conversation. |
| `running` | boolean | Whether the bot currently has an active run. |
| `pendingApprovals` | number | Count of protected pending Inbox approvals. |
| `snooze` | [`SnoozeState`](#snoozestate) | Per-bot snooze state. |
| `scheduleState` | `"working"` \| `"disabled"` \| `"sleep"` \| `"active"` | Derived scheduler state. A paused, idle, or limited bot is `"active"` while it has waiting priority items. |
| `priorityQueue` | [`PriorityQueueItem[]`](#priorityqueueitem) | System-generated priority queue in execution order. |
| `activationWindowDescription` | string | Human-readable activation-window summary. |
| `attentionCount` | number | Open pendencies whose latest bot message requires a response (`requiresUserResponse !== false`) or has no `readAt`, or whose protected approval is still pending. Present in list results. |

### `PriorityQueueItem`

Work generated by Avi for a bot, separate from its user-defined Work queue. Inbox replies, approval decisions, mentions, and prompts from other threads enter this queue instead of interrupting the bot; messages from the same origin merge into one waiting item.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Queue item ID. |
| `botId` | string | Owning bot ID. |
| `sourceKey` | string | Origin used to merge items, such as `pendency:<id>`, `thread:<id>`, or `activation`. |
| `kind` | `"activation"` \| `"inbox"` \| `"approval"` \| `"mention"` \| `"thread"` | Item type. `activation` is an explicit activation and always runs first. |
| `title` | string | Display title. |
| `workQueueId` | number \| null | Work queue item selected by an explicit activation. |
| `position` | number | Ordering key; lower runs first. |
| `claimed` | boolean | Whether an activation is starting with this item; claimed items cannot be removed or reordered. |
| `messageCount` | number | Number of merged messages. |
| `createdAt` | ISO 8601 string | Creation time. |
| `updatedAt` | ISO 8601 string | Last merge or reorder time. |

The scheduler alternates between both queues: after a Work queue activation, the next waiting priority item runs, and vice versa. Paused, idle, and activation-limited bots stop only their Work queue; waiting priority items still activate them. Disabled bots and activation windows still apply. When `priorityAutoContinue` is `true`, a run that finishes without a user Stop is followed by the next priority item, subject to global capacity. Priority activations do not advance `workQueueIndex` or count toward `maxActivations`. Items persist across restarts.

### `Approval`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Approval ID. |
| `botId` | string | Owning bot ID. |
| `pendencyId` | string | Owning Inbox pendency ID. |
| `kind` | `"work"` \| `"tool"` | Approval category. |
| `context` | string | Context for the decision. |
| `prompt` | string | User-facing approval prompt. |
| `status` | `"pending"` | Protected approval state. |
| `createdAt` | ISO 8601 string | Creation time. |
| `updatedAt` | ISO 8601 string | Last update time. |
| `toolName` | string | Tool name. Present only for tool approvals. |
| `workspacePath` | string | Tool workspace. Present only for tool approvals. |
| `input` | any JSON value | Tool input. Present only for tool approvals. |

### `PendencyMessage`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Message ID. |
| `role` | `"bot"` \| `"user"` \| `"agent"` | Sender. `agent` is a reply written by another bot through `bots_send_work_log_message`. |
| `sender` | `{ botId: string, name: string }`, optional | Present only on `agent` messages; identifies the sending bot. |
| `content` | string | Message text. |
| `attachments` | [`Attachment[]`](types.md#attachment) | Files, images, and inline content using the chat attachment format. |
| `createdAt` | ISO 8601 string | Date and time the message was sent. |
| `requiresUserResponse` | boolean, optional | Bot messages: whether a response or action is required. Missing means `true` for compatibility. |
| `readAt` | ISO 8601 string \| null, optional | Recorded when the Desktop shows the message in the focused Inbox. Listing messages does not acknowledge them. Informational messages stop counting toward attention after viewing. |
| `questions` | [`Question[]`](types.md#question), optional | Bot messages: questionnaire shown below the text, using the `ask_question` format and limits. A bot message with questions always requires a response. |
| `questionMessageId` | string, optional | User messages: ID of the bot message whose questionnaire this message answers. Present together with `answers`. |
| `answers` | `{ question: string, answer: string \| string[] }[]`, optional | User messages: normalized answers aligned with the referenced questionnaire. Each questionnaire accepts one answer message. |

### `Pendency`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Pendency ID. |
| `title` | string | Subject of the conversation. |
| `status` | `"open"` \| `"completed"` | Conversation state. |
| `messages` | [`PendencyMessage[]`](#pendencymessage) | Messages in send order. |
| `approval` | [`Approval`](#approval) \| null | Protected approval that ordinary replies/completion cannot bypass. |
| `createdAt` | ISO 8601 string | Creation time. |
| `updatedAt` | ISO 8601 string | Last message or completion time. |
| `completedAt` | ISO 8601 string \| null | Completion time; cleared by a new bot message or user reply. |

### `ActivityEntry`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Activity ID. |
| `title` | string | First-person account of an important result. |
| `description` | string | Self-contained description of the subject, work, and result. |
| `category` | string | One of `progress`, `discovery`, `decision`, `completed`, or `failure`. |
| `createdAt` | ISO 8601 string | Creation time. |

### `BotData`

| Field | Type | Description |
| --- | --- | --- |
| `inbox` | [`Pendency[]`](#pendency) | User-facing conversations, persisted in `inbox.json`. |
| `activity` | [`ActivityEntry[]`](#activityentry) | Explicit diary entries, persisted in `diary.json`. |
| `errors` | `{ inbox: string \| null, activity: string \| null }` | Independent read/validation errors for each section. A failed section returns `[]`; the healthy section remains available. |
| `error` | string \| null | Aggregated load error (`Inbox: ...; Activity: ...`), or `null` when both sections load successfully. |

Missing files represent empty sections with no error. Legacy `work-items.json` and `activity.json` are never read or imported and remain untouched. Invalid new files produce section errors, not successful empty results. Direct reads and mutations still fail on invalid data rather than replacing it.

## `bots:list`

### Params

Omit `params`.

### Result

| Field | Type | Description |
| --- | --- | --- |
| `bots` | [`BotSnapshot[]`](#botsnapshot) | Configured bots with derived runtime and schedule state. |
| `botDataByBot` | `Record<string, BotData>` | Inbox and Activity keyed by bot ID. |
| `schedulerSnooze` | [`SnoozeState`](#snoozestate) | Global scheduler snooze state. |

The method returns an empty collection/state rather than throwing when no bots exist. Bot directories load with CPU-count-bounded parallelism (`Math.max(1, availableParallelism())`) in stable bot order: inbox and activity read in parallel per bot, per-section failures return `[]` for that section, and one bot's failure does not affect the others.

## `bots:snooze`

Updates the global bot scheduler snooze.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `durationMinutes` | `60` \| `360` \| `1440` | Conditional | Timed snooze duration. If a timed snooze is already active, the duration extends from its current end. |
| `untilRestart` | boolean | No | Snooze until Avi restarts. Defaults to `false`. |
| `reset` | boolean | No | Clear the current snooze. Defaults to `false`. |

Provide the option matching the desired operation. `reset` clears; otherwise `untilRestart` takes precedence over a duration.

### Result

Updated [`SnoozeState`](#snoozestate).

### Errors

- `Bot Snooze duration must be 60, 360, or 1440 minutes.`

## `bots:snooze-one`

Updates one bot's snooze.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | string | Yes | Bot ID. |
| `options` | object | No | Same `durationMinutes`, `untilRestart`, and `reset` fields as `bots:snooze`. |

### Result

Updated [`SnoozeState`](#snoozestate).

### Errors

- `Bot not found.`
- `Bot Snooze duration must be 60, 360, or 1440 minutes.`

## `bots:create`

Creates a bot and its main thread.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | No | Display name. Defaults to `"New bot"`. |
| `iconSeed` | string | No | Legacy avatar seed, retained for compatibility. Avi displays `https://orb.aivax.net/<bot-id>` using `id`, independently of this value. |
| `personality` | string \| null | No | Personality ID, or `null` to inherit the global personality. |
| `workingFolder` | string \| null | No | Absolute working folder. Defaults to the bot's dedicated folder. |
| `model` | string | Yes | Model ID. There is no default. Fusion router IDs are rejected. |
| `reasoningEffort` | string \| null | No | Provider-specific reasoning effort. |
| `contextSize` | number \| null | No | Context-window override. |
| `activationPeriodMinutes` | number | No | Minutes between checks. Defaults to 10 and must be at least 1. |
| `activationMode` | `"static"` \| `"smart"` | No | Defaults to `"static"`. |
| `permissionMode` | `"read_only"` \| `"approve_for_me"` \| `"full_access"` | No | Defaults to `"approve_for_me"`; invalid values use the default. |
| `maxActivations` | number | No | Consecutive activation limit. Defaults to 10; 0 disables it. |
| `activationWindow` | object | No | Local-time schedule `{ days?, startMinute?, endMinute? }`. Weekdays are 0–6 and minutes are 0–1439 or `null`. |
| `instructions` | string | No | Responsibilities, priorities, and boundaries. |
| `workQueue` | string[] | No | Ordered activation tasks. Defaults to `[]`. |
| `enabled` | boolean | No | Whether scheduling may activate the bot. Defaults to `true`. |

### Result

The stored [`BotRecord`](#botrecord), without the derived `BotSnapshot` fields from `bots:list`.

```json
{
  "operationId": "7a8b9c0d-1e2f-4ad6-4be7-5c6d7e8f9a0b",
  "expiresAt": 1790000000000,
  "params": {
    "name": "Release monitor",
    "model": "provider:model",
    "workingFolder": "C:\\Code\\project",
    "enabled": false
  }
}
```

## `bots:update`

Partially updates a bot. Changes to `workingFolder`, `model`, or `name` are synchronized to its main conversation. A Fusion router `model` is rejected.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Bot ID. |
| `changes` | object | Yes | Partial object using `bots:create` configuration fields. It may also contain `status`, `enabled`, `priorityAutoContinue`, and `workQueueIndex`, the zero-based queue item to run next. |

### Result

Updated [`BotRecord`](#botrecord).

### Errors

- `Bot not found.`
- `Work queue index is out of range.` when `workQueueIndex` does not identify an item in the effective queue.

## `bots:delete`

Deletes a bot configuration and its managed runtime state.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | string | Yes | Bot ID. |

### Result

`true`.

### Errors

- `Bot not found.`

## `bots:clear-thread`

Clears the bot's current thread content while retaining the bot configuration.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | string | Yes | Bot ID. |

### Result

The reset [`Conversation`](types.md#conversation).

### Errors

- `Bot not found.`

## `bots:full-reset`

Performs a destructive bot reset: stops descendant work, clears pending approvals and questions, removes managed bot data while preserving `mcpconfig.json` in the default data folder, and resets scheduler state.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | string | Yes | Bot ID. |

### Result

`true`.

### Errors

- `Bot not found.`

## `bots:activate`

Adds an explicit activation at the front of the priority queue and starts it immediately, bypassing enabled, individual and global activation-window, Snooze, period, idle, activation-limit, and FIFO capacity checks. When the bot is working, the activation starts right after the current run. Repeated requests merge into one item. Without `workQueueId`, a waiting priority item runs first, even if the previous activation was also priority; the next Work queue item runs only when no priority item is waiting. It does not start a duplicate run. With `workQueueId`, it runs that Work queue item. If it fails to start, the item is discarded.

### Params

`payload` is either the bot ID string or an object:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | string | Yes | Bot ID. |
| `workQueueId` | integer | No | Zero-based Work queue item to focus. |

### Result

`true` when activation started; `{ queued: true, reason: "working" }` when it will start after the current run; `null` when activation fails to start.

### Errors

- `Bot not found.`

## `bots:resolve-approval`

Resolves a protected Inbox approval and records the explicit decision as a user message.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `approvalId` | string | Yes | Approval ID. |
| `decision` | boolean | Yes | `true` approves; `false` denies. Omitted and non-boolean values are rejected. |
| `always` | boolean | No | With an approved tool approval, also always allows calls with the same invocation summary in the same folder, like the chat's **Always allow**. Defaults to `false`. |

### Result

| Field | Type | Description |
| --- | --- | --- |
| `resolved` | `true` | Confirms persistence of the decision. |
| `queued` | `true` | The decision was added to the bot's priority queue. |
| `queueItemId` | string | Priority queue item that carries the decision. |
| `pendencyId` | string | Resolved pendency ID. |

### Errors

- `Approval item not found.`
- `Bot not found.`
- `Approval ownership mismatch.`

## `bots:reply-pendency`

Saves a user message in a pendency and adds a `<bot-pendency-update>` with the pendency ID, text, and attachments to the bot's priority queue. Replies to the same pendency merge into one waiting item. While the pendency has a pending protected approval, the reply is saved but not queued; the bot reads it after the approval decision.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | string | Yes | Bot ID. |
| `pendencyId` | string | Yes | Existing pendency ID. |
| `content` | string | Conditional | Reply text; may be empty when attachments or `answers` are present. |
| `attachments` | [`Attachment[]`](types.md#attachment) | No | Chat-format attachments. Defaults to `[]`. |
| `questionMessageId` | string | Conditional | Required with `answers`: the bot message that holds the questionnaire. |
| `answers` | `{ question: string, answer: string \| string[] }[]` | No | One answer per question, in order, matching each `question` text. `multiple_choice` answers are non-empty arrays; others are non-empty strings. Choice answers may be custom ("Other") text. A questionnaire can be answered once. |

Answers are delivered inside the `<bot-pendency-update>` as `<answers question-message-id="...">` with one `- question: answer` line per question.

### Result

| Field | Type | Description |
| --- | --- | --- |
| `item` | [`Pendency`](#pendency) | Updated conversation, including the saved reply. |
| `queued` | boolean | Whether the update was added to the priority queue. |
| `queueItemId` | string \| null | Priority queue item that carries the update. |

An ordinary reply never grants a protected approval.

## `bots:remove-priority-item`

Removes a waiting item from a bot's priority queue. Its messages stay in the Inbox or source thread but are not delivered to the bot.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | string | Yes | Bot ID. |
| `itemId` | string | Yes | Priority queue item ID. |

### Result

The updated [`PriorityQueueItem[]`](#priorityqueueitem).

### Errors

- `Bot not found.`
- `Priority queue item not found or already running.`

## `bots:reorder-priority-queue`

Reorders the waiting items of a bot's priority queue.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | string | Yes | Bot ID. |
| `itemIds` | string[] | Yes | Every waiting (unclaimed) item ID exactly once, in the new order. |

### Result

The updated [`PriorityQueueItem[]`](#priorityqueueitem).

### Errors

- `Bot not found.`
- `itemIds must list every waiting priority queue item exactly once.`

## `bots:complete-pendency`

Closes a pendency with no remaining action. A protected approval must first be explicitly resolved.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | string | Yes | Bot ID. |
| `pendencyId` | string | Yes | Existing pendency ID. |

### Result

Updated [`Pendency`](#pendency) with `status: "completed"` and a completion timestamp.

The former `bots:update-work-item` operation has been removed. Clients must also replace `workStateByBot` and old work-item types with `botDataByBot` and the Inbox types above.

Bot scheduler broadcasts such as `bots:updated`, `bots:snooze`, and `bots:work-state` are internal Electron events and are not remote RPC notifications.
