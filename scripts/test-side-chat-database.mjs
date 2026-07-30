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
    setTuningSettings,
    toModelMessages,
    toModelMessagesThroughUser,
    updateConversation,
  } = database;
  assert.deepEqual(getPreferences().tuning, {
    automaticCompactionThreshold: 0.9,
    toolOutputLimit: 120_000,
    defaultPermissionMode: 'approve_for_me',
    messageDeliveryMode: 'queue',
    terminalShell: 'auto',
    terminalTimeoutSeconds: 30,
    maxConcurrentSubagents: 128,
  });
  assert.deepEqual(setTuningSettings({
    automaticCompactionThreshold: 0.8,
    toolOutputLimit: null,
    defaultPermissionMode: 'ask_for_approval',
    messageDeliveryMode: 'steer',
    terminalShell: 'pwsh',
    terminalTimeoutSeconds: 45,
    maxConcurrentSubagents: 4,
  }), {
    automaticCompactionThreshold: 0.8,
    toolOutputLimit: null,
    defaultPermissionMode: 'ask_for_approval',
    messageDeliveryMode: 'steer',
    terminalShell: 'pwsh',
    terminalTimeoutSeconds: 45,
    maxConcurrentSubagents: 4,
  });
  assert.equal(getPreferences().tuning.terminalTimeoutSeconds, 45);
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

  const parent = createConversation({ model: 'test/model', projectPath: process.cwd() });
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
  assert.deepEqual(
    listSubagents(parent.id).map((agent) => agent.title),
    ['Sub-agent 1'],
  );
  assert.equal(listSubagents(parent.id)[0].firstPrompt, 'Inspect the initial queue state.');
  const subagentModelMessages = toModelMessages(subagent.conversation.id);
  assert.ok(subagentModelMessages[0].content.includes('thread_type: subagent'));
  assert.ok(subagentModelMessages[0].content.includes(`thread_id: ${subagent.conversation.id}`));
  assert.ok(subagentModelMessages[0].content.includes(`parent_thread_id: ${parent.id}`));
  assert.ok(subagentModelMessages[0].content.includes('chat_report_to_orchestrator'));
  assert.equal(forkConversation(subagent.conversation.id, { subagent: true }), null);
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const spawnTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_spawn_subagent');
  const reportTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_report_to_orchestrator');
  const sendPromptTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_send_prompt');
  assert.deepEqual(spawnTool.inputSchema.required, ['prompt']);
  assert.deepEqual(
    spawnTool.inputSchema.properties.response_mode.enum,
    ['steer', 'queue', 'none'],
  );
  const spawnEvents = [];
  const spawnCalls = [];
  const spawnRuns = new Map();
  const spawned = await spawnTool.execute(
    {
      prompt: 'Inspect the queue.',
      response_mode: 'steer',
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
  assert.equal(getConversation(spawned.thread_id).initialPrompt, 'Inspect the queue.');
  assert.equal(getConversation(spawned.thread_id).orchestrationMode, 'ultra');
  assert.equal(spawnCalls[0].conversationId, spawned.thread_id);
  assert.equal(spawnCalls[0].reasoningEffort, 'high');
  assert.equal(spawnCalls[0].ultraMode, true);
  assert.equal(
    spawnCalls[0].text,
    [
      'Inspect the queue.',
      `When the assignment is complete, send the final result to orchestrator thread "${parent.id}" with chat_send_prompt using mode "steer".`,
    ].join('\n\n'),
  );
  assert.ok(toModelMessages(spawned.thread_id)[0].content.includes('Ultra team'));
  assert.ok(toModelMessages(spawned.thread_id)[0].content.includes('chat_send_prompt'));
  assert.equal(spawnEvents[0].conversationId, parent.id);
  const queueCalls = [];
  const queuedSubagent = await spawnTool.execute(
    {
      prompt: 'Inspect the queued work.',
      response_mode: 'queue',
    },
    {
      chatRunner: {
        runs: new Map(),
        emit: () => {},
        send: async (payload) => {
          queueCalls.push(payload);
          return { queued: false, message: { id: 'queue-prompt' } };
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
  assert.equal(
    queueCalls[0].text,
    [
      'Inspect the queued work.',
      'When the assignment is complete, use chat_report_to_orchestrator to queue the final result for the orchestrator.',
    ].join('\n\n'),
  );
  deleteConversation(queuedSubagent.thread_id, { hard: true });
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
  await assert.rejects(
    () => spawnTool.execute(
      {
        prompt: 'Inspect another queue.',
        response_mode: 'queue',
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
        response_mode: 'queue',
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

  const reportCalls = [];
  const report = await reportTool.execute(
    { message: 'Queue inspection completed.' },
    {
      chatRunner: {
        send: async (payload) => {
          reportCalls.push(payload);
          return { queued: true, message: { id: 'report-message' } };
        },
      },
      conversationId: spawned.thread_id,
    },
  );
  assert.equal(report.thread_id, parent.id);
  assert.equal(report.status, 'queued');
  assert.ok(reportCalls[0].text.includes(spawned.thread_id));
  assert.equal(reportCalls[0].ultraMode, true);
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
