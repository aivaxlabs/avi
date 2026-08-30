import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-compaction-failure-limit-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');

  const model = {
    id: 'test:model',
    name: 'Test',
    modelId: 'test',
    providerId: 'test-provider',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    capabilities: {},
    context: { input: 100_000, output: 10_000 },
  };
  let chatAttempts = 0;
  let compactionAttempts = 0;
  const provider = {
    getContributions: () => ({
      tools: [{
        name: 'continue_work',
        description: 'Continue the test run.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async () => 'Continue.',
      }],
    }),
    stream: async ({ messages, onEvent }) => {
      if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
        compactionAttempts += 1;
        throw new Error('Compaction provider failed.');
      }

      chatAttempts += 1;
      onEvent({ type: 'usage', usage: { inputTokens: 95_000, outputTokens: 10 } });
      const toolCall = {
        key: `continue-${chatAttempts}`,
        callId: `continue-${chatAttempts}`,
        name: 'continue_work',
        argumentsText: JSON.stringify({
          __invocation_goal: 'Continue the compaction failure regression',
          __requires_human_approval: false,
        }),
      };
      onEvent({ type: 'tool-call', ...toolCall });
      return {
        assistantContent: '',
        continuation: [],
        toolCalls: [toolCall],
      };
    },
  };
  const events = [];
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: (event) => events.push(event),
  });
  const conversation = database.createConversation({
    model: model.id,
    projectPath: testProfile,
  });

  await runner.send({
    conversationId: conversation.id,
    model: model.id,
    text: 'Run until the compaction guard stops the chat.',
  });
  const deadline = Date.now() + 5_000;
  while (runner.runs.has(conversation.id)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the chat to stop.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }

  assert.equal(compactionAttempts, 3);
  assert.equal(chatAttempts, 3);
  assert.equal(
    database.getMessages(conversation.id)
      .findLast((message) => message.role === 'assistant')
      ?.status,
    'error',
  );
  assert.ok(events.some((event) => (
    event.type === 'error'
    && event.message === 'Context compression failed 3 consecutive times. Chat stopped.'
  )));

  const resetConversation = database.createConversation({
    model: model.id,
    projectPath: testProfile,
  });
  const resetUserMessage = database.insertMessage({
    conversationId: resetConversation.id,
    role: 'user',
    status: 'sent',
    content: 'Reset the compaction failure counter.',
  });
  let resetShouldSucceed = false;
  let resetProviderCalls = 0;
  const resetController = new AbortController();
  const resetRun = {
    controller: resetController,
    queue: [],
    assistantMessageId: resetUserMessage.id,
    kind: 'chat',
    phase: 'inference',
    consecutiveContextCompactionFailures: 0,
  };
  runner.runs.set(resetConversation.id, resetRun);
  provider.stream = async () => {
    resetProviderCalls += 1;
    if (!resetShouldSucceed) throw new Error('Compaction provider failed.');
    return {
      assistantContent: 'Recovered compaction checkpoint.',
      continuation: [],
      toolCalls: [],
    };
  };
  const compress = () => runner.compress({
    conversationId: resetConversation.id,
    model: model.id,
    automatic: true,
    controller: resetController,
    contextMessages: [{ role: 'user', content: 'Reset the failure counter.' }],
  });

  await assert.rejects(compress(), /Compaction provider failed/);
  assert.equal(resetProviderCalls, 1);
  assert.equal(resetRun.consecutiveContextCompactionFailures, 1);
  resetShouldSucceed = true;
  await compress();
  assert.equal(resetProviderCalls, 2);
  assert.equal(resetRun.consecutiveContextCompactionFailures, 0);

  database.closeDatabase();
  database = null;
  console.log('Context compaction failure limit tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
