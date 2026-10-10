import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = resolve(mkdtempSync(join(tmpdir(), 'aivax-thread-capacity-test-')));
process.env.USERPROFILE = testProfile;
process.env.HOME = testProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { createConversation, getPreferences } = database;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };
  let maxParallelThreads = 2;
  const streams = new Map();
  const events = [];
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({
        model,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: ({ invocationContext }) => new Promise((resolveStream) => {
            streams.set(invocationContext.conversationId, () => (
              resolveStream({ assistantContent: 'done', toolCalls: [] })
            ));
          }),
        },
      }),
      listModels: () => [model],
    },
    mcpManager: null,
    getPreferences: () => {
      const preferences = getPreferences();
      return { ...preferences, tuning: { ...preferences.tuning, maxParallelThreads } };
    },
    sendEvent: (event) => events.push(event),
  });

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  const conversations = Array.from({ length: 4 }, () => createConversation({
    model: model.id,
    projectPath: process.cwd(),
  }));
  for (const conversation of conversations) {
    await runner.send({ conversationId: conversation.id, model: model.id, text: 'Hi' });
  }
  const [first, second, third, fourth] = conversations.map((conversation) => conversation.id);

  await waitFor(() => streams.size === 2 && runner.capacitySnapshot().length === 2);
  assert.deepEqual([...streams.keys()], [first, second]);
  assert.deepEqual(runner.capacitySnapshot(), [
    { conversationId: third, position: 1 },
    { conversationId: fourth, position: 2 },
  ]);
  assert.deepEqual(runner.reloadSnapshot().capacityWaits, runner.capacitySnapshot());
  assert.ok(events.some((event) => (
    event.type === 'capacity-waiting'
    && event.conversationId === fourth
    && event.waiting
    && event.position === 2
  )));

  runner.stop(fourth);
  await waitFor(() => !runner.runs.has(fourth));
  assert.deepEqual(runner.capacitySnapshot(), [{ conversationId: third, position: 1 }]);
  assert.ok(events.some((event) => (
    event.type === 'capacity-waiting' && event.conversationId === fourth && !event.waiting
  )));

  streams.get(first)();
  await waitFor(() => streams.has(third));
  assert.deepEqual(runner.capacitySnapshot(), []);
  assert.equal(runner.capacityHolders.size, 2);

  maxParallelThreads = 3;
  const fifth = createConversation({ model: model.id, projectPath: process.cwd() }).id;
  await runner.send({ conversationId: fifth, model: model.id, text: 'Hi' });
  await waitFor(() => streams.has(fifth));
  assert.equal(runner.capacityHolders.size, 3);

  for (const id of [second, third, fifth]) streams.get(id)();
  await waitFor(() => runner.runs.size === 0);
  assert.equal(runner.capacityHolders.size, 0);

  console.log('Thread capacity tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(testProfile, { recursive: true, force: true });
}
process.exit(0);
