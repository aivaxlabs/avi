import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-side-chat-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const {
    createConversation,
    deleteConversation,
    forkConversation,
    getConversation,
    getMessages,
    insertMessage,
    listConversations,
    listSideChats,
    toModelMessages,
    toModelMessagesThroughUser,
    updateConversation,
  } = database;

  const parent = createConversation({ model: 'test/model', projectPath: process.cwd() });
  const user = insertMessage({
    conversationId: parent.id,
    role: 'user',
    status: 'sent',
    content: 'Parent context',
  });
  insertMessage({
    conversationId: parent.id,
    role: 'assistant',
    status: 'completed',
    content: 'Parent answer',
  });
  updateConversation(parent.id, {
    contextCheckpoint: 'Checkpoint snapshot',
    checkpointMessageId: user.id,
    contextTokens: 321,
  });

  const first = forkConversation(parent.id, { sideChat: true });
  const second = forkConversation(parent.id, { sideChat: true });
  assert.equal(first.conversation.isSideChat, true);
  assert.equal(first.conversation.parentConversationId, parent.id);
  assert.equal(first.conversation.contextCheckpoint, 'Checkpoint snapshot');
  assert.equal(first.conversation.contextTokens, 321);
  const firstMessages = getMessages(first.conversation.id);
  assert.equal(firstMessages.length, 2);
  const sideChatModelMessages = toModelMessages(first.conversation.id);
  assert.equal(sideChatModelMessages[0].role, 'system');
  assert.ok(sideChatModelMessages[0].content.includes('thread_type: side_chat'));
  assert.ok(sideChatModelMessages[0].content.includes(`thread_id: ${first.conversation.id}`));
  assert.ok(sideChatModelMessages[0].content.includes(`parent_thread_id: ${parent.id}`));
  const retryModelMessages = toModelMessagesThroughUser(
    first.conversation.id,
    firstMessages[1].id,
  );
  assert.equal(retryModelMessages[0].content, sideChatModelMessages[0].content);
  assert.equal(
    toModelMessages(parent.id).some((message) => (
      message.role === 'system' && message.content.includes('thread_type: side_chat')
    )),
    false,
  );
  assert.deepEqual(
    listSideChats(parent.id).map((sideChat) => sideChat.title),
    ['Side chat 1', 'Side chat 2'],
  );
  assert.equal(listConversations().length, 1);
  assert.equal(forkConversation(first.conversation.id, { sideChat: true }), null);

  deleteConversation(first.conversation.id, { hard: true });
  assert.equal(getConversation(first.conversation.id), null);
  assert.equal(listSideChats(parent.id).length, 1);
  const third = forkConversation(parent.id, { sideChat: true });
  assert.equal(third.conversation.title, 'Side chat 3');
  deleteConversation(parent.id);
  assert.equal(getConversation(second.conversation.id), null);
  assert.equal(getConversation(third.conversation.id), null);
  console.log('Side-chat database flow passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
