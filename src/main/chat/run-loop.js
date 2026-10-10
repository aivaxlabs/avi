import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { effectiveMediaSizeLimit } from '../../shared/attachments.js';
import { executionPlansFromTextualBlocks } from '../../shared/textual-blocks.js';
import {
  checkpointMessage,
  getConversation,
  getGoal,
  getBotSettings,
  getGoalForConversation,
  getMessage,
  getMessages,
  hydratePersistedMediaContent,
  insertMessage,
  listAllConversations,
  listSubagents,
  listTasks,
  messageSnapshot,
  messageToApiBlock,
  toModelMessages,
  updateConversation,
  updateMessage,
} from '../database.js';
import {
  CLIENT_TOOLS,
  decorateToolsForInvocation,
} from '../client-tools.js';
import { applySubagentModelSchema } from '../default-models.js';
import { StreamAccumulator } from '../streaming.js';
import { composeToolsWithPlugins } from '../tool-composition.js';
import { mapToolCalls } from '../tool-concurrency.js';
import {
  minifyToolOutputJson,
  toolOutputLimitForTool,
  truncateToolOutput,
} from '../tool-output.js';
import {
  traceError,
  traceVerbose,
} from '../trace-log.js';
import {
  CONTINUING_GOAL_STATUSES,
  STREAM_PERSIST_INTERVAL_MS,
  STREAM_RENDER_INTERVAL_MS,
  SIDE_CHAT_QUICK_COMPRESSION_MARGIN,
  CROSS_BOT_INBOX_TOOL_NAMES,
  PLAN_TOOL_NAMES,
} from './constants.js';
import {
  modelMessagesToToolHistory,
  isContextLengthError,
  traceContext,
} from './history.js';
import { compatibleSteeredItems } from './queue-order.js';

export const runLoopMethods = {
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
    initialEdits = [],
    initialUsage = null,
    persistedMessages = null,
    resumeAssistantMessage = null,
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
    const persistedMessagesAtStart = persistedMessages ?? getMessages(conversationId);
    const accumulator = new StreamAccumulator({
      segments: initialSegments,
      usage: initialUsage,
    });
    const assistantMessage = resumeAssistantMessageId
      ? resumeAssistantMessage?.id === resumeAssistantMessageId
        && resumeAssistantMessage.status === 'streaming'
        ? updateMessage(resumeAssistantMessage.id, { stoppedByUser: false })
        : updateMessage(resumeAssistantMessageId, {
            status: 'streaming',
            stoppedByUser: false,
            content: accumulator.content,
            segments: accumulator.segments,
            edits: initialEdits,
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
    this.pendingCompletionNotifications.delete(conversationId);
    const run = {
      controller,
      queue,
      startedAt: Date.now(),
      assistantMessageId: assistantMessage.id,
      accumulator,
      fileEdits: [...initialEdits],
      attachments: [...assistantMessage.attachments],
      model,
      reasoningEffort,
      permissionMode,
      workMode,
      ultraMode,
      goalId,
      kind: 'chat',
      phase: 'mcp',
      steerRequested: false,
      consecutiveContextCompactionFailures: 0,
      userMessageIds,
    };
    const completion = Promise.withResolvers();
    const preparation = Promise.withResolvers();
    run.completion = completion.promise;
    run.preparation = preparation.promise;
    this.runs.set(conversationId, run);
    this.noteBotRunStarted(conversationId, assistantMessage.id);
    this.emit(conversationId, { type: 'message', message: assistantMessage });
    this.emit(conversationId, { type: 'run-state', running: true, startedAt: run.startedAt });

    const requestStartedAt = Date.now();
    let lastPersistedAt = 0;
    let lastRenderedAt = 0;
    let persistedAssistant = assistantMessage;
    const persistAssistant = ({ status = 'streaming', force = false } = {}) => this.measureBlocking(conversationId, () => {
      const now = Date.now();
      if (force || status !== 'streaming') {
        lastPersistedAt = now;
        lastRenderedAt = now;
        const message = updateMessage(assistantMessage.id, {
          status,
          content: accumulator.content,
          segments: accumulator.segments,
          edits: run.fileEdits,
          attachments: run.attachments,
          usage: accumulator.usage,
          ...(status === 'aborted' ? { stoppedByUser: Boolean(run.stoppedByUser) } : {}),
        });
        if (message) {
          persistedAssistant = message;
          this.emit(conversationId, { type: 'message', message });
        }
        return message;
      }

      const renderDue = now - lastRenderedAt >= STREAM_RENDER_INTERVAL_MS;
      const persistDue = now - lastPersistedAt >= STREAM_PERSIST_INTERVAL_MS
        || (renderDue && accumulator.segments.length !== persistedAssistant.segments.length);
      if (!persistDue && !renderDue) return null;
      const snapshot = messageSnapshot(conversationId, {
        status,
        content: accumulator.content,
        segments: accumulator.segments,
        edits: run.fileEdits,
        attachments: run.attachments,
        usage: accumulator.usage,
      });
      const message = {
        ...persistedAssistant,
        ...snapshot,
        stoppedByUser: Boolean(run.stoppedByUser),
      };
      if (persistDue) {
        lastPersistedAt = now;
        message.updatedAt = checkpointMessage(assistantMessage.id, conversationId, snapshot);
        persistedAssistant = message;
      }
      if (renderDue) {
        lastRenderedAt = now;
        this.emit(conversationId, { type: 'message', message });
      }
      return message;
    });
    this.logChatTiming(conversationId, null, {
      phase: 'request-start',
      assistantMessageId: assistantMessage.id,
      model,
    });

    let waitingForMcp = false;
    let traceSelection = null;
    try {
      const conversationAtStart = getConversation(conversationId);
      const workspacePath = conversationAtStart?.projectPath;
      const botRuntime = conversationAtStart?.isBot
        ? this.getBotRuntimeContext(conversationId)
        : null;
      waitingForMcp = Boolean(
        workMode !== 'plan'
        && this.mcpManager
        && !this.mcpManager.isWorkspaceReady(workspacePath, botRuntime?.bot.id),
      );
      if (waitingForMcp) {
        this.emit(conversationId, { type: 'mcp-waiting', waiting: true });
      }
      if (workMode !== 'plan' && this.mcpManager) {
        await this.mcpManager.ensureWorkspace(
          workspacePath,
          controller.signal,
          botRuntime?.bot.id,
        );
      }
      if (this.shouldEndAtBoundary(run)) throw new Error('The run was interrupted.');
      for (const waitingUserMessageId of run.userMessageIds) {
        if (getMessage(waitingUserMessageId)?.status !== 'waiting_mcp') continue;
        const sentMessage = updateMessage(waitingUserMessageId, { status: 'sent' });
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

      const preferences = this.getPreferences();
      const tuning = preferences.tuning;
      const aivax = preferences.aivax;
      const contextLimit = botRuntime?.bot.contextSize > 0
        ? botRuntime.bot.contextSize
        : selection.model.context.input;
      const contextTokensAtStart = getConversation(conversationId)?.contextTokens ?? 0;
      if (
        !retryMessages
        && conversationAtStart?.isSideChat
        && contextLimit
        && contextTokensAtStart / contextLimit
          > tuning.automaticCompactionThreshold - SIDE_CHAT_QUICK_COMPRESSION_MARGIN
      ) {
        const compacted = this.compressQuick({ conversationId, automatic: true });
        traceVerbose('chat.side-chat-quick-compression', traceContext(conversationId, selection, {
          context_tokens: contextTokensAtStart,
          context_limit: contextLimit,
          replaced_results: compacted.replacedResults,
          characters_removed: compacted.charactersRemoved,
        }));
      }
      let messages = retryMessages
        ?? toModelMessages(conversationId, {
          excludeMessageId: assistantMessage.id,
          capabilities: selection.model.capabilities,
        });
      const models = this.registry.listModels();
      const currentConversation = getConversation(conversationId);
      const currentGoal = goalId ? getGoal(goalId) : getGoalForConversation(conversationId);
      const goalContinues = currentGoal && CONTINUING_GOAL_STATUSES.has(currentGoal.status);
      const rubberDuckMode = currentConversation?.conversationType === 'rubber_duck';
      const pluginTools = workMode === 'plan' || rubberDuckMode ? [] : this.getPluginTools(conversationId);
      const providerContributionContext = {
        model: selection.model,
        conversation: currentConversation,
        workspacePath,
      };
      const selectedProviderTools = workMode === 'plan' || rubberDuckMode
        ? []
        : selection.provider.getContributions(providerContributionContext).tools;
      const selectedProviderToolNames = new Set(selectedProviderTools.map((tool) => tool.name));
      const providerTools = workMode === 'plan'
        ? []
        : [
            ...selectedProviderTools,
            ...(this.registry.listGlobalTools?.(providerContributionContext) ?? [])
              .filter((tool) => !selectedProviderToolNames.has(tool.name)),
          ];
      const coreTools = CLIENT_TOOLS
          .filter((tool) => rubberDuckMode
            ? [
                'invoke_rubber_duck',
                'rubber_duck_ask_agent',
                'rubber_duck_submit_report',
                'get_chat_attachments',
                'read_media_file',
                'read_file',
                'read_url',
              ].includes(tool.name)
            : ![
                'rubber_duck_ask_agent',
                'rubber_duck_submit_report',
                ...(currentConversation?.conversationType === 'rubber_duck_subject'
                  ? ['invoke_rubber_duck', 'start_goal', 'update_goal_status']
                  : []),
              ].includes(tool.name))
          .filter((tool) => (
            tool.name !== 'read_media_file'
            || selection.model.capabilities?.images
            || selection.model.capabilities?.video
            || selection.model.capabilities?.audio
            || selection.model.capabilities?.pdfFiles
            || (aivax?.connected && aivax.mediaDescriptionsEnabled)
          ))
          .filter((tool) => workMode !== 'plan' || PLAN_TOOL_NAMES.has(tool.name))
          .filter((tool) => !['memory_search', 'memory_write', 'memory_delete'].includes(tool.name) || (
            aivax?.connected && aivax.memoryEnabled && aivax.memoryCollectionId
          ))
          .filter((tool) => tool.name !== 'web_search' || (
            aivax?.connected && aivax.webSearchEnabled
          ))
          .filter((tool) => tool.name !== 'start_goal' || !goalContinues)
          .filter((tool) => tool.name !== 'update_goal_status' || goalContinues)
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
            || (!currentConversation?.isSubagent && !currentConversation?.isSideChat)
          ))
          .map((tool) => {
            if (tool.name === 'read_media_file') {
              const supportedMedia = [
                selection.model.capabilities?.images && 'images',
                selection.model.capabilities?.video && 'videos',
                selection.model.capabilities?.audio && 'MP3 audio',
                selection.model.capabilities?.pdfFiles && 'PDF files',
              ].filter(Boolean);
              const fallbackDescription = aivax?.connected && aivax.mediaDescriptionsEnabled
                ? ' AIVAX Media Descriptions converts unsupported images, videos, audio, and PDFs to text.'
                : '';
              return {
                ...tool,
                description: supportedMedia.length > 0
                  ? `Read local ${supportedMedia.join(', ')} using the selected model multimodally.${fallbackDescription} Text files are not supported. Media already attached to the conversation is delivered to you directly; never call this tool on attachments already in context.`
                  : `Read local images, videos, audio, and PDFs as text using AIVAX Media Descriptions. Text files are not supported. Media already attached to the conversation is delivered to you directly; never call this tool on attachments already in context.`,
              };
            }
            if (['chat_create_thread', 'chat_spawn_subagent'].includes(tool.name)) {
              return {
                ...tool,
                ...(botRuntime && tool.name === 'chat_create_thread'
                  ? {
                      description: 'Create a worker thread only for a genuinely long-running or context-heavy deliverable. Bots must execute exploration, research, listings, data collection, status checks, audits, and short diagnostics directly instead of creating a thread.',
                    }
                  : {}),
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
          });
      const toolHistory = initialToolHistory.map((round) => ({
        ...round,
        toolCalls: [...round.toolCalls],
        results: [...round.results],
      }));
      const persistedResultCallIds = new Set(
        messages
          .filter((message) => message.role === 'tool' && message.tool_call_id)
          .map((message) => message.tool_call_id),
      );
      const firstPersistedToolRound = messages.findIndex((message) => (
        message.role === 'assistant'
        && message.tool_calls?.some((toolCall) => !persistedResultCallIds.has(toolCall.id))
      ));
      if (firstPersistedToolRound >= 0) {
        const persistedMessages = messages.slice(firstPersistedToolRound);
        messages = messages.slice(0, firstPersistedToolRound);
        toolHistory.push(...modelMessagesToToolHistory(
          persistedMessages,
          persistedMessagesAtStart,
          selection.model,
        ));
      }
      const knownToolCallIds = new Set(toolHistory.flatMap((round) => (
        round.toolCalls.map((toolCall) => toolCall.callId)
      )));
      const checkpointIndex = currentConversation?.checkpointMessageId
        ? persistedMessagesAtStart.findIndex((message) => (
            message.id === currentConversation.checkpointMessageId
          ))
        : -1;
      for (const sourceMessage of persistedMessagesAtStart.slice(checkpointIndex + 1)) {
        if (sourceMessage.role !== 'assistant') continue;
        const orphanSegments = sourceMessage.segments.filter((segment) => (
          !segment.compacted
          && segment.type === 'tool-call'
          && segment.callId
          && segment.name
          && segment.resultText === undefined
          && !knownToolCallIds.has(segment.callId)
        ));
        for (const orphanSegment of orphanSegments) {
          const round = Number(orphanSegment.key?.match(/^round:(\d+):/)?.[1]);
          const roundSegments = sourceMessage.segments.filter((segment) => (
            !segment.compacted
            && segment.type === 'tool-call'
            && segment.callId
            && segment.name
            && Number(segment.key?.match(/^round:(\d+):/)?.[1]) === round
          ));
          const toolCalls = roundSegments.filter((segment) => !knownToolCallIds.has(segment.callId));
          if (toolCalls.length === 0) continue;
          for (const segment of toolCalls) knownToolCallIds.add(segment.callId);
          toolHistory.push({
            assistantContent: sourceMessage.content,
            reasoningContent: sourceMessage.segments
              .filter((segment) => !segment.compacted && segment.type === 'reasoning')
              .map((segment) => segment.text ?? '')
              .join(''),
            continuation: [],
            toolCalls: toolCalls.map((segment) => ({
              key: segment.key,
              callId: segment.callId,
              name: segment.name,
              argumentsText: segment.argumentsText ?? '',
            })),
            results: roundSegments
              .filter((segment) => segment.resultText !== undefined)
              .map((segment) => ({
                callId: segment.callId,
                output: segment.resultText,
                ...(segment.mediaContent?.length
                  ? { mediaContent: hydratePersistedMediaContent(segment.mediaContent) }
                  : {}),
                isError: segment.status === 'error',
              })),
            messages: [],
            sourceMessageId: sourceMessage.id,
          });
        }
      }
      let liveContextTokens = currentConversation?.contextTokens ?? 0;
      let finalAssistantContent = '';
      let firstResponseAt = null;
      let retriedAfterContextCompaction = false;
      let contextCompactionRequested = false;
      let roundTools = [];
      const applyCompactionCheckpoint = (compressedConversation) => {
        toolHistory.length = 0;
        accumulator.segments = accumulator.segments.map((segment) => (
          segment.type === 'context-compression' ? segment : { ...segment, compacted: true }
        ));
        accumulator.usage = null;
        accumulator.error = null;
        liveContextTokens = compressedConversation.contextTokens;
        contextCompactionRequested = false;
        persistAssistant({ force: true });
        messages = toModelMessages(conversationId, {
          excludeMessageId: assistantMessage.id,
          capabilities: selection.model.capabilities,
        });
      };
      this.sendPluginEvent('inference.request.started', {
        threadId: conversationId,
        runId: assistantMessage.id,
        providerId: selection.model.providerId,
        data: {
          model: selection.model.id,
          reasoningEffort,
          workMode,
          ultraMode,
        },
      });
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
        const pendingRoundIndex = toolHistory.findIndex((round) => {
          const resultCallIds = new Set(round.results.map((result) => result.callId));
          return round.toolCalls.some((toolCall) => !resultCallIds.has(toolCall.callId));
        });
        const roundIndex = pendingRoundIndex >= 0 ? pendingRoundIndex : toolHistory.length;
        const roundSegmentStart = accumulator.segments.length;
        const mcpRuntime = workMode === 'plan' || !this.mcpManager
          ? { tools: [], instructions: [] }
          : botRuntime
            ? this.mcpManager.runtimeForBot(workspacePath, botRuntime.bot.id)
            : this.mcpManager.runtimeForWorkspace(workspacePath);
        if (rubberDuckMode) {
          mcpRuntime.tools = mcpRuntime.tools.filter((tool) => (
            tool.canEditFile === false && tool.canPerformDestructiveActions === false
          ));
        }
        const extensionTools = [
          ...(rubberDuckMode ? [] : botRuntime?.tools ?? []),
          ...providerTools.map((tool) => ({ ...tool, providerTool: true })),
          ...mcpRuntime.tools,
        ];
        const availableTools = decorateToolsForInvocation(
          composeToolsWithPlugins(coreTools, pluginTools, extensionTools),
          permissionMode,
          { honorExplicitAuthorization: Boolean(botRuntime) },
        );
        roundTools = availableTools;
        const latestGoal = goalId ? getGoal(goalId) : getGoalForConversation(conversationId);
        const goalContext = workMode !== 'plan' && latestGoal && CONTINUING_GOAL_STATUSES.has(latestGoal.status)
          ? latestGoal
          : null;
        const teamRootId = currentConversation?.isSubagent || currentConversation?.isSideChat
          ? currentConversation.parentConversationId
          : currentConversation?.id;
        const hasSubagents = Boolean(teamRootId && listSubagents(teamRootId).length > 0);
        const hasThreads = hasSubagents
          || listAllConversations().some((conversation) => (
            conversation.id !== conversationId
            && (currentConversation?.isSideChat || !conversation.isSideChat)
            && conversation.projectPath === currentConversation?.projectPath
          ));
        const pendingRound = pendingRoundIndex >= 0 ? toolHistory[pendingRoundIndex] : null;
        if (!pendingRound) {
          run.phase = 'inference';
          this.sendPluginEvent('inference.turn.started', {
            threadId: conversationId,
            runId: assistantMessage.id,
            providerId: selection.model.providerId,
            data: { round: roundIndex, model: selection.model.id, toolCount: availableTools.length },
          });
        }
        let turn;
        try {
          turn = pendingRound ?? await this.withThreadCapacity(conversationId, controller.signal, () => selection.provider.stream({
            model: selection.model,
            messages,
            tools: availableTools,
            toolHistory,
            reasoningEffort,
            invocationContext: {
              conversationId,
              workspacePath,
              traceOperation: 'chat',
              modelRules: preferences.defaultModels?.rules ?? [],
              traceRound: roundIndex,
              mcpInstructions: mcpRuntime.instructions,
              ...this.getPluginContext({
                conversationId,
                workspacePath,
                botId: botRuntime?.bot.id ?? null,
              }),
              ...(botRuntime ? { bot: this.describeInvocationBot(conversationId) } : {}),
              permissionMode,
              workMode,
              ultraMode,
              orchestrationRole: currentConversation?.isSubagent
                ? 'subagent'
                : currentConversation?.isSideChat
                  ? 'side_chat'
                  : currentConversation?.conversationType === 'rubber_duck'
                    ? 'supervisor'
                    : currentConversation?.conversationType === 'rubber_duck_subject'
                      ? 'subject'
                      : 'orchestrator',
              goal: goalContext,
              tasks: listTasks(conversationId),
              semaphoreHoldings: this.semaphores.holdings(conversationId),
              hasSubagents,
              hasThreads,
              tuning,
              aivax,
              onPrepared: () => preparation.resolve(),
            },
            signal: controller.signal,
            onEvent: (event) => this.measureBlocking(conversationId, () => {
              if (['content', 'reasoning', 'tool-call', 'usage', 'error', 'retry'].includes(event.type)) {
                this.sendPluginEvent('inference.delta', {
                  threadId: conversationId,
                  runId: assistantMessage.id,
                  providerId: selection.model.providerId,
                  data: { round: roundIndex, event },
                });
              }
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
                const compactionNeeded = Boolean(
                  contextLimit
                  && liveContextTokens / contextLimit > tuning.automaticCompactionThreshold,
                );
                if (compactionNeeded && !contextCompactionRequested) {
                  traceVerbose('chat.context-compaction-triggered', traceContext(conversationId, selection, {
                    context_tokens: liveContextTokens,
                    context_limit: contextLimit,
                    compaction_ratio: liveContextTokens / contextLimit,
                  }));
                }
                contextCompactionRequested = compactionNeeded;
              }
              if (event.type === 'retry' && event.discardOutput) {
                accumulator.segments.splice(roundSegmentStart);
              }
              const eventTool = event.type === 'tool-call'
                ? availableTools.find((tool) => tool.name === event.name)
                : null;
              accumulator.apply(event.type === 'tool-call'
                ? {
                    ...event,
                    key: `round:${roundIndex}:${event.key ?? event.callId ?? 'tool'}`,
                    isMcp: Boolean(eventTool?.mcp),
                    mcpServerName: eventTool?.mcp?.serverName ?? null,
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
            }),
          }));
          if (!pendingRound) {
            this.sendPluginEvent('inference.turn.completed', {
              threadId: conversationId,
              runId: assistantMessage.id,
              providerId: selection.model.providerId,
              data: { round: roundIndex, toolCallCount: turn.toolCalls.length },
            });
            retriedAfterContextCompaction = false;
          }
        } catch (error) {
          this.sendPluginEvent('inference.turn.failed', {
            threadId: conversationId,
            runId: assistantMessage.id,
            providerId: selection.model.providerId,
            data: { round: roundIndex, message: error instanceof Error ? error.message : String(error) },
          });
          const errorText = `${error?.code ?? ''} ${
            error instanceof Error ? error.message : String(error)
          }`.toLowerCase();
          if (!isContextLengthError(error) || retriedAfterContextCompaction) throw error;

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
            contextTools: availableTools,
            streamingSegments: accumulator.segments.slice(roundSegmentStart),
          });
          retriedAfterContextCompaction = true;
          applyCompactionCheckpoint(compressedConversation);
          continue;
        }
        if (!pendingRound) {
          accumulator.apply({
            type: 'provider-continuation',
            round: roundIndex,
            model: selection.model.id,
            interface: selection.model.interface,
            items: turn.continuation,
          });
          persistAssistant({ force: true });
        }
        run.phase = 'boundary';
        if (controller.signal.aborted) throw new Error('The run was interrupted.');
        if (
          rubberDuckMode
          && roundIndex + 1 >= tuning.rubberDuckMaxTurns
          && !run.rubberDuckLimitNotified
          && !turn.toolCalls.some((toolCall) => toolCall.name === 'rubber_duck_submit_report')
        ) {
          run.rubberDuckLimitNotified = true;
          await this.send({
            conversationId,
            model,
            text: 'The Rubber Duck Max Turns soft limit has been reached. Submit the report immediately with rubber_duck_submit_report. Do not ask another question.',
            steer: true,
            fromAgent: true,
            permissionMode,
            project: { path: workspacePath },
          });
        }
        if (turn.toolCalls.length === 0) {
          finalAssistantContent = turn.assistantContent;
          break;
        }

        if (turn.toolCalls.some((toolCall) => !toolCall.callId || !toolCall.name)) {
          throw new Error('The provider returned a tool call without a call ID or name.');
        }
        const sourceToolMessage = pendingRound?.sourceMessageId
          ? persistedMessagesAtStart.find((message) => message.id === pendingRound.sourceMessageId)
          : null;
        const repairsCurrentAssistant = sourceToolMessage?.id === assistantMessage.id;
        const toolAccumulator = repairsCurrentAssistant
          ? accumulator
          : sourceToolMessage
            ? new StreamAccumulator({
                segments: sourceToolMessage.segments,
                usage: sourceToolMessage.usage,
              })
            : accumulator;
        const persistToolState = sourceToolMessage && !repairsCurrentAssistant
          ? () => this.measureBlocking(conversationId, () => {
              const message = updateMessage(sourceToolMessage.id, {
                content: toolAccumulator.content,
                segments: toolAccumulator.segments,
              });
              this.emit(conversationId, { type: 'message', message });
              return message;
            })
          : persistAssistant;
        if (
          turn.toolCalls.length > 1
          && turn.toolCalls.some((toolCall) => toolCall.name === 'sleep_semaphore')
        ) {
          const semaphoreRoundError = 'sleep_semaphore must be the only tool call in its model round. Call it before any protected work. Nothing in this round was executed and no permit was acquired. Resend sleep_semaphore alone, or resend the other calls without it.';
          const semaphoreRoundResults = turn.toolCalls.map((toolCall) => ({
            callId: toolCall.callId,
            output: `Error: ${semaphoreRoundError}`,
            isError: true,
          }));
          for (const result of semaphoreRoundResults) {
            toolAccumulator.apply({
              type: 'tool-result',
              callId: result.callId,
              output: result.output,
              isError: true,
            });
          }
          persistToolState({ force: true });
          const semaphoreRound = {
            ...turn,
            reasoningContent: turn.reasoningContent ?? accumulator.segments
              .slice(roundSegmentStart)
              .filter((segment) => segment.type === 'reasoning')
              .map((segment) => segment.text ?? '')
              .join(''),
            results: semaphoreRoundResults,
          };
          if (pendingRound) toolHistory[pendingRoundIndex] = semaphoreRound;
          else toolHistory.push(semaphoreRound);
          continue;
        }
        const existingResults = new Map(
          (turn.results ?? []).map((result) => [result.callId, result]),
        );
        const pendingResults = await mapToolCalls(
          turn.toolCalls.filter((toolCall) => !existingResults.has(toolCall.callId)),
          async (toolCall) => {
          let tool = availableTools.find((item) => item.name === toolCall.name);
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
          const requiresHumanApproval = {
            true: true,
            false: false,
          }[String(args?.__requires_human_approval).trim().toLowerCase()];
          let input = args && typeof args === 'object' && !Array.isArray(args)
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
          toolAccumulator.apply({
            type: 'tool-call',
            key: String(toolCall.key ?? '').startsWith('round:')
              ? toolCall.key
              : `round:${roundIndex}:${toolCall.key ?? toolCall.callId}`,
            callId: toolCall.callId,
            name: toolCall.name,
            argumentsText: toolCall.argumentsText,
            replaceArguments: true,
            invocationGoal,
            requiresHumanApproval: requiresHumanApproval === true,
            isMcp: isMcpTool,
            mcpServerName: tool?.mcp?.serverName ?? null,
          });
          persistToolState({ force: true });

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

            const intercepted = await this.beforeToolExecute({
              tool: {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                pluginId: tool.pluginId ?? null,
                isMcp: isMcpTool,
              },
              input,
              threadId: conversationId,
              botId: botRuntime?.bot.id ?? null,
              model,
              workspacePath,
              invocationGoal,
              requiresHumanApproval,
            });
            input = intercepted.input;
            const needsApproval = tool.approval !== 'never'
              && (tool.forceApproval || requiresHumanApproval || intercepted.requireApproval)
              && permissionMode !== 'full_access'
              && (intercepted.inputChanged || !this.approvedToolPatterns.has(approvalPattern));
            if (needsApproval && botRuntime) {
              const queuedApproval = await this.queueBotToolApproval({
                conversationId,
                toolName: toolCall.name,
                invocationSummary,
                workspacePath,
                input,
              });
              if (queuedApproval) {
                output = `Queued in the Inbox for user approval (id: ${queuedApproval.id}, pendency: ${queuedApproval.pendencyId}). Do not retry this tool until the user decides. Continue with other independent work and answer in this pendency after the decision.`;
                tool = { ...tool, execute: () => output };
              }
            } else if (needsApproval) {
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
                  conversationId,
                  toolName: toolCall.name,
                  invocationSummary,
                  workspacePath,
                  input,
                  approvalPattern,
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

            if (tool.name === 'chat_spawn_subagent' && !this.canCreateDisposableConversation()) {
              throw new Error('Sub-agents cannot be created during forced cleanup.');
            }
            run.phase = 'tool';
            toolStartedAt = Date.now();
            const executionInput = tool.name === 'openai_subscription_generate_or_edit_image'
              && Array.isArray(input.referenced_image_paths)
              ? {
                  ...input,
                  referenced_image_paths: input.referenced_image_paths.map((path) => {
                    const match = String(path).match(/^\/mnt\/data\/(\d+)(?:\.[^/\\]+)?$/i);
                    if (!match) return path;

                    const imageAttachments = run.userMessageIds
                      .map((messageId) => getMessage(messageId))
                      .filter(Boolean)
                      .flatMap((message) => message.attachments)
                      .filter((attachment) => (
                        attachment.kind === 'image_url'
                        && typeof attachment.path === 'string'
                      ));
                    const attachment = imageAttachments[Number(match[1])];
                    if (!attachment) {
                      throw new Error(`Uploaded image reference ${path} is not available in this turn.`);
                    }
                    return attachment.path;
                  }),
                }
              : input;
            const value = await tool.execute(executionInput, tool.providerTool
              ? {
                  signal: controller.signal,
                  workspacePath,
                }
              : {
              signal: controller.signal,
              workspacePath,
                  chatRunner: this,
              botManager: this.getBotManager(),
              conversationId,
              model,
              models,
              botRuntime,
              reasoningEffort,
              permissionMode,
              workMode,
              ultraMode,
              goal: goalContext,
              tuning,
              aivax,
              defaultModels: preferences.defaultModels,
              capabilities: selection.model.capabilities,
              mediaSizeLimit: effectiveMediaSizeLimit(selection.model, tuning),
              userAttachments: getMessages(conversationId)
                .filter((message) => message.role === 'user')
                .flatMap((message) => message.attachments),
            });
            const generatedAttachments = Array.isArray(value?.attachments)
              ? value.attachments.filter((attachment) => (
                  attachment?.kind === 'image_url'
                  && attachment.source === 'generated_image'
                  && typeof attachment.path === 'string'
                  && typeof attachment.dataUrl === 'string'
                ))
              : [];
            for (const attachment of generatedAttachments) {
              if (run.attachments.some((current) => (
                current.id === attachment.id || current.path === attachment.path
              ))) continue;
              run.attachments.push(attachment);
            }
            const fileChanges = Array.isArray(value?.fileChanges) ? value.fileChanges : [];
            for (const change of fileChanges) {
              if (
                typeof change?.filePath !== 'string'
                || (change.before !== null && typeof change.before !== 'string')
                || typeof change.after !== 'string'
              ) continue;
              const existingIndex = run.fileEdits.findIndex(
                (edit) => edit.filePath === change.filePath,
              );
              const edit = existingIndex >= 0
                ? { ...run.fileEdits[existingIndex], after: change.after }
                : { filePath: change.filePath, before: change.before, after: change.after };
              if (edit.before === edit.after) {
                if (existingIndex >= 0) run.fileEdits.splice(existingIndex, 1);
              } else if (existingIndex >= 0) {
                run.fileEdits[existingIndex] = edit;
              } else {
                run.fileEdits.push(edit);
              }
            }
            if (value && typeof value === 'object' && typeof value.output === 'string') {
              output = value.output;
              if (tool.name === 'sleep_semaphore' && value.suspendRun === true) {
                run.suspendAfterTools = true;
              }
              if (Array.isArray(value.mediaContent)) mediaContent = value.mediaContent;
            } else {
              output = typeof value === 'string'
                ? value
                : JSON.stringify(value && typeof value === 'object'
                  ? Object.fromEntries(
                      Object.entries(value).filter(([key]) => key !== 'fileChanges'),
                    )
                  : value);
            }
            output = await this.afterToolExecute({
              tool: {
                name: tool.name,
                description: tool.description,
                pluginId: tool.pluginId ?? null,
                isMcp: isMcpTool,
              },
              input,
              output,
              isError: false,
              threadId: conversationId,
              botId: botRuntime?.bot.id ?? null,
              model,
              workspacePath,
            });
            if (typeof output !== 'string') output = JSON.stringify(output);
          } catch (error) {
            isError = true;
            toolError = error instanceof Error ? error.message : String(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            output = toolCall.name === 'ask_question'
              ? `Error: ${errorMessage}\nNo user answer was collected. Correct the arguments and call ask_question again. Do not infer an answer.`
              : `Error: ${errorMessage}`;
            try {
              output = await this.afterToolExecute({
                tool: {
                  name: tool?.name ?? toolCall.name,
                  description: tool?.description,
                  pluginId: tool?.pluginId ?? null,
                  isMcp: isMcpTool,
                },
                input,
                output,
                isError: true,
                threadId: conversationId,
                botId: botRuntime?.bot.id ?? null,
                model,
                workspacePath,
              });
              if (typeof output !== 'string') output = JSON.stringify(output);
            } catch (interceptorError) {
              traceError('plugin.tool-error-interceptor-failed', {
                conversation_id: conversationId,
                tool_name: tool?.name ?? toolCall.name,
                error: interceptorError instanceof Error ? interceptorError.message : String(interceptorError),
              });
            }
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

          const outputLimit = toolOutputLimitForTool(
            tool,
            tuning.toolOutputLimit,
          );
          output = truncateToolOutput(
            minifyToolOutputJson(output, outputLimit),
            outputLimit,
          );
          const result = {
            callId: toolCall.callId,
            output,
            ...(mediaContent?.length ? { mediaContent } : {}),
            isError,
          };
          toolAccumulator.apply({
            type: 'tool-result',
            callId: toolCall.callId,
            output,
            isError,
            mediaContent,
          });
          persistToolState({ force: true });
          return result;
        });
        for (const result of pendingResults) existingResults.set(result.callId, result);
        const completedRound = {
          ...turn,
          reasoningContent: turn.reasoningContent ?? accumulator.segments
            .slice(roundSegmentStart)
            .filter((segment) => segment.type === 'reasoning')
            .map((segment) => segment.text ?? '')
            .join(''),
          results: turn.toolCalls
            .map((toolCall) => existingResults.get(toolCall.callId))
            .filter(Boolean),
        };
        if (pendingRound) toolHistory[pendingRoundIndex] = completedRound;
        else toolHistory.push(completedRound);
        if (run.suspendAfterTools) {
          if (!run.semaphoreResume) run.queuePaused = true;
          break;
        }
        if (run.endAfterTools || run.botIdleRequested) break;
        if (contextCompactionRequested) {
          this.emit(conversationId, { type: 'run-state', running: true, startedAt: run.startedAt });
          try {
            const compressedConversation = await this.compress({
              conversationId,
              model,
              automatic: true,
              controller,
              contextMessages: messages,
              contextToolHistory: toolHistory,
              contextTools: availableTools,
            });
            applyCompactionCheckpoint(compressedConversation);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logChatTiming(conversationId, selection, {
              phase: 'context-compaction-error',
              model: selection.model.modelId,
              error: message,
            });
            if (
              controller.signal.aborted
              || error?.code === 'context_compaction_failure_limit'
            ) throw error;
            this.emit(conversationId, {
              type: 'error',
              message: `Automatic context compaction failed: ${message}`,
            });
          }
        }

        const steeredItems = compatibleSteeredItems(run.queue);
        if (steeredItems.length > 0) {
          const nextSelection = this.registry.resolve(steeredItems[0].model);
          if (!nextSelection) {
            throw new Error('The steered model is no longer configured. Choose another model in Settings.');
          }
          const steerMessages = steeredItems.map((item) => (
            messageToApiBlock(getMessage(item.userMessageId), nextSelection.model.capabilities)
          ));
          const canReuseContinuation = selection.model.providerId === nextSelection.model.providerId
            && selection.model.interface === nextSelection.model.interface
            && selection.model.id === nextSelection.model.id;
          const continuationToolHistory = toolHistory.map((round) => ({
            ...round,
            ...(canReuseContinuation ? {} : { continuation: [] }),
            toolCalls: [...round.toolCalls],
            results: [...round.results],
          }));
          if (continuationToolHistory.length > 0) {
            continuationToolHistory.at(-1).messages = steerMessages;
          } else {
            messages = [...messages, ...steerMessages];
          }
          run.steerContinuation = {
            items: steeredItems,
            messages,
            toolHistory: continuationToolHistory,
          };
          break;
        }
      }

      accumulator.finish();
      if (run.steerContinuation) {
        persistAssistant({ status: 'completed', force: true });
        this.logChatTiming(conversationId, selection, {
          phase: 'inference-completed',
          assistantMessageId: assistantMessage.id,
          model: selection.model.modelId,
          elapsedMs: Date.now() - requestStartedAt,
        });
        return;
      }
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
      run.completedAssistantMessage = completedMessage;
      const executionPlans = executionPlansFromTextualBlocks(completedMessage.content);
      if (executionPlans.length === 1) {
        const conversation = getConversation(conversationId);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rawTitle = String(conversation?.title ?? '').trim();
        const sanitizedTitle = rawTitle
          .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
          .replace(/[. ]+$/g, '')
          .slice(0, 100)
          || 'plan';
        const fileName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitizedTitle)
          ? `plan-${sanitizedTitle}`
          : sanitizedTitle;
        const planningDirectory = join(
          conversation?.projectPath ?? process.cwd(),
          '.agents',
          'plannings',
          timestamp,
        );
        try {
          mkdirSync(planningDirectory, { recursive: true });
          writeFileSync(join(planningDirectory, `${fileName}.md`), `${executionPlans[0]}\n`, 'utf8');
        } catch (error) {
          traceError('plan.persistence-error', {
            thread_id: conversationId,
            path: planningDirectory,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!run.suspendAfterTools) {
        await this.forwardSubagentResult(completedMessage, run.permissionMode);
      }
      this.sendPluginEvent('inference.request.completed', {
        threadId: conversationId,
        runId: assistantMessage.id,
        providerId: selection.model.providerId,
        data: { model: selection.model.id, usage: accumulator.usage },
      });
      this.logChatTiming(conversationId, selection, {
        phase: 'message-completed',
        assistantMessageId: assistantMessage.id,
        model: selection.model.modelId,
        usage: accumulator.usage,
        elapsedMs: Date.now() - requestStartedAt,
      });
      if (contextCompactionRequested) {
        this.emit(conversationId, { type: 'run-state', running: true, startedAt: run.startedAt });
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
            contextTools: roundTools,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logChatTiming(conversationId, selection, {
            phase: 'context-compaction-error',
            model: selection.model.modelId,
            error: message,
          });
          if (
            controller.signal.aborted
            || error?.code === 'context_compaction_failure_limit'
          ) throw error;
          this.emit(conversationId, {
            type: 'error',
            message: `Automatic context compaction failed: ${message}`,
          });
        }
      }
    } catch (error) {
      const aborted = controller.signal.aborted && !run.watchdogError;
      const message = run.watchdogError ?? (error instanceof Error ? error.message : String(error));
      if (waitingForMcp) {
        waitingForMcp = false;
        this.emit(conversationId, { type: 'mcp-waiting', waiting: false });
      }
      if (!aborted && !accumulator.error) {
        accumulator.apply({
          type: 'error',
          code: run.watchdogError
            ? 'watchdog_stopped'
            : typeof error?.code === 'string' && error.code ? error.code : 'provider_error',
          message,
        });
      }
      accumulator.finish();
      const failedAssistantMessage = persistAssistant({
        status: aborted ? 'aborted' : 'error',
        force: true,
      });
      await this.forwardSubagentResult(failedAssistantMessage, run.permissionMode);
      for (const failedUserMessageId of run.userMessageIds) {
        if (aborted && getMessage(failedUserMessageId)?.status !== 'waiting_mcp') continue;
        const failedUserMessage = updateMessage(failedUserMessageId, {
          status: aborted ? 'aborted' : 'error',
          ...(aborted ? { stoppedByUser: Boolean(run.stoppedByUser) } : {}),
        });
        if (failedUserMessage) {
          this.emit(conversationId, { type: 'message', message: failedUserMessage });
        }
      }
      this.sendPluginEvent('inference.request.failed', {
        threadId: conversationId,
        runId: assistantMessage.id,
        providerId: traceSelection?.model.providerId,
        data: { model, aborted, message },
      });
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
      preparation.resolve();
      try {
        if (!this.shuttingDown) {
          try {
            this.noteBotRunFinished(conversationId, assistantMessage.id);
          } catch (error) {
            traceError('bots.run-finished-error', {
              thread_id: conversationId,
              message_id: assistantMessage.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        this.finishRun(conversationId);
      } finally {
        completion.resolve();
      }
    }
  },
};
