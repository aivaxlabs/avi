import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-memory-hints-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { setTraceLevel } = await import('../src/main/trace-log.js');
  const {
    createConversation,
    getConversation,
    getPreferences,
    insertMessage,
    listAllConversations,
  } = database;
  setTraceLevel('minimal');

  const model = {
    id: 'test:model',
    providerId: 'test',
    modelId: 'model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    capabilities: {},
    context: { input: 100_000, output: 1_000 },
  };
  const requests = [];
  let failHints = false;
  let releaseHint = () => {};
  const events = [];
  let enabled = true;
  let defaultMemoryInstructionsEnabled = true;
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({
        model,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: async ({ messages, tools }) => {
            const hint = messages.some((message) => (
              typeof message.content === 'string' && message.content.includes('thread_type: memory_hint')
            ));
            requests.push({ hint, messages, tools: tools.map((tool) => tool.name) });
            if (hint) {
              await new Promise((resolveHint) => { releaseHint = resolveHint; });
              if (failHints) throw new Error('Hint provider failed.');
              return { assistantContent: 'Nothing recorded.', continuation: [], toolCalls: [] };
            }
            return { assistantContent: 'Done.', continuation: [], toolCalls: [] };
          },
        },
      }),
      listModels: () => [model],
    },
    getPreferences: () => ({
      ...getPreferences(),
      tuning: {
        ...getPreferences().tuning,
        asyncMemoryHintsEnabled: enabled,
        defaultMemoryInstructionsEnabled,
        continuationRepliesEnabled: false,
      },
    }),
    sendEvent: (event) => events.push(event),
  });

  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };

  const source = createConversation({ model: model.id, projectPath: process.cwd() });
  insertMessage({ conversationId: source.id, role: 'user', status: 'sent', content: 'Earlier request' });
  await runner.send({ conversationId: source.id, model: model.id, text: 'Do the work', project: { path: process.cwd() } });
  await waitFor(() => requests.some((request) => request.hint), 'the iteration hint');

  const hintRequest = requests.find((request) => request.hint);
  assert.ok(hintRequest.messages.some((message) => message.content === 'Do the work'));
  assert.match(hintRequest.messages.at(-1).content, /<memory_hint trigger="iteration">/);
  for (const name of ['ask_question', 'chat_spawn_subagent', 'chat_send_prompt', 'update_tasks', 'start_goal']) {
    assert.equal(hintRequest.tools.includes(name), false, `${name} must be hidden`);
  }
  const [hintId] = runner.memoryHintThreads;
  assert.equal(getConversation(hintId).conversationType, 'memory_hint');
  assert.equal(listAllConversations().some((conversation) => conversation.id === hintId), false);
  assert.equal(events.some((event) => event.conversationId === hintId), false);

  const eventsBeforeTasks = requests.length;
  runner.runs.set(source.id, { model: model.id, permissionMode: 'approve_for_me', workMode: null });
  runner.replaceTasks(source.id, [{ title: 'Step', description: '', done: false, result: '' }]);
  runner.replaceTasks(source.id, [{ title: 'Step', description: '', done: true, result: 'Done' }]);
  runner.replaceTasks(source.id, [
    { title: 'Step', description: '', done: true, result: 'Done' },
    { title: 'Other', description: '', done: false, status: 'inconclusive', result: 'Blocked' },
  ]);
  runner.runs.delete(source.id);
  assert.equal(runner.memoryHints.get(source.id).pending.trigger, 'task');
  assert.equal(requests.length, eventsBeforeTasks);

  releaseHint();
  await waitFor(() => requests.filter((request) => request.hint).length === 2, 'the coalesced task hint');
  assert.equal(getConversation(hintId), null);
  assert.match(requests.filter((request) => request.hint)[1].messages.at(-1).content, /trigger="task"/);

  failHints = true;
  releaseHint();
  await waitFor(() => !runner.memoryHints.has(source.id), 'the hint queue to drain');
  assert.equal(runner.memoryHintThreads.size, 0);
  assert.equal(listAllConversations().length, 1);

  runner.runs.set(source.id, { model: model.id, permissionMode: 'approve_for_me', workMode: null });
  runner.replaceTasks(source.id, [{ title: 'Third', description: '', done: true, result: 'Done' }]);
  runner.runs.delete(source.id);
  await waitFor(() => requests.filter((request) => request.hint).length === 3, 'the failing hint');
  releaseHint();
  await waitFor(() => !runner.memoryHints.has(source.id), 'the failing hint to finish');
  const trace = readFileSync(join(resolvedProfile, '.aivax', 'trace.log'), 'utf8');
  assert.match(trace, /memory-hint\.error[^\n]*Hint provider failed\./);

  const hintCount = requests.filter((request) => request.hint).length;
  for (const [hintsEnabled, defaultInstructions] of [[true, false], [false, true]]) {
    enabled = hintsEnabled;
    defaultMemoryInstructionsEnabled = defaultInstructions;
    await runner.send({ conversationId: source.id, model: model.id, text: 'Again', project: { path: process.cwd() } });
    await waitFor(() => !runner.runs.has(source.id), 'the skipped run');
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    assert.equal(requests.filter((request) => request.hint).length, hintCount);
  }

  console.log('Async memory hints passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
