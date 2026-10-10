import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = resolve(mkdtempSync(join(tmpdir(), 'aivax-watchdog-test-')));
process.env.USERPROFILE = testProfile;
process.env.HOME = testProfile;

function block(milliseconds) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until);
}

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { createConversation, getMessage, getPreferences, setTuningSettings } = database;

  assert.equal(getPreferences().tuning.eventLoopWatchdogMs, 1_000);
  assert.equal(setTuningSettings({ ...getPreferences().tuning, eventLoopWatchdogMs: 0 }).eventLoopWatchdogMs, 0);
  assert.throws(() => setTuningSettings({ ...getPreferences().tuning, eventLoopWatchdogMs: 200 }));

  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };
  const blocking = new Set();
  const events = [];
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({
        model,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: ({ signal, onEvent }) => new Promise((resolveStream, rejectStream) => {
            signal.addEventListener('abort', () => rejectStream(new Error('The run was interrupted.')));
            const timer = setInterval(() => {
              if (signal.aborted) return clearInterval(timer);
              onEvent({ type: 'content', text: 'x' });
            }, 20);
          }),
        },
      }),
      listModels: () => [model],
    },
    mcpManager: null,
    getPreferences: () => {
      const preferences = getPreferences();
      return { ...preferences, tuning: { ...preferences.tuning, eventLoopWatchdogMs: 500 } };
    },
    sendEvent: (event) => {
      events.push(event);
      if (event.type === 'message' && blocking.has(event.conversationId)) block(700);
    },
  });

  async function waitFor(predicate, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  }

  const [healthy, heavy] = Array.from({ length: 2 }, () => createConversation({
    model: model.id,
    projectPath: process.cwd(),
  }).id);
  for (const conversationId of [healthy, heavy]) {
    await runner.send({ conversationId, model: model.id, text: 'Hi' });
  }
  await waitFor(() => runner.runs.size === 2);
  const heavyMessageId = runner.runs.get(heavy).assistantMessageId;
  blocking.add(heavy);

  await waitFor(() => !runner.runs.has(heavy));
  assert.ok(runner.runs.has(healthy), 'the healthy thread keeps running');
  const stopped = getMessage(heavyMessageId);
  assert.equal(stopped.status, 'error');
  assert.match(stopped.segments.at(-1).message, /Avi stopped this thread because it blocked the app/);
  assert.equal(stopped.segments.at(-1).code, 'watchdog_stopped');
  assert.ok(events.some((event) => (
    event.type === 'error'
    && event.conversationId === heavy
    && /blocked the app/.test(event.message)
  )));
  const trace = readFileSync(join(testProfile, '.aivax', 'trace.log'), 'utf8');
  assert.match(trace, /chat\.watchdog-stopped/);

  runner.stop(healthy);
  await waitFor(() => runner.runs.size === 0);
  await runner.shutdown();
  console.log('Event loop watchdog tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(testProfile, { recursive: true, force: true });
}
process.exit(0);
