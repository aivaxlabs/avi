import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(tmpdir(), '.avi', 'visualizations', '2026-09-05-13-40-BRT', 'fork-checkpoints');
mkdirSync(root, { recursive: true });
const profile = mkdtempSync(join(root, 'profile-'));
process.env.USERPROFILE = profile;
let database;
try {
  database = await import('../src/main/database.js');
  const { createConversation, insertMessage, updateConversation, forkConversation, getMessages, toModelMessages, toModelMessagesThroughUser } = database;
  for (const hidden of [false, true]) {
    for (const summary of ['', 'COMPACTED_HISTORY']) {
      const parent = createConversation({ title: 'Checkpoint source' });
      const old = insertMessage({ conversationId: parent.id, role: 'user', status: 'sent', content: 'OLD_HISTORY', createdAt: '2026-01-01T00:00:00.000Z' });
      const boundary = insertMessage({ conversationId: parent.id, role: 'user', status: 'sent', content: 'BOUNDARY', hidden, createdAt: '2026-01-01T00:00:01.000Z' });
      insertMessage({ conversationId: parent.id, role: 'user', status: 'sent', content: 'UNRELATED_HIDDEN', hidden: true, createdAt: '2026-01-01T00:00:02.000Z' });
      const recent = insertMessage({ conversationId: parent.id, role: 'user', status: 'sent', content: 'RECENT_HISTORY', createdAt: '2026-01-01T00:00:03.000Z' });
      updateConversation(parent.id, { contextCheckpoint: summary, checkpointMessageId: boundary.id, contextTokens: 123 });
      for (const options of [{}, { sideChat: true }, { rubberDuck: true }, { throughMessageId: recent.id }, { throughMessageId: boundary.id }]) {
        const { conversation } = forkConversation(parent.id, options);
        assert.ok(conversation.checkpointMessageId, JSON.stringify({ hidden, summary, options }));
        assert.notEqual(conversation.checkpointMessageId, boundary.id);
        assert.equal(conversation.contextCheckpoint, summary);
        assert.equal(conversation.contextTokens, 123);
        const copiedBoundary = getMessages(conversation.id).find((message) => message.id === conversation.checkpointMessageId);
        assert.equal(copiedBoundary.hidden, hidden);
        assert.ok(!getMessages(conversation.id).some((message) => message.content === 'UNRELATED_HIDDEN'));
        const prompt = insertMessage({ conversationId: conversation.id, role: 'user', status: 'sent', content: 'NEW_PROMPT' });
        for (const messages of [toModelMessages(conversation.id), toModelMessagesThroughUser(conversation.id, null)]) {
          const serialized = JSON.stringify(messages);
          assert.ok(!serialized.includes('OLD_HISTORY'));
          assert.ok(!serialized.includes('BOUNDARY'));
          assert.equal(serialized.includes('COMPACTED_HISTORY'), Boolean(summary));
          assert.ok(serialized.includes(prompt.content));
        }
      }
      const earlier = forkConversation(parent.id, { throughMessageId: old.id }).conversation;
      assert.equal(earlier.checkpointMessageId, null);
      assert.equal(earlier.contextCheckpoint, '');
      assert.equal(earlier.contextTokens, 0);
      assert.ok(JSON.stringify(toModelMessages(earlier.id)).includes('OLD_HISTORY'));
      const child = forkConversation(parent.id, { subagent: true, subagentPrompt: 'Focused task' }).conversation;
      assert.equal(child.checkpointMessageId, null);
      assert.equal(child.contextCheckpoint, '');
      assert.equal(child.contextTokens, 0);
      assert.ok(!JSON.stringify(toModelMessages(child.id)).includes('OLD_HISTORY'));
      assert.ok(!JSON.stringify(toModelMessages(parent.id)).includes('OLD_HISTORY'));
    }
  }
  const { PluginRuntime } = await import('../src/main/plugin-runtime.js');
  const { createPluginDomainApi } = await import('../src/main/plugin-domain-api.js');
  const runtime = new PluginRuntime({
    pluginsDir: join(profile, 'plugins'),
    services: {
      createDomainApi: createPluginDomainApi,
      chatRunner: { isConversationBlocked: () => false, semaphores: { holdings: () => [] } },
    },
  });
  try {
    const avi = await runtime.activate({ id: 'fork-test', capabilities: ['threads.read', 'threads.create'] });
    const source = await avi.threads.create({ title: 'Core fork source' });
    const streaming = insertMessage({ conversationId: source.id, role: 'assistant', status: 'streaming', content: 'PARTIAL_RESPONSE' });
    for (const options of [{}, { sideChat: true }, { throughMessageId: streaming.id }]) {
      const forked = forkConversation(source.id, options);
      assert.equal(forked.messages.find((message) => message.content === streaming.content).status, 'completed');
      assert.ok(JSON.stringify(toModelMessages(forked.conversation.id)).includes(streaming.content));
    }
    const copied = await source.fork();
    assert.equal(getMessages(copied.id).find((message) => message.content === streaming.content).status, 'completed');
    assert.equal(getMessages(source.id).find((message) => message.id === streaming.id).status, 'streaming');
    assert.ok(copied.id);
    assert.notEqual(copied.id, source.id);
    assert.equal((await copied.getSnapshot()).id, copied.id);
  } finally {
    await runtime.deactivate('fork-test', 'test-complete');
  }
  console.log('Fork checkpoint regression matrix and Core fork handle passed.');
} finally {
  database?.closeDatabase();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(0);
