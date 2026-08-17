import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-archive-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const {
    archiveConversation,
    countArchivedConversations,
    createConversation,
    deleteConversation,
    forkConversation,
    getArchiveSettings,
    getArchiveStats,
    getAivaxSettings,
    getConversation,
    getThreadSearchManifest,
    insertInferenceUsage,
    insertMessage,
    listArchivedConversations,
    listConversations,
    listInferenceUsage,
    listSideChats,
    listSubagents,
    restoreConversation,
    runArchiveMaintenance,
    searchChats,
    setAivaxSettings,
    setArchiveSettings,
    setThreadSearchManifest,
  } = database;

  assert.deepEqual(getArchiveSettings(), {
    archiveAfterDays: 7,
    deleteArchivedAfterDays: 30,
    deleteDisposableAfterDays: 1,
  });
  assert.deepEqual(getAivaxSettings(), {
    memoryEnabled: false,
    memoryCollectionId: null,
    memoryCollectionName: null,
    advancedFetchEnabled: false,
    webSearchEnabled: false,
    mediaDescriptionsEnabled: false,
    threadSearchCollectionId: null,
    threadSearchCollectionName: null,
  });
  assert.deepEqual(setAivaxSettings({
    ...getAivaxSettings(),
    threadSearchCollectionId: 'search-collection',
    threadSearchCollectionName: 'Thread search',
  }), {
    ...getAivaxSettings(),
    threadSearchCollectionId: 'search-collection',
    threadSearchCollectionName: 'Thread search',
  });
  assert.throws(() => setAivaxSettings({
    ...getAivaxSettings(),
    memoryCollectionId: 'search-collection',
  }), /AIVAX feature settings are invalid/);
  assert.deepEqual(setThreadSearchManifest('search-collection', { document: 'hash' }), { document: 'hash' });
  assert.deepEqual(getThreadSearchManifest('search-collection'), { document: 'hash' });
  assert.throws(() => setArchiveSettings({
    archiveAfterDays: 8,
    deleteArchivedAfterDays: 30,
    deleteDisposableAfterDays: 1,
  }), /Archive settings are invalid/);

  const usageCreatedAt = '2026-08-04T10:00:00.000Z';
  insertInferenceUsage({
    type: 'auxiliary',
    model: 'test/auxiliary',
    projectPath: process.cwd(),
    usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    createdAt: usageCreatedAt,
  });
  assert.deepEqual(
    listInferenceUsage('2026-08-04T09:00:00.000Z', '2026-08-04T11:00:00.000Z')
      .map(({ id, ...usage }) => usage),
    [{
      type: 'auxiliary',
      model: 'test/auxiliary',
      projectPath: resolve(process.cwd()),
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      createdAt: usageCreatedAt,
    }],
  );
  assert.deepEqual(
    listInferenceUsage('2026-08-04T11:00:00.000Z', '2026-08-04T12:00:00.000Z'),
    [],
  );

  const parent = createConversation({ model: 'test/model', projectPath: process.cwd() });
  insertMessage({
    conversationId: parent.id,
    role: 'user',
    status: 'sent',
    content: 'Archive fixture searchable text',
  });
  const sideChat = forkConversation(parent.id, { sideChat: true }).conversation;
  const subagent = forkConversation(parent.id, {
    subagent: true,
    initialPrompt: 'Inspect the archive fixture.',
  }).conversation;

  assert.equal(archiveConversation(parent.id), true);
  assert.equal(archiveConversation(parent.id), false);
  assert.equal(getConversation(parent.id), null);
  assert.equal(listConversations().length, 0);
  assert.equal(listSideChats(parent.id).length, 0);
  assert.equal(listSubagents(parent.id).length, 0);
  assert.equal(searchChats('searchable text').length, 0);
  assert.equal(countArchivedConversations(), 1);
  assert.equal(countArchivedConversations('fixture'), 1);
  assert.equal(countArchivedConversations('missing'), 0);
  assert.deepEqual(listArchivedConversations('fixture', { limit: 1, offset: 0 }).map((item) => item.id), [parent.id]);
  assert.deepEqual(listArchivedConversations('fixture', { limit: 1, offset: 1 }), []);
  assert.deepEqual(getArchiveStats(), {
    total: 3,
    active: 0,
    archived: 3,
    diskBytes: getArchiveStats().diskBytes,
  });
  assert.ok(getArchiveStats().diskBytes > 0);

  assert.equal(restoreConversation(parent.id), true);
  assert.equal(restoreConversation(parent.id), false);
  assert.equal(getConversation(parent.id).id, parent.id);
  assert.equal(listSideChats(parent.id)[0].id, sideChat.id);
  assert.equal(listSubagents(parent.id)[0].id, subagent.id);
  assert.equal(searchChats('searchable text')[0].conversationId, parent.id);

  const sqlite = new DatabaseSync(join(resolvedProfile, '.aivax', 'aivax.sqlite'));
  const now = new Date('2026-08-04T12:00:00.000Z');
  sqlite.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
    .run(new Date(now.getTime() - 31 * 86_400_000).toISOString(), parent.id);
  setArchiveSettings({
    archiveAfterDays: 30,
    deleteArchivedAfterDays: 60,
    deleteDisposableAfterDays: null,
  });
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 3,
    deletedArchived: 0,
    deletedDisposable: 0,
  });
  assert.equal(listArchivedConversations()[0].id, parent.id);

  sqlite.prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
    .run(new Date(now.getTime() - 61 * 86_400_000).toISOString(), parent.id);
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 0,
    deletedArchived: 1,
    deletedDisposable: 0,
  });
  assert.equal(listArchivedConversations().length, 0);

  const disposableParent = createConversation({ model: 'test/model', projectPath: process.cwd() });
  insertMessage({
    conversationId: disposableParent.id,
    role: 'user',
    status: 'sent',
    content: 'Disposable parent',
  });
  const disposableSide = forkConversation(disposableParent.id, { sideChat: true }).conversation;
  const disposableSubagent = forkConversation(disposableParent.id, {
    subagent: true,
    initialPrompt: 'Disposable sub-agent',
  }).conversation;
  sqlite.prepare(`
    UPDATE conversations SET updated_at = ? WHERE id IN (?, ?)
  `).run(
    new Date(now.getTime() - 2 * 86_400_000).toISOString(),
    disposableSide.id,
    disposableSubagent.id,
  );
  setArchiveSettings({
    archiveAfterDays: null,
    deleteArchivedAfterDays: null,
    deleteDisposableAfterDays: 1,
  });
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 0,
    deletedArchived: 0,
    deletedDisposable: 2,
  });
  assert.equal(getConversation(disposableParent.id).id, disposableParent.id);
  assert.equal(listSideChats(disposableParent.id).length, 0);
  assert.equal(listSubagents(disposableParent.id).length, 0);

  deleteConversation(disposableParent.id, { hard: true });
  assert.equal(getArchiveStats().total, 0);
  sqlite.close();
  console.log('Conversation archive database flow passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
