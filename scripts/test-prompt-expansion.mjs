import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-prompt-expansion-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const {
    closeDatabase,
    createConversation,
    getConversation,
    getMessages,
    insertMessage,
    listInferenceUsage,
  } = database;

  const auxiliaryModel = {
    id: 'test:auxiliary',
    modelId: 'auxiliary-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: ['high'],
    capabilities: {},
    context: { input: 100_000, output: 10_000 },
  };
  const calls = [];
  const responses = [
    JSON.stringify({ replacements: { '%tecnologia%': 'test doubles determinísticos' } }),
    JSON.stringify({ expandedPrompt: 'Validate the existing tests and describe the observed results.' }),
  ];
  const runner = new ChatRunner({
    registry: {
      resolve: (modelId) => modelId === auxiliaryModel.id
        ? {
            model: auxiliaryModel,
            provider: {
              stream: async (request) => {
                calls.push(request);
                request.onEvent({
                  type: 'usage',
                  usage: { inputTokens: calls.length, outputTokens: calls.length + 1 },
                });
                return {
                  assistantContent: responses[calls.length - 1],
                  toolCalls: [],
                };
              },
            },
          }
        : null,
      listModels: () => [auxiliaryModel],
    },
    getPreferences: () => ({
      defaultModels: {
        auxiliary: { modelId: auxiliaryModel.id, reasoningEffort: 'high' },
      },
      tuning: {},
    }),
    sendEvent: () => {},
  });
  const conversation = createConversation({
    model: auxiliaryModel.id,
    projectPath: process.cwd(),
  });

  for (let index = 0; index < 9; index += 1) {
    insertMessage({
      conversationId: conversation.id,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 0 ? 'This old message must be excluded.' : `Recent context ${index}`,
    });
  }
  insertMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Hidden internal instruction.',
    hidden: true,
  });
  insertMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Queued instruction.',
    status: 'queued',
  });

  const messagesBefore = getMessages(conversation.id);
  const conversationBefore = getConversation(conversation.id);
  const sourcePrompt = '  Valide testes usando %tecnologia% como mecanismo  ';
  const placeholderResult = await runner.expandPrompt({
    conversationId: conversation.id,
    prompt: sourcePrompt,
  });

  assert.equal(
    placeholderResult,
    '  Valide testes usando test doubles determinísticos como mecanismo  ',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model.id, auxiliaryModel.id);
  assert.equal(calls[0].reasoningEffort, 'high');
  assert.deepEqual(calls[0].invocationContext, { auxiliary: true });
  assert.deepEqual(calls[0].tools, []);
  assert.deepEqual(calls[0].toolHistory, []);
  assert.equal(calls[0].messages.length, 10);
  assert.equal(calls[0].messages.at(-1).content, sourcePrompt);
  assert.ok(!calls[0].messages.some((message) => (
    String(message.content).includes('This old message must be excluded.')
    || String(message.content).includes('Hidden internal instruction.')
    || String(message.content).includes('Queued instruction.')
  )));
  assert.match(calls[0].messages[0].content, /%tecnologia%/);
  assert.match(calls[0].messages[0].content, /Do not rewrite any text outside them/);

  const fullResult = await runner.expandPrompt({
    conversationId: conversation.id,
    prompt: 'Valide os testes.',
  });
  assert.equal(
    fullResult,
    'Validate the existing tests and describe the observed results.',
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages.at(-1).content, 'Valide os testes.');
  assert.match(calls[1].messages[0].content, /full prompt/);
  assert.match(calls[1].messages[0].content, /Translate the expanded prompt to English/);
  assert.match(calls[1].messages[0].content, /Preserve the user[’']s intent, tone, and established requirements/);
  assert.doesNotMatch(calls[1].messages[0].content, /Preserve the user[’']s intent, language, tone/);
  assert.deepEqual(getMessages(conversation.id), messagesBefore);
  assert.deepEqual(getConversation(conversation.id), conversationBefore);
  assert.deepEqual(
    listInferenceUsage('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
      .map(({ type, model, projectPath, usage }) => ({ type, model, projectPath, usage })),
    [
      {
        type: 'auxiliary',
        model: auxiliaryModel.id,
        projectPath: resolve(process.cwd()),
        usage: { inputTokens: 1, outputTokens: 2 },
      },
      {
        type: 'auxiliary',
        model: auxiliaryModel.id,
        projectPath: resolve(process.cwd()),
        usage: { inputTokens: 2, outputTokens: 3 },
      },
    ],
  );

  await assert.rejects(
    runner.expandPrompt({ conversationId: conversation.id, prompt: '   ' }),
    /Write a prompt before expanding it/,
  );
  await assert.rejects(
    runner.expandPrompt({ conversationId: 'missing', prompt: 'Expand this.' }),
    /Conversation not found/,
  );

  closeDatabase();
  database = null;
  console.log('Prompt expansion tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
