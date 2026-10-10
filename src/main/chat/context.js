import {
  ensureConversation,
  getConversation,
  getGoal,
  getBotSettings,
  getGoalForConversation,
  getMessage,
  getMessages,
  getSideChatHistoryStart,
  insertMessage,
  listAllConversations,
  listSubagents,
  listTasks,
  toModelMessages,
  updateConversation,
  updateMessage,
} from '../database.js';
import {
  CLIENT_TOOLS,
  decorateToolsForInvocation,
} from '../client-tools.js';
import {
  compactOldToolResults,
  countMessageContext,
  countSerializedCharacters,
  distributeContextUsage,
} from '../context-usage.js';
import { resolveDynamicContextUsage } from '../context-injection.js';
import { composeToolsWithPlugins } from '../tool-composition.js';
import { limitToolHistoryResults } from '../tool-output.js';
import { traceVerbose } from '../trace-log.js';
import {
  CONTINUING_GOAL_STATUSES,
  MAX_CONSECUTIVE_CONTEXT_COMPACTION_FAILURES,
  CROSS_BOT_INBOX_TOOL_NAMES,
  PLAN_TOOL_NAMES,
  COMPACTION_PROMPT,
} from './constants.js';
import {
  compactionContextMessage,
  compactionInFlightMessages,
  isContextLengthError,
  traceContext,
} from './history.js';

export const contextMethods = {
  async contextUsage({ conversationId, model, contextLimit = null }) {
    const conversation = getConversation(conversationId);
    if (!conversation) throw new Error('Conversation not found.');
    const selection = this.registry.resolve(model || conversation.model);
    if (!selection) throw new Error('The selected model is no longer configured.');

    const sourceMessages = getMessages(conversation.id);
    const messages = toModelMessages(conversation.id, {
      capabilities: selection.model.capabilities,
    });
    const preferences = this.getPreferences();
    const latestUser = sourceMessages.findLast((message) => message.role === 'user');
    const workMode = latestUser?.workMode ?? null;
    const permissionMode = latestUser?.permissionMode ?? preferences.defaultPermissionMode ?? 'approve_for_me';
    const botRuntime = conversation.isBot ? this.getBotRuntimeContext(conversation.id) : null;
    const mcpRuntime = workMode === 'plan' || !this.mcpManager
      ? { tools: [], instructions: [] }
      : botRuntime
        ? this.mcpManager.runtimeForBot(conversation.projectPath, botRuntime.bot.id)
        : this.mcpManager.runtimeForWorkspace(conversation.projectPath);
    const providerContext = {
      model: selection.model,
      conversation,
      workspacePath: conversation.projectPath,
    };
    const rubberDuckMode = conversation.conversationType === 'rubber_duck';
    const selectedProviderTools = workMode === 'plan' || rubberDuckMode
      ? []
      : selection.provider.getContributions(providerContext).tools;
    const selectedProviderToolNames = new Set(selectedProviderTools.map((tool) => tool.name));
    const providerTools = workMode === 'plan'
      ? []
      : [
          ...selectedProviderTools,
          ...(this.registry.listGlobalTools?.(providerContext) ?? [])
            .filter((tool) => !selectedProviderToolNames.has(tool.name)),
        ];
    const coreTools = CLIENT_TOOLS
      .filter((tool) => workMode !== 'plan' || PLAN_TOOL_NAMES.has(tool.name))
      .filter((tool) => !['memory_search', 'memory_write', 'memory_delete'].includes(tool.name) || (
        preferences.aivax?.connected
        && preferences.aivax.memoryEnabled
        && preferences.aivax.memoryCollectionId
      ))
      .filter((tool) => tool.name !== 'web_search' || (
        preferences.aivax?.connected && preferences.aivax.webSearchEnabled
      ))
      .filter((tool) => tool.name !== 'read_media_file' || (
        selection.model.capabilities?.images
        || selection.model.capabilities?.video
        || selection.model.capabilities?.audio
        || selection.model.capabilities?.pdfFiles
        || (preferences.aivax?.connected && preferences.aivax.mediaDescriptionsEnabled)
      ))
      .filter((tool) => (
        !botRuntime
        || !CROSS_BOT_INBOX_TOOL_NAMES.has(tool.name)
        || getBotSettings().crossBotInbox
      ))
      .filter((tool) => !botRuntime || ![
        'memory_search',
        'memory_write',
        'memory_delete',
        'chat_spawn_subagent',
        'chat_overview',
        'sleep_semaphore',
      ].includes(tool.name))
      .filter((tool) => (
        tool.name !== 'chat_spawn_subagent'
        || (!conversation.isSubagent && !conversation.isSideChat)
      ));
    const extensionTools = [
      ...(rubberDuckMode ? [] : botRuntime?.tools ?? []),
      ...providerTools.map((tool) => ({ ...tool, providerTool: true })),
      ...mcpRuntime.tools,
    ];
    const composedTools = composeToolsWithPlugins(
      coreTools,
      workMode === 'plan' || rubberDuckMode ? [] : this.getPluginTools(conversation.id),
      extensionTools,
    );
    const toolNames = new Set();
    const tools = decorateToolsForInvocation(
      composedTools.filter((tool) => {
        if (toolNames.has(tool.name)) return false;
        toolNames.add(tool.name);
        return true;
      }),
      permissionMode,
      { honorExplicitAuthorization: Boolean(botRuntime) },
    );
    const teamRootId = conversation.isSubagent || conversation.isSideChat
      ? conversation.parentConversationId
      : conversation.id;
    const hasSubagents = Boolean(teamRootId && listSubagents(teamRootId).length > 0);
    const goal = latestUser?.goalId
      ? getGoal(latestUser.goalId)
      : getGoalForConversation(conversation.id);
    const instructionUsage = await resolveDynamicContextUsage({
      traceOperation: 'chat',
      effectiveModelId: selection.model.id,
      modelRules: preferences.defaultModels?.rules ?? [],
      orchestrationRole: conversation.isSubagent ? 'subagent'
        : conversation.isSideChat ? 'side_chat'
          : conversation.conversationType === 'rubber_duck' ? 'supervisor'
            : conversation.conversationType === 'rubber_duck_subject' ? 'subject' : 'orchestrator',
      conversationId: conversation.id,
      workspacePath: conversation.projectPath,
      mcpInstructions: mcpRuntime.instructions,
      ...this.getPluginContext({
        conversationId: conversation.id,
        workspacePath: conversation.projectPath,
        botId: botRuntime?.bot.id ?? null,
      }),
      ...(botRuntime ? { bot: this.describeInvocationBot(conversation.id) } : {}),
      permissionMode,
      workMode,
      ultraMode: latestUser?.ultraMode ?? false,
      goal: goal && CONTINUING_GOAL_STATUSES.has(goal.status) ? goal : null,
      tasks: listTasks(conversation.id),
      semaphoreHoldings: this.semaphores.holdings(conversation.id),
      hasSubagents,
      hasThreads: hasSubagents || listAllConversations().some((item) => (
        item.id !== conversation.id && item.projectPath === conversation.projectPath
      )),
      tuning: preferences.tuning,
      aivax: preferences.aivax,
    });
    const messageUsage = countMessageContext(messages);
    const toolCharacters = (tool) => countSerializedCharacters({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    });
    const mcpTools = new Map();
    let aviToolCharacters = 0;
    for (const tool of tools) {
      const characters = toolCharacters(tool);
      if (!tool.mcp) {
        aviToolCharacters += characters;
        continue;
      }
      const server = tool.mcp.serverName || 'MCP server';
      mcpTools.set(server, (mcpTools.get(server) ?? 0) + characters);
    }

    return distributeContextUsage({
      contextTokens: conversation.contextTokens,
      contextLimit: contextLimit || botRuntime?.bot.contextSize || selection.model.context.input,
      segments: [
        { id: 'avi-instructions', label: 'Avi instructions', characters: instructionUsage.aviInstructions },
        { id: 'custom-instructions', label: 'Instructions / customizations', characters: instructionUsage.customInstructions },
        ...instructionUsage.mcpInstructions.map((item) => ({
          id: `mcp-instructions:${item.server}`,
          label: 'MCP instructions',
          server: item.server,
          characters: item.characters,
        })),
        { id: 'global-context', label: 'Global context (skills + workflows)', characters: instructionUsage.globalContext },
        { id: 'avi-tools', label: 'Avi tools', characters: aviToolCharacters },
        ...[...mcpTools].map(([server, characters]) => ({
          id: `mcp-tools:${server}`,
          label: 'MCP tools',
          server,
          characters,
        })),
        { id: 'messages', label: 'Messages', characters: messageUsage.messagesCharacters },
        { id: 'tool-results', label: 'Tool results', characters: messageUsage.toolResultCharacters },
        { id: 'other', label: 'Other', characters: messageUsage.otherCharacters },
      ],
    });
  },

  compressQuick({ conversationId, automatic = false }) {
    const conversation = getConversation(conversationId);
    if (!conversation) throw new Error('Conversation not found.');
    if (!automatic && this.runs.has(conversation.id)) {
      throw new Error('Wait for the current response to finish before compressing context.');
    }

    const compacted = compactOldToolResults(getMessages(conversation.id), {
      checkpointMessageId: conversation.checkpointMessageId,
    });
    const messages = compacted.updates.map((update) => (
      updateMessage(update.id, { segments: update.segments })
    ));
    const historyStart = getSideChatHistoryStart(conversation.id);
    for (const message of messages) {
      if (historyStart && message.createdAt <= historyStart.createdAt) continue;
      this.emit(conversation.id, { type: 'message', message });
    }
    const contextTokens = Math.max(
      0,
      conversation.contextTokens - Math.ceil(compacted.charactersRemoved / 4),
    );
    const updatedConversation = updateConversation(conversation.id, { contextTokens });
    this.emit(conversation.id, { type: 'conversation', conversation: updatedConversation });
    return {
      conversation: updatedConversation,
      messages,
      replacedResults: compacted.replacedResults,
      charactersRemoved: compacted.charactersRemoved,
    };
  },

  async compress({
    conversationId,
    model,
    automatic = false,
    controller: activeController = null,
    contextMessages = null,
    contextToolHistory = [],
    contextTools = CLIENT_TOOLS,
    streamingSegments = [],
  }) {
    const conversation = ensureConversation(conversationId, model);
    const existingRun = this.runs.get(conversation.id);
    if (existingRun && !automatic) {
      throw new Error('Wait for the current response to finish before compressing the context.');
    }

    const chatSelection = this.registry.resolve(model || conversation.model);
    if (!chatSelection) {
      throw new Error('The selected model is no longer configured. Choose another model in Settings.');
    }
    const configuredCompactation = this.getPreferences().defaultModels?.compactation;
    const compactationSelection = configuredCompactation?.modelId
      ? this.registry.resolve(configuredCompactation.modelId)
      : null;
    const compactionSelections = compactationSelection
      && compactationSelection.model.id !== chatSelection.model.id
      ? [
        { selection: compactationSelection, reasoningEffort: configuredCompactation.reasoningEffort ?? null },
        { selection: chatSelection, reasoningEffort: null },
      ]
      : [{ selection: chatSelection, reasoningEffort: null }];
    let selection = compactionSelections[0].selection;

    const messages = (contextMessages ?? toModelMessages(conversation.id, {
      capabilities: chatSelection.model.capabilities,
    })).map(compactionContextMessage);
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
      contextTools,
      this.getPreferences().tuning.toolOutputLimit,
    );
    const inFlightMessages = compactionInFlightMessages(limitedToolHistory, streamingSegments);
    const compressionMessages = [
      ...messages,
      ...inFlightMessages,
      { role: 'user', content: COMPACTION_PROMPT },
    ];
    traceVerbose('chat.context-compaction-started', traceContext(conversation.id, selection, {
      operation: automatic ? 'automatic' : 'manual',
      compactation_model: configuredCompactation?.modelId ?? null,
      context_tokens: conversation.contextTokens,
      context_limit: chatSelection.model.context?.input,
      message_count: messages.length,
      tool_history_count: limitedToolHistory.length,
      item_count: streamingSegments.length,
      input_tokens: Math.ceil(JSON.stringify(compressionMessages).length / 4),
    }));
    const compressionSegment = {
      type: 'context-compression',
      inputTokens: Math.ceil(JSON.stringify(compressionMessages).length / 4),
      outputTokens: null,
    };
    const timelineAccumulator = automatic
      && existingRun?.kind === 'chat'
      && getMessage(existingRun.assistantMessageId)?.status === 'streaming'
      ? existingRun.accumulator
      : null;
    let timelineCompressionSegment = null;
    if (timelineAccumulator) {
      timelineAccumulator.apply({
        ...compressionSegment,
        contentOffset: timelineAccumulator.content.length,
        status: 'streaming',
      });
      timelineCompressionSegment = timelineAccumulator.segments.at(-1);
      const updatedAssistant = updateMessage(existingRun.assistantMessageId, {
        content: timelineAccumulator.content,
        segments: timelineAccumulator.segments,
      });
      this.emit(conversation.id, { type: 'message', message: updatedAssistant });
    }
    const compressionMessage = insertMessage({
      conversationId: conversation.id,
      role: 'system',
      status: 'streaming',
      content: '',
      segments: [compressionSegment],
      hidden: Boolean(timelineAccumulator),
    });
    this.emit(conversation.id, { type: 'message', message: compressionMessage });

    const controller = activeController ?? new AbortController();
    if (!automatic) {
      const startedAt = Date.now();
      this.runs.set(conversation.id, {
        controller,
        queue: [],
        startedAt,
        model: selection.model.id,
        kind: 'compression',
        phase: 'inference',
        steerRequested: false,
      });
      this.emit(conversation.id, { type: 'run-state', running: true, startedAt });
    }

    let compressionUsage = null;
    try {
      const run = this.runs.get(conversation.id);
      if (run) run.phase = 'inference';
      const fallbackToolHistories = [
        limitedToolHistory,
        limitedToolHistory.slice(Math.ceil(limitedToolHistory.length * 0.3)),
        limitedToolHistory.slice(Math.ceil(limitedToolHistory.length * 0.6)),
        limitedToolHistory.slice(Math.ceil(limitedToolHistory.length * 0.6)),
      ];
      let successfulCompressionMessages = compressionMessages;
      let turn;
      for (
        let selectionIndex = 0;
        selectionIndex < compactionSelections.length && !turn;
        selectionIndex += 1
      ) {
        selection = compactionSelections[selectionIndex].selection;
        const attemptReasoningEffort = compactionSelections[selectionIndex].reasoningEffort;
        if (selectionIndex > 0) {
          if (run) run.model = selection.model.id;
          traceVerbose('chat.context-compaction-model-fallback', traceContext(conversation.id, selection, {
            operation: automatic ? 'automatic' : 'manual',
            compactation_model: compactionSelections[0].selection.model.id,
            fallback_model: selection.model.id,
          }));
        }
        for (let attempt = 0; attempt < fallbackToolHistories.length; attempt += 1) {
          const attemptToolHistory = fallbackToolHistories[attempt];
          const attemptInFlightMessages = compactionInFlightMessages(attemptToolHistory, streamingSegments);
          let attemptContextMessages = messages;
          if (attempt === fallbackToolHistories.length - 1) {
            attemptContextMessages = messages.filter((message, messageIndex) => {
              if (message.role !== 'assistant') return true;
              const nextUserOffset = messages
                .slice(messageIndex + 1)
                .findIndex((laterMessage) => laterMessage.role === 'user');
              const turnEnd = nextUserOffset < 0
                ? messages.length
                : messageIndex + 1 + nextUserOffset;
              return !messages
                .slice(messageIndex + 1, turnEnd)
                .some((laterMessage) => laterMessage.role === 'assistant');
            });
            const outputCallIds = new Set(attemptContextMessages
              .filter((message) => message.role === 'tool' && message.tool_call_id)
              .map((message) => message.tool_call_id));
            const retainedCallIds = new Set();
            attemptContextMessages = attemptContextMessages.map((message) => {
              if (message.role !== 'assistant') return message;
              const toolCalls = message.tool_calls?.filter((toolCall) => {
                const retained = outputCallIds.has(toolCall.id);
                if (retained) retainedCallIds.add(toolCall.id);
                return retained;
              });
              if (toolCalls?.length === message.tool_calls?.length) return message;
              const filteredMessage = {
                ...message,
                ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
              };
              if (!toolCalls?.length) delete filteredMessage.tool_calls;
              return filteredMessage;
            }).filter((message) => (
              message.role !== 'tool' || retainedCallIds.has(message.tool_call_id)
            ));
          }
          const attemptMessages = [
            ...attemptContextMessages,
            ...attemptInFlightMessages,
            { role: 'user', content: COMPACTION_PROMPT },
          ];
          traceVerbose('chat.context-compaction-attempt', traceContext(conversation.id, selection, {
            operation: automatic ? 'automatic' : 'manual',
            attempt: attempt + 1,
            message_count: attemptMessages.length,
            tool_history_count: attemptToolHistory.length,
            item_count: streamingSegments.length,
            input_tokens: Math.ceil(JSON.stringify(attemptMessages).length / 4),
          }));
          try {
            let attemptUsage = null;
            turn = await this.withThreadCapacity(conversation.id, controller.signal, () => selection.provider.stream({
              model: selection.model,
              messages: attemptMessages,
              tools: [],
              toolHistory: [],
              reasoningEffort: attemptReasoningEffort,
              invocationContext: {
                conversationId: conversation.id,
                workspacePath: conversation.projectPath,
                traceOperation: automatic ? 'automatic-compaction' : 'manual-compaction',
                traceRound: attempt + 1,
              },
              signal: controller.signal,
              onEvent: (event) => {
                if (event.type === 'usage') attemptUsage = event.usage;
              },
            }));
            compressionUsage = attemptUsage;
            successfulCompressionMessages = attemptMessages;
            break;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            const contextLengthFailure = isContextLengthError(error);
            const modelFallbackAvailable = selectionIndex < compactionSelections.length - 1;
            const attemptsExhausted = attempt === fallbackToolHistories.length - 1;
            if (!modelFallbackAvailable && (!contextLengthFailure || attemptsExhausted)) throw error;
            if (!contextLengthFailure || attemptsExhausted) break;
            traceVerbose('chat.context-compaction-fallback', traceContext(conversation.id, selection, {
              operation: automatic ? 'automatic' : 'manual',
              attempt: attempt + 1,
              message_count: attemptMessages.length,
              tool_history_count: attemptToolHistory.length,
              code: error?.code,
            }));
          }
        }
      }
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
      const completedSegment = {
        ...compressionSegment,
        inputTokens: compressionUsage?.inputTokens
          ?? Math.ceil(JSON.stringify(successfulCompressionMessages).length / 4),
        outputTokens: updatedConversation.contextTokens,
      };
      const completedMessage = updateMessage(compressionMessage.id, {
        status: 'completed',
        segments: [completedSegment],
      });
      if (timelineAccumulator) {
        Object.assign(timelineCompressionSegment, completedSegment, { status: 'completed' });
        const updatedAssistant = updateMessage(existingRun.assistantMessageId, {
          content: timelineAccumulator.content,
          segments: timelineAccumulator.segments,
        });
        this.emit(conversation.id, { type: 'message', message: updatedAssistant });
      }
      this.emit(conversation.id, { type: 'message', message: completedMessage });
      this.emit(conversation.id, { type: 'conversation', conversation: updatedConversation });
      traceVerbose('chat.context-compacted', traceContext(conversation.id, selection, {
        operation: automatic ? 'automatic' : 'manual',
        context_tokens: updatedConversation.contextTokens,
        context_limit: selection.model.context?.input,
        compaction_ratio: updatedConversation.contextTokens / completedSegment.inputTokens,
        input_tokens: completedSegment.inputTokens,
        cached_input_tokens: compressionUsage?.cachedInputTokens,
        cache_ratio: compressionUsage?.inputTokens > 0
          && compressionUsage.cachedInputTokens !== undefined
          ? compressionUsage.cachedInputTokens / compressionUsage.inputTokens
          : null,
        output_tokens: updatedConversation.contextTokens,
      }));
      if (automatic && run?.kind === 'chat') {
        run.consecutiveContextCompactionFailures = 0;
      }
      // Stateful providers are recreated from the checkpoint instead of carrying the pre-compaction session.
      await this.registry.releaseSessions?.({ conversationId: conversation.id, reason: 'compaction' });
      return updatedConversation;
    } catch (error) {
      const stopped = controller.signal.aborted;
      const run = this.runs.get(conversation.id);
      if (automatic && !stopped && run?.kind === 'chat') {
        run.consecutiveContextCompactionFailures += 1;
      }
      const consecutiveFailures = run?.consecutiveContextCompactionFailures ?? 0;
      const failureLimitReached = automatic
        && !stopped
        && run?.kind === 'chat'
        && consecutiveFailures >= MAX_CONSECUTIVE_CONTEXT_COMPACTION_FAILURES;
      const stoppedByUser = stopped && run?.stoppedByUser;
      const failedSegment = {
        ...compressionSegment,
        error: stopped
          ? 'Context compression stopped.'
          : failureLimitReached
            ? 'Context compression failed 3 consecutive times. Chat stopped.'
            : 'Context compression failed.',
      };
      const failedMessage = updateMessage(compressionMessage.id, {
        status: stopped ? 'aborted' : 'error',
        segments: [failedSegment],
      });
      if (timelineAccumulator) {
        Object.assign(timelineCompressionSegment, failedSegment, {
          status: stopped ? 'aborted' : 'error',
        });
        const updatedAssistant = updateMessage(existingRun.assistantMessageId, {
          content: timelineAccumulator.content,
          segments: timelineAccumulator.segments,
        });
        this.emit(conversation.id, {
          type: 'message',
          message: stoppedByUser ? { ...updatedAssistant, stoppedByUser: true } : updatedAssistant,
        });
      }
      this.emit(conversation.id, {
        type: 'message',
        message: stoppedByUser ? { ...failedMessage, stoppedByUser: true } : failedMessage,
      });
      traceVerbose('chat.context-compaction-finished', traceContext(conversation.id, selection, {
        operation: automatic ? 'automatic' : 'manual',
        status: stopped ? 'aborted' : 'error',
        code: error?.code,
        consecutive_failures: consecutiveFailures,
        chat_stopped: failureLimitReached,
      }));
      if (stopped) return getConversation(conversation.id);
      if (failureLimitReached) {
        const failureLimitError = new Error(
          'Context compression failed 3 consecutive times. Chat stopped.',
          { cause: error },
        );
        failureLimitError.code = 'context_compaction_failure_limit';
        throw failureLimitError;
      }
      throw error;
    } finally {
      if (!automatic) {
        this.finishRun(conversation.id);
      }
    }
  },
};
