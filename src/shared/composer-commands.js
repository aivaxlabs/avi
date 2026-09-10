export const composerCommands = [
  {
    id: 'ultra',
    name: 'ultra',
    description: 'Lead a proactive team of sub-agents for maximum quality',
    availableInBot: false,
  },
  {
    id: 'plan',
    name: 'plan',
    description: 'Create a detailed execution plan without changing anything',
    availableInBot: false,
  },
  {
    id: 'goal',
    name: 'goal',
    description: 'Work persistently until a defined objective is completed or blocked',
    availableInBot: false,
  },
  {
    id: 'efforts',
    name: 'effort',
    description: 'Set the reasoning effort for the selected model',
    availableInBot: false,
  },
  {
    id: 'models',
    name: 'model',
    description: 'Switch the active model',
    availableInBot: false,
  },
  {
    id: 'compress',
    name: 'compress',
    description: 'Create a detailed checkpoint and compress the conversation context',
  },
  {
    id: 'quick-compress',
    name: 'quick-compress',
    description: 'Remove tool results before the latest four turns without calling a model',
  },
  {
    id: 'note',
    name: 'note',
    description: 'Create a user note using the auxiliary model (not sent to chat)',
  },
  {
    id: 'optimize-prompt',
    name: 'optimize-prompt',
    description: 'Expand and optimize the current prompt using the auxiliary model',
  },
  {
    id: 'side',
    name: 'side',
    description: 'Fork this chat into a temporary side panel',
  },
  {
    id: 'mcp',
    name: 'mcp',
    description: 'Show MCP servers available in this conversation',
  },
  {
    id: 'restart-mcp',
    name: 'restart-mcp',
    description: 'Restart all loaded MCP servers',
  },
  {
    id: 'usage',
    name: 'usage',
    description: 'Show provider account limits and counters',
  },
].map((command) => ({ ...command, type: 'interceptor' }));
