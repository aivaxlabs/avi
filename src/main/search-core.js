import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';

const resultLimit = 20;

const escapeLikeTerm = (term) => term.replace(/[\\%_]/g, (char) => `\\${char}`);

const threadFilter = `
  c.deleted_at IS NULL AND c.conversation_type = 'thread'
  AND (@includeArchived = 1 OR c.archived_at IS NULL)
  AND (@folderPath IS NULL OR COALESCE(NULLIF(c.project_path, ''), @homePath) = @folderPath)
  AND (@updatedAfter IS NULL OR c.updated_at >= @updatedAfter)
`;

const statements = new WeakMap();

const getStatements = (db) => {
  if (!statements.has(db)) {
    statements.set(db, {
      lexical: new Map(),
      threads: db.prepare(`
        SELECT c.id, c.title, c.project_path, c.updated_at, c.archived_at,
          COALESCE((
            SELECT content FROM messages
            WHERE conversation_id = c.id AND role = 'user' AND hidden = 0
            ORDER BY created_at LIMIT 1
          ), '') AS first_prompt
        FROM conversations c
        WHERE ${threadFilter}
          AND (@ids IS NULL OR c.id IN (SELECT value FROM json_each(@ids)))
          AND EXISTS (SELECT 1 FROM messages WHERE conversation_id = c.id AND hidden = 0)
        ORDER BY c.updated_at DESC
        LIMIT @limit
      `),
    });
  }
  return statements.get(db);
};

const getLexicalStatement = (db, termCount) => {
  const collection = getStatements(db).lexical;
  if (!collection.has(termCount)) {
    const predicates = Array.from(
      { length: termCount },
      () => "(m.content LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')",
    ).join(' AND ');
    collection.set(termCount, db.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.content,
        c.title AS conversation_title, c.project_path,
        c.updated_at AS conversation_updated_at, c.archived_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE ${threadFilter}
        AND m.hidden = 0
        AND ${predicates}
      ORDER BY m.updated_at DESC
      LIMIT 400
    `));
  }
  return collection.get(termCount);
};

const folderFields = (projectPath) => {
  const folderPath = resolve(projectPath || homedir());
  const relativeFolderPath = relative(homedir(), folderPath);
  return {
    folderPath,
    folderName: relativeFolderPath === '' ? '~/' : basename(folderPath),
    folderDisplayPath: relativeFolderPath === ''
      ? '~/'
      : !relativeFolderPath.startsWith('..') && !isAbsolute(relativeFolderPath)
        ? `~/${relativeFolderPath.replaceAll('\\', '/')}`
        : folderPath,
  };
};

const filterParameters = ({ folderPath, updatedAfter, includeArchived }) => ({
  includeArchived: includeArchived ? 1 : 0,
  folderPath,
  homePath: resolve(homedir()),
  updatedAfter,
});

const searchableContent = (row) => row.role === 'assistant'
  ? answerTextFromTextualBlocks(row.content)
  : String(row.content ?? '');

export function normalizeSearchOptions(payload) {
  const options = typeof payload === 'string' ? { query: payload } : payload ?? {};
  const updatedAfter = new Date(options.updatedAfter ?? '');
  return {
    query: String(options.query ?? ''),
    folderPath: typeof options.folderPath === 'string' && options.folderPath
      ? resolve(options.folderPath)
      : null,
    updatedAfter: options.updatedAfter && Number.isFinite(updatedAfter.getTime())
      ? updatedAfter.toISOString()
      : null,
    includeArchived: options.includeArchived === true,
    sort: options.sort === 'updated' ? 'updated' : 'relevance',
  };
}

export function sortSearchResults(results, sort) {
  const sorted = sort === 'updated'
    ? results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    : results;
  return sorted.slice(0, resultLimit);
}

export function listSearchThreadsIn(db, options, conversationIds = null) {
  return getStatements(db).threads.all({
    ...filterParameters(options),
    ids: conversationIds ? JSON.stringify(conversationIds) : null,
    limit: conversationIds ? conversationIds.length : resultLimit,
  }).map((row) => ({
    score: 0,
    conversationId: row.id,
    messageId: null,
    title: row.title,
    role: 'user',
    content: row.first_prompt,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    ...folderFields(row.project_path),
  }));
}

const rankLexicalRows = (rows, normalized, terms, sort) => {
  const seenConversations = new Set();
  const results = [];
  for (const row of rows) {
    const content = searchableContent(row);
    const source = `${row.conversation_title} ${content}`.toLowerCase();
    const score = source.includes(normalized)
      ? 1000 + normalized.length
      : terms.every((term) => source.includes(term))
        ? 100 + terms.reduce((total, term) => total + term.length, 0)
        : 0;
    if (score === 0) continue;
    results.push({
      score,
      conversationId: row.conversation_id,
      messageId: row.id,
      title: row.conversation_title,
      role: row.role,
      content,
      updatedAt: row.conversation_updated_at,
      archivedAt: row.archived_at ?? null,
      ...folderFields(row.project_path),
    });
  }
  const ranked = results
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter((item) => {
      if (seenConversations.has(item.conversationId)) return false;
      seenConversations.add(item.conversationId);
      return true;
    });
  return sortSearchResults(ranked, sort);
};

export function searchChatsIn(db, payload) {
  const options = normalizeSearchOptions(payload);
  const normalized = options.query.trim().toLowerCase();
  if (!normalized) return listSearchThreadsIn(db, options);

  const terms = normalized.split(/\s+/).filter(Boolean);
  const parameters = terms.flatMap((term) => {
    const pattern = `%${escapeLikeTerm(term)}%`;
    return [pattern, pattern];
  });
  return rankLexicalRows(
    getLexicalStatement(db, terms.length).all(filterParameters(options), ...parameters),
    normalized,
    terms,
    options.sort,
  );
}
