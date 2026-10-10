import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(tmpdir(), '.avi', 'visualizations', new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-') + '-UTC', 'anthropic-messages-tests');
mkdirSync(root, { recursive: true });
process.env.USERPROFILE = mkdtempSync(join(root, 'profile-'));
const { messagesApi } = await import('../src/providers/anthropic-messages.js');
const { ModelProvider } = await import('../src/main/model-provider.js');
const { createJsonRequestBody, fileBase64JsonValue } = await import('../src/main/json-request-body.js');

const provider = { id: 'test-messages', name: 'Messages', enabled: true, models: [], interface: 'messages-test' };
const implementation = { descriptor: { id: 'messages-test', name: 'Messages' }, ...messagesApi };
const model = { id: 'test-messages:sonnet', modelId: 'claude-sonnet-5-5', interface: 'messages-test', adaptiveThinking: true, defaultEffort: 'high', reasoning: ['low', 'high', 'xhigh'], context: { input: 136000, output: 64000 } };

const body = await messagesApi.createBody({
  model, messages: [{ role: 'system', content: 'System' }, { role: 'user', content: 'Hi' }],
  tools: [{ name: 'lookup', description: 'Find', inputSchema: { type: 'object' } }],
  reasoningEffort: 'xhigh', invocationContext: {},
});
assert.equal(body.system.at(-1).text, 'System');
assert.deepEqual(body.thinking, { type: 'adaptive' });
assert.equal(body.output_config.effort, 'xhigh');
assert.equal(body.tools[0].input_schema.type, 'object');
assert.equal(body.max_tokens, 64000);
assert.equal((await messagesApi.createBody({ model, messages: [], invocationContext: {} })).output_config.effort, 'high');
const customBody = await messagesApi.createBody({
  provider: { customJson: '{"output_config":{"format":"json"},"max_tokens":1000}' },
  model: { ...model, customJson: '{"max_tokens":2000}' },
  messages: [],
  reasoningEffort: 'low',
  invocationContext: {},
});
assert.deepEqual(customBody.output_config, { effort: 'low', format: 'json' });
assert.equal(customBody.max_tokens, 2000);

const payloads = [
  { type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Thinking' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call1', name: 'lookup', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"test"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
];
const emitted = [];
const mocked = new ModelProvider(provider, {
  ...implementation,
  request: async () => new Response(payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join('')),
}, {});
const result = await mocked.stream({ model, messages: [{ role: 'user', content: 'Hi' }], tools: [], toolHistory: [], signal: new AbortController().signal, onEvent: (event) => emitted.push(event) });
assert.equal(result.toolCalls[0].name, 'lookup');
assert.equal(result.toolCalls[0].argumentsText, '{"q":"test"}');
assert.equal(result.continuation[0].signature, 'signed');
assert.deepEqual(emitted.find((event) => event.type === 'usage').usage, { inputTokens: 60, cachedInputTokens: 30, outputTokens: 5, totalTokens: 65 });
const round = await messagesApi.createBody({ model, messages: [{ role: 'user', content: 'Hi' }], toolHistory: [{ ...result, results: [{ callId: 'call1', output: 'Found', mediaContent: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }] }], invocationContext: {} });
assert.equal(round.messages[1].content[0].signature, 'signed');
assert.equal(round.messages[2].content[0].tool_use_id, 'call1');
assert.equal(round.messages[2].content[0].content[1].source.data, 'YQ==');
const savedMessage = { role: 'assistant', content: '', [Symbol.for('avi.providerContinuation')]: { model: model.id, interface: model.interface, items: result.continuation } };
const resumed = await messagesApi.createBody({ model, messages: [{ role: 'user', content: 'Hi' }, savedMessage], invocationContext: {} });
assert.equal(resumed.messages[1].content[0].signature, 'signed');
assert.equal(messagesApi.eventsFrom({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, {}).at(-1).type, 'error');
assert.equal(messagesApi.eventsFrom({ type: 'message_stop' }, {}).at(-1).code, 'stream_incomplete');
const emptyToolState = {};
for (const payload of [{ type: 'message_start', message: {} }, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'empty', id: 'empty', input: {} } }]) messagesApi.eventsFrom(payload, emptyToolState);
assert.equal(messagesApi.eventsFrom({ type: 'content_block_stop', index: 0 }, emptyToolState)[0].argumentsText, '{}');
const otherState = {};
messagesApi.eventsFrom({ type: 'message_start', message: {} }, otherState);
assert.notEqual(otherState.blocks, emptyToolState.blocks);

const imagePath = join(root, 'image.png');
writeFileSync(imagePath, Buffer.from('image'));
for (const dataUrl of [true, false]) {
  const value = { data: fileBase64JsonValue(imagePath, 'image/png', { dataUrl }) };
  const serialized = createJsonRequestBody(value);
  const chunks = [];
  for await (const chunk of serialized.body) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, serialized.contentLength);
  assert.equal(JSON.parse(bytes).data, `${dataUrl ? 'data:image/png;base64,' : ''}aW1hZ2U=`);
}
const image = await messagesApi.createBody({ model, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { path: imagePath, mime: 'image/png' } }] }], invocationContext: {} });
assert.equal(image.messages[0].content[0].source.type, 'base64');
let partialAttempts = 0;
const partial = new ModelProvider(provider, {
  ...implementation,
  request: async () => {
    partialAttempts += 1;
    return new Response([
      ...payloads.slice(0, 8),
      { type: 'error', error: { type: 'provider_error', message: 'Interrupted after tool output' } },
    ].map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join(''));
  },
}, {});
await assert.rejects(partial.stream({ model, messages: [], tools: [], toolHistory: [], signal: new AbortController().signal, onEvent: () => {} }), /Interrupted after tool output/);
assert.equal(partialAttempts, 1, 'Partial output must never replay on automatic retry');
const document = await messagesApi.createBody({ model, messages: [{ role: 'user', content: [{ type: 'file', file: { file_data: 'https://example.com/file.pdf' } }] }], invocationContext: {} });
assert.equal(document.messages[0].content[0].source.type, 'url');
await assert.rejects(messagesApi.createBody({ model, messages: [{ role: 'user', content: [{ type: 'file', file: { file_data: 'data:text/csv;base64,YQ==' } }] }], invocationContext: {} }), /PDF/);
emptyToolState.blocks.get(0).argumentsText = '  ';
assert.equal(messagesApi.eventsFrom({ type: 'content_block_stop', index: 0 }, emptyToolState)[0].argumentsText, '{}');
emptyToolState.blocks.get(0).argumentsText = '{';
assert.throws(() => messagesApi.eventsFrom({ type: 'content_block_stop', index: 0 }, emptyToolState), (error) => error.code === 'incomplete_tool_call');
console.log('Anthropic Messages: request body, streaming, continuation, usage, media, and partial-output tests passed.');
