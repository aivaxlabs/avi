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
  smartIdleUntil,
} from './bot-scheduling.js';
import {
  BOT_DAILY_LOG_STATUSES,
  BOT_WRITABLE_LOG_STATUSES,
  botDailyLogDate,
  botDailyLogFileName,
  mutateBotDailyLogs,
  readBotDailyLogs,
  updateBotDailyLog,
  writeBotDailyLog,
  writeBotDailyLogs,
} from './bot-daily-logs.js';
import { traceError, traceInfo } from './trace-log.js';

const TICK_INTERVAL_MS = 30_000;
const WORK_FILES = Object.freeze({
  'MEMORY.md': '# Memory\n\nDurable knowledge for this bot across activations.\n',
  ...Object.fromEntries(BOT_DAILY_LOG_STATUSES.map((status) => [
    botDailyLogFileName(status),
    '[]\n',
  ])),
});

function defaultWorkingFolder(botId) {
  return join(homedir(), '.aivax', 'bots', botId);
}

export function resolveBotWorkingFolder(bot) {
  return bot?.workingFolder || defaultWorkingFolder(bot?.id ?? 'unknown');
}

export function resolveBotDataFolder(bot) {
  return join(resolveBotWorkingFolder(bot), '.avi-bots', bot?.id ?? 'unknown');
}

async function writeIfMissing(filePath, contents) {
  try {
    await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}

export async function ensureBotFolders(bot) {
  const workingFolder = resolveBotWorkingFolder(bot);
  const dataFolder = resolveBotDataFolder(bot);
  await mkdir(dataFolder, { recursive: true });
  await writeIfMissing(join(dataFolder, '.gitignore'), '*\n');
  await Promise.all(Object.entries(WORK_FILES).map(async ([fileName, defaultContents]) => {
    const filePath = join(dataFolder, fileName);
    try {
      await readFile(filePath, 'utf8');
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    let contents = defaultContents;
    try {
      contents = await readFile(join(workingFolder, fileName), 'utf8');
      if (fileName === 'waiting-user-approval.json') {
        try {
          const entries = JSON.parse(contents);
          if (Array.isArray(entries)) {
            contents = `${JSON.stringify(
              entries.filter((entry) => entry?.botId === bot?.id),
              null,
              2,
            )}\n`;
          }
        } catch {}
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await writeIfMissing(filePath, contents);
  }));
  return { workingFolder, dataFolder };
}

function activationText(bot, { activationNumber, queueCount, folders }) {
  const maxLine = bot.maxActivations > 0
    ? ` of at most ${bot.maxActivations} before automatic sleep`
    : '';
  return [
    `<bot-activation trigger="scheduler" at="${new Date().toISOString()}">`,
    `Activation #${activationNumber}${maxLine}.`,
    'Handle everything the user has specified. When nothing is explicitly specified, decide yourself what needs to be done based on the bot daily logs and do that work until nothing meaningful remains.',
    '',
    `Working folder: ${folders.workingFolder}`,
    `Bot data folder: ${folders.dataFolder}`,
    `Pending user approvals: ${queueCount}.`,
    'Read the daily logs with bot_daily_read before choosing work. Use bot_daily_write_log and bot_daily_update_log for relevant progress only; never edit the JSON log files directly.',
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
      if (bot.enabled && bot.activeAssistantMessageId) await this.resumeInterruptedRun(bot);
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
      const { dataFolder } = await ensureBotFolders(bot);
      const entries = await readBotDailyLogs(dataFolder, {
        status: 'waiting-user-approval',
      });
      for (const entry of entries) {
        if (
          entry.botId !== bot.id
          || !['work', 'tool'].includes(entry.kind)
          || typeof entry.context !== 'string'
          || typeof entry.prompt !== 'string'
          || !entry.prompt
        ) {
          throw new Error('waiting-user-approval.json contains an invalid approval entry.');
        }
        this.approvals.set(entry.id, entry);
      }
    }
  }

  async persistBotApprovals(botId) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    await mutateBotDailyLogs(bot.id, async () => {
      const { dataFolder } = await ensureBotFolders(bot);
      await writeBotDailyLogs(
        dataFolder,
        'waiting-user-approval',
        [...this.approvals.values()].filter((entry) => entry.botId === botId),
      );
    });
  }

  broadcast(type, payload = {}) {
    this.sendEvent('bots:event', { type, ...payload });
  }

  describeBots() {
    const bots = listBots();
    return bots.map((bot) => {
      const workingFolder = resolveBotWorkingFolder(bot);
      return {
        ...bot,
        resolvedWorkingFolder: workingFolder,
        resolvedDataFolder: resolveBotDataFolder(bot),
        conversation: getConversation(bot.conversationId),
        running: Boolean(this.chatRunner?.runs?.has(bot.conversationId)),
        pendingApprovals: [...this.approvals.values()]
          .filter((entry) => entry.botId === bot.id).length,
        scheduleState: this.chatRunner?.runs?.has(bot.conversationId)
          ? 'working'
          : bot.enabled === false
            ? 'disabled'
            : ['idle', 'outside-window', 'max-activations', 'paused'].includes(
                decideActivation({ bot, now: Date.now() }).reason,
              )
              ? 'sleep'
              : 'active',
        activationWindowDescription: describeActivationWindow(bot.activationWindow),
      };
    });
  }

  async listDailyLogsByBot() {
    return Object.fromEntries(await Promise.all(listBots().map((bot) => (
      mutateBotDailyLogs(bot.id, async () => {
        const { dataFolder } = await ensureBotFolders(bot);
        return [bot.id, await readBotDailyLogs(dataFolder)];
      })
    ))));
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
      enabled: config?.enabled ?? true,
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
      await this.persistBotApprovals(id);
    }
    if (
      changes.workingFolder !== undefined
      || changes.model !== undefined
      || changes.name !== undefined
    ) {
      updateConversationProject(updated.conversationId, resolveBotWorkingFolder(updated));
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
    for (const [approvalId, entry] of [...this.approvals.entries()]) {
      if (entry.botId === id) this.approvals.delete(approvalId);
    }
    await this.persistBotApprovals(id);
    deleteBot(id);
    deleteConversation(bot.conversationId);
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
    if (persisted) this.broadcast('bots:logs');
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
    const now = new Date();
    const entry = {
      id: randomUUID(),
      botId: bot.id,
      kind: 'work',
      title: normalizedTitle,
      content: String(context ?? '').trim(),
      context: String(context ?? '').trim(),
      prompt: String(prompt ?? '').trim() || normalizedTitle,
      status: 'waiting-user-approval',
      date: botDailyLogDate(now),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.approvals.set(entry.id, entry);
    try {
      await this.persistBotApprovals(bot.id);
    } catch (error) {
      this.approvals.delete(entry.id);
      throw error;
    }
    this.broadcast('bots:logs');
    return `Queued for user approval (id: ${entry.id}). The protected daily log entry was created automatically; do not retry it until the user approves it.`;
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
    const now = new Date();
    const content = `The bot requested human approval to run ${toolName}.`;
    const entry = {
      id: randomUUID(),
      botId: bot.id,
      kind: 'tool',
      title: invocationSummary || toolName,
      content,
      context: content,
      prompt: `The user approved the ${toolName} action: ${invocationSummary}. Run it now (it will not require approval again) and continue the related work.`,
      toolName,
      workspacePath,
      input: input ?? null,
      status: 'waiting-user-approval',
      date: botDailyLogDate(now),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.approvals.set(entry.id, entry);
    try {
      await this.persistBotApprovals(bot.id);
    } catch (error) {
      this.approvals.delete(entry.id);
      throw error;
    }
    this.broadcast('bots:logs');
    return entry;
  }

  async resolveApproval(approvalId, decision) {
    const entry = this.approvals.get(approvalId);
    if (!entry) throw new Error('Approval item not found.');
    this.approvals.delete(approvalId);
    try {
      await this.persistBotApprovals(entry.botId);
    } catch (error) {
      this.approvals.set(approvalId, entry);
      throw error;
    }
    const bot = getBot(entry.botId);
    if (!bot) {
      this.broadcast('bots:logs');
      return { resolved: true, delivered: false };
    }
    this.noteUserInteraction(bot.conversationId);
    const approved = decision !== false;
    const text = approved
      ? [
          `<bot-approval-resolved id="${entry.id}" decision="approved">`,
          `Title: ${entry.title}`,
          'Move the related regular work entry from blocked to ongoing before proceeding.',
          entry.prompt,
          '</bot-approval-resolved>',
        ].join('\n')
      : [
          `<bot-approval-resolved id="${entry.id}" decision="denied">`,
          `Title: ${entry.title}`,
          'The user did not approve this. Do not discard the related work automatically: move it to discarded only if the denial ends the work, backlog if it is deliberately deferred, blocked if another decision or prerequisite is required, or ongoing if an alternative can proceed now. State any needed clarification in your response.',
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
        project: { path: resolveBotWorkingFolder(bot) },
      });
      delivered = true;
    } catch (error) {
      traceError('bots.approval-delivery-error', {
        bot_id: bot.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.broadcast('bots:logs');
    return { resolved: true, delivered };
  }

  async tick() {
    for (const bot of listBots()) {
      if (!bot.enabled) continue;
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
      } else if (decision.action === 'wake') {
        updateBotScheduler(bot.id, {
          status: 'active',
          idleUntil: 'clear',
          activationCount: 0,
        });
        await this.activateBot(bot.id, { trigger: 'scheduler' });
      } else if (decision.reason === 'max-activations') {
        const idleUntil = new Date(
          smartIdleUntil(currentBot.activationPeriodMinutes, Date.now()),
        ).toISOString();
        updateBotScheduler(bot.id, {
          status: 'active',
          idleUntil,
          activationCount: 0,
          nextActivationAt: idleUntil,
        });
        this.broadcast('bots:updated');
      } else if (
        decision.reason === 'outside-window'
        && decision.nextActivationAt
        && currentBot.nextActivationAt !== decision.nextActivationAt
      ) {
        updateBotScheduler(bot.id, { nextActivationAt: decision.nextActivationAt });
        this.broadcast('bots:updated');
      }
    }
  }

  async activateBot(botId, { trigger = 'scheduler' } = {}) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (!bot.enabled) return null;
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
      const queueCount = [...this.approvals.values()]
        .filter((entry) => entry.botId === bot.id).length;
      const text = activationText(bot, {
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
      const activatedAt = Date.now();
      const nextActivationAt = new Date(
        sleeping
          ? smartIdleUntil(bot.activationPeriodMinutes, activatedAt)
          : nextActivationFrom(bot.activationPeriodMinutes, activatedAt),
      ).toISOString();
      updateBotScheduler(bot.id, {
        activationCount: sleeping ? 0 : activationCount,
        idleUntil: sleeping ? nextActivationAt : 'clear',
        nextActivationAt,
        status: 'active',
      });
      traceInfo('bots.activated', { bot_id: bot.id, trigger });
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
    const workingFolder = resolveBotWorkingFolder(bot);
    const dataFolder = resolveBotDataFolder(bot);
    const tools = [
      {
        name: 'bot_daily_write_log',
        description: 'Write one relevant work log entry. The runtime infers its date. Do not log trivial actions or edit the JSON files directly.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Concise title for the work item.' },
            content: { type: 'string', description: 'Relevant details, outcome, next step, decisions, or thread ids.' },
            status: {
              type: 'string',
              enum: BOT_WRITABLE_LOG_STATUSES,
              description: 'Current work state: backlog is not started; ongoing is actively advancing; blocked waits on a concrete prerequisite; user-review is complete but requires a specific user action; done is complete with no user action; discarded is intentionally abandoned.',
            },
          },
          required: ['title', 'content', 'status'],
          additionalProperties: false,
        },
        execute: (input) => mutateBotDailyLogs(bot.id, async () => {
          await ensureBotFolders(bot);
          const entry = await writeBotDailyLog(dataFolder, input);
          this.broadcast('bots:logs');
          return entry;
        }),
      },
      {
        name: 'bot_daily_update_log',
        description: 'Edit, move, or remove an existing bot work log entry by id. User approval entries are runtime-owned and cannot be changed with this tool.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Entry id returned by bot_daily_read or bot_daily_write_log.' },
            operation: { type: 'string', enum: ['edit', 'move', 'remove'] },
            title: { type: 'string', description: 'Replacement title for edit or move.' },
            content: { type: 'string', description: 'Replacement content for edit or move.' },
            status: {
              type: 'string',
              enum: BOT_WRITABLE_LOG_STATUSES,
              description: 'Destination state: backlog is not started; ongoing is actively advancing; blocked waits on a concrete prerequisite; user-review is complete but requires a specific user action; done is complete with no user action; discarded is intentionally abandoned.',
            },
          },
          required: ['id', 'operation'],
          additionalProperties: false,
        },
        execute: (input) => mutateBotDailyLogs(bot.id, async () => {
          await ensureBotFolders(bot);
          const entry = await updateBotDailyLog(dataFolder, input);
          this.broadcast('bots:logs');
          return entry;
        }),
      },
      {
        name: 'bot_daily_read',
        description: 'Read bot work logs, optionally filtering by status and/or inferred log date in YYYY-MM-DD format.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: BOT_DAILY_LOG_STATUSES },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
          additionalProperties: false,
        },
        execute: (input) => mutateBotDailyLogs(bot.id, async () => {
          await ensureBotFolders(bot);
          return readBotDailyLogs(dataFolder, input);
        }),
      },
      {
        name: 'queue_user_approval',
        description: 'Queue a work item when it needs explicit user approval before execution (implementations, behavior changes, or potentially destructive actions). First move its regular work entry to blocked. Provide a short context explaining why it matters and the prompt to resume with once approved. The runtime creates the protected approval entry automatically; add its returned id to the regular entry, then continue with other work.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short action title shown in the Bots panel.',
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
            description: 'Put this bot to sleep for four activation periods when there is nothing meaningful to do: the backlog is empty or irrelevant, user review has many items pending, or too much is waiting for user approval. Unlike sleep, this ends the current inference immediately instead of waiting.',
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
    return { bot, workingFolder, dataFolder, tools };
  }

  describeInvocationBot(conversationId) {
    const bot = getBotByConversation(conversationId);
    if (!bot) return null;
    const workingFolder = resolveBotWorkingFolder(bot);
    const dataFolder = resolveBotDataFolder(bot);
    const queueCount = [...this.approvals.values()]
      .filter((entry) => entry.botId === bot.id).length;
    return {
      id: bot.id,
      name: bot.name,
      workingFolder,
      dataFolder,
      workFiles: Object.keys(WORK_FILES),
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
