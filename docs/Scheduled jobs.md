# Scheduled jobs

Scheduled jobs run a prompt unattended in a new thread at a chosen time. Open **Scheduled jobs** from the Activity Bar, below Folders.

## Tasks and recurring jobs

- A **task** runs once, now or at a date and time. Avi checks for due tasks every 10 seconds.
- A **recurring job** runs on a schedule. Every minute Avi checks enabled jobs and creates a task for each occurrence. The editor offers presets (every N minutes, hourly, daily, weekly on selected days, monthly) and an **Advanced** mode for a five-field cron expression in local time, with a preview of the next occurrences. An optional **Ends** date and time limits the job: occurrences up to and including that moment run, and later ones are not scheduled. The list then shows the job as **Ended**; clear or move the date to resume it.

Each task and job stores its folder (default `$HOME`), model, reasoning effort, instruction, and permission: **Approve for me** pauses before destructive tools; **Full access** runs every tool without approval.

## Runs and results

A due task starts in a new agent-created thread in its folder. The instruction arrives in a `<scheduled-task>` envelope that tells the model nobody is watching. The task page shows the status (Scheduled, Running, Completed, Failed, Cancelled), the final model output or error, and stats: duration, input/output/total tokens, and tool calls. **Open thread** opens the run's thread.

These threads are hidden from the Sidebar by default like other agent-created threads, but appear automatically when they need you, for example a pending approval or question, or a failed run.

Behavior to know:

- A recurring job skips an occurrence while its previous task is still scheduled or running.
- Occurrences missed while Avi was closed are not replayed; after startup, one task is created for the most recent due time.
- A task still running when Avi closes is marked Failed.
- Cancelling a running task stops its thread. Deleting a recurring job cancels its unstarted tasks and keeps finished ones.
- The scheduler does not start when Avi runs with `--inactive-bots`.

## Agents

Agents in threads, Quick Chat, and bots can manage scheduled jobs with `task_scheduler_schedule_task`, `task_scheduler_cancel_task`, `task_scheduler_list_tasks`, `task_scheduler_view_task`, `task_scheduler_create_recurring_job`, `task_scheduler_delete_recurring_job`, `task_scheduler_list_recurring_jobs`, and `task_scheduler_view_recurring_job`. Select `/create-task` in the composer for a guided setup. Deleting a recurring job requires approval, and only a conversation running with Full access can create Full access tasks.

Recurring jobs should not be used to activate bots: bots have their own schedule and queues. A one-off task that activates a bot at a specific moment is fine.

The same operations are available through [Avi commands](Api.md#scheduled-jobs), [Remote MCP](api/mcp/overview.md), [RPC](api/rpc/task-scheduler.md), and the [plugin Core API](api/core/scheduler.md).
