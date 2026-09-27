import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { parentPort } from 'node:worker_threads';
import { buildOrchestrationOverview, resolveOverviewRange } from './overview-core.js';

const DEFAULT_DATABASE_PATH = join(homedir(), '.aivax', 'aivax.sqlite');

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeTagIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  for (const id of value) {
    if (typeof id === 'string' && id.trim()) ids.add(id);
  }
  return [...ids];
}

function mapGoal(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    specification: row.specification,
    status: row.status,
    revision: Number(row.revision) || 1,
    model: row.model,
    reasoningEffort: row.reasoning_effort || null,
    permissionMode: row.permission_mode,
    activeElapsedMs: Number(row.active_elapsed_ms) || 0,
    resumedAt: row.resumed_at || null,
    resultSummary: row.result_summary || null,
    tokensTransacted: row.tokens_transacted === null
      ? null
      : Number(row.tokens_transacted) || 0,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at || null,
  };
}

function mapConversation(row, goal) {
  const projectPath = resolve(row.project_path || homedir());
  const relativeProjectPath = relative(homedir(), projectPath);
  const tasks = parse(row.tasks, []);
  const blocked = goal?.status === 'blocked'
    || tasks.some((task) => task.status === 'inconclusive');

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
    conversationType: row.conversation_type,
    isSideChat: row.conversation_type === 'side',
    isSubagent: row.conversation_type === 'subagent',
    isRubberDuck: row.conversation_type === 'rubber_duck',
    isBot: row.conversation_type === 'bot',
    createdBy: row.created_by === 'agent' ? 'agent' : 'user',
    parentConversationId: row.parent_conversation_id || null,
    initialPrompt: row.initial_prompt || null,
    orchestrationMode: ['plan', 'ultra'].includes(row.orchestration_mode) ? row.orchestration_mode : null,
    autoForwardToParent: Boolean(row.auto_forward_to_parent),
    nextSubagentNameIndex: Number(row.next_subagent_name_index) || 0,
    contextCheckpoint: row.context_checkpoint || '',
    checkpointMessageId: row.checkpoint_message_id || null,
    contextTokens: Number(row.context_tokens) || 0,
    lastReasoningEffort: row.last_reasoning_effort || null,
    lastReasoningAt: row.last_reasoning_at || null,
    tags: normalizeTagIds(parse(row.tags, [])),
    goal,
    workStatus: blocked ? 'blocked' : null,
    firstPrompt: row.first_prompt ?? '',
    lastMessageRole: row.last_message_role ?? null,
    lastMessageStatus: row.last_message_status ?? null,
    lastMessageUpdatedAt: row.last_message_updated_at ?? null,
    needsAttention: ['error', 'aborted', 'streaming'].includes(row.last_message_status)
      || (
        row.last_message_role === 'user'
        && ['sent', 'waiting_mcp'].includes(row.last_message_status)
      ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || null,
    isArchived: Boolean(row.archived_at),
  };
}

function collectOverview({ databasePath, range, configuredModels, modelCatalog, now }) {
  const db = new DatabaseSync(databasePath ?? DEFAULT_DATABASE_PATH, { readOnly: true });
  try {
    const { from, to } = resolveOverviewRange(range, now);
    const conversations = db.prepare(`
      SELECT c.id, c.title, c.model, c.title_status, c.project_path, c.git_branch,
        c.conversation_type, c.created_by, c.parent_conversation_id, c.initial_prompt,
        c.orchestration_mode, c.auto_forward_to_parent, c.next_subagent_name_index,
        c.context_checkpoint, c.checkpoint_message_id, c.context_tokens, c.tasks, c.tags,
        c.created_at, c.updated_at, c.archived_at,
        latest.role AS last_message_role,
        latest.status AS last_message_status,
        latest.updated_at AS last_message_updated_at,
        COALESCE((
          SELECT content FROM messages
          WHERE conversation_id = c.id AND role = 'user' AND hidden = 0
          ORDER BY created_at LIMIT 1
        ), '') AS first_prompt
      FROM conversations c
      LEFT JOIN messages latest ON latest.id = (
        SELECT id FROM messages
        WHERE conversation_id = c.id AND hidden = 0 AND role IN ('user', 'assistant')
        ORDER BY created_at DESC, rowid DESC LIMIT 1
      )
      WHERE c.deleted_at IS NULL
        AND c.archived_at IS NULL
      ORDER BY c.updated_at DESC
    `).all();
    const goals = db.prepare(`
      SELECT id, conversation_id, specification, status, revision, model, reasoning_effort,
        permission_mode, active_elapsed_ms, resumed_at, result_summary, tokens_transacted,
        started_at, updated_at, ended_at
      FROM goals
      ORDER BY started_at DESC
    `).all();
    const goalByConversation = new Map();
    for (const goal of goals) {
      if (!goalByConversation.has(goal.conversation_id)) {
        goalByConversation.set(goal.conversation_id, mapGoal(goal));
      }
    }
    const allConversations = conversations.map((row) => (
      mapConversation(row, goalByConversation.get(row.id) ?? null)
    ));
    const messagesByConversation = Object.create(null);
    for (const row of db.prepare(`
      SELECT m.conversation_id, m.role, m.status, m.model, m.usage, m.created_at, m.hidden
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.deleted_at IS NULL
        AND c.archived_at IS NULL
        AND m.hidden = 0
      ORDER BY m.conversation_id ASC, m.created_at ASC, m.rowid ASC
    `).all()) {
      (messagesByConversation[row.conversation_id] ??= []).push({
        hidden: Boolean(row.hidden),
        role: row.role,
        status: row.status,
        model: row.model,
        usage: parse(row.usage, {}),
        createdAt: row.created_at,
      });
    }
    const extraInferenceUsage = db.prepare(`
      SELECT type, model, project_path, usage, created_at
      FROM inference_usage
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
    `).all(new Date(from).toISOString(), new Date(to).toISOString()).map((row) => ({
      type: row.type,
      model: row.model,
      projectPath: row.project_path ? resolve(row.project_path) : null,
      usage: parse(row.usage, {}),
      createdAt: row.created_at,
    }));
    return buildOrchestrationOverview({
      allConversations,
      messagesByConversation,
      extraInferenceUsage,
      configuredModels,
      modelCatalog,
      range,
      now,
    });
  } finally {
    db.close();
  }
}

parentPort.on('message', ({ id, payload }) => {
  try {
    parentPort.postMessage({ id, overview: collectOverview(payload) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error) });
  }
});
