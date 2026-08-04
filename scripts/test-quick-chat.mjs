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

const generatedAttachment = {
  id: 'generated-image-1',
  kind: 'image_url',
  source: 'generated_image',
  name: 'kitten.png',
  path: 'C:\\Temp\\kitten.png',
  dataUrl: 'data:image/png;base64,a2l0dGVu',
};
let imageRound = 0;
provider.getContributions = () => ({
  tools: [{
    name: 'openai_subscription_generate_or_edit_image',
    description: 'Generate an image.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    execute: async () => ({
      output: JSON.stringify({ operation: 'generate', outputPath: generatedAttachment.path }),
      mediaContent: [{ type: 'image_url', image_url: { url: generatedAttachment.dataUrl } }],
      attachments: [generatedAttachment, generatedAttachment],
    }),
  }],
});
provider.stream = async ({ onEvent }) => {
  imageRound += 1;
  if (imageRound === 1) {
    const toolCall = {
      key: 'image-tool',
      callId: 'image-call',
      name: 'openai_subscription_generate_or_edit_image',
      argumentsText: JSON.stringify({
        __invocation_goal: 'Generate a kitten image.',
        __requires_human_approval: false,
        prompt: 'A cute kitten.',
      }),
    };
    onEvent({ type: 'tool-call', ...toolCall });
    return { assistantContent: '', continuation: [], toolCalls: [toolCall] };
  }
  onEvent({ type: 'content', text: 'Here is the kitten.' });
  return { assistantContent: 'Here is the kitten.', continuation: [], toolCalls: [] };
};

const imageSession = runner.createSession();
await runner.send({
  sessionId: imageSession.id,
  text: 'Generate a kitten.',
  attachments: [],
  model: model.id,
});
while (runner.state(imageSession.id).running) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
const imageMessage = runner.state(imageSession.id).messages.at(-1);
assert.deepEqual(imageMessage.attachments, [generatedAttachment]);
assert.equal(imageMessage.status, 'completed');
assert.equal(events.some((event) => (
  event.sessionId === imageSession.id
  && event.type === 'message'
  && event.message.status === 'completed'
  && event.message.attachments?.[0]?.id === generatedAttachment.id
)), true);
runner.close(imageSession.id);

preferences.defaultModels.quickChat = null;
assert.throws(() => runner.createSession(), /Choose a Quick chat model/);

console.log('Quick chat tests passed.');
process.exit(0);
