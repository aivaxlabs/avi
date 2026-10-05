import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(tmpdir(), '.avi', 'visualizations', 'quick-question-fork');
mkdirSync(root, { recursive: true });
const profile = mkdtempSync(join(root, 'profile-'));
process.env.USERPROFILE = profile;
process.env.HOME = profile;
let database;
try {
  database = await import('../src/main/database.js');
  const { QuickChatRunner } = await import('../src/main/quick-chat-runner.js');
  const model = {
    id: 'test:quick',
    modelId: 'quick',
    providerId: 'test',
    interface: 'test',
    capabilities: {},
    context: { input: 8192, output: 2048 },
  };
  const provider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ onEvent }) => {
      onEvent({ type: 'content', text: 'Answer.' });
      return { assistantContent: 'Answer.', continuation: [], toolCalls: [] };
    },
  };
  const runner = new QuickChatRunner({
    registry: {
      listModels: () => [model],
      resolve: (id) => id === model.id ? { model, provider } : null,
    },
    chatRunner: {},
    getPreferences: () => ({
      defaultModels: { quickChat: { modelId: model.id, reasoningEffort: null } },
      tuning: { toolOutputLimit: 2048 },
    }),
    sendEvent: () => {},
  });

  const session = await runner.createQuestionSession({
    source: 'chat',
    workspacePath: profile,
    threadId: 'source-thread',
    attachments: [{ kind: 'context_marker', markerType: 'citation', name: 'Chat citation', text: '<citation>Selected</citation>' }],
  });
  assert.throws(() => runner.forkQuestion(session.id), /Ask a question before forking/);
  await runner.send({ sessionId: session.id, text: 'What does this mean?' });
  while (runner.state(session.id).running) await new Promise((resolve) => setTimeout(resolve, 1));

  const conversation = runner.forkQuestion(session.id);
  assert.equal(conversation.title, 'What does this mean?');
  assert.equal(conversation.projectPath, profile);
  assert.equal(conversation.model, model.id);
  const messages = database.getMessages(conversation.id);
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant']);
  assert.match(messages[0].attachments.map((attachment) => attachment.text).join('\n'), /thread-id="source-thread"/);
  assert.match(messages[0].attachments.map((attachment) => attachment.text).join('\n'), /<citation>Selected<\/citation>/);
  assert.equal(messages[1].content, 'Answer.');
  assert.throws(() => runner.state(session.id), /no longer available/);
  console.log('Quick question fork tests passed.');
} finally {
  database?.closeDatabase?.();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(0);
