import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';

const escapeLikeTerm = (term) => term.replace(/[\\%_]/g, (char) => `\\${char}`);

const statements = new WeakMap();

const getSearchStatement = (db, termCount) => {
  if (!statements.has(db)) statements.set(db, new Map());
  const databaseStatements = statements.get(db);
  if (!databaseStatements.has(termCount)) {
    const predicates = Array.from(
      { length: termCount },
      () => "(m.content LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')",
    ).join(' AND ');
    databaseStatements.set(termCount, db.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.content, m.updated_at, c.title AS conversation_title
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.deleted_at IS NULL AND c.conversation_type = 'thread' AND m.hidden = 0
        AND ${predicates}
      ORDER BY m.updated_at DESC
      LIMIT 400
    `));
  }
  return databaseStatements.get(termCount);
};

export function searchChatsIn(db, query) {
  const normalized = String(query ?? '').trim().toLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const seenConversations = new Set();
  const results = [];
  const parameters = terms.flatMap((term) => {
    const pattern = `%${escapeLikeTerm(term)}%`;
    return [pattern, pattern];
  });
  for (const row of getSearchStatement(db, terms.length).all(...parameters)) {
    const content = row.role === 'assistant'
      ? answerTextFromTextualBlocks(row.content)
      : row.content;
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
}
