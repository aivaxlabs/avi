import { performance } from 'node:perf_hooks';
import { getPreferences as readPreferences } from './database.js';
import { SemaphoreManager } from './semaphore-manager.js';
import { traceError } from './trace-log.js';
import { auxiliaryPromptMethods } from './chat/auxiliary-prompts.js';
import { rubberDuckMethods } from './chat/rubber-duck.js';
import { goalMethods } from './chat/goals.js';
import { messagingMethods } from './chat/messaging.js';
import { contextMethods } from './chat/context.js';
import { runLoopMethods } from './chat/run-loop.js';
import { semaphoreMethods } from './chat/semaphores.js';
import { interactionMethods } from './chat/interactions.js';
import { completionMethods } from './chat/completion.js';
import { capacityMethods } from './chat/capacity.js';
import { WATCHDOG_INTERVAL_MS } from './chat/constants.js';
import { watchdogMethods } from './chat/watchdog.js';

export class ChatRunner {
  constructor({
    registry,
    mcpManager,
    getPreferences = readPreferences,
    getPluginTools = () => [],
    getPluginContext = () => ({}),
    getBotRuntimeContext = () => null,
    getBotManager = () => null,
    describeInvocationBot = () => null,
    queueBotToolApproval = () => null,
    noteBotUserInteraction = () => false,
    noteBotRunStarted = () => {},
    noteBotRunFinished = () => {},
    noteBotRunStopped = () => {},
    canCreateDisposableConversation = () => true,
    beforeToolExecute = async ({ input }) => ({ input, requireApproval: false }),
    afterToolExecute = async ({ output }) => output,
    sendPluginEvent = () => {},
    sendEvent,
    sendCompletionNotification,
    savePermissionGuidance,
    stopBackgroundTasks,
  }) {
    this.registry = registry;
    this.mcpManager = mcpManager;
    this.getPreferences = getPreferences;
    this.getPluginTools = getPluginTools;
    this.getPluginContext = getPluginContext;
    this.getBotRuntimeContext = getBotRuntimeContext;
    this.getBotManager = getBotManager;
    this.describeInvocationBot = describeInvocationBot;
    this.queueBotToolApproval = queueBotToolApproval;
    this.noteBotUserInteraction = noteBotUserInteraction;
    this.noteBotRunStarted = noteBotRunStarted;
    this.noteBotRunFinished = noteBotRunFinished;
    this.noteBotRunStopped = noteBotRunStopped;
    this.canCreateDisposableConversation = canCreateDisposableConversation;
    this.beforeToolExecute = beforeToolExecute;
    this.afterToolExecute = afterToolExecute;
    this.sendPluginEvent = sendPluginEvent;
    this.sendEvent = sendEvent;
    this.sendCompletionNotification = sendCompletionNotification;
    this.savePermissionGuidance = savePermissionGuidance;
    this.stopBackgroundTasks = stopBackgroundTasks;
    this.runs = new Map();
    this.pausedQueues = new Map();
    this.replacingConversations = new Set();
    this.pendingApprovals = new Map();
    this.pendingQuestions = new Map();
    this.approvedToolPatterns = new Set();
    this.continuationGenerations = new Map();
    this.pendingCompletionNotifications = new Map();
    this.rubberDuckReports = new Map();
    this.rubberDuckInterviews = new Map();
    this.shuttingDown = false;
    this.capacityHolders = new Set();
    this.capacityQueue = [];
    this.blockingTime = new Map();
    this.watchdogStalls = 0;
    this.watchdogWindowStartedAt = performance.now();
    this.watchdogExpectedAt = this.watchdogWindowStartedAt + WATCHDOG_INTERVAL_MS;
    this.watchdogTimer = setInterval(() => this.watchdogTick(), WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref();
    this.semaphores = new SemaphoreManager({
      onChanged: (waits) => {
        this.sendEvent({
          type: 'semaphore-state',
          waits,
          semaphores: this.semaphores?.globalSnapshot() ?? [],
        });
      },
      onReady: (waiter) => {
        void this.resumeSemaphore(waiter).catch((error) => {
          const message = `Semaphore "${waiter.name}" was granted, but the thread could not resume: ${error instanceof Error ? error.message : String(error)}`;
          try {
            this.setSemaphoreBlocked({
              conversationId: waiter.conversationId,
              name: waiter.name,
              blocked: true,
              summary: message,
            });
          } catch (blockError) {
            traceError('semaphore.resume-block-error', {
              thread_id: waiter.conversationId,
              semaphore: waiter.name,
              error: blockError instanceof Error ? blockError.message : String(blockError),
            });
          }
          this.emit(waiter.conversationId, { type: 'error', message });
        });
      },
    });
    this.semaphores.cleanMissingConversations();
  }
}

for (const group of [
  auxiliaryPromptMethods,
  rubberDuckMethods,
  goalMethods,
  messagingMethods,
  contextMethods,
  runLoopMethods,
  semaphoreMethods,
  interactionMethods,
  completionMethods,
  capacityMethods,
  watchdogMethods,
]) {
  Object.defineProperties(
    ChatRunner.prototype,
    Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(group)).map(([name, descriptor]) => [
        name,
        { ...descriptor, enumerable: false },
      ]),
    ),
  );
}
