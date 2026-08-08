import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import {
  listRecentConversationSearchCandidates,
  searchChatsIn,
  searchOlderChatsIn,
} from './search-core.js';

// Read-write handle: WAL bookkeeping (-shm/-wal) requires write access while the app runs.
const db = new DatabaseSync(workerData?.databasePath ?? join(homedir(), '.aivax', 'aivax.sqlite'));
let recentCandidates = null;
let recentCandidatesDataVersion = null;

parentPort.on('message', ({ id, query, includeRecentCandidates = false }) => {
  try {
    const normalizedQuery = String(query ?? '').trim();
    if (includeRecentCandidates && normalizedQuery) {
      const { data_version: dataVersion } = db.prepare('PRAGMA data_version').get();
      if (recentCandidates === null || recentCandidatesDataVersion !== dataVersion) {
        recentCandidates = listRecentConversationSearchCandidates(db);
        recentCandidatesDataVersion = dataVersion;
      }
    }
    parentPort.postMessage(includeRecentCandidates && normalizedQuery
      ? {
        id,
        olderResults: searchOlderChatsIn(db, normalizedQuery),
        recentCandidates,
      }
      : { id, results: searchChatsIn(db, normalizedQuery) });
  } catch (error) {
    parentPort.postMessage({ id, results: [], error: String(error?.message ?? error) });
  }
});
