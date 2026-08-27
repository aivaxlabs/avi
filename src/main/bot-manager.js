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
  listAllConversations,
  listBots,
  setBotSchedulerSnoozeUntil,
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
  BOT_ACTIVITY_TYPES,
  BOT_ATTENTION_TYPES,
  BOT_EVIDENCE_TYPES,
  BOT_WORK_ITEM_STATES,
  BOT_WORK_PRIORITIES,
  BOT_WORK_STATE_FILES,
  appendBotActivity,
  consumeBotWorkApproval,
  createBotWorkApproval,
  createBotWorkItem,
  ensureBotWorkStateFiles,
  readBotWorkState,
  updateBotWorkItem,
} from './bot-work-state.js';
import { traceError, traceInfo } from './trace-log.js';

const TICK_INTERVAL_MS = 30_000;
const SNOOZE_DURATIONS_MINUTES = new Set([60, 360, 1_440]);
const WORK_FILES = Object.freeze({
  'MEMORY.md': '# Memory\n\nDurable knowledge for this bot across activations.\n',
  [BOT_WORK_STATE_FILES.workItems]: '[]\n',
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

  setSchedulerSnooze({ durationMinutes, untilRestart = false } = {}) {
    if (untilRestart === true) {
      this.schedulerSnoozeUntilRestart = true;
      this.schedulerSnoozeUntil = null;
      setBotSchedulerSnoozeUntil(null);
    } else {
      const duration = Number(durationMinutes);
      if (!SNOOZE_DURATIONS_MINUTES.has(duration)) {
        throw new Error('Bot Snooze duration must be 60, 360, or 1440 minutes.');
      }
      this.schedulerSnoozeUntilRestart = false;
      this.schedulerSnoozeUntil = new Date(Date.now() + duration * 60_000).toISOString();
      setBotSchedulerSnoozeUntil(this.schedulerSnoozeUntil);
    }
    const snooze = this.getSchedulerSnooze();
    this.broadcast('bots:snooze', { snooze });
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
        const { workItems } = await readBotWorkState(dataFolder);
        for (const item of workItems) {
          if (!item.approval) continue;
          if (item.approval.botId !== bot.id) {
            traceError('bots.approval-owner-mismatch', {
              bot_id: bot.id,
              approval_id: item.approval.id,
              approval_bot_id: item.approval.botId,
            });
            continue;
          }
          this.approvals.set(item.approval.id, item.approval);
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
    const { workItems } = await readBotWorkState(dataFolder);
    for (const item of workItems) {
      if (!item.approval || item.approval.botId !== bot.id) continue;
      this.approvals.set(item.approval.id, item.approval);
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

  async listWorkStateByBot() {
    const conversations = listAllConversations();
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    return Object.fromEntries(await Promise.all(listBots().map(async (bot) => {
      try {
        const { dataFolder } = await ensureBotFolders(bot);
        const { workItems, activity } = await readBotWorkState(dataFolder);
        const trackedWorkerIds = new Set(workItems.flatMap((item) => item.workerThreadIds));
        const enrichWorker = (threadId) => {
          const thread = byId.get(threadId);
          if (!thread) return {
            id: threadId,
            title: 'Missing worker thread',
            status: 'missing',
            running: false,
            needsAttention: true,
            updatedAt: null,
          };
          const running = Boolean(this.chatRunner?.runs?.has(thread.id));
          return {
            id: thread.id,
            title: thread.title,
            status: running ? 'running' : thread.needsAttention ? 'needs-attention' : 'idle',
            running,
            needsAttention: thread.needsAttention,
            updatedAt: thread.updatedAt,
          };
        };
        return [bot.id, {
          items: workItems.map((item) => ({
            ...item,
            workers: item.workerThreadIds.map(enrichWorker),
          })),
          activity,
          untrackedWorkers: conversations.flatMap((thread) => (
            thread.parentConversationId === bot.conversationId
            && !trackedWorkerIds.has(thread.id)
              ? [enrichWorker(thread.id)]
              : []
          )),
          error: null,
        }];
      } catch (error) {
        return [bot.id, {
          items: [],
          activity: [],
          untrackedWorkers: [],
          error: error instanceof Error ? error.message : String(error),
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
    const updated = updateBot(id, changes);
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
    });
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

  async queueUserApproval(conversationId, { workItemId, context, prompt } = {}) {
    const bot = getBotByConversation(conversationId);
    if (!bot) throw new Error('This conversation has no bot.');
    const { dataFolder } = await ensureBotFolders(bot);
    const item = await createBotWorkApproval(dataFolder, {
      botId: bot.id,
      workItemId: String(workItemId ?? '').trim(),
      kind: 'work',
      context: String(context ?? '').trim(),
      prompt: String(prompt ?? '').trim(),
    });
    this.approvals.set(item.approval.id, item.approval);
    this.broadcast('bots:work-state');
    return `Queued for user approval (id: ${item.approval.id}, work item: ${item.id}). Continue with other independent work and do not retry this action until the user decides.`;
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
    const item = await createBotWorkItem(dataFolder, {
      title: invocationSummary || toolName,
      objective: `Run the approved ${toolName} action and verify its outcome.`,
      priority: 'normal',
    });
    await updateBotWorkItem(dataFolder, {
      id: item.id,
      summary: `The next action requires approval before ${toolName} can run.`,
      nextStep: `Wait for the user decision, then run ${toolName} or choose a safe alternative.`,
    });
    const withApproval = await createBotWorkApproval(dataFolder, {
      botId: bot.id,
      workItemId: item.id,
      kind: 'tool',
      context: `Approve running ${toolName}: ${invocationSummary}`,
      prompt: `Run ${toolName} with the approved arguments and continue this work item.`,
      toolName,
      workspacePath,
      input: input ?? null,
    });
    this.approvals.set(withApproval.approval.id, withApproval.approval);
    this.broadcast('bots:work-state');
    return withApproval.approval;
  }

  async resolveApproval(approvalId, decision) {
    const entry = this.approvals.get(approvalId);
    if (!entry) throw new Error('Approval item not found.');
    const bot = getBot(entry.botId);
    if (!bot) throw new Error('Bot not found.');
    const { dataFolder } = await ensureBotFolders(bot);
    const { workItems } = await readBotWorkState(dataFolder);
    const persistedApproval = workItems.find((item) => item.approval?.id === approvalId)?.approval;
    if (!persistedApproval || persistedApproval.botId !== bot.id) {
      this.approvals.delete(approvalId);
      throw new Error('Approval ownership mismatch.');
    }
    const approved = decision !== false;
    const { item } = await consumeBotWorkApproval(dataFolder, approvalId);
    this.approvals.delete(approvalId);
    if (!approved) {
      await updateBotWorkItem(dataFolder, {
        id: item.id,
        state: 'waiting',
        summary: 'The user denied the requested action. The bot must choose a safe alternative or cancel the work.',
        lastProgress: 'The requested action was not approved.',
        nextStep: 'Inspect the work again and either choose a non-destructive alternative or cancel it with a clear reason.',
        blocker: {
          reason: 'The requested action was denied by the user.',
          waitingOn: 'The bot to choose an alternative approach or cancel the work.',
        },
      });
    }
    this.noteUserInteraction(bot.conversationId);
    const text = approved
      ? [
          `<bot-approval-resolved id="${entry.id}" work-item-id="${entry.workItemId}" decision="approved">`,
          entry.prompt,
          'Read the work item again, execute only the approved action, and update its progress and next step.',
          '</bot-approval-resolved>',
        ].join('\n')
      : [
          `<bot-approval-resolved id="${entry.id}" work-item-id="${entry.workItemId}" decision="denied">`,
          'Read the work item again. Choose a safe alternative or cancel it with a clear reason. Do not retry the denied action.',
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
      await appendBotActivity(dataFolder, {
        workItemId: item.id,
        type: 'failure',
        summary: 'Could not deliver the user decision to the bot.',
        details: error instanceof Error ? error.message : String(error),
      });
      traceError('bots.approval-delivery-error', {
        bot_id: bot.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.broadcast('bots:work-state');
    return { resolved: true, delivered, workItemId: item.id };
  }

  async setBotWorkItemState(botId, workItemId, state) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot not found.');
    if (!BOT_WORK_ITEM_STATES.has(state)) throw new Error(`Invalid state: ${state}`);
    const { dataFolder } = await ensureBotFolders(bot);
    const { workItems } = await readBotWorkState(dataFolder);
    const item = workItems.find((entry) => entry.id === workItemId);
    if (!item) throw new Error(`Work item not found: ${workItemId}`);
    if (item.approval) throw new Error('Resolve the pending approval before changing the status.');
    const updated = await updateBotWorkItem(dataFolder, {
      id: item.id,
      state,
      // updateBotWorkItem refuses to complete work without a summary; the user action
      // still needs a one-line note when the bot has not written one yet.
      ...(state === 'completed' && !item.summary ? { summary: 'Marked as completed by the user.' } : {}),
    });
    this.noteUserInteraction(bot.conversationId);
    this.broadcast('bots:work-state');
    return updated;
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
      const { workItems } = await readBotWorkState(folders.dataFolder);
      const activeWorkItem = workItems.find((item) => (
        item.state === 'active'
        || item.workerThreadIds.some((threadId) => this.chatRunner?.runs?.has(threadId))
      ));
      const focusTask = activeWorkItem?.title ?? bot.workQueue[bot.workQueueIndex];
      const activationPrompt = [`<bot-activation at="${new Date().toISOString()}">`];
      if (focusTask) {
        activationPrompt.push(`<focus-task>${focusTask
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')}</focus-task>`);
      }
      activationPrompt.push('</bot-activation>');
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
      const workQueueIndex = activeWorkItem || bot.workQueue.length === 0
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
    const attentionSchema = {
      type: ['object', 'null'],
      properties: {
        type: { type: 'string', enum: [...BOT_ATTENTION_TYPES] },
        summary: { type: 'string' },
      },
      required: ['type', 'summary'],
      additionalProperties: false,
    };
    const blockerSchema = {
      type: ['object', 'null'],
      properties: {
        reason: { type: 'string' },
        waitingOn: { type: 'string' },
      },
      required: ['reason', 'waitingOn'],
      additionalProperties: false,
    };
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
        name: 'bot_work_create',
        description: 'Create one durable user-visible work item with a clear objective. Do not create items for routine reads or tool calls.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short recognizable label.' },
            objective: { type: 'string', description: 'The concrete result that defines success, written as concise GitHub-flavored Markdown.' },
            nextStep: { type: 'string', description: 'The next concrete action in concise GitHub-flavored Markdown. Provide it when the work should appear in Up next.' },
            priority: { type: 'string', enum: [...BOT_WORK_PRIORITIES] },
            workerThreadIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          },
          required: ['title', 'objective'],
          additionalProperties: false,
        },
        execute: async (input) => {
          await ensureBotFolders(bot);
          const item = await createBotWorkItem(dataFolder, input);
          this.broadcast('bots:work-state');
          return item;
        },
      },
      {
        name: 'bot_work_update',
        description: 'Update the current situation of a work item. Keep objective, material progress, next step, attention, blocker, workers, and evidence accurate. Pending approval fields are runtime-owned.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            objective: { type: 'string', description: 'The result that defines success, written as concise GitHub-flavored Markdown.' },
            state: { type: 'string', enum: [...BOT_WORK_ITEM_STATES] },
            summary: { type: 'string', description: 'Current situation in concise GitHub-flavored Markdown. Use short bullets for multiple results. When completing work, explain what was done, why, and how without repeating structured evidence.' },
            lastProgress: { type: 'string', description: 'Latest material result, discovery, or change in concise GitHub-flavored Markdown.' },
            nextStep: { type: 'string', description: 'The next concrete action for planned or active work, written as concise GitHub-flavored Markdown. It is cleared automatically when work is completed.' },
            attention: attentionSchema,
            blocker: blockerSchema,
            priority: { type: 'string', enum: [...BOT_WORK_PRIORITIES] },
            workerThreadIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
            evidence: {
              type: 'array',
              description: 'Evidence supporting the report. Use file_reference for project-relative file paths, external_reference for HTTP(S) URLs, and text for non-link evidence.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: [...BOT_EVIDENCE_TYPES] },
                  value: { type: 'string' },
                },
                required: ['type', 'value'],
                additionalProperties: false,
              },
              uniqueItems: true,
            },
          },
          required: ['id'],
          additionalProperties: false,
        },
        execute: async (input) => {
          await ensureBotFolders(bot);
          const item = await updateBotWorkItem(dataFolder, input);
          this.broadcast('bots:work-state');
          return item;
        },
      },
      {
        name: 'bot_activity_append',
        description: 'Append one material event to the recent activity timeline. Do not record routine reads, tool calls, or duplicate item updates.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {
            workItemId: { type: ['string', 'null'] },
            type: { type: 'string', enum: [...BOT_ACTIVITY_TYPES] },
            summary: { type: 'string' },
            details: { type: 'string' },
          },
          required: ['type', 'summary'],
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
        name: 'bot_work_read',
        description: 'Read all durable work items and material activity. The Bots panel enriches referenced workers with their live runtime state.',
        approval: 'never',
        canEditFile: false,
        canPerformDestructiveActions: false,
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          await ensureBotFolders(bot);
          return readBotWorkState(dataFolder);
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
            workItemId: { type: 'string', description: 'Existing work item id returned by bot_work_create or bot_work_read.' },
            context: { type: 'string', description: 'Why this exact action needs the user.' },
            prompt: { type: 'string', description: 'Exact instructions to resume this work after approval.' },
          },
          required: ['workItemId', 'context', 'prompt'],
          additionalProperties: false,
        },
        execute: (input) => this.queueUserApproval(conversationId, input),
      },
      ...(bot.activationMode === 'smart'
        ? [{
            name: 'set_bot_idle',
            description: 'Put this bot to sleep for four activation periods when no work item is actionable. This ends the current inference after the tool result.',
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
