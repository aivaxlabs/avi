import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import {
  RECENT_CONVERSATION_LIMIT,
  listRecentConversationSearchCandidates,
  searchChatsIn,
  searchOlderChatsIn,
} from '../src/main/search-core.js';

const tempDirectory = mkdtempSync(join(tmpdir(), 'avi-search-worker-'));
const databasePath = join(tempDirectory, 'search.sqlite');
const db = new DatabaseSync(databasePath);
try {
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project_path TEXT,
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
    INSERT INTO conversations (id, title, project_path, updated_at, conversation_type)
    VALUES (?, ?, ?, ?, 'thread')
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, updated_at, hidden)
    VALUES (?, ?, 'user', ?, ?, 0)
  `);
  for (let index = 0; index <= RECENT_CONVERSATION_LIMIT; index += 1) {
    const id = `conversation-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, RECENT_CONVERSATION_LIMIT - index)).toISOString();
    insertConversation.run(id, `Conversation ${index}`, process.cwd(), updatedAt);
    insertMessage.run(`message-${index}`, id, `needle ${index}`, updatedAt);
  }

  insertMessage.run(
    'older-message-0',
    'conversation-0',
    'earlier thread context',
    new Date(Date.UTC(2025, 11, 31)).toISOString(),
  );

  const recentCandidates = listRecentConversationSearchCandidates(db);
  assert.equal(recentCandidates.length, RECENT_CONVERSATION_LIMIT);
  assert.equal(recentCandidates.at(-1).conversationId, `conversation-${RECENT_CONVERSATION_LIMIT - 1}`);
  assert.ok(!recentCandidates.some((item) => item.conversationId === `conversation-${RECENT_CONVERSATION_LIMIT}`));
  assert.match(recentCandidates[0].content, /earlier thread context/);

  assert.deepEqual(
    searchOlderChatsIn(db, 'needle').map((item) => item.conversationId),
    [`conversation-${RECENT_CONVERSATION_LIMIT}`],
  );
  assert.equal(searchChatsIn(db, 'needle').length, 20);
  assert.equal(searchChatsIn(db, 'needle')[0].conversationId, 'conversation-0');
  db.close();

  const worker = new Worker(new URL('../src/main/search-worker.js', import.meta.url), {
    workerData: { databasePath },
  });
  const workerRequest = (id) => new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('message', resolve);
    worker.postMessage({ id, query: 'needle', includeRecentCandidates: true });
  });
  const workerResult = await workerRequest(1);
  assert.equal(workerResult.id, 1);
  assert.equal(workerResult.error, undefined);
  assert.equal(workerResult.recentCandidates.length, RECENT_CONVERSATION_LIMIT);
  assert.deepEqual(
    workerResult.olderResults.map((item) => item.conversationId),
    [`conversation-${RECENT_CONVERSATION_LIMIT}`],
  );

  const updateDb = new DatabaseSync(databasePath);
  const newestUpdatedAt = new Date(Date.UTC(2026, 0, 2)).toISOString();
  updateDb.prepare(`
    UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
  `).run('Updated conversation', newestUpdatedAt, 'conversation-1');
  updateDb.close();

  const refreshedWorkerResult = await workerRequest(2);
  worker.terminate();
  assert.equal(refreshedWorkerResult.id, 2);
  assert.equal(refreshedWorkerResult.recentCandidates[0].conversationId, 'conversation-1');
  assert.equal(refreshedWorkerResult.recentCandidates[0].title, 'Updated conversation');
  console.log('Search worker, recent corpus cache, invalidation, and lexical fallback flow passed.');
} finally {
  try {
    db.close();
  } catch {}
  rmSync(tempDirectory, { recursive: true, force: true });
}
process.exit(0);
