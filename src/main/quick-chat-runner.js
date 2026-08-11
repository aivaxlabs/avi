import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { createConversation, messageToApiBlock } from './database.js';
import { CLIENT_TOOLS, decorateToolsForInvocation } from './client-tools.js';
import { applySubagentModelSchema } from './default-models.js';
import { normalizeAttachmentsForModel } from './files.js';
import { StreamAccumulator } from './streaming.js';
import { traceError, traceVerbose } from './trace-log.js';

export class QuickChatRunner {
  constructor({
    registry,
    mcpManager,
    chatRunner,
    getPreferences,
    sendEvent,
    stopBackgroundTasks,
  }) {
    this.registry = registry;
    this.mcpManager = mcpManager;
    this.chatRunner = chatRunner;
    this.getPreferences = getPreferences;
    this.sendEvent = sendEvent;
    this.stopBackgroundTasks = stopBackgroundTasks;
    this.sessions = new Map();
    this.pendingQuestions = new Map();
  }

  createSession() {
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      messages: [],
      run: null,
      model: this.resolveInitialModel(),
      reasoningEffort: this.getPreferences().defaultModels?.quickChat?.reasoningEffort ?? null,
      tasks: [],
      goal: null,
    });
    return this.state(id);
  }

  state(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Quick chat session is no longer available.');
    return {
      id,
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      messages: session.messages,
      running: Boolean(session.run),
    };
  }

  async send({ sessionId, text = '', attachments = [], model, reasoningEffort }) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Quick chat session is no longer available.');
    if (session.run) throw new Error('Wait for the current response to finish.');

    const selection = this.registry.resolve(model || session.model);
    if (!selection) throw new Error('Choose an available model before sending a message.');
    const normalizedAttachments = await normalizeAttachmentsForModel(
      attachments,
      selection.model.capabilities,
    );
    if (!text.trim() && normalizedAttachments.length === 0) {
      throw new Error('Write a message or attach a file.');
    }

    const modelChanged = session.model !== selection.model.id;
    session.model = selection.model.id;
    session.reasoningEffort = reasoningEffort === undefined
      ? modelChanged ? null : session.reasoningEffort
      : reasoningEffort;
    const userMessage = this.createMessage({
      role: 'user',
      model: session.model,
      content: text.trim(),
      attachments: normalizedAttachments,
      status: 'sent',
    });
    session.messages.push(userMessage);
    this.emit(sessionId, { type: 'message', message: userMessage });
    void this.run(session, selection);
    return { message: userMessage, model: session.model };
  }

  stop(sessionId) {
    const session = this.sessions.get(sessionId);
    session?.run?.controller.abort(new Error('The response was stopped.'));
    return { stopped: Boolean(session?.run) };
  }

  close(sessionId) {
    this.stop(sessionId);
    this.stopBackgroundTasks?.(sessionId);
    this.sessions.delete(sessionId);
    for (const [questionId, pending] of this.pendingQuestions) {
      if (pending.sessionId !== sessionId) continue;
      pending.reject(new Error('The Quick chat window was closed.'));
      this.pendingQuestions.delete(questionId);
    }
  }

  answerQuestion({ sessionId, questionId, answers, cancelled = false }) {
    const pending = this.pendingQuestions.get(questionId);
    if (!pending || pending.sessionId !== sessionId) return false;
    this.pendingQuestions.delete(questionId);
    pending.resolve({ answers, cancelled });
    return true;
  }

  async run(session, selection) {
    const controller = new AbortController();
    const accumulator = new StreamAccumulator();
    const assistantMessage = this.createMessage({
      role: 'assistant',
      model: session.model,
      content: '',
      segments: [],
      status: 'streaming',
    });
    const run = { controller, accumulator, assistantMessage };
    session.run = run;
    session.messages.push(assistantMessage);
    this.emit(session.id, { type: 'message', message: assistantMessage });
    this.emit(session.id, { type: 'run-state', running: true });

    const requestStartedAt = Date.now();
    traceVerbose('quick-chat.request-start', {
      thread_id: session.id,
      model: selection.model.modelId,
      provider_id: selection.model.providerId,
      message_count: session.messages.length - 1,
    });

    try {
      const workspacePath = homedir();
      const mcpRuntime = this.mcpManager
        ? await this.mcpManager.ensureWorkspace(workspacePath, controller.signal)
        : { tools: [], instructions: [] };
      const models = this.registry.listModels();
      const preferences = this.getPreferences();
      const aivax = preferences.aivax;
      const providerTools = selection.provider.getContributions({
        model: selection.model,
        conversation: null,
        workspacePath,
      }).tools;
      const availableTools = decorateToolsForInvocation([
        ...CLIENT_TOOLS
          .filter((tool) => (
            tool.name !== 'read_media_file'
            || selection.model.capabilities?.images
            || selection.model.capabilities?.audio
            || selection.model.capabilities?.pdfFiles
          ))
          .filter((tool) => !['memory_search', 'memory_write', 'memory_delete'].includes(tool.name) || (
            aivax?.connected && aivax.memoryEnabled && aivax.memoryCollectionId
          ))
          .filter((tool) => tool.name !== 'web_search' || (
            aivax?.connected && aivax.webSearchEnabled
          ))
          .map((tool) => ['chat_create_thread', 'chat_spawn_subagent'].includes(tool.name)
            ? {
                ...tool,
                inputSchema: applySubagentModelSchema(
                  tool,
                  models,
                  this.getPreferences().defaultModels,
                ),
              }
            : tool),
        ...providerTools,
        ...mcpRuntime.tools,
      ], 'full_access');
      const messages = session.messages
        .filter((message) => message.id !== assistantMessage.id)
        .map((message) => messageToApiBlock(message, selection.model.capabilities));
      const toolHistory = [];

      while (true) {
        const roundIndex = toolHistory.length;
        const turn = await selection.provider.stream({
          model: selection.model,
          messages,
          tools: availableTools,
          toolHistory,
          reasoningEffort: session.reasoningEffort,
          invocationContext: {
            conversationId: session.id,
            workspacePath,
            mcpInstructions: mcpRuntime.instructions,
            permissionMode: 'full_access',
            orchestrationRole: 'orchestrator',
            quickChat: true,
            tuning: preferences.tuning,
            aivax,
          },
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'error') {
              traceError('quick-chat.stream-error', {
                thread_id: session.id,
                round: roundIndex,
                code: event.code,
                status: event.status,
                error: event.message,
              });
            }
            if (['content', 'reasoning', 'tool-call', 'item-complete', 'retry', 'retry-clear', 'error', 'usage'].includes(event.type)) {
              accumulator.apply(event.type === 'tool-call'
                ? {
                    ...event,
                    key: `round:${roundIndex}:${event.key ?? event.callId ?? 'tool'}`,
                    isMcp: Boolean(availableTools.find((tool) => tool.name === event.name)?.mcp),
                  }
                : event);
              this.updateAssistant(session, assistantMessage, accumulator, 'streaming');
            }
          },
        });

        if (turn.toolCalls.length === 0) break;
        const results = [];
        for (const toolCall of turn.toolCalls) {
          const tool = availableTools.find((item) => item.name === toolCall.name);
          let output;
          let mediaContent;
          let isError = false;
          try {
            const args = JSON.parse(toolCall.argumentsText || '{}');
            const {
              __invocation_goal: invocationGoal,
              __requires_human_approval: _requiresHumanApproval,
              ...input
            } = args;
            if (!tool) throw new Error(`Unknown tool: ${toolCall.name}.`);
            if (!invocationGoal) throw new Error('Tool arguments must include __invocation_goal.');
            accumulator.apply({
              type: 'tool-call',
              key: `round:${roundIndex}:${toolCall.key ?? toolCall.callId}`,
              callId: toolCall.callId,
              name: toolCall.name,
              argumentsText: toolCall.argumentsText,
              replaceArguments: true,
              invocationGoal,
              requiresHumanApproval: false,
              isMcp: Boolean(tool.mcp),
            });
            this.updateAssistant(session, assistantMessage, accumulator, 'streaming');
            const value = await this.executeTool(tool, input, {
              session,
              selection,
              models,
              workspacePath,
              signal: controller.signal,
            });
            if (Array.isArray(value?.attachments)) {
              for (const attachment of value.attachments) {
                if (!attachment || typeof attachment !== 'object') continue;
                const duplicate = assistantMessage.attachments.some((existing) => (
                  attachment.id && existing.id === attachment.id
                ) || (
                  attachment.path && existing.path === attachment.path
                ));
                if (!duplicate) assistantMessage.attachments.push(attachment);
              }
            }
            if (value && typeof value === 'object' && typeof value.output === 'string') {
              output = value.output;
              mediaContent = value.mediaContent;
            } else {
              output = typeof value === 'string' ? value : JSON.stringify(value);
            }
          } catch (error) {
            isError = true;
            output = `Error: ${error instanceof Error ? error.message : String(error)}`;
            traceError('quick-chat.tool-error', {
              thread_id: session.id,
              tool: toolCall.name,
              tool_type: tool?.mcp ? 'mcp' : 'application',
              round: roundIndex,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          accumulator.apply({
            type: 'tool-result',
            callId: toolCall.callId,
            output,
            isError,
          });
          this.updateAssistant(session, assistantMessage, accumulator, 'streaming');
          results.push({ callId: toolCall.callId, output, isError, mediaContent });
        }
        toolHistory.push({
          assistantContent: turn.assistantContent,
          continuation: turn.continuation,
          toolCalls: turn.toolCalls,
          results,
        });
      }

      this.updateAssistant(session, assistantMessage, accumulator, 'completed');
      traceVerbose('quick-chat.message-completed', {
        thread_id: session.id,
        model: selection.model.modelId,
        duration_ms: Date.now() - requestStartedAt,
        input_tokens: accumulator.usage?.inputTokens,
        output_tokens: accumulator.usage?.outputTokens,
        total_tokens: accumulator.usage?.totalTokens,
        cached_input_tokens: accumulator.usage?.cachedInputTokens,
        reasoning_tokens: accumulator.usage?.reasoningTokens,
        tokens_per_second: accumulator.usage?.tokensPerSecond,
      });
    } catch (error) {
      const stopped = controller.signal.aborted;
      if (!stopped) {
        traceError('quick-chat.run-error', {
          thread_id: session.id,
          duration_ms: Date.now() - requestStartedAt,
          code: error?.code,
          error: error instanceof Error ? error.message : String(error),
        });
        accumulator.apply({
          type: 'error',
          code: error?.code ?? 'quick_chat_error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.updateAssistant(session, assistantMessage, accumulator, stopped ? 'aborted' : 'error');
      if (!stopped) this.emit(session.id, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (session.run === run) session.run = null;
      this.emit(session.id, { type: 'run-state', running: false });
    }
  }

  async executeTool(tool, input, { session, selection, models, workspacePath, signal }) {
    if (tool.name === 'ask_question') {
      const result = await this.askQuestion(session.id, input.questions, signal);
      if (result.cancelled) return 'Question cancelled; no answers were collected.';
      return [
        'User answers:',
        ...result.answers.map(({ question, answer }) => (
          `- ${question}: ${Array.isArray(answer) ? answer.join(', ') : answer}`
        )),
      ].join('\n');
    }
    if (tool.name === 'update_tasks') {
      session.tasks = input.tasks;
      return session.tasks.length === 0
        ? 'Task list cleared.'
        : `Task list updated: ${session.tasks.length} task(s).`;
    }
    if (tool.name === 'start_goal') {
      if (session.goal && !['completed', 'blocked', 'cancelled'].includes(session.goal.status)) {
        throw new Error('An unfinished Quick chat Goal already exists.');
      }
      session.goal = {
        id: randomUUID(),
        specification: input.specification,
        status: 'active',
        startedAt: new Date().toISOString(),
      };
      return [
        'Goal started.',
        `ID: ${session.goal.id}`,
        `Status: ${session.goal.status}`,
        `Started: ${session.goal.startedAt}`,
        'Specification:',
        session.goal.specification,
      ].join('\n');
    }
    if (tool.name === 'update_goal_status') {
      if (!session.goal || session.goal.status !== 'active') {
        throw new Error('No active Quick chat Goal exists.');
      }
      session.goal = { ...session.goal, status: input.status, summary: input.summary };
      return [
        `Goal ${session.goal.status}.`,
        `ID: ${session.goal.id}`,
        'Summary:',
        session.goal.summary,
        `Started: ${session.goal.startedAt}`,
      ].join('\n');
    }
    if (tool.name === 'chat_spawn_subagent') {
      return this.spawnThread(input, session, models, workspacePath);
    }
    return tool.execute(input, {
      signal,
      workspacePath,
      chatRunner: this.chatRunner,
      conversationId: session.id,
      model: selection.model.id,
      models,
      reasoningEffort: session.reasoningEffort,
      permissionMode: 'full_access',
      workMode: null,
      ultraMode: false,
      goal: null,
      tuning: this.getPreferences().tuning,
      aivax: this.getPreferences().aivax,
      defaultModels: this.getPreferences().defaultModels,
      capabilities: selection.model.capabilities,
      artifacts: Object.freeze({
        getRecentGeneratedImages: ({ limit }) => session.messages
          .flatMap((message) => message.attachments ?? [])
          .filter((attachment) => (
            attachment?.kind === 'image_url'
            && attachment.source === 'generated_image'
            && typeof attachment.path === 'string'
            && attachment.path
          ))
          .slice(-limit)
          .map((attachment) => ({
            name: attachment.name ?? null,
            path: attachment.path,
          })),
      }),
    });
  }

  async spawnThread(input, session, models, workspacePath) {
    const selectedModelId = input.model_name || session.model;
    if (!models.some((model) => model.id === selectedModelId)) {
      throw new Error(`Model "${selectedModelId}" is not configured.`);
    }
    const conversation = createConversation({
      title: 'Quick chat sub-agent',
      model: selectedModelId,
      projectPath: workspacePath,
      titleStatus: 'generated',
    });
    await this.chatRunner.send({
      conversationId: conversation.id,
      model: selectedModelId,
      text: String(input.prompt ?? '').trim(),
      attachments: [],
      reasoningEffort: input.reasoning_effort ?? session.reasoningEffort,
      permissionMode: 'approve_for_me',
    });
    return [
      'Sub-agent started.',
      `Thread ID: ${conversation.id}`,
      'Status: working',
    ].join('\n');
  }

  askQuestion(sessionId, questions, signal) {
    const questionId = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pendingQuestions.delete(questionId);
        reject(signal.reason ?? new Error('Question was cancelled.'));
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pendingQuestions.set(questionId, {
        sessionId,
        resolve: (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        reject,
      });
      this.emit(sessionId, { type: 'question-request', questionId, questions });
    });
  }

  updateAssistant(session, message, accumulator, status) {
    Object.assign(message, {
      content: accumulator.content,
      segments: accumulator.segments,
      usage: accumulator.usage,
      status,
      updatedAt: new Date().toISOString(),
    });
    this.emit(session.id, { type: 'message', message: { ...message } });
  }

  createMessage({ role, model, content, attachments = [], segments = [], status }) {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      conversationId: null,
      role,
      model,
      content,
      attachments,
      segments,
      edits: [],
      status,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      usage: null,
    };
  }

  resolveInitialModel() {
    const models = this.registry.listModels();
    const configured = this.getPreferences().defaultModels?.quickChat?.modelId;
    if (!configured) {
      throw new Error('Choose a Quick chat model in Settings before opening a Quick chat.');
    }
    if (!models.some((model) => model.id === configured)) {
      throw new Error('The configured Quick chat model is unavailable. Choose another model in Settings.');
    }
    return configured;
  }

  emit(sessionId, payload) {
    this.sendEvent(sessionId, { ...payload, sessionId });
  }
}
