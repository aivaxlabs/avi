import assert from 'node:assert/strict';
import { QuickChatRunner } from '../src/main/quick-chat-runner.js';

const model = {
  id: 'test:quick',
  modelId: 'quick',
  providerId: 'test',
  providerName: 'Test',
  interface: 'test',
  reasoning: [],
  capabilities: {},
  context: { input: 8192, output: 2048 },
};
const events = [];
const provider = {
  getContributions: () => ({ tools: [] }),
  stream: async ({ onEvent, invocationContext, messages }) => {
    assert.equal(invocationContext.quickChat, true);
    assert.equal(invocationContext.workspacePath.length > 0, true);
    assert.equal(messages.at(-1).content, 'Hello');
    onEvent({ type: 'content', text: 'Hi' });
    return { assistantContent: 'Hi', continuation: [], toolCalls: [] };
  },
};
const preferences = {
  defaultModels: { quickChat: { modelId: model.id, reasoningEffort: null } },
  tuning: { toolOutputLimit: 2048 },
};
const runner = new QuickChatRunner({
  registry: {
    listModels: () => [model],
    resolve: (id) => id === model.id ? { model, provider } : null,
  },
  mcpManager: { ensureWorkspace: async () => ({ tools: [], instructions: [] }) },
  chatRunner: {},
  getPreferences: () => preferences,
  sendEvent: (sessionId, event) => events.push({ sessionId, ...event }),
  stopBackgroundTasks: () => {},
});

const session = runner.createSession();
assert.equal(session.model, model.id);
assert.deepEqual(session.messages, []);
await runner.send({ sessionId: session.id, text: 'Hello', attachments: [], model: model.id });
while (runner.state(session.id).running) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
const completed = runner.state(session.id);
assert.equal(completed.messages.length, 2);
assert.equal(completed.messages[0].content, 'Hello');
assert.equal(completed.messages[1].content, 'Hi');
assert.equal(completed.messages[1].status, 'completed');
assert.equal(events.some((event) => event.type === 'run-state' && event.running), true);
assert.equal(events.some((event) => event.type === 'run-state' && !event.running), true);
runner.close(session.id);
assert.throws(() => runner.state(session.id), /no longer available/);

preferences.defaultModels.quickChat = null;
assert.throws(() => runner.createSession(), /Choose a Quick chat model/);

console.log('Quick chat tests passed.');
process.exit(0);
