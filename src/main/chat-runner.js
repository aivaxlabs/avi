import { randomUUID } from 'node:crypto';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';
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
  listAllConversations,
  listContinuingGoals,
  listSubagents,
  setLastModel,
  toModelMessages,
  toModelMessagesThroughUser,
  updateConversation,
  updateGoal as updateGoalRecord,
  updateMessage,
  updateQueuedMessageOrder,
} from './database.js';
import { CLIENT_TOOLS } from './client-tools.js';
import { applySubagentModelSchema } from './default-models.js';
import { normalizeAttachmentsForModel } from './files.js';
import { StreamAccumulator } from './streaming.js';
import {
  traceError,
  traceVerbose,
} from './trace-log.js';

const CONTINUING_GOAL_STATUSES = new Set(['active', 'paused']);
const TERMINAL_GOAL_STATUSES = new Set(['completed', 'blocked', 'cancelled']);
const STREAM_PERSIST_INTERVAL_MS = 120;
const STREAM_RENDER_INTERVAL_MS = 240;
const RECENT_ASSISTANT_TURN_COUNT = 4;
const OLDER_TOOL_OUTPUT_LIMIT_RATIO = 0.8;
const INSPECT_THREAD_TOOL_OUTPUT_LIMIT_RATIO = 0.2;
const PLAN_TOOL_NAMES = new Set([
  'ask_question',
  'chat_inspect_thread',
  'chat_list_folders',
  'chat_list_threads',
  'chat_send_prompt',
  'chat_spawn_subagent',
  'read_file',
  'read_terminal_output',
  'read_url',
]);
const COMPACTION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a self-contained handoff checkpoint for another LLM that will resume this exact task. The checkpoint becomes the sole conversation history; no earlier messages, in-flight assistant content, tool calls, or tool results will remain available. Preserve all critical information from the supplied context while using substantially fewer tokens. Do not continue the task itself.

Include:
- The user's original objective and the current objective, including how the request evolved
- Relevant in-flight assistant work, tool calls, and tool results
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

function truncateToolOutput(output, limit) {
  if (limit === null) return output;

  let source = output;
  try {
    const parsed = JSON.parse(output);
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && parsed.truncated === true
      && typeof parsed.output === 'string'
      && Object.keys(parsed).every((key) => ['output', 'truncated'].includes(key))
    ) {
      source = parsed.output;
    }
  } catch {}

  return source.length > limit
    ? JSON.stringify({
        output: source.slice(0, limit),
        truncated: true,
      })
    : output;
}

function limitToolHistoryResults(toolHistory, toolOutputLimit) {
  if (toolOutputLimit === null) return toolHistory;

  const fullLimitStartIndex = Math.max(
    0,
    toolHistory.length - (RECENT_ASSISTANT_TURN_COUNT - 1),
  );
  const olderLimit = Math.floor(toolOutputLimit * OLDER_TOOL_OUTPUT_LIMIT_RATIO);

  return toolHistory.map((round, roundIndex) => ({
    ...round,
    results: round.results.map((result) => {
      const toolName = round.toolCalls.find((toolCall) => (
        toolCall.callId === result.callId
      ))?.name;
      return {
        ...result,
        output: truncateToolOutput(
          result.output,
          toolName === 'chat_inspect_thread'
            ? Math.floor(toolOutputLimit * INSPECT_THREAD_TOOL_OUTPUT_LIMIT_RATIO)
            : roundIndex < fullLimitStartIndex ? olderLimit : toolOutputLimit,
        ),
      };
    }),
  }));
}

function traceContext(conversationId, selection, details = {}) {
  const conversation = getConversation(conversationId);
  return {
    thread_id: conversationId,
    parent_thread_id: conversation?.parentConversationId,
    side_chat: conversation?.isSideChat,
    subagent: conversation?.isSubagent,
    provider_id: selection?.model.providerId,
    provider: selection?.model.providerName,
    model: selection?.model.modelId,
    interface: selection?.model.interface,
    ...details,
  };
}

export class ChatRunner {
  constructor({
    registry,
    mcpManager,
    getPreferences = readPreferences,
    sendEvent,
    savePermissionGuidance,
    stopBackgroundTasks,
  }) {
    this.registry = registry;
    this.mcpManager = mcpManager;
    this.getPreferences = getPreferences;
    this.sendEvent = sendEvent;
    this.savePermissionGuidance = savePermissionGuidance;
    this.stopBackgroundTasks = stopBackgroundTasks;
    this.runs = new Map();
    this.pausedQueues = new Map();
    this.pendingApprovals = new Map();
    this.pendingQuestions = new Map();
    this.approvedToolPatterns = new Set();
  }

  async forwardSubagentResult(message) {
    const subagent = message ? getConversation(message.conversationId) : null;
    if (
      !subagent?.isSubagent
      || !subagent.autoForwardToParent
      || !subagent.parentConversationId
      || !['completed', 'error'].includes(message.status)
    ) return;

    const parent = getConversation(subagent.parentConversationId);
    if (!parent) return;

    const sourceMessageMarker = `source_message_id="${message.id}"`;
    if (getMessages(parent.id).some((item) => item.content.includes(sourceMessageMarker))) return;

    const error = message.segments.findLast((segment) => segment.type === 'error');
    const content = answerTextFromTextualBlocks(message.content)
      || error?.message
      || `Sub-agent task ended with status "${message.status}".`;
    const activeGoal = parent.goal && CONTINUING_GOAL_STATUSES.has(parent.goal.status)
      ? parent.goal
      : null;

    try {
      await this.send({
        conversationId: parent.id,
        model: parent.model,
        text: [
          `<subagent_report thread_id="${subagent.id}" title="${subagent.title.replaceAll('"', '&quot;')}" source_message_id="${message.id}" status="${message.status}">`,
          content,
          '</subagent_report>',
        ].join('\n'),
        steer: true,
        workMode: activeGoal ? 'goal' : subagent.orchestrationMode === 'plan' ? 'plan' : null,
        goalId: activeGoal?.id,
        ultraMode: parent.orchestrationMode === 'ultra',
        project: { path: parent.projectPath },
      });
    } catch (forwardError) {
      traceError('subagent.result-forward-error', {
        thread_id: subagent.id,
        parent_thread_id: parent.id,
        message_id: message.id,
        status: message.status,
        error: forwardError instanceof Error ? forwardError.message : String(forwardError),
      });
    }
  }

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
      ultraMode,
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
    ultraMode = false,
    goalId = null,
    hidden = false,
    queuePriority = false,
    project = {},
  }) {
    workMode = ['plan', 'goal'].includes(workMode) ? workMode : null;
    ultraMode = Boolean(ultraMode);
    if (workMode === 'plan' && ultraMode) {
      throw new Error('Ultra mode cannot be used with Plan mode.');
    }
    const selectedModel = this.registry.resolve(model);
    if (!selectedModel) {
      throw new Error('The selected model is no longer configured. Choose another model in Settings.');
    }
    attachments = await normalizeAttachmentsForModel(
      attachments,
      selectedModel.model.capabilities,
    );
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
        permissionMode,
        workMode,
        ultraMode,
        goalId,
        hidden,
        queuePriority,
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
          ultraMode,
          ...(goalId ? { goalId } : {}),
          queuePriority,
        });
        this.requestSteer(conversation.id);
      } else {
        const item = {
          userMessageId: queued.id,
          model,
          reasoningEffort,
          permissionMode,
          workMode,
          ultraMode,
          ...(goalId ? { goalId } : {}),
          queuePriority,
        };
        if (queuePriority) {
          const insertionIndex = run.queue.findIndex((queuedItem) => !queuedItem.queuePriority);
          run.queue.splice(insertionIndex < 0 ? run.queue.length : insertionIndex, 0, item);
        } else {
          run.queue.push(item);
        }
      }
      this.emit(conversation.id, { type: 'message', message: queued });
      const queueOrder = run.queue.map((item) => item.userMessageId);
      updateQueuedMessageOrder(conversation.id, queueOrder);
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
      permissionMode,
      workMode,
      ultraMode,
      goalId,
      hidden,
      queuePriority,
      text,
      attachments,
      status: workMode === 'plan'
        || !this.mcpManager
        || this.mcpManager.isWorkspaceReady(conversation.projectPath)
        ? 'sent'
        : 'waiting_mcp',
    });
    this.emit(conversation.id, { type: 'message', message: userMessage });
    const queue = this.getQueuedItems(conversation.id, model);
    this.pausedQueues.delete(conversation.id);
    this.start({
      conversationId: conversation.id,
      model,
      userMessageId: userMessage.id,
      queue,
      reasoningEffort,
      permissionMode,
      workMode,
      ultraMode,
      goalId,
    });
    return { conversation: getConversation(conversation.id), message: userMessage, queued: false };
  }

  stop(conversationId, { includeSubagents = false, pauseGoal = true } = {}) {
    const conversationIds = [
      conversationId,
      ...(includeSubagents
        ? listSubagents(conversationId).map((subagent) => subagent.id)
        : []),
    ];
    for (const id of conversationIds) {
      const run = this.runs.get(id);
      if (run) {
        const goal = pauseGoal ? getGoalForConversation(id) : null;
        if (goal?.status === 'active') {
          const now = new Date();
          updateGoalRecord({
            ...goal,
            status: 'paused',
            activeElapsedMs: goal.activeElapsedMs + (
              goal.resumedAt
                ? Math.max(0, now.getTime() - new Date(goal.resumedAt).getTime())
                : 0
            ),
            resumedAt: null,
            updatedAt: now.toISOString(),
          });
          this.emitConversation(id);
        }
        run.queuePaused = true;
        this.pausedQueues.set(id, [...run.queue]);
        run.controller.abort('stop');
      }
      this.stopBackgroundTasks?.(id);
    }
  }

  async shutdown() {
    const activeRuns = [...this.runs.entries()];
    for (const [conversationId] of activeRuns) {
      this.stop(conversationId, { pauseGoal: false });
    }
    await Promise.allSettled(activeRuns.map(([, run]) => run.completion));
  }

  requestSteer(conversationId) {
    const run = this.runs.get(conversationId);
    if (!run) return false;
    run.steerRequested = true;
    if (['approval', 'question', 'boundary'].includes(run.phase)) {
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
        requestedIds.length !== queuedItems.length
        || requestedIds.some((messageId) => !queuedById.has(messageId))
        || (steerMessageId && !queuedById.has(steerMessageId))
      ) {
        return {
          reordered: false,
          queueOrder: queuedItems.map((item) => item.userMessageId),
        };
      }

      const orderedQueue = requestedIds.map((messageId) => queuedById.get(messageId));
      if (!steerMessageId) {
        this.pausedQueues.set(conversationId, orderedQueue);
        updateQueuedMessageOrder(conversationId, requestedIds);
        this.emit(conversationId, {
          type: 'queue-order',
          messageIds: requestedIds,
        });
        return {
          reordered: true,
          steered: false,
          queueOrder: requestedIds,
        };
      }

      const next = orderedQueue.shift();
      this.pausedQueues.delete(conversationId);
      updateQueuedMessageOrder(
        conversationId,
        orderedQueue.map((item) => item.userMessageId),
      );
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
        ultraMode: next.ultraMode,
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
    updateQueuedMessageOrder(conversationId, requestedIds);
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
    const selectedModel = this.registry.resolve(model);
    if (!selectedModel) {
      throw new Error('The selected model is no longer configured. Choose another model in Settings.');
    }
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
        {
          includeFailedUser: true,
          capabilities: selectedModel.model.capabilities,
        },
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
        ultraMode: sourceUser.ultraMode,
        goalId: sourceUser.goalId,
      });
      return {
        conversation: getConversation(conversation.id),
        message: getMessage(failedAssistant.id),
        queued: false,
      };
    }

    const messages = toModelMessagesThroughUser(
      conversation.id,
      assistantMessageId,
      { capabilities: selectedModel.model.capabilities },
    );
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
      ultraMode: sourceUser?.ultraMode,
      goalId: sourceUser?.goalId,
    });

    return { conversation: getConversation(conversation.id), message: null, queued: false };
  }

  async compress({
    conversationId,
    model,
    automatic = false,
    controller: activeController = null,
    contextMessages = null,
    contextToolHistory = [],
    streamingSegments = [],
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

    const messages = contextMessages ?? toModelMessages(conversation.id, {
      capabilities: selection.model.capabilities,
    });
    if (
      messages.length === 0
      && contextToolHistory.length === 0
      && streamingSegments.length === 0
    ) return conversation;

    const checkpointMessage = getMessages(conversation.id)
      .filter((message) => ['completed', 'sent', 'aborted'].includes(message.status))
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .at(-1);
    if (!checkpointMessage) return conversation;

    const limitedToolHistory = limitToolHistoryResults(
      contextToolHistory,
      this.getPreferences().tuning.toolOutputLimit,
    );
    const inFlightContext = limitedToolHistory.length > 0 || streamingSegments.length > 0
      ? [{
          role: 'assistant',
          content: [
            '<in_flight_context>',
            JSON.stringify({
              toolHistory: limitedToolHistory,
              streamingSegments,
            }),
            '</in_flight_context>',
          ].join('\n'),
        }]
      : [];
    const compressionMessages = [
      ...messages,
      ...inFlightContext,
      { role: 'user', content: COMPACTION_PROMPT },
    ];
    const compressionSegment = {
      type: 'context-compression',
      inputTokens: Math.ceil(JSON.stringify(compressionMessages).length / 4),
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
        messages: compressionMessages,
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
          inputTokens: compressionUsage?.inputTokens ?? compressionSegment.inputTokens,
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
    const persistedItems = getMessages(conversationId)
      .filter((message) => ['queued', 'steered'].includes(message.status))
      .map((message) => ({
        userMessageId: message.id,
        model: message.model || fallbackModel,
        reasoningEffort: message.reasoningEffort,
        permissionMode: message.permissionMode ?? 'approve_for_me',
        workMode: message.workMode,
        ultraMode: message.ultraMode,
        ...(message.goalId ? { goalId: message.goalId } : {}),
        queuePriority: message.queuePriority,
        queuePosition: message.queuePosition,
      }))
      .sort((left, right) => {
        if (left.queuePosition !== null && right.queuePosition !== null) {
          return left.queuePosition - right.queuePosition;
        }
        if (left.queuePosition !== null) return -1;
        if (right.queuePosition !== null) return 1;
        return Number(right.queuePriority) - Number(left.queuePriority);
      });
    const pausedQueue = this.pausedQueues.get(conversationId);
    if (!pausedQueue) return persistedItems;

    const persistedById = new Map(
      persistedItems.map((item) => [item.userMessageId, item]),
    );
    const pausedIds = new Set(pausedQueue.map((item) => item.userMessageId));
    return [
      ...pausedQueue
        .filter((item) => persistedById.has(item.userMessageId))
        .map((item) => ({
          ...persistedById.get(item.userMessageId),
          permissionMode: item.permissionMode,
        })),
      ...persistedItems.filter((item) => !pausedIds.has(item.userMessageId)),
    ];
  }

  createUserMessage({
    conversationId,
    model,
    reasoningEffort,
    permissionMode,
    workMode,
    ultraMode = false,
    goalId = null,
    hidden = false,
    queuePriority = false,
    text,
    attachments,
    status,
  }) {
    const message = insertMessage({
      conversationId,
      role: 'user',
      model,
      reasoningEffort,
      permissionMode,
      workMode,
      ultraMode,
      goalId,
      hidden,
      queuePriority,
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
    userMessageIds = userMessageId ? [userMessageId] : [],
    queue = [],
    retryMessages = null,
    initialToolHistory = [],
    resumeAssistantMessageId = null,
    initialSegments = [],
    initialUsage = null,
    reasoningEffort = null,
    permissionMode = 'approve_for_me',
    workMode = null,
    ultraMode = false,
    goalId = null,
  }) {
    workMode = ['plan', 'goal'].includes(workMode) ? workMode : null;
    ultraMode = Boolean(ultraMode);
    if (workMode === 'plan' && ultraMode) {
      throw new Error('Ultra mode cannot be used with Plan mode.');
    }
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
          ultraMode,
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
      ultraMode,
      goalId,
      kind: 'chat',
      phase: 'mcp',
      steerRequested: false,
      userMessageIds,
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
    this.logChatTiming(conversationId, null, {
      phase: 'request-start',
      assistantMessageId: assistantMessage.id,
      model,
    });

    let waitingForMcp = false;
    let traceSelection = null;
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
      traceSelection = selection;

      let messages = retryMessages
        ?? toModelMessages(conversationId, {
          excludeMessageId: assistantMessage.id,
          capabilities: selection.model.capabilities,
        });
      const models = this.registry.listModels();
      const currentConversation = getConversation(conversationId);
      const currentGoal = goalId ? getGoal(goalId) : getGoalForConversation(conversationId);
      const goalContinues = currentGoal && CONTINUING_GOAL_STATUSES.has(currentGoal.status);
      const tuning = this.getPreferences().tuning;
      const contextLimit = selection.model.context.input;
      const providerTools = workMode === 'plan'
        ? []
        : selection.provider.getContributions({
            model: selection.model,
            conversation: currentConversation,
            workspacePath,
          }).tools;
      const availableTools = [
        ...CLIENT_TOOLS
          .filter((tool) => (
            tool.name !== 'read_media_file'
            || selection.model.capabilities?.images
            || selection.model.capabilities?.audio
            || selection.model.capabilities?.pdfFiles
          ))
          .filter((tool) => workMode !== 'plan' || PLAN_TOOL_NAMES.has(tool.name))
          .filter((tool) => tool.name !== 'start_goal' || !goalContinues)
          .filter((tool) => tool.name !== 'update_goal_status' || goalContinues)
          .filter((tool) => (
            tool.name !== 'chat_spawn_subagent'
            || (!currentConversation?.isSubagent && !currentConversation?.isSideChat)
          ))
          .map((tool) => {
            if (tool.name === 'read_media_file') {
              const supportedMedia = [
                selection.model.capabilities?.images && 'images',
                selection.model.capabilities?.audio && 'MP3 audio',
                selection.model.capabilities?.pdfFiles && 'PDF files',
              ].filter(Boolean);
              return {
                ...tool,
                description: `Read local ${supportedMedia.join(', ')} using the selected model multimodally. Text files are not supported.`,
              };
            }
            if (['chat_create_thread', 'chat_spawn_subagent'].includes(tool.name)) {
              return {
                ...tool,
                inputSchema: applySubagentModelSchema(
                  tool,
                  models,
                  this.getPreferences().defaultModels,
                ),
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
      let liveContextTokens = currentConversation?.contextTokens ?? 0;
      let finalAssistantContent = '';
      let firstResponseAt = null;
      let retriedAfterContextCompaction = false;
      let contextCompactionRequested = false;
      const applyCompactionCheckpoint = (compressedConversation) => {
        toolHistory.length = 0;
        accumulator.segments = [];
        accumulator.usage = null;
        accumulator.error = null;
        accumulator.nextSequence = 1;
        liveContextTokens = compressedConversation.contextTokens;
        contextCompactionRequested = false;
        persistAssistant({ force: true });
        messages = toModelMessages(conversationId, {
          excludeMessageId: assistantMessage.id,
          capabilities: selection.model.capabilities,
        });
      };
      this.logChatTiming(conversationId, selection, {
        phase: 'request-ready',
        assistantMessageId: assistantMessage.id,
        providerId: selection.model.providerId,
        provider: selection.model.providerName,
        interface: selection.model.interface,
        model: selection.model.modelId,
        messages: messages.length,
        elapsedMs: Date.now() - requestStartedAt,
      });

      while (true) {
        const roundIndex = toolHistory.length;
        const roundSegmentStart = accumulator.segments.length;
        const latestGoal = goalId ? getGoal(goalId) : getGoalForConversation(conversationId);
        const goalContext = latestGoal && CONTINUING_GOAL_STATUSES.has(latestGoal.status)
          ? latestGoal
          : null;
        const subagentParentId = currentConversation?.isSubagent
          ? currentConversation.parentConversationId
          : currentConversation?.isSideChat
            ? null
            : currentConversation?.id;
        const visibleConversations = listAllConversations()
          .filter((conversation) => currentConversation?.isSideChat || !conversation.isSideChat);
        const threadContext = visibleConversations.map((conversation) => {
          const threadMessages = getMessages(conversation.id);
          const lastUserIndex = threadMessages
            .findLastIndex((message) => message.role === 'user');
          const lastAssistant = threadMessages
            .slice(lastUserIndex + 1)
            .findLast((message) => message.role === 'assistant');
          return {
            threadId: conversation.id,
            role: conversation.isSideChat
              ? 'side_chat'
              : conversation.isSubagent
                ? 'subagent'
                : 'orchestrator',
            parentThreadId: conversation.parentConversationId,
            initialPrompt: conversation.initialPrompt ?? conversation.firstPrompt,
            status: this.runs.has(conversation.id)
              ? 'in_progress'
              : lastAssistant?.status === 'completed'
                ? 'completed'
                : conversation.isSubagent
                  ? 'failed'
                  : 'idle',
          };
        });
        const subagentContext = subagentParentId
          ? listSubagents(subagentParentId)
            .map((subagent) => threadContext.find((thread) => thread.threadId === subagent.id))
            .filter(Boolean)
          : [];
        run.phase = 'inference';
        let turn;
        try {
          turn = await selection.provider.stream({
            model: selection.model,
            messages,
            tools: availableTools,
            toolHistory: limitToolHistoryResults(toolHistory, tuning.toolOutputLimit),
            reasoningEffort,
            invocationContext: {
              conversationId,
              workspacePath,
              mcpInstructions: mcpRuntime.instructions,
              permissionMode,
              workMode,
              ultraMode,
              orchestrationRole: currentConversation?.isSubagent
                ? 'subagent'
                : currentConversation?.isSideChat
                  ? 'side_chat'
                  : 'orchestrator',
              goal: goalContext,
              subagents: subagentContext,
              currentThread: {
                threadId: currentConversation?.id ?? conversationId,
                role: currentConversation?.isSideChat
                  ? 'side_chat'
                  : currentConversation?.isSubagent
                    ? 'subagent'
                    : 'orchestrator',
                parentThreadId: currentConversation?.parentConversationId ?? null,
              },
              threads: threadContext,
              tuning,
            },
            signal: controller.signal,
            onEvent: (event) => {
              if (['content', 'reasoning', 'tool-call'].includes(event.type)) {
                run.phase = 'inference';
                if (firstResponseAt === null) firstResponseAt = Date.now();
              }
              if (event.type === 'usage') {
                liveContextTokens = (
                  event.usage.inputTokens ?? liveContextTokens
                ) + (event.usage.outputTokens ?? 0);
                const updatedConversation = updateConversation(conversationId, {
                  contextTokens: liveContextTokens,
                });
                this.emit(conversationId, {
                  type: 'conversation',
                  conversation: updatedConversation,
                });
                contextCompactionRequested = Boolean(
                  contextLimit
                  && liveContextTokens / contextLimit > tuning.automaticCompactionThreshold,
                );
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
              if (event.type === 'error') {
                traceError('api.stream-error', traceContext(
                  conversationId,
                  selection,
                  {
                    round: roundIndex,
                    status: event.status,
                    code: event.code,
                    error: event.message,
                  },
                ));
              } else if (event.type === 'retry') {
                traceVerbose('api.retry', traceContext(
                  conversationId,
                  selection,
                  {
                    round: roundIndex,
                    attempt: event.attempt,
                    code: event.code,
                    error: event.message,
                  },
                ));
              }
              persistAssistant({
                force: ['usage', 'error', 'retry', 'retry-clear', 'item-complete']
                  .includes(event.type),
              });
              if (event.type === 'item-complete') {
                run.phase = 'boundary';
                if (this.shouldEndAtBoundary(run)) {
                  throw new Error('The run was interrupted.');
                }
              }
            },
          });
          retriedAfterContextCompaction = false;
        } catch (error) {
          const errorText = `${error?.code ?? ''} ${
            error instanceof Error ? error.message : String(error)
          }`.toLowerCase();
          const isContextLengthError = error?.status >= 400
            && error.status <= 499
            && errorText.includes('context')
            && errorText.includes('length');
          if (!isContextLengthError || retriedAfterContextCompaction) throw error;

          const errorSegmentIndex = accumulator.segments.findLastIndex(
            (segment) => segment.type === 'error'
              && errorText.includes(String(segment.code ?? '').toLowerCase())
              && errorText.includes(String(segment.message ?? '').toLowerCase()),
          );
          if (errorSegmentIndex >= 0) accumulator.segments.splice(errorSegmentIndex, 1);
          accumulator.error = null;
          persistAssistant({ force: true });
          const compressedConversation = await this.compress({
            conversationId,
            model,
            automatic: true,
            controller,
            contextMessages: messages,
            contextToolHistory: toolHistory,
            streamingSegments: accumulator.segments.slice(roundSegmentStart),
          });
          retriedAfterContextCompaction = true;
          applyCompactionCheckpoint(compressedConversation);
          continue;
        }
        run.phase = 'boundary';
        if (this.shouldEndAtBoundary(run)) throw new Error('The run was interrupted.');
        if (turn.toolCalls.length === 0) {
          finalAssistantContent = turn.assistantContent;
          break;
        }

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
          let mediaContent;
          let isError = false;
          let toolError = null;
          let toolStartedAt = null;
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
            toolStartedAt = Date.now();
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
              ultraMode,
              goal: goalContext,
              tuning,
              defaultModels: this.getPreferences().defaultModels,
              capabilities: selection.model.capabilities,
            });
            if (
              value
              && typeof value === 'object'
              && typeof value.output === 'string'
              && Array.isArray(value.mediaContent)
            ) {
              output = value.output;
              mediaContent = value.mediaContent;
            } else {
              output = typeof value === 'string' ? value : JSON.stringify(value);
            }
          } catch (error) {
            isError = true;
            toolError = error instanceof Error ? error.message : String(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            output = toolCall.name === 'ask_question'
              ? `Error: ${errorMessage}\nNo user answer was collected. Correct the arguments and call ask_question again. Do not infer an answer.`
              : `Error: ${errorMessage}`;
          }
          const toolDetails = traceContext(conversationId, selection, {
            round: roundIndex,
            tool: toolCall.name,
            tool_type: isMcpTool ? 'mcp' : 'application',
            duration_ms: toolStartedAt === null ? null : Date.now() - toolStartedAt,
          });
          if (toolError) {
            traceError('tool.error', { ...toolDetails, error: toolError });
          } else {
            traceVerbose('tool.completed', toolDetails);
          }

          output = truncateToolOutput(
            output,
            toolCall.name === 'chat_inspect_thread' && tuning.toolOutputLimit !== null
              ? Math.floor(
                  tuning.toolOutputLimit * INSPECT_THREAD_TOOL_OUTPUT_LIMIT_RATIO,
                )
              : tuning.toolOutputLimit,
          );
          results.push({
            callId: toolCall.callId,
            output,
            ...(mediaContent?.length ? { mediaContent } : {}),
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
        if (contextCompactionRequested) {
          this.emit(conversationId, { type: 'run-state', running: true });
          try {
            const compressedConversation = await this.compress({
              conversationId,
              model,
              automatic: true,
              controller,
              contextMessages: messages,
              contextToolHistory: toolHistory,
            });
            applyCompactionCheckpoint(compressedConversation);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logChatTiming(conversationId, selection, {
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
      const completedMessage = persistAssistant({ status: 'completed', force: true });
      await this.forwardSubagentResult(completedMessage);
      this.logChatTiming(conversationId, selection, {
        phase: 'message-completed',
        assistantMessageId: assistantMessage.id,
        model: selection.model.modelId,
        usage: accumulator.usage,
        elapsedMs: Date.now() - requestStartedAt,
      });
      if (contextCompactionRequested) {
        this.emit(conversationId, { type: 'run-state', running: true });
        try {
          await this.compress({
            conversationId,
            model,
            automatic: true,
            controller,
            contextMessages: [
              ...messages,
              ...(finalAssistantContent
                ? [{ role: 'assistant', content: finalAssistantContent }]
                : []),
            ],
            contextToolHistory: toolHistory,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logChatTiming(conversationId, selection, {
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
      const failedAssistantMessage = persistAssistant({
        status: aborted ? 'aborted' : 'error',
        force: true,
      });
      await this.forwardSubagentResult(failedAssistantMessage);
      for (const failedUserMessageId of run.userMessageIds) {
        if (aborted && getMessage(failedUserMessageId)?.status !== 'waiting_mcp') continue;
        const failedUserMessage = updateMessage(failedUserMessageId, {
          status: aborted ? 'aborted' : 'error',
        });
        if (failedUserMessage) {
          this.emit(conversationId, { type: 'message', message: failedUserMessage });
        }
      }
      if (!aborted) {
        run.queuePaused = true;
        this.logChatTiming(conversationId, traceSelection, {
          phase: 'request-error',
          assistantMessageId: assistantMessage.id,
          model,
          elapsedMs: Date.now() - requestStartedAt,
          status: error?.status,
          code: error?.code,
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

  isUltraGoal(conversationId, goalId) {
    const run = this.runs.get(conversationId);
    if (run?.goalId === goalId) return run.ultraMode;
    return getMessages(conversationId)
      .findLast((message) => message.goalId === goalId)
      ?.ultraMode ?? false;
  }

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
      ? updateMessage(queuedGoalMessage.userMessageId, { status: 'sent' })
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
      ultraMode,
      goalId: goal.id,
    });
    return true;
  }

  finishRun(conversationId) {
    const current = this.runs.get(conversationId);
    this.runs.delete(conversationId);
    if (current?.queuePaused) {
      this.pausedQueues.set(conversationId, [...current.queue]);
      this.emit(conversationId, {
        type: 'queue-order',
        messageIds: current.queue.map((item) => item.userMessageId),
      });
      this.emit(conversationId, { type: 'run-state', running: false });
      return;
    }

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
    const allSteeredItems = pendingQueue.filter((item) => (
      getMessage(item.userMessageId)?.status === 'steered'
    ));
    const firstSteeredItem = allSteeredItems[0];
    const steeredItems = firstSteeredItem
      ? allSteeredItems.filter((item) => (
          item.model === firstSteeredItem.model
          && item.reasoningEffort === firstSteeredItem.reasoningEffort
          && item.permissionMode === firstSteeredItem.permissionMode
          && item.workMode === firstSteeredItem.workMode
          && item.ultraMode === firstSteeredItem.ultraMode
          && item.goalId === firstSteeredItem.goalId
        ))
      : [];
    const next = steeredItems[0] ?? pendingQueue[0];
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

    const dispatchedItems = steeredItems.length > 0 ? steeredItems : [next];
    const dispatchedIds = new Set(dispatchedItems.map((item) => item.userMessageId));
    pendingQueue = pendingQueue.filter((item) => !dispatchedIds.has(item.userMessageId));
    const pendingMessageIds = pendingQueue.map((item) => item.userMessageId);
    updateQueuedMessageOrder(conversationId, pendingMessageIds);
    this.emit(conversationId, {
      type: 'queue-order',
      messageIds: pendingMessageIds,
    });
    const workspacePath = getConversation(conversationId)?.projectPath;
    for (const item of dispatchedItems) {
      const nextMessage = updateMessage(item.userMessageId, {
        status: item.workMode === 'plan'
          || !this.mcpManager
          || this.mcpManager.isWorkspaceReady(workspacePath)
          ? 'sent'
          : 'waiting_mcp',
      });
      this.emit(conversationId, { type: 'message', message: nextMessage });
    }
    this.start({
      conversationId,
      model: next.model,
      userMessageId: next.userMessageId,
      userMessageIds: dispatchedItems.map((item) => item.userMessageId),
      queue: pendingQueue,
      reasoningEffort: next.reasoningEffort,
      permissionMode: next.permissionMode,
      workMode: next.workMode,
      ultraMode: next.ultraMode,
      goalId: next.goalId,
    });
  }

  logChatTiming(conversationId, selection, details) {
    const traceDetails = traceContext(conversationId, selection, {
      phase: details.phase,
      message_id: details.assistantMessageId,
      provider_id: details.providerId,
      provider: details.provider,
      interface: details.interface,
      model: selection?.model.modelId ?? details.model,
      duration_ms: details.elapsedMs ?? details.usage?.durationMs,
      time_to_first_response_ms: details.usage?.latencyMs,
      input_tokens: details.usage?.inputTokens,
      output_tokens: details.usage?.outputTokens,
      total_tokens: details.usage?.totalTokens,
      tokens_per_second: details.usage?.tokensPerSecond,
      status: details.status,
      code: details.code,
      error: details.error,
    });
    if (details.error) {
      traceError(`chat.${details.phase}`, traceDetails);
    } else {
      traceVerbose(`chat.${details.phase}`, traceDetails);
    }
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
