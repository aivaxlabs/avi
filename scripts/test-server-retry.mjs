import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
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
  const {
    chatCompletionsApi,
    responsesApi,
  } = await import('../src/providers/openai-compatible.js');
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

  const transitionEvents = [];
  await stream(
    createProvider(
      async () => new Response([
        `data: ${JSON.stringify({ type: 'reasoning', text: 'Reasoning' })}`,
        `data: ${JSON.stringify({ type: 'content', text: 'Answer' })}`,
        'data: [DONE]',
        '',
      ].join('\n\n'), { status: 200 }),
      (payload) => [{ type: payload.type, text: payload.text }],
    ),
    null,
    new AbortController().signal,
    (event) => transitionEvents.push(event),
  );
  assert.deepEqual(
    transitionEvents.map((event) => [event.type, event.itemType ?? null]),
    [
      ['reasoning', null],
      ['item-complete', 'reasoning'],
      ['content', null],
    ],
  );

  const contextInvocation = {
    workspacePath: testProfile,
    currentThread: {
      threadId: 'current-thread',
      role: 'orchestrator',
    },
    threads: [{
      threadId: 'subagent-thread',
      role: 'subagent',
      parentThreadId: 'current-thread',
      initialPrompt: 'Inspect the provider payload.',
      status: 'completed',
    }],
  };
  const contextBodyInput = {
    provider: {},
    model,
    messages: [{ role: 'user', content: 'Actual prompt' }],
    reasoningEffort: null,
    tools: [],
    toolHistory: [],
    invocationContext: contextInvocation,
  };
  const responsesContextBody = await responsesApi.createBody(contextBodyInput);
  assert.ok(responsesContextBody.instructions.includes('<current_thread'));
  assert.ok(!responsesContextBody.instructions.includes('<thread_directory>'));
  assert.deepEqual(
    responsesContextBody.input.slice(0, 2).map(({ role }) => role),
    ['user', 'user'],
  );
  assert.ok(responsesContextBody.input[0].content.startsWith('<thread_directory>'));
  assert.equal(responsesContextBody.input[1].content, 'Actual prompt');

  const chatContextBody = await chatCompletionsApi.createBody(contextBodyInput);
  assert.deepEqual(
    chatContextBody.messages.slice(0, 3).map(({ role }) => role),
    ['system', 'user', 'user'],
  );
  assert.ok(!chatContextBody.messages[0].content.includes('<thread_directory>'));
  assert.ok(chatContextBody.messages[1].content.startsWith('<thread_directory>'));
  assert.equal(chatContextBody.messages[2].content, 'Actual prompt');

  const completedToolItem = {
    type: 'function_call',
    id: 'item-tool-1',
    call_id: 'call-tool-1',
    name: 'completed_tool',
    arguments: '{"complete":true}',
  };
  const toolHistoryInput = [{
    assistantContent: 'Calling a tool.',
    continuation: [{
      ...completedToolItem,
      arguments: JSON.stringify({
        __invocation_goal: 'Keep this local.',
        __requires_human_approval: false,
        complete: true,
      }),
    }],
    toolCalls: [{
      callId: 'steer-order-call',
      name: 'order_tool',
      argumentsText: JSON.stringify({
        __invocation_goal: 'Keep this local too.',
        __requires_human_approval: false,
        order: 1,
      }),
    }],
    results: [{ callId: 'steer-order-call', output: '{"done":true}' }],
    messages: [{ role: 'user', content: 'Steer after the tool result.' }],
  }];
  const steeredToolHistoryBody = await responsesApi.createBody({
    provider: {},
    model,
    messages: [{ role: 'user', content: 'Original prompt' }],
    reasoningEffort: null,
    tools: [],
    toolHistory: toolHistoryInput,
    invocationContext: {},
  });
  assert.deepEqual(
    steeredToolHistoryBody.input.slice(-2).map((item) => (
      item.type === 'function_call_output' ? item.type : [item.role, item.content]
    )),
    ['function_call_output', ['user', 'Steer after the tool result.']],
  );
  const responsesFunctionCall = steeredToolHistoryBody.input.find(
    (item) => item.type === 'function_call',
  );
  assert.equal(
    responsesFunctionCall.arguments,
    toolHistoryInput[0].continuation[0].arguments,
  );

  const chatToolHistoryBody = await chatCompletionsApi.createBody({
    ...contextBodyInput,
    messages: [],
    toolHistory: toolHistoryInput,
    invocationContext: {},
  });
  const chatFunctionCall = chatToolHistoryBody.messages.find(
    (message) => message.role === 'assistant' && message.tool_calls?.length,
  ).tool_calls[0];
  assert.equal(
    chatFunctionCall.function.arguments,
    toolHistoryInput[0].toolCalls[0].argumentsText,
  );

  assert.deepEqual(
    responsesApi.eventsFrom({
      type: 'response.output_item.done',
      output_index: 2,
      item: completedToolItem,
    }),
    [
      {
        type: 'tool-call',
        key: 'item-tool-1',
        callId: 'call-tool-1',
        name: 'completed_tool',
        argumentsText: '{"complete":true}',
        replaceArguments: true,
      },
      {
        type: 'continuation-item',
        index: 2,
        item: completedToolItem,
      },
      { type: 'item-complete', itemType: 'tool-call' },
    ],
  );

  for (const index of [undefined, -1, 1.5]) {
    const [invalidIndexEvent] = chatCompletionsApi.eventsFrom({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            ...(index === undefined ? {} : { index }),
            id: 'invalid-index-call',
            function: { name: 'invalid_index', arguments: '{}' },
          }],
        },
      }],
    });
    assert.equal(invalidIndexEvent.type, 'error');
    assert.equal(invalidIndexEvent.code, 'provider_error');
    assert.match(invalidIndexEvent.message, /valid non-negative integer index/);
  }

  const qwenPayloads = [
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'qwen-call-0',
            function: { name: 'weather_lookup', arguments: '' },
          }],
        },
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 1,
            function: { name: 'unit_lookup', arguments: '' },
          }],
        },
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'qwen-call-0',
            function: { name: 'weather_lookup', arguments: '{"city":' },
          }],
        },
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 1,
            id: '',
            function: { name: '', arguments: '{"unit":' },
          }],
        },
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: '',
            function: { name: '', arguments: '"Paris"}' },
          }],
        },
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 1,
            function: { arguments: '"C"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    },
  ];
  const qwenEvents = [];
  const qwenAccumulator = new StreamAccumulator();
  const qwenResult = await stream(
    createProvider(
      async () => new Response([
        ...qwenPayloads.map((payload) => `data: ${JSON.stringify(payload)}`),
        'data: [DONE]',
        '',
      ].join('\n\n'), { status: 200 }),
      (payload) => chatCompletionsApi.eventsFrom(payload),
    ),
    null,
    new AbortController().signal,
    (event) => {
      qwenEvents.push(event);
      qwenAccumulator.apply(event);
    },
  );
  assert.equal(qwenResult.toolCalls.length, 2);
  assert.deepEqual(
    qwenResult.toolCalls.map(({ key, name, argumentsText }) => ({ key, name, argumentsText })),
    [{
      key: 'chat:0:0',
      name: 'weather_lookup',
      argumentsText: '{"city":"Paris"}',
    }, {
      key: 'chat:0:1',
      name: 'unit_lookup',
      argumentsText: '{"unit":"C"}',
    }],
  );
  assert.equal(qwenResult.toolCalls[0].callId, 'qwen-call-0');
  assert.match(qwenResult.toolCalls[1].callId, /^call_[0-9a-f-]+$/);
  assert.deepEqual(
    [...new Set(qwenEvents
      .filter((event) => event.type === 'tool-call' && event.key === 'chat:0:1')
      .map((event) => event.callId))],
    [qwenResult.toolCalls[1].callId],
  );
  assert.deepEqual(
    qwenAccumulator.segments
      .filter((segment) => segment.type === 'tool-call')
      .map(({ key, callId, name, argumentsText }) => ({ key, callId, name, argumentsText })),
    qwenResult.toolCalls.map(({ key, callId, name, argumentsText }) => ({
      key,
      callId,
      name,
      argumentsText,
    })),
  );

  const continuationAccumulator = new StreamAccumulator();
  continuationAccumulator.apply({
    type: 'tool-call',
    key: 'chat:0:0',
    callId: 'preserved-call',
    name: 'preserved_name',
    argumentsDelta: '{',
  });
  continuationAccumulator.apply({
    type: 'tool-call',
    key: 'chat:0:0',
    callId: '',
    name: ' ',
    argumentsDelta: '}',
  });
  assert.deepEqual(
    {
      callId: continuationAccumulator.segments[0].callId,
      name: continuationAccumulator.segments[0].name,
      argumentsText: continuationAccumulator.segments[0].argumentsText,
    },
    {
      callId: 'preserved-call',
      name: 'preserved_name',
      argumentsText: '{}',
    },
  );

  for (const conflictingToolCall of [{
    index: 0,
    id: 'changed-call-id',
    function: { name: 'stable_name', arguments: '{}' },
  }, {
    index: 0,
    id: 'stable-call-id',
    function: { name: 'changed_name', arguments: '{}' },
  }]) {
    await assert.rejects(
      stream(createProvider(
        async () => new Response([
          `data: ${JSON.stringify({
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'stable-call-id',
                  function: { name: 'stable_name', arguments: '' },
                }],
              },
            }],
          })}`,
          `data: ${JSON.stringify({
            choices: [{
              index: 0,
              delta: { tool_calls: [conflictingToolCall] },
            }],
          })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'), { status: 200 }),
        (payload) => chatCompletionsApi.eventsFrom(payload),
      )),
      (error) => error.code === 'provider_error' && /changed the tool call (ID|name)/.test(error.message),
    );
  }

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

  let providerErrorAttempts = 0;
  const providerErrorEvents = [];
  await stream(
    createProvider(
      async () => {
        providerErrorAttempts += 1;
        return new Response(providerErrorAttempts === 1
          ? `data: ${JSON.stringify({
              type: 'error',
              code: 'provider_error',
              message: 'The upstream provider failed.',
            })}\n\n`
          : 'data: [DONE]\n\n', { status: 200 });
      },
      (payload) => [payload],
    ),
    null,
    new AbortController().signal,
    (event) => providerErrorEvents.push(event),
  );
  assert.equal(providerErrorAttempts, 2);
  assert.equal(providerErrorEvents.filter((event) => event.type === 'retry').length, 1);
  assert.equal(providerErrorEvents.filter((event) => event.type === 'error').length, 0);

  let requestTransportAttempts = 0;
  const requestTransportEvents = [];
  await stream(
    createProvider(async () => {
      requestTransportAttempts += 1;
      if (requestTransportAttempts === 1) throw new TypeError('fetch failed');
      return new Response('data: [DONE]\n\n', { status: 200 });
    }),
    null,
    new AbortController().signal,
    (event) => requestTransportEvents.push(event),
  );
  assert.equal(requestTransportAttempts, 2);
  assert.equal(requestTransportEvents.filter((event) => event.type === 'retry').length, 1);
  assert.equal(requestTransportEvents.filter((event) => event.type === 'error').length, 0);

  let streamTransportAttempts = 0;
  const streamTransportEvents = [];
  await stream(
    createProvider(async () => {
      streamTransportAttempts += 1;
      if (streamTransportAttempts > 1) {
        return new Response('data: [DONE]\n\n', { status: 200 });
      }
      return new Response(new ReadableStream({
        start(controller) {
          controller.error(new TypeError('terminated'));
        },
      }), { status: 200 });
    }),
    null,
    new AbortController().signal,
    (event) => streamTransportEvents.push(event),
  );
  assert.equal(streamTransportAttempts, 2);
  assert.equal(streamTransportEvents.filter((event) => event.type === 'retry').length, 1);
  assert.equal(streamTransportEvents.filter((event) => event.type === 'error').length, 0);

  let serverErrorAttempts = 0;
  const serverErrorEvents = [];
  const serverErrorResult = await stream(
    createProvider(
      async () => {
        serverErrorAttempts += 1;
        return new Response(serverErrorAttempts === 1
          ? [
              `data: ${JSON.stringify({ type: 'reasoning', text: 'Partial reasoning' })}`,
              `data: ${JSON.stringify({ type: 'content', text: 'Partial answer' })}`,
              `data: ${JSON.stringify({
                type: 'tool-call',
                key: 'partial-tool',
                callId: 'partial-tool',
                name: 'partial_tool',
                replaceArguments: true,
                argumentsText: '{\"partial\":true}',
              })}`,
              `data: ${JSON.stringify({
                type: 'error',
                code: 'server_error',
                message: 'The server failed after partial output.',
              })}`,
              '',
            ].join('\n\n')
          : 'data: [DONE]\n\n', { status: 200 });
      },
      (payload) => [payload],
    ),
    null,
    new AbortController().signal,
    (event) => serverErrorEvents.push(event),
  );
  assert.equal(serverErrorAttempts, 2);
  assert.equal(serverErrorEvents.filter((event) => event.type === 'retry').length, 1);
  assert.equal(serverErrorEvents.filter((event) => event.type === 'error').length, 0);
  assert.equal(serverErrorResult.assistantContent, 'Partial answer');
  assert.deepEqual(serverErrorResult.toolCalls, [{
    key: 'partial-tool',
    callId: 'partial-tool',
    name: 'partial_tool',
    argumentsText: '{\"partial\":true}',
  }]);

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => nativeSetTimeout(resolveWait, 10));
    }
  }

  const adaptiveToolOutputLimit = 100;
  const inspectedConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  database.insertMessage({
    conversationId: inspectedConversation.id,
    role: 'user',
    content: 'Inspect this result. '.repeat(adaptiveToolOutputLimit),
  });
  const adaptiveRequests = [];
  let adaptiveCompressionRequest;
  const adaptiveProvider = {
    getContributions: () => ({
      tools: [{
        name: 'adaptive_context',
        description: 'Return a fixed-size result for adaptive context testing.',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
          additionalProperties: false,
        },
        execute: async ({ value }) => value.repeat(adaptiveToolOutputLimit),
      }],
    }),
    stream: async ({ messages, toolHistory, onEvent }) => {
      if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
        adaptiveCompressionRequest = messages;
        onEvent({
          type: 'usage',
          usage: { inputTokens: 500, outputTokens: 50 },
        });
        return {
          assistantContent: 'Adaptive checkpoint.',
          continuation: [],
          toolCalls: [],
        };
      }

      adaptiveRequests.push(structuredClone(toolHistory));
      const round = toolHistory.length;
      if (round === 5) {
        onEvent({ type: 'content', text: 'Adaptive truncation completed.' });
        onEvent({
          type: 'usage',
          usage: { inputTokens: 100, outputTokens: 10 },
        });
        return {
          assistantContent: 'Adaptive truncation completed.',
          continuation: [],
          toolCalls: [],
        };
      }

      const toolCall = {
        key: `adaptive-${round}`,
        callId: `adaptive-${round}`,
        name: round === 0 ? 'chat_inspect_thread' : 'adaptive_context',
        argumentsText: JSON.stringify(round === 0
          ? {
              threadId: inspectedConversation.id,
              __invocation_goal: 'Verify inspected task result truncation',
              __requires_human_approval: false,
            }
          : {
              value: String(round),
              __invocation_goal: 'Verify adaptive tool result truncation',
              __requires_human_approval: false,
            }),
      };
      onEvent({ type: 'content', text: `Adaptive round ${round}.` });
      onEvent({ type: 'tool-call', ...toolCall });
      return {
        assistantContent: `Adaptive round ${round}.`,
        continuation: [],
        toolCalls: [toolCall],
      };
    },
  };
  const adaptiveRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: adaptiveProvider }),
      listModels: () => [model],
    },
    mcpManager: null,
    getPreferences: () => ({
      ...database.getPreferences(),
      tuning: {
        ...database.getPreferences().tuning,
        toolOutputLimit: adaptiveToolOutputLimit,
      },
    }),
    sendEvent: () => {},
  });
  const adaptiveConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await adaptiveRunner.send({
    conversationId: adaptiveConversation.id,
    model: model.id,
    text: 'Exercise adaptive tool result truncation.',
    permissionMode: 'full_access',
  });
  await waitFor(() => !adaptiveRunner.runs.has(adaptiveConversation.id));
  const parseToolOutput = (output) => {
    const match = /^([\s\S]*)\n\n\[\.\.\. (\d+) chars truncated, (\d+) lines total, full result available at (.+)\]$/.exec(output);
    return match
      ? {
          preview: match[1],
          truncatedChars: Number(match[2]),
          totalLines: Number(match[3]),
          resultPath: match[4],
        }
      : {
          preview: output,
          truncatedChars: 0,
          totalLines: output.replaceAll('\r\n', '\n').split('\n').length,
          resultPath: null,
        };
  };
  assert.equal(adaptiveRequests.length, 6);
  const inspectedResult = parseToolOutput(adaptiveRequests[3][0].results[0].output);
  assert.equal(inspectedResult.preview.length, 20);
  assert.ok(inspectedResult.resultPath);
  const inspectedContent = readFileSync(inspectedResult.resultPath, 'utf8');
  assert.equal(
    inspectedContent.length,
    inspectedResult.preview.length + inspectedResult.truncatedChars,
  );
  assert.equal(
    inspectedResult.totalLines,
    inspectedContent.replaceAll('\r\n', '\n').split('\n').length,
  );
  assert.deepEqual(
    adaptiveRequests[3].slice(1).map((round) => (
      parseToolOutput(round.results[0].output).preview.length
    )),
    [100, 100],
  );
  const firstOlderResult = parseToolOutput(adaptiveRequests[4][0].results[0].output);
  assert.equal(firstOlderResult.preview.length, 20);
  assert.deepEqual(
    adaptiveRequests[4].slice(1).map((round) => (
      parseToolOutput(round.results[0].output).preview.length
    )),
    [100, 100, 100],
  );
  const secondOlderResult = parseToolOutput(adaptiveRequests[5][1].results[0].output);
  assert.equal(secondOlderResult.preview.length, 80);
  assert.ok(secondOlderResult.resultPath);
  assert.equal(readFileSync(secondOlderResult.resultPath, 'utf8'), '1'.repeat(100));
  assert.deepEqual(
    adaptiveRequests[5].slice(2).map((round) => (
      parseToolOutput(round.results[0].output).preview.length
    )),
    [100, 100, 100],
  );
  await adaptiveRunner.compress({
    conversationId: adaptiveConversation.id,
    model: model.id,
    contextMessages: [{ role: 'user', content: 'Compact adaptive tool history.' }],
    contextToolHistory: Array.from({ length: 5 }, (_, round) => ({
      assistantContent: `Compaction round ${round}.`,
      continuation: [],
      toolCalls: [{
        callId: `compaction-${round}`,
        name: round === 0 ? 'chat_inspect_thread' : 'adaptive_context',
      }],
      results: [{
        callId: `compaction-${round}`,
        output: String(round).repeat(adaptiveToolOutputLimit),
        isError: false,
      }],
    })),
    streamingSegments: [{ type: 'content', text: 'Current streaming turn.' }],
  });
  const adaptiveInFlightMessage = adaptiveCompressionRequest.at(-2).content;
  const adaptiveInFlightContext = JSON.parse(
    adaptiveInFlightMessage
      .replace('<in_flight_context>\n', '')
      .replace('\n</in_flight_context>', ''),
  );
  assert.equal(
    parseToolOutput(adaptiveInFlightContext.toolHistory[0].results[0].output).preview.length,
    20,
  );
  assert.equal(
    parseToolOutput(adaptiveInFlightContext.toolHistory[1].results[0].output).preview.length,
    80,
  );
  assert.deepEqual(
    adaptiveInFlightContext.toolHistory
      .slice(2)
      .map((round) => parseToolOutput(round.results[0].output).preview.length),
    [100, 100, 100],
  );

  const immutableFileRequests = [];
  const immutableSource = Array.from({ length: 4 }, () => 's'.repeat(50)).join('\n');
  const immutableFileProvider = {
    getContributions: () => ({
      tools: [{
        name: 'immutable_source',
        description: 'Return content that exceeds the tool output limit.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => immutableSource,
      }, {
        name: 'immutable_partial_read',
        description: 'Read part of a previously truncated tool result.',
        inputSchema: {
          type: 'object',
          properties: { filePath: { type: 'string' } },
          required: ['filePath'],
          additionalProperties: false,
        },
        execute: async ({ filePath }) => readFileSync(filePath, 'utf8').slice(0, 150),
      }],
    }),
    stream: async ({ toolHistory, onEvent }) => {
      immutableFileRequests.push(structuredClone(toolHistory));
      const round = toolHistory.length;
      if (round === 2) {
        onEvent({ type: 'content', text: 'Immutable file test completed.' });
        return {
          assistantContent: 'Immutable file test completed.',
          continuation: [],
          toolCalls: [],
        };
      }

      const toolCall = round === 0
        ? {
            key: 'immutable-source',
            callId: 'immutable-source',
            name: 'immutable_source',
            argumentsText: JSON.stringify({
              __invocation_goal: 'Create a truncated result file',
              __requires_human_approval: false,
            }),
          }
        : {
            key: 'immutable-partial-read',
            callId: 'immutable-partial-read',
            name: 'immutable_partial_read',
            argumentsText: JSON.stringify({
              filePath: parseToolOutput(toolHistory[0].results[0].output).resultPath,
              __invocation_goal: 'Read part of the truncated result file',
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
  const immutableFileRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: immutableFileProvider }),
      listModels: () => [model],
    },
    mcpManager: null,
    getPreferences: () => ({
      ...database.getPreferences(),
      tuning: {
        ...database.getPreferences().tuning,
        toolOutputLimit: adaptiveToolOutputLimit,
      },
    }),
    sendEvent: () => {},
  });
  const immutableFileConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await immutableFileRunner.send({
    conversationId: immutableFileConversation.id,
    model: model.id,
    text: 'Verify truncated result files remain immutable.',
    permissionMode: 'full_access',
  });
  await waitFor(() => !immutableFileRunner.runs.has(immutableFileConversation.id));
  const originalFileResult = parseToolOutput(
    immutableFileRequests[2][0].results[0].output,
  );
  const partialReadResult = parseToolOutput(
    immutableFileRequests[2][1].results[0].output,
  );
  assert.equal(originalFileResult.preview.length, adaptiveToolOutputLimit);
  assert.equal(originalFileResult.totalLines, 4);
  assert.equal(partialReadResult.preview.length, adaptiveToolOutputLimit);
  assert.equal(partialReadResult.totalLines, 3);
  assert.notEqual(partialReadResult.resultPath, originalFileResult.resultPath);
  assert.equal(readFileSync(originalFileResult.resultPath, 'utf8'), immutableSource);
  assert.equal(
    readFileSync(partialReadResult.resultPath, 'utf8'),
    immutableSource.slice(0, 150),
  );

  let perInferenceAttempts = 0;
  let perInferenceCompressionAttempts = 0;
  let perInferenceCompressionRequest;
  let postCheckpointRequest;
  const perInferenceConversationUpdates = [];
  const perInferenceProvider = {
    getContributions: () => ({
      tools: [{
        name: 'per_inference_context',
        description: 'Return context for per-inference compaction.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async () => 'Intermediate tool result before checkpoint.',
      }],
    }),
    stream: async ({ messages, toolHistory, onEvent }) => {
      if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
        perInferenceCompressionAttempts += 1;
        perInferenceCompressionRequest = messages;
        onEvent({
          type: 'usage',
          usage: { inputTokens: 96_000, outputTokens: 250 },
        });
        return {
          assistantContent: 'Per-inference checkpoint.',
          continuation: [],
          toolCalls: [],
        };
      }

      perInferenceAttempts += 1;
      if (perInferenceAttempts === 1) {
        const toolCall = {
          key: 'per-inference',
          callId: 'per-inference',
          name: 'per_inference_context',
          argumentsText: JSON.stringify({
            __invocation_goal: 'Verify compaction after an intermediate inference',
            __requires_human_approval: false,
          }),
        };
        onEvent({ type: 'content', text: 'Intermediate inference.' });
        onEvent({ type: 'tool-call', ...toolCall });
        onEvent({
          type: 'usage',
          usage: { inputTokens: 95_000, outputTokens: 100 },
        });
        return {
          assistantContent: 'Intermediate inference.',
          continuation: [],
          toolCalls: [toolCall],
        };
      }

      postCheckpointRequest = {
        messages: structuredClone(messages),
        toolHistory: structuredClone(toolHistory),
      };
      onEvent({ type: 'content', text: 'Completed after intermediate compaction.' });
      onEvent({
        type: 'usage',
        usage: { inputTokens: 300, outputTokens: 10 },
      });
      return {
        assistantContent: 'Completed after intermediate compaction.',
        continuation: [],
        toolCalls: [],
      };
    },
  };
  const perInferenceRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: perInferenceProvider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: (event) => {
      if (event.type === 'conversation') {
        perInferenceConversationUpdates.push(event.conversation.contextTokens);
      }
    },
  });
  const perInferenceConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await perInferenceRunner.send({
    conversationId: perInferenceConversation.id,
    model: model.id,
    text: 'Compact as soon as an intermediate inference crosses the threshold.',
    permissionMode: 'full_access',
  });
  await waitFor(() => !perInferenceRunner.runs.has(perInferenceConversation.id));
  assert.equal(perInferenceAttempts, 2);
  assert.equal(perInferenceCompressionAttempts, 1);
  assert.match(
    JSON.stringify(perInferenceCompressionRequest),
    /Intermediate tool result before checkpoint/,
  );
  assert.deepEqual(postCheckpointRequest.toolHistory, []);
  assert.deepEqual(postCheckpointRequest.messages, [{
    role: 'system',
    content: '<conversation_checkpoint>\n'
      + 'Per-inference checkpoint.\n'
      + '</conversation_checkpoint>',
  }]);
  assert.deepEqual(perInferenceConversationUpdates.slice(-3), [95_100, 250, 310]);
  assert.equal(database.getConversation(perInferenceConversation.id).contextTokens, 310);

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
  let compressionRequest;
  const contextProvider = {
    getContributions: () => ({
      tools: [{
        name: 'collect_context',
        description: 'Return context that must survive compaction.',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
          additionalProperties: false,
        },
        execute: async () => 'Tool result that must survive compaction.',
      }],
    }),
    stream: async ({ messages, toolHistory, onEvent }) => {
      if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
        compressionAttempts += 1;
        compressionRequest = { messages, toolHistory };
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
        onEvent({ type: 'content', text: 'Working context before the tool call.' });
        onEvent({
          type: 'tool-call',
          key: 'collect-context',
          callId: 'collect-context-call',
          name: 'collect_context',
          argumentsText: JSON.stringify({
            value: 'important',
            __invocation_goal: 'Preserve the tool result through compaction',
            __requires_human_approval: false,
          }),
        });
        return {
          assistantContent: 'Working context before the tool call.',
          continuation: [],
          toolCalls: [{
            key: 'collect-context',
            callId: 'collect-context-call',
            name: 'collect_context',
            argumentsText: JSON.stringify({
              value: 'important',
              __invocation_goal: 'Preserve the tool result through compaction',
              __requires_human_approval: false,
            }),
          }],
        };
      }
      if (contextAttempts === 2) {
        const error = new Error('Your input exceeds the context window of this model.');
        error.code = 'context_length_exceeded';
        error.status = 400;
        onEvent({ type: 'content', text: 'Partial streaming content before compaction.' });
        onEvent({ type: 'error', code: error.code, message: error.message });
        throw error;
      }
      assert.deepEqual(toolHistory, []);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].role, 'system');
      assert.match(messages[0].content, /Compressed conversation checkpoint/);
      onEvent({ type: 'content', text: 'Recovered after compaction.' });
      onEvent({
        type: 'usage',
        usage: { inputTokens: 500, outputTokens: 20 },
      });
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
  assert.equal(contextAttempts, 3);
  assert.equal(compressionAttempts, 1);
  assert.deepEqual(compressionRequest.toolHistory, []);
  const compressedInput = JSON.stringify(compressionRequest.messages);
  assert.match(compressedInput, /Working context before the tool call/);
  assert.match(compressedInput, /collect_context/);
  assert.match(compressedInput, /Tool result that must survive compaction/);
  assert.match(compressedInput, /Partial streaming content before compaction/);
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
  const contextMessages = database.getMessages(contextConversation.id);
  const contextAssistant = contextMessages.findLast((message) => message.role === 'assistant');
  assert.equal(contextAssistant?.content, 'Recovered after compaction.');
  assert.deepEqual(
    contextAssistant?.segments.map((segment) => segment.type),
    ['context-compression', 'content'],
  );
  assert.equal(contextAssistant?.segments[0].contentOffset, 0);
  assert.equal(contextAssistant?.segments[0].status, 'completed');
  assert.equal(
    contextMessages.find((message) => (
      message.role === 'system'
      && message.segments.some((segment) => segment.type === 'context-compression')
    ))?.hidden,
    true,
  );
  assert.deepEqual(
    database.toModelMessages(contextConversation.id).map(({ role, content }) => ({
      role,
      content,
    })),
    [
      {
        role: 'system',
        content: '<conversation_checkpoint>\n'
          + 'Compressed conversation checkpoint.\n'
          + '</conversation_checkpoint>',
      },
      {
        role: 'assistant',
        content: 'Recovered after compaction.',
      },
    ],
  );
  const compressionMessage = database.getMessages(contextConversation.id)
    .find((message) => message.segments.some((segment) => (
      segment.type === 'context-compression'
    )));
  assert.equal(compressionMessage.segments[0].inputTokens, 90_000);
  assert.equal(compressionMessage.segments[0].outputTokens, 500);

  let thresholdAttempts = 0;
  let thresholdCompressionRequest;
  const thresholdProvider = {
    getContributions: () => ({
      tools: [{
        name: 'threshold_context',
        description: 'Return context for threshold compaction.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async () => 'Threshold tool result.',
      }],
    }),
    stream: async ({ messages, toolHistory, onEvent }) => {
      if (messages.at(-1)?.content.includes('CONTEXT CHECKPOINT COMPACTION')) {
        thresholdCompressionRequest = { messages, toolHistory };
        onEvent({
          type: 'usage',
          usage: { inputTokens: 96_000, outputTokens: 300 },
        });
        return {
          assistantContent: 'Threshold checkpoint.',
          continuation: [],
          toolCalls: [],
        };
      }

      thresholdAttempts += 1;
      if (thresholdAttempts === 1) {
        onEvent({ type: 'content', text: 'Threshold work before the tool.' });
        onEvent({
          type: 'tool-call',
          key: 'threshold-context',
          callId: 'threshold-context-call',
          name: 'threshold_context',
          argumentsText: JSON.stringify({
            __invocation_goal: 'Preserve threshold tool context',
            __requires_human_approval: false,
          }),
        });
        return {
          assistantContent: 'Threshold work before the tool.',
          continuation: [],
          toolCalls: [{
            key: 'threshold-context',
            callId: 'threshold-context-call',
            name: 'threshold_context',
            argumentsText: JSON.stringify({
              __invocation_goal: 'Preserve threshold tool context',
              __requires_human_approval: false,
            }),
          }],
        };
      }

      onEvent({ type: 'content', text: 'Threshold final response.' });
      onEvent({
        type: 'usage',
        usage: { inputTokens: 95_000, outputTokens: 25 },
      });
      return {
        assistantContent: 'Threshold final response.',
        continuation: [],
        toolCalls: [],
      };
    },
  };
  const thresholdRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: thresholdProvider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: () => {},
  });
  const thresholdConversation = database.createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await thresholdRunner.send({
    conversationId: thresholdConversation.id,
    model: model.id,
    text: 'Compact the completed tool context.',
  });
  await waitFor(() => !thresholdRunner.runs.has(thresholdConversation.id));
  assert.equal(thresholdAttempts, 2);
  assert.deepEqual(thresholdCompressionRequest.toolHistory, []);
  const thresholdCompressedInput = JSON.stringify(thresholdCompressionRequest.messages);
  assert.match(thresholdCompressedInput, /Threshold work before the tool/);
  assert.match(thresholdCompressedInput, /threshold_context/);
  assert.match(thresholdCompressedInput, /Threshold tool result/);
  assert.match(thresholdCompressedInput, /Threshold final response/);
  assert.deepEqual(
    database.toModelMessages(thresholdConversation.id),
    [{
      role: 'system',
      content: '<conversation_checkpoint>\nThreshold checkpoint.\n</conversation_checkpoint>',
    }],
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
