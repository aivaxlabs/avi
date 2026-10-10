import {
  getConversation,
  getGoalForConversation,
  listTasks,
  replaceTasks,
} from '../database.js';
import { SEMAPHORE_RESUME_TOKEN } from './constants.js';

export const semaphoreMethods = {
  acquireSemaphore({ conversationId, name, count, maxCount }) {
    const run = this.runs.get(conversationId);
    return this.semaphores.acquire({
      conversationId,
      name,
      count,
      maxCount,
      resume: {
        model: run?.model ?? getConversation(conversationId)?.model,
        reasoningEffort: run?.reasoningEffort ?? null,
        permissionMode: run?.permissionMode ?? 'approve_for_me',
        workMode: run?.workMode ?? null,
        ultraMode: run?.ultraMode ?? false,
        goalId: run?.goalId ?? null,
      },
    });
  },

  replaceTasks(conversationId, tasks) {
    if (!Array.isArray(tasks) || tasks.length > 100) {
      throw new Error('tasks must be an array with at most 100 items.');
    }
    if (tasks.some((task) => (
      !task
      || typeof task !== 'object'
      || Array.isArray(task)
      || typeof task.title !== 'string'
      || typeof task.description !== 'string'
      || typeof task.done !== 'boolean'
      || (task.status !== undefined && !['pending', 'completed', 'inconclusive'].includes(task.status))
      || (task.result !== null && typeof task.result !== 'string')
    ))) {
      throw new Error('Each task must contain a string title and description, boolean done, optional valid status, and string or null result.');
    }
    const normalized = tasks.map((task) => {
      const status = task.status ?? (task.done ? 'completed' : 'pending');
      return {
        title: task.title.trim(),
        description: task.description.trim(),
        done: status === 'completed',
        status,
        result: task.result?.trim() || null,
      };
    });
    if (normalized.some((task) => (
      !task.title
      || task.title.length > 200
      || task.description.length > 2000
      || (task.result?.length ?? 0) > 4000
    ))) {
      throw new Error('One or more tasks exceed the allowed field limits.');
    }
    if (normalized.some((task) => task.status === 'inconclusive' && !task.result)) {
      throw new Error('Inconclusive tasks require a result explaining the concrete blocker.');
    }
    const persisted = replaceTasks(conversationId, normalized);
    this.emit(conversationId, { type: 'tasks', tasks: persisted });
    this.emit(conversationId, {
      type: 'block-state',
      blocked: this.isConversationBlocked(conversationId),
    });
    return persisted;
  },

  releaseSemaphore({ conversationId, name, count }) {
    const result = this.semaphores.release({ conversationId, name, count });
    this.emit(conversationId, {
      type: 'block-state',
      blocked: this.isConversationBlocked(conversationId),
    });
    return result;
  },

  setSemaphoreBlocked({ conversationId, name, blocked, summary }) {
    const result = this.semaphores.setBlocked({
      conversationId,
      name,
      blocked,
      summary,
    });
    this.emit(conversationId, {
      type: 'block-state',
      blocked: this.isConversationBlocked(conversationId),
    });
    return result;
  },

  isConversationBlocked(conversationId) {
    const goal = getGoalForConversation(conversationId);
    return goal?.status === 'blocked'
      || listTasks(conversationId).some((task) => task.status === 'inconclusive')
      || this.semaphores.holdings(conversationId).some((holding) => holding.blocked);
  },

  async resumeSemaphore(waiter, { forced = false } = {}) {
    const conversation = getConversation(waiter.conversationId);
    if (!conversation) return false;
    const activeRun = this.runs.get(conversation.id);
    if (activeRun) {
      activeRun.semaphoreResume = { waiter, forced };
      return true;
    }
    const message = forced
      ? `Semaphore wait for "${waiter.name}" was overridden by the user. Continue the task now without owning permits from this semaphore. Do not release permits you do not own.`
      : `Semaphore "${waiter.name}" granted ${waiter.count} permit(s). Continue the task now. You own these permits until you call release_semaphore(name: "${waiter.name}", count: ${waiter.count}). Release them promptly after the protected work is complete, including before reporting a blocker or finishing the task.`;
    await this.send({
      conversationId: conversation.id,
      model: waiter.resume?.model ?? conversation.model,
      reasoningEffort: waiter.resume?.reasoningEffort ?? null,
      permissionMode: waiter.resume?.permissionMode ?? 'approve_for_me',
      text: message,
      steer: true,
      fromAgent: true,
      workMode: waiter.resume?.workMode
        ?? (conversation.orchestrationMode === 'plan' ? 'plan' : null),
      ultraMode: waiter.resume?.ultraMode
        ?? conversation.orchestrationMode === 'ultra',
      goalId: waiter.resume?.goalId ?? null,
      queuePriority: true,
      semaphoreResumeToken: SEMAPHORE_RESUME_TOKEN,
    });
    return true;
  },

  async runSemaphoreNow(conversationId) {
    return this.resumeSemaphore(this.semaphores.runNow(conversationId), { forced: true });
  },

  async releaseSemaphoreHolder({ name, conversationId }) {
    const conversation = getConversation(conversationId);
    if (!conversation) throw new Error('The holder thread was not found.');
    const activeRun = this.runs.get(conversationId);
    const result = this.semaphores.releaseHolder({ name, conversationId });
    const overriddenWait = this.semaphores.waitSnapshot(conversationId);
    if (overriddenWait) this.semaphores.cancel(conversationId);
    try {
      const sent = await this.send({
        conversationId,
        model: activeRun?.model ?? conversation.model,
        reasoningEffort: activeRun?.reasoningEffort ?? null,
        permissionMode: activeRun?.permissionMode ?? 'approve_for_me',
        text: `A supervising bot released your ${result.released} permit(s) from semaphore "${result.name}". Continue the task now without owning permits from this semaphore. Do not release permits you no longer own.`,
        steer: true,
        fromAgent: true,
        workMode: activeRun?.workMode
          ?? (conversation.orchestrationMode === 'plan' ? 'plan' : null),
        ultraMode: activeRun?.ultraMode
          ?? conversation.orchestrationMode === 'ultra',
        goalId: activeRun?.goalId ?? null,
        queuePriority: true,
      });
      return {
        ...result,
        resumed: true,
        queued: sent.queued,
        ...(overriddenWait ? { overriddenWait: overriddenWait.name } : {}),
      };
    } catch (error) {
      return {
        ...result,
        resumed: false,
        resumeError: error instanceof Error ? error.message : String(error),
      };
    }
  },

  releaseAllSemaphoreHolders(name) {
    const semaphore = this.semaphores.globalSnapshot().find((item) => item.name === name);
    if (!semaphore) throw new Error(`Semaphore "${name}" does not exist.`);
    const conversationIds = [
      ...semaphore.holders.map((holder) => holder.conversationId),
      ...semaphore.queue.map((waiter) => waiter.conversationId),
    ];
    for (const conversationId of conversationIds) {
      this.stop(conversationId, { stoppedByUser: true });
    }
    const result = this.semaphores.clear(name);
    return { ...result, stopped: conversationIds };
  },

  cancelSemaphore(conversationId) {
    return this.semaphores.cancel(conversationId);
  },

  removeConversationSemaphores(conversationIds) {
    this.semaphores.removeConversations(conversationIds);
  },
};
