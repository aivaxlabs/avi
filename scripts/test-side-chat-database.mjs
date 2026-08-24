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
    verbosity: 'medium',
    chatReasoningTraces: 'visible',
    continuationRepliesEnabled: true,
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
    verbosity: 'high',
    chatReasoningTraces: 'hidden',
    continuationRepliesEnabled: false,
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
    verbosity: 'high',
    chatReasoningTraces: 'hidden',
    continuationRepliesEnabled: false,
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
  assert.equal(getPreferences().tuning.verbosity, 'high');
  assert.equal(getPreferences().tuning.chatReasoningTraces, 'hidden');
  assert.equal(getPreferences().tuning.continuationRepliesEnabled, false);
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
  for (const verbosity of ['low', 'medium', 'high']) {
    assert.equal(setTuningSettings({
      ...getPreferences().tuning,
      verbosity,
    }).verbosity, verbosity);
  }
  assert.throws(
    () => setTuningSettings({
      ...getPreferences().tuning,
      verbosity: 'invalid',
    }),
    /outside their allowed range/,
  );
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
  assert.equal(firstMessages.length, 3);
  assert.equal(firstMessages.at(-1).role, 'user');
  assert.equal(firstMessages.at(-1).hidden, true);
  assert.match(firstMessages.at(-1).content, /^<side-chat-instructions>/);
  assert.match(firstMessages.at(-1).content, /forked into this side chat/);
  assert.match(firstMessages.at(-1).content, /<thread_context> system message/);
  const sideChatModelMessages = toModelMessages(first.conversation.id);
  assert.equal(sideChatModelMessages[0].role, 'system');
  assert.ok(sideChatModelMessages[0].content.includes('thread_type: side_chat'));
  assert.ok(sideChatModelMessages[0].content.includes('only explore and investigate'));
  assert.ok(sideChatModelMessages[0].content.includes('only when the user explicitly asks'));
  assert.ok(sideChatModelMessages[0].content.includes(`thread_id: ${first.conversation.id}`));
  assert.ok(sideChatModelMessages[0].content.includes(`parent_thread_id: ${parent.id}`));
  assert.equal(sideChatModelMessages.at(-1).role, 'user');
  assert.equal(sideChatModelMessages.at(-1).content, firstMessages.at(-1).content);
  const sideChatReply = insertMessage({
    conversationId: first.conversation.id,
    role: 'assistant',
    status: 'completed',
    content: 'Side chat answer',
  });
  const retryModelMessages = toModelMessagesThroughUser(
    first.conversation.id,
    sideChatReply.id,
  );
  assert.equal(retryModelMessages[0].content, sideChatModelMessages[0].content);
  assert.equal(retryModelMessages.at(-1).content, firstMessages.at(-1).content);
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

  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const listThreadsTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_list_threads');
  const inspectThreadTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_inspect_thread');
  const interruptThreadTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_interrupt_thread');
  const visibleThreads = await listThreadsTool.execute({}, {
    chatRunner: { runs: new Map() },
    conversationId: parent.id,
  });
  assert.doesNotMatch(visibleThreads, new RegExp(`ID: ${first.conversation.id}`));
  const sideChatThreads = await listThreadsTool.execute({}, {
    chatRunner: { runs: new Map() },
    conversationId: first.conversation.id,
  });
  assert.match(sideChatThreads, new RegExp(`ID: ${second.conversation.id}`));
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
  const interruptCalls = [];
  assert.equal(
    await interruptThreadTool.execute(
      { threadId: parent.id },
      {
        chatRunner: {
          runs: new Map([[parent.id, {}]]),
          requestSteer: (conversationId) => interruptCalls.push(conversationId),
        },
        conversationId: parent.id,
      },
    ),
    `Thread ${parent.id} interrupted.`,
  );
  assert.equal(
    await interruptThreadTool.execute(
      { threadId: parent.id },
      {
        chatRunner: {
          runs: new Map(),
          requestSteer: (conversationId) => interruptCalls.push(conversationId),
        },
        conversationId: parent.id,
      },
    ),
    `Thread ${parent.id} was not running.`,
  );
  assert.deepEqual(interruptCalls, [parent.id, parent.id]);

  const inspectionContext = {
    chatRunner: {
      runs: new Map(),
      semaphores: { waitSnapshot: () => null },
      getPendingQuestion: () => null,
    },
    conversationId: parent.id,
  };
  const interruptedThread = createConversation({
    model: 'test:model',
    projectPath: process.cwd(),
  });
  insertMessage({
    conversationId: interruptedThread.id,
    role: 'user',
    status: 'sent',
    content: 'Interrupted request',
  });
  insertMessage({
    conversationId: interruptedThread.id,
    role: 'assistant',
    status: 'aborted',
    content: 'Interrupted response',
  });
  const inspectedInterruptedThread = await inspectThreadTool.execute(
    { threadId: interruptedThread.id },
    inspectionContext,
  );
  assert.match(inspectedInterruptedThread, /status: idle/);
  assert.match(
    inspectedInterruptedThread,
    /<\|assistant_start\|>Interrupted response<\|assistant_end\|>/,
  );
  assert.equal(getConversation(interruptedThread.id), null);

  const completedThread = createConversation({
    model: 'test:model',
    projectPath: process.cwd(),
  });
  insertMessage({
    conversationId: completedThread.id,
    role: 'user',
    status: 'sent',
    content: 'Completed request',
  });
  insertMessage({
    conversationId: completedThread.id,
    role: 'assistant',
    status: 'completed',
    content: 'Completed response',
  });
  await inspectThreadTool.execute({ threadId: completedThread.id }, inspectionContext);
  assert.equal(getConversation(completedThread.id)?.id, completedThread.id);

  const structuredThread = createConversation({
    model: 'test:model',
    projectPath: process.cwd(),
  });
  insertMessage({
    conversationId: structuredThread.id,
    role: 'user',
    status: 'sent',
    content: 'Inspect this media.',
    attachments: [
      { kind: 'image_url' },
      { kind: 'input_audio' },
      { kind: 'file' },
    ],
  });
  insertMessage({
    conversationId: structuredThread.id,
    role: 'assistant',
    status: 'completed',
    content: 'Done.',
    attachments: [{ kind: 'video_url' }],
    segments: [
      { type: 'content', text: 'Checking now.' },
      {
        type: 'tool-call',
        callId: 'call-123',
        name: 'web_search',
        argumentsText: JSON.stringify({ query: 'clima em rio preto' }),
        resultText: 'x'.repeat(2_049),
        status: 'completed',
      },
      { type: 'content', text: 'Done.' },
    ],
  });
  const inspectedStructuredThread = await inspectThreadTool.execute(
    { threadId: structuredThread.id },
    inspectionContext,
  );
  assert.match(inspectedStructuredThread, new RegExp(`^thread_id: ${structuredThread.id}\\n`));
  assert.match(inspectedStructuredThread, /thread_type: thread\nstatus: idle\nmodel: test:model\n/);
  assert.match(
    inspectedStructuredThread,
    /<\|user_start\|>Inspect this media\.\n<<image_media>>\n<<audio_media>>\n<<file_media>><\|user_end\|>/,
  );
  assert.doesNotMatch(
    inspectedStructuredThread,
    /tool_call|web_search|call-123|clima em rio preto|tool_result|x{100}/,
  );
  assert.match(
    inspectedStructuredThread,
    /<\|assistant_start\|><<video_media>><\|assistant_end\|>/,
  );

  const activeErroredThread = createConversation({
    model: 'test:model',
    projectPath: process.cwd(),
  });
  insertMessage({
    conversationId: activeErroredThread.id,
    role: 'assistant',
    status: 'error',
    content: 'Recovering from an error',
  });
  inspectionContext.chatRunner.runs.set(activeErroredThread.id, {});
  await inspectThreadTool.execute({ threadId: activeErroredThread.id }, inspectionContext);
  assert.equal(getConversation(activeErroredThread.id)?.id, activeErroredThread.id);
  inspectionContext.chatRunner.runs.delete(activeErroredThread.id);

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
  assert.equal(subagent.conversation.title, 'Euclid');
  assert.equal(subagent.conversation.initialPrompt, 'Inspect the initial queue state.');
  assert.equal(subagent.conversation.contextCheckpoint, '');
  assert.equal(subagent.conversation.checkpointMessageId, null);
  assert.equal(subagent.conversation.contextTokens, 0);
  assert.deepEqual(getMessages(subagent.conversation.id), []);
  assert.deepEqual(
    listSubagents(parent.id).map((agent) => agent.title),
    ['Euclid'],
  );
  assert.equal(listSubagents(parent.id)[0].firstPrompt, 'Inspect the initial queue state.');
  const subagentModelMessages = toModelMessages(subagent.conversation.id);
  assert.ok(subagentModelMessages[0].content.includes('thread_type: subagent'));
  assert.ok(subagentModelMessages[0].content.includes(`thread_id: ${subagent.conversation.id}`));
  assert.ok(subagentModelMessages[0].content.includes(`parent_thread_id: ${parent.id}`));
  assert.ok(subagentModelMessages[0].content.includes('You are the sub-agent called Euclid.'));
  assert.ok(subagentModelMessages[0].content.includes('final response is not forwarded'));
  assert.equal(subagentModelMessages.length, 1);
  assert.equal(subagentModelMessages.some((message) => message.content === 'Parent context'), false);
  assert.equal(subagentModelMessages.some((message) => message.content === 'Parent answer'), false);
  assert.equal(subagentModelMessages.some((message) => message.content.includes('Checkpoint snapshot')), false);
  assert.equal(forkConversation(subagent.conversation.id, { subagent: true }), null);
  const updateTasksTool = CLIENT_TOOLS.find((tool) => tool.name === 'update_tasks');
  const taskEvents = [];
  const toolTasks = [{
    title: 'Track tool progress',
    description: 'Verify the tool contract.',
    done: true,
    result: 'Persisted and emitted.',
  }];
  assert.equal(await updateTasksTool.execute({ tasks: toolTasks }, {
    chatRunner: { emit: (conversationId, event) => taskEvents.push({ conversationId, event }) },
    conversationId: parent.id,
    workMode: null,
  }), 'Task list updated: 1 task(s).');
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
  assert.deepEqual(sendPromptTool.inputSchema.required, ['threadId', 'prompt']);
  assert.equal(sendPromptTool.inputSchema.properties.low_priority.type, 'boolean');
  assert.equal(sendPromptTool.inputSchema.properties.mode, undefined);
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
  assert.match(spawned, /^Sub-agent started\./);
  assert.match(spawned, /Status: working$/);
  const spawnedThreadId = spawnCalls[0].conversationId;
  assert.match(spawned, new RegExp(`Thread ID: ${spawnedThreadId}`));
  assert.equal(getConversation(spawnedThreadId).title, 'Archimedes');
  assert.equal(getConversation(spawnedThreadId).isSubagent, true);
  assert.equal(getConversation(spawnedThreadId).parentConversationId, parent.id);
  assert.equal(getConversation(spawnedThreadId).initialPrompt, 'Inspect the queue.');
  assert.equal(getConversation(spawnedThreadId).orchestrationMode, 'ultra');
  assert.equal(getConversation(spawnedThreadId).autoForwardToParent, true);
  assert.equal(spawnCalls[0].conversationId, spawnedThreadId);
  assert.equal(spawnCalls[0].reasoningEffort, 'high');
  assert.equal(spawnCalls[0].ultraMode, true);
  assert.equal(spawnCalls[0].text, 'Inspect the queue.');
  assert.ok(toModelMessages(spawnedThreadId)[0].content.includes('Ultra team'));
  assert.ok(
    toModelMessages(spawnedThreadId)[0].content.includes(
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
  const optionalSubagentThreadId = noResponseCalls[0].conversationId;
  assert.match(optionalSubagent, new RegExp(`Thread ID: ${optionalSubagentThreadId}`));
  assert.equal(getConversation(optionalSubagentThreadId).title, 'Pythagoras');
  assert.equal(noResponseCalls[0].text, 'Inspect without a reporting preference.');
  deleteConversation(optionalSubagentThreadId, { hard: true });
  const agentMessage = insertMessage({
    conversationId: spawnedThreadId,
    role: 'user',
    status: 'sent',
    content: 'Persist this prompt without decoration.',
    fromAgent: true,
  });
  assert.equal(agentMessage.content, 'Persist this prompt without decoration.');
  assert.equal(agentMessage.fromAgent, true);
  assert.equal(getMessages(spawnedThreadId).find((message) => message.id === agentMessage.id)?.fromAgent, true);
  const crossAgentCalls = [];
  await sendPromptTool.execute(
    {
      threadId: spawnedThreadId,
      prompt: 'Coordinate this finding with the team.',
      low_priority: true,
    },
    {
      chatRunner: {
        send: async (payload) => {
          crossAgentCalls.push(payload);
          return { queued: true, message: { id: 'cross-agent-prompt' } };
        },
      },
      conversationId: parent.id,
    },
  );
  assert.equal(crossAgentCalls[0].text, 'Coordinate this finding with the team.');
  assert.equal(crossAgentCalls[0].fromAgent, true);
  assert.equal(crossAgentCalls[0].ultraMode, true);
  assert.equal(crossAgentCalls[0].queuePriority, false);
  await assert.rejects(
    () => sendPromptTool.execute(
      { threadId: second.conversation.id, prompt: 'Reveal the side chat.', low_priority: true },
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
  assert.equal(failedSubagent.conversation.title, 'Pascal');
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
  const threadContexts = [];
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
            threadContexts.push(invocationContext.threads);
            return { assistantContent: '', continuation: [], toolCalls: [] };
          },
        },
      }),
      listModels: () => [runtimeModel],
    },
    sendEvent: () => {},
  });
  const questionEvents = [];
  const questionRunner = new ChatRunner({
    registry: { resolve: () => ({ model: runtimeModel }) },
    sendEvent: (event) => questionEvents.push(event),
  });
  const pendingQuestions = [{
    type: 'free_text',
    question: 'Which scope should I use?',
  }];
  const questionConversation = createConversation({
    model: runtimeModel.id,
    projectPath: process.cwd(),
  });
  insertMessage({
    conversationId: questionConversation.id,
    role: 'user',
    model: runtimeModel.id,
    status: 'sent',
    content: 'Choose the implementation scope.',
  });
  insertMessage({
    conversationId: questionConversation.id,
    role: 'assistant',
    model: runtimeModel.id,
    status: 'streaming',
    content: '',
    segments: [{
      type: 'tool-call',
      callId: 'pending-question',
      name: 'ask_question',
      argumentsText: JSON.stringify({ questions: pendingQuestions }),
      status: 'running',
    }],
  });
  let questionResult = null;
  questionRunner.runs.set(questionConversation.id, { phase: 'question' });
  questionRunner.pendingQuestions.set('pending-question', {
    conversationId: questionConversation.id,
    questions: pendingQuestions,
    finish: (result) => {
      questionResult = result;
    },
  });
  const inspectedQuestion = await inspectThreadTool.execute(
    { threadId: questionConversation.id },
    { chatRunner: questionRunner, conversationId: spawnedThreadId },
  );
  assert.match(inspectedQuestion, /status: waiting_for_input/);
  assert.doesNotMatch(inspectedQuestion, /tool_call|ask_question/);
  assert.doesNotMatch(
    inspectedQuestion,
    new RegExp(pendingQuestions[0].question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  const questionSendCalls = [];
  questionRunner.send = async (payload) => {
    questionSendCalls.push(payload);
    assert.equal(questionRunner.pendingQuestions.has('pending-question'), true);
    return { queued: true, message: { id: `question-${payload.steer ? 'override' : 'queue'}` } };
  };
  const queuedDuringQuestion = await sendPromptTool.execute(
    { threadId: questionConversation.id, prompt: 'Handle this after the answer.', low_priority: true },
    { chatRunner: questionRunner, conversationId: spawnedThreadId },
  );
  assert.match(queuedDuringQuestion, /Status: queued_waiting_for_input$/);
  assert.equal(questionSendCalls[0].steer, false);
  assert.equal(questionRunner.pendingQuestions.has('pending-question'), true);
  assert.equal(questionResult, null);
  const stillWaiting = await inspectThreadTool.execute(
    { threadId: questionConversation.id },
    { chatRunner: questionRunner, conversationId: spawnedThreadId },
  );
  assert.match(stillWaiting, /status: waiting_for_input/);

  const questionOverride = await sendPromptTool.execute(
    { threadId: questionConversation.id, prompt: 'Use the smallest safe scope.' },
    { chatRunner: questionRunner, conversationId: spawnedThreadId },
  );
  assert.match(questionOverride, /Status: steered$/);
  assert.equal(questionSendCalls[1].steer, true);
  assert.equal(questionRunner.pendingQuestions.size, 0);
  assert.deepEqual(questionResult, { cancelled: true, answers: [] });
  assert.deepEqual(questionEvents.at(-1), {
    conversationId: questionConversation.id,
    type: 'question-cancelled',
    questionId: 'pending-question',
  });
  deleteConversation(questionConversation.id, { hard: true });

  runtimeRunner.runs.set(spawnedThreadId, {});
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
    threadContexts[0].map(({ threadId }) => threadId),
    [subagent.conversation.id, spawnedThreadId, failedSubagent.conversation.id],
  );
  assert.equal(threadContexts[0].some(({ threadId }) => threadId === parent.id), false);
  assert.equal(threadContexts[0].some(({ threadId }) => threadId === taskPeer.id), false);
  assert.equal(threadContexts[0].some(({ role }) => role === 'side_chat'), false);
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
        threadId: spawnedThreadId,
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

  runtimeRunner.runs.delete(spawnedThreadId);
  await runtimeRunner.send({
    conversationId: subagent.conversation.id,
    model: runtimeModel.id,
    text: 'Re-check the shared sub-agent state.',
    reasoningEffort: 'high',
  });
  while (runtimeRunner.runs.has(subagent.conversation.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(subagentContexts[1].length, 2);
  assert.deepEqual(
    threadContexts[1].map(({ threadId }) => threadId),
    [parent.id, spawnedThreadId, failedSubagent.conversation.id],
  );
  assert.equal(threadContexts[1].some(({ threadId }) => threadId === subagent.conversation.id), false);
  assert.deepEqual(
    subagentContexts[1].map(({ threadId, status }) => ({ threadId, status })),
    [
      { threadId: spawnedThreadId, status: 'failed' },
      { threadId: failedSubagent.conversation.id, status: 'failed' },
    ],
  );

  await runtimeRunner.send({
    conversationId: third.conversation.id,
    model: runtimeModel.id,
    text: 'Review the orchestration team privately.',
    reasoningEffort: 'high',
  });
  while (runtimeRunner.runs.has(third.conversation.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.deepEqual(
    threadContexts[2].map(({ threadId }) => threadId),
    [parent.id, subagent.conversation.id, spawnedThreadId, failedSubagent.conversation.id],
  );
  assert.equal(threadContexts[2].some(({ threadId }) => threadId === third.conversation.id), false);
  assert.equal(threadContexts[2].some(({ threadId }) => threadId === second.conversation.id), false);
  assert.equal(threadContexts[2].some(({ threadId }) => threadId === taskPeer.id), false);

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
  await forwardingRunner.forwardSubagentResult(managedResult, 'full_access');
  assert.equal(forwardingCalls.length, 1);
  assert.equal(forwardingCalls[0].conversationId, parent.id);
  assert.equal(forwardingCalls[0].permissionMode, 'full_access');
  assert.notEqual(forwardingCalls[0].conversationId, viewedParent.id);
  assert.equal(forwardingCalls[0].steer, true);
  assert.match(forwardingCalls[0].text, /Managed final result\./);
  assert.doesNotMatch(forwardingCalls[0].text, /Private reasoning/);
  assert.match(
    forwardingCalls[0].text,
    new RegExp(`<subagent_report thread_id="${managedSubagent.conversation.id}" title="${managedSubagent.conversation.title}"`),
  );
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
  lifecycleRunner.forwardSubagentResult = async (message, permissionMode) => {
    lifecycleResults.push({ message, permissionMode });
  };
  await lifecycleRunner.send({
    conversationId: managedSubagent.conversation.id,
    model: runtimeModel.id,
    text: 'Complete the lifecycle task.',
    permissionMode: 'full_access',
  });
  while (lifecycleRunner.runs.has(managedSubagent.conversation.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(lifecycleResults.at(-1).message.status, 'completed');
  assert.match(lifecycleResults.at(-1).message.content, /Lifecycle result\./);
  assert.equal(lifecycleResults.at(-1).permissionMode, 'full_access');

  await lifecycleRunner.send({
    conversationId: lifecycleErrorSubagent.conversation.id,
    model: runtimeModel.id,
    text: 'Trigger the lifecycle error.',
  });
  while (lifecycleRunner.runs.has(lifecycleErrorSubagent.conversation.id)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(lifecycleResults.at(-1).message.status, 'error');
  assert.match(lifecycleResults.at(-1).message.content, /Lifecycle failure\./);
  assert.equal(lifecycleResults.at(-1).permissionMode, 'approve_for_me');

  const orchestratorMessageCalls = [];
  const orchestratorMessage = await sendPromptTool.execute(
    { threadId: parent.id, prompt: 'Queue inspection completed.', low_priority: true },
    {
      chatRunner: {
        send: async (payload) => {
          orchestratorMessageCalls.push(payload);
          return { queued: true, message: { id: 'orchestrator-message' } };
        },
      },
      conversationId: spawnedThreadId,
    },
  );
  assert.match(orchestratorMessage, new RegExp(`Thread ID: ${parent.id}`));
  assert.match(orchestratorMessage, /Status: queued$/);

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
  const planSubagent = getConversation(planSpawnCalls[0].conversationId);
  assert.match(planSpawn, new RegExp(`Thread ID: ${planSubagent.id}`));
  assert.equal(planSubagent.orchestrationMode, 'plan');
  assert.equal(planSpawnCalls[0].workMode, 'plan');
  const planContext = toModelMessages(planSubagent.id)[0].content;
  assert.match(planContext, /Plan-mode specialist/);
  assert.match(planContext, /coordinate directly with the parent or listed sibling sub-agents/);
  assert.match(planContext, /terminal commands strictly for read-only investigation/);
  assert.match(planContext, /Do not edit files, mutate data/);

  const planMessageCalls = [];
  await sendPromptTool.execute(
    { threadId: planParent.id, prompt: 'Consolidate the findings.', low_priority: true },
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
      { threadId: parent.id, prompt: 'Leave the team.', low_priority: true },
      { chatRunner: { send: async () => ({ queued: false, message: { id: 'unexpected' } }) }, conversationId: planSubagent.id },
    ),
    /limited to the current orchestration team/,
  );

  const planStatusCalls = [];
  await sendPromptTool.execute(
    { threadId: planParent.id, prompt: 'Plan research is complete.', low_priority: true },
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
  assert.equal(getConversation(spawnedThreadId), null);
  console.log('Child-thread database and sub-agent tool flow passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
