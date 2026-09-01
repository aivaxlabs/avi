import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-thread-loading-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

const runtimeSource = readFileSync(new URL('../src/main/runtime.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
const chatViewSource = readFileSync(
  new URL('../src/renderer/components/ChatView.jsx', import.meta.url),
  'utf8',
);
const composerSource = readFileSync(
  new URL('../src/renderer/components/Composer.jsx', import.meta.url),
  'utf8',
);

const handlerBody = (name) => {
  const start = runtimeSource.indexOf(`applicationIpc.handle('${name}'`);
  assert.notEqual(start, -1, `${name} handler should exist.`);
  const end = runtimeSource.indexOf('\n  applicationIpc.handle(', start + 1);
  return runtimeSource.slice(start, end === -1 ? runtimeSource.length : end);
};

for (const name of ['side-chats:list', 'subagents:list', 'rubber-ducks:list']) {
  assert.doesNotMatch(
    handlerBody(name),
    /refreshConversationProject|inspectProjectFolder/,
    `${name} should return persisted metadata without inspecting Git.`,
  );
}
assert.doesNotMatch(
  handlerBody('conversations:context'),
  /list(?:SideChats|Subagents|RubberDucks)\(conversationId\)\.map\(refreshConversationProject\)/,
  'Conversation context should not inspect Git for child-thread lists.',
);
assert.match(
  runtimeSource,
  /async function inspectProjectFolder[\s\S]*?await execFileAsync\([\s\S]*?'git'/,
  'Main-thread Git branch inspection should be asynchronous.',
);
assert.match(
  runtimeSource,
  /const archiveState = async[\s\S]*?await Promise\.all\([\s\S]*?\.map\(refreshConversationProject\)\)/,
  'Archive project inspection should resolve asynchronous metadata before returning rows.',
);
assert.doesNotMatch(
  appSource,
  /childThread\.id, await api\.conversations\.messages/,
  'Selecting a parent should not hydrate every child history.',
);
assert.match(
  appSource,
  /api\.conversations\.messages\(\{\s*conversationId,\s*limit: MESSAGE_PAGE_SIZE,\s*cursor,/,
  'Desktop message history should use the bounded page request.',
);
assert.match(
  appSource,
  /cursor && \/cursor is no longer available\/i[\s\S]*?deleteMessageCache\(\[conversationId\]\)[\s\S]*?loadMessagePage\(conversationId\)/,
  'A removed pagination anchor should restart from the newest page.',
);
assert.match(
  appSource,
  /const deleteMessageCache[\s\S]*?setMessagesByConversation[\s\S]*?setMessagePagesByConversation/,
  'Thread invalidation should clear both message and pagination caches.',
);
assert.match(
  appSource,
  /const auxiliaryOnSelectSubagent = useStableCallback\(async \(id\)[\s\S]*?loadInitialMessagePage\(id\)/,
  'Subagents and Rubber Ducks should load only when explicitly opened.',
);
assert.match(
  appSource,
  /const auxiliaryOnSelectTab = useStableCallback\(async \(tabId\)[\s\S]*?loadInitialMessagePage\(tabId\)/,
  'Side chats should load only when explicitly opened.',
);
assert.match(
  chatViewSource,
  /historyHasMore[\s\S]*?onLoadOlderHistory[\s\S]*?void onLoadOlderHistory\(\)/,
  'ChatView should request the previous persisted page after exhausting loaded history.',
);
assert.match(
  chatViewSource,
  /onWheel=\{handleChatWheel\}/,
  'Upward wheel input should participate in lazy history loading.',
);
assert.match(
  composerSource,
  /showProject = true[\s\S]*?\{showProject && <div className="project-picker-holder"/,
  'Auxiliary composers should be able to hide workspace and Git metadata.',
);
assert.match(
  chatViewSource,
  /showProject=\{!compact\}/,
  'Compact auxiliary chats should hide workspace and Git metadata.',
);

let database;
try {
  database = await import('../src/main/database.js');
  const {
    createConversation,
    getMessagePage,
    insertMessage,
  } = database;
  const conversation = createConversation({
    model: 'test/model',
    projectPath: resolvedProfile,
  });
  const messageIds = [];
  for (let index = 1; index <= 5; index += 1) {
    const message = insertMessage({
      conversationId: conversation.id,
      role: index % 2 === 0 ? 'assistant' : 'user',
      status: 'completed',
      content: `Message ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });
    messageIds.push(message.id);
  }

  const newest = getMessagePage(conversation.id, { limit: 2 });
  assert.deepEqual(newest.messages.map((message) => message.id), messageIds.slice(3));
  assert.equal(newest.hasMore, true);
  assert.equal(newest.beforeMessageId, messageIds[3]);

  const middle = getMessagePage(conversation.id, {
    beforeMessageId: newest.beforeMessageId,
    limit: 2,
  });
  assert.deepEqual(middle.messages.map((message) => message.id), messageIds.slice(1, 3));
  assert.equal(middle.hasMore, true);
  assert.equal(middle.beforeMessageId, messageIds[1]);

  const oldest = getMessagePage(conversation.id, {
    beforeMessageId: middle.beforeMessageId,
    limit: 2,
  });
  assert.deepEqual(oldest.messages.map((message) => message.id), messageIds.slice(0, 1));
  assert.equal(oldest.hasMore, false);
  assert.equal(oldest.beforeMessageId, null);
  assert.throws(
    () => getMessagePage(conversation.id, { beforeMessageId: 'missing', limit: 2 }),
    /Message cursor is no longer available/,
  );

  console.log('Thread loading and pagination tests passed.');
} finally {
  database?.closeDatabase?.();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
