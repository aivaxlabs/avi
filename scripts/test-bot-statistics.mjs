import assert from 'node:assert/strict';
import { buildBotStatistics } from '../src/main/bot-statistics.js';

const now = '2026-09-20T12:00:00.000Z';
const bots = [
  { id: 'bot-a', name: 'Alpha', conversationId: 'conversation-a', scheduleState: 'scheduled', running: true },
  { id: 'bot-b', name: 'Beta', conversationId: 'conversation-b', scheduleState: 'idle', running: false },
];
const conversations = [
  { id: 'conversation-a', model: 'provider:model', createdAt: '2026-09-14T10:00:00.000Z' },
  { id: 'child-a', parentConversationId: 'conversation-a', model: 'provider:model', createdAt: '2026-09-18T10:00:00.000Z' },
  { id: 'grandchild-a', parentConversationId: 'child-a', model: 'provider:model', createdAt: '2026-09-19T10:00:00.000Z' },
  { id: 'conversation-b', model: 'provider:model', createdAt: '2026-09-19T10:00:00.000Z' },
  { id: 'unrelated', model: 'provider:model', createdAt: '2026-09-19T10:00:00.000Z' },
];
const models = [{
  id: 'provider:model',
  pricing: [{
    tokenThreshold: 0,
    inputPerMillionTokens: 1,
    cachedInputPerMillionTokens: 0.5,
    outputPerMillionTokens: 2,
  }],
}];
const messages = [
  {
    id: 'root-message', conversationId: 'conversation-a', role: 'assistant', model: 'provider:model',
    createdAt: '2026-09-18T10:30:00.000Z', usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 50, totalTokens: 150 },
  },
  {
    id: 'child-message', conversationId: 'child-a', role: 'assistant', model: 'provider:model',
    createdAt: '2026-09-19T23:30:00.000Z', usage: { inputTokens: 10, outputTokens: 5 },
  },
  {
    id: 'child-message', conversationId: 'child-a', role: 'assistant', model: 'provider:model',
    createdAt: '2026-09-19T23:30:00.000Z', usage: { inputTokens: 10, outputTokens: 5 },
  },
  {
    id: 'user-message', conversationId: 'grandchild-a', role: 'user',
    createdAt: '2026-09-19T11:00:00.000Z', usage: { inputTokens: 900, outputTokens: 900 },
  },
  {
    id: 'unknown-price', conversationId: 'conversation-b', role: 'assistant', model: 'unknown:model',
    createdAt: '2026-09-19T11:00:00.000Z', usage: { inputTokens: 3, outputTokens: 4 },
  },
  {
    id: 'current-utc-message', conversationId: 'conversation-a', role: 'assistant', model: 'provider:model',
    createdAt: '2026-09-20T11:00:00.000Z', usage: { inputTokens: 2, outputTokens: 3 },
  },
  {
    id: 'outside-range', conversationId: 'conversation-a', role: 'assistant', model: 'provider:model',
    createdAt: '2026-09-12T11:00:00.000Z', usage: { inputTokens: 1, outputTokens: 1 },
  },
];

const result = buildBotStatistics({ bots, conversations, messages, models, days: 7, now });
assert.deepEqual(
  { days: result.days, from: result.from, to: result.to },
  { days: 7, from: '2026-09-13T12:00:00.000Z', to: now },
);
assert.equal(result.bots[0].descendants, 3);
assert.equal(result.bots[0].totals.createdThreads, 2);
assert.equal(result.bots[0].scheduleState, 'scheduled');
assert.equal(result.bots[0].running, true);
assert.equal(result.bots[0].totals.responses, 3);
assert.equal(result.bots[0].totals.tokens, 170);
assert.equal(result.bots[0].totals.pricedResponses, 3);
assert.equal(result.bots[0].totals.unpricedResponses, 0);
assert.equal(result.bots[0].totals.cost, 0.000218);
assert.equal(result.bots[1].totals.responses, 1);
assert.equal(result.bots[1].totals.cost, null);
assert.equal(result.bots[1].totals.unpricedResponses, 1);
assert.equal(result.totals.responses, 4);
assert.equal(result.totals.cost, null);
assert.equal(result.totals.unpricedResponses, 1);
assert.equal(result.timeline.length, 8);
assert.equal(result.timeline.find((bucket) => bucket.date === '2026-09-20').usageMessages, 1);
assert.equal(result.timeline.find((bucket) => bucket.date === '2026-09-20').tokens, 5);
assert.equal(result.timeline.find((bucket) => bucket.date === '2026-09-20').bots[0].id, 'bot-a');
assert.equal(result.timeline.find((bucket) => bucket.date === '2026-09-20').bots[0].tokens, 5);
assert.equal(result.timeline.find((bucket) => bucket.date === '2026-09-18').tokens, 150);
assert.equal(result.timeline.find((bucket) => bucket.date === '2026-09-19').tokens, 22);
assert.equal(result.timeline.reduce((sum, bucket) => sum + bucket.tokens, 0), result.totals.tokens);

const fullyPriced = buildBotStatistics({ bots: [bots[0]], conversations, messages, models, days: 7, now });
assert.equal(fullyPriced.totals.cost, 0.000218);
assert.equal(fullyPriced.totals.unpricedResponses, 0);

for (const invalidDays of [0, 2, 14, 31, '7']) {
  assert.throws(() => buildBotStatistics({ days: invalidDays, now }), RangeError);
}

const missingRate = buildBotStatistics({
  bots: [bots[0]],
  conversations: [conversations[0]],
  messages: [messages[0]],
  models: [{ id: 'provider:model', pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 } }],
  days: 7,
  now,
});
assert.equal(missingRate.totals.cost, null);
assert.equal(missingRate.totals.unpricedResponses, 1);

const nestedBots = [
  bots[0],
  { id: 'nested-bot', name: 'Nested', conversationId: 'child-a' },
];
const nestedResult = buildBotStatistics({ bots: nestedBots, conversations, messages, models, days: 7, now });
assert.equal(nestedResult.bots[0].totals.responses, 2);
assert.equal(nestedResult.bots[1].totals.responses, 1);
assert.equal(nestedResult.totals.responses, 3);
assert.equal(nestedResult.timeline.reduce((sum, bucket) => sum + bucket.usageMessages, 0), 3);

const mixed = buildBotStatistics({
  bots: [bots[0]], conversations, models, days: 7, now,
  messages: [messages[0], { ...messages[0], id: 'unpriced-same-bot', model: 'unknown:model' }],
});
assert.equal(mixed.bots[0].totals.cost, null);
assert.equal(mixed.timeline.find((bucket) => bucket.date === '2026-09-18').bots[0].cost, null);
assert.equal(mixed.totals.cost, null);

console.log('Bot statistics tests passed.');
