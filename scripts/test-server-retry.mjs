import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-server-retry-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

const nativeSetTimeout = globalThis.setTimeout;
const acceleratedDelays = new Set([1_000, 2_000, 4_000, 8_000, 10_000, 60_000, 300_000]);
globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
  callback,
  delay === 30_000 ? 5 : acceleratedDelays.has(delay) ? 1 : delay,
  ...args,
);

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { ModelProvider } = await import('../src/main/model-provider.js');
  const { StreamAccumulator } = await import('../src/main/streaming.js');
  const model = {
    id: 'test:model',
    name: 'Test',
    modelId: 'test',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };

  const createProvider = (request, eventsFrom = () => []) => new ModelProvider(
    { id: 'test', enabled: true, models: [] },
    {
      createBody: async () => ({}),
      request,
      eventsFrom,
    },
    {},
  );
  const stream = (
    provider,
    workMode = null,
    signal = new AbortController().signal,
    onEvent = () => {},
  ) => provider.stream({
    model,
    messages: [],
    tools: [],
    toolHistory: [],
    invocationContext: { workMode },
    signal,
    onEvent,
  });

  let normalAttempts = 0;
  await assert.rejects(
    stream(createProvider(async () => {
      normalAttempts += 1;
      return new Response('unavailable', { status: 503 });
    })),
    /unavailable/,
  );
  assert.equal(normalAttempts, 6);

  let goalAttempts = 0;
  const goalEvents = [];
  await stream(
    createProvider(async () => {
      goalAttempts += 1;
      return goalAttempts <= 6
        ? new Response('unavailable', { status: 503 })
        : new Response('data: [DONE]\n\n', { status: 200 });
    }),
    'goal',
    new AbortController().signal,
    (event) => goalEvents.push(event),
  );
  assert.equal(goalAttempts, 7);
  assert.deepEqual(
    goalEvents.filter((event) => event.type === 'retry')
      .map((event) => [event.attempt, event.maxAttempts]),
    [[1, null], [2, null], [3, null], [4, null], [5, null], [6, null]],
  );
  assert.equal(goalEvents.at(-1).type, 'retry-clear');

  let timeoutAttempts = 0;
  await assert.rejects(
    stream(createProvider(({ signal }) => {
      timeoutAttempts += 1;
      return new Promise((resolveRequest, rejectRequest) => {
        signal.addEventListener('abort', () => rejectRequest(signal.reason), { once: true });
      });
    })),
    /did not respond within 30 seconds/,
  );
  assert.equal(timeoutAttempts, 6);

  const controller = new AbortController();
  let cancellationAttempts = 0;
  const cancellation = stream(createProvider(async () => {
    cancellationAttempts += 1;
    return new Response('unavailable', { status: 503 });
  }), null, controller.signal);
  nativeSetTimeout(() => controller.abort(new Error('Stopped by user.')), 0);
  await assert.rejects(cancellation, /Stopped by user/);
  assert.equal(cancellationAttempts, 1);

  await assert.rejects(
    stream(createProvider(async () => new Response(
      'The context length was exceeded.',
      { status: 400 },
    ))),
    (error) => error.status === 400 && /context length/i.test(error.message),
  );

  await assert.rejects(
    stream(createProvider(
      async () => new Response(
        `data: ${JSON.stringify({
          error: {
            code: 'context_length_exceeded',
            message: 'Your input exceeds the context window of this model.',
          },
        })}\n\n`,
        { status: 200 },
      ),
      (payload) => [{
        type: 'error',
        code: payload.error.code,
        message: payload.error.message,
      }],
    )),
    (error) => error.status === 400
      && error.code === 'context_length_exceeded'
      && /context window/i.test(error.message),
  );

  const overloadedEvents = [];
  let overloadedAttempts = 0;
  await assert.rejects(
    stream(
      createProvider(
        async () => {
          overloadedAttempts += 1;
          return new Response(
            `data: ${JSON.stringify({
              error: {
                code: 'server_is_overloaded',
                message: 'The server is overloaded.',
              },
            })}\n\n`,
            { status: 200 },
          );
        },
        (payload) => [{
          type: 'error',
          code: payload.error.code,
          message: payload.error.message,
        }],
      ),
      null,
      new AbortController().signal,
      (event) => overloadedEvents.push(event),
    ),
    /The server is overloaded/,
  );
  assert.equal(overloadedAttempts, 6);
  assert.deepEqual(
    overloadedEvents.filter((event) => event.type === 'retry')
      .map((event) => [event.attempt, event.maxAttempts]),
    [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]],
  );
  assert.equal(overloadedEvents.filter((event) => event.type === 'error').length, 1);
  const overloadedAccumulator = new StreamAccumulator();
  overloadedEvents.forEach((event) => overloadedAccumulator.apply(event));
  assert.equal(overloadedAccumulator.segments.length, 1);
  assert.equal(overloadedAccumulator.segments[0].type, 'error');
  assert.match(overloadedAccumulator.content, /Retry attempt 5\/5/);

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => nativeSetTimeout(resolveWait, 10));
    }
  }

  let goalRunAttempts = 0;
  let activeStreamCancelled = false;
  const goalProvider = createProvider(
    async () => {
      goalRunAttempts += 1;
      if (goalRunAttempts === 1) {
        return new Response(
          `data: ${JSON.stringify({
            error: {
              code: 'server_is_overloaded',
              message: 'The server is overloaded.',
            },
          })}\n\n`,
          { status: 200 },
        );
      }
      return new Response(new ReadableStream({
        cancel: () => {
          activeStreamCancelled = true;
        },
      }), { status: 200 });
    },
    (payload) => payload.error
      ? [{
          type: 'error',
          code: payload.error.code,
          message: payload.error.message,
        }]
      : [],
  );
  const goalRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: goalProvider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: () => {},
  });
  const goalConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await goalRunner.startGoal({
    conversationId: goalConversation.id,
    model: model.id,
    specification: 'Exercise server retry cancellation.',
    permissionMode: 'full_access',
    project: { path: process.cwd() },
    sendInitialPrompt: true,
  });
  await waitFor(() => goalRunAttempts === 2);
  const goalAssistantMessages = database.getMessages(goalConversation.id)
    .filter((message) => message.role === 'assistant');
  assert.equal(goalAssistantMessages.length, 1);
  assert.equal(
    goalAssistantMessages[0].segments.filter((segment) => segment.type === 'retry').length,
    1,
  );
  assert.equal(goalAssistantMessages[0].segments[0].attempt, 1);
  assert.match(goalAssistantMessages[0].content, /Retry attempt 1/);
  goalRunner.stop(goalConversation.id);
  await waitFor(() => !goalRunner.runs.has(goalConversation.id));
  assert.equal(activeStreamCancelled, true);
  await new Promise((resolveWait) => nativeSetTimeout(resolveWait, 20));
  assert.equal(goalRunAttempts, 2);

  let contextAttempts = 0;
  let compressionAttempts = 0;
  const contextProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ messages, onEvent }) => {
      if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
        compressionAttempts += 1;
        onEvent({
          type: 'usage',
          usage: { inputTokens: 90_000, outputTokens: 500 },
        });
        return {
          assistantContent: 'Compressed conversation checkpoint.',
          continuation: [],
          toolCalls: [],
        };
      }

      contextAttempts += 1;
      if (contextAttempts === 1) {
        const error = new Error('Your input exceeds the context window of this model.');
        error.code = 'context_length_exceeded';
        error.status = 400;
        onEvent({ type: 'error', code: error.code, message: error.message });
        throw error;
      }
      onEvent({ type: 'content', text: 'Recovered after compaction.' });
      return {
        assistantContent: 'Recovered after compaction.',
        continuation: [],
        toolCalls: [],
      };
    },
  };
  const contextRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: contextProvider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: () => {},
  });
  const contextConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await contextRunner.send({
    conversationId: contextConversation.id,
    model: model.id,
    text: 'Recover this request.',
  });
  await waitFor(() => !contextRunner.runs.has(contextConversation.id));
  assert.equal(contextAttempts, 2);
  assert.equal(compressionAttempts, 1);
  assert.equal(
    database.getConversation(contextConversation.id).contextCheckpoint,
    'Compressed conversation checkpoint.',
  );
  assert.equal(
    database.getMessages(contextConversation.id)
      .findLast((message) => message.role === 'assistant')
      ?.status,
    'completed',
  );
  assert.equal(
    database.getMessages(contextConversation.id)
      .findLast((message) => message.role === 'assistant')
      ?.content,
    'Recovered after compaction.',
  );

  let repeatedContextAttempts = 0;
  let repeatedCompressionAttempts = 0;
  const repeatedContextRunner = new ChatRunner({
    registry: {
      resolve: () => ({
        model,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: async ({ messages, onEvent }) => {
            if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
              repeatedCompressionAttempts += 1;
              return {
                assistantContent: 'Recent compressed checkpoint.',
                continuation: [],
                toolCalls: [],
              };
            }
            repeatedContextAttempts += 1;
            const error = new Error('Maximum context length exceeded.');
            error.status = 413;
            onEvent({ type: 'error', code: 'request_too_large', message: error.message });
            throw error;
          },
        },
      }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: () => {},
  });
  const repeatedContextConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await repeatedContextRunner.send({
    conversationId: repeatedContextConversation.id,
    model: model.id,
    text: 'Stop after one compacted retry.',
  });
  await waitFor(() => !repeatedContextRunner.runs.has(repeatedContextConversation.id));
  assert.equal(repeatedContextAttempts, 2);
  assert.equal(repeatedCompressionAttempts, 1);
  assert.equal(
    database.getMessages(repeatedContextConversation.id)
      .findLast((message) => message.role === 'assistant')
      ?.status,
    'error',
  );

  database.closeDatabase();
  database = null;
  console.log('Server retry tests passed.');
} finally {
  globalThis.setTimeout = nativeSetTimeout;
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
