import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-truncated-generation-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

try {
  const { ModelProvider } = await import('../src/main/model-provider.js');
  const { chatCompletionsApi } = await import('../src/providers/openai-compatible.js');

  const model = {
    id: 'test:model',
    modelId: 'test',
    providerName: 'Test',
    interface: 'chat-completions',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };

  const createProvider = (ssePayloads) => new ModelProvider(
    { id: 'test', enabled: true, models: [] },
    {
      createBody: async () => ({}),
      request: async () => new Response(
        ssePayloads.map((payload) => `data: ${JSON.stringify(payload)}`).join('\n\n')
          + '\n\ndata: [DONE]\n\n',
        { status: 200 },
      ),
      eventsFrom: chatCompletionsApi.eventsFrom,
    },
    {},
  );

  const stream = (provider, onEvent = () => {}) => provider.stream({
    model,
    messages: [],
    tools: [],
    toolHistory: [],
    invocationContext: {},
    signal: new AbortController().signal,
    onEvent,
  });

  // A stream that ends while reasoning is still open is a truncated generation.
  await assert.rejects(
    stream(createProvider([
      { choices: [{ delta: { reasoning_content: 'thinking through the problem' } }] },
    ])),
    (error) => error.code === 'generation_truncated'
      && /middle of reasoning/.test(error.message),
  );

  // Reasoning followed by a real answer is a normal completion.
  const answered = await stream(createProvider([
    { choices: [{ delta: { reasoning_content: 'thinking' } }] },
    { choices: [{ delta: { content: 'Answer' } }] },
  ]));
  assert.equal(answered.assistantContent, 'Answer');
  assert.equal(answered.toolCalls.length, 0);

  // A tool call whose arguments are cut off mid-JSON is an incomplete tool call.
  await assert.rejects(
    stream(createProvider([
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              function: { name: 'run_in_terminal', arguments: '{"command":' },
            }],
          },
        }],
      },
    ])),
    (error) => error.code === 'incomplete_tool_call'
      && /incomplete tool call \(run_in_terminal\)/.test(error.message),
  );

  // A tool call with no name is incomplete even when its arguments parse.
  await assert.rejects(
    stream(createProvider([
      {
        choices: [{
          delta: {
            tool_calls: [{ index: 0, id: 'call_2', function: { arguments: '{}' } }],
          },
        }],
      },
    ])),
    (error) => error.code === 'incomplete_tool_call',
  );

  // A complete tool call with valid JSON arguments is a normal completion.
  const toolTurn = await stream(createProvider([
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_3',
            function: { name: 'run_in_terminal', arguments: '{"command":"ls"}' },
          }],
        },
      }],
    },
  ]));
  assert.equal(toolTurn.toolCalls.length, 1);
  assert.equal(toolTurn.toolCalls[0].name, 'run_in_terminal');
  assert.deepEqual(JSON.parse(toolTurn.toolCalls[0].argumentsText), { command: 'ls' });

  console.log('Truncated generation tests passed.');
} finally {
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
