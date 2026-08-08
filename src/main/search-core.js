import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';

export const RECENT_CONVERSATION_LIMIT = 5_000;

const MAX_REFLEX_DOCUMENT_CHARS = 4_000;
const MAX_REFLEX_MESSAGES_PER_CONVERSATION = 8;

const escapeLikeTerm = (term) => term.replace(/[\\%_]/g, (char) => `\\${char}`);

const statements = new WeakMap();

const getStatements = (db) => {
  if (!statements.has(db)) {
    statements.set(db, {
      recentConversations: db.prepare(`
        WITH recent_conversations AS (
          SELECT id, title, project_path, updated_at
          FROM conversations
          WHERE deleted_at IS NULL AND archived_at IS NULL
            AND conversation_type = 'thread'
          ORDER BY updated_at DESC
          LIMIT ?
        ),
        recent_messages AS (
          SELECT m.id, m.conversation_id, m.role, m.content, m.updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY m.conversation_id
              ORDER BY m.updated_at DESC
            ) AS message_rank
          FROM messages m
          JOIN recent_conversations c ON c.id = m.conversation_id
          WHERE m.hidden = 0
        )
        SELECT c.id AS conversation_id, c.title AS conversation_title, c.project_path,
          c.updated_at AS conversation_updated_at, m.id, m.role, m.content, m.updated_at
        FROM recent_conversations c
        LEFT JOIN recent_messages m ON m.conversation_id = c.id
          AND m.message_rank <= ${MAX_REFLEX_MESSAGES_PER_CONVERSATION}
        ORDER BY c.updated_at DESC, m.updated_at DESC
      `),
      lexical: new Map(),
      olderLexical: new Map(),
    });
  }
  return statements.get(db);
};

const getLexicalStatement = (db, termCount, olderOnly) => {
  const collection = getStatements(db)[olderOnly ? 'olderLexical' : 'lexical'];
  if (!collection.has(termCount)) {
    const predicates = Array.from(
      { length: termCount },
      () => "(m.content LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')",
    ).join(' AND ');
    const recentConversationFilter = olderOnly ? `
        AND c.id NOT IN (
          SELECT id
          FROM conversations
          WHERE deleted_at IS NULL AND archived_at IS NULL
            AND conversation_type = 'thread'
          ORDER BY updated_at DESC
          LIMIT ${RECENT_CONVERSATION_LIMIT}
        )` : '';
    collection.set(termCount, db.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.content, m.updated_at,
        c.title AS conversation_title, c.project_path
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.deleted_at IS NULL AND c.archived_at IS NULL
        AND c.conversation_type = 'thread' AND m.hidden = 0
        AND ${predicates}${recentConversationFilter}
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

const searchableContent = (row) => row.role === 'assistant'
  ? answerTextFromTextualBlocks(row.content)
  : String(row.content ?? '');

const rankLexicalRows = (rows, normalized, terms) => {
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
      updatedAt: row.updated_at,
      ...folderFields(row.project_path),
    });
  }
  return results
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter((item) => {
      if (seenConversations.has(item.conversationId)) return false;
      seenConversations.add(item.conversationId);
      return true;
    })
    .slice(0, 20);
};

const lexicalSearch = (db, query, { olderOnly = false } = {}) => {
  const normalized = String(query ?? '').trim().toLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const parameters = terms.flatMap((term) => {
    const pattern = `%${escapeLikeTerm(term)}%`;
    return [pattern, pattern];
  });
  return rankLexicalRows(
    getLexicalStatement(db, terms.length, olderOnly).all(...parameters),
    normalized,
    terms,
  );
};

export function searchChatsIn(db, query) {
  return lexicalSearch(db, query);
}

export function searchOlderChatsIn(db, query) {
  return lexicalSearch(db, query, { olderOnly: true });
}

export function listRecentConversationSearchCandidates(db) {
  const candidates = [];
  for (const row of getStatements(db).recentConversations.all(RECENT_CONVERSATION_LIMIT)) {
    const candidate = candidates.at(-1);
    if (!candidate || candidate.conversationId !== row.conversation_id) {
      candidates.push({
        conversationId: row.conversation_id,
        messageId: row.id,
        title: row.conversation_title,
        role: row.role,
        content: '',
        updatedAt: row.conversation_updated_at,
        ...folderFields(row.project_path),
      });
    }
    const current = candidates.at(-1);
    if (current.content.length < MAX_REFLEX_DOCUMENT_CHARS) {
      current.content += `${current.content ? '\n\n' : ''}${searchableContent(row)}`
        .slice(0, MAX_REFLEX_DOCUMENT_CHARS - current.content.length);
    }
  }
  return candidates;
}
