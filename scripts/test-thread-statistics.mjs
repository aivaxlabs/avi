import assert from 'node:assert/strict';
import { buildThreadStatistics } from '../src/main/thread-statistics.js';
import { StreamAccumulator } from '../src/main/streaming.js';

const requests = Array.from({ length: 100 }, (_, index) => ({
  connectMs: index + 1,
  firstTokenMs: (index + 1) * 10,
  streamMs: 1_000,
  outputTokens: index + 1,
  error: index < 3,
}));

const statistics = buildThreadStatistics([
  { role: 'user', usage: { inputTokens: 999 }, segments: [] },
  {
    role: 'assistant',
    usage: {
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningTokens: 50,
      totalTokens: 1_200,
      requests,
    },
    segments: [
      { type: 'content', text: 'ok' },
      { type: 'tool-call', status: 'completed' },
      { type: 'tool-call', status: 'error', errorKind: 'invocation' },
      { type: 'tool-call', status: 'error', errorKind: 'execution' },
      { type: 'tool-call', status: 'error' },
      { type: 'tool-call', status: 'error', errorKind: 'interrupted' },
    ],
  },
  {
    role: 'assistant',
    usage: { inputTokens: 500, outputTokens: 100, latencyMs: 5_000, tokensPerSecond: 7 },
    segments: [],
  },
]);

assert.deepEqual(statistics.latency.connection, { p50: 50, p95: 95, p99: 99, samples: 100 });
assert.deepEqual(statistics.latency.firstToken, { p50: 510, p95: 960, p99: 1_000, samples: 101 });
assert.deepEqual(statistics.tokensPerSecond, { p50: 52, p95: 96, p99: 100, samples: 97 });
assert.equal(buildThreadStatistics([{
  role: 'assistant',
  usage: { requests: [{ firstTokenMs: 40_000, streamMs: 42_000, outputTokens: 4_200, error: false }] },
}]).tokensPerSecond.p50, 100);
assert.deepEqual(statistics.tokens, {
  input: 1_500,
  cached: 400,
  output: 300,
  reasoning: 50,
  total: 1_800,
  cachedRatio: 400 / 1_500,
  reasoningRatio: 50 / 300,
});
assert.deepEqual(statistics.requests, { count: 101, errors: 3 });
assert.deepEqual(statistics.tools, { calls: 5, invocationErrors: 1, otherErrors: 2 });

const empty = buildThreadStatistics([]);
assert.deepEqual(empty.latency.firstToken, { p50: null, p95: null, p99: null, samples: 0 });
assert.equal(empty.tokens.cachedRatio, null);
assert.equal(empty.tokens.reasoningRatio, null);

const accumulator = new StreamAccumulator({ usage: { requests: [requests[0]] } });
accumulator.apply({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } });
assert.deepEqual(accumulator.usage.requests, [requests[0]]);
accumulator.apply({ type: 'tool-call', key: 'k', callId: 'c', name: 'tool', argumentsText: '{}' });
accumulator.apply({ type: 'tool-result', callId: 'c', output: 'Error', isError: true, errorKind: 'invocation' });
assert.equal(accumulator.segments[0].errorKind, 'invocation');

console.log('thread statistics tests passed');
