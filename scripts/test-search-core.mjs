import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { listSearchThreadsIn, searchChatsIn } from '../src/main/search-core.js';
import {
  buildThreadSearchDocuments,
  compareThreadSearchManifests,
  createThreadSearchManifest,
  THREAD_SEARCH_COMPONENT_CHAR_LIMIT,
} from '../src/main/thread-search-index.js';

const tempDirectory = mkdtempSync(join(tmpdir(), 'avi-search-worker-'));
const databasePath = join(tempDirectory, 'search.sqlite');
const db = new DatabaseSync(databasePath);
try {
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      archived_at TEXT,
      conversation_type TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0
    );
  `);
  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, title, project_path, created_at, updated_at, conversation_type)
    VALUES (?, ?, ?, ?, ?, 'thread')
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, updated_at, hidden)
    VALUES (?, ?, 'user', ?, ?, 0)
  `);
  for (let index = 0; index < 30; index += 1) {
    const id = `conversation-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 30 - index)).toISOString();
    const createdAt = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
    const messageUpdatedAt = new Date(Date.UTC(2025, 6, 1 + index)).toISOString();
    const projectPath = index % 3 === 0 ? join(tempDirectory, 'other') : process.cwd();
    insertConversation.run(id, `Conversation ${index}`, projectPath, createdAt, updatedAt);
    insertMessage.run(`message-${index}`, id, `needle ${index}`, messageUpdatedAt);
  }

  insertMessage.run(
    'older-message-0',
    'conversation-0',
    'earlier thread context',
    new Date(Date.UTC(2025, 11, 31)).toISOString(),
  );

  const threadSource = {
    conversationId: 'thread-id',
    conversationTitle: 'T'.repeat(THREAD_SEARCH_COMPONENT_CHAR_LIMIT + 10),
  };
  const projectedDocuments = buildThreadSearchDocuments([
    { ...threadSource, id: 'hidden-user', role: 'user', status: 'sent', content: 'hidden', hidden: true },
    { ...threadSource, id: 'agent-user', role: 'user', status: 'sent', content: 'internal', fromAgent: true },
    { ...threadSource, id: 'user-0', role: 'user', status: 'sent', content: 'oldest user' },
    { ...threadSource, id: 'assistant-0', role: 'assistant', status: 'completed', content: 'oldest assistant', updatedAt: '2026-01-01T00:00:00Z' },
    { ...threadSource, id: 'user-1', role: 'user', status: 'sent', content: 'first kept user' },
    { ...threadSource, id: 'assistant-1', role: 'assistant', status: 'completed', content: '<think>secret</think>first kept assistant', updatedAt: '2026-01-02T00:00:00Z' },
    { ...threadSource, id: 'user-2', role: 'user', status: 'completed', content: 'second kept user' },
    { ...threadSource, id: 'assistant-2', role: 'assistant', status: 'completed', content: 'second kept assistant', updatedAt: '2026-01-03T00:00:00Z' },
    { ...threadSource, id: 'user-3', role: 'user', status: 'sent', content: 'U'.repeat(THREAD_SEARCH_COMPONENT_CHAR_LIMIT + 10) },
    { ...threadSource, id: 'assistant-3', role: 'assistant', status: 'completed', content: '<assistant-answer>final kept assistant</assistant-answer>', updatedAt: '2026-01-04T00:00:00Z' },
    { ...threadSource, id: 'pending-user', role: 'user', status: 'sent', content: 'pending' },
    { ...threadSource, id: 'aborted-assistant', role: 'assistant', status: 'aborted', content: 'partial' },
  ]);
  assert.equal(projectedDocuments.length, 3);
  assert.deepEqual(projectedDocuments.map((document) => document.docid), [
    'avi-thread:thread-id:user-1',
    'avi-thread:thread-id:user-2',
    'avi-thread:thread-id:user-3',
  ]);
  assert.ok(!projectedDocuments[0].text.includes('secret'));
  assert.match(projectedDocuments[0].text, /first kept assistant/);
  assert.match(projectedDocuments[2].text, /final kept assistant/);
  assert.equal(projectedDocuments[2].__meta.threadId, 'thread-id');
  assert.equal(projectedDocuments[2].__meta.title.length, THREAD_SEARCH_COMPONENT_CHAR_LIMIT);
  assert.equal(projectedDocuments[2].text.match(/User: (U+)/)[1].length, THREAD_SEARCH_COMPONENT_CHAR_LIMIT);

  const firstManifest = createThreadSearchManifest(projectedDocuments);
  const changedDocuments = structuredClone(projectedDocuments);
  changedDocuments[1].text += ' changed';
  changedDocuments.pop();
  changedDocuments.push({ ...projectedDocuments[2], docid: 'new-document' });
  const secondManifest = createThreadSearchManifest(changedDocuments);
  assert.deepEqual(compareThreadSearchManifests(firstManifest, secondManifest), {
    added: 1,
    updated: 1,
    skipped: 1,
    removed: 1,
  });

  assert.equal(searchChatsIn(db, 'needle').length, 20);
  assert.equal(searchChatsIn(db, 'needle')[0].conversationId, 'conversation-0');
  assert.equal(
    searchChatsIn(db, 'needle')[0].updatedAt,
    new Date(Date.UTC(2026, 0, 1, 0, 0, 30)).toISOString(),
  );
  assert.deepEqual(searchChatsIn(db, { query: 'needle' }), searchChatsIn(db, 'needle'));

  const folderResults = searchChatsIn(db, { query: 'needle', folderPath: join(tempDirectory, 'other') });
  assert.equal(folderResults.length, 10);
  assert.ok(folderResults.every((result) => result.folderPath === join(tempDirectory, 'other')));

  const updatedAfter = new Date(Date.UTC(2026, 0, 1, 0, 0, 26)).toISOString();
  const recentResults = searchChatsIn(db, { query: 'needle', updatedAfter });
  assert.equal(recentResults.length, 5);
  assert.ok(recentResults.every((result) => result.updatedAt >= updatedAfter));
  assert.equal(searchChatsIn(db, { query: 'needle', updatedAfter: 'invalid' }).length, 20);

  const updatedSorted = searchChatsIn(db, { query: 'needle 2', sort: 'updated' });
  assert.ok(updatedSorted.every((result, index) => (
    index === 0 || result.updatedAt <= updatedSorted[index - 1].updatedAt
  )));

  db.prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
    .run(new Date().toISOString(), 'conversation-0');
  db.prepare('UPDATE conversations SET deleted_at = ? WHERE id = ?')
    .run(new Date().toISOString(), 'conversation-1');
  const activeIds = searchChatsIn(db, { query: 'needle' }).map((result) => result.conversationId);
  assert.ok(!activeIds.includes('conversation-0'));
  assert.ok(!activeIds.includes('conversation-1'));
  const archivedResults = searchChatsIn(db, { query: 'needle', includeArchived: true });
  assert.equal(archivedResults[0].conversationId, 'conversation-0');
  assert.ok(archivedResults[0].archivedAt);
  assert.ok(!archivedResults.some((result) => result.conversationId === 'conversation-1'));

  const recentThreads = searchChatsIn(db, '');
  assert.equal(recentThreads.length, 20);
  assert.equal(recentThreads[0].conversationId, 'conversation-2');
  assert.equal(recentThreads[0].content, 'needle 2');
  assert.equal(searchChatsIn(db, { query: '', includeArchived: true })[0].conversationId, 'conversation-0');

  const lookup = listSearchThreadsIn(
    db,
    { includeArchived: false, folderPath: null, updatedAfter: null },
    ['conversation-0', 'conversation-1', 'conversation-5', 'missing-thread'],
  );
  assert.deepEqual(lookup.map((thread) => thread.conversationId), ['conversation-5']);
  db.prepare('UPDATE conversations SET archived_at = NULL, deleted_at = NULL WHERE id IN (?, ?)')
    .run('conversation-0', 'conversation-1');
  db.close();

  const worker = new Worker(new URL('../src/main/search-worker.js', import.meta.url), {
    workerData: { databasePath },
  });
  const workerRequest = (id) => new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('message', resolve);
    worker.postMessage({ id, query: 'needle' });
  });
  const workerResult = await workerRequest(1);
  assert.equal(workerResult.id, 1);
  assert.equal(workerResult.error, undefined);
  assert.equal(workerResult.results.length, 20);
  assert.equal(workerResult.results[0].conversationId, 'conversation-0');

  const updateDb = new DatabaseSync(databasePath);
  const newestUpdatedAt = new Date(Date.UTC(2026, 0, 2)).toISOString();
  updateDb.prepare(`
    UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
  `).run('Updated conversation', newestUpdatedAt, 'conversation-1');
  updateDb.prepare('UPDATE messages SET updated_at = ? WHERE conversation_id = ?')
    .run(newestUpdatedAt, 'conversation-1');
  updateDb.close();

  const refreshedWorkerResult = await workerRequest(2);
  worker.terminate();
  assert.equal(refreshedWorkerResult.id, 2);
  assert.equal(refreshedWorkerResult.results[0].conversationId, 'conversation-1');
  assert.equal(refreshedWorkerResult.results[0].title, 'Updated conversation');
  console.log('Search worker, thread projection, and lexical fallback flow passed.');
} finally {
  try {
    db.close();
  } catch {}
  rmSync(tempDirectory, { recursive: true, force: true });
}
process.exit(0);
