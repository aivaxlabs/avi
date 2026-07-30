import { randomUUID } from 'node:crypto';
import {
  deleteMessage,
  ensureConversation,
  getConversation,
  getGoal,
  getGoalForConversation,
  getMessage,
  getMessages,
  getPreferences as readPreferences,
  insertGoal,
  insertMessage,
  listContinuingGoals,
  listSubagents,
  setLastModel,
  toModelMessages,
  toModelMessagesThroughUser,
  updateConversation,
  updateGoal as updateGoalRecord,
  updateMessage,
} from './database.js';
import { CLIENT_TOOLS } from './client-tools.js';
import { StreamAccumulator } from './streaming.js';

const CONTINUING_GOAL_STATUSES = new Set(['active', 'paused']);
const TERMINAL_GOAL_STATUSES = new Set(['completed', 'blocked', 'cancelled']);
const STREAM_PERSIST_INTERVAL_MS = 120;
const STREAM_RENDER_INTERVAL_MS = 240;
const PLAN_TOOL_NAMES = new Set([
  'ask_question',
  'chat_inspect_thread',
  'chat_list_folders',
  'chat_list_threads',
  'file_search',
  'grep_search',
  'read_file',
  'read_terminal_output',
  'read_url',
]);
const COMPACTION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a highly detailed handoff summary for another LLM that will resume this exact task. Do not continue the task itself and do not omit implementation details merely to be concise.

Include:
- The user's original objective and the current objective, including how the request evolved
- What you were working on, planning, investigating, or exploring immediately before this checkpoint
- Current progress and every important decision already made, with rationale where it affects future work
- Important context, constraints, user preferences, project conventions, and explicit instructions that must continue to be followed
- Concrete implementation details: relevant files, symbols, interfaces, commands, data shapes, examples, references, and observed behavior
- What has been completed and how it was validated, clearly separating confirmed evidence from assumptions or unverified work
- What remains to be done, including unresolved problems, risks, edge cases, blockers, and open questions
- What you intended to do next, stated as concrete immediate actions
- A step-by-step execution roadmap for the remaining work, clearly marking the current stage and the completion status of each stage
- Any critical data needed to continue without rereading the compacted conversation

Make the checkpoint structured, exhaustive, precise, and optimized for seamless continuation by another LLM.`;

export class ChatRunner {
  constructor({
    registry,
    mcpManager,
    getPreferences = readPreferences,
    sendEvent,
    savePermissionGuidance,
    stopBackgroundTasks,
    debugStream = false,
  }) {
    this.registry = registry;
    this.mcpManager = mcpManager;
    this.getPreferences = getPreferences;
    this.sendEvent = sendEvent;
    this.savePermissionGuidance = savePermissionGuidance;
    this.stopBackgroundTasks = stopBackgroundTasks;
    this.debugStream = debugStream;
    this.runs = new Map();
    this.pendingApprovals = new Map();
    this.pendingQuestions = new Map();
    this.approvedToolPatterns = new Set();
  }

  async startGoal({
    conversationId,
    model,
    specification,
    reasoningEffort = null,
    permissionMode = 'approve_for_me',
    project = {},
    attachments = [],
    sendInitialPrompt = false,
  }) {
    const normalizedSpecification = String(specification ?? '').trim();
    if (!normalizedSpecification) throw new Error('Goal specification is required.');
    const conversation = ensureConversation(conversationId, model, project);
    const existingGoal = getGoalForConversation(conversation.id);
    if (existingGoal && CONTINUING_GOAL_STATUSES.has(existingGoal.status)) {
      throw new Error('This conversation already has an active Goal.');
    }

    const now = new Date().toISOString();
    const goal = insertGoal({
      id: randomUUID(),
      conversationId: conversation.id,
      specification: normalizedSpecification,
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
      project,
    });
    return { ...result, goal: getGoal(goal.id) };
  }

  async changeGoal({
    conversationId,
    action,
    specification,
    summary,
    stopRun = true,
  }) {
    const goal = getGoalForConversation(conversationId);
    if (!goal || !CONTINUING_GOAL_STATUSES.has(goal.status)) {
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
      if (stopRun) {
        this.stop(conversationId, { includeSubagents: true });
      } else {
        const run = this.runs.get(conversationId);
        if (run) {
          const cancelledItems = run.queue.filter((item) => item.goalId === goal.id);
          run.queue = run.queue.filter((item) => item.goalId !== goal.id);
          for (const item of cancelledItems) {
            deleteMessage(item.userMessageId);
            this.emit(conversationId, {
              type: 'message-delete',
              messageId: item.userMessageId,
            });
          }
        }
      }
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
          workMode: 'goal',
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
  }

  resumeGoals() {
    for (const goal of listContinuingGoals()) {
      if (!this.runs.has(goal.conversationId)) this.continueGoal(goal, 'restart');
    }
  }

  async send({
    conversationId,
    model,
    text,
    attachments = [],
    steer = false,
    reasoningEffort = null,
    permissionMode = 'approve_for_me',
    workMode = null,
    goalId = null,
    hidden = false,
    project = {},
  }) {
    workMode = ['plan', 'goal'].includes(workMode) ? workMode : null;
    const conversation = ensureConversation(conversationId, model, project);
    const activeGoal = getGoalForConversation(conversation.id);
    if (workMode === 'plan' && activeGoal && CONTINUING_GOAL_STATUSES.has(activeGoal.status)) {
      await this.changeGoal({
        conversationId: conversation.id,
        action: 'stop',
        stopRun: false,
      });
      steer = this.runs.has(conversation.id);
    }
    if (workMode === 'goal') {
      goalId = goalId ?? (
        activeGoal && CONTINUING_GOAL_STATUSES.has(activeGoal.status)
          ? activeGoal.id
          : null
      );
      if (!goalId) workMode = null;
    } else {
      goalId = null;
    }
    setLastModel(model);

    if (this.runs.has(conversation.id)) {
      const queued = this.createUserMessage({
        conversationId: conversation.id,
        model,
        reasoningEffort,
        workMode,
        goalId,
        hidden,
        text,
        attachments,
        status: steer ? 'steered' : 'queued',
      });
      const run = this.runs.get(conversation.id);
      if (steer) {
        run.queue.unshift({
          userMessageId: queued.id,
          model,
          reasoningEffort,
          permissionMode,
          workMode,
          ...(goalId ? { goalId } : {}),
        });
        this.requestSteer(conversation.id);
      } else {
        run.queue.push({
          userMessageId: queued.id,
          model,
          reasoningEffort,
          permissionMode,
          workMode,
          ...(goalId ? { goalId } : {}),
        });
      }
      this.emit(conversation.id, { type: 'message', message: queued });
      const queueOrder = run.queue.map((item) => item.userMessageId);
      this.emit(conversation.id, { type: 'queue-order', messageIds: queueOrder });
      return {
        conversation: getConversation(conversation.id),
        message: queued,
        queued: true,
        queueOrder,
      };
    }

    const userMessage = this.createUserMessage({
      conversationId: conversation.id,
      model,
      reasoningEffort,
      workMode,
      goalId,
      hidden,
      text,
      attachments,
      status: workMode === 'plan'
        || !this.mcpManager
        || this.mcpManager.isWorkspaceReady(conversation.projectPath)
        ? 'sent'
        : 'waiting_mcp',
    });
    this.emit(conversation.id, { type: 'message', message: userMessage });
    this.start({
      conversationId: conversation.id,
      model,
      userMessageId: userMessage.id,
      reasoningEffort,
      permissionMode,
      workMode,
      goalId,
    });
    return { conversation: getConversation(conversation.id), message: userMessage, queued: false };
  }

  stop(conversationId, { clearQueue = true, includeSubagents = false } = {}) {
    const conversationIds = [
      conversationId,
      ...(includeSubagents
        ? listSubagents(conversationId).map((subagent) => subagent.id)
        : []),
    ];
    for (const id of conversationIds) {
      const run = this.runs.get(id);
      if (run) {
        if (clearQueue) {
          for (const item of run.queue) {
            deleteMessage(item.userMessageId);
            this.emit(id, { type: 'message-delete', messageId: item.userMessageId });
          }
          run.queue = [];
        }
        run.controller.abort('stop');
      }
      this.stopBackgroundTasks?.(id);
    }
  }

  async shutdown() {
    const activeRuns = [...this.runs.entries()];
    for (const [conversationId] of activeRuns) {
      this.stop(conversationId);
    }
    await Promise.allSettled(activeRuns.map(([, run]) => run.completion));
  }

  requestSteer(conversationId) {
    const run = this.runs.get(conversationId);
    if (!run) return false;
    run.steerRequested = true;
    if (['approval', 'question'].includes(run.phase)) {
      run.controller.abort('steer');
    }
    return true;
  }

  cancelQueuedMessage({ conversationId, messageId }) {
    const run = this.runs.get(conversationId);
    if (run) {
      run.queue = run.queue.filter((item) => item.userMessageId !== messageId);
    }

    const message = getMessage(messageId);
    if (!message || !['queued', 'steered'].includes(message.status)) {
      return {
        conversation: getConversation(conversationId),
        cancelled: false,
        queueOrder: run?.queue.map((item) => item.userMessageId) ?? [],
      };
    }

    deleteMessage(messageId);
    this.emit(conversationId, { type: 'message-delete', messageId });
    const { queueOrder } = this.reorderQueuedMessages({
      conversationId,
      messageIds: run?.queue.map((item) => item.userMessageId) ?? [],
    });
    return {
      conversation: getConversation(conversationId),
      cancelled: true,
      queueOrder,
    };
  }

  reorderQueuedMessages({ conversationId, messageIds = [], steerMessageId = null }) {
    const run = this.runs.get(conversationId);
    if (!run) {
      const conversation = getConversation(conversationId);
      const queuedItems = this.getQueuedItems(conversationId, conversation?.model);
      const queuedById = new Map(queuedItems.map((item) => [item.userMessageId, item]));
      const requestedIds = [...new Set(messageIds)];
      if (
        !steerMessageId
        || requestedIds.length !== queuedItems.length
        || requestedIds.some((messageId) => !queuedById.has(messageId))
        || !queuedById.has(steerMessageId)
      ) {
        return {
          reordered: false,
          queueOrder: queuedItems.map((item) => item.userMessageId),
        };
      }

      const orderedQueue = requestedIds.map((messageId) => queuedById.get(messageId));
      const next = orderedQueue.shift();
      const sentMessage = updateMessage(next.userMessageId, {
        status: next.workMode === 'plan'
          || !this.mcpManager
          || this.mcpManager.isWorkspaceReady(conversation?.projectPath)
          ? 'sent'
          : 'waiting_mcp',
      });
      this.emit(conversationId, { type: 'message', message: sentMessage });
      this.emit(conversationId, {
        type: 'queue-order',
        messageIds: orderedQueue.map((item) => item.userMessageId),
      });
      this.start({
        conversationId,
        model: next.model,
        userMessageId: next.userMessageId,
        queue: orderedQueue,
        reasoningEffort: next.reasoningEffort,
        permissionMode: next.permissionMode,
        workMode: next.workMode,
        goalId: next.goalId,
      });
      return {
        reordered: true,
        steered: true,
        queueOrder: orderedQueue.map((item) => item.userMessageId),
      };
    }

    const queuedById = new Map(run.queue.map((item) => [item.userMessageId, item]));
    const requestedIds = [...new Set(messageIds)];
    if (
      requestedIds.length !== run.queue.length
      || requestedIds.some((messageId) => !queuedById.has(messageId))
      || (steerMessageId && !queuedById.has(steerMessageId))
    ) {
      return {
        reordered: false,
        queueOrder: run.queue.map((item) => item.userMessageId),
      };
    }

    run.queue = requestedIds.map((messageId) => queuedById.get(messageId));
    this.emit(conversationId, { type: 'queue-order', messageIds: requestedIds });
    if (steerMessageId) {
      const steeredMessage = updateMessage(steerMessageId, { status: 'steered' });
      if (steeredMessage) {
        this.emit(conversationId, { type: 'message', message: steeredMessage });
      }
      this.requestSteer(conversationId);
    }
    return {
      reordered: true,
      steered: Boolean(steerMessageId),
      queueOrder: requestedIds,
    };
  }

  async retry({
    conversationId,
    model,
    assistantMessageId,
    resumeFromFailure = false,
    permissionMode = 'approve_for_me',
  }) {
    const conversation = ensureConversation(conversationId, model);
    setLastModel(model);

    if (this.runs.has(conversation.id)) {
      return { conversation: getConversation(conversation.id), message: null, queued: true };
    }

    if (resumeFromFailure) {
      const failedAssistant = getMessage(assistantMessageId);
      if (
        !failedAssistant
        || failedAssistant.conversationId !== conversation.id
        || failedAssistant.role !== 'assistant'
        || failedAssistant.status === 'completed'
      ) {
        return { conversation: getConversation(conversation.id), message: null, queued: false };
      }

      const conversationMessages = getMessages(conversation.id);
      const assistantIndex = conversationMessages.findIndex(
        (message) => message.id === assistantMessageId,
      );
      const sourceUser = conversationMessages
        .slice(0, assistantIndex)
        .findLast((message) => (
          message.role === 'user'
          && !['queued', 'steered'].includes(message.status)
        ));
      const messages = toModelMessagesThroughUser(
        conversation.id,
        assistantMessageId,
        { includeFailedUser: true },
      );
      if (!sourceUser || messages.length === 0) {
        return { conversation: getConversation(conversation.id), message: null, queued: false };
      }

      const resumeSegments = (failedAssistant.segments ?? [])
        .filter((segment) => segment.type !== 'error')
        .filter((segment) => (
          segment.type !== 'tool-call'
          || (
            segment.callId
            && segment.name
            && segment.resultText !== undefined
          )
        ));
      const roundsByIndex = new Map();
      let pendingAssistantContent = '';
      for (const segment of resumeSegments) {
        if (segment.type === 'content') {
          pendingAssistantContent += segment.text ?? '';
          continue;
        }
        if (segment.type !== 'tool-call') continue;

        const roundIndex = Number(segment.key?.match(/^round:(\d+):/)?.[1]);
        if (!Number.isInteger(roundIndex)) continue;
        const round = roundsByIndex.get(roundIndex) ?? {
          assistantContent: '',
          toolCalls: [],
          results: [],
        };
        if (pendingAssistantContent) {
          round.assistantContent += pendingAssistantContent;
          pendingAssistantContent = '';
        }
        round.toolCalls.push({
          key: segment.key,
          callId: segment.callId,
          name: segment.name,
          argumentsText: segment.argumentsText ?? '',
        });
        round.results.push({
          callId: segment.callId,
          output: segment.resultText ?? '',
          isError: segment.status === 'error',
        });
        roundsByIndex.set(roundIndex, round);
      }

      const initialToolHistory = [...roundsByIndex.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, round]) => round);
      if (pendingAssistantContent) {
        initialToolHistory.push({
          assistantContent: pendingAssistantContent,
          toolCalls: [],
          results: [],
        });
      }

      updateMessage(sourceUser.id, { status: 'sent' });
      const queue = this.getQueuedItems(conversation.id, model);
      this.start({
        conversationId: conversation.id,
        model,
        userMessageId: sourceUser.id,
        queue,
        retryMessages: messages,
        initialToolHistory,
        resumeAssistantMessageId: failedAssistant.id,
        initialSegments: resumeSegments,
        initialUsage: failedAssistant.usage,
        permissionMode,
        workMode: sourceUser.workMode,
        goalId: sourceUser.goalId,
      });
      return {
        conversation: getConversation(conversation.id),
        message: getMessage(failedAssistant.id),
        queued: false,
      };
    }

    const messages = toModelMessagesThroughUser(conversation.id, assistantMessageId);
    if (messages.length === 0) {
      return { conversation: getConversation(conversation.id), message: null, queued: false };
    }

    const conversationMessages = getMessages(conversation.id);
    const queue = this.getQueuedItems(conversation.id, model);
    const assistantIndex = conversationMessages.findIndex((message) => message.id === assistantMessageId);
    const searchEnd = assistantIndex >= 0 ? assistantIndex : conversationMessages.length;
    const lastUserIndex = conversationMessages
      .slice(0, searchEnd)
      .findLastIndex((message) => message.role === 'user' && ['sent', 'completed'].includes(message.status));
    const staleMessages = lastUserIndex >= 0 ? conversationMessages.slice(lastUserIndex + 1) : [];
    const sourceUser = lastUserIndex >= 0 ? conversationMessages[lastUserIndex] : null;
    for (const message of staleMessages) {
      if (['queued', 'steered'].includes(message.status)) continue;
      deleteMessage(message.id);
      this.emit(conversation.id, { type: 'message-delete', messageId: message.id });
    }

    this.start({
      conversationId: conversation.id,
      model,
      queue,
      retryMessages: messages,
      permissionMode,
      workMode: sourceUser?.workMode,
      goalId: sourceUser?.goalId,
    });

    return { conversation: getConversation(conversation.id), message: null, queued: false };
  }

  async compress({
    conversationId,
    model,
    automatic = false,
    controller: activeController = null,
  }) {
    const conversation = ensureConversation(conversationId, model);
    const existingRun = this.runs.get(conversation.id);
    if (existingRun && !automatic) {
      throw new Error('Wait for the current response to finish before compressing the context.');
    }

    const selection = this.registry.resolve(model || conversation.model);
    if (!selection) {
      throw new Error('The selected model is no longer configured. Choose another model in Settings.');
    }

    const messages = toModelMessages(conversation.id);
    if (messages.length === 0) return conversation;

    const checkpointMessage = getMessages(conversation.id)
      .filter((message) => ['completed', 'sent', 'aborted'].includes(message.status))
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .at(-1);
    if (!checkpointMessage) return conversation;

    const inputTokens = conversation.contextTokens > 0
      ? conversation.contextTokens
      : Math.ceil(JSON.stringify(messages).length / 4);
    const compressionSegment = {
      type: 'context-compression',
      inputTokens,
      outputTokens: null,
    };
    const compressionMessage = insertMessage({
      conversationId: conversation.id,
      role: 'system',
      status: 'streaming',
      content: '',
      segments: [compressionSegment],
    });
    this.emit(conversation.id, { type: 'message', message: compressionMessage });

    const controller = activeController ?? new AbortController();
    if (!automatic) {
      this.runs.set(conversation.id, {
        controller,
        queue: [],
        model: selection.model.id,
        kind: 'compression',
        phase: 'inference',
        steerRequested: false,
      });
      this.emit(conversation.id, { type: 'run-state', running: true });
    }

    let compressionUsage = null;
    try {
      const run = this.runs.get(conversation.id);
      if (run) run.phase = 'inference';
      const turn = await selection.provider.stream({
        model: selection.model,
        messages: [
          ...messages,
          { role: 'user', content: COMPACTION_PROMPT },
        ],
        tools: [],
        toolHistory: [],
        invocationContext: { workspacePath: conversation.projectPath },
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'usage') compressionUsage = event.usage;
        },
      });
      if (run) {
        run.phase = 'boundary';
        if (this.shouldEndAtBoundary(run)) throw new Error('The run was interrupted.');
      }
      const checkpoint = turn.assistantContent.trim();
      if (!checkpoint) {
        throw new Error('The model returned an empty context checkpoint.');
      }
      if (turn.toolCalls.length > 0) {
        throw new Error('The model attempted to call a tool while compressing the context.');
      }

      const outputTokens = compressionUsage?.outputTokens
        || Math.ceil(checkpoint.length / 4);
      const updatedConversation = updateConversation(conversation.id, {
        contextCheckpoint: checkpoint,
        checkpointMessageId: checkpointMessage.id,
        contextTokens: outputTokens,
      });
      const completedMessage = updateMessage(compressionMessage.id, {
        status: 'completed',
        segments: [{
          ...compressionSegment,
          outputTokens: updatedConversation.contextTokens,
        }],
      });
      this.emit(conversation.id, { type: 'message', message: completedMessage });
      this.emit(conversation.id, { type: 'conversation', conversation: updatedConversation });
      return updatedConversation;
    } catch (error) {
      const stopped = controller.signal.aborted;
      const failedMessage = updateMessage(compressionMessage.id, {
        status: stopped ? 'aborted' : 'error',
        segments: [{
          ...compressionSegment,
          error: stopped
            ? 'Context compression stopped.'
            : 'Context compression failed.',
        }],
      });
      this.emit(conversation.id, { type: 'message', message: failedMessage });
      if (stopped) return getConversation(conversation.id);
      throw error;
    } finally {
      if (!automatic) {
        this.finishRun(conversation.id);
      }
    }
  }

  getQueuedItems(conversationId, fallbackModel) {
    return getMessages(conversationId)
      .filter((message) => ['queued', 'steered'].includes(message.status))
      .map((message) => ({
        userMessageId: message.id,
        model: message.model || fallbackModel,
        reasoningEffort: message.reasoningEffort,
        permissionMode: 'approve_for_me',
        workMode: message.workMode,
        ...(message.goalId ? { goalId: message.goalId } : {}),
      }));
  }

  createUserMessage({
    conversationId,
    model,
    reasoningEffort,
    workMode,
    goalId = null,
    hidden = false,
    text,
    attachments,
    status,
  }) {
    const message = insertMessage({
      conversationId,
      role: 'user',
      model,
      reasoningEffort,
      workMode,
      goalId,
      hidden,
      status,
      content: text,
      attachments,
    });
    const conversation = getConversation(conversationId);

    if (
      !hidden
      && conversation?.titleStatus === 'pending'
      && conversation.title === 'New chat'
      && text.trim()
    ) {
      const normalizedTitle = text.replace(/\s+/g, ' ').trim();
      updateConversation(conversationId, {
        title: normalizedTitle.length > 48 ? `${normalizedTitle.slice(0, 48)}...` : normalizedTitle,
        titleStatus: 'generated',
      });
      this.emit(conversationId, { type: 'conversation', conversation: getConversation(conversationId) });
    }

    return message;
  }

  async start({
    conversationId,
    model,
    userMessageId = null,
    queue = [],
    retryMessages = null,
    initialToolHistory = [],
    resumeAssistantMessageId = null,
    initialSegments = [],
    initialUsage = null,
    reasoningEffort = null,
    permissionMode = 'approve_for_me',
    workMode = null,
    goalId = null,
  }) {
    workMode = ['plan', 'goal'].includes(workMode) ? workMode : null;
    permissionMode = [
      'ask_for_approval',
      'approve_for_me',
      'full_access',
    ].includes(permissionMode)
      ? permissionMode
      : 'approve_for_me';
    const controller = new AbortController();
    const accumulator = new StreamAccumulator({
      segments: initialSegments,
      usage: initialUsage,
    });
    const assistantMessage = resumeAssistantMessageId
      ? updateMessage(resumeAssistantMessageId, {
          status: 'streaming',
          content: accumulator.content,
          segments: accumulator.segments,
          usage: accumulator.usage,
        })
      : insertMessage({
          conversationId,
          role: 'assistant',
          model,
          workMode,
          goalId,
          status: 'streaming',
          content: '',
        });
    const run = {
      controller,
      queue,
      assistantMessageId: assistantMessage.id,
      accumulator,
      model,
      permissionMode,
      workMode,
      goalId,
      kind: 'chat',
      phase: 'mcp',
      steerRequested: false,
    };
    const completion = Promise.withResolvers();
    run.completion = completion.promise;
    this.runs.set(conversationId, run);
    this.emit(conversationId, { type: 'message', message: assistantMessage });
    this.emit(conversationId, { type: 'run-state', running: true });

    const requestStartedAt = Date.now();
    let lastPersistedAt = 0;
    let lastRenderedAt = 0;
    const persistAssistant = ({ status = 'streaming', force = false } = {}) => {
      const now = Date.now();
      if (!force && now - lastPersistedAt < STREAM_PERSIST_INTERVAL_MS) return null;
      lastPersistedAt = now;
      const message = updateMessage(assistantMessage.id, {
        status,
        content: accumulator.content,
        segments: accumulator.segments,
        usage: accumulator.usage,
      });
      if (
        message
        && (
          force
          || status !== 'streaming'
          || now - lastRenderedAt >= STREAM_RENDER_INTERVAL_MS
        )
      ) {
        lastRenderedAt = now;
        this.emit(conversationId, { type: 'message', message });
      }
      return message;
    };
    this.logChatTiming(conversationId, {
      phase: 'request-start',
      assistantMessageId: assistantMessage.id,
      model,
    });

    let waitingForMcp = false;
    try {
      const workspacePath = getConversation(conversationId)?.projectPath;
      waitingForMcp = Boolean(
        workMode !== 'plan'
        && this.mcpManager
        && !this.mcpManager.isWorkspaceReady(workspacePath),
      );
      if (waitingForMcp) {
        this.emit(conversationId, { type: 'mcp-waiting', waiting: true });
      }
      const mcpRuntime = workMode === 'plan'
        ? { tools: [], instructions: [] }
        : this.mcpManager
        ? await this.mcpManager.ensureWorkspace(workspacePath, controller.signal)
        : { tools: [], instructions: [] };
      if (this.shouldEndAtBoundary(run)) throw new Error('The run was interrupted.');
      if (userMessageId && getMessage(userMessageId)?.status === 'waiting_mcp') {
        const sentMessage = updateMessage(userMessageId, { status: 'sent' });
        this.emit(conversationId, { type: 'message', message: sentMessage });
      }
      if (waitingForMcp) {
        waitingForMcp = false;
        this.emit(conversationId, { type: 'mcp-waiting', waiting: false });
      }

      const selection = this.registry.resolve(model);
      if (!selection) {
        throw new Error('The selected model is no longer configured. Choose another model in Settings.');
      }

      const messages = retryMessages
        ?? toModelMessages(conversationId, { excludeMessageId: assistantMessage.id });
      const models = this.registry.listModels();
      const currentConversation = getConversation(conversationId);
      const currentGoal = goalId ? getGoal(goalId) : getGoalForConversation(conversationId);
      const goalContinues = currentGoal && CONTINUING_GOAL_STATUSES.has(currentGoal.status);
      const tuning = this.getPreferences().tuning;
      const providerTools = workMode === 'plan'
        ? []
        : selection.provider.getContributions({
            model: selection.model,
            conversation: currentConversation,
            workspacePath,
          }).tools;
      const availableTools = [
        ...CLIENT_TOOLS
          .filter((tool) => workMode !== 'plan' || PLAN_TOOL_NAMES.has(tool.name))
          .filter((tool) => tool.name !== 'start_goal' || !goalContinues)
          .filter((tool) => tool.name !== 'update_goal_status' || goalContinues)
          .filter((tool) => (
            tool.name !== 'chat_report_to_orchestrator' || currentConversation?.isSubagent
          ))
          .filter((tool) => (
            tool.name !== 'chat_spawn_subagent'
            || (!currentConversation?.isSubagent && !currentConversation?.isSideChat)
          ))
          .map((tool) => {
            if (['chat_create_thread', 'chat_spawn_subagent'].includes(tool.name)) {
              return {
                ...tool,
                inputSchema: {
                  ...tool.inputSchema,
                  properties: {
                    ...tool.inputSchema.properties,
                    model_name: {
                      ...tool.inputSchema.properties.model_name,
                      enum: models.map((item) => item.id),
                    },
                    reasoning_effort: {
                      ...tool.inputSchema.properties.reasoning_effort,
                      enum: [...new Set(models.flatMap((item) => item.reasoning))],
                    },
                  },
                },
              };
            }
            if (tool.name === 'run_in_terminal') {
              return {
                ...tool,
                inputSchema: {
                  ...tool.inputSchema,
                  properties: {
                    ...tool.inputSchema.properties,
                    timeout: {
                      ...tool.inputSchema.properties.timeout,
                      default: tuning.terminalTimeoutSeconds,
                      description: `Maximum time to wait, in seconds. Defaults to ${tuning.terminalTimeoutSeconds} seconds and accepts values from 1 to 300. If the timeout elapses, the command keeps running and the response includes its terminal ID and partial output.`,
                    },
                  },
                },
              };
            }
            return tool;
          }),
        ...providerTools,
        ...mcpRuntime.tools,
      ];
      const toolHistory = initialToolHistory.map((round) => ({
        ...round,
        toolCalls: [...round.toolCalls],
        results: [...round.results],
      }));
      let lastInputTokens = 0;
      let firstResponseAt = null;
      this.logChatTiming(conversationId, {
        phase: 'request-ready',
        assistantMessageId: assistantMessage.id,
        provider: selection.model.providerName,
        interface: selection.model.interface,
        model: selection.model.modelId,
        messages: messages.length,
        elapsedMs: Date.now() - requestStartedAt,
      });

      while (true) {
        const roundIndex = toolHistory.length;
        const latestGoal = goalId ? getGoal(goalId) : getGoalForConversation(conversationId);
        const goalContext = latestGoal && CONTINUING_GOAL_STATUSES.has(latestGoal.status)
          ? latestGoal
          : null;
        const subagentParentId = currentConversation?.isSubagent
          ? currentConversation.parentConversationId
          : currentConversation?.isSideChat
            ? null
            : currentConversation?.id;
        const subagentContext = subagentParentId
          ? listSubagents(subagentParentId).map((subagent) => {
              const subagentMessages = getMessages(subagent.id);
              const lastUserIndex = subagentMessages
                .findLastIndex((message) => message.role === 'user');
              const lastAssistant = subagentMessages
                .slice(lastUserIndex + 1)
                .findLast((message) => message.role === 'assistant');
              return {
                threadId: subagent.id,
                initialPrompt: subagent.initialPrompt ?? subagent.firstPrompt,
                status: this.runs.has(subagent.id)
                  ? 'in_progress'
                  : lastAssistant?.status === 'completed'
                    ? 'completed'
                    : 'failed',
              };
            })
          : [];
        run.phase = 'inference';
        const turn = await selection.provider.stream({
          model: selection.model,
          messages,
          tools: availableTools,
          toolHistory,
          reasoningEffort,
          invocationContext: {
            conversationId,
            workspacePath,
            mcpInstructions: mcpRuntime.instructions,
            permissionMode,
            workMode,
            goal: goalContext,
            subagents: subagentContext,
            tuning,
          },
          signal: controller.signal,
          onEvent: (event) => {
            if (
              firstResponseAt === null
              && ['content', 'reasoning', 'tool-call'].includes(event.type)
            ) {
              firstResponseAt = Date.now();
            }
            if (event.type === 'usage') {
              lastInputTokens = event.usage.inputTokens ?? lastInputTokens;
            }
            accumulator.apply(event.type === 'tool-call'
              ? {
                  ...event,
                  key: `round:${roundIndex}:${event.key ?? event.callId ?? 'tool'}`,
                  isMcp: Boolean(
                    availableTools.find((tool) => tool.name === event.name)?.mcp,
                  ),
                }
              : event);
            this.logStreamEvent(conversationId, event);
            persistAssistant({
              force: event.type === 'usage' || event.type === 'error',
            });
          },
        });
        run.phase = 'boundary';
        if (this.shouldEndAtBoundary(run)) throw new Error('The run was interrupted.');
        if (turn.toolCalls.length === 0) break;

        const results = [];
        for (const toolCall of turn.toolCalls) {
          if (!toolCall.callId || !toolCall.name) {
            throw new Error('The provider returned a tool call without a call ID or name.');
          }

          const tool = availableTools.find((item) => item.name === toolCall.name);
          const isMcpTool = Boolean(tool?.mcp);
          let args;
          try {
            args = JSON.parse(toolCall.argumentsText);
          } catch {
            args = null;
          }

          const invocationGoal = typeof args?.__invocation_goal === 'string'
            ? args.__invocation_goal.trim()
            : '';
          const requiresHumanApproval = args?.__requires_human_approval;
          const input = args && typeof args === 'object' && !Array.isArray(args)
            ? { ...args }
            : null;
          if (input) {
            delete input.__requires_human_approval;
            delete input.__invocation_goal;
          }
          const invocationSummary = (
            invocationGoal
            || tool?.description
            || toolCall.name
          ).replace(/\s+/g, ' ').trim();
          const approvalPattern = `${workspacePath ?? ''}\0${invocationSummary.toLowerCase()}`;
          accumulator.apply({
            type: 'tool-call',
            key: `round:${roundIndex}:${toolCall.key ?? toolCall.callId}`,
            callId: toolCall.callId,
            name: toolCall.name,
            argumentsText: isMcpTool && input
              ? JSON.stringify(input)
              : toolCall.argumentsText,
            replaceArguments: true,
            invocationGoal,
            requiresHumanApproval: requiresHumanApproval === true,
            isMcp: isMcpTool,
          });
          persistAssistant({ force: true });

          let output;
          let isError = false;
          try {
            if (!args || typeof args !== 'object' || Array.isArray(args)) {
              throw new Error('Tool arguments must be a JSON object.');
            }
            if (!invocationGoal) {
              throw new Error('Tool arguments must include __invocation_goal.');
            }
            if (typeof requiresHumanApproval !== 'boolean') {
              throw new Error('Tool arguments must include __requires_human_approval as a boolean.');
            }
            if (!tool) throw new Error(`Unknown client-side tool: ${toolCall.name}.`);
            if (
              workMode === 'plan'
              && (tool.mcp || !PLAN_TOOL_NAMES.has(tool.name))
            ) {
              throw new Error(`Tool ${toolCall.name} is not available in Plan mode.`);
            }

            const needsApproval = tool.approval !== 'never'
              && requiresHumanApproval
              && permissionMode !== 'full_access'
              && !this.approvedToolPatterns.has(approvalPattern);
            if (needsApproval) {
              const approvalId = randomUUID();
              run.phase = 'approval';
              const approved = await new Promise((resolveApproval, rejectApproval) => {
                const abortApproval = () => {
                  this.pendingApprovals.delete(approvalId);
                  this.emit(conversationId, {
                    type: 'permission-cancelled',
                    approvalId,
                  });
                  rejectApproval(controller.signal.reason ?? new Error('Tool approval was cancelled.'));
                };
                this.pendingApprovals.set(approvalId, {
                  approvalPattern,
                  invocationSummary,
                  workspacePath,
                  finish: (decision) => {
                    controller.signal.removeEventListener('abort', abortApproval);
                    resolveApproval(decision);
                  },
                });
                controller.signal.addEventListener('abort', abortApproval, { once: true });
                this.emit(conversationId, {
                  type: 'permission-request',
                  approvalId,
                  toolName: toolCall.name,
                  invocationSummary,
                  workspacePath,
                  input,
                });
              });
              if (!approved) {
                throw new Error('The user disallowed this tool call.');
              }
            }

            run.phase = 'tool';
            const value = await tool.execute(input, {
              signal: controller.signal,
              workspacePath,
              chatRunner: this,
              conversationId,
              model,
              models,
              reasoningEffort,
              permissionMode,
              workMode,
              goal: goalContext,
              tuning,
            });
            output = typeof value === 'string' ? value : JSON.stringify(value);
          } catch (error) {
            isError = true;
            output = JSON.stringify(toolCall.name === 'ask_question'
              ? {
                  error: error instanceof Error ? error.message : String(error),
                  userResponded: false,
                  instruction: 'No user answer was collected. Correct the arguments and call ask_question again. Do not infer an answer.',
                }
              : {
                  error: error instanceof Error ? error.message : String(error),
                });
          }

          if (tuning.toolOutputLimit !== null && output.length > tuning.toolOutputLimit) {
            output = JSON.stringify({
              output: output.slice(0, tuning.toolOutputLimit),
              truncated: true,
            });
          }
          results.push({
            callId: toolCall.callId,
            output,
            isError,
          });
          accumulator.apply({
            type: 'tool-result',
            callId: toolCall.callId,
            output,
            isError,
          });
          persistAssistant({ force: true });
          run.phase = 'boundary';
          if (this.shouldEndAtBoundary(run)) throw new Error('The run was interrupted.');
        }

        toolHistory.push({
          assistantContent: turn.assistantContent,
          continuation: turn.continuation,
          toolCalls: turn.toolCalls,
          results,
        });
      }

      accumulator.finish();
      const completedAt = Date.now();
      const outputTokens = accumulator.usage?.outputTokens ?? 0;
      const generationDurationMs = firstResponseAt === null ? 0 : completedAt - firstResponseAt;
      accumulator.usage = {
        ...(accumulator.usage ?? {}),
        latencyMs: firstResponseAt === null ? null : firstResponseAt - requestStartedAt,
        durationMs: completedAt - requestStartedAt,
        tokensPerSecond: outputTokens > 0 && generationDurationMs > 0
          ? outputTokens / (generationDurationMs / 1000)
          : null,
      };
      persistAssistant({ status: 'completed', force: true });
      const updatedConversation = updateConversation(conversationId, {
        contextTokens: lastInputTokens,
      });
      this.emit(conversationId, { type: 'conversation', conversation: updatedConversation });
      this.logChatTiming(conversationId, {
        phase: 'message-completed',
        assistantMessageId: assistantMessage.id,
        model: selection.model.modelId,
        usage: accumulator.usage,
        elapsedMs: Date.now() - requestStartedAt,
      });
      const contextLimit = selection.model.context.input;
      if (
        contextLimit
        && lastInputTokens / contextLimit > tuning.automaticCompactionThreshold
      ) {
        this.emit(conversationId, { type: 'run-state', running: true });
        try {
          await this.compress({
            conversationId,
            model,
            automatic: true,
            controller,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logChatTiming(conversationId, {
            phase: 'context-compaction-error',
            model: selection.model.modelId,
            error: message,
          });
          if (!controller.signal.aborted) {
            this.emit(conversationId, {
              type: 'error',
              message: `Automatic context compaction failed: ${message}`,
            });
          }
        }
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      if (waitingForMcp) {
        waitingForMcp = false;
        this.emit(conversationId, { type: 'mcp-waiting', waiting: false });
      }
      if (!aborted && !accumulator.error) {
        accumulator.apply({
          type: 'error',
          code: 'provider_error',
          message,
        });
      }
      accumulator.finish();
      persistAssistant({
        status: aborted ? 'aborted' : 'error',
        force: true,
      });
      if (userMessageId && (!aborted || getMessage(userMessageId)?.status === 'waiting_mcp')) {
        const failedUserMessage = updateMessage(userMessageId, {
          status: aborted ? 'aborted' : 'error',
        });
        if (failedUserMessage) {
          this.emit(conversationId, { type: 'message', message: failedUserMessage });
        }
      }
      if (!aborted) {
        this.logChatTiming(conversationId, {
          phase: 'request-error',
          assistantMessageId: assistantMessage.id,
          model,
          elapsedMs: Date.now() - requestStartedAt,
          error: message,
        });
        this.emit(conversationId, { type: 'error', message });
      }
    } finally {
      try {
        this.finishRun(conversationId);
      } finally {
        completion.resolve();
      }
    }
  }

  async askQuestion({ conversationId, questions, signal }) {
    const run = this.runs.get(conversationId);
    if (!run || run.controller.signal !== signal) {
      throw new Error('The active run is no longer available.');
    }
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error('The question was cancelled.');
    }

    const questionId = randomUUID();
    run.phase = 'question';
    return new Promise((resolveQuestion, rejectQuestion) => {
      const abortQuestion = () => {
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
      this.pendingQuestions.set(questionId, {
        conversationId,
        questions,
        finish: (result) => {
          signal.removeEventListener('abort', abortQuestion);
          if (this.runs.get(conversationId) === run) {
            run.phase = 'tool';
          }
          resolveQuestion(result);
        },
      });
      signal.addEventListener('abort', abortQuestion, { once: true });
      this.emit(conversationId, {
        type: 'question-request',
        questionId,
        questions,
      });
    });
  }

  answerQuestion({ questionId, cancelled = false, answers = [] }) {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending) return false;

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
          || answer.answer.some((option) => !question.options.includes(option))
        ) {
          throw new Error(`Answer ${index + 1} must contain selected options.`);
        }
        return {
          question: question.question,
          answer: [...new Set(answer.answer)],
        };
      }
      const value = typeof answer.answer === 'string' ? answer.answer.trim() : '';
      if (
        !value
        || (question.type === 'single_choice' && !question.options.includes(value))
      ) {
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
  }

  async resolveApproval({ approvalId, decision }) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || !['allow', 'allow_all', 'disallow'].includes(decision)) return false;

    if (decision === 'allow_all') {
      await this.savePermissionGuidance?.({
        workspacePath: pending.workspacePath,
        invocationSummary: pending.invocationSummary,
      });
      this.approvedToolPatterns.add(pending.approvalPattern);
    }
    this.pendingApprovals.delete(approvalId);
    pending.finish(decision !== 'disallow');
    return true;
  }

  shouldEndAtBoundary(run) {
    if (run.steerRequested && !run.controller.signal.aborted) {
      run.controller.abort('steer');
    }
    return run.controller.signal.aborted;
  }

  continueGoal(goal, reason = 'continue') {
    if (!goal || goal.status !== 'active' || this.runs.has(goal.conversationId)) return false;
    const queuedItems = this.getQueuedItems(goal.conversationId, goal.model);
    const queuedGoalIndex = queuedItems.findIndex((item) => item.goalId === goal.id);
    const queuedGoalMessage = queuedGoalIndex >= 0
      ? queuedItems.splice(queuedGoalIndex, 1)[0]
      : null;
    const userMessage = queuedGoalMessage
      ? updateMessage(queuedGoalMessage.userMessageId, { status: 'sent' })
      : this.createUserMessage({
          conversationId: goal.conversationId,
          model: goal.model,
          reasoningEffort: goal.reasoningEffort,
          workMode: 'goal',
          goalId: goal.id,
          hidden: true,
          text: [
            `<goal_continuation goal_id="${goal.id}" revision="${goal.revision}" reason="${reason}">`,
            'Continue working on the active Goal from the current state. Re-check the specification and acceptance terms, perform the next necessary work, and verify results honestly. Do not repeat completed work.',
            '</goal_continuation>',
          ].join('\n'),
          attachments: [],
          status: 'sent',
        });
    this.emit(goal.conversationId, { type: 'message', message: userMessage });
    this.emit(goal.conversationId, {
      type: 'queue-order',
      messageIds: queuedItems.map((item) => item.userMessageId),
    });
    this.start({
      conversationId: goal.conversationId,
      model: queuedGoalMessage?.model ?? goal.model,
      userMessageId: userMessage.id,
      queue: queuedItems,
      reasoningEffort: queuedGoalMessage?.reasoningEffort ?? goal.reasoningEffort,
      permissionMode: goal.permissionMode,
      workMode: 'goal',
      goalId: goal.id,
    });
    return true;
  }

  finishRun(conversationId) {
    const current = this.runs.get(conversationId);
    this.runs.delete(conversationId);
    let pendingQueue = current?.queue ?? [];
    const runGoal = current?.goalId ? getGoal(current.goalId) : null;
    if (runGoal && TERMINAL_GOAL_STATUSES.has(runGoal.status)) {
      const cancelledItems = pendingQueue.filter((item) => item.goalId === runGoal.id);
      pendingQueue = pendingQueue.filter((item) => item.goalId !== runGoal.id);
      for (const item of cancelledItems) {
        deleteMessage(item.userMessageId);
        this.emit(conversationId, { type: 'message-delete', messageId: item.userMessageId });
      }
    }
    const next = pendingQueue.shift();
    if (!next) {
      const continuingGoal = current?.kind === 'chat'
        ? current.goalId
          ? getGoal(current.goalId)
          : getGoalForConversation(conversationId)
        : null;
      if (continuingGoal?.status === 'active' && this.continueGoal(continuingGoal)) return;
      this.emit(conversationId, { type: 'run-state', running: false });
      return;
    }

    this.emit(conversationId, {
      type: 'queue-order',
      messageIds: pendingQueue.map((item) => item.userMessageId),
    });
    const workspacePath = getConversation(conversationId)?.projectPath;
    const nextMessage = updateMessage(next.userMessageId, {
      status: next.workMode === 'plan'
        || !this.mcpManager
        || this.mcpManager.isWorkspaceReady(workspacePath)
        ? 'sent'
        : 'waiting_mcp',
    });
    this.emit(conversationId, { type: 'message', message: nextMessage });
    this.start({
      conversationId,
      model: next.model,
      userMessageId: next.userMessageId,
      queue: pendingQueue,
      reasoningEffort: next.reasoningEffort,
      permissionMode: next.permissionMode,
      workMode: next.workMode,
      goalId: next.goalId,
    });
  }

  logChatTiming(conversationId, details) {
    console.log('[chat timing]', {
      conversationId,
      ...details,
    });
  }

  logStreamEvent(conversationId, event) {
    if (!this.debugStream) return;
    console.log('[chat stream]', {
      conversationId,
      type: event.type,
      textLength: event.text?.length ?? 0,
      usage: event.usage ?? null,
      code: event.code ?? null,
    });
  }

  emit(conversationId, payload) {
    this.sendEvent({ conversationId, ...payload });
  }

  emitConversation(conversationId) {
    this.emit(conversationId, {
      type: 'conversation',
      conversation: getConversation(conversationId),
    });
  }
}
