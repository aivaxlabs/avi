import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { nextCronOccurrence, parseCron } from '../shared/cron.js';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';
import {
  createConversation,
  createRecurringJob,
  createScheduledTask,
  deleteRecurringJob,
  deleteScheduledTask,
  getMessages,
  getRecurringJob,
  getScheduledTask,
  listRecurringJobs,
  listScheduledTasks,
  updateRecurringJob,
  updateScheduledTask,
} from './database.js';
import { traceError, traceInfo } from './trace-log.js';

const TASK_TICK_MS = 10_000;
const RECURRING_TICK_MS = 60_000;
const TASK_STATUSES = ['scheduled', 'running', 'completed', 'failed', 'cancelled'];
const ACTIVE_TASK_STATUSES = ['scheduled', 'running'];
const PERMISSION_MODES = ['approve_for_me', 'full_access'];

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function parseEndsAt(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('endsAt must be an ISO 8601 date.');
  return date.toISOString();
}

function nextRunAt(cron, endsAt, from = new Date()) {
  const next = nextCronOccurrence(cron, from);
  return next && (!endsAt || next <= new Date(endsAt)) ? next.toISOString() : null;
}

function requireText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

export class TaskScheduler {
  constructor({ getChatRunner, getModels, getPreferences, sendEvent = () => {} }) {
    this.getChatRunner = getChatRunner;
    this.getModels = getModels;
    this.getPreferences = getPreferences;
    this.sendEvent = sendEvent;
    this.timers = [];
    this.dispatching = false;
  }

  start() {
    for (const task of listScheduledTasks({ status: 'running' })) {
      this.finishTask(task.id, { status: 'failed', error: 'Avi closed before the task finished.' });
    }
    this.materializeRecurringJobs();
    void this.dispatchDueTasks();
    this.timers = [
      setInterval(() => void this.dispatchDueTasks(), TASK_TICK_MS),
      setInterval(() => this.materializeRecurringJobs(), RECURRING_TICK_MS),
    ];
    for (const timer of this.timers) timer.unref?.();
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  emitTask(task) {
    this.sendEvent({ type: 'task', task });
    return task;
  }

  emitJob(job) {
    this.sendEvent({ type: 'recurring-job', job });
    return job;
  }

  normalizeDefinition(input, current = null) {
    const has = (key) => Object.hasOwn(input, key) && input[key] !== undefined;
    const instruction = has('instruction') ? requireText(input.instruction, 'instruction') : current?.instruction;
    if (!instruction) throw new Error('instruction is required.');

    const folderPath = has('folderPath') && String(input.folderPath).trim()
      ? String(input.folderPath).trim()
      : current?.folderPath ?? homedir();
    if (!isAbsolute(folderPath)) throw new Error('folderPath must be absolute.');
    let isDirectory = false;
    try {
      isDirectory = statSync(folderPath).isDirectory();
    } catch {}
    if (!isDirectory) throw new Error(`folderPath must point to an existing directory: ${folderPath}`);

    const models = this.getModels();
    const modelId = has('model') && String(input.model).trim()
      ? String(input.model).trim()
      : current?.model ?? this.getPreferences().lastModel ?? models[0]?.id;
    const model = models.find((item) => item.id === modelId);
    if (!model) throw new Error(modelId ? `Model "${modelId}" is not configured.` : 'No model is configured.');

    const reasoningEffort = has('reasoningEffort')
      ? String(input.reasoningEffort ?? '').trim() || null
      : current?.model === model.id ? current.reasoningEffort : null;
    if (reasoningEffort && !model.reasoning?.includes(reasoningEffort)) {
      throw new Error(`Reasoning effort "${reasoningEffort}" is not supported by ${model.name ?? model.id}.`);
    }

    const permissionMode = has('permissionMode') ? input.permissionMode : current?.permissionMode ?? 'approve_for_me';
    if (!PERMISSION_MODES.includes(permissionMode)) throw new Error('permissionMode must be approve_for_me or full_access.');

    const title = has('title') && String(input.title).trim()
      ? String(input.title).trim().slice(0, 200)
      : current?.title ?? instruction.split(/\r?\n/)[0].slice(0, 80);

    return { title, instruction, folderPath: resolve(folderPath), model: model.id, reasoningEffort, permissionMode };
  }

  listTasks({ status = null, recurringJobId = null, limit = 50 } = {}) {
    if (status && !TASK_STATUSES.includes(status)) throw new Error(`status must be one of ${TASK_STATUSES.join(', ')}.`);
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 500);
    return { tasks: listScheduledTasks({ status, recurringJobId, limit: boundedLimit }) };
  }

  viewTask(id) {
    const task = getScheduledTask(id);
    if (!task) throw new Error('Scheduled task not found.');
    return task;
  }

  scheduleTask(input = {}, { createdBy = 'user', recurringJobId = null } = {}) {
    const runAt = input.runAt ? new Date(input.runAt) : new Date();
    if (Number.isNaN(runAt.getTime())) throw new Error('runAt must be an ISO 8601 date.');
    const task = createScheduledTask({
      ...this.normalizeDefinition(input),
      recurringJobId,
      runAt: runAt.toISOString(),
      status: 'scheduled',
      createdBy: createdBy === 'agent' ? 'agent' : 'user',
    });
    traceInfo('scheduler.task-scheduled', { task_id: task.id, recurring_job_id: recurringJobId, model: task.model });
    this.emitTask(task);
    if (runAt.getTime() <= Date.now()) setImmediate(() => void this.dispatchDueTasks());
    return task;
  }

  cancelTask(id) {
    const task = this.viewTask(id);
    if (!ACTIVE_TASK_STATUSES.includes(task.status)) throw new Error(`A ${task.status} task cannot be cancelled.`);
    const cancelled = this.finishTask(id, { status: 'cancelled' });
    if (task.conversationId) {
      this.getChatRunner()?.stop(task.conversationId, { includeSubagents: true, stoppedByUser: true });
    }
    return cancelled;
  }

  deleteTask(id) {
    const task = this.viewTask(id);
    if (ACTIVE_TASK_STATUSES.includes(task.status)) throw new Error('Cancel the task before deleting it.');
    deleteScheduledTask(id);
    this.sendEvent({ type: 'task', deletedId: id });
    return { deleted: true, id };
  }

  listRecurringJobs() {
    return { jobs: listRecurringJobs() };
  }

  viewRecurringJob(id) {
    const job = getRecurringJob(id);
    if (!job) throw new Error('Recurring job not found.');
    return { ...job, recentTasks: listScheduledTasks({ recurringJobId: id, limit: 10 }) };
  }

  createRecurringJob(input = {}, { createdBy = 'user' } = {}) {
    const cron = requireText(input.cron, 'cron');
    parseCron(cron);
    const enabled = input.enabled !== false;
    const endsAt = parseEndsAt(input.endsAt);
    if (endsAt && new Date(endsAt) <= new Date()) throw new Error('endsAt must be in the future.');
    const job = createRecurringJob({
      ...this.normalizeDefinition(input),
      cron,
      enabled,
      endsAt,
      nextRunAt: enabled ? nextRunAt(cron, endsAt) : null,
      createdBy: createdBy === 'agent' ? 'agent' : 'user',
    });
    traceInfo('scheduler.recurring-job-created', { recurring_job_id: job.id, model: job.model });
    return this.emitJob(job);
  }

  updateRecurringJob(id, changes = {}) {
    const current = getRecurringJob(id);
    if (!current) throw new Error('Recurring job not found.');
    const cron = changes.cron === undefined ? current.cron : requireText(changes.cron, 'cron');
    parseCron(cron);
    const enabled = changes.enabled === undefined ? current.enabled : changes.enabled === true;
    const endsAt = changes.endsAt === undefined ? current.endsAt : parseEndsAt(changes.endsAt);
    const rescheduled = cron !== current.cron || enabled !== current.enabled || endsAt !== current.endsAt;
    return this.emitJob(updateRecurringJob(id, {
      ...this.normalizeDefinition(changes, current),
      cron,
      enabled,
      endsAt,
      ...(rescheduled ? { nextRunAt: enabled ? nextRunAt(cron, endsAt) : null } : {}),
    }));
  }

  deleteRecurringJob(id) {
    if (!getRecurringJob(id)) throw new Error('Recurring job not found.');
    for (const task of listScheduledTasks({ status: 'scheduled', recurringJobId: id })) {
      this.finishTask(task.id, { status: 'cancelled' });
    }
    deleteRecurringJob(id);
    this.sendEvent({ type: 'recurring-job', deletedId: id });
    return { deleted: true, id };
  }

  materializeRecurringJobs(now = new Date()) {
    for (const job of listRecurringJobs().filter((item) => item.enabled)) {
      try {
        if (!job.nextRunAt) {
          const next = nextRunAt(job.cron, job.endsAt, now);
          if (next) this.emitJob(updateRecurringJob(job.id, { nextRunAt: next }));
          continue;
        }
        if (new Date(job.nextRunAt) > now) continue;

        const next = nextRunAt(job.cron, job.endsAt, now);
        const overlapping = ACTIVE_TASK_STATUSES
          .some((status) => listScheduledTasks({ status, recurringJobId: job.id, limit: 1 }).length > 0);
        if (overlapping) {
          traceInfo('scheduler.recurring-job-skipped', { recurring_job_id: job.id, status: 'previous-task-active' });
        } else {
          this.scheduleTask({ ...job, runAt: job.nextRunAt }, { createdBy: job.createdBy, recurringJobId: job.id });
        }
        this.emitJob(updateRecurringJob(job.id, { lastRunAt: job.nextRunAt, nextRunAt: next }));
      } catch (error) {
        traceError('scheduler.recurring-job-error', {
          recurring_job_id: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async dispatchDueTasks() {
    if (this.dispatching || !this.getChatRunner()) return;
    this.dispatching = true;
    try {
      for (const task of listScheduledTasks({ status: 'scheduled', dueBefore: new Date().toISOString() })) {
        updateScheduledTask(task.id, { status: 'running', startedAt: new Date().toISOString() });
        void this.runTask(task);
      }
    } finally {
      this.dispatching = false;
    }
  }

  finishTask(id, changes) {
    return this.emitTask(updateScheduledTask(id, { ...changes, finishedAt: new Date().toISOString() }));
  }

  async runTask(task) {
    const chatRunner = this.getChatRunner();
    const startedAt = Date.now();
    try {
      const conversation = createConversation({
        title: task.title,
        titleStatus: 'ready',
        model: task.model,
        projectPath: task.folderPath,
        createdBy: 'agent',
      });
      this.emitTask(updateScheduledTask(task.id, { conversationId: conversation.id }));
      traceInfo('scheduler.task-started', { task_id: task.id, thread_id: conversation.id, model: task.model });

      await chatRunner.send({
        conversationId: conversation.id,
        model: task.model,
        reasoningEffort: task.reasoningEffort,
        permissionMode: task.permissionMode,
        text: [
          `<scheduled-task task_id="${task.id}" title="${escapeAttribute(task.title)}" run_at="${task.runAt}"${task.recurringJobId ? ` recurring_job_id="${task.recurringJobId}"` : ''}>`,
          'Avi started this scheduled task automatically; no user is watching this thread. Complete the instruction below autonomously and finish with a concise final answer describing the outcome.',
          '',
          task.instruction,
          '</scheduled-task>',
        ].join('\n'),
        fromAgent: true,
        project: { path: task.folderPath },
      });
      // Orchestrated work can start follow-up runs in the same thread, so wait until it settles.
      while (chatRunner.runs.has(conversation.id)) await chatRunner.runs.get(conversation.id).completion;

      if (getScheduledTask(task.id)?.status !== 'running') return;
      const responses = getMessages(conversation.id).filter((message) => message.role === 'assistant');
      const final = responses.at(-1);
      const inputTokens = responses.reduce((total, message) => total + (Number(message.usage?.inputTokens) || 0), 0);
      const outputTokens = responses.reduce((total, message) => total + (Number(message.usage?.outputTokens) || 0), 0);
      const succeeded = final?.status === 'completed';
      this.finishTask(task.id, {
        status: succeeded ? 'completed' : 'failed',
        output: final ? answerTextFromTextualBlocks(final.content) || null : null,
        error: succeeded
          ? null
          : final?.segments?.findLast((segment) => segment.type === 'error')?.message
            ?? `The run ended with status ${final?.status ?? 'unknown'}.`,
        stats: {
          durationMs: Date.now() - startedAt,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          toolCalls: responses.flatMap((message) => message.segments ?? [])
            .filter((segment) => segment.type === 'tool-call').length,
        },
      });
      traceInfo('scheduler.task-finished', { task_id: task.id, status: succeeded ? 'completed' : 'failed', duration_ms: Date.now() - startedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      traceError('scheduler.task-error', { task_id: task.id, error: message });
      if (getScheduledTask(task.id)?.status === 'running') {
        this.finishTask(task.id, { status: 'failed', error: message, stats: { durationMs: Date.now() - startedAt, inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCalls: 0 } });
      }
    }
  }
}
