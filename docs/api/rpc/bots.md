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

### `BotSnapshot`

`bots:list` returns every [`BotRecord`](#botrecord) field plus:

| Field | Type | Description |
| --- | --- | --- |
| `resolvedWorkingFolder` | string | Effective working folder after defaults. |
| `resolvedDataFolder` | string | Effective bot data folder. |
| `conversation` | [`Conversation`](types.md#conversation) \| null | Bot's current main conversation. |
| `running` | boolean | Whether the bot currently has an active run. |
| `pendingApprovals` | number | Count of pending approval work items. |
| `snooze` | [`SnoozeState`](#snoozestate) | Per-bot snooze state. |
| `scheduleState` | `"working"` \| `"disabled"` \| `"sleep"` \| `"active"` | Derived scheduler state. |
| `activationWindowDescription` | string | Human-readable activation-window summary. |
| `attentionCount` | number | Number of work items currently requiring attention. Present in list results. |

### `WorkerRef`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Worker conversation ID. |
| `title` | string | Worker title. |
| `status` | `"running"` \| `"needs-attention"` \| `"idle"` \| `"missing"` | Derived worker status. |
| `running` | boolean | Whether the worker has an active run. |
| `needsAttention` | boolean | Whether the worker requires user attention. |
| `updatedAt` | ISO 8601 string \| null | Last known update time. |

### `Approval`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Approval ID. |
| `botId` | string | Owning bot ID. |
| `workItemId` | string | Owning work-item ID. |
| `kind` | `"work"` \| `"tool"` | Approval category. |
| `context` | string | Context for the decision. |
| `prompt` | string | User-facing approval prompt. |
| `status` | `"pending"` | Approval state exposed in work state. |
| `createdAt` | ISO 8601 string | Creation time. |
| `updatedAt` | ISO 8601 string | Last update time. |
| `toolName` | string | Tool name. Present only for tool approvals. |
| `workspacePath` | string | Tool workspace. Present only for tool approvals. |
| `input` | any JSON value | Tool input. Present only for tool approvals. |

### `WorkItem`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Work-item ID. |
| `title` | string | Non-empty title. |
| `objective` | string | Intended outcome. |
| `state` | `"planned"` \| `"active"` \| `"waiting"` \| `"completed"` \| `"cancelled"` | Lifecycle state. |
| `summary` | string | Current or final summary. |
| `lastProgress` | string | Most recent progress description. |
| `nextStep` | string | Next intended action. |
| `attention` | object \| null | Required user attention: `{ type, summary }`, where `type` is `"approval"`, `"review"`, or `"answer"`. |
| `blocker` | object \| null | Blocker details: `{ reason, waitingOn }`. |
| `priority` | `"critical"` \| `"high"` \| `"normal"` \| `"low"` | Work priority. |
| `workerThreadIds` | string[] | Associated worker conversation IDs. |
| `evidence` | object[] | Evidence entries `{ type, value }`; `type` is `"file_reference"`, `"external_reference"`, or `"text"`. |
| `approval` | [`Approval`](#approval) \| null | Pending approval associated with the item. |
| `createdAt` | ISO 8601 string | Creation time. |
| `updatedAt` | ISO 8601 string | Last update time. |
| `completedAt` | ISO 8601 string \| null | Completion time. |
| `workers` | [`WorkerRef[]`](#workerref) | Resolved workers. Present in list results. |

### `ActivityEntry`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Activity ID. |
| `workItemId` | string \| null | Related work-item ID. |
| `type` | string | One of `created`, `progress`, `discovery`, `decision`, `delegated`, `blocked`, `attention`, `completed`, `cancelled`, `failure`, or `approval`. |
| `summary` | string | Short activity description. |
| `details` | string | Additional details. |
| `createdAt` | ISO 8601 string | Creation time. |

### `WorkState`

| Field | Type | Description |
| --- | --- | --- |
| `items` | [`WorkItem[]`](#workitem) | Tracked bot work. |
| `activity` | [`ActivityEntry[]`](#activityentry) | Activity timeline. |
| `untrackedWorkers` | [`WorkerRef[]`](#workerref) | Bot workers not associated with a work item. |
| `error` | string \| null | Work-state loading or parsing error. |

## `bots:list`

### Params

Omit `params`.

### Result

| Field | Type | Description |
| --- | --- | --- |
| `bots` | [`BotSnapshot[]`](#botsnapshot) | Configured bots with derived runtime and schedule state. |
| `workStateByBot` | `Record<string, WorkState>` | Work state keyed by bot ID. |
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
| `changes` | object | Yes | Partial object using `bots:create` configuration fields. It may also contain `status` and `enabled`. |

### Result

Updated [`BotRecord`](#botrecord).

### Errors

- `Bot not found.`

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

Resolves a pending bot work approval.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `approvalId` | string | Yes | Approval ID. |
| `decision` | any JSON value | No | Only the literal boolean `false` denies. Every other value, including omitted, `null`, and `0`, approves. Clients should send an explicit boolean. |

### Result

| Field | Type | Description |
| --- | --- | --- |
| `resolved` | `true` | Confirms persistence of the decision. |
| `delivered` | boolean | Whether the decision was delivered to an active waiting run. |
| `workItemId` | string | Resolved work-item ID. |

### Errors

- `Approval item not found.`
- `Bot not found.`
- `Approval ownership mismatch.`

## `bots:update-work-item`

Changes the lifecycle state of one work item.

### Params

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `botId` | stringifiable value | Yes | Bot ID; converted with `String()`. |
| `workItemId` | stringifiable value | Yes | Work-item ID; converted with `String()`. |
| `state` | `"planned"` \| `"active"` \| `"waiting"` \| `"completed"` \| `"cancelled"` | Yes | New state. |

When completing an item with an empty summary, Avi inserts `"Marked as completed by the user."` and clears its attention, blocker, and next-step fields.

### Result

Updated [`WorkItem`](#workitem).

### Errors

- `Bot not found.`
- `Invalid state: <value>`
- `Work item not found: <id>`
- `Resolve the pending approval before changing the status.`

Bot scheduler broadcasts such as `bots:updated`, `bots:snooze`, and `bots:work-state` are internal Electron events and are not remote RPC notifications.
