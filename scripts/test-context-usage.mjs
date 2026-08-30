import assert from 'node:assert/strict';
import {
  compactOldToolResults,
  countMessageContext,
  countSerializedCharacters,
  distributeContextUsage,
  QUICK_COMPRESSION_MARKER,
} from '../src/main/context-usage.js';

assert.equal(countSerializedCharacters({ spaced: true, nested: { value: 1 } }), 36);
assert.deepEqual(countMessageContext([
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'answer' },
  { role: 'tool', tool_call_id: 'call-1', content: '{\n  "value": 1\n}' },
  { role: 'user', content: [{ type: 'text', text: 'caption' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] },
]), {
  messagesCharacters: 132,
  toolResultCharacters: 63,
  otherCharacters: 74,
});

const distributed = distributeContextUsage({
  contextTokens: 100,
  contextLimit: 1_000,
  segments: [
    { id: 'avi', label: 'Avi instructions', characters: 100 },
    { id: 'messages', label: 'Messages', characters: 200 },
  ],
});
assert.equal(distributed.usedCharacters, 400);
assert.equal(distributed.segments.find((segment) => segment.id === 'other').characters, 100);
assert.equal(distributed.segments.find((segment) => segment.id === 'messages').percent, 0.5);

const normalized = distributeContextUsage({
  contextTokens: 50,
  contextLimit: 1_000,
  segments: [
    { id: 'avi', label: 'Avi instructions', characters: 300 },
    { id: 'messages', label: 'Messages', characters: 100 },
  ],
});
assert.equal(normalized.segments.find((segment) => segment.id === 'avi').contextCharacters, 150);
assert.equal(normalized.segments.find((segment) => segment.id === 'other').characters, 0);

const messages = [
  { id: 'checkpoint', role: 'system', segments: [] },
  { id: 'u1', role: 'user', segments: [] },
  {
    id: 'a1',
    role: 'assistant',
    segments: [
      { type: 'provider-continuation', items: [{ type: 'function_call_output', output: 'hidden' }] },
      { type: 'tool-call', callId: 'old', resultText: 'x'.repeat(200), mediaContent: [{ type: 'image_url', image_url: { url: 'old' } }] },
    ],
  },
  { id: 'u2', role: 'user', segments: [] },
  { id: 'a2', role: 'assistant', segments: [{ type: 'tool-call', callId: 'keep-2', resultText: 'two' }] },
  { id: 'u3', role: 'user', segments: [] },
  { id: 'a3', role: 'assistant', segments: [{ type: 'tool-call', callId: 'keep-3', resultText: 'three' }] },
  { id: 'u4', role: 'user', segments: [] },
  { id: 'a4', role: 'assistant', segments: [{ type: 'tool-call', callId: 'keep-4', resultText: 'four' }] },
  { id: 'u5', role: 'user', segments: [] },
  { id: 'a5', role: 'assistant', segments: [{ type: 'tool-call', callId: 'keep-5', resultText: 'five' }] },
];
const compacted = compactOldToolResults(messages, { checkpointMessageId: 'checkpoint' });
assert.equal(compacted.replacedResults, 1);
assert.equal(compacted.updates.length, 1);
assert.deepEqual(compacted.updates[0].segments, [{
  type: 'tool-call',
  callId: 'old',
  resultText: QUICK_COMPRESSION_MARKER,
}]);
assert.ok(compacted.charactersRemoved > 100);
assert.equal(compactOldToolResults(messages.slice(-8)).updates.length, 0);

console.log('Context usage tests passed.');
