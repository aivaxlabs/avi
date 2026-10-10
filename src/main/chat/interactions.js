import { randomUUID } from 'node:crypto';
import { ASK_QUESTION_AFK_TIMEOUT_MS } from './constants.js';

export const interactionMethods = {
  async askQuestion({ conversationId, questions, signal, workMode }) {
    const run = this.runs.get(conversationId);
    if (!run || run.controller.signal !== signal) {
      throw new Error('The active run is no longer available.');
    }
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error('The question was cancelled.');
    }

    const effectiveWorkMode = workMode ?? run.workMode ?? null;
    const enableAfkTimeout = effectiveWorkMode !== 'plan';

    const questionId = randomUUID();
    run.phase = 'question';
    return new Promise((resolveQuestion, rejectQuestion) => {
      let afkTimer = null;
      const clearAfkTimer = () => {
        if (afkTimer) {
          clearTimeout(afkTimer);
          afkTimer = null;
        }
      };
      const abortQuestion = () => {
        clearAfkTimer();
        this.pendingQuestions.delete(questionId);
        this.emit(conversationId, {
          type: 'question-cancelled',
          questionId,
        });
        rejectQuestion(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('The question was cancelled.'),
        );
      };
      const finishAfk = () => {
        clearAfkTimer();
        this.pendingQuestions.delete(questionId);
        if (this.runs.get(conversationId) === run) {
          run.phase = 'tool';
        }
        this.emit(conversationId, {
          type: 'question-cancelled',
          questionId,
          reason: 'afk',
        });
        resolveQuestion({
          cancelled: true,
          afk: true,
          answers: [],
        });
      };
      const resetAfkTimer = () => {
        clearAfkTimer();
        if (!enableAfkTimeout) return;
        afkTimer = setTimeout(finishAfk, ASK_QUESTION_AFK_TIMEOUT_MS);
        if (typeof afkTimer.unref === 'function') afkTimer.unref();
      };
      this.pendingQuestions.set(questionId, {
        conversationId,
        questions,
        resetAfkTimer,
        finish: (result) => {
          clearAfkTimer();
          signal.removeEventListener('abort', abortQuestion);
          if (this.runs.get(conversationId) === run) {
            run.phase = 'tool';
          }
          resolveQuestion(result);
        },
      });
      signal.addEventListener('abort', abortQuestion, { once: true });
      resetAfkTimer();
      this.emit(conversationId, {
        type: 'question-request',
        questionId,
        questions,
      });
    });
  },

  getPendingQuestion(conversationId) {
    for (const [questionId, pending] of this.pendingQuestions) {
      if (pending.conversationId === conversationId) {
        return {
          questionId,
          questions: pending.questions,
        };
      }
    }
    return null;
  },

  getPendingApprovals(conversationId) {
    return [...this.pendingApprovals.entries()]
      .filter(([, pending]) => pending.conversationId === conversationId)
      .map(([approvalId, pending]) => ({
        approvalId,
        toolName: pending.toolName,
        invocationSummary: pending.invocationSummary,
      }));
  },

  questionActivity({ questionId, conversationId = null }) {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending || (conversationId && pending.conversationId !== conversationId)) return false;
    pending.resetAfkTimer();
    return true;
  },

  answerQuestion({ questionId, conversationId = null, cancelled = false, answers = [] }) {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending || (conversationId && pending.conversationId !== conversationId)) return false;

    if (cancelled) {
      this.pendingQuestions.delete(questionId);
      this.emit(pending.conversationId, {
        type: 'question-cancelled',
        questionId,
      });
      pending.finish({
        cancelled: true,
        answers: [],
      });
      return true;
    }

    if (!Array.isArray(answers) || answers.length !== pending.questions.length) {
      throw new Error('Every question must have exactly one answer.');
    }
    const normalizedAnswers = pending.questions.map((question, index) => {
      const answer = answers[index];
      if (
        !answer
        || typeof answer !== 'object'
        || Array.isArray(answer)
        || answer.question !== question.question
      ) {
        throw new Error(`Answer ${index + 1} does not match its question.`);
      }
      if (question.type === 'multiple_choice') {
        if (
          !Array.isArray(answer.answer)
          || answer.answer.length === 0
          || answer.answer.some((option) => typeof option !== 'string' || !option.trim())
        ) {
          throw new Error(`Answer ${index + 1} must contain selected options.`);
        }
        return {
          question: question.question,
          answer: [...new Set(answer.answer.map((option) => option.trim()))],
        };
      }
      const value = typeof answer.answer === 'string' ? answer.answer.trim() : '';
      if (!value) {
        throw new Error(`Answer ${index + 1} must be non-empty.`);
      }
      return {
        question: question.question,
        answer: value,
      };
    });

    this.pendingQuestions.delete(questionId);
    pending.finish({
      cancelled: false,
      answers: normalizedAnswers,
    });
    return true;
  },

  async resolveApproval({ approvalId, conversationId = null, decision }) {
    const pending = this.pendingApprovals.get(approvalId);
    if (
      !pending
      || (conversationId && pending.conversationId !== conversationId)
      || !['allow', 'allow_all', 'disallow'].includes(decision)
    ) return false;

    if (decision === 'allow_all') {
      await this.savePermissionGuidance?.({
        workspacePath: pending.workspacePath,
        invocationSummary: pending.invocationSummary,
      });
      this.approvedToolPatterns.add(pending.approvalPattern);
    }
    this.pendingApprovals.delete(approvalId);
    this.emit(pending.conversationId, {
      type: 'permission-resolved',
      approvalId,
      decision,
    });
    pending.finish(decision !== 'disallow');
    return true;
  },
};
