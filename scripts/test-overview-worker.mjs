import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { buildOrchestrationOverview, resolveOverviewRange } from '../src/main/overview-core.js';

const timestamp = (() => {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}-${iso.slice(14, 16)}-UTC`;
})();
const runParent = join(tmpdir(), '.avi', 'visualizations', timestamp, 'overview-worker');
mkdirSync(runParent, { recursive: true });
const tempDirectory = mkdtempSync(join(runParent, 'run-'));
const databasePath = join(tempDirectory, 'overview.sqlite');
const db = new DatabaseSync(databasePath);
const CONVERSATIONS = 60;
const MESSAGES_PER_CONVERSATION = 40;

function usage(index) {
  return JSON.stringify({
    inputTokens: 100 + index,
    cachedInputTokens: 10,
    outputTokens: 50 + index,
    totalTokens: 150 + index * 2,
    durationMs: 12,
  });
}

try {
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      title_status TEXT NOT NULL DEFAULT 'pending',
      project_path TEXT,
      git_branch TEXT,
      conversation_type TEXT NOT NULL DEFAULT 'thread',
      created_by TEXT NOT NULL DEFAULT 'user',
      parent_conversation_id TEXT,
      initial_prompt TEXT,
      orchestration_mode TEXT,
      auto_forward_to_parent INTEGER NOT NULL DEFAULT 0,
      next_subagent_name_index INTEGER NOT NULL DEFAULT 0,
      context_checkpoint TEXT NOT NULL DEFAULT '',
      checkpoint_message_id TEXT,
      context_tokens INTEGER NOT NULL DEFAULT 0,
      tasks TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      model TEXT,
      reasoning_effort TEXT,
      permission_mode TEXT,
      work_mode TEXT,
      ultra_mode INTEGER NOT NULL DEFAULT 0,
      goal_id TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      from_agent INTEGER NOT NULL DEFAULT 0,
      queue_priority INTEGER NOT NULL DEFAULT 0,
      queue_position INTEGER,
      stopped_by_user INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      segments TEXT NOT NULL DEFAULT '[]',
      edits TEXT NOT NULL DEFAULT '[]',
      attachments TEXT NOT NULL DEFAULT '[]',
      continuations TEXT NOT NULL DEFAULT '[]',
      usage TEXT NOT NULL DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE inference_usage (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      model TEXT NOT NULL,
      project_path TEXT,
      usage TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      specification TEXT NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      model TEXT NOT NULL,
      reasoning_effort TEXT,
      permission_mode TEXT NOT NULL,
      active_elapsed_ms INTEGER NOT NULL DEFAULT 0,
      resumed_at TEXT,
      result_summary TEXT,
      tokens_transacted INTEGER,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT
    );
  `);
  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, title, model, project_path, conversation_type, created_by, created_at, updated_at)
    VALUES (?, ?, 'providerA:model-x', ?, 'thread', 'user', ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, model, status, content, usage, created_at, updated_at, hidden)
    VALUES (?, ?, ?, 'providerA:model-x', ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const createdAt = new Date(now - 3_600_000).toISOString();
  let messageIndex = 0;
  for (let conversation = 0; conversation < CONVERSATIONS; conversation += 1) {
    const id = `conversation-${conversation}`;
    const title = `Conversation ${conversation}`;
    const projectPath = `/tmp/project-${conversation % 5}`;
    insertConversation.run(id, title, projectPath, createdAt, new Date(now - conversation * 60_000).toISOString());
    for (let message = 0; message < MESSAGES_PER_CONVERSATION; message += 1) {
      const role = message % 2 === 0 ? 'user' : 'assistant';
      const status = role === 'user' ? 'sent' : 'completed';
      insertMessage.run(
        `message-${messageIndex}`,
        id,
        role,
        status,
        `content ${messageIndex}`,
        role === 'assistant' ? usage(messageIndex) : '{}',
        createdAt,
        createdAt,
        messageIndex % 37 === 0 ? 1 : 0,
      );
      messageIndex += 1;
    }
  }
  db.prepare(`
    INSERT INTO conversations (id, title, model, project_path, conversation_type, created_by, created_at, updated_at, archived_at)
    VALUES ('archived-1', 'Archived', 'providerA:model-x', '/tmp/project-archived', 'thread', 'user', ?, ?, ?)
  `).run(createdAt, createdAt, createdAt);
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, status, content, usage, created_at, updated_at)
    VALUES ('archived-message-1', 'archived-1', 'assistant', 'completed', 'archived content', ?, ?, ?)
  `).run(usage(9999), createdAt, createdAt);
  db.prepare(`
    INSERT INTO goals (id, conversation_id, specification, status, model, permission_mode, started_at, updated_at)
    VALUES ('goal-1', 'conversation-0', 'spec', 'completed', 'providerA:model-x', 'approve_for_me', ?, ?)
  `).run(createdAt, createdAt);
  db.prepare(`
    INSERT INTO inference_usage (id, type, model, project_path, usage, created_at)
    VALUES ('usage-1', 'auxiliary', 'providerA:model-x', '/tmp/project-extra', ?, ?)
  `).run(usage(4242), createdAt);
  const hiddenCount = db.prepare('SELECT COUNT(*) AS total FROM messages WHERE hidden = 1').get().total;
  assert.ok(hiddenCount > 0, 'fixture has hidden messages excluded from aggregation');
  const outOfRangeAt = new Date(now - 30 * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, status, content, usage, created_at, updated_at)
    VALUES ('out-of-range-1', 'conversation-1', 'assistant', 'completed', 'stale content', ?, ?, ?)
  `).run(usage(7777), outOfRangeAt, outOfRangeAt);
  db.close();

  const configuredModels = {
    'providerA:model-x': { id: 'providerA:model-x', modelId: 'model-x', providerId: 'providerA' },
  };
  const modelCatalog = [{
    name: 'providerA/model-x',
    pricing: [{ tokenThreshold: 0, inputPerMillionTokens: 1, cachedInputPerMillionTokens: 0.5, outputPerMillionTokens: 2 }],
  }];
  const range = { from: new Date(now - 86_400_000).toISOString(), to: new Date(now).toISOString() };
  const { from, to } = resolveOverviewRange(range, now);
  assert.ok(from < to, 'range resolves to a bounded date scope');

  const worker = new Worker(new URL('../src/main/overview-worker.js', import.meta.url));
  worker.unref();
  let ticks = 0;
  try {
    const pending = new Map();
  let sequence = 0;
  worker.on('message', ({ id, overview, error }) => {
    const settle = pending.get(id);
    if (!settle) return;
    pending.delete(id);
    if (error) settle.reject(new Error(error));
    else settle.resolve(overview);
  });
  worker.on('error', (error) => {
    for (const settle of pending.values()) settle.reject(error);
    pending.clear();
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      const error = new Error(`Overview worker exited with code ${code}.`);
      for (const settle of pending.values()) settle.reject(error);
      pending.clear();
    }
  });
  const runOverview = (payload) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, payload });
  });

  const heartbeat = setInterval(() => {
    ticks += 1;
  }, 5);
  const [first, second] = await Promise.all([
    runOverview({ databasePath, range, configuredModels, modelCatalog, now }),
    runOverview({ databasePath, range, configuredModels, modelCatalog, now }),
  ]);
  clearInterval(heartbeat);
  assert.ok(ticks > 0, 'main thread stayed responsive during worker aggregation');
  assert.deepEqual(first, second);

  const readDb = new DatabaseSync(databasePath, { readOnly: true });
  const conversations = readDb.prepare('SELECT COUNT(*) AS total FROM conversations WHERE deleted_at IS NULL AND archived_at IS NULL').get();
  assert.equal(conversations.total, CONVERSATIONS);
  const messages = readDb.prepare(`
    SELECT COUNT(*) AS total
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.deleted_at IS NULL AND c.archived_at IS NULL AND m.hidden = 0
      AND m.role = 'assistant'
      AND m.created_at >= ? AND m.created_at <= ?
  `).get(new Date(now - 86_400_000).toISOString(), new Date(now).toISOString());
  assert.ok(messages.total > 0, 'fixture has active visible messages');
  readDb.close();
  const expected = messages.total;

  assert.ok(Array.isArray(first.ongoing), 'overview has ongoing list');
  assert.ok(Array.isArray(first.requiresAttention), 'overview has requiresAttention list');
  assert.ok(Array.isArray(first.recentlyCompleted), 'overview has recentlyCompleted list');
  assert.equal(first.metrics.responses, expected + 1);
  assert.equal(first.metrics.usageByType.find((entry) => entry.id === 'auxiliary')?.responses, 1);
  assert.equal(first.metrics.usageByType.find((entry) => entry.id === 'inference')?.responses, expected);
  assert.ok(
    first.ongoing.every((task) => !('messages' in task || 'latestMessage' in task || 'latestAssistant' in task)),
    'task rows omit transient aggregation fields',
  );
  const archivedLeak = [
    ...first.ongoing,
    ...first.requiresAttention,
    ...first.recentlyCompleted,
  ].some((task) => task.id === 'archived-1');
  assert.equal(archivedLeak, false);
  assert.ok(
    first.metrics.topModels.some((model) => model.id === 'providerA:model-x' && model.cost > 0),
    'pricing behavior preserved through catalog match',
  );
  const completedGoalTask = first.recentlyCompleted.find((task) => task.id === 'conversation-0');
  assert.ok(completedGoalTask, 'goal mapping preserved for completed conversation');
  assert.equal(completedGoalTask.goal?.status, 'completed');
  const direct = buildOrchestrationOverview({
    allConversations: [],
    messagesByConversation: {},
    extraInferenceUsage: [],
    configuredModels: {},
    modelCatalog: [],
    range,
    now,
  });
  assert.deepEqual(Object.keys(direct).sort(), ['metrics', 'ongoing', 'recentlyCompleted', 'requiresAttention']);
  } finally {
    await worker.terminate();
  }
  console.log(`overview worker test passed (${CONVERSATIONS} conversations, main-thread ticks=${ticks})`);
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}
