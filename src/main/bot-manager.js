import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  getBotSchedulerSnoozeUntil,
  getConversation,
  getMessage,
  getMessages,
  listAllConversations,
  listBots,
  setBotSchedulerSnoozeUntil,
  updateBot,
  updateBotScheduler,
  updateConversation,
  updateConversationProject,
  updateMessage,
} from './database.js';
import {
  decideActivation,
  describeActivationWindow,
  nextActivationFrom,
  smartIdleUntil,
} from './bot-scheduling.js';
import {
  BOT_ACTIVITY_CATEGORIES,
  BOT_PENDENCY_STATUSES,
  BOT_WORK_STATE_FILES,
  appendBotActivity,
  appendBotPendencyMessage,
  attachBotPendencyApproval,
  completeBotPendency,
  consumeBotPendencyApproval,
  createBotPendency,
  ensureBotWorkStateFiles,
  readBotWorkState,
  readInboxFile,
  readActivityFile,
} from './bot-work-state.js';
import { filePathToAttachment } from './files.js';
import { traceError, traceInfo } from './trace-log.js';

const TICK_INTERVAL_MS = 30_000;
const SNOOZE_DURATIONS_MINUTES = new Set([60, 360, 1_440]);
const WORK_FILES = Object.freeze({
  'MEMORY.md': '# Memory\n\nDurable knowledge for this bot across activations.\n',
  [BOT_WORK_STATE_FILES.inbox]: '[]\n',
  [BOT_WORK_STATE_FILES.activity]: '[]\n',
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

function escapeMarkupText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
  const memoryPath = join(dataFolder, 'MEMORY.md');
  try {
    await readFile(memoryPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    let contents = WORK_FILES['MEMORY.md'];
    try {
      contents = await readFile(join(workingFolder, 'MEMORY.md'), 'utf8');
    } catch (readError) {
      if (readError?.code !== 'ENOENT') throw readError;
    }
    await writeIfMissing(memoryPath, contents);
  }
  await ensureBotWorkStateFiles(dataFolder);
  return { workingFolder, dataFolder };
}

export class BotManager {
  constructor({ sendEvent = () => {} } = {}) {
    this.chatRunner = null;
    this.sendEvent = sendEvent;
    this.timer = null;
    this.approvals = new Map();
    this.activating = new Set();
    this.botSnoozeUntilRestart = new Set();
    this.schedulerSnoozeUntil = getBotSchedulerSnoozeUntil();
    this.schedulerSnoozeUntilRestart = false;
  }

  attachChatRunner(chatRunner) {
    this.chatRunner = chatRunner;
  }

  async start() {
    if (this.timer) return;
    await this.loadPersistedApprovals();
    for (const bot of listBots()) {
      if (!bot.enabled || !bot.activeAssistantMessageId) continue;
      const resumed = await this.resumeInterruptedRun(bot);
      if (resumed) await this.chatRunner?.runs.get(bot.conversationId)?.preparation;
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

  getSchedulerSnooze(now = Date.now()) {
    if (this.schedulerSnoozeUntilRestart) {
      return { active: true, mode: 'until-restart', until: null };
    }
    const until = new Date(this.schedulerSnoozeUntil ?? '').getTime();
    if (Number.isFinite(until) && until > now) {
      return { active: true, mode: 'until', until: this.schedulerSnoozeUntil };
    }
    if (this.schedulerSnoozeUntil) {
      this.schedulerSnoozeUntil = null;
      setBotSchedulerSnoozeUntil(null);
    }
    return { active: false, mode: null, until: null };
  }

  setSchedulerSnooze({ durationMinutes, untilRestart = false, reset = false } = {}) {
    if (reset === true) {
      this.schedulerSnoozeUntilRestart = false;
      this.schedulerSnoozeUntil = null;
      setBotSchedulerSnoozeUntil(null);
    } else if (untilRestart === true) {
      this.schedulerSnoozeUntilRestart = true;
      this.schedulerSnoozeUntil = null;
      setBotSchedulerSnoozeUntil(null);
    } else {
      const duration = Number(durationMinutes);
      if (!SNOOZE_DURATIONS_MINUTES.has(duration)) {
        throw new Error('Bot Snooze duration must be 60, 360, or 1440 minutes.');
      }
      const now = Date.now();
      const currentUntil = new Date(this.schedulerSnoozeUntil ?? '').getTime();
      const startsAt = !this.schedulerSnoozeUntilRestart
        && Number.isFinite(currentUntil)
        && currentUntil > now
        ? currentUntil
        : now;
      this.schedulerSnoozeUntilRestart = false;
      this.schedulerSnoozeUntil = new Date(startsAt + duration * 60_000).toISOString();
      setBotSchedulerSnoozeUntil(this.schedulerSnoozeUntil);
    }
    const snooze = this.getSchedulerSnooze();
    this.broadcast('bots:snooze', { snooze });
    return snooze;
  }

  getBotSnooze(botId, now = Date.now()) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (this.botSnoozeUntilRestart.has(botId)) {
      return { active: true, mode: 'until-restart', until: null };
    }
    const until = new Date(bot.snoozeUntil ?? '').getTime();
    if (Number.isFinite(until) && until > now) {
      return { active: true, mode: 'until', until: bot.snoozeUntil };
    }
    if (bot.snoozeUntil) updateBotScheduler(botId, { snoozeUntil: 'clear' });
    return { active: false, mode: null, until: null };
  }

  setBotSnooze(botId, { durationMinutes, untilRestart = false, reset = false } = {}) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (reset === true) {
      this.botSnoozeUntilRestart.delete(botId);
      updateBotScheduler(botId, { snoozeUntil: 'clear' });
    } else if (untilRestart === true) {
      this.botSnoozeUntilRestart.add(botId);
      updateBotScheduler(botId, { snoozeUntil: 'clear' });
    } else {
      const duration = Number(durationMinutes);
      if (!SNOOZE_DURATIONS_MINUTES.has(duration)) {
        throw new Error('Bot Snooze duration must be 60, 360, or 1440 minutes.');
      }
      const now = Date.now();
      const currentUntil = new Date(bot.snoozeUntil ?? '').getTime();
      const startsAt = !this.botSnoozeUntilRestart.has(botId)
        && Number.isFinite(currentUntil)
        && currentUntil > now
        ? currentUntil
        : now;
      this.botSnoozeUntilRestart.delete(botId);
      updateBotScheduler(botId, {
        snoozeUntil: new Date(startsAt + duration * 60_000).toISOString(),
      });
    }
    const snooze = this.getBotSnooze(botId);
    this.broadcast('bots:snooze', { botId, snooze });
    return snooze;
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
      const assistantMessage = getMessage(bot.activeAssistantMessageId);
      const interruptedToolCalls = assistantMessage?.segments.filter((segment) => (
        segment.type === 'tool-call'
        && segment.status === 'running'
        && segment.resultText === undefined
      )) ?? [];
      if (interruptedToolCalls.length > 0) {
        updateMessage(assistantMessage.id, {
          segments: assistantMessage.segments.map((segment) => (
            interruptedToolCalls.includes(segment)
              ? {
                  ...segment,
                  status: 'error',
                  resultText: 'Tool execution was interrupted by the application restart. Its completion is unknown, so Avi did not retry it automatically.',
                }
              : segment
          )),
        });
        traceInfo('bots.interrupted-tools-failed', {
          bot_id: bot.id,
          tool_count: interruptedToolCalls.length,
        });
      }
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
      try {
        const { dataFolder } = await ensureBotFolders(bot);
        const { inbox } = await readBotWorkState(dataFolder);
        for (const pendency of inbox) {
          if (!pendency.approval) continue;
          if (pendency.approval.botId !== bot.id) {
            traceError('bots.approval-owner-mismatch', {
              bot_id: bot.id,
              approval_id: pendency.approval.id,
              approval_bot_id: pendency.approval.botId,
            });
            continue;
          }
          this.approvals.set(pendency.approval.id, pendency.approval);
        }
      } catch (error) {
        traceError('bots.work-state-load-error', {
          bot_id: bot.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async refreshBotApprovalIndex(botId) {
    for (const [approvalId, approval] of this.approvals) {
      if (approval.botId === botId) this.approvals.delete(approvalId);
    }
    const bot = getBot(botId);
    if (!bot) return;
    const { dataFolder } = await ensureBotFolders(bot);
    const { inbox } = await readBotWorkState(dataFolder);
    for (const pendency of inbox) {
      if (!pendency.approval || pendency.approval.botId !== bot.id) continue;
      this.approvals.set(pendency.approval.id, pendency.approval);
    }
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
        snooze: this.getBotSnooze(bot.id),
        scheduleState: this.chatRunner?.runs?.has(bot.conversationId)
          ? 'working'
          : bot.enabled === false
            ? 'disabled'
            : this.getBotSnooze(bot.id).active
              ? 'sleep'
              : ['idle', 'outside-window', 'max-activations', 'paused'].includes(
                decideActivation({ bot, now: Date.now() }).reason,
              )
              ? 'sleep'
              : 'active',
        activationWindowDescription: describeActivationWindow(bot.activationWindow),
      };
    });
  }

  async listBotDataByBot() {
    return Object.fromEntries(await Promise.all(listBots().map(async (bot) => {
      try {
        const { dataFolder } = await ensureBotFolders(bot);
        const results = await Promise.allSettled([readInboxFile(dataFolder), readActivityFile(dataFolder)]);
        const [inboxError, activityError] = results.map((result) => result.status === 'rejected'
          ? result.reason instanceof Error ? result.reason.message : String(result.reason)
          : null);
        return [bot.id, {
          inbox: results[0].status === 'fulfilled' ? results[0].value : [],
          activity: results[1].status === 'fulfilled' ? results[1].value : [],
          errors: { inbox: inboxError, activity: activityError },
          error: [inboxError && `Inbox: ${inboxError}`, activityError && `Activity: ${activityError}`].filter(Boolean).join('; ') || null,
        }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [bot.id, {
          inbox: [],
          activity: [],
          errors: { inbox: message, activity: message },
          error: `Inbox: ${message}; Activity: ${message}`,
        }];
      }
    })));
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
      workQueue: config?.workQueue ?? [],
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
    if (changes.workQueueIndex !== undefined) {
      const workQueue = changes.workQueue === undefined
        ? bot.workQueue
        : [...new Set(changes.workQueue.flatMap((item) => {
          const normalized = String(item ?? '').trim();
          return normalized ? [normalized] : [];
        }))];
      if (
        !Number.isInteger(changes.workQueueIndex)
        || changes.workQueueIndex < 0
        || changes.workQueueIndex >= workQueue.length
      ) throw new Error('Work queue index is out of range.');
    }
    const updated = updateBot(id, changes);
    if (changes.workQueueIndex !== undefined) {
      updateBotScheduler(id, { workQueueIndex: changes.workQueueIndex });
    }
    if (changes.workingFolder !== undefined) {
      await ensureBotFolders(updated);
      await this.refreshBotApprovalIndex(id);
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
    this.botSnoozeUntilRestart.delete(id);
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
    const conversation = clearConversationMessages(bot.conversationId);
    this.broadcast('bots:updated');
    return conversation;
  }

  async fullResetBot(id) {
    const bot = getBot(id);
    if (!bot) throw new Error('Bot not found.');
    const conversations = listAllConversations();
    const conversationIds = new Set([bot.conversationId]);
    let addedDescendant = true;
    while (addedDescendant) {
      addedDescendant = false;
      for (const conversation of conversations) {
        if (
          conversation.parentConversationId
          && conversationIds.has(conversation.parentConversationId)
          && !conversationIds.has(conversation.id)
        ) {
          conversationIds.add(conversation.id);
          addedDescendant = true;
        }
      }
    }

    const activeRuns = [...conversationIds].flatMap((conversationId) => {
      const run = this.chatRunner?.runs.get(conversationId);
      return run ? [run.completion] : [];
    });
    for (const conversationId of conversationIds) {
      this.chatRunner?.stop(conversationId, { stoppedByUser: true });
    }
    await Promise.allSettled(activeRuns);
    for (const conversationId of conversationIds) {
      this.chatRunner?.pausedQueues?.delete(conversationId);
      this.chatRunner?.continuationGenerations?.get(conversationId)?.controller.abort('full-reset');
      this.chatRunner?.continuationGenerations?.delete(conversationId);
      this.chatRunner?.pendingCompletionNotifications?.delete(conversationId);
    }
    for (const [approvalId, approval] of this.chatRunner?.pendingApprovals ?? []) {
      if (conversationIds.has(approval.conversationId)) {
        approval.finish(false);
        this.chatRunner.pendingApprovals.delete(approvalId);
      }
    }
    for (const [questionId, question] of this.chatRunner?.pendingQuestions ?? []) {
      if (conversationIds.has(question.conversationId)) {
        question.finish({ cancelled: true, answers: [] });
        this.chatRunner.pendingQuestions.delete(questionId);
      }
    }
    this.chatRunner?.removeConversationSemaphores?.([...conversationIds]);

    for (const [approvalId, entry] of [...this.approvals.entries()]) {
      if (entry.botId === id) this.approvals.delete(approvalId);
    }

    const workingFolder = resolveBotWorkingFolder(bot);
    const dataFolder = resolveBotDataFolder(bot);
    if (bot.workingFolder) {
      await rm(dataFolder, { recursive: true, force: true });
    } else {
      const mcpConfigPath = join(workingFolder, '.agents', 'bots', bot.id, 'mcpconfig.json');
      const mcpConfig = await readFile(mcpConfigPath).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      await rm(workingFolder, { recursive: true, force: true });
      if (mcpConfig) {
        await mkdir(join(workingFolder, '.agents', 'bots', bot.id), { recursive: true });
        await writeFile(mcpConfigPath, mcpConfig);
      }
    }

    updateBotScheduler(bot.id, {
      status: 'active',
      idleUntil: 'clear',
      activationCount: 0,
      activeAssistantMessageId: null,
      snoozeUntil: 'clear',
    });
    this.botSnoozeUntilRestart.delete(id);
    const conversation = clearConversationMessages(bot.conversationId, { resetState: true });
    traceInfo('bots.full-reset', { bot_id: id });
    this.broadcast('bots:updated');
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
    const { dataFolder } = await ensureBotFolders(bot);
    const item = await attachBotPendencyApproval(dataFolder, {
      botId: bot.id,
      kind: 'work',
      title: String(title ?? '').trim(),
      context: String(context ?? '').trim(),
      prompt: String(prompt ?? '').trim(),
    });
    this.approvals.set(item.approval.id, item.approval);
    this.broadcast('bots:work-state');
    return `Queued for user approval (approval id: ${item.approval.id}, pendency id: ${item.id}). Continue with other independent work and do not retry this action until the user decides.`;
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
    const { dataFolder } = await ensureBotFolders(bot);
    const item = await attachBotPendencyApproval(dataFolder, {
      botId: bot.id,
      kind: 'tool',
      title: invocationSummary || toolName,
      context: `Approve running ${toolName}: ${invocationSummary}`,
      prompt: `Run ${toolName} with the approved arguments and continue this pendency.`,
      toolName,
      workspacePath,
      input: input ?? null,
    });
    this.approvals.set(item.approval.id, item.approval);
    this.broadcast('bots:work-state');
    return item.approval;
  }

  async resolveApproval(approvalId, decision) {
    if (typeof decision !== 'boolean') {
      throw new Error('Approval decision must be an explicit boolean.');
    }
    const entry = this.approvals.get(approvalId);
    if (!entry) throw new Error('Approval item not found.');
    const bot = getBot(entry.botId);
    if (!bot) throw new Error('Bot not found.');
    const { dataFolder } = await ensureBotFolders(bot);
    const { inbox } = await readBotWorkState(dataFolder);
    const persistedApproval = inbox.find((pendency) => pendency.approval?.id === approvalId)?.approval;
    if (!persistedApproval || persistedApproval.botId !== bot.id) {
      this.approvals.delete(approvalId);
      throw new Error('Approval ownership mismatch.');
    }
    const { item, approval } = await consumeBotPendencyApproval(dataFolder, approvalId, decision);
    this.approvals.delete(approvalId);
    this.noteUserInteraction(bot.conversationId);
    const detailLines = approval.kind === 'tool'
      ? [
          `<tool>${escapeMarkupText(String(approval.toolName))}</tool>`,
          `<input>${escapeMarkupText(JSON.stringify(approval.input ?? null))}</input>`,
        ]
      : [];
    const text = decision
      ? [
          `<bot-approval-resolved pendency-id="${escapeMarkupText(item.id)}" decision="approved">`,
          escapeMarkupText(approval.prompt),
          ...detailLines,
          'Execute only the approved action and keep this pendency updated.',
          '</bot-approval-resolved>',
        ].join('\n')
      : [
          `<bot-approval-resolved pendency-id="${escapeMarkupText(item.id)}" decision="denied">`,
          ...detailLines,
          'Choose a safe alternative or cancel this pendency with a clear reason. Do not retry the denied action.',
          '</bot-approval-resolved>',
        ].join('\n');
    let delivered = false;
    let error = null;
    try {
      if (!this.chatRunner?.send) throw new Error('Chat runner is not available.');
      await this.chatRunner.send({
        conversationId: bot.conversationId,
        model: bot.model,
        reasoningEffort: bot.reasoningEffort,
        permissionMode: 'approve_for_me',
        text,
        fromAgent: true,
        queuePriority: true,
        project: { path: resolveBotWorkingFolder(bot) },
      });
      delivered = true;
    } catch (sendError) {
      error = sendError instanceof Error ? sendError.message : String(sendError);
      traceError('bots.approval-delivery-error', {
        bot_id: bot.id,
        pendency_id: item.id,
        error,
      });
    }
    this.broadcast('bots:work-state');
    return { resolved: true, delivered, pendencyId: item.id, ...(error ? { error } : {}) };
  }

  async replyToPendency(botId, pendencyId, { content, attachments = [] } = {}) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (typeof pendencyId !== 'string' || pendencyId.length === 0) {
      throw new Error('Invalid pendencyId: expected non-empty string');
    }
    const { dataFolder } = await ensureBotFolders(bot);
    // The user message is persisted before delivery: a failed send must not lose it.
    const item = await appendBotPendencyMessage(dataFolder, {
      pendencyId,
      role: 'user',
      content: typeof content === 'string' ? content.trim() : '',
      attachments: attachments ?? [],
    });
    this.noteUserInteraction(bot.conversationId);
    const message = item.messages.at(-1);
    const payload = [
      `<bot-pendency-update id="${escapeMarkupText(item.id)}" message-id="${escapeMarkupText(message.id)}">`,
      `<title>${escapeMarkupText(item.title)}</title>`,
      `<message>${escapeMarkupText(message.content)}</message>`,
      ...(message.attachments.length > 0
        ? [`<attachments>${message.attachments
          .map((attachment) => escapeMarkupText(attachment.path || attachment.name || attachment.id))
          .join('\n')}</attachments>`]
        : []),
      '</bot-pendency-update>',
    ].join('\n');
    let delivered = false;
    let error = null;
    try {
      if (!this.chatRunner?.send) throw new Error('Chat runner is not available.');
      await this.chatRunner.send({
        conversationId: bot.conversationId,
        model: bot.model,
        reasoningEffort: bot.reasoningEffort,
        permissionMode: 'approve_for_me',
        text: payload,
        attachments: message.attachments,
        fromAgent: true,
        queuePriority: true,
        project: { path: resolveBotWorkingFolder(bot) },
      });
      delivered = true;
    } catch (sendError) {
      error = sendError instanceof Error ? sendError.message : String(sendError);
      traceError('bots.pendency-delivery-error', {
        bot_id: bot.id,
        pendency_id: pendencyId,
        error,
      });
    }
    this.broadcast('bots:work-state');
    return { item, delivered, ...(error ? { error } : {}) };
  }

  async completePendency(botId, pendencyId) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (typeof pendencyId !== 'string' || pendencyId.length === 0) {
      throw new Error('Invalid pendencyId: expected non-empty string');
    }
    const { dataFolder } = await ensureBotFolders(bot);
    const item = await completeBotPendency(dataFolder, pendencyId);
    this.noteUserInteraction(bot.conversationId);
    this.broadcast('bots:work-state');
    return item;
  }

  async tick() {
    const bots = listBots();
    for (const bot of bots) {
      if (
        bot.enabled
        && bot.activeAssistantMessageId
        && !this.chatRunner?.runs?.has(bot.conversationId)
      ) {
        await this.resumeInterruptedRun(bot);
      }
    }
    const hadSnooze = Boolean(this.schedulerSnoozeUntil || this.schedulerSnoozeUntilRestart);
    if (this.getSchedulerSnooze().active) return;
    if (hadSnooze) this.broadcast('bots:snooze', { snooze: this.getSchedulerSnooze() });

    for (const bot of bots) {
      if (!bot.enabled) continue;
      const currentBot = getBot(bot.id);
      const hadBotSnooze = Boolean(
        currentBot.snoozeUntil || this.botSnoozeUntilRestart.has(bot.id),
      );
      if (this.getBotSnooze(bot.id).active) continue;
      if (hadBotSnooze) {
        this.broadcast('bots:snooze', { botId: bot.id, snooze: this.getBotSnooze(bot.id) });
      }
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

  async activateBot(botId, { trigger = 'scheduler', force = false } = {}) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (!bot.enabled && !force) return null;
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
      const { inbox } = await readBotWorkState(folders.dataFolder);
      const actionablePendency = inbox.find((pendency) => (
        pendency.status === 'open'
        && !pendency.approval
        && pendency.messages.at(-1)?.role === 'user'
      ));
      const focusTask = actionablePendency?.title ?? bot.workQueue[bot.workQueueIndex];
      const activationPrompt = [`<bot-activation at="${new Date().toISOString()}">`];
      if (focusTask) {
        activationPrompt.push(`<focus-task>${escapeMarkupText(focusTask)}</focus-task>`);
      }
      activationPrompt.push('</bot-activation>');
      const boundaryMessage = getMessages(bot.conversationId)
        .filter((message) => ['completed', 'sent', 'aborted'].includes(message.status))
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .at(-1);
      if (boundaryMessage) {
        updateConversation(bot.conversationId, {
          checkpointMessageId: boundaryMessage.id,
          contextCheckpoint: '',
          contextTokens: 0,
        });
      }
      await this.chatRunner?.send({
        conversationId: bot.conversationId,
        model: bot.model,
        reasoningEffort: bot.reasoningEffort,
        permissionMode: 'approve_for_me',
        text: activationPrompt.join('\n'),
        fromAgent: true,
        project: { path: folders.workingFolder },
      });
      const activationCount = bot.activationCount + 1;
      const sleeping = bot.maxActivations > 0 && activationCount >= bot.maxActivations;
      const currentBot = getBot(bot.id);
      const workQueueIndex = actionablePendency || bot.workQueue.length === 0
        ? currentBot.workQueueIndex
        : JSON.stringify(currentBot.workQueue) === JSON.stringify(bot.workQueue)
          ? (bot.workQueueIndex + 1) % bot.workQueue.length
          : currentBot.workQueueIndex;
      const activatedAt = Date.now();
      const nextActivationAt = new Date(
        sleeping
          ? smartIdleUntil(bot.activationPeriodMinutes, activatedAt)
          : nextActivationFrom(bot.activationPeriodMinutes, activatedAt),
      ).toISOString();
      updateBotScheduler(bot.id, {
        activationCount: sleeping ? 0 : activationCount,
        workQueueIndex,
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
        name: 'bot_semaphore_inspect',
        description: 'Inspect one application-wide semaphore, including every holder and the complete FIFO queue. Bot semaphore access is global and is not limited to this bot or threads it created.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
          },
          required: ['name'],
          additionalProperties: false,
        },
        execute: async ({ name }) => {
          const semaphore = this.chatRunner?.semaphores.globalSnapshot()
            .find((item) => item.name === String(name).trim());
          if (!semaphore) throw new Error(`Semaphore "${String(name).trim()}" does not exist.`);
          return {
            ...semaphore,
            holders: semaphore.holders.map((holder) => ({
              ...holder,
              title: getConversation(holder.conversationId)?.title ?? 'Missing thread',
              running: Boolean(this.chatRunner?.runs.has(holder.conversationId)),
            })),
            queue: semaphore.queue.map((waiter) => ({
              ...waiter,
              title: getConversation(waiter.conversationId)?.title ?? 'Missing thread',
            })),
          };
        },
      },
      {
        name: 'bot_semaphore_release_thread',
        description: 'Release every permit held by one thread on a semaphore, then resume that thread with an explicit continuation message. This root-level operation may target any thread, not only threads created by this bot.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: true,
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            threadId: { type: 'string', minLength: 1 },
          },
          required: ['name', 'threadId'],
          additionalProperties: false,
        },
        execute: ({ name, threadId }) => this.chatRunner.releaseSemaphoreHolder({
          name: String(name).trim(),
          conversationId: String(threadId).trim(),
        }),
      },
      {
        name: 'bot_semaphore_release_all',
        description: 'Stop every holder and queued thread associated with a named semaphore, then remove the semaphore without resuming any of those threads.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: true,
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
          },
          required: ['name'],
          additionalProperties: false,
        },
        execute: ({ name }) => this.chatRunner.releaseAllSemaphoreHolders(String(name).trim()),
      },
      {
        name: 'bot_pendencies_list',
        description: 'Read this bot’s user-facing pendencies and the material activity diary. Pendencies with a pending approval or a latest bot message are waiting on the user; pendencies whose latest message is from the user are waiting on you.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: [...BOT_PENDENCY_STATUSES], description: 'Filter by status. Omit to list all pendencies.' },
          },
          additionalProperties: false,
        },
        execute: async (input) => {
          await ensureBotFolders(bot);
          const { inbox, activity } = await readBotWorkState(dataFolder);
          const pendencies = input?.status
            ? inbox.filter((entry) => entry.status === input.status)
            : inbox;
          return { pendencies, activity };
        },
      },
      {
        name: 'bot_pendency_create',
        description: 'Create one user-facing pendency with an explanatory first message. Use it when the user must decide, approve, answer, or review something. Do not create pendencies for routine reads or tool calls.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short recognizable label.' },
            content: { type: 'string', description: 'The first message: what this pendency needs from the user and why.' },
            attachmentPaths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Paths of files to attach to the first message.',
            },
          },
          required: ['title', 'content'],
          additionalProperties: false,
        },
        execute: async ({ title, content, attachmentPaths = [] }) => {
          await ensureBotFolders(bot);
          const pendency = await createBotPendency(dataFolder, {
            title,
            content,
            attachments: attachmentPaths.map((path) => filePathToAttachment(path)),
          });
          this.broadcast('bots:work-state');
          return pendency;
        },
      },
      {
        name: 'bot_pendency_message',
        description: 'Append a message to an existing pendency. Messaging a completed pendency reopens it for the user.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Pendency id returned by bot_pendencies_list or bot_pendency_create.' },
            content: { type: 'string' },
            attachmentPaths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Paths of files to attach to the message.',
            },
          },
          required: ['id', 'content'],
          additionalProperties: false,
        },
        execute: async ({ id, content, attachmentPaths = [] }) => {
          await ensureBotFolders(bot);
          const pendency = await appendBotPendencyMessage(dataFolder, {
            pendencyId: id,
            role: 'bot',
            content,
            attachments: attachmentPaths.map((path) => filePathToAttachment(path)),
          });
          this.broadcast('bots:work-state');
          return pendency;
        },
      },
      {
        name: 'bot_pendency_complete',
        description: 'Mark a pendency as completed once its request is fully satisfied. A pending user approval blocks completion.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Pendency id returned by bot_pendencies_list or bot_pendency_create.' },
          },
          required: ['id'],
          additionalProperties: false,
        },
        execute: async ({ id }) => {
          await ensureBotFolders(bot);
          const pendency = await completeBotPendency(dataFolder, id);
          this.broadcast('bots:work-state');
          return pendency;
        },
      },
      {
        name: 'bot_activity_append',
        description: 'Write one material event to the activity diary. The diary has no automatic entries: record progress, discoveries, decisions, completions, and failures explicitly when they are material.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short label for the event.' },
            description: { type: 'string', description: 'Material detail about the event.' },
            category: { type: 'string', enum: [...BOT_ACTIVITY_CATEGORIES] },
          },
          required: ['title', 'category'],
          additionalProperties: false,
        },
        execute: async (input) => {
          await ensureBotFolders(bot);
          const entry = await appendBotActivity(dataFolder, input);
          this.broadcast('bots:work-state');
          return entry;
        },
      },
      {
        name: 'queue_user_approval',
        description: 'Attach one protected approval request only when the next material decision or sensitive action is not already authorized by the user’s request, the bot owner’s instructions, or a prior approval. Never ask the user to approve the same scope twice. Continue with other independent work after queuing it.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short recognizable label for the approval request.' },
            context: { type: 'string', description: 'Why this exact action needs the user.' },
            prompt: { type: 'string', description: 'Exact instructions to resume this work after approval.' },
          },
          required: ['title', 'context', 'prompt'],
          additionalProperties: false,
        },
        execute: (input) => this.queueUserApproval(conversationId, input),
      },
      ...(bot.activationMode === 'smart'
        ? [{
            name: 'set_bot_idle',
            description: 'Put this bot to sleep for four activation periods when no pendency is actionable. This ends the current inference after the tool result.',
            approval: 'never',
            canEditFile: false,
            canPerformDestructiveActions: false,
            inputSchema: {
              type: 'object',
              properties: {
                reason: { type: 'string', description: 'Short reason why no item is actionable.' },
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
      workQueue: bot.workQueue,
      personality: bot.personality,
      contextSize: bot.contextSize,
      model: bot.model,
    };
  }
}
