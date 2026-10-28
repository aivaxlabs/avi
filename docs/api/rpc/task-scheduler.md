# Task scheduler RPC

Global RPC methods for [Scheduled jobs](../../Scheduled%20jobs.md). The desktop renderer uses the same channels through `window.chatApp.taskScheduler` and receives `task-scheduler:event` notifications `{ type: "task" | "recurring-job", task?, job?, deletedId? }`.

| Method | Payload | Result |
| --- | --- | --- |
| `task-scheduler:list-tasks` | `{ status?, recurringJobId?, limit? }` (limit 1–500, default 50) | `{ tasks: ScheduledTask[] }`, newest `runAt` first |
| `task-scheduler:view-task` | task ID string | `ScheduledTask` |
| `task-scheduler:schedule-task` | `TaskDefinition & { runAt? }` | `ScheduledTask` |
| `task-scheduler:cancel-task` | task ID string | `ScheduledTask` with `status: "cancelled"`; only scheduled or running tasks |
| `task-scheduler:delete-task` | task ID string | `{ deleted: true, id }`; only finished or cancelled tasks |
| `task-scheduler:list-recurring-jobs` | none | `{ jobs: RecurringJob[] }` |
| `task-scheduler:view-recurring-job` | job ID string | `RecurringJob & { recentTasks: ScheduledTask[] }` (10 newest) |
| `task-scheduler:create-recurring-job` | `TaskDefinition & { cron, enabled? }` | `RecurringJob` |
| `task-scheduler:update-recurring-job` | `{ id, changes }`, any subset of create fields | `RecurringJob` |
| `task-scheduler:delete-recurring-job` | job ID string | `{ deleted: true, id }`; unstarted tasks are cancelled |

RPC callers are trusted like the desktop UI: unlike agent tools, they may create `full_access` tasks directly.

## Types

### `TaskDefinition`

| Field | Type | Description |
| --- | --- | --- |
| `instruction` | string | Required prompt delivered in a `<scheduled-task>` envelope. |
| `title` | string | Optional; defaults to the instruction's first line. |
| `folderPath` | string | Absolute existing directory; defaults to `$HOME`. |
| `model` | string | Configured model ID; defaults to the last used model. |
| `reasoningEffort` | string \| null | Must be supported by the model. |
| `permissionMode` | `"approve_for_me"` \| `"full_access"` | Default `"approve_for_me"`. |
| `runAt` | ISO 8601 string | Tasks only; defaults to now. |
| `cron` | string | Jobs only; five fields in local time, supporting `*`, lists, ranges, and steps. Day-of-week 0 and 7 are Sunday. |
| `enabled` | boolean | Jobs only; default `true`. |
| `endsAt` | ISO 8601 string \| null | Jobs only; optional. Occurrences up to and including this moment run; later ones are not scheduled. Must be in the future on create; `null` removes the limit. |

### `ScheduledTask`

`id`, `title`, `recurringJobId` (null when one-off or after its job is deleted), `folderPath`, `model`, `reasoningEffort`, `instruction`, `permissionMode`, `runAt`, `status` (`scheduled`, `running`, `completed`, `failed`, `cancelled`), `conversationId`, `output` (final answer text or null), `error`, `stats` (`{ durationMs, inputTokens, outputTokens, totalTokens, toolCalls }` or null), `startedAt`, `finishedAt`, `createdBy` (`user` or `agent`), `createdAt`, `updatedAt`.

### `RecurringJob`

`id`, `title`, `folderPath`, `model`, `reasoningEffort`, `instruction`, `permissionMode`, `cron`, `enabled`, `endsAt` (null when unlimited), `nextRunAt` (null when disabled or past `endsAt`), `lastRunAt`, `createdBy`, `createdAt`, `updatedAt`.

Validation failures (missing instruction, relative or missing folder, unknown model, unsupported effort, invalid cron or status) and unknown IDs return the standard application-request error.
