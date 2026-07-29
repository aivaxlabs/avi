import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';

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
    project_path TEXT,
    git_branch TEXT,
    conversation_type TEXT NOT NULL DEFAULT 'thread',
    parent_conversation_id TEXT,
    context_checkpoint TEXT NOT NULL DEFAULT '',
    checkpoint_message_id TEXT,
    context_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (parent_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    model TEXT,
    reasoning_effort TEXT,
    status TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    segments TEXT NOT NULL DEFAULT '[]',
    attachments TEXT NOT NULL DEFAULT '[]',
    continuations TEXT NOT NULL DEFAULT '[]',
    usage TEXT NOT NULL DEFAULT '{}',
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
`);

if (!db.pragma('table_info(messages)').some((column) => column.name === 'usage')) {
  db.exec("ALTER TABLE messages ADD COLUMN usage TEXT NOT NULL DEFAULT '{}'");
}
if (!db.pragma('table_info(messages)').some((column) => column.name === 'model')) {
  db.exec('ALTER TABLE messages ADD COLUMN model TEXT');
}
if (!db.pragma('table_info(messages)').some((column) => column.name === 'reasoning_effort')) {
  db.exec('ALTER TABLE messages ADD COLUMN reasoning_effort TEXT');
}
const conversationColumns = db.pragma('table_info(conversations)');
if (!conversationColumns.some((column) => column.name === 'project_path')) {
  db.exec('ALTER TABLE conversations ADD COLUMN project_path TEXT');
}
if (!conversationColumns.some((column) => column.name === 'git_branch')) {
  db.exec('ALTER TABLE conversations ADD COLUMN git_branch TEXT');
}
if (!conversationColumns.some((column) => column.name === 'conversation_type')) {
  db.exec("ALTER TABLE conversations ADD COLUMN conversation_type TEXT NOT NULL DEFAULT 'thread'");
}
if (!conversationColumns.some((column) => column.name === 'parent_conversation_id')) {
  db.exec('ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT');
}
if (!conversationColumns.some((column) => column.name === 'context_checkpoint')) {
  db.exec("ALTER TABLE conversations ADD COLUMN context_checkpoint TEXT NOT NULL DEFAULT ''");
}
if (!conversationColumns.some((column) => column.name === 'checkpoint_message_id')) {
  db.exec('ALTER TABLE conversations ADD COLUMN checkpoint_message_id TEXT');
}
if (!conversationColumns.some((column) => column.name === 'context_tokens')) {
  db.exec('ALTER TABLE conversations ADD COLUMN context_tokens INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_conversations_parent
    ON conversations(parent_conversation_id, conversation_type, created_at);
`);
const conversationsWithoutContextUsage = db.prepare(`
  SELECT c.id, (
    SELECT usage
    FROM messages
    WHERE conversation_id = c.id AND role = 'assistant'
    ORDER BY created_at DESC
    LIMIT 1
  ) AS usage
  FROM conversations c
  WHERE c.context_tokens = 0
`).all();
const backfillContextUsage = db.prepare(`
  UPDATE conversations
  SET context_tokens = ?
  WHERE id = ?
`);
for (const row of conversationsWithoutContextUsage) {
  const inputTokens = Number(parse(row.usage, {})?.inputTokens) || 0;
  if (inputTokens > 0) {
    backfillContextUsage.run(inputTokens, row.id);
  }
}
db.exec(`
  DROP TABLE IF EXISTS models_cache;
  DROP TABLE IF EXISTS workspaces;
  DELETE FROM session_values
  WHERE key IN ('accessToken', 'account', 'activeWorkspaceId');
`);

const statements = {
  setValue: db.prepare(`
    INSERT INTO session_values (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  getValue: db.prepare('SELECT value FROM session_values WHERE key = ?'),
  insertConversation: db.prepare(`
    INSERT INTO conversations (
      id, title, model, title_status, project_path, git_branch,
      conversation_type, parent_conversation_id,
      context_checkpoint, checkpoint_message_id, context_tokens, created_at, updated_at
    )
    VALUES (
      @id, @title, @model, @titleStatus, @projectPath, @gitBranch,
      @conversationType, @parentConversationId,
      @contextCheckpoint, @checkpointMessageId, @contextTokens, @createdAt, @updatedAt
    )
  `),
  updateConversation: db.prepare(`
    UPDATE conversations
    SET title = COALESCE(@title, title),
        model = COALESCE(@model, model),
        title_status = COALESCE(@titleStatus, title_status),
        context_checkpoint = COALESCE(@contextCheckpoint, context_checkpoint),
        checkpoint_message_id = COALESCE(@checkpointMessageId, checkpoint_message_id),
        context_tokens = COALESCE(@contextTokens, context_tokens),
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
      AND conversation_type = 'thread'
      AND EXISTS (
        SELECT 1 FROM messages
        WHERE conversation_id = c.id
      )
    ORDER BY updated_at DESC
  `),
  listSideChats: db.prepare(`
    SELECT c.*,
      COALESCE((
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user'
        ORDER BY created_at LIMIT 1
      ), '') AS first_prompt
    FROM conversations c
    WHERE deleted_at IS NULL
      AND conversation_type = 'side'
      AND parent_conversation_id = ?
    ORDER BY created_at ASC
  `),
  listAllConversations: db.prepare(`
    SELECT c.*,
      COALESCE((
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user'
        ORDER BY created_at LIMIT 1
      ), '') AS first_prompt
    FROM conversations c
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
  `),
  getConversation: db.prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL'),
  deleteConversation: db.prepare('UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?'),
  hardDeleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
  hardDeleteSideChats: db.prepare(`
    DELETE FROM conversations
    WHERE conversation_type = 'side' AND parent_conversation_id = ?
  `),
  insertMessage: db.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, model, reasoning_effort, status, content, segments, attachments,
      continuations, usage, created_at, updated_at
    )
    VALUES (
      @id, @conversationId, @role, @model, @reasoningEffort, @status, @content, @segments, @attachments,
      @continuations, @usage, @createdAt, @updatedAt
    )
  `),
  updateMessage: db.prepare(`
    UPDATE messages
    SET status = COALESCE(@status, status),
        content = COALESCE(@content, content),
        segments = COALESCE(@segments, segments),
        attachments = COALESCE(@attachments, attachments),
        continuations = COALESCE(@continuations, continuations),
        usage = COALESCE(@usage, usage),
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
    WHERE c.deleted_at IS NULL AND c.conversation_type = 'thread'
    ORDER BY m.updated_at DESC
  `),
  listFavorites: db.prepare('SELECT model_id FROM model_favorites ORDER BY created_at DESC'),
  addFavorite: db.prepare('INSERT OR IGNORE INTO model_favorites (model_id, created_at) VALUES (?, ?)'),
  removeFavorite: db.prepare('DELETE FROM model_favorites WHERE model_id = ?'),
};

export function getPreferences() {
  return {
    lastModel: readJson('lastModel'),
  };
}

export function listProviders() {
  const providers = readJson('modelProviders');
  return Array.isArray(providers) ? providers : [];
}

export function setProviders(providers) {
  writeJson('modelProviders', providers);
  return listProviders();
}

export function setLastModel(model) {
  writeJson('lastModel', model);
}

export function closeDatabase() {
  if (db.open) db.close();
}

export function createConversation({
  title = 'New chat',
  model = '',
  projectPath = homedir(),
  gitBranch = null,
  conversationType = 'thread',
  parentConversationId = null,
  titleStatus = 'pending',
} = {}) {
  const now = timestamp();
  const conversation = {
    id: crypto.randomUUID(),
    title,
    model,
    titleStatus,
    projectPath: resolve(projectPath),
    gitBranch,
    conversationType,
    parentConversationId,
    contextCheckpoint: '',
    checkpointMessageId: null,
    contextTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
  statements.insertConversation.run(conversation);
  return getConversation(conversation.id);
}

export function ensureConversation(conversationId, model, project = {}) {
  const existing = conversationId ? getConversation(conversationId) : null;
  if (existing) {
    if (model && model !== existing.model) {
      updateConversation(existing.id, { model });
    }
    return getConversation(existing.id);
  }
  return createConversation({
    model,
    projectPath: project.path,
    gitBranch: project.gitBranch,
  });
}

export function updateConversation(id, {
  title = null,
  model = null,
  titleStatus = null,
  contextCheckpoint = null,
  checkpointMessageId = null,
  contextTokens = null,
} = {}) {
  statements.updateConversation.run({
    id,
    title,
    model,
    titleStatus,
    contextCheckpoint,
    checkpointMessageId,
    contextTokens,
    updatedAt: timestamp(),
  });
  return getConversation(id);
}

export function listConversations() {
  return statements.listConversations.all().map(mapConversation);
}

export function listAllConversations() {
  return statements.listAllConversations.all().map(mapConversation);
}

export function listSideChats(parentConversationId) {
  return statements.listSideChats.all(parentConversationId).map(mapConversation);
}

export function getConversation(id) {
  const row = statements.getConversation.get(id);
  return row ? mapConversation(row) : null;
}

export function deleteConversation(id, { hard = false } = {}) {
  if (hard) {
    statements.hardDeleteConversation.run(id);
    return;
  }
  const now = timestamp();
  statements.hardDeleteSideChats.run(id);
  statements.deleteConversation.run(now, now, id);
}

export function insertMessage(message) {
  const now = timestamp();
  const row = {
    id: message.id ?? crypto.randomUUID(),
    conversationId: message.conversationId,
    role: message.role,
    model: message.model ?? null,
    reasoningEffort: message.reasoningEffort ?? null,
    status: message.status ?? 'completed',
    content: message.content ?? '',
    segments: stringify(message.segments ?? []),
    attachments: stringify(message.attachments ?? []),
    continuations: stringify(message.continuations ?? []),
    usage: stringify(message.usage ?? {}),
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
    usage: patch.usage === undefined ? null : stringify(patch.usage),
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

export function forkConversation(id, {
  throughMessageId = null,
  sideChat = false,
} = {}) {
  const source = getConversation(id);
  if (!source || (sideChat && source.isSideChat)) return null;
  let sideChatNumber = null;
  if (sideChat) {
    sideChatNumber = Math.max(
      0,
      ...listSideChats(source.id).map((sideChat) => (
        Number(sideChat.title.match(/^Side chat (\d+)$/)?.[1]) || 0
      )),
    ) + 1;
  }
  const target = createConversation({
    title: sideChat ? `Side chat ${sideChatNumber}` : `${source.title} - Copy`,
    model: source.model,
    projectPath: source.projectPath,
    gitBranch: source.gitBranch,
    conversationType: sideChat ? 'side' : 'thread',
    parentConversationId: sideChat ? source.id : null,
    titleStatus: sideChat ? 'generated' : 'pending',
  });
  const sourceMessages = getMessages(id);
  const throughIndex = throughMessageId
    ? sourceMessages.findIndex((message) => message.id === throughMessageId)
    : -1;
  const messages = throughIndex >= 0
    ? sourceMessages.slice(0, throughIndex + 1)
    : sourceMessages.filter((message) => (
        !sideChat || !['queued', 'steered'].includes(message.status)
      ));
  const now = Date.now();
  const copiedMessageIds = new Map();
  for (let index = 0; index < messages.length; index += 1) {
    const messageId = crypto.randomUUID();
    copiedMessageIds.set(messages[index].id, messageId);
    insertMessage({
      ...messages[index],
      id: messageId,
      conversationId: target.id,
      status: sideChat && messages[index].status === 'streaming'
        ? 'completed'
        : messages[index].status,
      createdAt: new Date(now + index).toISOString(),
    });
  }
  updateConversation(target.id, {
    contextCheckpoint: source.contextCheckpoint,
    checkpointMessageId: copiedMessageIds.get(source.checkpointMessageId) ?? null,
    contextTokens: source.contextTokens,
  });
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

function sideChatContext(conversation) {
  if (conversation?.conversation_type !== 'side') return [];

  return [{
    role: 'system',
    content: [
      '<thread_context>',
      'thread_type: side_chat',
      `thread_id: ${conversation.id}`,
      `parent_thread_id: ${conversation.parent_conversation_id}`,
      'You are running inside a side chat forked from the parent thread.',
      'You cannot create another side chat from this thread.',
      '</thread_context>',
    ].join('\n'),
  }];
}

export function toModelMessages(conversationId, { excludeMessageId } = {}) {
  const conversation = statements.getConversation.get(conversationId);
  const messages = getMessages(conversationId);
  const checkpointIndex = conversation?.checkpoint_message_id
    ? messages.findIndex((message) => message.id === conversation.checkpoint_message_id)
    : -1;
  const hasCheckpoint = Boolean(conversation?.context_checkpoint) && checkpointIndex >= 0;
  const checkpoint = hasCheckpoint
    ? [{
        role: 'system',
        content: `<conversation_checkpoint>\n${conversation.context_checkpoint}\n</conversation_checkpoint>`,
      }]
    : [];

  return [
    ...sideChatContext(conversation),
    ...checkpoint,
    ...messages
      .slice(hasCheckpoint ? checkpointIndex + 1 : 0)
      .filter((message) => message.id !== excludeMessageId)
      .filter((message) => ['completed', 'sent', 'aborted'].includes(message.status))
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map(messageToApiBlock),
  ];
}

export function toModelMessagesThroughUser(
  conversationId,
  beforeMessageId,
  { includeFailedUser = false } = {},
) {
  const messages = getMessages(conversationId);
  const conversation = statements.getConversation.get(conversationId);
  const beforeIndex = messages.findIndex((message) => message.id === beforeMessageId);
  const searchEnd = beforeIndex >= 0 ? beforeIndex : messages.length;
  const lastUserIndex = messages
    .slice(0, searchEnd)
    .findLastIndex((message) => (
      message.role === 'user'
      && (
        ['sent', 'completed'].includes(message.status)
        || (includeFailedUser && message.status === 'error')
      )
    ));

  if (lastUserIndex < 0) return [];
  const lastUserMessageId = messages[lastUserIndex].id;

  const checkpointIndex = conversation?.checkpoint_message_id
    ? messages.findIndex((message) => message.id === conversation.checkpoint_message_id)
    : -1;
  const useCheckpoint = Boolean(conversation?.context_checkpoint)
    && checkpointIndex >= 0
    && checkpointIndex < lastUserIndex;
  return [
    ...sideChatContext(conversation),
    ...(useCheckpoint
      ? [{
          role: 'system',
          content: `<conversation_checkpoint>\n${conversation.context_checkpoint}\n</conversation_checkpoint>`,
        }]
      : []),
    ...messages
      .slice(useCheckpoint ? checkpointIndex + 1 : 0, lastUserIndex + 1)
      .filter((message) => (
        ['completed', 'sent', 'aborted'].includes(message.status)
        || message.id === lastUserMessageId
      ))
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map(messageToApiBlock),
  ];
}

function messageToApiBlock(message) {
  return {
    role: message.role,
    content: message.role === 'assistant'
      ? answerTextFromTextualBlocks(message.content)
      : message.attachments.length === 0
        ? message.content
        : [
            ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
            ...message.attachments.map(attachmentToApiBlock),
          ],
  };
}

function attachmentToApiBlock(attachment) {
  if (attachment.kind === 'context_marker') {
    return {
      type: 'text',
      text: attachment.text ?? '',
    };
  }
  if (attachment.kind === 'text_inline') {
    const filename = attachment.name ?? 'attachment.txt';
    return {
      type: 'text',
      text: `Attached file "${filename}":\n${attachment.text ?? ''}`,
    };
  }
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
  if (attachment.kind === 'file') {
    return {
      type: 'file',
      file: {
        filename: attachment.name ?? 'attachment',
        file_data: attachment.dataUrl,
      },
    };
  }
  return {
    type: 'text',
    text: `Attachment: ${attachment.name ?? 'unavailable'}`,
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
  statements.setValue.run({
    key,
    value: stringify(value),
    updatedAt: timestamp(),
  });
}

function readJson(key) {
  const row = statements.getValue.get(key);
  return row ? parse(row.value, null) : null;
}

function mapConversation(row) {
  const projectPath = resolve(row.project_path || homedir());
  const relativeProjectPath = relative(homedir(), projectPath);

  return {
    id: row.id,
    title: row.title,
    model: row.model,
    titleStatus: row.title_status,
    projectPath,
    projectName: relativeProjectPath === '' ? '~/' : basename(projectPath),
    projectDisplayPath: relativeProjectPath === ''
      ? '~/'
      : !relativeProjectPath.startsWith('..') && !isAbsolute(relativeProjectPath)
        ? `~/${relativeProjectPath.replaceAll('\\', '/')}`
        : projectPath,
    gitBranch: row.git_branch || null,
    isSideChat: row.conversation_type === 'side',
    parentConversationId: row.parent_conversation_id || null,
    contextCheckpoint: row.context_checkpoint || '',
    checkpointMessageId: row.checkpoint_message_id || null,
    contextTokens: Number(row.context_tokens) || 0,
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
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    status: row.status,
    content: row.content,
    segments: parse(row.segments, []),
    attachments: parse(row.attachments, []),
    continuations: parse(row.continuations, []),
    usage: parse(row.usage, {}),
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
