import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { getDocumentEmbeddingUsage, importAivaxDocuments, requestAivax } from './aivax-client.js';
import {
  getAivaxAccessToken,
  getAivaxSettings,
  getSemanticGrepStatus,
  listFrequentProjectPaths,
  setSemanticGrepStatus,
} from './database.js';
import { directoryKey, formatFileSearchResults, gitWorktreeRoot, scanDirectories, semanticPathFilter } from './semantic-grep-scan.js';
import { traceError, traceInfo } from './trace-log.js';
import { WorkspaceManager } from './workspaces.js';

export const SEMANTIC_GREP_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
const SEARCH_MIN_SCORE = 0.2;
const SEARCH_TOP = 20;

function sourceLineRange(metadata) {
  const start = metadata?.source_line_start;
  const end = metadata?.source_line_end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  return { start, end };
}

let syncController = null;
let syncPromise = null;
let syncKey = '';
const workspaces = new WorkspaceManager();

export async function searchSemanticGrep({
  query,
  directory,
  top = SEARCH_TOP,
  signal,
  settings = getAivaxSettings(),
} = {}) {
  const terms = String(query ?? '').trim();
  if (!terms) throw new Error('Provide the search query.');
  const current = resolve(directory || '.');
  const results = await requestAivax('/api/v1/query', {
    body: {
      collections: [settings.semanticGrepCollectionId],
      terms,
      top: Math.min(Math.max(1, top) * 4, 200),
      minScore: SEARCH_MIN_SCORE,
      reranker: settings.semanticGrepReranker || 'rrf',
      filter: semanticPathFilter(current),
      includeReferences: false,
    },
    responseType: 'array',
    signal,
  });
  const files = new Map();
  for (const result of results) {
    const path = result.metadata?.real_path;
    if (!path || !existsSync(path)) continue;
    const range = sourceLineRange(result.metadata);
    const hit = files.get(path);
    if (hit) {
      if (result.score > hit.score) hit.score = result.score;
      if (range) hit.ranges.push(range);
    } else {
      files.set(path, {
        path,
        score: result.score,
        ranges: range ? [range] : [],
        relativePath: relative(current, path) || '.',
      });
    }
  }
  const hits = [...files.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, top);
  return formatFileSearchResults(current, hits);
}

export async function recommendSemanticGrepDirectories(limit = 8) {
  const indexed = new Set((getAivaxSettings().semanticGrepDirectories ?? []).map(directoryKey));
  const suggestions = new Map();
  for (const item of listFrequentProjectPaths(24)) {
    let targets = [item.path];
    if (workspaces.isWorkspace(item.path)) {
      try {
        targets = (await workspaces.inspect(item.path)).folders
          .filter((folder) => folder.available)
          .map((folder) => folder.path);
      } catch {
        continue;
      }
    }
    for (const target of targets) {
      let recommended = resolve(target);
      try {
        if (!(await stat(recommended)).isDirectory()) continue;
      } catch {
        continue;
      }
      const worktree = await gitWorktreeRoot(recommended).catch(() => null);
      if (worktree) recommended = worktree;
      const key = directoryKey(recommended);
      if (indexed.has(key)) continue;
      const existing = suggestions.get(key);
      suggestions.set(key, {
        path: recommended,
        conversations: (existing?.conversations ?? 0) + item.conversations,
        worktree: Boolean(worktree) || existing?.worktree === true,
      });
    }
  }
  return [...suggestions.values()]
    .sort((left, right) => right.conversations - left.conversations || left.path.localeCompare(right.path))
    .slice(0, limit);
}

async function collectionIndexingState(collectionId) {
  const collection = await requestAivax(`/api/v1/collections/${encodeURIComponent(collectionId)}`, {
    responseType: 'object',
  });
  return collection.state ?? collection;
}

function indexingKey(settings) {
  return `${settings.semanticGrepCollectionId}\0${settings.semanticGrepDirectories.join('\0')}`;
}

export function synchronizeSemanticGrep() {
  const settings = getAivaxSettings();
  const canIndex = Boolean(
    getAivaxAccessToken()
    && settings.semanticGrepCollectionId
    && settings.semanticGrepDirectories.length,
  );
  if (!canIndex) {
    const previous = syncController;
    syncController = null;
    syncPromise = null;
    syncKey = '';
    previous?.abort();
    if (previous) {
      setSemanticGrepStatus({ ...getSemanticGrepStatus(), state: 'idle', error: null });
    }
    return null;
  }
  const key = indexingKey(settings);
  if (syncPromise && syncKey === key) return syncPromise;
  syncController?.abort();
  const controller = new AbortController();
  syncController = controller;
  syncKey = key;
  const run = runSemanticGrepSync(settings, controller.signal).finally(() => {
    if (syncController === controller) {
      syncController = null;
      syncPromise = null;
      syncKey = '';
    }
  });
  syncPromise = run;
  return run;
}

async function runSemanticGrepSync(settings, signal) {
  const startedAt = new Date();
  const collectionId = settings.semanticGrepCollectionId;
  const current = () => syncController?.signal === signal;
  const writeStatus = (status) => {
    if (current()) setSemanticGrepStatus(status);
  };
  writeStatus({
    ...getSemanticGrepStatus(),
    state: 'indexing',
    startedAt: startedAt.toISOString(),
    error: null,
  });
  const lines = [];
  let files = 0;
  try {
    const scanned = await scanDirectories(settings.semanticGrepDirectories, {
      signal,
      onFile(file) {
        if (signal.aborted) return;
        files += 1;
        lines.push(...file.lines);
        if (files % 25 === 0) {
          writeStatus({
            ...getSemanticGrepStatus(),
            state: 'indexing',
            files,
            documents: lines.length,
          });
        }
      },
    });
    if (signal.aborted) return null;
    files = scanned.files;
    const imported = await importAivaxDocuments(collectionId, lines, { sync: true, signal });
    let queuedDocuments = null;
    let indexedDocuments = null;
    if (imported.updated > 0) {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const state = await collectionIndexingState(collectionId);
        queuedDocuments = state.queuedDocuments ?? null;
        indexedDocuments = state.indexedDocuments ?? null;
        if (!queuedDocuments || signal.aborted) break;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 10_000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    }
    if (signal.aborted) return null;
    const usage = await getDocumentEmbeddingUsage(new Date(startedAt.getTime() - 60_000), new Date()).catch(() => null);
    if (!current()) return null;
    const status = setSemanticGrepStatus({
      state: 'idle',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      files,
      documents: lines.length,
      updated: imported.updated,
      skipped: imported.skipped,
      removed: imported.removed,
      queuedDocuments,
      indexedDocuments,
      cost: usage?.cost ?? null,
      tokens: usage?.tokens ?? null,
      error: null,
    });
    traceInfo('aivax.semantic-grep-index-completed', {
      document_count: lines.length,
      documents_updated: imported.updated,
      documents_skipped: imported.skipped,
      documents_removed: imported.removed,
      embedding_cost: usage?.cost ?? null,
      duration_ms: Date.now() - startedAt.getTime(),
    });
    return status;
  } catch (error) {
    if (signal.aborted) return null;
    const message = error instanceof Error ? error.message : String(error);
    if (syncController?.signal !== signal) return null;
    setSemanticGrepStatus({
      ...getSemanticGrepStatus(),
      state: 'error',
      finishedAt: new Date().toISOString(),
      files,
      documents: lines.length,
      error: message,
    });
    traceError('aivax.semantic-grep-index-error', {
      document_count: lines.length,
      duration_ms: Date.now() - startedAt.getTime(),
      status: error?.status,
      error: message,
    });
    return null;
  }
}
