import {
  deleteMessage,
  ensureConversation,
  getConversation,
  getMessage,
  getMessages,
  insertMessage,
  setLastModel,
  toModelMessages,
  toModelMessagesThroughUser,
  updateConversation,
  updateMessage,
} from './database.js';
import { CLIENT_TOOLS } from './client-tools.js';
import { StreamAccumulator } from './streaming.js';

const MAX_TOOL_OUTPUT_CHARS = 120_000;
const AUTOMATIC_COMPACTION_THRESHOLD = 0.9;
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
  constructor({ registry, sendEvent, debugStream = false }) {
    this.registry = registry;
    this.sendEvent = sendEvent;
    this.debugStream = debugStream;
    this.runs = new Map();
  }

  async send({
    conversationId,
    model,
    text,
    attachments = [],
    steer = false,
    reasoningEffort = null,
    project = {},
  }) {
    const conversation = ensureConversation(conversationId, model, project);
    setLastModel(model);

    if (this.runs.has(conversation.id)) {
      const queued = this.createUserMessage({
        conversationId: conversation.id,
        text,
        attachments,
        status: steer ? 'steered' : 'queued',
      });
      const run = this.runs.get(conversation.id);
      if (steer) {
        run.queue.unshift({ userMessageId: queued.id, model, reasoningEffort });
        run.controller.abort('steer');
      } else {
        run.queue.push({ userMessageId: queued.id, model, reasoningEffort });
      }
      this.emit(conversation.id, { type: 'message', message: queued });
      return { conversation: getConversation(conversation.id), message: queued, queued: true };
    }

    const userMessage = this.createUserMessage({
      conversationId: conversation.id,
      text,
      attachments,
      status: 'sent',
    });
    this.emit(conversation.id, { type: 'message', message: userMessage });
    this.start({
      conversationId: conversation.id,
      model,
      userMessageId: userMessage.id,
      reasoningEffort,
    });
    return { conversation: getConversation(conversation.id), message: userMessage, queued: false };
  }

  stop(conversationId) {
    const run = this.runs.get(conversationId);
    if (run) {
      run.queue = [];
      run.controller.abort('stop');
    }
  }

  cancelQueuedMessage({ conversationId, messageId }) {
    const run = this.runs.get(conversationId);
    if (run) {
      run.queue = run.queue.filter((item) => item.userMessageId !== messageId);
    }

    const message = getMessage(messageId);
    if (!message || !['queued', 'steered'].includes(message.status)) {
      return { conversation: getConversation(conversationId), cancelled: false };
    }

    deleteMessage(messageId);
    this.emit(conversationId, { type: 'message-delete', messageId });
    return { conversation: getConversation(conversationId), cancelled: true };
  }

  async retry({ conversationId, model, assistantMessageId }) {
    const conversation = ensureConversation(conversationId, model);
    setLastModel(model);

    if (this.runs.has(conversation.id)) {
      return { conversation: getConversation(conversation.id), message: null, queued: true };
    }

    const messages = toModelMessagesThroughUser(conversation.id, assistantMessageId);
    if (messages.length === 0) {
      return { conversation: getConversation(conversation.id), message: null, queued: false };
    }

    const conversationMessages = getMessages(conversation.id);
    const assistantIndex = conversationMessages.findIndex((message) => message.id === assistantMessageId);
    const searchEnd = assistantIndex >= 0 ? assistantIndex : conversationMessages.length;
    const lastUserIndex = conversationMessages
      .slice(0, searchEnd)
      .findLastIndex((message) => message.role === 'user' && ['sent', 'completed'].includes(message.status));
    const staleMessages = lastUserIndex >= 0 ? conversationMessages.slice(lastUserIndex + 1) : [];
    for (const message of staleMessages) {
      deleteMessage(message.id);
      this.emit(conversation.id, { type: 'message-delete', messageId: message.id });
    }

    this.start({
      conversationId: conversation.id,
      model,
      retryMessages: messages,
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

    const controller = activeController ?? new AbortController();
    if (!automatic) {
      this.runs.set(conversation.id, {
        controller,
        queue: [],
        model: selection.model.id,
        kind: 'compression',
      });
      this.emit(conversation.id, { type: 'run-state', running: true });
    }

    try {
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
        onEvent: () => {},
      });
      const checkpoint = turn.assistantContent.trim();
      if (!checkpoint) {
        throw new Error('The model returned an empty context checkpoint.');
      }
      if (turn.toolCalls.length > 0) {
        throw new Error('The model attempted to call a tool while compressing the context.');
      }

      const updatedConversation = updateConversation(conversation.id, {
        contextCheckpoint: checkpoint,
        checkpointMessageId: checkpointMessage.id,
        contextTokens: Math.ceil(checkpoint.length / 4),
      });
      this.emit(conversation.id, { type: 'conversation', conversation: updatedConversation });
      return updatedConversation;
    } catch (error) {
      if (controller.signal.aborted) return getConversation(conversation.id);
      throw error;
    } finally {
      if (!automatic) {
        this.runs.delete(conversation.id);
        this.emit(conversation.id, { type: 'run-state', running: false });
      }
    }
  }

  createUserMessage({ conversationId, text, attachments, status }) {
    const message = insertMessage({
      conversationId,
      role: 'user',
      status,
      content: text,
      attachments,
    });
    const conversation = getConversation(conversationId);

    if (conversation?.titleStatus === 'pending' && conversation.title === 'New chat' && text.trim()) {
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
    reasoningEffort = null,
  }) {
    const controller = new AbortController();
    const accumulator = new StreamAccumulator();
    const assistantMessage = insertMessage({
      conversationId,
      role: 'assistant',
      model,
      status: 'streaming',
      content: '',
    });
    const run = {
      controller,
      queue,
      assistantMessageId: assistantMessage.id,
      accumulator,
      model,
    };
    this.runs.set(conversationId, run);
    this.emit(conversationId, { type: 'message', message: assistantMessage });
    this.emit(conversationId, { type: 'run-state', running: true });

    const requestStartedAt = Date.now();
    let lastPersistedAt = 0;
    const persistAssistant = ({ status = 'streaming', force = false } = {}) => {
      const now = Date.now();
      if (!force && now - lastPersistedAt < 120) return null;
      lastPersistedAt = now;
      const message = updateMessage(assistantMessage.id, {
        status,
        content: accumulator.content,
        segments: accumulator.segments,
        usage: accumulator.usage,
      });
      if (message) {
        this.emit(conversationId, { type: 'message', message });
      }
      return message;
    };
    this.logChatTiming(conversationId, {
      phase: 'request-start',
      assistantMessageId: assistantMessage.id,
      model,
    });

    try {
      const selection = this.registry.resolve(model);
      if (!selection) {
        throw new Error('The selected model is no longer configured. Choose another model in Settings.');
      }

      const messages = retryMessages
        ?? toModelMessages(conversationId, { excludeMessageId: assistantMessage.id });
      const workspacePath = getConversation(conversationId)?.projectPath;
      const toolHistory = [];
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
        const turn = await selection.provider.stream({
          model: selection.model,
          messages,
          tools: CLIENT_TOOLS,
          toolHistory,
          reasoningEffort,
          invocationContext: { workspacePath },
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
                }
              : event);
            this.logStreamEvent(conversationId, event);
            persistAssistant({
              force: event.type === 'usage' || event.type === 'error',
            });
          },
        });
        if (turn.toolCalls.length === 0) break;

        const results = [];
        for (const toolCall of turn.toolCalls) {
          if (!toolCall.callId || !toolCall.name) {
            throw new Error('The provider returned a tool call without a call ID or name.');
          }

          const tool = CLIENT_TOOLS.find((item) => item.name === toolCall.name);
          const expectedRequiresHumanApproval = Boolean(
            tool?.canEditFile || tool?.canPerformDestructiveActions,
          );
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
          accumulator.apply({
            type: 'tool-call',
            key: `round:${roundIndex}:${toolCall.key ?? toolCall.callId}`,
            callId: toolCall.callId,
            name: toolCall.name,
            argumentsText: toolCall.argumentsText,
            replaceArguments: true,
            invocationGoal,
            requiresHumanApproval: expectedRequiresHumanApproval,
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
            if (requiresHumanApproval !== expectedRequiresHumanApproval) {
              throw new Error('__requires_human_approval does not match the tool classification.');
            }
            if (!tool) throw new Error(`Unknown client-side tool: ${toolCall.name}.`);

            const input = { ...args };
            delete input.__requires_human_approval;
            delete input.__invocation_goal;
            const value = await tool.execute(input, {
              signal: controller.signal,
              workspacePath,
            });
            output = typeof value === 'string' ? value : JSON.stringify(value);
          } catch (error) {
            isError = true;
            output = JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            });
          }

          if (output.length > MAX_TOOL_OUTPUT_CHARS) {
            output = JSON.stringify({
              output: output.slice(0, MAX_TOOL_OUTPUT_CHARS),
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
        }

        toolHistory.push({
          assistantContent: turn.assistantContent,
          responseItems: turn.responseItems,
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
        && lastInputTokens / contextLimit > AUTOMATIC_COMPACTION_THRESHOLD
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
      if (userMessageId && !aborted) {
        const failedUserMessage = updateMessage(userMessageId, { status: 'error' });
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
      const current = this.runs.get(conversationId);
      this.runs.delete(conversationId);
      const pendingQueue = current?.queue ?? [];
      const next = pendingQueue.shift();
      if (next) {
        const sentMessage = updateMessage(next.userMessageId, { status: 'sent' });
        this.emit(conversationId, { type: 'message', message: sentMessage });
        this.start({
          conversationId,
          model: next.model,
          userMessageId: next.userMessageId,
          queue: pendingQueue,
          reasoningEffort: next.reasoningEffort,
        });
      } else {
        this.emit(conversationId, { type: 'run-state', running: false });
      }
    }
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
}
