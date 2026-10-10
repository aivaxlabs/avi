import { isAbsolute } from 'node:path';
import { getBotSettings, listAllConversations } from '../database.js';

function assertCrossBotInboxAllowed(botRuntime) {
  if (botRuntime && !getBotSettings().crossBotInbox) {
    throw new Error('Cross-bot Inbox access is disabled in Settings → Bots.');
  }
}

const BOT_CONFIG_PROPERTIES = Object.freeze({
  name: { type: 'string', minLength: 1, description: 'Bot display name and thread title.' },
  iconSeed: { type: 'string', minLength: 1, description: 'Optional stable seed for the bot avatar.' },
  personality: { type: 'string', description: 'Optional personality ID, or an empty string to inherit the global personality.' },
  workingFolder: { type: 'string', description: 'Absolute working folder, or an empty string to use the bot\'s dedicated default folder.' },
  model: { type: 'string', minLength: 1, description: 'Configured model ID used for every activation.' },
  reasoningEffort: { type: 'string', description: 'Reasoning effort supported by the selected model, or an empty string for its default.' },
  contextSize: { type: 'integer', minimum: 0, description: 'Optional model context-window override, or 0 to use the model default.' },
  activationPeriodMinutes: { type: 'integer', minimum: 1, description: 'Minutes between automatic activation checks.' },
  activationMode: { type: 'string', enum: ['static', 'smart'], description: 'Static activates every period; smart can idle when no useful work remains.' },
  executionMode: { type: 'string', enum: ['inherit', 'direct', 'orchestrator'], description: 'Use inherit for the global execution mode.' },
  maxActivations: { type: 'integer', minimum: 0, description: 'Consecutive activation limit before a cooldown; 0 disables the limit.' },
  activationWindow: {
    type: 'object',
    description: 'Optional local-time schedule window. Empty days means every day.',
    properties: {
      days: {
        type: 'array',
        items: { type: 'integer', minimum: 0, maximum: 6 },
        description: 'Allowed weekdays, where 0 is Sunday and 6 is Saturday.',
      },
      startMinute: { type: 'integer', minimum: 0, maximum: 1439, description: 'Omit for no start bound.' },
      endMinute: { type: 'integer', minimum: 0, maximum: 1439, description: 'Omit for no end bound.' },
    },
    additionalProperties: false,
  },
  instructions: { type: 'string', description: 'Responsibilities, priorities, and boundaries injected into every activation.' },
  workQueue: {
    type: 'array',
    description: 'Ordered round-robin tasks. The bot does not activate while this list is empty.',
    items: { type: 'string', minLength: 1 },
  },
  enabled: { type: 'boolean', description: 'Whether automatic scheduling may activate the bot.' },
});

const BOT_UPDATE_PROPERTIES = Object.freeze({
  ...BOT_CONFIG_PROPERTIES,
  workQueueIndex: {
    type: 'integer',
    minimum: 0,
    description: 'Zero-based queue item to run on the next activation.',
  },
});

function normalizeBotConfigInput(input) {
  const normalized = { ...input };
  for (const key of ['personality', 'workingFolder', 'reasoningEffort']) {
    if (normalized[key] === '') normalized[key] = null;
  }
  if (normalized.contextSize === 0) normalized.contextSize = null;
  if (normalized.executionMode === 'inherit') normalized.executionMode = null;
  return normalized;
}

export const botTools = [
  {
    name: 'bots_list',
    description: 'List configured bots and their directly associated work threads, including runtime and schedule state.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_input, { botManager, chatRunner, botRuntime }) => {
      if (!botManager) throw new Error('Bot management is not available.');
      assertCrossBotInboxAllowed(botRuntime);
      return {
        bots: botManager.describeBots().map((bot) => ({
          id: bot.id,
          name: bot.name,
          conversationId: bot.conversationId,
          workingFolder: bot.resolvedWorkingFolder,
          dataFolder: bot.resolvedDataFolder,
          model: bot.model,
          reasoningEffort: bot.reasoningEffort,
          contextSize: bot.contextSize,
          personality: bot.personality,
          instructions: bot.instructions,
          workQueue: bot.workQueue,
          workQueueItems: bot.workQueue.map((task, id) => ({ id, task })),
          workQueueIndex: bot.workQueueIndex,
          enabled: bot.enabled,
          running: bot.running,
          scheduleState: bot.scheduleState,
          queued: bot.queued,
          executionMode: bot.executionMode,
          effectiveExecutionMode: bot.effectiveExecutionMode,
          activationMode: bot.activationMode,
          activationPeriodMinutes: bot.activationPeriodMinutes,
          maxActivations: bot.maxActivations,
          activationWindow: bot.activationWindow,
          activationWindowDescription: bot.activationWindowDescription,
          nextActivationAt: bot.nextActivationAt,
          pendingApprovals: bot.pendingApprovals,
          thread: bot.conversation,
          workThreads: listAllConversations()
            .filter((thread) => thread.parentConversationId === bot.conversationId)
            .map((thread) => ({
              ...thread,
              running: Boolean(chatRunner?.runs?.has(thread.id)),
            })),
        })),
      };
    },
  },
  {
    name: 'bots_create',
    description: 'Create a persistent autonomous bot and its main thread. Use /create-bot guidance when requirements are incomplete.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: BOT_CONFIG_PROPERTIES,
      required: ['name', 'model'],
      additionalProperties: false,
    },
    execute: async (rawInput, { botManager, models }) => {
      if (!botManager) throw new Error('Bot management is not available.');
      const input = normalizeBotConfigInput(rawInput);
      if (!models.some((model) => model.id === input.model)) {
        throw new Error(`Model "${input.model}" is not configured.`);
      }
      if (input.workingFolder && !isAbsolute(input.workingFolder)) {
        throw new Error('workingFolder must be absolute.');
      }
      const bot = await botManager.createBotFromConfig(input);
      return { bot };
    },
  },
  {
    name: 'bots_update',
    description: 'Update selected configuration fields of an existing bot.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, description: 'Bot ID returned by bots_list or bots_create.' },
        changes: {
          type: 'object',
          properties: BOT_UPDATE_PROPERTIES,
          description: 'At least one field to change.',
          additionalProperties: false,
        },
      },
      required: ['id', 'changes'],
      additionalProperties: false,
    },
    execute: async ({ id, changes: rawChanges }, { botManager, models }) => {
      if (!botManager) throw new Error('Bot management is not available.');
      if (!rawChanges || Object.keys(rawChanges).length === 0) throw new Error('changes must contain at least one field.');
      const changes = normalizeBotConfigInput(rawChanges);
      if (changes.model && !models.some((model) => model.id === changes.model)) {
        throw new Error(`Model "${changes.model}" is not configured.`);
      }
      if (changes.workingFolder && !isAbsolute(changes.workingFolder)) {
        throw new Error('workingFolder must be absolute.');
      }
      const bot = await botManager.updateBotConfig(id, changes);
      return { bot };
    },
  },
  {
    name: 'bots_delete',
    description: 'Delete a bot, its main conversation, and pending approvals. Bot data files and work threads remain available.',
    forceApproval: true,
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, description: 'Bot ID returned by bots_list or bots_create.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async ({ id }, { botManager }) => {
      if (!botManager) throw new Error('Bot management is not available.');
      await botManager.deleteBotById(id);
      return { deleted: true, id };
    },
  },
  {
    name: 'bots_read_work_log',
    description: 'Read a bot’s inbox work logs, messages, and activity diary. Optionally select one work log and filter its status.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, description: 'Bot ID.' },
        workLogId: { type: 'string', minLength: 1, description: 'Optional inbox pendency ID.' },
        status: { type: 'string', enum: ['all', 'open', 'completed'], default: 'all' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async ({ id, workLogId, status = 'all' }, { botManager, botRuntime }) => {
      if (!botManager) throw new Error('Bot management is not available.');
      assertCrossBotInboxAllowed(botRuntime);
      if (!['all', 'open', 'completed'].includes(status)) throw new Error('Invalid status.');
      const data = (await botManager.listBotDataByBot(id))[id];
      if (workLogId && !data.error && !data.inbox.some((item) => item.id === workLogId)) {
        throw new Error('Work log not found.');
      }
      return {
        id,
        ...data,
        inbox: data.inbox.filter((item) => (!workLogId || item.id === workLogId) && (status === 'all' || item.status === status)),
      };
    },
  },
  {
    name: 'bots_send_work_log_message',
    description: 'Append a message to an existing bot inbox work log and deliver it to the bot’s main thread. Returns the persisted item and delivery status; does not resolve pending approvals. When a bot calls this tool, the message is recorded and delivered as written by that bot, not by the user.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, description: 'Bot ID.' },
        workLogId: { type: 'string', minLength: 1, description: 'Inbox pendency ID from bots_read_work_log.' },
        message: { type: 'string', minLength: 1 },
      },
      required: ['id', 'workLogId', 'message'],
      additionalProperties: false,
    },
    execute: async ({ id, workLogId, message }, { botManager, botRuntime }) => {
      if (!botManager) throw new Error('Bot management is not available.');
      assertCrossBotInboxAllowed(botRuntime);
      return botManager.replyToPendency(id, workLogId, {
        content: message,
        senderBotId: botRuntime?.bot.id ?? null,
      });
    },
  },
  {
    name: 'bots_activate',
    description: 'Activate a bot immediately. Explicit activation ignores every automatic scheduling rule: enabled state, period, idle, individual and global activation hours, Snoozes, activation limit, and FIFO capacity. With an empty work queue, the bot reviews its full scope. Does not start duplicate runs.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, description: 'Bot ID returned by bots_list or bots_create.' },
        workQueueId: { type: 'integer', minimum: 0, description: 'Optional zero-based ID from workQueueItems. Overrides the focus for this activation without advancing the recurring queue cursor.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async ({ id, workQueueId }, { botManager }) => {
      if (!botManager) throw new Error('Bot management is not available.');
      const activated = await botManager.activateBot(id, { trigger: 'agent', force: true, workQueueId });
      return {
        id,
        activated: activated === true,
        status: activated === true ? 'started' : 'already_running_or_start_failed',
      };
    },
  },
];
