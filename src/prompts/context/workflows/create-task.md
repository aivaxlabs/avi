---
name: create-task
description: Create a scheduled task that runs once at a chosen time and/or a recurring job that runs on a cron schedule, then verify its timing.
---
# Create a scheduled task or recurring job

Use a **scheduled task** for work that must run once, now or later. Use a **recurring job** for work that repeats on a schedule. Use a bot instead when the responsibility is persistent and proactive, and a regular thread when the user is present and the work should start now interactively.

## Procedure

1. **Inspect existing work.** Call `task_scheduler_list_recurring_jobs` and `task_scheduler_list_tasks` (status `scheduled`). Update or reuse instead of creating duplicates.
2. **Choose the kind.** One moment → `task_scheduler_schedule_task`. Repeating → `task_scheduler_create_recurring_job`. Both are allowed when the user wants a first run now plus a recurring schedule.
3. **Write the instruction.** Make it self-contained: goal, folders or files, inputs, expected output, and when the task is done. The run starts in a new thread without this conversation's context and nobody answers questions.
4. **Set the metadata.** Absolute folder (default: current folder), configured model and reasoning effort, and permission: `approve_for_me` unless the user explicitly wants unattended destructive actions with `full_access`.
5. **Set the timing.** For a task, an ISO 8601 `runAt` with the user's offset, or omit it to run now. For a job, a five-field local-time cron expression; restate it in words to the user, for example "weekdays at 09:00". When the user gives an end, set `endsAt` (ISO 8601 with the user's offset); occurrences up to and including it run.
6. **Create and verify.** Call the tool, then `task_scheduler_view_task` or `task_scheduler_view_recurring_job` and check `runAt` or `nextRunAt`.
7. **Report.** Give the ID, title, timing in words, folder, model, permission, and how to follow it on the **Scheduled jobs** page.

## Boundaries

- Do not create recurring jobs that activate, wake, or steer bots; bots have their own schedule and queues. A one-off scheduled task that activates a bot at a specific moment is acceptable.
- Deleting a recurring job requires approval. Cancel tasks instead of deleting them when history should be kept.
- Do not claim a task succeeded until `task_scheduler_view_task` reports `completed`.

Use [the task scheduler reference](../skills/agent-customization/references/task-scheduler.md) for field semantics and runtime behavior.
