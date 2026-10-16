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
  let streamedMessages = null;
  const provider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ messages, onEvent }) => {
      streamedMessages = messages;
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
      tuning: { toolOutputLimit: 2048, automaticCompactionThreshold: 0.9 },
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

  const source = database.createConversation({ title: 'Source', model: model.id, projectPath: profile });
  const sourceAt = Date.now() - 10_000;
  const [firstUser, selected, laterUser] = ['First request', 'Selected answer', 'Later request']
    .map((content, index) => database.insertMessage({
      conversationId: source.id,
      role: index === 1 ? 'assistant' : 'user',
      status: index === 1 ? 'completed' : 'sent',
      content,
      createdAt: new Date(sourceAt + index).toISOString(),
    }));
  assert.ok(firstUser && laterUser);
  const historySession = await runner.createQuestionSession({
    source: 'chat',
    workspacePath: profile,
    threadId: source.id,
    messageId: selected.id,
    attachments: [{ kind: 'context_marker', markerType: 'citation', name: 'Chat citation', text: '<citation>Selected</citation>' }],
  });
  await runner.send({ sessionId: historySession.id, text: 'Why?' });
  while (runner.state(historySession.id).running) await new Promise((resolve) => setTimeout(resolve, 1));
  const streamedPrompt = JSON.stringify(streamedMessages);
  assert.deepEqual(streamedMessages.slice(0, 2).map((message) => message.content), ['First request', 'Selected answer']);
  assert.ok(!streamedPrompt.includes('Later request'));
  assert.match(streamedPrompt, /message-id=\\"/);
  assert.match(streamedPrompt, /This is a Quick question/);

  const historyFork = runner.forkQuestion(historySession.id);
  assert.equal(historyFork.title, 'Why?');
  assert.deepEqual(
    database.getMessages(historyFork.id).map((message) => message.content),
    ['First request', 'Selected answer', 'Why?', 'Answer.'],
  );
  assert.equal(database.getMessages(source.id).length, 3);

  const large = database.createConversation({ title: 'Large', model: model.id, projectPath: profile });
  const largeAt = Date.now() - 5_000;
  const largeMessages = [
    { role: 'user', status: 'sent', content: 'Read the file' },
    {
      role: 'assistant',
      status: 'completed',
      content: 'Done.',
      segments: [{
        type: 'tool-call',
        key: 'round:0:old',
        callId: 'old',
        name: 'read_file',
        argumentsText: '{}',
        resultText: 'OLD_TOOL_RESULT '.repeat(2_000),
      }, { type: 'content', text: 'Done.' }],
    },
    ...['Two', 'Three', 'Four', 'Five'].flatMap((turn) => [
      { role: 'user', status: 'sent', content: turn },
      { role: 'assistant', status: 'completed', content: `${turn} answer` },
    ]),
  ].map((message, index) => database.insertMessage({
    ...message,
    conversationId: large.id,
    createdAt: new Date(largeAt + index).toISOString(),
  }));
  const compressedSession = await runner.createQuestionSession({
    source: 'chat',
    workspacePath: profile,
    threadId: large.id,
    messageId: largeMessages.at(-1).id,
    attachments: [{ kind: 'context_marker', markerType: 'citation', name: 'Chat citation', text: '<citation>Five answer</citation>' }],
  });
  await runner.send({ sessionId: compressedSession.id, text: 'Why five?' });
  while (runner.state(compressedSession.id).running) await new Promise((resolve) => setTimeout(resolve, 1));
  const compressedPrompt = JSON.stringify(streamedMessages);
  assert.ok(!compressedPrompt.includes('OLD_TOOL_RESULT'));
  assert.match(compressedPrompt, /output truncated due to context compress/);
  assert.ok(JSON.stringify(database.getMessages(large.id)).includes('OLD_TOOL_RESULT'));
  runner.close(compressedSession.id);
  console.log('Quick question fork tests passed.');
} finally {
  database?.closeDatabase?.();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(0);
