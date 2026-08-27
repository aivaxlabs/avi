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
    createBot,
    createConversation,
    deleteConversation,
    forkConversation,
    getArchiveSettings,
    getArchiveStats,
    getAivaxSettings,
    getConversation,
    getMessages,
    getThreadSearchManifest,
    insertInferenceUsage,
    insertMessage,
    listArchivedConversations,
    listConversations,
    listForcedCleanupConversationIds,
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
    botHistoryRetentionDays: 7,
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
    botHistoryRetentionDays: 7,
  }), /Archive settings are invalid/);
  assert.throws(() => setArchiveSettings({
    archiveAfterDays: 7,
    deleteArchivedAfterDays: 30,
    deleteDisposableAfterDays: 1,
    botHistoryRetentionDays: null,
  }), /Archive settings are invalid/);
  for (const botHistoryRetentionDays of [3, 7, 30]) {
    assert.equal(setArchiveSettings({
      archiveAfterDays: 7,
      deleteArchivedAfterDays: 30,
      deleteDisposableAfterDays: 1,
      botHistoryRetentionDays,
    }).botHistoryRetentionDays, botHistoryRetentionDays);
  }

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
    botHistoryRetentionDays: 7,
  });
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 3,
    deletedArchived: 0,
    deletedDisposable: 0,
    prunedBotMessages: 0,
  });
  assert.equal(listArchivedConversations()[0].id, parent.id);

  sqlite.prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
    .run(new Date(now.getTime() - 61 * 86_400_000).toISOString(), parent.id);
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 0,
    deletedArchived: 1,
    deletedDisposable: 0,
    prunedBotMessages: 0,
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
    botHistoryRetentionDays: 7,
  });
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 0,
    deletedArchived: 0,
    deletedDisposable: 2,
    prunedBotMessages: 0,
  });
  assert.equal(getConversation(disposableParent.id).id, disposableParent.id);
  assert.equal(listSideChats(disposableParent.id).length, 0);
  assert.equal(listSubagents(disposableParent.id).length, 0);

  const botConversation = createConversation({
    title: 'Retention bot',
    model: 'test/model',
    projectPath: process.cwd(),
    conversationType: 'bot',
    titleStatus: 'generated',
  });
  createBot({
    conversationId: botConversation.id,
    name: 'Retention bot',
    iconSeed: 'retention-bot',
    model: 'test/model',
  });
  const botMessages = [
    ['old-activation', true, '<bot-activation at="2026-07-01T12:00:00.000Z"></bot-activation>', '2026-07-01T12:00:00.000Z'],
    ['old-assistant', true, 'Old activation result', '2026-07-01T12:01:00.000Z'],
    ['recent-human', false, 'Recent human message', '2026-08-01T12:00:00.000Z'],
    ['recent-assistant', true, 'Recent human response', '2026-08-01T12:01:00.000Z'],
  ];
  for (const [id, fromAgent, content, createdAt] of botMessages) {
    insertMessage({
      id,
      conversationId: botConversation.id,
      role: id.includes('assistant') ? 'assistant' : 'user',
      status: 'completed',
      fromAgent,
      content,
      createdAt,
    });
    sqlite.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').run(createdAt, id);
  }
  setArchiveSettings({
    archiveAfterDays: null,
    deleteArchivedAfterDays: null,
    deleteDisposableAfterDays: null,
    botHistoryRetentionDays: 7,
  });
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 0,
    deletedArchived: 0,
    deletedDisposable: 0,
    prunedBotMessages: 2,
  });
  assert.deepEqual(getMessages(botConversation.id).map((message) => message.id), [
    'recent-human',
    'recent-assistant',
  ]);

  const boundaryConversation = createConversation({
    title: 'Boundary bot',
    model: 'test/model',
    projectPath: process.cwd(),
    conversationType: 'bot',
    titleStatus: 'generated',
  });
  createBot({
    conversationId: boundaryConversation.id,
    name: 'Boundary bot',
    iconSeed: 'boundary-bot',
    model: 'test/model',
  });
  for (const message of [
    {
      id: 'boundary-old-activation',
      role: 'user',
      fromAgent: true,
      content: '<bot-activation at="2026-07-01T12:00:00.000Z"></bot-activation>',
      createdAt: '2026-07-01T12:00:00.000Z',
    },
    {
      id: 'boundary-late-assistant',
      role: 'assistant',
      fromAgent: true,
      content: 'This old activation completed inside the retention window',
      createdAt: '2026-07-29T12:00:00.000Z',
    },
    {
      id: 'boundary-exact-human',
      role: 'user',
      fromAgent: false,
      content: 'Exactly at the seven-day cutoff',
      createdAt: '2026-07-28T12:00:00.000Z',
    },
    {
      id: 'boundary-exact-assistant',
      role: 'assistant',
      fromAgent: true,
      content: 'Boundary response',
      createdAt: '2026-07-28T12:01:00.000Z',
    },
  ]) {
    insertMessage({
      ...message,
      conversationId: boundaryConversation.id,
      status: 'completed',
    });
    sqlite.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').run(
      message.createdAt,
      message.id,
    );
  }
  assert.deepEqual(runArchiveMaintenance({
    now,
    activeConversationIds: [boundaryConversation.id],
  }), {
    archived: 0,
    deletedArchived: 0,
    deletedDisposable: 0,
    prunedBotMessages: 0,
  });
  assert.equal(getMessages(boundaryConversation.id).length, 4);
  assert.deepEqual(runArchiveMaintenance({ now }), {
    archived: 0,
    deletedArchived: 0,
    deletedDisposable: 0,
    prunedBotMessages: 0,
  });
  assert.equal(getMessages(boundaryConversation.id).length, 4);

  const forcedRetentionConversation = createConversation({
    title: 'Forced retention bot',
    model: 'test/model',
    projectPath: process.cwd(),
    conversationType: 'bot',
    titleStatus: 'generated',
  });
  createBot({
    conversationId: forcedRetentionConversation.id,
    name: 'Forced retention bot',
    iconSeed: 'forced-retention-bot',
    model: 'test/model',
  });
  for (const message of [
    {
      id: 'forced-old-activation',
      role: 'user',
      fromAgent: true,
      content: '<bot-activation at="2026-07-01T12:00:00.000Z"></bot-activation>',
      createdAt: '2026-07-01T12:00:00.000Z',
    },
    {
      id: 'forced-old-assistant',
      role: 'assistant',
      fromAgent: true,
      content: 'Forced old activation result',
      createdAt: '2026-07-01T12:01:00.000Z',
    },
    {
      id: 'forced-recent-activation',
      role: 'user',
      fromAgent: true,
      content: '<bot-activation at="2026-08-01T12:00:00.000Z"></bot-activation>',
      createdAt: '2026-08-01T12:00:00.000Z',
    },
    {
      id: 'forced-recent-assistant',
      role: 'assistant',
      fromAgent: true,
      content: 'Forced recent activation result',
      createdAt: '2026-08-01T12:01:00.000Z',
    },
  ]) {
    insertMessage({
      ...message,
      conversationId: forcedRetentionConversation.id,
      status: 'completed',
    });
    sqlite.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').run(
      message.createdAt,
      message.id,
    );
  }

  const forcedArchive = createConversation({ model: 'test/model', projectPath: process.cwd() });
  insertMessage({
    conversationId: forcedArchive.id,
    role: 'user',
    status: 'sent',
    content: 'Delete this newly archived thread',
  });
  const recentArchive = createConversation({ model: 'test/model', projectPath: process.cwd() });
  insertMessage({
    conversationId: recentArchive.id,
    role: 'user',
    status: 'sent',
    content: 'Delete this recent archive despite the automatic policy',
  });
  assert.equal(archiveConversation(recentArchive.id), true);
  const crossingCutoff = createConversation({ model: 'test/model', projectPath: process.cwd() });
  insertMessage({
    conversationId: crossingCutoff.id,
    role: 'user',
    status: 'sent',
    content: 'Preserve this thread for the fixed cleanup cutoff',
  });
  sqlite.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    new Date(now.getTime() - 30 * 86_400_000 + 60_000).toISOString(),
    crossingCutoff.id,
  );
  const activeSide = forkConversation(disposableParent.id, { sideChat: true }).conversation;
  const activeSubagent = forkConversation(disposableParent.id, {
    subagent: true,
    initialPrompt: 'Preserve this active sub-agent',
  }).conversation;
  const archivedSide = forkConversation(forcedArchive.id, { sideChat: true }).conversation;
  const archivedSubagent = forkConversation(forcedArchive.id, {
    subagent: true,
    initialPrompt: 'Delete this sub-agent with its archived parent',
  }).conversation;
  sqlite.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    new Date(now.getTime() - 31 * 86_400_000).toISOString(),
    forcedArchive.id,
  );
  setArchiveSettings({
    archiveAfterDays: 30,
    deleteArchivedAfterDays: null,
    deleteDisposableAfterDays: null,
    botHistoryRetentionDays: 7,
  });
  assert.deepEqual(new Set(listForcedCleanupConversationIds({ now })), new Set([
    forcedArchive.id,
    recentArchive.id,
    archivedSide.id,
    archivedSubagent.id,
  ]));
  assert.equal(listForcedCleanupConversationIds({
    now: new Date(now.getTime() + 2 * 60_000),
  }).includes(crossingCutoff.id), true);
  assert.deepEqual(runArchiveMaintenance({ now, forced: true }), {
    archived: 3,
    deletedArchived: 2,
    deletedDisposable: 2,
    prunedBotMessages: 2,
  });
  assert.deepEqual(getMessages(forcedRetentionConversation.id).map((message) => message.id), [
    'forced-recent-activation',
    'forced-recent-assistant',
  ]);
  assert.equal(getConversation(forcedArchive.id), null);
  assert.equal(getConversation(recentArchive.id), null);
  assert.equal(getConversation(archivedSide.id), null);
  assert.equal(getConversation(archivedSubagent.id), null);
  assert.equal(getConversation(activeSide.id).id, activeSide.id);
  assert.equal(getConversation(activeSubagent.id).id, activeSubagent.id);
  assert.equal(getConversation(crossingCutoff.id).id, crossingCutoff.id);
  assert.equal(getConversation(disposableParent.id).id, disposableParent.id);
  assert.equal(getConversation(botConversation.id).id, botConversation.id);

  deleteConversation(crossingCutoff.id, { hard: true });
  deleteConversation(disposableParent.id, { hard: true });
  deleteConversation(botConversation.id, { hard: true });
  deleteConversation(boundaryConversation.id, { hard: true });
  deleteConversation(forcedRetentionConversation.id, { hard: true });
  assert.equal(getArchiveStats().total, 0);
  sqlite.close();
  console.log('Conversation archive database flow passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
