import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-interruption-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;
const composerSource = readFileSync(
  new URL('../src/renderer/components/Composer.jsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/renderer/App.jsx', import.meta.url),
  'utf8',
);
assert.match(
  composerSource,
  /onClick=\{\(\) => onStop\(\)\}\s+aria-label="Stop"/,
);
assert.match(
  appSource,
  /result\?\.reordered && result\?\.steered && message\.id === steerMessageId/,
);
assert.match(composerSource, /disabled=\{queueMutationPending\}/);
assert.match(composerSource, /queueType: 'steer'/);
assert.match(composerSource, /queueType: 'queue'/);
assert.match(composerSource, /onReorderQueued\(section\.queueType, messageIds\)/);
assert.match(composerSource, /Prioritize after the current assistant turn/);
assert.doesNotMatch(composerSource, /Stop the current response and send this message next/);
assert.match(appSource, /steerMessageIds \?\? \[\]/);
assert.match(appSource, /queuedMessageIds \?\? \[\]/);
assert.match(appSource, /api\.plugins\.restoreReload\(\)/);
assert.match(appSource, /restoredReload\.conversationIds\.map\(async \(id\)/);
assert.match(appSource, /api\.plugins\.completeReload\(\)/);
assert.match(appSource, /selectedConversationIdRef\.current === conversationId[\s\S]*setDraftModel\(result\.conversation\.model\)/);
assert.match(appSource, /window\.localStorage\.setItem\('aivax\.composer\.draft'/);

const queueSteerOnly = process.argv.includes('--queue-steer-only');
let database;
let stopTerminalOwner;
let stopTerminals;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { mapToolCalls } = await import('../src/main/tool-concurrency.js');
  const clientTools = await import('../src/main/client-tools.js');
  const { resolveTerminalShell } = await import('../src/main/terminal-shell.js');
  stopTerminals = clientTools.stopConversationTerminals;
  const {
    closeDatabase,
    createConversation,
    forkConversation,
    getMessages,
    insertMessage,
    updateQueuedMessageOrder,
  } = database;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };

  const pendingToolResolvers = [];
  const startedToolCalls = [];
  const mappedToolCalls = mapToolCalls(
    Array.from({ length: 6 }, (_, index) => index),
    (index) => {
      startedToolCalls.push(index);
      return new Promise((resolveTool) => {
        pendingToolResolvers[index] = () => resolveTool(`result-${index}`);
      });
    },
  );
  await waitFor(() => startedToolCalls.length === 4);
  assert.deepEqual(startedToolCalls, [0, 1, 2, 3]);
  pendingToolResolvers[2]();
  await waitFor(() => startedToolCalls.length === 5);
  assert.deepEqual(startedToolCalls, [0, 1, 2, 3, 4]);
  pendingToolResolvers[0]();
  await waitFor(() => startedToolCalls.length === 6);
  for (const index of [1, 3, 4, 5]) pendingToolResolvers[index]();
  assert.deepEqual(
    await mappedToolCalls,
    Array.from({ length: 6 }, (_, index) => `result-${index}`),
  );

  function buildRunner(provider, stoppedBackgroundTasks = [], events = [], options = {}) {
    return new ChatRunner({
      registry: {
        resolve: () => ({ model, provider }),
        listModels: () => [model],
      },
      mcpManager: null,
      sendEvent: (event) => events.push(event),
      stopBackgroundTasks: (conversationId) => stoppedBackgroundTasks.push(conversationId),
      ...options,
    });
  }

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  let finishInference;
  const inferenceCalls = [];
  const inferenceRequests = [];
  const inferenceProvider = {
    getContributions: () => ({ tools: [] }),
    stream: ({ signal, messages }) => {
      inferenceCalls.push(signal);
      inferenceRequests.push(messages);
      if (inferenceCalls.length > 1) {
        return Promise.resolve({ assistantContent: 'Steered response', toolCalls: [] });
      }
      return new Promise((resolveStream) => {
        finishInference = () => resolveStream({
          assistantContent: 'Original response',
          toolCalls: [],
        });
      });
    },
  };
  const cooperativeRunner = buildRunner(inferenceProvider);
  assert.equal(cooperativeRunner.requestSteer('idle-thread'), false);
  const inferenceController = new AbortController();
  const inferenceRun = {
    controller: inferenceController,
    phase: 'inference',
    steerRequested: false,
  };
  cooperativeRunner.runs.set('active-thread', inferenceRun);
  assert.equal(cooperativeRunner.requestSteer('active-thread'), true);
  assert.equal(inferenceRun.steerRequested, true);
  assert.equal(inferenceController.signal.aborted, false);
  const boundaryController = new AbortController();
  const boundaryRun = {
    controller: boundaryController,
    phase: 'boundary',
    steerRequested: false,
  };
  cooperativeRunner.runs.set('boundary-thread', boundaryRun);
  assert.equal(cooperativeRunner.requestSteer('boundary-thread'), true);
  assert.equal(boundaryRun.steerRequested, true);
  assert.equal(boundaryController.signal.reason, 'steer');
  assert.equal(cooperativeRunner.shouldEndAtBoundary(inferenceRun), true);
  cooperativeRunner.runs.clear();

  const stoppedBackgroundTasks = [];
  const stoppedBookkeepingRunner = buildRunner(
    inferenceProvider,
    stoppedBackgroundTasks,
    [],
    { noteBotRunStopped: () => { throw new Error('database is locked'); } },
  );
  const stoppedController = new AbortController();
  stoppedBookkeepingRunner.runs.set('stopped-thread', {
    controller: stoppedController,
    phase: 'inference',
    queue: [],
  });
  stoppedBookkeepingRunner.stop('stopped-thread', { stoppedByUser: true });
  assert.equal(stoppedController.signal.reason, 'stop');
  assert.deepEqual(stoppedBackgroundTasks, ['stopped-thread']);

  const inferenceRunner = buildRunner(inferenceProvider);
  const inferenceConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await inferenceRunner.send({
    conversationId: inferenceConversation.id,
    model: model.id,
    text: 'Original prompt',
  });
  await waitFor(() => inferenceCalls.length === 1);
  assert.deepEqual(inferenceRunner.reloadSnapshot(), {
    conversationIds: [inferenceConversation.id],
    approvals: [],
    questions: [],
    semaphoreWaits: [],
  });
  await inferenceRunner.send({
    conversationId: inferenceConversation.id,
    model: model.id,
    text: 'First steer prompt',
    steer: true,
  });
  await inferenceRunner.send({
    conversationId: inferenceConversation.id,
    model: model.id,
    text: 'Second steer prompt',
    steer: true,
  });
  await inferenceRunner.send({
    conversationId: inferenceConversation.id,
    model: model.id,
    text: 'Third steer prompt',
    steer: true,
  });
  assert.equal(inferenceCalls[0].aborted, false);
  finishInference();
  await waitFor(() => !inferenceRunner.runs.has(inferenceConversation.id));
  assert.deepEqual(inferenceRunner.reloadSnapshot(), {
    conversationIds: [],
    approvals: [],
    questions: [],
    semaphoreWaits: [],
  });
  assert.equal(inferenceCalls[0].aborted, false);
  assert.equal(inferenceCalls.length, 2);
  assert.deepEqual(
    inferenceRequests[1]
      .filter((message) => message.role === 'user')
      .map((message) => message.content),
    [
      'Original prompt',
      'First steer prompt',
      'Second steer prompt',
      'Third steer prompt',
    ],
  );
  assert.deepEqual(
    getMessages(inferenceConversation.id)
      .filter((message) => message.role === 'assistant')
      .map((message) => message.status),
    ['completed', 'completed'],
  );

  const bookkeepingRunner = buildRunner(
    {
      getContributions: () => ({ tools: [] }),
      stream: async () => ({ assistantContent: 'Completed despite bookkeeping failure', toolCalls: [] }),
    },
    [],
    [],
    { noteBotRunFinished: () => { throw new Error('database is locked'); } },
  );
  const bookkeepingConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await bookkeepingRunner.send({
    conversationId: bookkeepingConversation.id,
    model: model.id,
    text: 'Finish this run.',
  });
  await waitFor(() => !bookkeepingRunner.runs.has(bookkeepingConversation.id));
  assert.equal(
    getMessages(bookkeepingConversation.id).findLast((message) => message.role === 'assistant')?.status,
    'completed',
  );

  let finishQueuedOrderingInference;
  const queuedOrderingCalls = [];
  const queuedOrderingRunner = buildRunner({
    getContributions: () => ({ tools: [] }),
    stream: () => {
      queuedOrderingCalls.push(queuedOrderingCalls.length + 1);
      if (queuedOrderingCalls.length === 1) {
        return new Promise((resolveStream) => {
          finishQueuedOrderingInference = () => resolveStream({
            assistantContent: 'Initial answer',
            toolCalls: [],
          });
        });
      }
      return Promise.resolve({
        assistantContent: `Queued answer ${queuedOrderingCalls.length - 1}`,
        toolCalls: [],
      });
    },
  });
  const queuedOrderingConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await queuedOrderingRunner.send({
    conversationId: queuedOrderingConversation.id,
    model: model.id,
    text: 'Initial prompt',
  });
  await waitFor(() => queuedOrderingCalls.length === 1);
  await queuedOrderingRunner.send({
    conversationId: queuedOrderingConversation.id,
    model: model.id,
    text: 'First queued prompt',
  });
  await queuedOrderingRunner.send({
    conversationId: queuedOrderingConversation.id,
    model: model.id,
    text: 'Second queued prompt',
  });
  assert.deepEqual(
    getMessages(queuedOrderingConversation.id)
      .filter((message) => ['queued', 'steered'].includes(message.status))
      .map((message) => message.createdAt),
    [null, null],
  );
  finishQueuedOrderingInference();
  await waitFor(() => !queuedOrderingRunner.runs.has(queuedOrderingConversation.id));
  assert.equal(queuedOrderingCalls.length, 3);
  const queuedOrderingMessages = getMessages(queuedOrderingConversation.id);
  assert.equal(
    queuedOrderingMessages
      .filter((message) => message.role === 'user')
      .every((message) => typeof message.createdAt === 'string'),
    true,
  );
  assert.deepEqual(
    queuedOrderingMessages.map((message) => (
      message.role === 'user' ? message.content : message.role
    )),
    [
      'Initial prompt',
      'assistant',
      'First queued prompt',
      'assistant',
      'Second queued prompt',
      'assistant',
    ],
  );

  const persistedQueueConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  const persistedQueueMessages = ['First queued', 'Second queued', 'Third queued'].map((content) => (
    insertMessage({
      conversationId: persistedQueueConversation.id,
      role: 'user',
      model: model.id,
      status: 'queued',
      content,
    })
  ));
  updateQueuedMessageOrder(persistedQueueConversation.id, {
    queuedMessageIds: [
      persistedQueueMessages[2].id,
      persistedQueueMessages[0].id,
      persistedQueueMessages[1].id,
    ],
  });
  const reconstructedQueueRunner = buildRunner(inferenceProvider);
  assert.deepEqual(
    reconstructedQueueRunner.getQueuedItems(persistedQueueConversation.id, model.id)
      .map((item) => item.userMessageId),
    [
      persistedQueueMessages[2].id,
      persistedQueueMessages[0].id,
      persistedQueueMessages[1].id,
    ],
  );
  const persistedSteer = insertMessage({
    conversationId: persistedQueueConversation.id,
    role: 'user',
    model: model.id,
    status: 'steered',
    content: 'Persisted steer',
  });
  updateQueuedMessageOrder(persistedQueueConversation.id, {
    steerMessageIds: [persistedSteer.id],
    queuedMessageIds: persistedQueueMessages.map((message) => message.id),
  });
  assert.deepEqual(
    reconstructedQueueRunner.getQueuedItems(persistedQueueConversation.id, model.id)
      .map((item) => item.userMessageId),
    [persistedSteer.id, ...persistedQueueMessages.map((message) => message.id)],
  );

  const prioritySignals = [];
  const priorityRunner = buildRunner({
    getContributions: () => ({ tools: [] }),
    stream: ({ signal }) => new Promise((_resolveStream, rejectStream) => {
      prioritySignals.push(signal);
      signal.addEventListener('abort', () => rejectStream(new Error('Stopped')), { once: true });
    }),
  });
  const priorityConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await priorityRunner.send({
    conversationId: priorityConversation.id,
    model: model.id,
    text: 'Active priority test',
  });
  await waitFor(() => prioritySignals.length === 1);
  const ordinaryQueued = await priorityRunner.send({
    conversationId: priorityConversation.id,
    model: model.id,
    text: 'Ordinary queued message',
  });
  const steeredQueued = await priorityRunner.send({
    conversationId: priorityConversation.id,
    model: model.id,
    text: 'Steered message',
    steer: true,
  });
  const priorityQueued = await priorityRunner.send({
    conversationId: priorityConversation.id,
    model: model.id,
    text: 'Priority queued message',
    queuePriority: true,
  });
  assert.deepEqual(
    priorityRunner.runs.get(priorityConversation.id).queue
      .map((item) => item.userMessageId),
    [steeredQueued.message.id, priorityQueued.message.id, ordinaryQueued.message.id],
  );
  assert.equal(prioritySignals[0].aborted, false);
  const crossLaneOrder = priorityRunner.reorderQueuedMessages({
    conversationId: priorityConversation.id,
    queueType: 'queue',
    messageIds: [ordinaryQueued.message.id, priorityQueued.message.id, steeredQueued.message.id],
  });
  assert.equal(crossLaneOrder.reordered, false);
  const normalizedPriorityOrder = priorityRunner.reorderQueuedMessages({
    conversationId: priorityConversation.id,
    queueType: 'queue',
    messageIds: [ordinaryQueued.message.id, priorityQueued.message.id],
  });
  assert.deepEqual(normalizedPriorityOrder.steerMessageIds, [steeredQueued.message.id]);
  assert.deepEqual(normalizedPriorityOrder.queuedMessageIds, [
    ordinaryQueued.message.id,
    priorityQueued.message.id,
  ]);
  priorityRunner.stop(priorityConversation.id);
  await waitFor(() => !priorityRunner.runs.has(priorityConversation.id));

  let finishConfiguredInference;
  const configuredInferenceRequests = [];
  const configuredInferenceProvider = {
    getContributions: () => ({ tools: [] }),
    stream: ({ messages }) => {
      configuredInferenceRequests.push(messages);
      if (configuredInferenceRequests.length === 1) {
        return new Promise((resolveStream) => {
          finishConfiguredInference = () => resolveStream({
            assistantContent: 'Initial configured response',
            toolCalls: [],
          });
        });
      }
      return Promise.resolve({ assistantContent: 'Configured steer response', toolCalls: [] });
    },
  };
  const configuredInferenceRunner = buildRunner(configuredInferenceProvider);
  const configuredStarts = [];
  const configuredStart = configuredInferenceRunner.start.bind(configuredInferenceRunner);
  configuredInferenceRunner.start = (options) => {
    configuredStarts.push(options);
    return configuredStart(options);
  };
  const configuredInferenceConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await configuredInferenceRunner.send({
    conversationId: configuredInferenceConversation.id,
    model: model.id,
    text: 'Configured original prompt',
  });
  await waitFor(() => Boolean(finishConfiguredInference));
  await configuredInferenceRunner.send({
    conversationId: configuredInferenceConversation.id,
    model: model.id,
    text: 'Approve-for-me steer',
    steer: true,
    permissionMode: 'approve_for_me',
  });
  await configuredInferenceRunner.send({
    conversationId: configuredInferenceConversation.id,
    model: model.id,
    text: 'Full-access steer',
    steer: true,
    permissionMode: 'full_access',
  });
  finishConfiguredInference();
  await waitFor(() => !configuredInferenceRunner.runs.has(configuredInferenceConversation.id));
  assert.equal(configuredInferenceRequests.length, 3);
  assert.deepEqual(
    configuredStarts.slice(1).map(({ permissionMode, userMessageIds }) => ({
      permissionMode,
      dispatchedCount: userMessageIds.length,
    })),
    [
      { permissionMode: 'approve_for_me', dispatchedCount: 1 },
      { permissionMode: 'full_access', dispatchedCount: 1 },
    ],
  );

  let finishFailingInference;
  let failingInferenceCalls = 0;
  const failingInferenceRunner = buildRunner({
    getContributions: () => ({ tools: [] }),
    stream: () => {
      failingInferenceCalls += 1;
      return new Promise((resolveStream, rejectStream) => {
        finishFailingInference = () => rejectStream(new Error('Provider unavailable'));
      });
    },
  });
  const failingInferenceConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await failingInferenceRunner.send({
    conversationId: failingInferenceConversation.id,
    model: model.id,
    text: 'Failing original prompt',
  });
  await waitFor(() => Boolean(finishFailingInference));
  await failingInferenceRunner.send({
    conversationId: failingInferenceConversation.id,
    model: model.id,
    text: 'Must remain queued',
  });
  finishFailingInference();
  await waitFor(() => !failingInferenceRunner.runs.has(failingInferenceConversation.id));
  assert.equal(failingInferenceCalls, 1);
  assert.equal(
    getMessages(failingInferenceConversation.id)
      .find((message) => message.content === 'Must remain queued')?.status,
    'queued',
  );

  const replacementEvents = [];
  const replacementRequests = [];
  const replacementSignals = [];
  const replacementRunner = buildRunner({
    getContributions: () => ({ tools: [] }),
    stream: ({ signal, messages }) => {
      replacementSignals.push(signal);
      replacementRequests.push(messages);
      if (replacementRequests.length > 1) {
        return Promise.resolve({
          assistantContent: 'Replacement answer',
          toolCalls: [],
        });
      }
      return new Promise((_resolveStream, rejectStream) => {
        signal.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          rejectStream(error);
        }, { once: true });
      });
    },
  }, [], replacementEvents);
  const replacementConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  const originalReplacement = await replacementRunner.send({
    conversationId: replacementConversation.id,
    model: model.id,
    text: 'Original editable prompt',
  });
  await waitFor(() => replacementSignals.length === 1);
  await replacementRunner.send({
    conversationId: replacementConversation.id,
    model: model.id,
    text: 'Queued tail',
  });
  await replacementRunner.send({
    conversationId: replacementConversation.id,
    model: model.id,
    text: 'Steered tail',
    steer: true,
  });
  const replaced = await replacementRunner.replaceUserMessage({
    conversationId: replacementConversation.id,
    messageId: originalReplacement.message.id,
    model: model.id,
    text: 'Edited prompt',
    attachments: [],
    reasoningEffort: null,
    permissionMode: 'full_access',
    workMode: 'plan',
    ultraMode: false,
  });
  assert.equal(replacementSignals[0].aborted, true);
  assert.equal(replaced.queued, false);
  await waitFor(() => !replacementRunner.runs.has(replacementConversation.id));
  assert.deepEqual(
    replacementRequests[1]
      .filter((message) => message.role === 'user')
      .map((message) => message.content),
    ['Edited prompt'],
  );
  assert.deepEqual(
    getMessages(replacementConversation.id).map((message) => (
      message.role === 'user' ? message.content : message.status
    )),
    ['Edited prompt', 'completed'],
  );
  assert.equal(replacementRunner.pausedQueues.has(replacementConversation.id), false);
  assert.equal(
    replacementEvents.filter((event) => event.type === 'message-delete').length,
    4,
  );
  assert.deepEqual(
    replacementEvents.findLast((event) => event.type === 'queue-order'),
    {
      type: 'queue-order',
      steerMessageIds: [],
      queuedMessageIds: [],
      messageIds: [],
      conversationId: replacementConversation.id,
    },
  );

  if (!queueSteerOnly) {
    let finishFirstTool;
  let finishSecondTool;
  const inferenceBoundaryCalls = [];
  const executedTools = [];
  const inferenceBoundaryProvider = {
    getContributions: () => ({
      tools: [
        {
          name: 'first_boundary_tool',
          description: 'Wait for the first controlled tool result.',
          inputSchema: { type: 'object', properties: {} },
          execute: (_input, { signal }) => {
            executedTools.push(['first', signal]);
            return new Promise((resolveTool) => {
              finishFirstTool = () => resolveTool({ first: true });
            });
          },
        },
        {
          name: 'second_boundary_tool',
          description: 'Wait for the second controlled tool result.',
          inputSchema: { type: 'object', properties: {} },
          execute: (_input, { signal }) => {
            executedTools.push(['second', signal]);
            return new Promise((resolveTool) => {
              finishSecondTool = () => resolveTool({ second: true });
            });
          },
        },
      ],
    }),
    stream: ({ messages, toolHistory, signal, onEvent }) => {
      inferenceBoundaryCalls.push({
        messages: structuredClone(messages),
        toolHistory: structuredClone(toolHistory),
        signal,
      });
      if (inferenceBoundaryCalls.length === 1) {
        onEvent({ type: 'content', text: 'Preparing tools.' });
        onEvent({ type: 'item-complete', itemType: 'content' });
        return Promise.resolve({
          assistantContent: 'Preparing tools.',
          toolCalls: [
            {
              callId: 'first-boundary-call',
              key: 'first-boundary-call',
              name: 'first_boundary_tool',
              argumentsText: JSON.stringify({
                __invocation_goal: 'Complete the first controlled tool.',
                __requires_human_approval: false,
              }),
            },
            {
              callId: 'second-boundary-call',
              key: 'second-boundary-call',
              name: 'second_boundary_tool',
              argumentsText: JSON.stringify({
                __invocation_goal: 'Complete the second controlled tool.',
                __requires_human_approval: false,
              }),
            },
          ],
        });
      }
      return Promise.resolve({
        assistantContent: inferenceBoundaryCalls.length === 2
          ? 'Handled the steer after both tools.'
          : 'Handled the queued message after the final inference.',
        toolCalls: [],
      });
    },
  };
  const inferenceBoundaryRunner = buildRunner(inferenceBoundaryProvider);
  const inferenceBoundaryConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await inferenceBoundaryRunner.send({
    conversationId: inferenceBoundaryConversation.id,
    model: model.id,
    text: 'Run both tools before handling steer.',
  });
  await waitFor(() => Boolean(finishFirstTool));
  const boundarySteer = await inferenceBoundaryRunner.send({
    conversationId: inferenceBoundaryConversation.id,
    model: model.id,
    text: 'Steer after this inference.',
    steer: true,
  });
  const boundaryQueue = await inferenceBoundaryRunner.send({
    conversationId: inferenceBoundaryConversation.id,
    model: model.id,
    text: 'Queue after the final inference.',
  });
  await waitFor(() => Boolean(finishFirstTool) && Boolean(finishSecondTool));
  assert.deepEqual(executedTools.map(([name]) => name), ['first', 'second']);
  assert.equal(executedTools[0][1].aborted, false);
  assert.equal(executedTools[1][1].aborted, false);
  assert.equal(inferenceBoundaryCalls.length, 1);
  finishSecondTool();
  finishFirstTool();
  await waitFor(() => inferenceBoundaryCalls.length === 3);
  await waitFor(() => !inferenceBoundaryRunner.runs.has(inferenceBoundaryConversation.id));
  assert.equal(inferenceBoundaryCalls[0].signal.aborted, false);
  assert.equal(inferenceBoundaryCalls[1].toolHistory[0].results.length, 2);
  assert.deepEqual(
    inferenceBoundaryCalls[1].toolHistory[0].messages.map((message) => message.content),
    ['Steer after this inference.'],
  );
  assert.equal(
    inferenceBoundaryCalls[1].messages.some((message) => (
      message.content === 'Queue after the final inference.'
    )),
    false,
  );
  assert.equal(
    inferenceBoundaryCalls[2].messages.some((message) => (
      message.content === 'Queue after the final inference.'
    )),
    true,
  );
  assert.equal(getMessages(inferenceBoundaryConversation.id)
    .find((message) => message.id === boundarySteer.message.id)?.status, 'sent');
  assert.equal(getMessages(inferenceBoundaryConversation.id)
    .find((message) => message.id === boundaryQueue.message.id)?.status, 'sent');
  assert.deepEqual(
    getMessages(inferenceBoundaryConversation.id)
      .filter((message) => message.role === 'assistant')
      .map((message) => message.status),
    ['completed', 'completed', 'completed'],
  );

  const fullStopSignals = [];
  const fullStopProvider = {
    getContributions: () => ({ tools: [] }),
    stream: ({ signal }) => new Promise((_resolveStream, rejectStream) => {
      fullStopSignals.push(signal);
      signal.addEventListener('abort', () => rejectStream(new Error('Stopped')), { once: true });
    }),
  };
  const stoppedBackgroundTasks = [];
  const fullStopEvents = [];
  const fullStopRunner = buildRunner(fullStopProvider, stoppedBackgroundTasks, fullStopEvents);
  const parent = createConversation({ model: model.id, projectPath: process.cwd() });
  const subagent = forkConversation(parent.id, { subagent: true }).conversation;
  await fullStopRunner.send({
    conversationId: parent.id,
    model: model.id,
    text: 'Parent work',
  });
  await fullStopRunner.send({
    conversationId: subagent.id,
    model: model.id,
    text: 'Sub-agent work',
  });
  await waitFor(() => fullStopSignals.length === 2);
  const queuedParent = await fullStopRunner.send({
    conversationId: parent.id,
    model: model.id,
    text: 'Keep this first parent prompt queued',
  });
  const secondQueuedParent = await fullStopRunner.send({
    conversationId: parent.id,
    model: model.id,
    text: 'Keep this second parent prompt queued',
    permissionMode: 'full_access',
  });
  const priorityParent = await fullStopRunner.send({
    conversationId: parent.id,
    model: model.id,
    text: 'Prioritized sub-agent report',
    queuePriority: true,
  });
  const queuedSubagent = await fullStopRunner.send({
    conversationId: subagent.id,
    model: model.id,
    text: 'Keep this sub-agent prompt queued',
  });
  fullStopRunner.stop(parent.id, { includeSubagents: true, stoppedByUser: true });
  assert.equal(fullStopSignals.every((signal) => signal.aborted), true);
  assert.equal(
    getMessages(parent.id).findLast((message) => message.role === 'assistant')?.stoppedByUser,
    true,
  );
  assert.equal(
    getMessages(subagent.id).findLast((message) => message.role === 'assistant')?.stoppedByUser,
    true,
  );
  assert.deepEqual(new Set(stoppedBackgroundTasks), new Set([parent.id, subagent.id]));
  await waitFor(() => fullStopRunner.runs.size === 0);
  assert.equal(
    fullStopEvents.filter((event) => (
      event.type === 'run-state' && !event.running && event.stoppedByUser
    )).length,
    2,
  );
  assert.equal(
    fullStopEvents.filter((event) => (
      event.type === 'message'
      && event.message.status === 'aborted'
      && event.message.stoppedByUser
    )).length,
    2,
  );
  assert.deepEqual(
    fullStopRunner.getQueuedItems(parent.id, model.id)
      .map((item) => item.userMessageId),
    [priorityParent.message.id, queuedParent.message.id, secondQueuedParent.message.id],
  );
  assert.deepEqual(
    fullStopRunner.getQueuedItems(subagent.id, model.id)
      .map((item) => item.userMessageId),
    [queuedSubagent.message.id],
  );
  assert.equal(fullStopSignals.length, 2);
  const restoredStopRunner = buildRunner(fullStopProvider);
  assert.equal(
    restoredStopRunner.getQueuedItems(parent.id, model.id)
      .find((item) => item.userMessageId === secondQueuedParent.message.id)
      ?.permissionMode,
    'full_access',
  );

  const reorderedParent = fullStopRunner.reorderQueuedMessages({
    conversationId: parent.id,
    queueType: 'queue',
    messageIds: [secondQueuedParent.message.id, priorityParent.message.id, queuedParent.message.id],
  });
  assert.equal(reorderedParent.reordered, true);

  await fullStopRunner.send({
    conversationId: parent.id,
    model: model.id,
    text: 'Resume the parent queue',
  });
  await waitFor(() => fullStopSignals.length === 3);
  assert.deepEqual(
    fullStopRunner.runs.get(parent.id).queue.map((item) => item.userMessageId),
    [secondQueuedParent.message.id, priorityParent.message.id, queuedParent.message.id],
  );
  fullStopRunner.stop(parent.id);
  await waitFor(() => !fullStopRunner.runs.has(parent.id));

  const subagentQueueOrder = fullStopRunner.getQueuedItems(subagent.id, model.id)
    .map((item) => item.userMessageId);
  const steeredSubagent = fullStopRunner.reorderQueuedMessages({
    conversationId: subagent.id,
    queueType: 'queue',
    messageIds: subagentQueueOrder,
    steerMessageId: queuedSubagent.message.id,
  });
  assert.equal(steeredSubagent.steered, true);
  await waitFor(() => fullStopSignals.length === 4);
  fullStopRunner.stop(subagent.id);
  await waitFor(() => !fullStopRunner.runs.has(subagent.id));

  const inheritedPermissionSends = [];
  const permissionChatRunner = {
    runs: new Map(),
    emit: () => {},
    send: async (input) => {
      inheritedPermissionSends.push(input);
      return { message: { id: `permission-message-${inheritedPermissionSends.length}` } };
    },
  };
  const chatCreateThread = clientTools.CLIENT_TOOLS.find(
    (tool) => tool.name === 'chat_create_thread',
  );
  const chatSpawnSubagent = clientTools.CLIENT_TOOLS.find(
    (tool) => tool.name === 'chat_spawn_subagent',
  );
  const chatSendPrompt = clientTools.CLIENT_TOOLS.find(
    (tool) => tool.name === 'chat_send_prompt',
  );
  const permissionContext = {
    chatRunner: permissionChatRunner,
    conversationId: parent.id,
    model: model.id,
    models: [model],
    reasoningEffort: null,
    permissionMode: 'full_access',
    workspacePath: process.cwd(),
    tuning: { maxConcurrentSubagents: 128 },
    defaultModels: { subagents: { enabled: false } },
    workMode: null,
    ultraMode: false,
  };
  await chatCreateThread.execute(
    { prompt: 'Create a full-access thread' },
    permissionContext,
  );
  await chatSpawnSubagent.execute(
    { prompt: 'Start a full-access sub-agent' },
    permissionContext,
  );
  await chatSendPrompt.execute(
    { threadId: subagent.id, prompt: 'Continue with full access' },
    permissionContext,
  );
  assert.deepEqual(
    inheritedPermissionSends.map((input) => input.permissionMode),
    ['full_access', 'full_access', 'full_access'],
  );

  const sleep = clientTools.CLIENT_TOOLS.find((tool) => tool.name === 'sleep');
  const runInTerminal = clientTools.CLIENT_TOOLS.find((tool) => tool.name === 'run_in_terminal');
  const readTerminalOutput = clientTools.CLIENT_TOOLS.find(
    (tool) => tool.name === 'read_terminal_output',
  );
  assert.equal(sleep.inputSchema.properties.seconds.minimum, 5);
  assert.equal(sleep.inputSchema.properties.seconds.maximum, 3_600);
  const sleepStartedAt = Date.now();
  const sleepResult = await sleep.execute(
    { seconds: 5 },
    { conversationId: 'sleep-owner', chatRunner: { runs: new Map() } },
  );
  assert.equal(typeof sleepResult, 'string');
  assert.match(sleepResult, /Slept (?:4\.9\d|5(?:\.\d+)?) seconds\./);
  assert.match(sleepResult, /Woke at: .*\d/);
  assert.match(sleepResult, /Terminals:\nNone\./);
  assert.match(sleepResult, /Sub-agents:\nNone\./);
  assert.ok(Date.now() - sleepStartedAt >= 4_900);
  await assert.rejects(
    sleep.execute({ seconds: 4 }, { conversationId: 'sleep-owner' }),
    /seconds must be a number from 5 to 3600/,
  );
  await assert.rejects(
    sleep.execute({ seconds: 3_601 }, { conversationId: 'sleep-owner' }),
    /seconds must be a number from 5 to 3600/,
  );
  const writeFileTool = clientTools.CLIENT_TOOLS.find((tool) => tool.name === 'write_file');
  const writtenFile = join(testProfile, 'written-by-tool.md');
  const writtenContent = '# Native write\n\nUTF-8: configuração\nCódigo: `$value` & "texto"!\n';
  const writeResult = await writeFileTool.execute({
    filePath: writtenFile,
    content: writtenContent,
  });
  assert.equal(readFileSync(writtenFile, 'utf8'), writtenContent);
  assert.equal(
    writeResult.output,
    `Wrote ${Buffer.byteLength(writtenContent, 'utf8')} bytes to ${writtenFile}.`,
  );
  assert.equal(writeResult.fileChanges.length, 1);
  await assert.rejects(
    writeFileTool.execute({ filePath: 'relative.md', content: '' }),
    /filePath must be absolute/,
  );

  const terminalShell = resolveTerminalShell();
  const failedTerminal = await runInTerminal.execute(
    {
      command: terminalShell.label === 'cmd.exe' ? 'exit /b 7' : 'exit 7',
      explanation: 'Run a command with a controlled non-zero exit.',
      goal: 'Verify failed terminal status.',
      mode: 'sync',
      timeout: 5,
    },
    {
      signal: new AbortController().signal,
      workspacePath: process.cwd(),
      conversationId: 'failed-terminal-owner',
    },
  );
  assert.equal(typeof failedTerminal, 'string');
  assert.match(failedTerminal, /Exit code: 7/);

  if (process.platform === 'win32') {
    const originalShell = process.env.SHELL;
    const originalMsystem = process.env.MSYSTEM;
    process.env.SHELL = '/usr/bin/bash';
    process.env.MSYSTEM = 'MINGW64';
    try {
      const gitBashShell = resolveTerminalShell();
      if (gitBashShell.label === 'Git Bash') {
        const gitBashTerminal = await runInTerminal.execute(
          {
            command: 'printf git-bash-ok',
            explanation: 'Run a command using the resolved Git Bash executable.',
            goal: 'Verify Git Bash command execution.',
            mode: 'sync',
            timeout: 5,
          },
          {
            signal: new AbortController().signal,
            workspacePath: process.cwd(),
            conversationId: 'git-bash-terminal-owner',
          },
        );
        assert.equal(gitBashTerminal, 'git-bash-ok');
      }
    } finally {
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
      if (originalMsystem === undefined) delete process.env.MSYSTEM;
      else process.env.MSYSTEM = originalMsystem;
    }
  }

  const terminalCommand = ['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh']
    .includes(terminalShell.label.toLowerCase())
    ? 'Start-Sleep -Seconds 300'
    : terminalShell.label === 'cmd.exe'
      ? 'ping -t 127.0.0.1 >NUL'
      : 'sleep 300';
  const awaitedController = new AbortController();
  const awaitedTerminal = runInTerminal.execute(
    {
      command: terminalCommand,
      explanation: 'Run a controlled long-lived command.',
      goal: 'Verify direct stop while awaiting command output.',
      mode: 'sync',
      timeout: 5,
    },
    {
      signal: awaitedController.signal,
      workspacePath: process.cwd(),
      conversationId: 'awaited-terminal-owner',
    },
  );
  setTimeout(() => awaitedController.abort('stop'), 100);
  assert.match(await awaitedTerminal, /Status: stopped/);

  stopTerminalOwner = 'background-terminal-owner';
  const backgroundTerminal = await runInTerminal.execute(
    {
      command: terminalCommand,
      explanation: 'Run a controlled background command.',
      goal: 'Verify total stop propagation to background processes.',
      mode: 'async',
      timeout: 1,
    },
    {
      signal: new AbortController().signal,
      workspacePath: process.cwd(),
      conversationId: stopTerminalOwner,
    },
  );
  assert.match(backgroundTerminal, /Status: running/);
  const terminalId = backgroundTerminal.match(/^Terminal ID: (.+)$/m)?.[1];
  assert.ok(terminalId);
  stopTerminals(stopTerminalOwner);
  const terminalDeadline = Date.now() + 5_000;
  let stoppedTerminal = backgroundTerminal;
  while (/Status: running/.test(stoppedTerminal) && Date.now() < terminalDeadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    stoppedTerminal = await readTerminalOutput.execute({ id: terminalId });
  }
  assert.match(stoppedTerminal, /Status: stopped/);
  }

  closeDatabase();
  database = null;
  console.log(queueSteerOnly
    ? 'Queue and steer regression tests passed.'
    : 'Interruption propagation tests passed.');
} finally {
  if (stopTerminalOwner && stopTerminals) stopTerminals(stopTerminalOwner);
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
