import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-chat-send-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;
let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { closeDatabase, createConversation } = database;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };

  function buildRunner(provider, events = []) {
    return new ChatRunner({
      registry: {
        resolve: () => ({ model, provider }),
        listModels: () => [model],
      },
      mcpManager: null,
      sendEvent: (event) => events.push(event),
    });
  }

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  // An immediate send starts a run and returns its streaming assistant message so the
  // renderer can render the Thinking placeholder before the first token arrives.
  let resolveFirstStream;
  const immediateEvents = [];
  const immediateRunner = buildRunner({
    getContributions: () => ({ tools: [] }),
    stream: () => new Promise((resolveStream) => {
      resolveFirstStream = () => resolveStream({ assistantContent: 'Immediate reply', toolCalls: [] });
    }),
  }, immediateEvents);
  const immediateConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  const immediateResult = await immediateRunner.send({
    conversationId: immediateConversation.id,
    model: model.id,
    text: 'Capture the assistant placeholder',
  });
  assert.equal(immediateResult.queued, false);
  assert.equal(immediateResult.assistantMessage?.role, 'assistant');
  assert.equal(immediateResult.assistantMessage.status, 'streaming');
  assert.equal(immediateResult.assistantMessage.content, '');
  assert.equal(immediateResult.assistantMessage.conversationId, immediateConversation.id);
  assert.notEqual(immediateResult.assistantMessage.id, immediateResult.message.id);
  const placeholderEvent = immediateEvents.find(
    (event) => event.type === 'message' && event.message.id === immediateResult.assistantMessage.id,
  );
  assert.ok(placeholderEvent);
  assert.equal(placeholderEvent.message.status, 'streaming');
  resolveFirstStream();
  await waitFor(() => !immediateRunner.runs.has(immediateConversation.id));

  // Queued and steered sends do not start a run and return no assistant message.
  const queuedRunner = buildRunner({
    getContributions: () => ({ tools: [] }),
    stream: () => new Promise(() => {}),
  });
  const queuedConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await queuedRunner.send({
    conversationId: queuedConversation.id,
    model: model.id,
    text: 'Active run',
  });
  const queuedResult = await queuedRunner.send({
    conversationId: queuedConversation.id,
    model: model.id,
    text: 'Queued behind the active run',
  });
  assert.equal(queuedResult.queued, true);
  assert.equal(queuedResult.assistantMessage ?? null, null);
  const steeredResult = await queuedRunner.send({
    conversationId: queuedConversation.id,
    model: model.id,
    text: 'Steered behind the active run',
    steer: true,
  });
  assert.equal(steeredResult.queued, true);
  assert.equal(steeredResult.assistantMessage ?? null, null);

  closeDatabase();
  database = null;
  console.log('Chat send result tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
