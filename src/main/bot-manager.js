import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  clearConversationMessages,
  createBot,
  createConversation,
  deleteBot,
  deleteConversation,
  getBot,
  getBotByConversation,
  getConversation,
  listBots,
  updateBot,
  updateBotScheduler,
  updateConversation,
  updateConversationProject,
} from './database.js';
import {
  decideActivation,
  describeActivationWindow,
  nextActivationFrom,
  rotationFocusFor,
  smartIdleUntil,
} from './bot-scheduling.js';
import { traceError, traceInfo } from './trace-log.js';

const TICK_INTERVAL_MS = 30_000;
const WORK_FILE_HEADERS = Object.freeze({
  'MEMORY.md': '# Memory\n\nDurable knowledge for this bot across activations.\n',
  'backlog.md': '# Backlog\n\nDiscovered work not yet started.\n',
  'ongoing.md': '# Ongoing\n\nWork in progress, with delegated thread ids and statuses.\n',
  'blocked.md': '# Blocked\n\nWork waiting on something, with the reason.\n',
  'user-review.md': '# User review\n\nFinished work waiting for the user to review.\n',
  'discarded.md': '# Discarded\n\nAbandoned work, with the reason.\n',
  'done.md': '# Done\n\nCompleted work.\n',
});

function defaultWorkingFolder(botId) {
  return join(homedir(), '.aivax', 'bots', botId);
}

export function resolveBotFolders(bot) {
  const workingFolder = bot?.workingFolder || defaultWorkingFolder(bot?.id ?? 'unknown');
  return {
    workingFolder,
    workDataFolder: join(workingFolder, '.avi-bots', bot?.id ?? 'unknown'),
  };
}

async function writeIfMissing(filePath, contents) {
  try {
    await readFile(filePath, 'utf8');
  } catch {
    await writeFile(filePath, contents, 'utf8');
  }
}

export async function ensureBotFolders(bot) {
  const { workingFolder, workDataFolder } = resolveBotFolders(bot);
  await mkdir(workDataFolder, { recursive: true });
  await writeIfMissing(join(workDataFolder, '.gitignore'), '*\n');
  await Promise.all(Object.entries(WORK_FILE_HEADERS)
    .map(([fileName, contents]) => writeIfMissing(join(workDataFolder, fileName), contents)));
  return { workingFolder, workDataFolder };
}

function activationText(bot, { focus, activationNumber, queueCount, folders }) {
  const maxLine = bot.maxActivations > 0
    ? ` of at most ${bot.maxActivations} before automatic sleep`
    : '';
  return [
    `<bot-activation trigger="scheduler" focus="${focus.id}" at="${new Date().toISOString()}">`,
    `Activation #${activationNumber}${maxLine}.`,
    focus.instructions,
    '',
    `Working folder: ${folders.workingFolder}`,
    `Work data folder: ${folders.workDataFolder}`,
    `Pending user approvals: ${queueCount} (see waiting-user-approval.json).`,
    'Read the work files, select one obligation for this activation, and update its status before finishing. Leave every other item for a later activation unless the user explicitly requested multiple obligations now.',
    '</bot-activation>',
  ].join('\n');
}

export class BotManager {
  constructor({ sendEvent = () => {} } = {}) {
    this.chatRunner = null;
    this.sendEvent = sendEvent;
    this.timer = null;
    this.approvals = new Map();
    this.activating = new Set();
  }

  attachChatRunner(chatRunner) {
    this.chatRunner = chatRunner;
  }

  async start() {
    if (this.timer) return;
    await this.loadPersistedApprovals();
    for (const bot of listBots()) {
      if (bot.activeAssistantMessageId) await this.resumeInterruptedRun(bot);
    }
    this.timer = setInterval(() => {
      this.tick().catch((error) => traceError('bots.tick-error', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }, TICK_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  noteRunStarted(conversationId, assistantMessageId) {
    const bot = getBotByConversation(conversationId);
    if (!bot) return;
    updateBotScheduler(bot.id, { activeAssistantMessageId: assistantMessageId });
  }

  noteRunFinished(conversationId, assistantMessageId) {
    const bot = getBotByConversation(conversationId);
    if (!bot || bot.activeAssistantMessageId !== assistantMessageId) return;
    updateBotScheduler(bot.id, { activeAssistantMessageId: null });
    this.broadcast('bots:updated');
  }

  noteRunStopped(conversationId) {
    const bot = getBotByConversation(conversationId);
    if (!bot?.activeAssistantMessageId) return;
    updateBotScheduler(bot.id, { activeAssistantMessageId: null });
    this.broadcast('bots:updated');
  }

  async resumeInterruptedRun(bot) {
    try {
      const result = await this.chatRunner?.retry({
        conversationId: bot.conversationId,
        model: bot.model,
        assistantMessageId: bot.activeAssistantMessageId,
        resumeFromFailure: true,
        permissionMode: 'approve_for_me',
      });
      if (!result?.message && !result?.queued) {
        updateBotScheduler(bot.id, { activeAssistantMessageId: null });
        return false;
      }
      traceInfo('bots.run-resumed', { bot_id: bot.id });
      return true;
    } catch (error) {
      traceError('bots.run-resume-error', {
        bot_id: bot.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async loadPersistedApprovals() {
    this.approvals.clear();
    for (const bot of listBots()) {
      const { workDataFolder } = resolveBotFolders(bot);
      let entries = [];
      try {
        entries = JSON.parse(await readFile(join(workDataFolder, 'waiting-user-approval.json'), 'utf8'));
      } catch {
        entries = [];
      }
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry?.id && entry?.botId === bot.id) this.approvals.set(entry.id, entry);
      }
    }
  }

  async persistBotApprovals(botId) {
    const bot = getBot(botId);
    if (!bot) return;
    const { workDataFolder } = resolveBotFolders(bot);
    const entries = [...this.approvals.values()].filter((entry) => entry.botId === botId);
    try {
      await mkdir(workDataFolder, { recursive: true });
      await writeFile(
        join(workDataFolder, 'waiting-user-approval.json'),
        `${JSON.stringify(entries, null, 2)}\n`,
        'utf8',
      );
    } catch (error) {
      traceError('bots.approvals-persist-error', {
        bot_id: botId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  broadcast(type, payload = {}) {
    this.sendEvent('bots:event', { type, ...payload });
  }

  describeBots() {
    const bots = listBots();
    return bots.map((bot) => ({
      ...bot,
      conversation: getConversation(bot.conversationId),
      running: Boolean(this.chatRunner?.runs?.has(bot.conversationId)),
      pendingApprovals: [...this.approvals.values()]
        .filter((entry) => entry.botId === bot.id).length,
      activationWindowDescription: describeActivationWindow(bot.activationWindow),
    }));
  }

  listApprovalQueue() {
    const botsById = new Map(listBots().map((bot) => [bot.id, bot]));
    return [...this.approvals.values()]
      .filter((entry) => botsById.has(entry.botId))
      .map((entry) => ({
        ...entry,
        botName: botsById.get(entry.botId)?.name ?? entry.botId,
      }))
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  async createBotFromConfig(config) {
    const name = String(config?.name ?? '').trim() || 'New bot';
    const botId = randomUUID();
    const workingFolder = config?.workingFolder?.trim()
      ? config.workingFolder.trim()
      : defaultWorkingFolder(botId);
    const conversation = createConversation({
      title: name,
      model: config.model,
      projectPath: workingFolder,
      conversationType: 'bot',
      titleStatus: 'generated',
    });
    const bot = createBot({
      conversationId: conversation.id,
      name,
      iconSeed: config?.iconSeed ?? randomUUID(),
      personality: config?.personality ?? null,
      workingFolder,
      model: config.model,
      reasoningEffort: config?.reasoningEffort ?? null,
      contextSize: config?.contextSize ?? null,
      activationPeriodMinutes: config?.activationPeriodMinutes ?? 10,
      activationMode: config?.activationMode ?? 'static',
      maxActivations: config?.maxActivations ?? 10,
      activationWindow: config?.activationWindow ?? {},
      instructions: config?.instructions ?? '',
      nextActivationAt: new Date(
        nextActivationFrom(config?.activationPeriodMinutes ?? 10, Date.now()),
      ).toISOString(),
    });
    await ensureBotFolders(bot);
    traceInfo('bots.created', { bot_id: bot.id, thread_id: conversation.id });
    this.broadcast('bots:updated');
    return getBot(bot.id);
  }

  async updateBotConfig(id, changes = {}) {
    const bot = getBot(id);
    if (!bot) throw new Error('Bot not found.');
    const updated = updateBot(id, changes);
    if (changes.workingFolder !== undefined) {
      await ensureBotFolders(updated);
    }
    if (
      changes.workingFolder !== undefined
      || changes.model !== undefined
      || changes.name !== undefined
    ) {
      const folders = resolveBotFolders(updated);
      updateConversationProject(updated.conversationId, folders.workingFolder);
      updateConversation(updated.conversationId, {
        ...(changes.model !== undefined ? { model: updated.model } : {}),
        ...(changes.name !== undefined ? { title: updated.name } : {}),
      });
    }
    this.broadcast('bots:updated');
    return getBot(id);
  }

  async deleteBotById(id) {
    const bot = getBot(id);
    if (!bot) throw new Error('Bot not found.');
    deleteBot(id);
    deleteConversation(bot.conversationId);
    let persisted = false;
    for (const [approvalId, entry] of [...this.approvals.entries()]) {
      if (entry.botId === id) {
        this.approvals.delete(approvalId);
        persisted = true;
      }
    }
    if (persisted) await this.persistBotApprovals(id);
    traceInfo('bots.deleted', { bot_id: id });
    this.broadcast('bots:updated');
    return true;
  }

  async clearBotThread(id) {
    const bot = getBot(id);
    if (!bot) throw new Error('Bot not found.');
    this.chatRunner?.stop(bot.conversationId, { includeSubagents: true, stoppedByUser: true });
    updateBotScheduler(bot.id, { activeAssistantMessageId: null });
    let persisted = false;
    for (const [approvalId, entry] of [...this.approvals.entries()]) {
      if (entry.botId === id) {
        this.approvals.delete(approvalId);
        persisted = true;
      }
    }
    if (persisted) await this.persistBotApprovals(id);
    const conversation = clearConversationMessages(bot.conversationId);
    this.broadcast('bots:updated');
    if (persisted) this.broadcast('bots:queue');
    return conversation;
  }

  noteUserInteraction(conversationId) {
    const bot = getBotByConversation(conversationId);
    if (!bot) return false;
    updateBotScheduler(bot.id, {
      status: 'active',
      idleUntil: 'clear',
      activationCount: 0,
      nextActivationAt: new Date(
        nextActivationFrom(bot.activationPeriodMinutes, Date.now()),
      ).toISOString(),
    });
    this.broadcast('bots:updated');
    return true;
  }

  requestBotIdle(conversationId, reason) {
    const bot = getBotByConversation(conversationId);
    if (!bot) return { idle: false, message: 'This conversation has no bot.' };
    updateBotScheduler(bot.id, {
      idleUntil: new Date(smartIdleUntil(bot.activationPeriodMinutes, Date.now())).toISOString(),
    });
    traceInfo('bots.idle-requested', { bot_id: bot.id });
    this.broadcast('bots:updated');
    return {
      idle: true,
      message: `This bot is now idle until ${new Date(smartIdleUntil(bot.activationPeriodMinutes, Date.now())).toLocaleString()}. The current inference ends after this tool result.`,
    };
  }

  async queueUserApproval(conversationId, { title, context, prompt } = {}) {
    const bot = getBotByConversation(conversationId);
    if (!bot) throw new Error('This conversation has no bot.');
    const normalizedTitle = String(title ?? '').trim();
    if (!normalizedTitle) throw new Error('title is required.');
    const entry = {
      id: randomUUID(),
      botId: bot.id,
      kind: 'work',
      title: normalizedTitle,
      context: String(context ?? '').trim(),
      prompt: String(prompt ?? '').trim() || normalizedTitle,
      createdAt: new Date().toISOString(),
    };
    this.approvals.set(entry.id, entry);
    await this.persistBotApprovals(bot.id);
    this.broadcast('bots:queue');
    return `Queued for user approval (id: ${entry.id}). Record this item as awaiting approval and finish the activation; do not retry it until the user approves it.`;
  }

  async queueToolApproval({
    conversationId,
    toolName,
    invocationSummary,
    workspacePath,
    input,
  }) {
    const bot = getBotByConversation(conversationId);
    if (!bot) return null;
    const entry = {
      id: randomUUID(),
      botId: bot.id,
      kind: 'tool',
      title: invocationSummary || toolName,
      context: `The bot requested human approval to run ${toolName}.`,
      prompt: `The user approved the ${toolName} action: ${invocationSummary}. Run it now (it will not require approval again) and continue the related work.`,
      toolName,
      workspacePath,
      input: input ?? null,
      createdAt: new Date().toISOString(),
    };
    this.approvals.set(entry.id, entry);
    await this.persistBotApprovals(bot.id);
    this.broadcast('bots:queue');
    return entry;
  }

  async resolveApproval(approvalId, decision) {
    const entry = this.approvals.get(approvalId);
    if (!entry) throw new Error('Approval item not found.');
    this.approvals.delete(approvalId);
    await this.persistBotApprovals(entry.botId);
    const bot = getBot(entry.botId);
    if (!bot) {
      this.broadcast('bots:queue');
      return { resolved: true, delivered: false };
    }
    this.noteUserInteraction(bot.conversationId);
    const approved = decision !== false;
    const text = approved
      ? [
          `<bot-approval-resolved id="${entry.id}" decision="approved">`,
          `Title: ${entry.title}`,
          entry.prompt,
          '</bot-approval-resolved>',
        ].join('\n')
      : [
          `<bot-approval-resolved id="${entry.id}" decision="denied">`,
          `Title: ${entry.title}`,
          'The user did not approve this. Either ask the user for the reason in your response text or discard the task by moving it to discarded.md with a short note.',
          '</bot-approval-resolved>',
        ].join('\n');
    let delivered = false;
    try {
      await this.chatRunner?.send({
        conversationId: bot.conversationId,
        model: bot.model,
        reasoningEffort: bot.reasoningEffort,
        permissionMode: 'approve_for_me',
        text,
        fromAgent: true,
        project: { path: resolveBotFolders(bot).workingFolder },
      });
      delivered = true;
    } catch (error) {
      traceError('bots.approval-delivery-error', {
        bot_id: bot.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.broadcast('bots:queue');
    return { resolved: true, delivered };
  }

  async tick() {
    for (const bot of listBots()) {
      if (
        bot.activeAssistantMessageId
        && !this.chatRunner?.runs?.has(bot.conversationId)
      ) {
        await this.resumeInterruptedRun(bot);
      }
      const currentBot = getBot(bot.id);
      const decision = decideActivation({
        bot: currentBot,
        now: Date.now(),
        isRunning: Boolean(
          currentBot?.activeAssistantMessageId
          || this.chatRunner?.runs?.has(bot.conversationId)
        ),
      });
      if (decision.action === 'activate') {
        await this.activateBot(bot.id, { trigger: 'scheduler' });
      } else if (decision.reason === 'max-activations') {
        updateBotScheduler(bot.id, { status: 'sleeping' });
        this.broadcast('bots:updated');
      } else if (decision.reason === 'outside-window' && decision.nextActivationAt) {
        updateBotScheduler(bot.id, { nextActivationAt: decision.nextActivationAt });
      }
    }
  }

  async activateBot(botId, { trigger = 'scheduler' } = {}) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (this.activating.has(bot.id)) return null;
    if (this.chatRunner?.runs?.has(bot.conversationId)) {
      updateBotScheduler(bot.id, {
        nextActivationAt: new Date(
          nextActivationFrom(bot.activationPeriodMinutes, Date.now()),
        ).toISOString(),
      });
      return null;
    }
    this.activating.add(bot.id);
    try {
      const folders = await ensureBotFolders(bot);
      const { focus, nextIndex } = rotationFocusFor(bot.rotationIndex);
      const queueCount = [...this.approvals.values()]
        .filter((entry) => entry.botId === bot.id).length;
      const text = activationText(bot, {
        focus,
        activationNumber: bot.activationCount + 1,
        queueCount,
        folders,
      });
      await this.chatRunner?.send({
        conversationId: bot.conversationId,
        model: bot.model,
        reasoningEffort: bot.reasoningEffort,
        permissionMode: 'approve_for_me',
        text,
        fromAgent: true,
        project: { path: folders.workingFolder },
      });
      const activationCount = bot.activationCount + 1;
      const sleeping = bot.maxActivations > 0 && activationCount >= bot.maxActivations;
      updateBotScheduler(bot.id, {
        activationCount,
        rotationIndex: nextIndex,
        idleUntil: 'clear',
        nextActivationAt: new Date(
          nextActivationFrom(bot.activationPeriodMinutes, Date.now()),
        ).toISOString(),
        ...(sleeping ? { status: 'sleeping' } : {}),
      });
      traceInfo('bots.activated', { bot_id: bot.id, trigger, focus: focus.id });
      this.broadcast('bots:updated');
      return true;
    } catch (error) {
      traceError('bots.activation-error', {
        bot_id: bot.id,
        error: error instanceof Error ? error.message : String(error),
      });
      updateBotScheduler(bot.id, {
        nextActivationAt: new Date(
          nextActivationFrom(bot.activationPeriodMinutes, Date.now()),
        ).toISOString(),
      });
      this.broadcast('bots:updated');
      return null;
    } finally {
      this.activating.delete(bot.id);
    }
  }

  getBotRuntimeContext(conversationId) {
    const bot = getBotByConversation(conversationId);
    if (!bot) return null;
    const folders = resolveBotFolders(bot);
    const tools = [
      {
        name: 'queue_user_approval',
        description: 'Queue the selected work item when it needs explicit user approval before execution (implementations, behavior changes, or potentially destructive actions). Provide a short context explaining why it matters and the prompt to resume with once approved. After queuing it, record its status and finish the activation instead of starting another obligation.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short action title shown in the Bot queue panel.',
            },
            context: {
              type: 'string',
              description: 'Mini-context explaining why this needs the user.',
            },
            prompt: {
              type: 'string',
              description: 'Instructions to resume this work once the user approves it.',
            },
          },
          required: ['title', 'context', 'prompt'],
          additionalProperties: false,
        },
        execute: (input) => this.queueUserApproval(conversationId, input),
      },
      ...(bot.activationMode === 'smart'
        ? [{
            name: 'set_bot_idle',
            description: 'Put this bot to sleep for four activation periods when there is nothing meaningful to do: backlog.md is empty or irrelevant, user-review.md has many items pending, or too much is waiting for user approval. Unlike sleep, this ends the current inference immediately instead of waiting.',
            approval: 'never',
            canEditFile: false,
            canPerformDestructiveActions: false,
            inputSchema: {
              type: 'object',
              properties: {
                reason: {
                  type: 'string',
                  description: 'Short reason for going idle.',
                },
              },
              required: ['reason'],
              additionalProperties: false,
            },
            execute: (input) => {
              const result = this.requestBotIdle(conversationId, input?.reason);
              const run = this.chatRunner?.runs?.get(conversationId);
              if (run && result.idle) run.botIdleRequested = true;
              return result.message;
            },
          }]
        : []),
    ];
    return { bot, folders, tools };
  }

  describeInvocationBot(conversationId) {
    const bot = getBotByConversation(conversationId);
    if (!bot) return null;
    const folders = resolveBotFolders(bot);
    const queueCount = [...this.approvals.values()]
      .filter((entry) => entry.botId === bot.id).length;
    return {
      id: bot.id,
      name: bot.name,
      workingFolder: folders.workingFolder,
      workDataFolder: folders.workDataFolder,
      workFiles: Object.keys(WORK_FILE_HEADERS),
      activationMode: bot.activationMode,
      activationPeriodMinutes: bot.activationPeriodMinutes,
      pendingApprovals: queueCount,
      instructions: bot.instructions,
      personality: bot.personality,
      contextSize: bot.contextSize,
      model: bot.model,
    };
  }
}
