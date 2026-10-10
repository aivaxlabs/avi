import { randomUUID } from 'node:crypto';
import {
  deleteMessage,
  ensureConversation,
  getConversation,
  getGoal,
  getGoalForConversation,
  getMessages,
  insertGoal,
  listContinuingGoals,
  updateGoal as updateGoalRecord,
  updateMessage,
} from '../database.js';
import {
  CONTINUING_GOAL_STATUSES,
  TERMINAL_GOAL_STATUSES,
} from './constants.js';
import {
  pendingOrder,
  queueOrderEvent,
} from './queue-order.js';

export const goalMethods = {
  async startGoal({
    conversationId,
    model,
    specification,
    reasoningEffort = null,
    permissionMode = 'approve_for_me',
    project = {},
    attachments = [],
    ultraMode = false,
    sendInitialPrompt = false,
  }) {
    const normalizedSpecification = String(specification ?? '').trim();
    if (!normalizedSpecification) throw new Error('Goal specification is required.');
    const conversation = ensureConversation(
      conversationId,
      model,
      project,
      ultraMode ? 'ultra' : null,
    );
    const existingGoal = getGoalForConversation(conversation.id);
    if (existingGoal && CONTINUING_GOAL_STATUSES.has(existingGoal.status)) {
      throw new Error('This conversation already has an active Goal.');
    }
    const preparedSpecification = sendInitialPrompt
      ? await this.prepareInitialPrompt(conversation, normalizedSpecification, { improveGoal: true })
      : normalizedSpecification;

    const now = new Date().toISOString();
    const goal = insertGoal({
      id: randomUUID(),
      conversationId: conversation.id,
      specification: preparedSpecification,
      status: 'active',
      revision: 1,
      model,
      reasoningEffort,
      permissionMode,
      activeElapsedMs: 0,
      resumedAt: now,
      resultSummary: null,
      tokensTransacted: null,
      startedAt: now,
      updatedAt: now,
      endedAt: null,
    });
    this.emitConversation(conversation.id);

    if (!sendInitialPrompt) {
      return {
        conversation: getConversation(conversation.id),
        goal,
      };
    }

    const result = await this.send({
      conversationId: conversation.id,
      model,
      text: normalizedSpecification,
      attachments,
      steer: this.runs.has(conversation.id),
      reasoningEffort,
      permissionMode,
      workMode: 'goal',
      goalId: goal.id,
      ultraMode,
      project,
    });
    return { ...result, goal: getGoal(goal.id) };
  },

  async changeGoal({
    conversationId,
    action,
    specification,
    summary,
  }) {
    const goal = getGoalForConversation(conversationId);
    if (!goal) {
      throw new Error('This conversation does not have an active Goal.');
    }

    if (action === 'discard') {
      if (!TERMINAL_GOAL_STATUSES.has(goal.status)) {
        throw new Error('Only a completed, blocked, or cancelled Goal can be discarded.');
      }
      const discardedGoal = updateGoalRecord({
        ...goal,
        status: 'discarded',
        updatedAt: new Date().toISOString(),
      });
      this.emitConversation(conversationId);
      return discardedGoal;
    }

    if (!CONTINUING_GOAL_STATUSES.has(goal.status)) {
      throw new Error('This conversation does not have an active Goal.');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const activeElapsedMs = goal.activeElapsedMs + (
      goal.status === 'active' && goal.resumedAt
        ? Math.max(0, now.getTime() - new Date(goal.resumedAt).getTime())
        : 0
    );
    let updatedGoal;

    if (action === 'pause') {
      if (goal.status !== 'active') throw new Error('The Goal is already paused.');
      updatedGoal = updateGoalRecord({
        ...goal,
        status: 'paused',
        activeElapsedMs,
        resumedAt: null,
        updatedAt: nowIso,
      });
    } else if (action === 'resume') {
      if (goal.status !== 'paused') throw new Error('The Goal is not paused.');
      updatedGoal = updateGoalRecord({
        ...goal,
        status: 'active',
        resumedAt: nowIso,
        updatedAt: nowIso,
      });
    } else if (action === 'edit') {
      const normalizedSpecification = String(specification ?? '').trim();
      if (!normalizedSpecification) throw new Error('Goal specification is required.');
      updatedGoal = updateGoalRecord({
        ...goal,
        specification: normalizedSpecification,
        revision: goal.revision + 1,
        updatedAt: nowIso,
      });
    } else if (['stop', 'completed', 'blocked'].includes(action)) {
      const resultSummary = action === 'stop' ? 'Stopped by the user.' : String(summary ?? '').trim();
      if (action !== 'stop' && !resultSummary) throw new Error('A completion or blocker summary is required.');
      const tokensTransacted = getMessages(conversationId)
        .filter((message) => message.goalId === goal.id && message.role === 'assistant')
        .reduce((total, message) => (
          total
          + (Number(message.usage?.inputTokens) || 0)
          + (Number(message.usage?.outputTokens) || 0)
        ), 0);
      updatedGoal = updateGoalRecord({
        ...goal,
        status: action === 'stop' ? 'cancelled' : action,
        activeElapsedMs,
        resumedAt: null,
        resultSummary,
        tokensTransacted,
        updatedAt: nowIso,
        endedAt: nowIso,
      });
    } else {
      throw new Error('Unknown Goal action.');
    }

    this.emitConversation(conversationId);

    if (action === 'stop') {
      this.stop(conversationId, { includeSubagents: true });
      for (const message of getMessages(conversationId)) {
        if (
          message.goalId === goal.id
          && ['queued', 'steered'].includes(message.status)
        ) {
          deleteMessage(message.id);
          this.emit(conversationId, { type: 'message-delete', messageId: message.id });
        }
      }
    } else if (action === 'resume' && !this.runs.has(conversationId)) {
      this.continueGoal(updatedGoal, 'resume');
    } else if (action === 'edit') {
      const ultraMode = this.isUltraGoal(conversationId, updatedGoal.id);
      const revisionMessage = [
        `<goal_update goal_id="${updatedGoal.id}" revision="${updatedGoal.revision}">`,
        'The user changed the original Goal specification. Re-evaluate the work against the revised specification and continue from the current state.',
        '</goal_update>',
      ].join('\n');
      if (updatedGoal.status === 'paused' && !this.runs.has(conversationId)) {
        const queued = this.createUserMessage({
          conversationId,
          model: updatedGoal.model,
          reasoningEffort: updatedGoal.reasoningEffort,
          permissionMode: updatedGoal.permissionMode,
          workMode: 'goal',
          ultraMode,
          goalId: updatedGoal.id,
          hidden: true,
          text: revisionMessage,
          attachments: [],
          status: 'queued',
        });
        this.emit(conversationId, { type: 'message', message: queued });
      } else {
        await this.send({
          conversationId,
          model: updatedGoal.model,
          text: revisionMessage,
          attachments: [],
          hidden: true,
          steer: this.runs.has(conversationId),
          reasoningEffort: updatedGoal.reasoningEffort,
          permissionMode: updatedGoal.permissionMode,
          workMode: 'goal',
          ultraMode,
          goalId: updatedGoal.id,
        });
      }
    }

    if (['completed', 'blocked'].includes(action)) {
      return {
        goal_id: updatedGoal.id,
        status: updatedGoal.status,
        tokens_transacted: updatedGoal.tokensTransacted,
        started_at: updatedGoal.startedAt,
        elapsed_ms: Math.max(0, now.getTime() - new Date(updatedGoal.startedAt).getTime()),
        active_time_ms: updatedGoal.activeElapsedMs,
        summary: updatedGoal.resultSummary,
        final_response_instruction: 'Present the Goal metrics in your final response: token volume from tokens_transacted and time spent from active_time_ms. Format both values for readability.',
      };
    }

    return updatedGoal;
  },

  async resumeGoals() {
    for (const goal of listContinuingGoals()) {
      if (this.runs.has(goal.conversationId) || !this.continueGoal(goal, 'restart')) continue;
      await this.runs.get(goal.conversationId)?.preparation;
    }
  },

  shouldEndAtBoundary(run) {
    return run.steerRequested || run.controller.signal.aborted;
  },

  isUltraGoal(conversationId, goalId) {
    const run = this.runs.get(conversationId);
    if (run?.goalId === goalId) return run.ultraMode;
    return getMessages(conversationId)
      .findLast((message) => message.goalId === goalId)
      ?.ultraMode ?? false;
  },

  continueGoal(goal, reason = 'continue') {
    if (!goal || goal.status !== 'active' || this.runs.has(goal.conversationId)) return false;
    const queuedItems = this.getQueuedItems(goal.conversationId, goal.model);
    const queuedGoalIndex = queuedItems.findIndex((item) => item.goalId === goal.id);
    const queuedGoalMessage = queuedGoalIndex >= 0
      ? queuedItems.splice(queuedGoalIndex, 1)[0]
      : null;
    const ultraMode = queuedGoalMessage?.ultraMode
      ?? this.isUltraGoal(goal.conversationId, goal.id);
    const userMessage = queuedGoalMessage
      ? updateMessage(queuedGoalMessage.userMessageId, {
          status: 'sent',
          createdAt: new Date().toISOString(),
        })
      : this.createUserMessage({
          conversationId: goal.conversationId,
          model: goal.model,
          reasoningEffort: goal.reasoningEffort,
          permissionMode: goal.permissionMode,
          workMode: 'goal',
          ultraMode,
          goalId: goal.id,
          hidden: true,
          text: [
            `<goal_continuation goal_id="${goal.id}" revision="${goal.revision}" reason="${reason}">`,
            'Continue executing the active Goal from the current state, including all user follow-up criteria. Close unmet acceptance gaps and verify results; do not stop at an assessment or ask whether to proceed. Do not repeat completed work. Keep the Goal active while any permitted approach can advance it; blocking is a last resort after investigating alternatives.',
            '</goal_continuation>',
          ].join('\n'),
          attachments: [],
          status: 'sent',
        });
    this.emit(goal.conversationId, { type: 'message', message: userMessage });
    this.emit(goal.conversationId, queueOrderEvent(pendingOrder(queuedItems)));
    this.start({
      conversationId: goal.conversationId,
      model: queuedGoalMessage?.model ?? goal.model,
      userMessageId: userMessage.id,
      queue: queuedItems,
      reasoningEffort: queuedGoalMessage?.reasoningEffort ?? goal.reasoningEffort,
      permissionMode: goal.permissionMode,
      workMode: 'goal',
      ultraMode,
      goalId: goal.id,
    });
    return true;
  },

  continueConceptualLock(conversationId, current, text) {
    const conversation = getConversation(conversationId);
    if (!conversation || this.runs.has(conversationId)) return false;
    const userMessage = this.createUserMessage({
      conversationId,
      model: current?.model ?? conversation.model,
      reasoningEffort: current?.reasoningEffort ?? null,
      permissionMode: current?.permissionMode ?? 'approve_for_me',
      workMode: current?.workMode ?? null,
      ultraMode: current?.ultraMode ?? false,
      goalId: current?.goalId ?? null,
      hidden: true,
      text,
      attachments: [],
      status: 'sent',
    });
    this.emit(conversationId, { type: 'message', message: userMessage });
    this.start({
      conversationId,
      model: current?.model ?? conversation.model,
      userMessageId: userMessage.id,
      queue: [],
      reasoningEffort: current?.reasoningEffort ?? null,
      permissionMode: current?.permissionMode ?? 'approve_for_me',
      workMode: current?.workMode ?? null,
      ultraMode: current?.ultraMode ?? false,
      goalId: current?.goalId ?? null,
    });
    return true;
  },
};
