# Scheduler

`avi.scheduler` manages [Scheduled jobs](../../Scheduled%20jobs.md): one-off tasks and cron-based recurring jobs.

| Method | Capability | Result |
| --- | --- | --- |
| `listTasks({ status?, recurringJobId?, limit? })` | `scheduler.read` | `{ tasks }` |
| `viewTask(id)` | `scheduler.read` | `ScheduledTask` |
| `scheduleTask(definition)` | `scheduler.manage` | `ScheduledTask` |
| `cancelTask(id)` | `scheduler.manage` | `ScheduledTask` |
| `deleteTask(id)` | `scheduler.manage` | `{ deleted, id }` |
| `listRecurringJobs()` | `scheduler.read` | `{ jobs }` |
| `viewRecurringJob(id)` | `scheduler.read` | `RecurringJob & { recentTasks }` |
| `createRecurringJob(definition)` | `scheduler.manage` | `RecurringJob` |
| `updateRecurringJob(id, changes)` | `scheduler.manage` | `RecurringJob` |
| `deleteRecurringJob(id)` | `scheduler.manage` | `{ deleted, id }` |

Definitions, fields, and validation match the [task scheduler RPC](../rpc/task-scheduler.md). Tasks and jobs created by plugins record `createdBy: "agent"`. Unknown IDs throw `AviError` `NOT_FOUND`; invalid input throws `VALIDATION_FAILED`; `UNAVAILABLE` means the scheduler has not been initialized.

Changes emit `scheduler.task.changed` and `scheduler.recurring-job.changed` events whose `data` is `{ type, task?, job?, deletedId? }`; task events carry the run's `threadId` once it exists.

Do not use recurring jobs to drive bot activation; use `avi.bots` schedules and queues instead.
