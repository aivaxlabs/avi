import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-side-chat-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const {
    createConversation,
    deleteConversation,
    forkConversation,
    getConversation,
    getMessages,
    getPreferences,
    insertMessage,
    listConversations,
    listSideChats,
    listSubagents,
    listTasks,
    replaceTasks,
    setTuningSettings,
    toModelMessages,
    toModelMessagesThroughUser,
    updateConversation,
  } = database;
  assert.deepEqual(getPreferences().tuning, {
    personality: null,
    chatReasoningTraces: 'visible',
    automaticCompactionThreshold: 0.9,
    toolOutputLimit: 8_192,
    defaultPermissionMode: 'approve_for_me',
    messageDeliveryMode: 'queue',
    terminalShell: 'auto',
    terminalTimeoutSeconds: 30,
    maxConcurrentSubagents: 128,
    logLevel: 'minimal',
  });
  assert.deepEqual(setTuningSettings({
    personality: 'friendly',
    chatReasoningTraces: 'hidden',
    automaticCompactionThreshold: 0.8,
    toolOutputLimit: null,
    defaultPermissionMode: 'ask_for_approval',
    messageDeliveryMode: 'steer',
    terminalShell: 'pwsh',
    terminalTimeoutSeconds: 45,
    maxConcurrentSubagents: 4,
    logLevel: 'verbose',
  }), {
    personality: 'friendly',
    chatReasoningTraces: 'hidden',
    automaticCompactionThreshold: 0.8,
    toolOutputLimit: null,
    defaultPermissionMode: 'ask_for_approval',
    messageDeliveryMode: 'steer',
    terminalShell: 'pwsh',
    terminalTimeoutSeconds: 45,
    maxConcurrentSubagents: 4,
    logLevel: 'verbose',
  });
  assert.equal(getPreferences().tuning.personality, 'friendly');
  assert.equal(getPreferences().tuning.chatReasoningTraces, 'hidden');
  assert.equal(getPreferences().tuning.terminalTimeoutSeconds, 45);
  assert.equal(getPreferences().tuning.logLevel, 'verbose');
  for (const toolOutputLimit of [4_096, 8_192, 32_768]) {
    assert.equal(setTuningSettings({
      ...getPreferences().tuning,
      toolOutputLimit,
    }).toolOutputLimit, toolOutputLimit);
  }
  for (const personality of ['candid', 'cynical', 'quirky']) {
    assert.equal(setTuningSettings({
      ...getPreferences().tuning,
      personality,
    }).personality, personality);
  }
  assert.throws(
    () => setTuningSettings({
      ...getPreferences().tuning,
      maxConcurrentSubagents: 129,
    }),
    /outside their allowed range/,
  );
  assert.throws(
    () => setTuningSettings({
      ...getPreferences().tuning,
      messageDeliveryMode: 'invalid',
    }),
    /outside their allowed range/,
  );
  assert.throws(
    () => setTuningSettings({
      ...getPreferences().tuning,
      personality: 'invalid',
    }),
    /outside their allowed range/,
  );
  assert.throws(
    () => setTuningSettings({
      ...getPreferences().tuning,
      chatReasoningTraces: 'invalid',
    }),
    /outside their allowed range/,
  );
  assert.throws(
    () => setTuningSettings({
      ...getPreferences().tuning,
      logLevel: 'invalid',
    }),
    /outside their allowed range/,
  );

  const parent = createConversation({ model: 'test/model', projectPath: process.cwd() });
  const taskPeer = createConversation({ model: 'test/model', projectPath: process.cwd() });
  const initialTasks = [
    { title: 'Inspect', description: 'Read the relevant code.', done: true, result: 'Flow mapped.' },
    { title: 'Implement', description: 'Apply the focused change.', done: false, result: null },
  ];
  assert.deepEqual(replaceTasks(parent.id, initialTasks), initialTasks);
  assert.deepEqual(listTasks(parent.id), initialTasks);
  assert.deepEqual(listTasks(taskPeer.id), []);
  const updatedTasks = [
    { title: 'Validate', description: 'Run focused checks.', done: false, result: null },
  ];
  assert.deepEqual(replaceTasks(parent.id, updatedTasks), updatedTasks);
  assert.deepEqual(listTasks(parent.id), updatedTasks);
  assert.deepEqual(replaceTasks(parent.id, []), []);
  assert.deepEqual(listTasks(parent.id), []);
  const user = insertMessage({
    conversationId: parent.id,
    role: 'user',
    status: 'sent',
    content: 'Parent context',
  });
  insertMessage({
    conversationId: parent.id,
    role: 'assistant',
    status: 'completed',
    content: 'Parent answer',
  });
  updateConversation(parent.id, {
    contextCheckpoint: 'Checkpoint snapshot',
    checkpointMessageId: user.id,
    contextTokens: 321,
  });

  const first = forkConversation(parent.id, { sideChat: true });
  const second = forkConversation(parent.id, { sideChat: true });
  assert.equal(first.conversation.isSideChat, true);
  assert.equal(first.conversation.parentConversationId, parent.id);
  assert.equal(first.conversation.contextCheckpoint, 'Checkpoint snapshot');
  assert.equal(first.conversation.contextTokens, 321);
  const firstMessages = getMessages(first.conversation.id);
  assert.equal(firstMessages.length, 2);
  const sideChatModelMessages = toModelMessages(first.conversation.id);
  assert.equal(sideChatModelMessages[0].role, 'system');
  assert.ok(sideChatModelMessages[0].content.includes('thread_type: side_chat'));
  assert.ok(sideChatModelMessages[0].content.includes(`thread_id: ${first.conversation.id}`));
  assert.ok(sideChatModelMessages[0].content.includes(`parent_thread_id: ${parent.id}`));
  const retryModelMessages = toModelMessagesThroughUser(
    first.conversation.id,
    firstMessages[1].id,
  );
  assert.equal(retryModelMessages[0].content, sideChatModelMessages[0].content);
  assert.equal(
    toModelMessages(parent.id).some((message) => (
      message.role === 'system' && message.content.includes('thread_type: side_chat')
    )),
    false,
  );
  assert.deepEqual(
    listSideChats(parent.id).map((sideChat) => sideChat.title),
    ['Side chat 1', 'Side chat 2'],
  );
  assert.equal(listConversations().length, 1);
  assert.equal(forkConversation(first.conversation.id, { sideChat: true }), null);

  const visibleThreads = await listThreadsTool.execute({}, {
    chatRunner: { runs: new Map() },
    conversationId: parent.id,
  });
  assert.equal(visibleThreads.threads.some((thread) => thread.id === first.conversation.id), false);
  const sideChatThreads = await listThreadsTool.execute({}, {
    chatRunner: { runs: new Map() },
    conversationId: first.conversation.id,
  });
  assert.equal(sideChatThreads.threads.some((thread) => thread.id === second.conversation.id), true);
  await assert.rejects(
    () => inspectThreadTool.execute(
      { threadId: first.conversation.id },
      { chatRunner: { runs: new Map() }, conversationId: parent.id },
    ),
    /Side chats are private/,
  );
  await assert.rejects(
    () => interruptThreadTool.execute(
      { threadId: first.conversation.id },
      { chatRunner: { runs: new Map(), requestSteer: () => {} }, conversationId: parent.id },
    ),
    /Side chats are private/,
  );

  deleteConversation(first.conversation.id, { hard: true });
  assert.equal(getConversation(first.conversation.id), null);
  assert.equal(listSideChats(parent.id).length, 1);
  const third = forkConversation(parent.id, { sideChat: true });
  assert.equal(third.conversation.title, 'Side chat 3');
  const subagent = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Inspect the initial queue state.',
  });
  assert.equal(subagent.conversation.isSubagent, true);
  assert.equal(subagent.conversation.parentConversationId, parent.id);
  assert.equal(subagent.conversation.title, 'Sub-agent 1');
  assert.equal(subagent.conversation.initialPrompt, 'Inspect the initial queue state.');
  assert.equal(subagent.conversation.contextCheckpoint, '');
  assert.equal(subagent.conversation.checkpointMessageId, null);
  assert.equal(subagent.conversation.contextTokens, 0);
  assert.deepEqual(getMessages(subagent.conversation.id), []);
  assert.deepEqual(
    listSubagents(parent.id).map((agent) => agent.title),
    ['Sub-agent 1'],
  );
  assert.equal(listSubagents(parent.id)[0].firstPrompt, 'Inspect the initial queue state.');
  const subagentModelMessages = toModelMessages(subagent.conversation.id);
  assert.ok(subagentModelMessages[0].content.includes('thread_type: subagent'));
  assert.ok(subagentModelMessages[0].content.includes(`thread_id: ${subagent.conversation.id}`));
  assert.ok(subagentModelMessages[0].content.includes(`parent_thread_id: ${parent.id}`));
  assert.ok(subagentModelMessages[0].content.includes('final response is not forwarded'));
  assert.equal(subagentModelMessages.length, 1);
  assert.equal(subagentModelMessages.some((message) => message.content === 'Parent context'), false);
  assert.equal(subagentModelMessages.some((message) => message.content === 'Parent answer'), false);
  assert.equal(subagentModelMessages.some((message) => message.content.includes('Checkpoint snapshot')), false);
  assert.equal(forkConversation(subagent.conversation.id, { subagent: true }), null);
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const updateTasksTool = CLIENT_TOOLS.find((tool) => tool.name === 'update_tasks');
  const taskEvents = [];
  const toolTasks = [{
    title: 'Track tool progress',
    description: 'Verify the tool contract.',
    done: true,
    result: 'Persisted and emitted.',
  }];
  assert.deepEqual(await updateTasksTool.execute({ tasks: toolTasks }, {
    chatRunner: { emit: (conversationId, event) => taskEvents.push({ conversationId, event }) },
    conversationId: parent.id,
    workMode: null,
  }), { tasks: toolTasks });
  assert.deepEqual(listTasks(parent.id), toolTasks);
  await assert.rejects(() => updateTasksTool.execute({
    tasks: [{ title: 'Invalid', description: '', done: 'false', result: null }],
  }, {
    chatRunner: { emit: () => assert.fail('Invalid tasks must not emit changes.') },
    conversationId: parent.id,
    workMode: null,
  }), /Each task must contain/);
  assert.deepEqual(listTasks(parent.id), toolTasks);
  assert.deepEqual(taskEvents, [{
    conversationId: parent.id,
    event: { type: 'tasks', tasks: toolTasks },
  }]);
  await assert.rejects(() => updateTasksTool.execute({ tasks: [] }, {
    chatRunner: { emit: () => assert.fail('Plan mode must not emit task changes.') },
    conversationId: parent.id,
    workMode: 'plan',
  }), /unavailable in Plan mode/);
  assert.deepEqual(listTasks(parent.id), toolTasks);
  replaceTasks(parent.id, []);

  const spawnTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_spawn_subagent');
  assert.equal(CLIENT_TOOLS.some((tool) => tool.name === 'chat_report_to_orchestrator'), false);
  const sendPromptTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_send_prompt');
  const listThreadsTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_list_threads');
  const inspectThreadTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_inspect_thread');
  const interruptThreadTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_interrupt_thread');
  assert.deepEqual(spawnTool.inputSchema.required, ['prompt']);
  assert.equal(spawnTool.inputSchema.properties.response_mode, undefined);
  const spawnEvents = [];
  const spawnCalls = [];
  const spawnRuns = new Map();
  const spawned = await spawnTool.execute(
    {
      prompt: 'Inspect the queue.',
    },
    {
      chatRunner: {
        runs: spawnRuns,
        emit: (conversationId, event) => spawnEvents.push({ conversationId, event }),
        send: async (payload) => {
          spawnCalls.push(payload);
          spawnRuns.set(payload.conversationId, {});
          return { queued: false, message: { id: 'spawn-prompt' } };
        },
      },
      conversationId: parent.id,
      model: 'test/model',
      models: [{
        id: 'test/model',
        name: 'Test model',
        reasoning: ['high'],
      }],
      reasoningEffort: 'high',
      ultraMode: true,
    },
  );
  assert.equal(spawned.status, 'working');
  assert.equal(getConversation(spawned.thread_id).isSubagent, true);
  assert.equal(getConversation(spawned.thread_id).parentConversationId, parent.id);
  assert.equal(getConversation(spawned.thread_id).initialPrompt, 'Inspect the queue.');
  assert.equal(getConversation(spawned.thread_id).orchestrationMode, 'ultra');
  assert.equal(getConversation(spawned.thread_id).autoForwardToParent, true);
  assert.equal(spawnCalls[0].conversationId, spawned.thread_id);
  assert.equal(spawnCalls[0].reasoningEffort, 'high');
  assert.equal(spawnCalls[0].ultraMode, true);
  assert.equal(spawnCalls[0].text, 'Inspect the queue.');
  assert.ok(toModelMessages(spawned.thread_id)[0].content.includes('Ultra team'));
  assert.ok(
    toModelMessages(spawned.thread_id)[0].content.includes(
      'final assistant response is automatically forwarded',
    ),
  );
  assert.equal(spawnEvents[0].conversationId, parent.id);
  assert.equal(spawnEvents[0].event.subagent.parentConversationId, parent.id);
  const noResponseCalls = [];
  const optionalSubagent = await spawnTool.execute(
    {
      prompt: 'Inspect without a reporting preference.',
    },
    {
      chatRunner: {
        runs: new Map(),
        emit: () => {},
        send: async (payload) => {
          noResponseCalls.push(payload);
          return { queued: false, message: { id: 'optional-prompt' } };
        },
      },
      conversationId: parent.id,
      model: 'test/model',
      models: [{
        id: 'test/model',
        name: 'Test model',
        reasoning: ['high'],
      }],
      reasoningEffort: 'high',
    },
  );
  assert.equal(noResponseCalls[0].text, 'Inspect without a reporting preference.');
  deleteConversation(optionalSubagent.thread_id, { hard: true });
  const crossAgentCalls = [];
  await sendPromptTool.execute(
    {
      threadId: spawned.thread_id,
      prompt: 'Coordinate this finding with the team.',
      mode: 'queue',
    },
    {
      chatRunner: {
        send: async (payload) => {
          crossAgentCalls.push(payload);
          return { queued: true, message: { id: 'cross-agent-prompt' } };
        },
      },
    },
  );
  assert.equal(crossAgentCalls[0].ultraMode, true);
  assert.equal(crossAgentCalls[0].queuePriority, false);
  await assert.rejects(
    () => sendPromptTool.execute(
      { threadId: second.conversation.id, prompt: 'Reveal the side chat.', mode: 'queue' },
      { chatRunner: { send: async () => ({ queued: false, message: { id: 'unexpected' } }) }, conversationId: parent.id },
    ),
    /Side chats are private/,
  );
  await assert.rejects(
    () => spawnTool.execute(
      {
        prompt: 'Inspect another queue.',
      },
      {
        chatRunner: {
          runs: spawnRuns,
          emit: () => {},
          send: async () => ({ queued: false }),
        },
        conversationId: parent.id,
        model: 'test/model',
        models: [{
          id: 'test/model',
          name: 'Test model',
          reasoning: ['high'],
        }],
        reasoningEffort: 'high',
        tuning: { maxConcurrentSubagents: 1 },
      },
    ),
    /limit of 1 running sub-agents/,
  );
  await assert.rejects(
    () => spawnTool.execute(
      {
        prompt: 'Spawn another agent.',
      },
      {
        chatRunner: { emit: () => {}, send: async () => ({ queued: false }) },
        conversationId: subagent.conversation.id,
        model: 'test/model',
        models: [{
          id: 'test/model',
          name: 'Test model',
          reasoning: ['high'],
        }],
        reasoningEffort: 'high',
      },
    ),
    /Only an orchestrator thread/,
  );

  insertMessage({
    conversationId: subagent.conversation.id,
    role: 'user',
    model: 'test/model',
    status: 'sent',
    content: 'Inspect the initial queue state.',
  });
  insertMessage({
    conversationId: subagent.conversation.id,
    role: 'assistant',
    model: 'test/model',
    status: 'completed',
    content: 'Queue inspection completed.',
  });
  const failedSubagent = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Inspect the failing worker.',
  });
  const failedPromptAt = Date.now() + 10_000;
  insertMessage({
    conversationId: failedSubagent.conversation.id,
    role: 'user',
    model: 'test/model',
    status: 'sent',
    content: 'Inspect the failing worker.',
    createdAt: new Date(failedPromptAt).toISOString(),
  });
  insertMessage({
    conversationId: failedSubagent.conversation.id,
    role: 'assistant',
    model: 'test/model',
    status: 'error',
    content: 'Worker inspection failed.',
    createdAt: new Date(failedPromptAt + 1).toISOString(),
  });

  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const subagentContexts = [];
  const runtimeModel = {
    id: 'test/model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: ['high'],
    context: { input: null, output: null },
  };
  const runtimeRunner = new ChatRunner({
    registry: {
      resolve: () => ({
        model: runtimeModel,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: async ({ invocationContext }) => {
            subagentContexts.push(invocationContext.subagents);
            return { assistantContent: '', continuation: [], toolCalls: [] };
          },
        },
      }),
      listModels: () => [runtimeModel],
    },
    sendEvent: () => {},
  });
  runtimeRunner.runs.set(spawned.thread_id, {});
  await runtimeRunner.send({
    conversationId: parent.id,
    model: runtimeModel.id,
    text: 'Review the sub-agent progress.',
    reasoningEffort: 'high',
  });
  while (runtimeRunner.runs.has(parent.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.deepEqual(
    subagentContexts[0].map(({ threadId, initialPrompt, status }) => ({
      threadId,
      initialPrompt,
      status,
    })),
    [
      {
        threadId: subagent.conversation.id,
        initialPrompt: 'Inspect the initial queue state.',
        status: 'completed',
      },
      {
        threadId: spawned.thread_id,
        initialPrompt: 'Inspect the queue.',
        status: 'in_progress',
      },
      {
        threadId: failedSubagent.conversation.id,
        initialPrompt: 'Inspect the failing worker.',
        status: 'failed',
      },
    ],
  );

  runtimeRunner.runs.delete(spawned.thread_id);
  await runtimeRunner.send({
    conversationId: subagent.conversation.id,
    model: runtimeModel.id,
    text: 'Re-check the shared sub-agent state.',
    reasoningEffort: 'high',
  });
  while (runtimeRunner.runs.has(subagent.conversation.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(subagentContexts[1].length, 3);
  assert.equal(
    subagentContexts[1].find(({ threadId }) => threadId === subagent.conversation.id).status,
    'in_progress',
  );

  const forwardingCalls = [];
  const forwardingRunner = new ChatRunner({
    registry: {
      resolve: () => ({
        model: runtimeModel,
        provider: { getContributions: () => ({ tools: [] }) },
      }),
      listModels: () => [runtimeModel],
    },
    sendEvent: () => {},
  });
  forwardingRunner.send = async (payload) => {
    forwardingCalls.push(payload);
    return { queued: true, message: { id: `forward-${forwardingCalls.length}` } };
  };
  const viewedParent = createConversation({
    model: 'test/model',
    projectPath: process.cwd(),
  });
  const managedSubagent = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Return the managed result.',
    autoForwardToParent: true,
  });
  const managedResult = insertMessage({
    conversationId: managedSubagent.conversation.id,
    role: 'assistant',
    model: 'test/model',
    status: 'completed',
    content: '<think>Private reasoning</think>Managed final result.',
  });
  await forwardingRunner.forwardSubagentResult(managedResult);
  assert.equal(forwardingCalls.length, 1);
  assert.equal(forwardingCalls[0].conversationId, parent.id);
  assert.notEqual(forwardingCalls[0].conversationId, viewedParent.id);
  assert.equal(forwardingCalls[0].steer, true);
  assert.match(forwardingCalls[0].text, /Managed final result\./);
  assert.doesNotMatch(forwardingCalls[0].text, /Private reasoning/);
  assert.match(forwardingCalls[0].text, new RegExp(`source_message_id="${managedResult.id}"`));

  insertMessage({
    conversationId: parent.id,
    role: 'user',
    status: 'sent',
    content: forwardingCalls[0].text,
  });
  await forwardingRunner.forwardSubagentResult(managedResult);
  assert.equal(forwardingCalls.length, 1);

  const managedError = insertMessage({
    conversationId: managedSubagent.conversation.id,
    role: 'assistant',
    model: 'test/model',
    status: 'error',
    content: '**Streaming error (provider_error):** Managed worker failed.',
    segments: [{
      type: 'error',
      code: 'provider_error',
      message: 'Managed worker failed.',
      status: 'completed',
    }],
  });
  await forwardingRunner.forwardSubagentResult(managedError);
  assert.equal(forwardingCalls.length, 2);
  assert.equal(forwardingCalls[1].steer, true);
  assert.match(forwardingCalls[1].text, /Managed worker failed\./);
  assert.match(forwardingCalls[1].text, /status="error"/);

  const manualResult = insertMessage({
    conversationId: subagent.conversation.id,
    role: 'assistant',
    model: 'test/model',
    status: 'completed',
    content: 'Manual result must remain local.',
  });
  assert.equal(getConversation(subagent.conversation.id).autoForwardToParent, false);
  assert.ok(
    toModelMessages(subagent.conversation.id)[0].content.includes(
      'final response is not forwarded',
    ),
  );
  await forwardingRunner.forwardSubagentResult(manualResult);
  assert.equal(forwardingCalls.length, 2);

  const lifecycleResults = [];
  const lifecycleErrorSubagent = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Fail during execution.',
    autoForwardToParent: true,
  });
  const lifecycleRunner = new ChatRunner({
    registry: {
      resolve: () => ({
        model: runtimeModel,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: async ({ invocationContext, onEvent }) => {
            if (invocationContext.conversationId === lifecycleErrorSubagent.conversation.id) {
              throw new Error('Lifecycle failure.');
            }
            onEvent({ type: 'content', text: 'Lifecycle result.' });
            return {
              assistantContent: 'Lifecycle result.',
              continuation: [],
              toolCalls: [],
            };
          },
        },
      }),
      listModels: () => [runtimeModel],
    },
    sendEvent: () => {},
  });
  lifecycleRunner.forwardSubagentResult = async (message) => lifecycleResults.push(message);
  await lifecycleRunner.send({
    conversationId: managedSubagent.conversation.id,
    model: runtimeModel.id,
    text: 'Complete the lifecycle task.',
  });
  while (lifecycleRunner.runs.has(managedSubagent.conversation.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(lifecycleResults.at(-1).status, 'completed');
  assert.match(lifecycleResults.at(-1).content, /Lifecycle result\./);

  await lifecycleRunner.send({
    conversationId: lifecycleErrorSubagent.conversation.id,
    model: runtimeModel.id,
    text: 'Trigger the lifecycle error.',
  });
  while (lifecycleRunner.runs.has(lifecycleErrorSubagent.conversation.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(lifecycleResults.at(-1).status, 'error');
  assert.match(lifecycleResults.at(-1).content, /Lifecycle failure\./);

  const orchestratorMessageCalls = [];
  const orchestratorMessage = await sendPromptTool.execute(
    { threadId: parent.id, prompt: 'Queue inspection completed.', mode: 'queue' },
    {
      chatRunner: {
        send: async (payload) => {
          orchestratorMessageCalls.push(payload);
          return { queued: true, message: { id: 'orchestrator-message' } };
        },
      },
      conversationId: spawned.thread_id,
    },
  );
  assert.equal(orchestratorMessage.threadId, parent.id);
  assert.equal(orchestratorMessage.status, 'queued');
  assert.equal(orchestratorMessageCalls[0].text, 'Queue inspection completed.');
  assert.equal(orchestratorMessageCalls[0].ultraMode, true);
  assert.equal(orchestratorMessageCalls[0].queuePriority, true);

  const planParent = createConversation({ model: 'test/model', projectPath: process.cwd() });
  const planSpawnCalls = [];
  const planSpawn = await spawnTool.execute(
    { prompt: 'Research the Plan-mode behavior.' },
    {
      chatRunner: {
        runs: new Map(),
        emit: () => {},
        send: async (payload) => {
          planSpawnCalls.push(payload);
          return { queued: false, message: { id: 'plan-spawn-prompt' } };
        },
      },
      conversationId: planParent.id,
      model: 'test/model',
      models: [{ id: 'test/model', name: 'Test model', reasoning: ['high'] }],
      reasoningEffort: 'high',
      workMode: 'plan',
    },
  );
  const planSubagent = getConversation(planSpawn.thread_id);
  assert.equal(planSubagent.orchestrationMode, 'plan');
  assert.equal(planSpawnCalls[0].workMode, 'plan');
  const planContext = toModelMessages(planSubagent.id)[0].content;
  assert.match(planContext, /read-only Plan-mode specialist/);
  assert.match(planContext, /coordinate directly with the parent or listed sibling sub-agents/);
  assert.match(planContext, /Do not edit files, run commands, mutate data/);

  const planMessageCalls = [];
  await sendPromptTool.execute(
    { threadId: planParent.id, prompt: 'Consolidate the findings.', mode: 'queue' },
    {
      chatRunner: {
        send: async (payload) => {
          planMessageCalls.push(payload);
          return { queued: true, message: { id: 'plan-message' } };
        },
      },
      conversationId: planSubagent.id,
    },
  );
  assert.equal(planMessageCalls[0].workMode, 'plan');
  await assert.rejects(
    () => sendPromptTool.execute(
      { threadId: parent.id, prompt: 'Leave the team.', mode: 'queue' },
      { chatRunner: { send: async () => ({ queued: false, message: { id: 'unexpected' } }) }, conversationId: planSubagent.id },
    ),
    /limited to the current orchestration team/,
  );

  const planStatusCalls = [];
  await sendPromptTool.execute(
    { threadId: planParent.id, prompt: 'Plan research is complete.', mode: 'queue' },
    {
      chatRunner: {
        send: async (payload) => {
          planStatusCalls.push(payload);
          return { queued: true, message: { id: 'plan-status' } };
        },
      },
      conversationId: planSubagent.id,
    },
  );
  assert.equal(planStatusCalls[0].workMode, 'plan');

  const planResult = insertMessage({
    conversationId: planSubagent.id,
    role: 'assistant',
    model: 'test/model',
    status: 'completed',
    content: 'Plan result.',
  });
  await forwardingRunner.forwardSubagentResult(planResult);
  assert.equal(forwardingCalls.at(-1).conversationId, planParent.id);
  assert.equal(forwardingCalls.at(-1).workMode, 'plan');

  deleteConversation(planParent.id);
  deleteConversation(parent.id);
  assert.equal(getConversation(second.conversation.id), null);
  assert.equal(getConversation(third.conversation.id), null);
  assert.equal(getConversation(subagent.conversation.id), null);
  assert.equal(getConversation(spawned.thread_id), null);
  console.log('Child-thread database and sub-agent tool flow passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
