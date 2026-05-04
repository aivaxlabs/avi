import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const storageDir = join(homedir(), '.aivax');
mkdirSync(storageDir, { recursive: true });

const db = new Database(join(storageDir, 'aivax.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS session_values (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    title_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    segments TEXT NOT NULL DEFAULT '[]',
    attachments TEXT NOT NULL DEFAULT '[]',
    continuations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS model_favorites (
    model_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models_cache (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
`);

const statements = {
  setSession: db.prepare(`
    INSERT INTO session_values (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  getSession: db.prepare('SELECT value FROM session_values WHERE key = ?'),
  deleteSession: db.prepare('DELETE FROM session_values WHERE key = ?'),
  insertConversation: db.prepare(`
    INSERT INTO conversations (id, title, model, title_status, created_at, updated_at)
    VALUES (@id, @title, @model, @titleStatus, @createdAt, @updatedAt)
  `),
  updateConversation: db.prepare(`
    UPDATE conversations
    SET title = COALESCE(@title, title),
        model = COALESCE(@model, model),
        title_status = COALESCE(@titleStatus, title_status),
        updated_at = @updatedAt
    WHERE id = @id
  `),
  listConversations: db.prepare(`
    SELECT c.*,
      COALESCE((
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user'
        ORDER BY created_at LIMIT 1
      ), '') AS first_prompt
    FROM conversations c
    WHERE deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM messages
        WHERE conversation_id = c.id
      )
    ORDER BY updated_at DESC
  `),
  getConversation: db.prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL'),
  deleteConversation: db.prepare('UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?'),
  insertMessage: db.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, status, content, segments, attachments,
      continuations, created_at, updated_at
    )
    VALUES (
      @id, @conversationId, @role, @status, @content, @segments, @attachments,
      @continuations, @createdAt, @updatedAt
    )
  `),
  updateMessage: db.prepare(`
    UPDATE messages
    SET status = COALESCE(@status, status),
        content = COALESCE(@content, content),
        segments = COALESCE(@segments, segments),
        attachments = COALESCE(@attachments, attachments),
        continuations = COALESCE(@continuations, continuations),
        updated_at = @updatedAt
    WHERE id = @id
  `),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
  getMessages: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `),
  getMessage: db.prepare('SELECT * FROM messages WHERE id = ?'),
  searchMessages: db.prepare(`
    SELECT m.*, c.title AS conversation_title
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.deleted_at IS NULL
    ORDER BY m.updated_at DESC
  `),
  listFavorites: db.prepare('SELECT model_id FROM model_favorites ORDER BY created_at DESC'),
  addFavorite: db.prepare('INSERT OR IGNORE INTO model_favorites (model_id, created_at) VALUES (?, ?)'),
  removeFavorite: db.prepare('DELETE FROM model_favorites WHERE model_id = ?'),
  replaceModelsCache: db.prepare(`
    INSERT INTO models_cache (id, payload, fetched_at)
    VALUES (@id, @payload, @fetchedAt)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
  `),
  listCachedModels: db.prepare('SELECT payload FROM models_cache ORDER BY id ASC'),
};

export const paths = {
  storageDir,
  database: join(storageDir, 'aivax.sqlite'),
};

export function getSession() {
  return {
    accessToken: readJson('accessToken'),
    account: readJson('account'),
    lastModel: readJson('lastModel'),
  };
}

export function saveLogin({ accessToken, account }) {
  writeJson('accessToken', accessToken);
  writeJson('account', account);
}

export function logout() {
  statements.deleteSession.run('accessToken');
  statements.deleteSession.run('account');
}

export function setLastModel(model) {
  writeJson('lastModel', model);
}

export function createConversation({ title = 'New chat', model = '' } = {}) {
  const now = timestamp();
  const conversation = {
    id: crypto.randomUUID(),
    title,
    model,
    titleStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  statements.insertConversation.run(conversation);
  return getConversation(conversation.id);
}

export function ensureConversation(conversationId, model) {
  const existing = conversationId ? getConversation(conversationId) : null;
  if (existing) {
    if (model && model !== existing.model) {
      updateConversation(existing.id, { model });
    }
    return getConversation(existing.id);
  }
  return createConversation({ model });
}

export function updateConversation(id, { title = null, model = null, titleStatus = null } = {}) {
  statements.updateConversation.run({
    id,
    title,
    model,
    titleStatus,
    updatedAt: timestamp(),
  });
  return getConversation(id);
}

export function listConversations() {
  return statements.listConversations.all().map(mapConversation);
}

export function getConversation(id) {
  const row = statements.getConversation.get(id);
  return row ? mapConversation(row) : null;
}

export function deleteConversation(id) {
  const now = timestamp();
  statements.deleteConversation.run(now, now, id);
}

export function insertMessage(message) {
  const now = timestamp();
  const row = {
    id: message.id ?? crypto.randomUUID(),
    conversationId: message.conversationId,
    role: message.role,
    status: message.status ?? 'completed',
    content: message.content ?? '',
    segments: stringify(message.segments ?? []),
    attachments: stringify(message.attachments ?? []),
    continuations: stringify(message.continuations ?? []),
    createdAt: message.createdAt ?? now,
    updatedAt: now,
  };
  statements.insertMessage.run(row);
  touchConversation(row.conversationId);
  return getMessage(row.id);
}

export function updateMessage(id, patch) {
  statements.updateMessage.run({
    id,
    status: patch.status ?? null,
    content: patch.content ?? null,
    segments: patch.segments === undefined ? null : stringify(patch.segments),
    attachments: patch.attachments === undefined ? null : stringify(patch.attachments),
    continuations: patch.continuations === undefined ? null : stringify(patch.continuations),
    updatedAt: timestamp(),
  });
  const message = getMessage(id);
  if (message) {
    touchConversation(message.conversationId);
  }
  return message;
}

export function deleteMessage(id) {
  const message = getMessage(id);
  statements.deleteMessage.run(id);
  if (message) {
    touchConversation(message.conversationId);
  }
  return message;
}

export function getMessages(conversationId) {
  return statements.getMessages.all(conversationId).map(mapMessage);
}

export function getMessage(id) {
  const row = statements.getMessage.get(id);
  return row ? mapMessage(row) : null;
}

export function searchChats(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return statements.searchMessages.all()
    .map((row) => ({
      score: fuzzyScore(`${row.conversation_title} ${row.content}`.toLowerCase(), normalized),
      conversationId: row.conversation_id,
      messageId: row.id,
      title: row.conversation_title,
      role: row.role,
      content: row.content,
      updatedAt: row.updated_at,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 80);
}

export function forkConversation(id, { throughMessageId = null } = {}) {
  const source = getConversation(id);
  if (!source) return null;
  const target = createConversation({
    title: `${source.title} - Copy`,
    model: source.model,
  });
  const sourceMessages = getMessages(id);
  const throughIndex = throughMessageId
    ? sourceMessages.findIndex((message) => message.id === throughMessageId)
    : -1;
  const messages = throughIndex >= 0
    ? sourceMessages.slice(0, throughIndex + 1)
    : sourceMessages;
  const now = Date.now();
  for (let index = 0; index < messages.length; index += 1) {
    insertMessage({
      ...messages[index],
      id: crypto.randomUUID(),
      conversationId: target.id,
      createdAt: new Date(now + index).toISOString(),
    });
  }
  return {
    conversation: getConversation(target.id),
    messages: getMessages(target.id),
  };
}

export function listFavorites() {
  return statements.listFavorites.all().map((row) => row.model_id);
}

export function setFavorite(modelId, favorited) {
  if (favorited) {
    statements.addFavorite.run(modelId, timestamp());
  } else {
    statements.removeFavorite.run(modelId);
  }
  return listFavorites();
}

export function cacheModels(models) {
  const fetchedAt = timestamp();
  const write = db.transaction((items) => {
    for (const item of items) {
      statements.replaceModelsCache.run({
        id: item.id,
        payload: stringify(item),
        fetchedAt,
      });
    }
  });
  write(models);
}

export function listCachedModels() {
  return statements.listCachedModels.all().map((row) => parse(row.payload, null)).filter(Boolean);
}

export function toOpenAiMessages(conversationId, { excludeMessageId } = {}) {
  return getMessages(conversationId)
    .filter((message) => message.id !== excludeMessageId)
    .filter((message) => ['completed', 'sent', 'aborted'].includes(message.status))
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map(messageToApiBlock);
}

export function toOpenAiMessagesThroughUser(conversationId, beforeMessageId) {
  const messages = getMessages(conversationId);
  const beforeIndex = messages.findIndex((message) => message.id === beforeMessageId);
  const searchEnd = beforeIndex >= 0 ? beforeIndex : messages.length;
  const lastUserIndex = messages
    .slice(0, searchEnd)
    .findLastIndex((message) => message.role === 'user' && ['sent', 'completed'].includes(message.status));

  if (lastUserIndex < 0) return [];

  return messages
    .slice(0, lastUserIndex + 1)
    .filter((message) => ['completed', 'sent', 'aborted'].includes(message.status))
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map(messageToApiBlock);
}

function messageToApiBlock(message) {
  return {
    role: message.role,
    content: message.role === 'assistant'
      ? message.content
      : message.attachments.length === 0
        ? message.content
        : [
            ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
            ...message.attachments.map(attachmentToApiBlock),
          ],
  };
}

function attachmentToApiBlock(attachment) {
  if (attachment.kind === 'image_url') {
    return { type: 'image_url', image_url: { url: attachment.dataUrl } };
  }
  if (attachment.kind === 'video_url') {
    return { type: 'video_url', video_url: { url: attachment.dataUrl } };
  }
  if (attachment.kind === 'input_audio') {
    return {
      type: 'input_audio',
      input_audio: {
        data: attachment.base64,
        format: attachment.format ?? 'mp3',
      },
    };
  }
  return {
    type: 'file',
    file: {
      filename: attachment.name ?? 'attachment',
      file_data: attachment.dataUrl,
    },
  };
}

function touchConversation(id) {
  const conversation = getConversation(id);
  if (!conversation) return;
  updateConversation(id, {});
}

function fuzzyScore(source, query) {
  if (source.includes(query)) return 1000 + query.length;
  let score = 0;
  let sourceIndex = 0;
  let streak = 0;
  for (const char of query) {
    const found = source.indexOf(char, sourceIndex);
    if (found === -1) return 0;
    streak = found === sourceIndex ? streak + 1 : 0;
    score += 1 + streak * 2;
    sourceIndex = found + 1;
  }
  return score;
}

function writeJson(key, value) {
  statements.setSession.run({
    key,
    value: stringify(value),
    updatedAt: timestamp(),
  });
}

function readJson(key) {
  const row = statements.getSession.get(key);
  return row ? parse(row.value, null) : null;
}

function mapConversation(row) {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    titleStatus: row.title_status,
    firstPrompt: row.first_prompt ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    status: row.status,
    content: row.content,
    segments: parse(row.segments, []),
    attachments: parse(row.attachments, []),
    continuations: parse(row.continuations, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stringify(value) {
  return JSON.stringify(value ?? null);
}

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function timestamp() {
  return new Date().toISOString();
}
