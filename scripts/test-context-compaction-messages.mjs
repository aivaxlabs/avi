import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-compaction-messages-test-'));
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
  const compactionRequests = [];
  const provider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ messages, tools, toolHistory }) => {
      if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
        compactionRequests.push({ messages: structuredClone(messages), tools, toolHistory });
        if (compactionRequests.length < 4) {
          const error = new Error('This models maximum context length is exceeded.');
          error.status = 413;
          throw error;
        }
        return {
          assistantContent: 'Structured checkpoint.',
          continuation: [],
          toolCalls: [],
        };
      }
      throw new Error('Chat inference is not expected in this test.');
    },
  };
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: () => {},
  });
  const conversation = database.createConversation({
    model: model.id,
    projectPath: testProfile,
  });
  database.insertMessage({
    conversationId: conversation.id,
    role: 'user',
    status: 'sent',
    content: 'Compact this conversation.',
  });

  const contextMessages = [
    { role: 'user', content: 'Investigate the failing compression flow.' },
    {
      role: 'assistant',
      content: 'Checking the persisted messages.',
      reasoning_content: 'context reasoning that must not be resent',
      reasoning_details: [{ encrypted_content: 'forbidden-provider-state' }],
      providerMetadata: { id: 'forbidden-provider-state' },
      tool_calls: [{
        id: 'ctx-call',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"src/main/chat-runner.js"}' },
      }],
    },
    { role: 'tool', tool_call_id: 'ctx-call', content: 'file contents' },
    { role: 'assistant', content: 'Intermediate assistant finding.' },
    { role: 'assistant', content: 'Final assistant summary.' },
  ];
  Object.defineProperty(contextMessages[1], Symbol.for('avi.providerContinuation'), {
    value: { items: [{ type: 'reasoning', encrypted_content: 'forbidden-provider-state' }] },
  });
  contextMessages.at(-1).content = null;
  Object.defineProperty(contextMessages.at(-1), Symbol.for('avi.providerContinuation'), {
    value: { items: [{ type: 'message', id: 'forbidden-provider-state', content: [
      { type: 'output_text', text: 'Final assistant summary.' },
    ] }] },
  });
  const contextToolHistory = Array.from({ length: 10 }, (_, index) => ({
    assistantContent: index === 7 ? '' : `Tool round ${index} started.`,
    reasoningContent: `round reasoning ${index} that must not be resent`,
    continuation: [
      { type: 'message', content: [{ type: 'output_text', text: `Tool round ${index} started.` }] },
      {
        type: 'reasoning',
        id: `rs_${index}`,
        encrypted_content: `encrypted-state-${index}`,
        summary: [],
      },
      {
        type: 'function_call',
        call_id: index === 8 ? 'unpaired-continuation-call' : `round-${index}`,
        name: 'run_probe',
        arguments: '{}',
      },
    ],
    toolCalls: index === 7 ? [] : index === 8
      ? [{
        key: `round:${index}:0`,
        callId: `round-${index}-orphan`,
        name: 'run_probe',
        argumentsText: '{"probe":"never-executed"}',
      }]
      : [{
        key: `round:${index}:0`,
        callId: `round-${index}`,
        name: 'run_probe',
        argumentsText: '{"probe":true}',
      }],
    results: index === 5
      ? [{
        callId: `round-${index}`,
        output: `Probe result ${index}.`,
        isError: false,
        mediaContent: [{
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AAAA' },
        }],
      }]
      : index === 9
        ? [{ callId: 'round-0', output: 'Duplicate probe result.', isError: false }]
        : [{
          callId: `round-${index}`,
          output: `Probe result ${index}.`,
          isError: false,
        }],
  }));
  const streamingSegments = [
    { type: 'reasoning', text: 'streaming reasoning that must not be resent' },
    { type: 'content', text: 'Streaming partial answer.' },
    {
      type: 'tool-call',
      key: 'round:10:0',
      callId: 'pending-call',
      name: 'run_probe',
      argumentsText: '{"probe":"pending"}',
    },
    {
      type: 'tool-call',
      key: 'round:10:1',
      callId: 'stream-call',
      name: 'run_probe',
      argumentsText: '{"probe":"done"}',
      resultText: 'Stream tool result.',
      mediaContent: [{
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,BBBB' },
      }],
    },
    { type: 'error', code: 'context_length_exceeded', message: 'context length' },
    {
      type: 'provider-continuation',
      round: 10,
      model: model.id,
      interface: 'responses',
      items: [{ type: 'reasoning', encrypted_content: 'stream-encrypted-state' }],
    },
  ];

  const compressedConversation = await runner.compress({
    conversationId: conversation.id,
    model: model.id,
    contextMessages,
    contextToolHistory,
    streamingSegments,
  });

  assert.equal(compactionRequests.length, 4);
  assert.equal(compressedConversation.contextCheckpoint, 'Structured checkpoint.');

  const serialized = JSON.stringify(compactionRequests.map((request) => request.messages));
  assert.doesNotMatch(serialized, /in_flight_context/);
  assert.doesNotMatch(serialized, /"toolHistory"/);
  assert.doesNotMatch(serialized, /encrypted_content/);
  assert.doesNotMatch(serialized, /reasoning_content|reasoning_details|forbidden-provider-state/);
  assert.equal(compactionRequests[0].messages.filter((message) => message.content === 'Tool round 7 started.').length, 1);
  assert.doesNotMatch(serialized, /reasoning that must not be resent/);
  for (const request of compactionRequests) {
    assert.deepEqual(request.tools, []);
    assert.deepEqual(request.toolHistory, []);
    assert.equal(request.messages.at(-1).role, 'user');
    assert.match(request.messages.at(-1).content, /CONTEXT CHECKPOINT COMPACTION/);
  }

  const assertPairing = (messages) => {
    const pendingCallIds = new Set();
    for (const message of messages) {
      if (message.role === 'assistant') {
        for (const toolCall of message.tool_calls ?? []) pendingCallIds.add(toolCall.id);
        continue;
      }
      if (message.role === 'tool') {
        assert.ok(
          pendingCallIds.delete(message.tool_call_id),
          `Unexpected tool result ${message.tool_call_id} without a paired call.`,
        );
      }
    }
    assert.deepEqual([...pendingCallIds], []);
  };

  const toolResultCallIds = (messages) => messages
    .filter((message) => message.role === 'tool')
    .map((message) => message.tool_call_id);

  const [fullAttempt, thirdAttempt, sixthAttempt, aggressiveAttempt] = compactionRequests;
  assert.deepEqual(
    toolResultCallIds(fullAttempt.messages).filter((callId) => callId.startsWith('round-')),
    Array.from({ length: 8 }, (_, index) => `round-${index}`),
  );
  assert.deepEqual(
    toolResultCallIds(thirdAttempt.messages).filter((callId) => callId.startsWith('round-')),
    Array.from({ length: 5 }, (_, index) => `round-${index + 3}`),
  );
  assert.deepEqual(
    toolResultCallIds(sixthAttempt.messages).filter((callId) => callId.startsWith('round-')),
    Array.from({ length: 2 }, (_, index) => `round-${index + 6}`),
  );
  assert.deepEqual(
    toolResultCallIds(aggressiveAttempt.messages).filter((callId) => callId.startsWith('round-')),
    Array.from({ length: 2 }, (_, index) => `round-${index + 6}`),
  );

  assertPairing(fullAttempt.messages);
  for (const request of compactionRequests) assertPairing(request.messages);

  const inFlightAssistantContents = (messages) => messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content);
  assert.ok(inFlightAssistantContents(fullAttempt.messages).includes('Tool round 8 started.'));
  assert.ok(inFlightAssistantContents(fullAttempt.messages).includes('Tool round 9 started.'));
  assert.ok(inFlightAssistantContents(fullAttempt.messages).includes('Streaming partial answer.'));
  assert.ok(
    fullAttempt.messages.some((message) => (
      message.role === 'assistant'
      && message.content === 'Checking the persisted messages.'
      && message.reasoning_content === undefined
    )),
  );

  const serializedFull = JSON.stringify(fullAttempt.messages);
  assert.match(serializedFull, /data:image\/png;base64,AAAA/);
  assert.match(serializedFull, /data:image\/png;base64,BBBB/);
  assert.match(serializedFull, /Stream tool result\./);
  assert.doesNotMatch(serializedFull, /never-executed/);
  assert.doesNotMatch(serializedFull, /Duplicate probe result\./);
  assert.doesNotMatch(serializedFull, /stream-encrypted-state/);

  for (let index = 0; index < fullAttempt.messages.length - 1; index += 1) {
    const message = fullAttempt.messages[index];
    if (message.role !== 'tool' || message.tool_call_id !== 'round-5') continue;
    assert.equal(fullAttempt.messages[index + 1].role, 'user');
    assert.deepEqual(
      fullAttempt.messages[index + 1].content,
      [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
    );
    break;
  }

  const serializedAggressive = JSON.stringify(aggressiveAttempt.messages);
  assert.match(serializedAggressive, /Final assistant summary\./);
  assert.doesNotMatch(serializedAggressive, /Checking the persisted messages\./);
  assert.doesNotMatch(serializedAggressive, /file contents/);
  assert.doesNotMatch(serializedAggressive, /Intermediate assistant finding\./);
  assert.doesNotMatch(serializedAggressive, /ctx-call/);

  const fallbackRequests = [];
  const compactModel = { ...model, id: 'test:compact', modelId: 'compact' };
  runner.getPreferences = () => ({
    ...database.getPreferences(),
    defaultModels: { compactation: { modelId: compactModel.id } },
  });
  runner.registry.resolve = (modelId) => ({
    model: modelId === compactModel.id ? compactModel : model,
    provider: {
      ...provider,
      stream: async ({ model: selected, messages }) => {
        fallbackRequests.push({ model: selected.id, messages });
        if (fallbackRequests.length < 8) {
          const error = new Error('context_length_exceeded');
          error.code = 'context_length_exceeded';
          error.status = 400;
          throw error;
        }
        return { assistantContent: 'Fallback checkpoint.', toolCalls: [] };
      },
    },
  });
  await runner.compress({
    conversationId: conversation.id,
    model: model.id,
    contextMessages,
    contextToolHistory,
    streamingSegments,
  });
  assert.deepEqual(fallbackRequests.map((request) => request.model), [
    ...Array(4).fill(compactModel.id), ...Array(4).fill(model.id),
  ]);
  for (let index = 0; index < 4; index += 1) {
    assert.deepEqual(fallbackRequests[index].messages, fallbackRequests[index + 4].messages);
    assertPairing(fallbackRequests[index].messages);
  }
  const { responsesApi } = await import('../src/providers/openai-compatible.js');
  for (const request of fallbackRequests) {
    const body = await responsesApi.createBody({
      provider: {}, model, messages: request.messages, tools: [], toolHistory: [],
    });
    assert.doesNotMatch(JSON.stringify(body), /encrypted_content|reasoning_details|forbidden-provider-state|in_flight_context/);
    assert.equal(body.input.at(-1).role, 'user');
    assert.deepEqual(
      body.input.filter((item) => item.type === 'function_call').map((item) => item.call_id),
      body.input.filter((item) => item.type === 'function_call_output').map((item) => item.call_id),
    );
  }

  database.closeDatabase();
  database = null;
  console.log('Context compaction message tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
