import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from 'electron';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-rubber-duck-test-'));
process.env.USERPROFILE = resolve(testProfile);

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const {
    closeDatabase,
    createConversation,
    forkConversation,
    getConversation,
    getMessages,
    getPreferences,
    insertMessage,
    listRubberDucks,
    setTuningSettings,
    toModelMessages,
  } = database;

  assert.equal(getPreferences().tuning.rubberDuckMaxTurns, 20);
  assert.equal(setTuningSettings({
    ...getPreferences().tuning,
    rubberDuckMaxTurns: 500,
  }).rubberDuckMaxTurns, 500);
  for (const rubberDuckMaxTurns of [9, 501, 20.5]) {
    assert.throws(() => setTuningSettings({
      ...getPreferences().tuning,
      rubberDuckMaxTurns,
    }), /outside their allowed range/);
  }

  const subject = createConversation({
    model: 'subject:model',
    projectPath: process.cwd(),
  });
  insertMessage({
    conversationId: subject.id,
    role: 'user',
    status: 'sent',
    content: 'Implement the requested feature.',
  });
  insertMessage({
    conversationId: subject.id,
    role: 'assistant',
    model: 'subject:model',
    status: 'completed',
    content: 'Implemented and tested the feature.',
  });
  const first = forkConversation(subject.id, {
    rubberDuck: true,
    rubberDuckContext: 'Judge the validation evidence.',
  });
  const second = forkConversation(subject.id, { rubberDuck: true });
  assert.equal(first.conversation.isRubberDuck, true);
  assert.equal(first.conversation.initialPrompt, 'Judge the validation evidence.');
  assert.equal(second.conversation.title, 'Rubber Duck 2');
  assert.deepEqual(listRubberDucks(subject.id).map(({ title }) => title), [
    'Rubber Duck 1',
    'Rubber Duck 2',
  ]);
  assert.equal(getMessages(first.conversation.id).at(-1).content, '<rubber-duck-source-end />');
  assert.match(toModelMessages(first.conversation.id)[0].content, /thread_type: rubber_duck/);
  const nested = forkConversation(first.conversation.id, {
    rubberDuck: true,
    rubberDuckContext: 'Judge the first judgment.',
  });
  assert.equal(nested.conversation.parentConversationId, first.conversation.id);
  assert.equal(listRubberDucks(subject.id).length, 3);

  const subjectCalls = [];
  const subjectModel = {
    id: 'subject:model',
    modelId: 'subject-model',
    providerId: 'test',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    capabilities: {},
    context: { input: null, output: null },
  };
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({
        model: subjectModel,
        provider: {
          stream: async (request) => {
            subjectCalls.push(request);
            return {
              assistantContent: 'I chose this approach because it matched the existing pattern.',
              continuation: [],
              toolCalls: [],
            };
          },
        },
      }),
      listModels: () => [subjectModel],
    },
    sendEvent: () => {},
  });
  const answer = await runner.askRubberDuckSubject({
    conversationId: first.conversation.id,
    question: 'Why did you choose this approach?',
    signal: new AbortController().signal,
  });
  assert.match(answer, /existing pattern/);
  assert.deepEqual(subjectCalls[0].tools, []);
  assert.deepEqual(subjectCalls[0].toolHistory, []);
  assert.equal(subjectCalls[0].messages.at(-1).content, 'Why did you choose this approach?');

  runner.runs.set(first.conversation.id, {});
  assert.equal(runner.submitRubberDuckReport({
    conversationId: first.conversation.id,
    report: 'The implementation is sound, but validation evidence is incomplete.',
  }), 'Rubber Duck report submitted. End the judgment now.');
  assert.equal(runner.runs.get(first.conversation.id).endAfterTools, true);

  const invokeTool = CLIENT_TOOLS.find(({ name }) => name === 'invoke_rubber_duck');
  const askTool = CLIENT_TOOLS.find(({ name }) => name === 'rubber_duck_ask_agent');
  const reportTool = CLIENT_TOOLS.find(({ name }) => name === 'rubber_duck_submit_report');
  assert.equal(invokeTool.canEditFile, false);
  assert.equal(invokeTool.canPerformDestructiveActions, false);
  assert.equal(askTool.approval, 'never');
  assert.equal(reportTool.approval, 'never');
  const envelope = await invokeTool.execute({ context: null }, {
    chatRunner: {
      startRubberDuck: async () => ({
        rubberDuck: getConversation(first.conversation.id),
        report: 'Focused report.',
      }),
    },
    conversationId: subject.id,
    permissionMode: 'approve_for_me',
    signal: new AbortController().signal,
  });
  assert.match(envelope, /<rubber_duck_report[^>]+action="present_only">/);
  assert.match(envelope, /Do not implement, edit, retry/);
  assert.match(envelope, /Focused report/);

  const missingModelRunner = new ChatRunner({
    registry: { resolve: () => null, listModels: () => [] },
    getPreferences: () => ({
      ...getPreferences(),
      defaultModels: { ...getPreferences().defaultModels, supervision: null },
    }),
    sendEvent: () => {},
  });
  await assert.rejects(() => missingModelRunner.startRubberDuck({
    conversationId: subject.id,
  }), /Configure a Supervision Model/);

  closeDatabase();
  database = null;
  console.log('Rubber Duck tests passed.');
} finally {
  if (database) database.closeDatabase();
  rmSync(testProfile, { recursive: true, force: true });
  app.exit(0);
}
