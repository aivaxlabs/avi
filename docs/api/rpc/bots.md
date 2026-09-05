# RPC bots

Bot methods are available only on the global `WS /rpc` endpoint. Scalar bot IDs use `params.payload` as described in the [RPC overview](overview.md#parameters). Desktop folder pickers are not exposed; clients provide `workingFolder` directly.

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
| `iconSeed` | string | Stable avatar seed. |
| `personality` | string \| null | Personality ID, or `null` to inherit the global personality. |
| `workingFolder` | string \| null | Configured working folder, or `null` for the bot default. |
| `model` | string | Configured model ID. |
| `reasoningEffort` | string \| null | Provider-specific reasoning effort. |
| `contextSize` | number \| null | Context-window override. |
| `activationPeriodMinutes` | number | Minutes between activation checks; at least 1. |
| `activationMode` | `"static"` \| `"smart"` | Periodic activation strategy. |
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
| `createdAt` | ISO 8601 string | Creation time. |
| `updatedAt` | ISO 8601 string | Last update time. |

The **Overview** page opens on **Inbox** by default. This view aggregates `botDataByBot[bot.id].inbox` from the existing `bots:list` snapshot. Clients can join each entry with its bot's name and avatar, sort by `updatedAt` descending, and group by local date without a separate aggregation endpoint. Use the existing reply, completion, and approval operations for the selected bot and pendency; section-level Inbox errors must not hide healthy bots.

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
| `scheduleState` | `"working"` \| `"disabled"` \| `"sleep"` \| `"active"` | Derived scheduler state. |
| `activationWindowDescription` | string | Human-readable activation-window summary. |
| `attentionCount` | number | Open pendencies whose last message is from the bot, or whose protected approval is still pending. Present in list results. |

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
| `role` | `"bot"` \| `"user"` | Sender. |
| `content` | string | Message text. |
| `attachments` | [`Attachment[]`](types.md#attachment) | Files, images, and inline content using the chat attachment format. |
| `createdAt` | ISO 8601 string | Date and time the message was sent. |

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
| `completedAt` | ISO 8601 string \| null | Completion time; cleared by a new bot message. |

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

The method returns an empty collection/state rather than throwing when no bots exist.

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
| `iconSeed` | string | No | Stable avatar seed. |
| `personality` | string \| null | No | Personality ID, or `null` to inherit the global personality. |
| `workingFolder` | string \| null | No | Absolute working folder. Defaults to the bot's dedicated folder. |
| `model` | string | Yes | Model ID. There is no default. |
| `reasoningEffort` | string \| null | No | Provider-specific reasoning effort. |
| `contextSize` | number \| null | No | Context-window override. |
| `activationPeriodMinutes` | number | No | Minutes between checks. Defaults to 10 and must be at least 1. |
| `activationMode` | `"static"` \| `"smart"` | No | Defaults to `"static"`. |
| `maxActivations` | number | No | Consecutive activation limit. Defaults to 10; 0 disables it. |
| `activationWindow` | object | No | Local-time schedule `{ days?, startMinute?, endMinute? }`. Weekdays are 0–6 and minutes are 0–1439 or `null`. |
| `instructions` | string | No | Responsibilities, priorities, and boundaries. |
| `workQueue` | string[] | No | Ordered activation tasks. Defaults to `[]`. |
| `enabled` | boolean | No | Whether scheduling may activate the bot. Defaults to `true`. |

### Result

The stored [`BotRecord`](#botrecord), without the derived `BotSnapshot` fields from `bots:list`.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "bots:create",
  "params": {
    "name": "Release monitor",
    "model": "provider:model",
    "workingFolder": "C:\\Code\\project",
    "enabled": false
  }
}
```

## `bots:update`

Partially updates a bot. Changes to `workingFolder`, `model`, or `name` are synchronized to its main conversation.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Bot ID. |
| `changes` | object | Yes | Partial object using `bots:create` configuration fields. It may also contain `status`, `enabled`, and `workQueueIndex`, the zero-based queue item to run next. |

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

Requests immediate activation, bypassing enabled, schedule-window, period, idle, and activation-limit checks. It does not start a duplicate run.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | string | Yes | Bot ID. |

### Result

`true` when activation started; `null` when the bot is disabled, already running, or activation fails to start.

### Errors

- `Bot not found.`

## `bots:resolve-approval`

Resolves a protected Inbox approval and records the explicit decision as a user message.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `approvalId` | string | Yes | Approval ID. |
| `decision` | boolean | Yes | `true` approves; `false` denies. Omitted and non-boolean values are rejected. |

### Result

| Field | Type | Description |
| --- | --- | --- |
| `resolved` | `true` | Confirms persistence of the decision. |
| `delivered` | boolean | Whether the decision was submitted to the bot's main thread. |
| `pendencyId` | string | Resolved pendency ID. |

### Errors

- `Approval item not found.`
- `Bot not found.`
- `Approval ownership mismatch.`

## `bots:reply-pendency`

Saves a user message in a pendency and sends a `<bot-pendency-update>` to the bot's main thread, including the pendency ID, text, and attachments. The update enters the priority queue if the bot is already working; otherwise it starts a continuation.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | string | Yes | Bot ID. |
| `pendencyId` | string | Yes | Existing pendency ID. |
| `content` | string | Conditional | Reply text; may be empty when attachments are present. |
| `attachments` | [`Attachment[]`](types.md#attachment) | No | Chat-format attachments. Defaults to `[]`. |

### Result

| Field | Type | Description |
| --- | --- | --- |
| `item` | [`Pendency`](#pendency) | Updated conversation, including the saved reply. |
| `delivered` | boolean | Whether the update was submitted to the main thread. |
| `error` | string | Optional delivery failure detail. |

`delivered: false` does not undo the saved reply. Clients must show that distinction and must not blindly resend the message. An ordinary reply never grants a protected approval.

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
