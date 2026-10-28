const DEFINITION_PROPERTIES = Object.freeze({
  title: { type: 'string', description: 'Short display title. Defaults to the first line of the instruction.' },
  instruction: { type: 'string', minLength: 1, description: 'What the task must do. Write it as a self-contained prompt: the run starts in a new thread without this conversation\'s context.' },
  folderPath: { type: 'string', description: 'Absolute working folder. Defaults to the current folder, or $HOME when there is none.' },
  model: { type: 'string', description: 'Configured model ID. Defaults to the current model.' },
  reasoningEffort: { type: 'string', description: 'Reasoning effort supported by the model, or empty for its default.' },
  permissionMode: {
    type: 'string',
    enum: ['approve_for_me', 'full_access'],
    description: 'approve_for_me pauses for user approval before destructive tools; full_access runs every tool without approval. Defaults to approve_for_me.',
  },
});

function requireScheduler(chatRunner) {
  if (!chatRunner?.taskScheduler) throw new Error('The task scheduler is not available.');
  return chatRunner.taskScheduler;
}

function withDefaults(input, { workspacePath, model, reasoningEffort, permissionMode }) {
  if (input.permissionMode === 'full_access' && permissionMode && permissionMode !== 'full_access') {
    throw new Error('Only a conversation running with Full access can create Full access tasks.');
  }
  return {
    ...input,
    folderPath: input.folderPath || workspacePath,
    ...(input.model ? {} : { model, reasoningEffort: input.reasoningEffort ?? reasoningEffort }),
  };
}

export const taskSchedulerTools = [
  {
    name: 'task_scheduler_schedule_task',
    description: 'Schedule a one-off task that Avi runs in a new thread at runAt (default: now, checked every 10 seconds). The thread receives the instruction in a <scheduled-task> envelope; the task records its output or error and execution stats. Use bots_activate, not scheduled tasks, when the work belongs to a bot.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        ...DEFINITION_PROPERTIES,
        runAt: { type: 'string', description: 'ISO 8601 date-time with offset. Omit to run now.' },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
    execute: async (input, context) => (
      requireScheduler(context.chatRunner).scheduleTask(withDefaults(input, context), { createdBy: 'agent' })
    ),
  },
  {
    name: 'task_scheduler_cancel_task',
    description: 'Cancel a scheduled or running task. A running task\'s thread is stopped.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, description: 'Task ID.' } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async ({ id }, { chatRunner }) => requireScheduler(chatRunner).cancelTask(id),
  },
  {
    name: 'task_scheduler_list_tasks',
    description: 'List scheduled tasks, newest run time first, without their output. Filter by status or recurring job.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['scheduled', 'running', 'completed', 'failed', 'cancelled'] },
        recurringJobId: { type: 'string', description: 'Only tasks created by this recurring job.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
      additionalProperties: false,
    },
    execute: async (input, { chatRunner }) => ({
      tasks: requireScheduler(chatRunner).listTasks(input).tasks.map(({ output, instruction, ...task }) => ({
        ...task,
        instruction: instruction.length > 200 ? `${instruction.slice(0, 200)}...` : instruction,
      })),
    }),
  },
  {
    name: 'task_scheduler_view_task',
    description: 'View one task with its instruction, status, thread ID, model output or error, and stats (duration, tokens, tool calls).',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, description: 'Task ID.' } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async ({ id }, { chatRunner }) => requireScheduler(chatRunner).viewTask(id),
  },
  {
    name: 'task_scheduler_create_recurring_job',
    description: 'Create a recurring job. Every minute Avi checks enabled jobs and, at each cron occurrence (local time), schedules a task with the job\'s metadata. An occurrence is skipped while the job\'s previous task is still scheduled or running. Never use recurring jobs to activate or control bots: bots have their own schedule and queue.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        ...DEFINITION_PROPERTIES,
        cron: { type: 'string', minLength: 1, description: 'Five-field cron expression in local time: minute hour day-of-month month day-of-week. Supports *, lists, ranges, and steps, e.g. "0 9 * * 1-5".' },
        enabled: { type: 'boolean', default: true },
        endsAt: { type: 'string', description: 'Optional ISO 8601 date and time with offset. Occurrences up to and including this moment run; later ones are not scheduled. Omit to run indefinitely.' },
      },
      required: ['instruction', 'cron'],
      additionalProperties: false,
    },
    execute: async (input, context) => (
      requireScheduler(context.chatRunner).createRecurringJob(withDefaults(input, context), { createdBy: 'agent' })
    ),
  },
  {
    name: 'task_scheduler_delete_recurring_job',
    description: 'Delete a recurring job and cancel its tasks that have not started. Finished and running tasks are kept.',
    forceApproval: true,
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, description: 'Recurring job ID.' } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async ({ id }, { chatRunner }) => requireScheduler(chatRunner).deleteRecurringJob(id),
  },
  {
    name: 'task_scheduler_list_recurring_jobs',
    description: 'List recurring jobs with their cron expression, enabled state, end date, and next and last run times.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, { chatRunner }) => requireScheduler(chatRunner).listRecurringJobs(),
  },
  {
    name: 'task_scheduler_view_recurring_job',
    description: 'View one recurring job with its full metadata and its 10 most recent tasks.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, description: 'Recurring job ID.' } },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async ({ id }, { chatRunner }) => requireScheduler(chatRunner).viewRecurringJob(id),
  },
];
