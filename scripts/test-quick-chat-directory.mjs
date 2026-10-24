import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-quick-chat-directory-'));
const directory = mkdtempSync(join(tmpdir(), 'aivax-quick-chat-folder-'));
assert.ok(resolve(testProfile).startsWith(resolve(tmpdir())));
process.env.USERPROFILE = testProfile;

const {
  createConversation,
  closeDatabase,
  deleteQuickChats,
  getConversation,
  insertMessage,
  listConversations,
  promoteQuickChat,
} = await import('../src/main/database.js');
const { setDirectoryTool } = await import('../src/main/tools/quick-chat.js');
const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');

assert.equal(CLIENT_TOOLS.some((tool) => tool.name === 'set_directory'), false);

const quick = createConversation({
  title: 'Quick chat',
  model: 'test-model',
  conversationType: 'quick',
});
assert.equal(quick.isQuickChat, true);
assert.equal(listConversations().some((item) => item.id === quick.id), false);

let emitted = null;
const output = await setDirectoryTool.execute({ path: directory }, {
  conversationId: quick.id,
  chatRunner: {
    emitConversation(id) {
      emitted = id;
    },
  },
});
assert.equal(emitted, quick.id);
assert.match(output.output, /Quick chat directory is now/);
assert.equal(getConversation(quick.id).projectPath, resolve(directory));

const thread = createConversation({ title: 'Thread', model: 'test-model' });
await assert.rejects(
  () => setDirectoryTool.execute({ path: directory }, { conversationId: thread.id }),
  /only available in Quick chat/,
);

insertMessage({
  id: 'quick-user',
  conversationId: quick.id,
  role: 'user',
  model: 'test-model',
  content: 'Hello',
  attachments: [],
  segments: [],
  edits: [],
  status: 'sent',
  hidden: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  usage: null,
});
const promoted = promoteQuickChat(quick.id);
assert.equal(promoted.isQuickChat, false);
assert.equal(promoted.conversationType, 'thread');
assert.equal(promoteQuickChat(quick.id), null);
assert.equal(listConversations().some((item) => item.id === quick.id), true);

const disposable = createConversation({
  title: 'Disposable',
  model: 'test-model',
  conversationType: 'quick',
});
assert.equal(deleteQuickChats(), 1);
assert.equal(getConversation(disposable.id), null);
assert.ok(getConversation(quick.id));

closeDatabase();
rmSync(directory, { recursive: true, force: true });
rmSync(testProfile, { recursive: true, force: true });
console.log('Quick chat directory tests passed.');
process.exit(0);
