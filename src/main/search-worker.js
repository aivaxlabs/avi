import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { searchChatsIn } from './search-core.js';

// Read-write handle: WAL bookkeeping (-shm/-wal) requires write access while the app runs.
const db = new DatabaseSync(workerData?.databasePath ?? join(homedir(), '.aivax', 'aivax.sqlite'));

parentPort.on('message', ({ id, query }) => {
  try {
    parentPort.postMessage({ id, results: searchChatsIn(db, query) });
  } catch (error) {
    parentPort.postMessage({ id, results: [], error: String(error?.message ?? error) });
  }
});
