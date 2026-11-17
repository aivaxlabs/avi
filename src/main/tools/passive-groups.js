export const ENABLE_TOOLS_NAME = 'enable_tools';

export const PASSIVE_TOOL_GROUPS = Object.freeze({
  bots: [
    'bots_list',
    'bots_create',
    'bots_update',
    'bots_delete',
    'bots_read_work_log',
    'bots_send_work_log_message',
    'bots_activate',
  ],
  threads: [
    'chat_overview',
    'chat_list_folders',
    'chat_list_threads',
    'chat_create_thread',
    'chat_approve_tool_call',
    'chat_interrupt_thread',
    'chat_export_thread',
  ],
  semaphores: [
    'list_semaphores',
    'sleep_semaphore',
    'release_semaphore',
    'update_semaphore_status',
  ],
  task_scheduler: [
    'task_scheduler_schedule_task',
    'task_scheduler_cancel_task',
    'task_scheduler_list_tasks',
    'task_scheduler_view_task',
    'task_scheduler_create_recurring_job',
    'task_scheduler_delete_recurring_job',
    'task_scheduler_list_recurring_jobs',
    'task_scheduler_view_recurring_job',
  ],
  secret_vault: [
    'secret_vault_put',
    'secret_vault_list',
    'secret_vault_get',
  ],
});

const groupByTool = new Map(Object.entries(PASSIVE_TOOL_GROUPS).flatMap(([group, names]) => (
  names.map((name) => [name, group])
)));

// A group stays active while the conversation history shows it was enabled or used, so activation
// survives restarts and ends naturally when compaction removes those calls.
export function applyPassiveToolGroups(tools, { calls = [], activeGroups = [] } = {}) {
  const active = new Set(activeGroups);
  for (const call of calls) {
    if (groupByTool.has(call.name)) active.add(groupByTool.get(call.name));
    if (call.name !== ENABLE_TOOLS_NAME) continue;
    try {
      for (const group of JSON.parse(call.argumentsText || '{}').groups ?? []) active.add(group);
    } catch {
      continue;
    }
  }

  const passive = new Map();
  for (const tool of tools) {
    const group = groupByTool.get(tool.name);
    if (group && !active.has(group)) passive.set(group, [...passive.get(group) ?? [], tool.name]);
  }
  if (passive.size === 0) return tools;

  return [
    ...tools.filter((tool) => !passive.has(groupByTool.get(tool.name))),
    {
      name: ENABLE_TOOLS_NAME,
      description: [
        'Activate passive Avi tool groups. Their tools stay hidden until enabled and remain available for the rest of this conversation from the next model round.',
        'Tools named in instructions but missing from your tool list belong to these groups:',
        ...[...passive].map(([group, names]) => `- ${group}: ${names.join(', ')}`),
      ].join('\n'),
      approval: 'never',
      canEditFile: false,
      canPerformDestructiveActions: false,
      inputSchema: {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', enum: [...passive.keys()] },
            description: 'Groups to activate.',
          },
        },
        required: ['groups'],
        additionalProperties: false,
      },
      execute: ({ groups }) => `Enabled ${groups.map((group) => (
        `${group} (${passive.get(group)?.join(', ') ?? 'already active'})`
      )).join('; ')}. Call these tools in your next response.`,
    },
  ];
}
