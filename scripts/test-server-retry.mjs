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
const acceleratedDelays = new Set([200, 400, 800, 1_600, 3_200]);
globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
  callback,
  delay === 30_000 ? 5 : acceleratedDelays.has(delay) ? 1 : delay,
  ...args,
);

let database;
try {
  database = await import('../src/main/database.js');
  const { ModelProvider } = await import('../src/main/model-provider.js');
  const model = {
    name: 'Test',
    modelId: 'test',
    reasoning: [],
  };

  const createProvider = (request) => new ModelProvider(
    { id: 'test', enabled: true, models: [] },
    {
      createBody: async () => ({}),
      request,
      eventsFrom: () => [],
    },
    {},
  );
  const stream = (
    provider,
    workMode = null,
    signal = new AbortController().signal,
  ) => provider.stream({
    model,
    messages: [],
    tools: [],
    toolHistory: [],
    invocationContext: { workMode },
    signal,
    onEvent: () => {},
  });

  let normalAttempts = 0;
  await assert.rejects(
    stream(createProvider(async () => {
      normalAttempts += 1;
      return new Response('unavailable', { status: 503 });
    })),
    /unavailable/,
  );
  assert.equal(normalAttempts, 5);

  let goalAttempts = 0;
  await stream(createProvider(async () => {
    goalAttempts += 1;
    return goalAttempts <= 5
      ? new Response('unavailable', { status: 503 })
      : new Response('data: [DONE]\n\n', { status: 200 });
  }), 'goal');
  assert.equal(goalAttempts, 6);

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
  assert.equal(timeoutAttempts, 5);

  const controller = new AbortController();
  let cancellationAttempts = 0;
  const cancellation = stream(createProvider(async () => {
    cancellationAttempts += 1;
    return new Response('unavailable', { status: 503 });
  }), null, controller.signal);
  nativeSetTimeout(() => controller.abort(new Error('Stopped by user.')), 0);
  await assert.rejects(cancellation, /Stopped by user/);
  assert.equal(cancellationAttempts, 1);

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
