import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const timestamp = `${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}-UTC`;
const suiteDir = join(tmpdir(), '.avi', 'visualizations', timestamp, 'composer-state-test');
mkdirSync(suiteDir, { recursive: true });
const testProfile = mkdtempSync(join(suiteDir, 'profile-'));
assert.ok(resolve(testProfile).startsWith(resolve(tmpdir())));
process.env.USERPROFILE = testProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const {
    closeDatabase,
    createConversation,
    forkConversation,
    getComposerState,
    getConversation,
    getMessage,
    getMessages,
    getPreferences,
    insertMessage,
    listRubberDucks,
    setComposerState,
  } = database;

  const defaultPermissionMode = getPreferences().tuning.defaultPermissionMode;
  let clock = Date.parse('2026-09-21T00:00:00.000Z');
  const nextCreatedAt = () => new Date(clock += 1000).toISOString();

  function newConversation(title) {
    return createConversation({
      title,
      titleStatus: 'generated',
      model: 'test:old-model',
      projectPath: process.cwd(),
    });
  }

  function addUser(conversationId, overrides = {}) {
    return insertMessage({
      conversationId,
      role: 'user',
      status: 'sent',
      content: 'hello',
      model: 'test:old-model',
      createdAt: nextCreatedAt(),
      ...overrides,
    });
  }

  // No state at all.
  {
    const conversation = newConversation('No composer state');
    assert.equal(getComposerState(conversation.id), null);
    assert.equal(getComposerState(conversation.id, { restoreLastMessage: true }), null);
  }

  // Draft only: saved state returned as-is with and without restore.
  {
    const conversation = newConversation('Draft only');
    setComposerState(conversation.id, {
      permissionMode: 'full_access',
      model: 'test:draft-model',
      reasoningEffort: 'high',
      workMode: 'plan',
      ultraMode: false,
      draftText: 'unsent draft',
      attachments: [{ name: 'a.txt' }],
    });
    for (const restoreLastMessage of [false, true]) {
      const state = getComposerState(conversation.id, { restoreLastMessage });
      assert.equal(state.model, 'test:draft-model');
      assert.equal(state.reasoningEffort, 'high');
      assert.equal(state.workMode, 'plan');
      assert.equal(state.ultraMode, false);
      assert.equal(state.draftText, 'unsent draft');
      assert.deepEqual(state.attachments, [{ name: 'a.txt' }]);
      assert.equal(state.permissionMode, 'full_access');
    }
  }

  // Stale draft vs newest message: message params win, draft is preserved.
  {
    const conversation = newConversation('Stale draft');
    setComposerState(conversation.id, {
      model: 'test:stale-model',
      reasoningEffort: 'low',
      draftText: 'keep me',
    });
    addUser(conversation.id, { model: 'test:old', reasoningEffort: 'low', content: 'first' });
    const newest = addUser(conversation.id, {
      model: 'test:new',
      reasoningEffort: 'high',
      workMode: 'goal',
      ultraMode: true,
      content: 'second',
    });
    const plain = getComposerState(conversation.id);
    assert.equal(plain.model, 'test:stale-model');
    const restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:new');
    assert.equal(restored.reasoningEffort, 'high');
    assert.equal(restored.workMode, 'goal');
    assert.equal(restored.ultraMode, true);
    assert.equal(restored.draftText, 'keep me');
    assert.equal(restored.updatedAt, getMessage(newest.id).updatedAt);
  }

  // A plain newest message clears previously saved model params.
  {
    const conversation = newConversation('Normal clears');
    setComposerState(conversation.id, {
      model: 'test:saved',
      reasoningEffort: 'high',
      workMode: 'plan',
      ultraMode: false,
    });
    addUser(conversation.id, { model: 'test:plain', reasoningEffort: null, content: 'plain' });
    const restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:plain');
    assert.equal(restored.reasoningEffort, null);
    assert.equal(restored.workMode, null);
    assert.equal(restored.ultraMode, false);
  }

  // Hidden, from-agent, and assistant messages are ignored.
  {
    const conversation = newConversation('Ignored overlays');
    const visible = addUser(conversation.id, { model: 'test:visible', content: 'visible' });
    void visible;
    addUser(conversation.id, { model: 'test:hidden', hidden: true, content: 'hidden' });
    addUser(conversation.id, { model: 'test:agent', fromAgent: true, content: 'agent' });
    insertMessage({
      conversationId: conversation.id,
      role: 'assistant',
      status: 'completed',
      content: 'assistant reply',
      model: 'test:assistant-model',
      createdAt: nextCreatedAt(),
    });
    const restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:visible');
  }

  // Queued, steered, and legacy completed/aborted messages count; cancelled does not.
  {
    const conversation = newConversation('Queue statuses');
    addUser(conversation.id, { model: 'test:sent', content: 'sent' });
    addUser(conversation.id, { model: 'test:queued', status: 'queued', content: 'queued' });
    let restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:queued');
    addUser(conversation.id, { model: 'test:steered', status: 'steered', content: 'steered' });
    restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:steered');
    addUser(conversation.id, { model: 'test:completed', status: 'completed', content: 'completed' });
    restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:completed');
    addUser(conversation.id, { model: 'test:aborted', status: 'aborted', content: 'aborted' });
    restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:aborted');
    addUser(conversation.id, { model: 'test:cancelled', status: 'cancelled', content: 'cancelled' });
    restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:aborted');
  }

  // Equal timestamps fall back to rowid order.
  {
    const conversation = newConversation('Timestamp tie');
    const tiedAt = nextCreatedAt();
    addUser(conversation.id, { model: 'test:first', content: 'first', createdAt: tiedAt });
    addUser(conversation.id, { model: 'test:second', content: 'second', createdAt: tiedAt });
    const restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:second');
  }

  // waiting_mcp counts; message-only state uses defaults for draft fields.
  {
    const conversation = newConversation('Message only');
    addUser(conversation.id, {
      model: 'test:waiting',
      status: 'waiting_mcp',
      reasoningEffort: 'medium',
      content: 'waiting',
    });
    const restored = getComposerState(conversation.id, { restoreLastMessage: true });
    assert.equal(restored.model, 'test:waiting');
    assert.equal(restored.reasoningEffort, 'medium');
    assert.equal(restored.permissionMode, defaultPermissionMode);
    assert.equal(restored.draftText, '');
    assert.deepEqual(restored.attachments, []);
  }

  // replaceUserMessage persists changed model / reasoning / plan / ultra.
  {
    const model = (id) => ({
      id,
      modelId: id,
      providerId: 'test',
      providerName: 'Test',
      interface: 'responses',
      capabilities: {},
      reasoning: [],
      context: { input: 100_000, output: 10_000 },
    });
    const provider = {
      stream: async () => {
        throw new Error('Test must not reach a real provider.');
      },
    };
    const runner = new ChatRunner({
      registry: {
        resolve: (modelId) => ({ model: model(modelId), provider }),
        listModels: () => [],
      },
      getPreferences: () => ({
        defaultModels: {},
        tuning: { continuationRepliesEnabled: false },
      }),
      sendEvent: () => {},
      sendCompletionNotification: () => {},
    });
    const startCalls = [];
    runner.prepareInitialPrompt = async () => {};
    runner.start = async (args) => {
      startCalls.push(args);
    };

    const planConversation = newConversation('Replace with plan');
    const planTarget = addUser(planConversation.id, { model: 'test:old-model', content: 'original' });
    const planResult = await runner.replaceUserMessage({
      conversationId: planConversation.id,
      messageId: planTarget.id,
      model: 'test:new-model',
      text: 'edited plan prompt',
      reasoningEffort: 'high',
      workMode: 'plan',
      ultraMode: false,
    });
    assert.equal(getMessage(planTarget.id), null);
    assert.equal(planResult.message.model, 'test:new-model');
    assert.equal(planResult.message.reasoningEffort, 'high');
    assert.equal(planResult.message.workMode, 'plan');
    assert.equal(planResult.message.ultraMode, false);
    assert.equal(planResult.message.content, 'edited plan prompt');
    assert.deepEqual(
      getMessages(planConversation.id).map((message) => message.id),
      [planResult.message.id],
    );
    assert.equal(getConversation(planConversation.id).orchestrationMode, 'plan');
    assert.equal(startCalls.length, 1);
    assert.equal(startCalls[0].model, 'test:new-model');
    assert.equal(startCalls[0].reasoningEffort, 'high');
    assert.equal(startCalls[0].workMode, 'plan');

    const ultraConversation = newConversation('Replace with ultra');
    const ultraTarget = addUser(ultraConversation.id, { model: 'test:old-model', content: 'original' });
    const ultraResult = await runner.replaceUserMessage({
      conversationId: ultraConversation.id,
      messageId: ultraTarget.id,
      model: 'test:ultra-model',
      text: 'edited ultra prompt',
      reasoningEffort: null,
      workMode: null,
      ultraMode: true,
    });
    assert.equal(ultraResult.message.model, 'test:ultra-model');
    assert.equal(ultraResult.message.workMode, null);
    assert.equal(ultraResult.message.ultraMode, true);
    assert.equal(getConversation(ultraConversation.id).orchestrationMode, 'ultra');

    await runner.shutdown();
  }

  // Rubber Duck fork keeps subject and child identities distinct.
  {
    const subject = newConversation('Rubber Duck subject');
    addUser(subject.id, { model: 'test:old-model', content: 'subject work' });
    const result = forkConversation(subject.id, {
      rubberDuck: true,
      rubberDuckContext: 'judge this',
    });
    assert.ok(result);
    const rubberDuck = getConversation(result.conversation.id);
    assert.notEqual(rubberDuck.id, subject.id);
    assert.equal(rubberDuck.isRubberDuck, true);
    assert.equal(rubberDuck.parentConversationId, subject.id);
    assert.deepEqual(listRubberDucks(subject.id).map((entry) => entry.id), [rubberDuck.id]);
    const reloadedSubject = getConversation(subject.id);
    assert.equal(reloadedSubject.id, subject.id);
    assert.equal(reloadedSubject.isRubberDuck, false);
    assert.equal(reloadedSubject.conversationType, 'thread');
  }

  console.log('Composer state regression tests passed.');
  closeDatabase();
} finally {
  try {
    database?.closeDatabase();
  } catch {
  }
  rmSync(testProfile, { recursive: true, force: true });
}
process.exit(0);
