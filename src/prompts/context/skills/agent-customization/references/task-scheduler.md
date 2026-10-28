# Task scheduler

Scheduled jobs run an unattended prompt in a new thread at a chosen time. The user manages them on the **Scheduled jobs** page of the Activity Bar; agents use the `task_scheduler_*` tools.

## Concepts

- A **scheduled task** runs once at `runAt` (default: now). Every 10 seconds Avi starts due tasks in a new agent-created thread in the task's folder. The thread receives the instruction in a `<scheduled-task>` envelope and has no access to the conversation that scheduled it.
- A **recurring job** holds a five-field cron expression in local time plus the same metadata. Every minute Avi checks enabled jobs and, at each occurrence, creates a scheduled task for that moment. An occurrence is skipped while the job's previous task is still scheduled or running. Missed occurrences while Avi was closed are not replayed: one task is created for the most recent due time. An optional `endsAt` (ISO 8601 with offset) is inclusive: occurrences after it are not scheduled. Use it when the user gives an end such as "until Friday".

Each task stores its folder (default: the caller's folder, or `$HOME`), model, reasoning effort, instruction, permission mode, status (`scheduled`, `running`, `completed`, `failed`, `cancelled`), thread ID, the final model output or error, and stats: `durationMs`, `inputTokens`, `outputTokens`, `totalTokens`, and `toolCalls`. A task still running when Avi closes is marked `failed`.

## Tools

| Tool | Use |
|---|---|
| `task_scheduler_schedule_task` | Schedule a one-off task. |
| `task_scheduler_cancel_task` | Cancel a scheduled or running task; a running thread is stopped. |
| `task_scheduler_list_tasks` | List tasks by status or recurring job, without outputs. |
| `task_scheduler_view_task` | Read one task's output or error and stats. |
| `task_scheduler_create_recurring_job` | Create a cron-based recurring job. |
| `task_scheduler_delete_recurring_job` | Delete a job and cancel its unstarted tasks. Requires approval. |
| `task_scheduler_list_recurring_jobs` | List jobs with next and last run times. |
| `task_scheduler_view_recurring_job` | Read one job and its 10 most recent tasks. |

The same tools are available through Remote control MCP, `/commands/<tool>`, RPC (`task-scheduler:*`), and the plugin `scheduler` API.

## Writing tasks

- Write the instruction as a self-contained prompt: goal, inputs, files or folders, expected output, and completion criteria. Nobody watches the run, so do not rely on follow-up questions.
- Choose `permissionMode` deliberately. `approve_for_me` pauses before destructive tools and the thread then waits for the user; `full_access` runs every tool without approval. Only a conversation already running with Full access can create Full access tasks.
- Cron examples: `*/30 * * * *` every 30 minutes, `0 9 * * 1-5` weekdays at 09:00, `0 8 1 * *` the first day of each month at 08:00.
- Prefer a recurring job over a long-running thread that sleeps between checks.

## Bots

Bots have their own activation schedule, Work queue, and priority queue. **Do not use recurring jobs to activate, wake, or otherwise control bots**: change the bot's activation period or window with `bots_update`, or add Work queue items instead. A one-off scheduled task that calls `bots_activate` or messages a bot at a specific moment is acceptable.

## Creation sequence

1. Call `task_scheduler_list_tasks` or `task_scheduler_list_recurring_jobs` and avoid duplicates.
2. Confirm instruction, timing, folder, model, and permission.
3. Create the task or job.
4. Verify with `task_scheduler_view_task` or `task_scheduler_view_recurring_job`, including `runAt` or `nextRunAt`.

Use `/create-task` for this guided sequence.
