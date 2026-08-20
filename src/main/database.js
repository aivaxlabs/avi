import { DatabaseSync } from 'node:sqlite';
import { safeStorage } from 'electron';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';
import { normalizeDefaultModels } from './default-models.js';
import { searchChatsIn } from './search-core.js';
import { traceError } from './trace-log.js';

const storageDir = join(homedir(), '.aivax');
mkdirSync(storageDir, { recursive: true });

const db = new DatabaseSync(join(storageDir, 'aivax.sqlite'));
const secureStoragePath = join(storageDir, 'secure-storage.json');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
const secureStorage = {
  aivaxAccessToken: null,
  mcpOAuthSessions: {},
  providerCredentials: {},
  remoteApiKey: null,
};
const secureWrites = new Set();
let providerCredentialsKey = null;

const defaultTuningSettings = Object.freeze({
  personality: null,
  chatReasoningTraces: 'visible',
  continuationRepliesEnabled: true,
  automaticCompactionThreshold: 0.9,
  toolOutputLimit: 8_192,
  defaultPermissionMode: 'approve_for_me',
  messageDeliveryMode: 'queue',
  terminalShell: 'auto',
  terminalTimeoutSeconds: 30,
  maxConcurrentSubagents: 128,
  logLevel: 'minimal',
});
const defaultRemoteSettings = Object.freeze({
  enabled: false,
  port: 18992,
});
const defaultAivaxSettings = Object.freeze({
  memoryEnabled: false,
  memoryCollectionId: null,
  memoryCollectionName: null,
  advancedFetchEnabled: false,
  webSearchEnabled: false,
  mediaDescriptionsEnabled: false,
  threadSearchCollectionId: null,
  threadSearchCollectionName: null,
});
const defaultDesktopSettings = Object.freeze({
  closeToTray: false,
  openAtLogin: false,
  notifyOnCompletion: false,
});
const defaultArchiveSettings = Object.freeze({
  archiveAfterDays: 7,
  deleteArchivedAfterDays: 30,
  deleteDisposableAfterDays: 1,
});
const archiveRetentionOptions = Object.freeze([7, 30, null]);
const archivedDeletionOptions = Object.freeze([30, 60, null]);
const disposableDeletionOptions = Object.freeze([1, 7, 30, null]);
const subagentNames = Object.freeze([...new Set([
  'Euclid',
  'Archimedes',
  'Pythagoras',
  'Pascal',
  'Gauss',
  'Newton',
  'Euler',
  'Turing',
  'Fibonacci',
  'Descartes',
  'Socrates',
  'Plato',
  'Aristotle',
  'Seneca',
  'Epicurus',
  'Kant',
  'Nietzsche',
  'Spinoza',
  'Voltaire',
  'Confucius',
  'Hercules',
  'Perseus',
  'Achilles',
  'Ulysses',
  'Hector',
  'Jason',
  'Thor',
  'Odin',
  'Arthur',
  'Lancelot',
  'Merlin',
  'Robin',
  'Leonidas',
  'Spartacus',
  'Beowulf',
  'Aragorn',
  'Gandalf',
  'Conan',
  'Dante',
  'Dracula',
  'Sherlock',
  'Moriarty',
  'Loki',
  'Anubis',
  'Icarus',
  'Atlas',
  'Orpheus',
  'Zorro',
  'Maximus',
  'Neo',
  'Galileo',
  'Kepler',
  'Copernicus',
  'Faraday',
  'Tesla',
  'Darwin',
  'Hubble',
  'Hawking',
  'Curie',
  'Noether',
  'Hypatia',
  'Ada',
  'Sagan',
  'Feynman',
  'Riemann',
  'Leibniz',
  'Hilbert',
  'Ramanujan',
  'Thales',
  'Diogenes',
  'Marcus',
  'Aurelius',
  'Hume',
  'Locke',
  'Rousseau',
  'Camus',
  'Kierkegaard',
  'Laozi',
  'SunTzu',
  'Achilles',
  'Theseus',
  'Odysseus',
  'Aeneas',
  'Prometheus',
  'Apollo',
  'Ares',
  'Zeus',
  'Poseidon',
  'Horus',
  'Ra',
  'Osiris',
  'Siegfried',
  'Roland',
  'Hector',
  'Samson',
  'Solomon',
  'Dorian',
  'Hamlet',
  'Macbeth',
  'Phoenix',
  'Avicenna',
  'Averroes',
  'Alhazen',
  'AlKhwarizmi',
  'Eratosthenes',
  'Apollonius',
  'Brahmagupta',
  'Aryabhata',
  'Bhaskara',
  'Fermat',
  'Laplace',
  'Lagrange',
  'Fourier',
  'Galois',
  'Cantor',
  'Dedekind',
  'Minkowski',
  'Poincare',
  'Banach',
  'Kolmogorov',
  'Shannon',
  'Lovelace',
  'Hopper',
  'Bohr',
  'Planck',
  'Maxwell',
  'Heisenberg',
  'Schrodinger',
  'Dirac',
  'Pauli',
  'Rutherford',
  'Mendel',
  'Pasteur',
  'Franklin',
  'Meitner',
  'Bell',
  'Babbage',
  'Bernoulli',
  'Bayes',
  'Nash',
  'Conway',
  'Knuth',
  'Dijkstra',
  'Hamming',
  'Goedel',
  'Zeno',
  'Parmenides',
  'Heraclitus',
  'Democritus',
  'Plotinus',
  'Cicero',
  'Epictetus',
  'Aquinas',
  'Bacon',
  'Hobbes',
  'Berkeley',
  'Schopenhauer',
  'Wittgenstein',
  'Sartre',
  'Beauvoir',
  'Arendt',
  'Gilgamesh',
  'Enkidu',
  'Marduk',
  'Athena',
  'Artemis',
  'Freya',
  'Tyr',
  'Baldur',
  'Heimdall',
  'Skadi',
  'Fenrir',
  'Boudicca',
  'Hannibal',
  'Scipio',
  'Caesar',
  'Augustus',
  'Saladin',
  'Khalid',
  'Musashi',
  'Nobunaga',
  'Tomoe',
  'ElCid',
  'Bayard',
  'Cuchulainn',
  'Fionn',
  'Taliesin',
  'Galahad',
  'Percival',
  'Gawain',
  'Boromir',
  'Legolas',
  'Geralt',
  'Yennefer',
  'Ripley',
  'Morpheus',
  'Trinity',
  'Deckard',
  'Spock',
  'Andromeda',
])]);

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
    deleted_at TEXT,
    FOREIGN KEY (parent_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    icon_seed TEXT NOT NULL,
    personality TEXT,
    working_folder TEXT,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    context_size INTEGER,
    activation_period_minutes INTEGER NOT NULL DEFAULT 10,
    activation_mode TEXT NOT NULL DEFAULT 'static',
    max_activations INTEGER NOT NULL DEFAULT 10,
    activation_window TEXT NOT NULL DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    next_activation_at TEXT,
    idle_until TEXT,
    activation_count INTEGER NOT NULL DEFAULT 0,
    rotation_index INTEGER NOT NULL DEFAULT 0,
    active_assistant_message_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
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
    status TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    segments TEXT NOT NULL DEFAULT '[]',
    edits TEXT NOT NULL DEFAULT '[]',
    attachments TEXT NOT NULL DEFAULT '[]',
    continuations TEXT NOT NULL DEFAULT '[]',
    usage TEXT NOT NULL DEFAULT '{}',
    created_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inference_usage (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    model TEXT NOT NULL,
    project_path TEXT,
    usage TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS goals (
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
    ended_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversation_composer_states (
    conversation_id TEXT PRIMARY KEY,
    permission_mode TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    work_mode TEXT,
    ultra_mode INTEGER NOT NULL DEFAULT 0,
    draft_text TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_inference_usage_created
    ON inference_usage(created_at);

  CREATE INDEX IF NOT EXISTS idx_goals_conversation_started
    ON goals(conversation_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS model_favorites (
    model_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
`);

const messageColumns = db.prepare("PRAGMA table_info('messages')").all();
if (!messageColumns.some((column) => column.name === 'usage')) {
  db.exec("ALTER TABLE messages ADD COLUMN usage TEXT NOT NULL DEFAULT '{}'");
}
if (!messageColumns.some((column) => column.name === 'model')) {
  db.exec('ALTER TABLE messages ADD COLUMN model TEXT');
}
if (!messageColumns.some((column) => column.name === 'reasoning_effort')) {
  db.exec('ALTER TABLE messages ADD COLUMN reasoning_effort TEXT');
}
if (!messageColumns.some((column) => column.name === 'permission_mode')) {
  db.exec('ALTER TABLE messages ADD COLUMN permission_mode TEXT');
}
if (!messageColumns.some((column) => column.name === 'work_mode')) {
  db.exec('ALTER TABLE messages ADD COLUMN work_mode TEXT');
}
if (!messageColumns.some((column) => column.name === 'ultra_mode')) {
  db.exec('ALTER TABLE messages ADD COLUMN ultra_mode INTEGER NOT NULL DEFAULT 0');
}
if (!messageColumns.some((column) => column.name === 'goal_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN goal_id TEXT');
}
if (!messageColumns.some((column) => column.name === 'hidden')) {
  db.exec('ALTER TABLE messages ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
}
if (!messageColumns.some((column) => column.name === 'from_agent')) {
  db.exec('ALTER TABLE messages ADD COLUMN from_agent INTEGER NOT NULL DEFAULT 0');
}
if (!messageColumns.some((column) => column.name === 'queue_priority')) {
  db.exec('ALTER TABLE messages ADD COLUMN queue_priority INTEGER NOT NULL DEFAULT 0');
}
if (!messageColumns.some((column) => column.name === 'queue_position')) {
  db.exec('ALTER TABLE messages ADD COLUMN queue_position INTEGER');
}
if (!messageColumns.some((column) => column.name === 'edits')) {
  db.exec("ALTER TABLE messages ADD COLUMN edits TEXT NOT NULL DEFAULT '[]'");
}
if (db.prepare("PRAGMA table_info('messages')").all().find((column) => column.name === 'created_at')?.notnull) {
  db.exec(`
    BEGIN;
    DROP INDEX IF EXISTS idx_messages_conversation_created;
    ALTER TABLE messages RENAME TO messages_with_required_created_at;
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
      status TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      segments TEXT NOT NULL DEFAULT '[]',
      edits TEXT NOT NULL DEFAULT '[]',
      attachments TEXT NOT NULL DEFAULT '[]',
      continuations TEXT NOT NULL DEFAULT '[]',
      usage TEXT NOT NULL DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    INSERT INTO messages (
      id, conversation_id, role, model, reasoning_effort, permission_mode,
      work_mode, ultra_mode, goal_id, hidden, from_agent, queue_priority, queue_position,
      status, content, segments, edits, attachments, continuations, usage,
      created_at, updated_at
    ) SELECT
      id, conversation_id, role, model, reasoning_effort, permission_mode,
      work_mode, ultra_mode, goal_id, hidden, from_agent, queue_priority, queue_position,
      status, content, segments, edits, attachments, continuations, usage,
      created_at, updated_at
    FROM messages_with_required_created_at;
    DROP TABLE messages_with_required_created_at;
    CREATE INDEX idx_messages_conversation_created
      ON messages(conversation_id, created_at);
    COMMIT;
  `);
}
const botColumns = db.prepare("PRAGMA table_info('bots')").all();
if (!botColumns.some((column) => column.name === 'active_assistant_message_id')) {
  db.exec('ALTER TABLE bots ADD COLUMN active_assistant_message_id TEXT');
}
const conversationColumns = db.prepare("PRAGMA table_info('conversations')").all();
db.exec(`
  UPDATE messages
  SET status = 'aborted', updated_at = CURRENT_TIMESTAMP
  WHERE status = 'streaming'
    AND role IN ('assistant', 'system');
`);

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
if (!conversationColumns.some((column) => column.name === 'initial_prompt')) {
  db.exec('ALTER TABLE conversations ADD COLUMN initial_prompt TEXT');
}
if (!conversationColumns.some((column) => column.name === 'orchestration_mode')) {
  db.exec('ALTER TABLE conversations ADD COLUMN orchestration_mode TEXT');
}
if (!db.prepare("SELECT 1 FROM session_values WHERE key = 'conversationModesMigrated'").get()) {
  db.exec(`
    UPDATE conversations
    SET orchestration_mode = CASE
      WHEN (
        SELECT work_mode
        FROM conversation_composer_states
        WHERE conversation_id = conversations.id
      ) = 'plan' THEN 'plan'
      WHEN COALESCE((
        SELECT ultra_mode
        FROM conversation_composer_states
        WHERE conversation_id = conversations.id
      ), 0) = 1 THEN 'ultra'
      ELSE orchestration_mode
    END
    WHERE conversation_type != 'subagent' AND orchestration_mode IS NULL;

    INSERT INTO session_values (key, value, updated_at)
    VALUES ('conversationModesMigrated', 'true', CURRENT_TIMESTAMP);
  `);
}
if (!conversationColumns.some((column) => column.name === 'auto_forward_to_parent')) {
  db.exec('ALTER TABLE conversations ADD COLUMN auto_forward_to_parent INTEGER NOT NULL DEFAULT 0');
}
if (!conversationColumns.some((column) => column.name === 'next_subagent_name_index')) {
  db.exec('ALTER TABLE conversations ADD COLUMN next_subagent_name_index INTEGER NOT NULL DEFAULT 0');
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
if (!conversationColumns.some((column) => column.name === 'tasks')) {
  db.exec("ALTER TABLE conversations ADD COLUMN tasks TEXT NOT NULL DEFAULT '[]'");
}
if (!conversationColumns.some((column) => column.name === 'archived_at')) {
  db.exec('ALTER TABLE conversations ADD COLUMN archived_at TEXT');
}
if (!conversationColumns.some((column) => column.name === 'tags')) {
  db.exec("ALTER TABLE conversations ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
}
if (!conversationColumns.some((column) => column.name === 'created_by')) {
  db.exec("ALTER TABLE conversations ADD COLUMN created_by TEXT NOT NULL DEFAULT 'user'");
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_conversations_parent
    ON conversations(parent_conversation_id, conversation_type, created_at);
  CREATE INDEX IF NOT EXISTS idx_conversations_archive
    ON conversations(archived_at, conversation_type, updated_at);
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
  listTasks: db.prepare('SELECT tasks FROM conversations WHERE id = ?'),
  replaceTasks: db.prepare('UPDATE conversations SET tasks = ? WHERE id = ?'),
  insertGoal: db.prepare(`
    INSERT INTO goals (
      id, conversation_id, specification, status, revision, model, reasoning_effort,
      permission_mode, active_elapsed_ms, resumed_at, result_summary, tokens_transacted,
      started_at, updated_at, ended_at
    )
    VALUES (
      @id, @conversationId, @specification, @status, @revision, @model, @reasoningEffort,
      @permissionMode, @activeElapsedMs, @resumedAt, @resultSummary, @tokensTransacted,
      @startedAt, @updatedAt, @endedAt
    )
  `),
  updateGoal: db.prepare(`
    UPDATE goals
    SET specification = @specification,
        status = @status,
        revision = @revision,
        model = @model,
        reasoning_effort = @reasoningEffort,
        permission_mode = @permissionMode,
        active_elapsed_ms = @activeElapsedMs,
        resumed_at = @resumedAt,
        result_summary = @resultSummary,
        tokens_transacted = @tokensTransacted,
        updated_at = @updatedAt,
        ended_at = @endedAt
    WHERE id = @id
      AND conversation_id = @conversationId
  `),
  getGoal: db.prepare('SELECT * FROM goals WHERE id = ?'),
  getLatestGoal: db.prepare(`
    SELECT * FROM goals
    WHERE conversation_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `),
  listContinuingGoals: db.prepare(`
    SELECT * FROM goals
    WHERE status = 'active'
    ORDER BY started_at ASC
  `),
  insertConversation: db.prepare(`
    INSERT INTO conversations (
      id, title, model, title_status, project_path, git_branch,
      conversation_type, created_by, parent_conversation_id, initial_prompt, orchestration_mode,
      auto_forward_to_parent,
      context_checkpoint, checkpoint_message_id, context_tokens, tags, created_at, updated_at
    )
    VALUES (
      @id, @title, @model, @titleStatus, @projectPath, @gitBranch,
      @conversationType, @createdBy, @parentConversationId, @initialPrompt, @orchestrationMode,
      @autoForwardToParent,
      @contextCheckpoint, @checkpointMessageId, @contextTokens, @tags, @createdAt, @updatedAt
    )
  `),
  setConversationTags: db.prepare('UPDATE conversations SET tags = ? WHERE id = ?'),
  updateConversationProject: db.prepare('UPDATE conversations SET project_path = ?, updated_at = ? WHERE id = ?'),
  listConversationsWithTags: db.prepare("SELECT id, tags FROM conversations WHERE tags != '[]'"),
  updateConversation: db.prepare(`
    UPDATE conversations
    SET title = COALESCE(@title, title),
        model = COALESCE(@model, model),
        title_status = COALESCE(@titleStatus, title_status),
        orchestration_mode = CASE
          WHEN @orchestrationModeChanged = 1 THEN @orchestrationMode
          ELSE orchestration_mode
        END,
        context_checkpoint = COALESCE(@contextCheckpoint, context_checkpoint),
        checkpoint_message_id = COALESCE(@checkpointMessageId, checkpoint_message_id),
        context_tokens = COALESCE(@contextTokens, context_tokens),
        updated_at = @updatedAt
    WHERE id = @id
  `),
  updateNextSubagentNameIndex: db.prepare(`
    UPDATE conversations
    SET next_subagent_name_index = ?, updated_at = ?
    WHERE id = ?
  `),
  listConversations: db.prepare(`
    SELECT c.*,
      COALESCE((
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user' AND hidden = 0
        ORDER BY created_at LIMIT 1
      ), '') AS first_prompt,
      (
        SELECT role FROM messages
        WHERE conversation_id = c.id AND hidden = 0
          AND status NOT IN ('queued', 'steered')
        ORDER BY created_at DESC, rowid DESC LIMIT 1
      ) AS last_message_role,
      (
        SELECT status FROM messages
        WHERE conversation_id = c.id AND hidden = 0
          AND status NOT IN ('queued', 'steered')
        ORDER BY created_at DESC, rowid DESC LIMIT 1
      ) AS last_message_status
    FROM conversations c
    WHERE deleted_at IS NULL
      AND archived_at IS NULL
      AND conversation_type = 'thread'
      AND EXISTS (
        SELECT 1 FROM messages
        WHERE conversation_id = c.id AND hidden = 0
      )
    ORDER BY updated_at DESC
  `),
  listSideChats: db.prepare(`
    SELECT c.*,
      COALESCE((
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user' AND hidden = 0
        ORDER BY created_at LIMIT 1
      ), '') AS first_prompt
    FROM conversations c
    WHERE deleted_at IS NULL
      AND archived_at IS NULL
      AND conversation_type = 'side'
      AND parent_conversation_id = ?
    ORDER BY created_at ASC
  `),
  listSubagents: db.prepare(`
    SELECT c.*,
      COALESCE(c.initial_prompt, (
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user' AND hidden = 0
        ORDER BY created_at DESC LIMIT 1
      ), '') AS first_prompt
    FROM conversations c
    WHERE deleted_at IS NULL
      AND archived_at IS NULL
      AND conversation_type = 'subagent'
      AND parent_conversation_id = ?
    ORDER BY created_at ASC
  `),
  listAllConversations: db.prepare(`
    SELECT c.*,
      COALESCE((
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user' AND hidden = 0
        ORDER BY created_at LIMIT 1
      ), '') AS first_prompt
    FROM conversations c
    WHERE deleted_at IS NULL
      AND archived_at IS NULL
    ORDER BY updated_at DESC
  `),
  countArchivedConversations: db.prepare(`
    SELECT COUNT(*) AS total
    FROM conversations c
    WHERE deleted_at IS NULL
      AND archived_at IS NOT NULL
      AND conversation_type = 'thread'
      AND (@query = '' OR title LIKE @pattern ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM messages
        WHERE conversation_id = c.id AND hidden = 0
          AND content LIKE @pattern ESCAPE '\\'
      ))
  `),
  listArchivedConversations: db.prepare(`
    SELECT c.*,
      COALESCE((
        SELECT content FROM messages
        WHERE conversation_id = c.id AND role = 'user' AND hidden = 0
        ORDER BY created_at LIMIT 1
      ), '') AS first_prompt
    FROM conversations c
    WHERE deleted_at IS NULL
      AND archived_at IS NOT NULL
      AND conversation_type = 'thread'
      AND (@query = '' OR title LIKE @pattern ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM messages
        WHERE conversation_id = c.id AND hidden = 0
          AND content LIKE @pattern ESCAPE '\\'
      ))
    ORDER BY archived_at DESC
    LIMIT @limit OFFSET @offset
  `),
  getConversation: db.prepare(`
    SELECT c.*,
      (
        SELECT role FROM messages
        WHERE conversation_id = c.id AND hidden = 0
          AND status NOT IN ('queued', 'steered')
        ORDER BY created_at DESC, rowid DESC LIMIT 1
      ) AS last_message_role,
      (
        SELECT status FROM messages
        WHERE conversation_id = c.id AND hidden = 0
          AND status NOT IN ('queued', 'steered')
        ORDER BY created_at DESC, rowid DESC LIMIT 1
      ) AS last_message_status
    FROM conversations c
    WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL
  `),
  getComposerState: db.prepare(`
    SELECT * FROM conversation_composer_states WHERE conversation_id = ?
  `),
  upsertComposerState: db.prepare(`
    INSERT INTO conversation_composer_states (
      conversation_id, permission_mode, model, reasoning_effort, work_mode,
      ultra_mode, draft_text, attachments, updated_at
    ) VALUES (
      @conversationId, @permissionMode, @model, @reasoningEffort, @workMode,
      @ultraMode, @draftText, @attachments, @updatedAt
    )
    ON CONFLICT(conversation_id) DO UPDATE SET
      permission_mode = excluded.permission_mode,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      work_mode = excluded.work_mode,
      ultra_mode = excluded.ultra_mode,
      draft_text = excluded.draft_text,
      attachments = excluded.attachments,
      updated_at = excluded.updated_at
  `),
  archiveConversation: db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM conversations WHERE id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT c.id FROM conversations c
      JOIN descendants d ON c.parent_conversation_id = d.id
      WHERE c.deleted_at IS NULL
    )
    UPDATE conversations SET archived_at = ? WHERE id IN descendants
  `),
  archivedConversationExists: db.prepare(`
    SELECT 1 FROM conversations
    WHERE id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL
  `),
  restoreConversation: db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM conversations WHERE id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT c.id FROM conversations c
      JOIN descendants d ON c.parent_conversation_id = d.id
      WHERE c.deleted_at IS NULL
    )
    UPDATE conversations SET archived_at = NULL WHERE id IN descendants
  `),
  deleteConversation: db.prepare('UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?'),
  deleteConversationMessages: db.prepare(`
    DELETE FROM messages
    WHERE conversation_id = ?
  `),
  insertBot: db.prepare(`
    INSERT INTO bots (
      id, conversation_id, name, icon_seed, personality, working_folder, model,
      reasoning_effort, context_size, activation_period_minutes, activation_mode,
      max_activations, activation_window, instructions, status, next_activation_at,
      idle_until, activation_count, rotation_index, active_assistant_message_id,
      created_at, updated_at
    )
    VALUES (
      @id, @conversationId, @name, @iconSeed, @personality, @workingFolder, @model,
      @reasoningEffort, @contextSize, @activationPeriodMinutes, @activationMode,
      @maxActivations, @activationWindow, @instructions, @status, @nextActivationAt,
      @idleUntil, @activationCount, @rotationIndex, @activeAssistantMessageId,
      @createdAt, @updatedAt
    )
  `),
  updateBot: db.prepare(`
    UPDATE bots
    SET name = COALESCE(@name, name),
        icon_seed = COALESCE(@iconSeed, icon_seed),
        personality = CASE WHEN @personalityChanged = 1 THEN @personality ELSE personality END,
        working_folder = CASE WHEN @workingFolderChanged = 1 THEN @workingFolder ELSE working_folder END,
        model = COALESCE(@model, model),
        reasoning_effort = CASE WHEN @reasoningEffortChanged = 1 THEN @reasoningEffort ELSE reasoning_effort END,
        context_size = CASE WHEN @contextSizeChanged = 1 THEN @contextSize ELSE context_size END,
        activation_period_minutes = COALESCE(@activationPeriodMinutes, activation_period_minutes),
        activation_mode = COALESCE(@activationMode, activation_mode),
        max_activations = COALESCE(@maxActivations, max_activations),
        activation_window = COALESCE(@activationWindow, activation_window),
        instructions = COALESCE(@instructions, instructions),
        status = COALESCE(@status, status),
        updated_at = @updatedAt
    WHERE id = @id
  `),
  updateBotScheduler: db.prepare(`
    UPDATE bots
    SET status = COALESCE(@status, status),
        next_activation_at = COALESCE(@nextActivationAt, next_activation_at),
        idle_until = CASE
          WHEN @idleUntilChanged = 1 THEN @idleUntil
          ELSE idle_until
        END,
        activation_count = COALESCE(@activationCount, activation_count),
        rotation_index = COALESCE(@rotationIndex, rotation_index),
        active_assistant_message_id = CASE
          WHEN @activeAssistantMessageIdChanged = 1 THEN @activeAssistantMessageId
          ELSE active_assistant_message_id
        END,
        updated_at = @updatedAt
    WHERE id = @id
  `),
  getBot: db.prepare('SELECT * FROM bots WHERE id = ?'),
  getBotByConversation: db.prepare('SELECT * FROM bots WHERE conversation_id = ?'),
  listBots: db.prepare('SELECT * FROM bots ORDER BY created_at ASC'),
  deleteBot: db.prepare('DELETE FROM bots WHERE id = ?'),
  hardDeleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
  hardDeleteChildConversations: db.prepare(`
    DELETE FROM conversations
    WHERE conversation_type IN ('side', 'subagent') AND parent_conversation_id = ?
  `),
  archiveOldConversations: db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM conversations
      WHERE deleted_at IS NULL
        AND archived_at IS NULL
        AND conversation_type = 'thread'
        AND updated_at < @cutoff
      UNION ALL
      SELECT c.id FROM conversations c
      JOIN descendants d ON c.parent_conversation_id = d.id
      WHERE c.deleted_at IS NULL
    )
    UPDATE conversations SET archived_at = @archivedAt WHERE id IN descendants
  `),
  deleteExpiredArchived: db.prepare(`
    DELETE FROM conversations
    WHERE deleted_at IS NULL
      AND archived_at IS NOT NULL
      AND conversation_type = 'thread'
      AND archived_at < ?
  `),
  deleteExpiredDisposable: db.prepare(`
    DELETE FROM conversations
    WHERE deleted_at IS NULL
      AND conversation_type IN ('side', 'subagent')
      AND updated_at < ?
  `),
  conversationCounts: db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
    FROM conversations
    WHERE deleted_at IS NULL
  `),
  insertMessage: db.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, model, reasoning_effort, permission_mode,
      work_mode, ultra_mode, goal_id, hidden, from_agent, queue_priority, queue_position,
      status, content, segments, edits, attachments,
      continuations, usage, created_at, updated_at
    )
    VALUES (
      @id, @conversationId, @role, @model, @reasoningEffort, @permissionMode,
      @workMode, @ultraMode, @goalId, @hidden, @fromAgent, @queuePriority, @queuePosition,
      @status, @content, @segments, @edits, @attachments,
      @continuations, @usage, @createdAt, @updatedAt
    )
  `),
  updateMessage: db.prepare(`
    UPDATE messages
    SET status = COALESCE(@status, status),
        content = COALESCE(@content, content),
        segments = COALESCE(@segments, segments),
        edits = COALESCE(@edits, edits),
        attachments = COALESCE(@attachments, attachments),
        continuations = COALESCE(@continuations, continuations),
        usage = COALESCE(@usage, usage),
        created_at = COALESCE(@createdAt, created_at),
        updated_at = @updatedAt
    WHERE id = @id
  `),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
  listMessagesFrom: db.prepare(`
    SELECT id FROM messages
    WHERE conversation_id = ?
      AND rowid >= (
        SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?
      )
    ORDER BY rowid ASC
  `),
  clearCheckpointFrom: db.prepare(`
    UPDATE conversations
    SET context_checkpoint = '', checkpoint_message_id = NULL, context_tokens = 0
    WHERE id = ?
      AND checkpoint_message_id IN (
        SELECT id FROM messages
        WHERE conversation_id = ?
          AND rowid >= (
            SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?
          )
      )
  `),
  deleteMessagesFrom: db.prepare(`
    DELETE FROM messages
    WHERE conversation_id = ?
      AND rowid >= (
        SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?
      )
  `),
  updateQueuePosition: db.prepare(`
    UPDATE messages
    SET queue_position = ?, updated_at = ?
    WHERE id = ? AND conversation_id = ? AND status = ?
  `),
  getMessages: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `),
  getMessage: db.prepare('SELECT * FROM messages WHERE id = ?'),
  insertInferenceUsage: db.prepare(`
    INSERT INTO inference_usage (id, type, model, project_path, usage, created_at)
    VALUES (@id, @type, @model, @projectPath, @usage, @createdAt)
  `),
  listInferenceUsage: db.prepare(`
    SELECT * FROM inference_usage
    WHERE created_at >= ? AND created_at <= ?
    ORDER BY created_at ASC
  `),
  listFavorites: db.prepare('SELECT model_id FROM model_favorites ORDER BY created_at DESC'),
  addFavorite: db.prepare('INSERT OR IGNORE INTO model_favorites (model_id, created_at) VALUES (?, ?)'),
  removeFavorite: db.prepare('DELETE FROM model_favorites WHERE model_id = ?'),
};

export function getPreferences() {
  return {
    lastModel: readJson('lastModel'),
    defaultModels: normalizeDefaultModels(readJson('defaultModels')),
    tuning: normalizeTuningSettings(readJson('tuningSettings')),
    desktop: normalizeDesktopSettings(readJson('desktopSettings')),
    aivax: { ...getAivaxSettings(), connected: Boolean(getAivaxAccessToken()) },
    archive: getArchiveSettings(),
    chatTags: getChatTags(),
    folderColors: getFolderColors(),
  };
}

const hexColorPattern = /^#[0-9a-f]{6}$/i;
const defaultChatTags = [
  { id: 'review', name: 'Review', color: '#e3b341' },
  { id: 'important', name: 'Important', color: '#e5484d' },
  { id: 'blocked', name: 'Blocked', color: '#8b8d98' },
];

function normalizeTagIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  for (const id of value) {
    if (typeof id === 'string' && id.trim()) ids.add(id);
  }
  return [...ids];
}

function normalizeChatTags(value) {
  if (!Array.isArray(value)) return defaultChatTags.map((tag) => ({ ...tag }));
  const tags = [];
  const ids = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    const color = typeof entry.color === 'string' && hexColorPattern.test(entry.color.trim())
      ? entry.color.trim().toLowerCase()
      : defaultChatTags[0].color;
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : crypto.randomUUID();
    while (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    tags.push({ id, name, color });
  }
  return tags;
}

export function getChatTags() {
  const stored = readJson('chatTags');
  return stored === null
    ? defaultChatTags.map((tag) => ({ ...tag }))
    : normalizeChatTags(stored);
}

export function setChatTags(value) {
  const tags = normalizeChatTags(value);
  writeJson('chatTags', tags);
  const keptIds = new Set(tags.map((tag) => tag.id));
  for (const row of statements.listConversationsWithTags.all()) {
    const current = normalizeTagIds(parse(row.tags, []));
    const next = current.filter((id) => keptIds.has(id));
    if (next.length !== current.length) {
      statements.setConversationTags.run(stringify(next), row.id);
    }
  }
  return tags;
}

function normalizeFolderColors(value) {
  const colors = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return colors;
  for (const [folderPath, color] of Object.entries(value)) {
    if (typeof folderPath !== 'string' || !folderPath.trim()) continue;
    if (typeof color !== 'string' || !hexColorPattern.test(color)) continue;
    colors[resolve(folderPath)] = color.toLowerCase();
  }
  return colors;
}

export function getFolderColors() {
  return normalizeFolderColors(readJson('folderColors'));
}

export function setFolderColor(folderPath, color) {
  const colors = normalizeFolderColors(readJson('folderColors'));
  const path = resolve(String(folderPath ?? ''));
  if (typeof color === 'string' && hexColorPattern.test(color)) {
    colors[path] = color.toLowerCase();
  } else {
    delete colors[path];
  }
  writeJson('folderColors', colors);
  return colors;
}

export function setDesktopSettings(value) {
  const settings = normalizeDesktopSettings(value, true);
  writeJson('desktopSettings', settings);
  return settings;
}

export function getArchiveSettings() {
  return normalizeArchiveSettings(readJson('archiveSettings'));
}

export function setArchiveSettings(value) {
  const settings = normalizeArchiveSettings(value, true);
  writeJson('archiveSettings', settings);
  return settings;
}

export function setDefaultModels(value) {
  const settings = normalizeDefaultModels(value, true);
  writeJson('defaultModels', settings);
  return settings;
}

export function setTuningSettings(value) {
  const tuning = normalizeTuningSettings(value, true);
  writeJson('tuningSettings', tuning);
  return tuning;
}

export function getRemoteSettings() {
  return normalizeRemoteSettings(readJson('remoteSettings'));
}

export function setRemoteSettings(value) {
  const settings = normalizeRemoteSettings(value, true);
  writeJson('remoteSettings', settings);
  return settings;
}

export function getAivaxSettings() {
  return normalizeAivaxSettings(readJson('aivaxSettings'));
}

export function setAivaxSettings(value) {
  const settings = normalizeAivaxSettings(value, true);
  writeJson('aivaxSettings', settings);
  return settings;
}

export function getThreadSearchManifest(collectionId) {
  const manifests = readJson('threadSearchManifests');
  return manifests && typeof manifests === 'object' && manifests[collectionId]
    ? manifests[collectionId]
    : {};
}

export function setThreadSearchManifest(collectionId, manifest) {
  const manifests = readJson('threadSearchManifests');
  writeJson('threadSearchManifests', {
    ...(manifests && typeof manifests === 'object' ? manifests : {}),
    [collectionId]: manifest,
  });
  return manifest;
}

export function getAivaxAccessToken() {
  return secureStorage.aivaxAccessToken;
}

export function setAivaxAccessToken(value) {
  writeSecureFileValue('aivax-access-token', value);
  secureStorage.aivaxAccessToken = value;
}

export function deleteAivaxAccessToken() {
  deleteSecureFileValue('aivax-access-token');
  secureStorage.aivaxAccessToken = null;
}

export function getRemoteApiKey() {
  return secureStorage.remoteApiKey;
}

export async function setRemoteApiKey(value = randomBytes(32).toString('base64url')) {
  writeSecureFileValue('remote-api-key', value);
  secureStorage.remoteApiKey = value;
  return value;
}

export async function deleteRemoteApiKey() {
  deleteSecureFileValue('remote-api-key');
  secureStorage.remoteApiKey = null;
}

export function listProviders() {
  const providers = readJson('modelProviders');
  return Array.isArray(providers) ? providers : [];
}

export function setProviders(providers) {
  writeJson('modelProviders', providers);
  return listProviders();
}

export function listModelRouters() {
  const routers = readJson('modelRouters');
  return Array.isArray(routers) ? routers : [];
}

export function setModelRouters(routers) {
  writeJson('modelRouters', routers);
  return listModelRouters();
}

export function setLastModel(model) {
  writeJson('lastModel', model);
}

export function getMcpOAuthSessions() {
  return secureStorage.mcpOAuthSessions;
}

export function setMcpOAuthSessions(sessions) {
  secureStorage.mcpOAuthSessions = sessions;
  persistSecureValue('mcp-oauth-sessions', sessions);
}

export function getProviderCredentials(providerId) {
  return secureStorage.providerCredentials[providerId] ?? null;
}

export async function setProviderCredentials(providerId, value) {
  const previous = secureStorage.providerCredentials[providerId];
  secureStorage.providerCredentials[providerId] = value;
  try {
    persistProviderCredentials();
  } catch (error) {
    if (previous === undefined) {
      delete secureStorage.providerCredentials[providerId];
    } else {
      secureStorage.providerCredentials[providerId] = previous;
    }
    traceError('database.secure-storage-error', {
      operation: 'set-provider-credentials',
      provider_id: providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function deleteProviderCredentials(providerId) {
  const previous = secureStorage.providerCredentials[providerId];
  delete secureStorage.providerCredentials[providerId];
  try {
    persistProviderCredentials();
  } catch (error) {
    if (previous !== undefined) secureStorage.providerCredentials[providerId] = previous;
    traceError('database.secure-storage-error', {
      operation: 'delete-provider-credentials',
      provider_id: providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function initializeSecureStorage() {
  const mcpOAuthSessions = readSecureFileValue('mcp-oauth-sessions');
  const storedKey = readSecureFileValue('provider-credentials-key');
  const legacyProviderCredentials = readSecureFileValue('provider-credentials');
  const remoteApiKey = readSecureFileValue('remote-api-key');
  const aivaxAccessToken = readSecureFileValue('aivax-access-token');
  secureStorage.mcpOAuthSessions = mcpOAuthSessions ? parse(mcpOAuthSessions, {}) : {};
  secureStorage.remoteApiKey = remoteApiKey || null;
  secureStorage.aivaxAccessToken = aivaxAccessToken || null;
  const encryptedCredentials = readJson('providerCredentialsV2');

  let currentEncryptedCredentials = encryptedCredentials;
  if (storedKey) {
    providerCredentialsKey = Buffer.from(storedKey, 'base64');
    if (providerCredentialsKey.length !== 32) {
      throw new Error('The provider credential encryption key is invalid.');
    }
  } else {
    providerCredentialsKey = randomBytes(32);
    writeSecureFileValue('provider-credentials-key', providerCredentialsKey.toString('base64'));
    if (encryptedCredentials) {
      writeJson('providerCredentialsBunBackup', encryptedCredentials);
      writeJson('providerCredentialsV2', null);
      currentEncryptedCredentials = null;
      traceError('secure-storage.bun-credentials-unavailable', {
        error: 'Provider credentials must be configured again after the Electron migration.',
      });
    }
  }

  if (currentEncryptedCredentials) {
    if (
      currentEncryptedCredentials.version !== 1
      || typeof currentEncryptedCredentials.iv !== 'string'
      || typeof currentEncryptedCredentials.authTag !== 'string'
      || typeof currentEncryptedCredentials.ciphertext !== 'string'
    ) {
      throw new Error('The encrypted provider credentials are invalid.');
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        providerCredentialsKey,
        Buffer.from(currentEncryptedCredentials.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(currentEncryptedCredentials.authTag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(currentEncryptedCredentials.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      const credentials = JSON.parse(decrypted);
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
        throw new Error();
      }
      secureStorage.providerCredentials = credentials;
    } catch {
      throw new Error('The encrypted provider credentials could not be decrypted.');
    }
  } else if (legacyProviderCredentials) {
    const credentials = parse(legacyProviderCredentials, null);
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      throw new Error('The legacy provider credentials are invalid.');
    }
    secureStorage.providerCredentials = credentials;
    persistProviderCredentials();
    deleteSecureFileValue('provider-credentials');
  } else {
    secureStorage.providerCredentials = {};
  }
}

export async function flushSecureStorage() {
  await Promise.allSettled(secureWrites);
}

export function closeDatabase() {
  db.close();
}

export function listTasks(conversationId) {
  return parse(statements.listTasks.get(conversationId)?.tasks, []);
}

export function replaceTasks(conversationId, tasks) {
  statements.replaceTasks.run(stringify(tasks), conversationId);
  return listTasks(conversationId);
}

export function insertGoal(goal) {
  statements.insertGoal.run(goalParameters(goal, true));
  return getGoal(goal.id);
}

export function updateGoal(goal) {
  statements.updateGoal.run(goalParameters(goal));
  return getGoal(goal.id);
}

export function getGoal(id) {
  const row = statements.getGoal.get(id);
  return row ? mapGoal(row) : null;
}

export function getGoalForConversation(conversationId) {
  const row = statements.getLatestGoal.get(conversationId);
  return row ? mapGoal(row) : null;
}

export function listContinuingGoals() {
  return statements.listContinuingGoals.all().map(mapGoal);
}

export function createConversation({
  title = 'New chat',
  model = '',
  projectPath = homedir(),
  gitBranch = null,
  conversationType = 'thread',
  createdBy = 'user',
  parentConversationId = null,
  initialPrompt = null,
  orchestrationMode = null,
  autoForwardToParent = false,
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
    createdBy: ['user', 'agent'].includes(createdBy) ? createdBy : 'user',
    parentConversationId,
    initialPrompt,
    orchestrationMode: ['plan', 'ultra'].includes(orchestrationMode) ? orchestrationMode : null,
    autoForwardToParent: autoForwardToParent ? 1 : 0,
    contextCheckpoint: '',
    checkpointMessageId: null,
    contextTokens: 0,
    tags: '[]',
    createdAt: now,
    updatedAt: now,
  };
  statements.insertConversation.run(conversation);
  return getConversation(conversation.id);
}

export function ensureConversation(
  conversationId,
  model,
  project = {},
  orchestrationMode = null,
) {
  const existing = conversationId ? getConversation(conversationId) : null;
  if (existing) {
    const updates = {
      ...(model && model !== existing.model ? { model } : {}),
      ...(
        !existing.orchestrationMode && ['plan', 'ultra'].includes(orchestrationMode)
          ? { orchestrationMode }
          : {}
      ),
    };
    if (Object.keys(updates).length > 0) updateConversation(existing.id, updates);
    return getConversation(existing.id);
  }
  return createConversation({
    model,
    projectPath: project.path,
    gitBranch: project.gitBranch,
    orchestrationMode,
  });
}

export function updateConversation(id, {
  title = null,
  model = null,
  titleStatus = null,
  orchestrationMode = undefined,
  contextCheckpoint = null,
  checkpointMessageId = null,
  contextTokens = null,
} = {}) {
  statements.updateConversation.run({
    id,
    title,
    model,
    titleStatus,
    orchestrationMode: ['plan', 'ultra'].includes(orchestrationMode)
      ? orchestrationMode
      : null,
    orchestrationModeChanged: orchestrationMode !== undefined ? 1 : 0,
    contextCheckpoint,
    checkpointMessageId,
    contextTokens,
    updatedAt: timestamp(),
  });
  return getConversation(id);
}

export function setConversationTags(id, tags) {
  statements.setConversationTags.run(stringify(normalizeTagIds(tags)), id);
  return getConversation(id);
}

export function updateConversationProject(id, projectPath) {
  statements.updateConversationProject.run(resolve(projectPath), timestamp(), id);
  return getConversation(id);
}

export function listConversations() {
  return statements.listConversations.all().map(mapConversation);
}

export function listAllConversations() {
  return statements.listAllConversations.all().map(mapConversation);
}

export function countArchivedConversations(query = '') {
  const normalized = String(query ?? '').trim();
  const pattern = `%${normalized.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  return Number(statements.countArchivedConversations.get({
    query: normalized,
    pattern,
  })?.total) || 0;
}

export function listArchivedConversations(query = '', { limit = 200, offset = 0 } = {}) {
  const normalized = String(query ?? '').trim();
  const pattern = `%${normalized.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  return statements.listArchivedConversations
    .all({
      query: normalized,
      pattern,
      limit: Math.max(1, Math.trunc(Number(limit)) || 200),
      offset: Math.max(0, Math.trunc(Number(offset)) || 0),
    })
    .map(mapConversation);
}

export function listSideChats(parentConversationId) {
  return statements.listSideChats.all(parentConversationId).map(mapConversation);
}

export function listSubagents(parentConversationId) {
  return statements.listSubagents.all(parentConversationId).map(mapConversation);
}

export function clearConversationMessages(conversationId) {
  statements.deleteConversationMessages.run(conversationId);
  updateConversation(conversationId, {
    contextCheckpoint: '',
    checkpointMessageId: null,
    contextTokens: 0,
  });
  return getConversation(conversationId);
}

const botActivationModes = Object.freeze(['static', 'smart']);

function normalizeActivationWindow(window) {
  const source = typeof window === 'string' ? parse(window, {}) : (window ?? {});
  const days = [...new Set((Array.isArray(source.days) ? source.days : [])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
  const normalizeMinute = (minute) => {
    const value = Number(minute);
    return Number.isInteger(value) && value >= 0 && value < 1440 ? value : null;
  };
  const startMinute = normalizeMinute(source.startMinute);
  const endMinute = normalizeMinute(source.endMinute);
  return {
    days,
    ...(startMinute !== null ? { startMinute } : {}),
    ...(endMinute !== null ? { endMinute } : {}),
  };
}

function mapBot(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    iconSeed: row.icon_seed,
    personality: row.personality || null,
    workingFolder: row.working_folder || null,
    model: row.model,
    reasoningEffort: row.reasoning_effort || null,
    contextSize: row.context_size === null ? null : (Number(row.context_size) || 0),
    activationPeriodMinutes: Math.max(1, Number(row.activation_period_minutes) || 10),
    activationMode: botActivationModes.includes(row.activation_mode) ? row.activation_mode : 'static',
    maxActivations: Math.max(0, Number(row.max_activations) || 0),
    activationWindow: normalizeActivationWindow(row.activation_window),
    instructions: row.instructions || '',
    status: ['active', 'sleeping', 'paused'].includes(row.status) ? row.status : 'active',
    nextActivationAt: row.next_activation_at || null,
    idleUntil: row.idle_until || null,
    activationCount: Math.max(0, Number(row.activation_count) || 0),
    rotationIndex: Math.max(0, Number(row.rotation_index) || 0),
    activeAssistantMessageId: row.active_assistant_message_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBot({
  conversationId,
  name,
  iconSeed,
  personality = null,
  workingFolder = null,
  model,
  reasoningEffort = null,
  contextSize = null,
  activationPeriodMinutes = 10,
  activationMode = 'static',
  maxActivations = 10,
  activationWindow = {},
  instructions = '',
  status = 'active',
  nextActivationAt = null,
}) {
  const now = timestamp();
  statements.insertBot.run({
    id: crypto.randomUUID(),
    conversationId,
    name,
    iconSeed,
    personality,
    workingFolder,
    model,
    reasoningEffort,
    contextSize,
    activationPeriodMinutes: Math.max(1, Number(activationPeriodMinutes) || 10),
    activationMode: botActivationModes.includes(activationMode) ? activationMode : 'static',
    maxActivations: Math.max(0, Number(maxActivations) || 0),
    activationWindow: stringify(normalizeActivationWindow(activationWindow)),
    instructions: String(instructions ?? ''),
    status: ['active', 'sleeping', 'paused'].includes(status) ? status : 'active',
    nextActivationAt,
    idleUntil: null,
    activationCount: 0,
    rotationIndex: 0,
    activeAssistantMessageId: null,
    createdAt: now,
    updatedAt: now,
  });
  return getBotByConversation(conversationId);
}

export function updateBot(id, changes = {}) {
  const changed = (key) => (Object.prototype.hasOwnProperty.call(changes, key) ? 1 : 0);
  statements.updateBot.run({
    id,
    name: changes.name ?? null,
    iconSeed: changes.iconSeed ?? null,
    personality: changes.personality ?? null,
    personalityChanged: changed('personality'),
    workingFolder: changes.workingFolder ?? null,
    workingFolderChanged: changed('workingFolder'),
    model: changes.model ?? null,
    reasoningEffort: changes.reasoningEffort ?? null,
    reasoningEffortChanged: changed('reasoningEffort'),
    contextSize: changes.contextSize ?? null,
    contextSizeChanged: changed('contextSize'),
    activationPeriodMinutes: changes.activationPeriodMinutes ?? null,
    activationMode: changes.activationMode ?? null,
    maxActivations: changes.maxActivations ?? null,
    activationWindow: changes.activationWindow === undefined
      ? null
      : stringify(normalizeActivationWindow(changes.activationWindow)),
    instructions: changes.instructions ?? null,
    status: changes.status ?? null,
    updatedAt: timestamp(),
  });
  return getBot(id);
}

export function updateBotScheduler(id, changes = {}) {
  statements.updateBotScheduler.run({
    id,
    status: changes.status ?? null,
    nextActivationAt: changes.nextActivationAt ?? null,
    idleUntil: changes.idleUntil === 'clear' ? null : (changes.idleUntil ?? null),
    idleUntilChanged: Object.prototype.hasOwnProperty.call(changes, 'idleUntil') ? 1 : 0,
    activationCount: changes.activationCount ?? null,
    rotationIndex: changes.rotationIndex ?? null,
    activeAssistantMessageId: changes.activeAssistantMessageId ?? null,
    activeAssistantMessageIdChanged: Object.prototype.hasOwnProperty.call(
      changes,
      'activeAssistantMessageId',
    ) ? 1 : 0,
    updatedAt: timestamp(),
  });
  return getBot(id);
}

export function getBot(id) {
  const row = statements.getBot.get(id);
  return row ? mapBot(row) : null;
}

export function getBotByConversation(conversationId) {
  const row = statements.getBotByConversation.get(conversationId);
  return row ? mapBot(row) : null;
}

export function listBots() {
  return statements.listBots.all().map(mapBot);
}

export function deleteBot(id) {
  statements.deleteBot.run(id);
}

export function getConversation(id) {
  const row = statements.getConversation.get(id);
  return row ? mapConversation(row) : null;
}

export function getComposerState(conversationId) {
  const row = statements.getComposerState.get(conversationId);
  if (!row) return null;
  return {
    conversationId: row.conversation_id,
    permissionMode: row.permission_mode,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    workMode: row.work_mode,
    ultraMode: Boolean(row.ultra_mode),
    draftText: row.draft_text,
    attachments: parse(row.attachments, []),
    updatedAt: row.updated_at,
  };
}

export function setComposerState(conversationId, state = {}) {
  if (!getConversation(conversationId)) throw new Error('Conversation not found.');
  const permissionMode = ['ask_for_approval', 'approve_for_me', 'full_access']
    .includes(state.permissionMode)
    ? state.permissionMode
    : 'approve_for_me';
  const workMode = ['plan', 'goal'].includes(state.workMode) ? state.workMode : null;
  const ultraMode = workMode === 'plan' ? false : Boolean(state.ultraMode);
  statements.upsertComposerState.run({
    conversationId,
    permissionMode,
    model: typeof state.model === 'string' ? state.model : '',
    reasoningEffort: typeof state.reasoningEffort === 'string'
      ? state.reasoningEffort
      : null,
    workMode,
    ultraMode: ultraMode ? 1 : 0,
    draftText: typeof state.draftText === 'string' ? state.draftText : '',
    attachments: stringify(Array.isArray(state.attachments) ? state.attachments : []),
    updatedAt: timestamp(),
  });
  return getComposerState(conversationId);
}

export function archiveConversation(id) {
  const conversation = getConversation(id);
  if (!conversation || conversation.conversationType !== 'thread') return false;
  statements.archiveConversation.run(id, timestamp());
  return true;
}

export function restoreConversation(id) {
  if (!statements.archivedConversationExists.get(id)) return false;
  statements.restoreConversation.run(id);
  return true;
}

export function deleteConversation(id, { hard = false } = {}) {
  if (hard) {
    statements.hardDeleteConversation.run(id);
    return;
  }
  const now = timestamp();
  statements.hardDeleteChildConversations.run(id);
  statements.deleteConversation.run(now, now, id);
}

export function runArchiveMaintenance({ now = new Date() } = {}) {
  const settings = getArchiveSettings();
  const result = {
    archived: 0,
    deletedArchived: 0,
    deletedDisposable: 0,
  };
  db.exec('BEGIN');
  try {
    if (settings.archiveAfterDays !== null) {
      result.archived = Number(statements.archiveOldConversations.run({
        archivedAt: now.toISOString(),
        cutoff: daysBefore(now, settings.archiveAfterDays),
      }).changes);
    }
    if (settings.deleteArchivedAfterDays !== null) {
      result.deletedArchived = Number(statements.deleteExpiredArchived.run(
        daysBefore(now, settings.deleteArchivedAfterDays),
      ).changes);
    }
    if (settings.deleteDisposableAfterDays !== null) {
      result.deletedDisposable = Number(statements.deleteExpiredDisposable.run(
        daysBefore(now, settings.deleteDisposableAfterDays),
      ).changes);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    traceError('database.transaction-error', {
      operation: 'archive-maintenance',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return result;
}

export function getArchiveStats() {
  const counts = statements.conversationCounts.get();
  const databasePath = join(storageDir, 'aivax.sqlite');
  const diskBytes = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .reduce((total, path) => {
      try {
        return total + statSync(path).size;
      } catch {
        return total;
      }
    }, 0);
  return {
    total: Number(counts.total) || 0,
    active: Number(counts.active) || 0,
    archived: Number(counts.archived) || 0,
    diskBytes,
  };
}

export function insertInferenceUsage({ type, model, projectPath = null, usage, createdAt = timestamp() }) {
  statements.insertInferenceUsage.run({
    id: crypto.randomUUID(),
    type,
    model,
    projectPath: projectPath ? resolve(projectPath) : null,
    usage: stringify(usage ?? {}),
    createdAt,
  });
}

export function listInferenceUsage(from, to) {
  return statements.listInferenceUsage.all(from, to).map((row) => ({
    id: row.id,
    type: row.type,
    model: row.model,
    projectPath: row.project_path ? resolve(row.project_path) : null,
    usage: parse(row.usage, {}),
    createdAt: row.created_at,
  }));
}

export function insertMessage(message) {
  const now = timestamp();
  const row = {
    id: message.id ?? crypto.randomUUID(),
    conversationId: message.conversationId,
    role: message.role,
    model: message.model ?? null,
    reasoningEffort: message.reasoningEffort ?? null,
    permissionMode: [
      'ask_for_approval',
      'approve_for_me',
      'full_access',
    ].includes(message.permissionMode)
      ? message.permissionMode
      : null,
    workMode: ['plan', 'goal'].includes(message.workMode) ? message.workMode : null,
    ultraMode: message.ultraMode ? 1 : 0,
    goalId: message.goalId ?? null,
    hidden: message.hidden ? 1 : 0,
    fromAgent: message.fromAgent ? 1 : 0,
    queuePriority: message.queuePriority ? 1 : 0,
    queuePosition: Number.isInteger(message.queuePosition) ? message.queuePosition : null,
    status: message.status ?? 'completed',
    content: message.content ?? '',
    segments: stringify(message.segments ?? []),
    edits: stringify(message.edits ?? []),
    attachments: stringify(message.attachments ?? []),
    continuations: stringify(message.continuations ?? []),
    usage: stringify(message.usage ?? {}),
    createdAt: Object.hasOwn(message, 'createdAt') ? message.createdAt : now,
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
    edits: patch.edits === undefined ? null : stringify(patch.edits),
    attachments: patch.attachments === undefined ? null : stringify(patch.attachments),
    continuations: patch.continuations === undefined ? null : stringify(patch.continuations),
    usage: patch.usage === undefined ? null : stringify(patch.usage),
    createdAt: patch.createdAt ?? null,
    updatedAt: timestamp(),
  });
  const message = getMessage(id);
  if (message) {
    touchConversation(message.conversationId);
  }
  return message;
}

export function updateQueuedMessageOrder(conversationId, {
  steerMessageIds = [],
  queuedMessageIds = [],
}) {
  const now = timestamp();
  db.exec('BEGIN');
  try {
    for (const [status, messageIds] of [
      ['steered', steerMessageIds],
      ['queued', queuedMessageIds],
    ]) {
      messageIds.forEach((messageId, index) => {
        statements.updateQueuePosition.run(
          index,
          now,
          messageId,
          conversationId,
          status,
        );
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    traceError('database.transaction-error', {
      operation: 'update-queued-message-order',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function deleteMessage(id) {
  const message = getMessage(id);
  statements.deleteMessage.run(id);
  if (message) {
    touchConversation(message.conversationId);
  }
  return message;
}

export function deleteMessagesFrom(conversationId, messageId) {
  const messageIds = statements.listMessagesFrom
    .all(conversationId, messageId, conversationId)
    .map((row) => row.id);
  if (messageIds.length === 0) return [];

  db.exec('BEGIN');
  try {
    statements.clearCheckpointFrom.run(
      conversationId,
      conversationId,
      messageId,
      conversationId,
    );
    statements.deleteMessagesFrom.run(conversationId, messageId, conversationId);
    touchConversation(conversationId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    traceError('database.transaction-error', {
      operation: 'delete-messages-from',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return messageIds;
}

export function getMessages(conversationId) {
  return statements.getMessages.all(conversationId).map(mapMessage);
}

export function getMessage(id) {
  const row = statements.getMessage.get(id);
  return row ? mapMessage(row) : null;
}

export function searchChats(query) {
  return searchChatsIn(db, query);
}

export function forkConversation(id, {
  throughMessageId = null,
  sideChat = false,
  subagent = false,
  subagentPrompt = null,
  orchestrationMode = null,
  autoForwardToParent = false,
} = {}) {
  const source = getConversation(id);
  const childThread = sideChat || subagent;
  if (
    !source
    || (sideChat && subagent)
    || (childThread && (source.isSideChat || source.isSubagent))
  ) {
    return null;
  }
  const childNumber = sideChat
    ? Math.max(
        0,
        ...listSideChats(source.id).map((sideChat) => (
          Number(sideChat.title.match(/^Side chat (\d+)$/)?.[1]) || 0
        )),
      ) + 1
    : null;
  const usedSubagentNames = subagent
    ? new Set(listSubagents(source.id).map((agent) => agent.title))
    : null;
  const subagentNameIndex = subagent
    ? subagentNames.findIndex((name, index) => (
        index >= source.nextSubagentNameIndex && !usedSubagentNames.has(name)
      ))
    : -1;
  const subagentName = subagentNameIndex >= 0 ? subagentNames[subagentNameIndex] : null;
  if (subagent && !subagentName) return null;
  const target = createConversation({
    title: sideChat
      ? `Side chat ${childNumber}`
      : subagent
        ? subagentName
        : `${source.title} - Copy`,
    model: source.model,
    projectPath: source.projectPath,
    gitBranch: source.gitBranch,
    conversationType: sideChat ? 'side' : subagent ? 'subagent' : 'thread',
    parentConversationId: childThread ? source.id : null,
    initialPrompt: subagent ? String(subagentPrompt ?? '').trim() || null : null,
    orchestrationMode: subagent ? orchestrationMode : null,
    autoForwardToParent: subagent && autoForwardToParent,
    titleStatus: childThread ? 'generated' : 'pending',
  });
  if (subagent) {
    statements.updateNextSubagentNameIndex.run(
      subagentNameIndex + 1,
      timestamp(),
      source.id,
    );
  }
  if (!subagent) {
    const sourceMessages = getMessages(id);
    const throughIndex = throughMessageId
      ? sourceMessages.findIndex((message) => message.id === throughMessageId)
      : -1;
    const messages = (
      throughIndex >= 0
        ? sourceMessages.slice(0, throughIndex + 1)
        : sourceMessages.filter((message) => (
            !childThread || !['queued', 'steered'].includes(message.status)
          ))
    ).filter((message) => !message.hidden);
    const now = Date.now();
    const copiedMessageIds = new Map();
    for (let index = 0; index < messages.length; index += 1) {
      const messageId = crypto.randomUUID();
      copiedMessageIds.set(messages[index].id, messageId);
      insertMessage({
        ...messages[index],
        id: messageId,
        conversationId: target.id,
        goalId: null,
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
    if (sideChat) {
      insertMessage({
        conversationId: target.id,
        role: 'user',
        status: 'sent',
        hidden: true,
        content: [
          '<side-chat-instructions>',
          'You are in a quick context forked from the main orchestrator to answer questions, explain the current implementation, or clarify what the orchestrator is doing.',
          'Do not make modifications or take actions directly from this side chat.',
          'If the user asks for guidance or an adjustment, inform the parent orchestrator about the decisions made with the user by using chat_send_prompt.',
          '</side-chat-instructions>',
        ].join('\n'),
        createdAt: new Date(now + messages.length).toISOString(),
      });
    }
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

function childThreadContext(conversation) {
  if (!['side', 'subagent'].includes(conversation?.conversation_type)) return [];

  if (conversation.conversation_type === 'subagent') {
    const parent = statements.getConversation.get(conversation.parent_conversation_id);
    const deliveryInstructions = conversation.auto_forward_to_parent
      ? [
          'Your final assistant response is automatically forwarded to the parent orchestrator by the runtime using steering.',
          'Do not send or repeat the final response with a communication tool.',
          'Use chat_send_prompt for material progress, blockers, dependencies, course corrections, or coordination before the final response.',
          'Terminal errors are also forwarded automatically.',
        ]
      : [
          'This thread was not started as an automatically reporting task. Its final response is not forwarded to the parent.',
          'Use chat_send_prompt only when you intentionally want to contact another thread.',
        ];
    const teamInstructions = conversation.orchestration_mode === 'ultra'
      ? [
          'You are a specialist on an Ultra team led by the orchestrator in the parent thread.',
          'Own the focused assignment independently, investigate beyond the obvious path, and return evidence rather than assumptions.',
          'Use chat_send_prompt to coordinate directly with another listed sub-agent when that materially improves the shared result.',
          'Challenge weak assumptions constructively, but stay within your assigned scope and do not duplicate work without a verification purpose.',
          'Do not expose private chain-of-thought. Communicate concise conclusions, decisions, evidence, and remaining uncertainty.',
        ]
      : conversation.orchestration_mode === 'plan'
        ? [
            'You are a Plan-mode specialist working for the orchestrator in the parent thread.',
            'Explore, research, analyze, or consolidate the focused assignment in the latest user message and return evidence for the execution plan.',
            'Actively use chat_send_prompt to coordinate directly with the parent or listed sibling sub-agents when sharing findings or resolving dependencies improves the plan.',
            'You may run terminal commands strictly for read-only investigation (searching, listing, reading, git status/log/diff/show). Never run commands that install, build, write, delete, move, stage, commit, push, start servers, or otherwise change any state.',
            'Do not edit files, mutate data, create conversations, or perform implementation work.',
            'Do not expose private chain-of-thought. Communicate concise conclusions, evidence, implications, and remaining uncertainty.',
          ]
        : [
            'You are a sub-agent working for the orchestrator in the parent thread.',
            'Complete the assignment in the latest user message independently.',
          ];
    return [{
      role: 'system',
      content: [
        '<thread_context>',
        'thread_type: subagent',
        `thread_id: ${conversation.id}`,
        `parent_thread_id: ${conversation.parent_conversation_id}`,
        `parent_thread_title: ${parent?.title ?? 'Unknown'}`,
        `You are the sub-agent called ${conversation.title}.`,
        ...teamInstructions,
        ...deliveryInstructions,
        'You cannot invoke chat_spawn_subagent or create other sub-agents.',
        '</thread_context>',
      ].join('\n'),
    }];
  }

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

export function toModelMessages(
  conversationId,
  { excludeMessageId, capabilities = {} } = {},
) {
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
    ...childThreadContext(conversation),
    ...checkpoint,
    ...messages
      .slice(hasCheckpoint ? checkpointIndex + 1 : 0)
      .filter((message) => message.id !== excludeMessageId)
      .filter((message) => ['completed', 'sent', 'aborted'].includes(message.status))
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => messageToApiBlock(message, capabilities)),
  ];
}

export function toModelMessagesThroughUser(
  conversationId,
  beforeMessageId,
  { includeFailedUser = false, capabilities = {} } = {},
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
    ...childThreadContext(conversation),
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
      .map((message) => messageToApiBlock(message, capabilities)),
  ];
}

export function messageToApiBlock(message, capabilities = {}) {
  return {
    role: message.role,
    content: message.role === 'assistant'
      ? answerTextFromTextualBlocks(message.content)
      : message.attachments.length === 0
        ? message.content
        : [
            ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
            ...message.attachments.map((attachment) => (
              attachmentToApiBlock(attachment, capabilities)
            )),
          ],
  };
}

export function attachmentToApiBlock(attachment, capabilities = {}) {
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
  if (attachment.kind === 'file_reference') {
    const label = attachment.source === 'pasted_text' ? 'Pasted text' : 'Attachment';
    return {
      type: 'text',
      text: `${label} "${attachment.name ?? 'attachment'}" is available at: ${attachment.path}`,
    };
  }
  if (attachment.kind === 'image_url') {
    return capabilities.images
      ? { type: 'image_url', image_url: { url: attachment.dataUrl } }
      : unsupportedAttachmentToApiBlock(attachment);
  }
  if (attachment.kind === 'video_url') {
    return capabilities.video
      ? { type: 'video_url', video_url: { url: attachment.dataUrl } }
      : unsupportedAttachmentToApiBlock(attachment);
  }
  if (attachment.kind === 'input_audio') {
    return capabilities.audio
      ? {
          type: 'input_audio',
          input_audio: {
            data: attachment.base64,
            format: attachment.format ?? 'mp3',
          },
        }
      : unsupportedAttachmentToApiBlock(attachment);
  }
  if (attachment.kind === 'file') {
    return attachment.mime === 'application/pdf' && capabilities.pdfFiles
      ? {
          type: 'file',
          file: {
            filename: attachment.name ?? 'attachment',
            file_data: attachment.dataUrl,
          },
        }
      : unsupportedAttachmentToApiBlock(attachment);
  }
  return unsupportedAttachmentToApiBlock(attachment);
}

function unsupportedAttachmentToApiBlock(attachment) {
  return {
    type: 'text',
    text: attachment.path
      ? `Attachment "${attachment.name ?? 'attachment'}" is available at: ${attachment.path}`
      : `Attachment: ${attachment.name ?? 'unavailable'}`,
  };
}

function touchConversation(id) {
  const conversation = getConversation(id);
  if (!conversation) return;
  updateConversation(id, {});
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

export function getSemaphoreState() {
  return readJson('semaphores');
}

export function setSemaphoreState(state) {
  writeJson('semaphores', state);
  return state;
}

function normalizeArchiveSettings(value, strict = false) {
  const settings = value && typeof value === 'object' ? value : {};
  const normalized = {
    archiveAfterDays: archiveRetentionOptions.includes(settings.archiveAfterDays)
      ? settings.archiveAfterDays
      : defaultArchiveSettings.archiveAfterDays,
    deleteArchivedAfterDays: archivedDeletionOptions.includes(settings.deleteArchivedAfterDays)
      ? settings.deleteArchivedAfterDays
      : defaultArchiveSettings.deleteArchivedAfterDays,
    deleteDisposableAfterDays: disposableDeletionOptions.includes(settings.deleteDisposableAfterDays)
      ? settings.deleteDisposableAfterDays
      : defaultArchiveSettings.deleteDisposableAfterDays,
  };
  if (strict && Object.entries(normalized).some(([key, entry]) => entry !== settings[key])) {
    throw new Error('Archive settings are invalid.');
  }
  return normalized;
}

function normalizeDesktopSettings(value, strict = false) {
  const settings = value && typeof value === 'object' ? value : {};
  const normalized = {
    closeToTray: settings.closeToTray === true,
    openAtLogin: settings.openAtLogin === true,
    notifyOnCompletion: settings.notifyOnCompletion === true,
  };
  if (strict && (
    typeof settings.closeToTray !== 'boolean'
    || typeof settings.openAtLogin !== 'boolean'
    || typeof settings.notifyOnCompletion !== 'boolean'
  )) {
    throw new Error('Desktop settings are invalid.');
  }
  return { ...defaultDesktopSettings, ...normalized };
}

function normalizeRemoteSettings(value, strict = false) {
  const settings = value && typeof value === 'object' ? value : {};
  const port = Number(settings.port ?? defaultRemoteSettings.port);
  const normalized = {
    enabled: settings.enabled === true,
    port: Number.isInteger(port) && port >= 1 && port <= 65_535
      ? port
      : defaultRemoteSettings.port,
  };
  if (strict && (
    typeof settings.enabled !== 'boolean'
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
  )) {
    throw new Error('Remote settings are invalid.');
  }
  return normalized;
}

function normalizeAivaxSettings(value, strict = false) {
  const settings = value && typeof value === 'object' ? value : {};
  const normalized = {
    memoryEnabled: settings.memoryEnabled === true,
    memoryCollectionId: typeof settings.memoryCollectionId === 'string' && settings.memoryCollectionId.trim()
      ? settings.memoryCollectionId.trim()
      : null,
    memoryCollectionName: typeof settings.memoryCollectionName === 'string' && settings.memoryCollectionName.trim()
      ? settings.memoryCollectionName.trim()
      : null,
    advancedFetchEnabled: settings.advancedFetchEnabled === true,
    webSearchEnabled: settings.webSearchEnabled === true,
    mediaDescriptionsEnabled: settings.mediaDescriptionsEnabled === true,
    threadSearchCollectionId: typeof settings.threadSearchCollectionId === 'string' && settings.threadSearchCollectionId.trim()
      ? settings.threadSearchCollectionId.trim()
      : null,
    threadSearchCollectionName: typeof settings.threadSearchCollectionName === 'string' && settings.threadSearchCollectionName.trim()
      ? settings.threadSearchCollectionName.trim()
      : null,
  };
  if (strict && (
    typeof settings.memoryEnabled !== 'boolean'
    || ![null, 'string'].includes(settings.memoryCollectionId === null ? null : typeof settings.memoryCollectionId)
    || ![null, 'string'].includes(settings.memoryCollectionName === null ? null : typeof settings.memoryCollectionName)
    || typeof settings.advancedFetchEnabled !== 'boolean'
    || typeof settings.webSearchEnabled !== 'boolean'
    || typeof settings.mediaDescriptionsEnabled !== 'boolean'
    || ![null, 'string'].includes(settings.threadSearchCollectionId === null ? null : typeof settings.threadSearchCollectionId)
    || ![null, 'string'].includes(settings.threadSearchCollectionName === null ? null : typeof settings.threadSearchCollectionName)
    || (normalized.memoryEnabled && !normalized.memoryCollectionId)
    || (normalized.threadSearchCollectionId && normalized.threadSearchCollectionId === normalized.memoryCollectionId)
  )) {
    throw new Error('AIVAX feature settings are invalid.');
  }
  return { ...defaultAivaxSettings, ...normalized };
}

function normalizeTuningSettings(value, strict = false) {
  const tuning = value && typeof value === 'object' ? value : {};
  const automaticCompactionThreshold = Number(tuning.automaticCompactionThreshold);
  const toolOutputLimit = tuning.toolOutputLimit === null
    ? null
    : Number(tuning.toolOutputLimit);
  const terminalTimeoutSeconds = Number(tuning.terminalTimeoutSeconds);
  const maxConcurrentSubagents = Number(tuning.maxConcurrentSubagents);

  const normalized = {
    personality: typeof tuning.personality === 'string'
      && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(tuning.personality)
      ? tuning.personality
      : defaultTuningSettings.personality,
    chatReasoningTraces: ['visible', 'hidden'].includes(tuning.chatReasoningTraces)
      ? tuning.chatReasoningTraces
      : defaultTuningSettings.chatReasoningTraces,
    continuationRepliesEnabled: typeof tuning.continuationRepliesEnabled === 'boolean'
      ? tuning.continuationRepliesEnabled
      : defaultTuningSettings.continuationRepliesEnabled,
    automaticCompactionThreshold: [0.8, 0.9, 0.95].includes(automaticCompactionThreshold)
      ? automaticCompactionThreshold
      : defaultTuningSettings.automaticCompactionThreshold,
    toolOutputLimit: [4_096, 8_192, 32_768, null].includes(toolOutputLimit)
      ? toolOutputLimit
      : defaultTuningSettings.toolOutputLimit,
    defaultPermissionMode: [
      'ask_for_approval',
      'approve_for_me',
      'full_access',
    ].includes(tuning.defaultPermissionMode)
      ? tuning.defaultPermissionMode
      : defaultTuningSettings.defaultPermissionMode,
    messageDeliveryMode: ['queue', 'steer'].includes(tuning.messageDeliveryMode)
      ? tuning.messageDeliveryMode
      : defaultTuningSettings.messageDeliveryMode,
    terminalShell: typeof tuning.terminalShell === 'string' && tuning.terminalShell.trim()
      ? tuning.terminalShell.trim()
      : defaultTuningSettings.terminalShell,
    terminalTimeoutSeconds: Number.isInteger(terminalTimeoutSeconds)
      && terminalTimeoutSeconds >= 5
      && terminalTimeoutSeconds <= 300
      ? terminalTimeoutSeconds
      : defaultTuningSettings.terminalTimeoutSeconds,
    maxConcurrentSubagents: Number.isInteger(maxConcurrentSubagents)
      && maxConcurrentSubagents >= 1
      && maxConcurrentSubagents <= 128
      ? maxConcurrentSubagents
      : defaultTuningSettings.maxConcurrentSubagents,
    logLevel: ['verbose', 'minimal', 'disabled'].includes(tuning.logLevel)
      ? tuning.logLevel
      : defaultTuningSettings.logLevel,
  };

  if (strict && Object.entries(normalized).some(([key, entry]) => entry !== tuning[key])) {
    throw new Error('One or more tuning settings are outside their allowed range.');
  }
  return normalized;
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
    conversationType: row.conversation_type,
    isSideChat: row.conversation_type === 'side',
    isSubagent: row.conversation_type === 'subagent',
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
    tags: normalizeTagIds(parse(row.tags, [])),
    goal: getGoalForConversation(row.id),
    firstPrompt: row.first_prompt ?? '',
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

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    permissionMode: [
      'ask_for_approval',
      'approve_for_me',
      'full_access',
    ].includes(row.permission_mode)
      ? row.permission_mode
      : null,
    workMode: ['plan', 'goal'].includes(row.work_mode) ? row.work_mode : null,
    ultraMode: Boolean(row.ultra_mode),
    goalId: row.goal_id || null,
    hidden: Boolean(row.hidden),
    fromAgent: Boolean(row.from_agent),
    queuePriority: Boolean(row.queue_priority),
    queuePosition: Number.isInteger(row.queue_position) ? row.queue_position : null,
    status: row.status,
    content: row.content,
    segments: parse(row.segments, []),
    edits: parse(row.edits, []),
    attachments: parse(row.attachments, []),
    continuations: parse(row.continuations, []),
    usage: parse(row.usage, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function goalParameters(goal, includeStartedAt = false) {
  return {
    id: goal.id,
    conversationId: goal.conversationId,
    specification: goal.specification,
    status: goal.status,
    revision: goal.revision,
    model: goal.model,
    reasoningEffort: goal.reasoningEffort,
    permissionMode: goal.permissionMode,
    activeElapsedMs: goal.activeElapsedMs,
    resumedAt: goal.resumedAt,
    resultSummary: goal.resultSummary,
    tokensTransacted: goal.tokensTransacted,
    ...(includeStartedAt ? { startedAt: goal.startedAt } : {}),
    updatedAt: goal.updatedAt,
    endedAt: goal.endedAt,
  };
}

function stringify(value) {
  return JSON.stringify(value ?? null);
}

function readSecureFile() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron secure storage encryption is unavailable.');
  }
  try {
    const stored = JSON.parse(readFileSync(secureStoragePath, 'utf8'));
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error('The secure storage file is invalid.', { cause: error });
  }
}

function readSecureFileValue(name) {
  const encrypted = readSecureFile()[name];
  if (typeof encrypted !== 'string') return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch (error) {
    throw new Error(`The secure storage value "${name}" could not be decrypted.`, { cause: error });
  }
}

function writeSecureFile(storage) {
  const temporaryPath = `${secureStoragePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(storage), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, secureStoragePath);
}

function writeSecureFileValue(name, value) {
  const storage = readSecureFile();
  storage[name] = safeStorage.encryptString(value).toString('base64');
  writeSecureFile(storage);
}

function deleteSecureFileValue(name) {
  const storage = readSecureFile();
  if (!(name in storage)) return;
  delete storage[name];
  writeSecureFile(storage);
}
function persistSecureValue(name, value) {
  const write = Promise.resolve().then(() => {
    writeSecureFileValue(name, JSON.stringify(value));
  }).catch((error) => {
    traceError('secure-storage.persist-error', {
      operation: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => {
    secureWrites.delete(write);
  });
  secureWrites.add(write);
}

function persistProviderCredentials() {
  if (!providerCredentialsKey) {
    throw new Error('Secure provider credential storage is not initialized.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', providerCredentialsKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secureStorage.providerCredentials), 'utf8'),
    cipher.final(),
  ]);
  writeJson('providerCredentialsV2', {
    version: 1,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function daysBefore(date, days) {
  return new Date(date.getTime() - days * 86_400_000).toISOString();
}

function timestamp() {
  return new Date().toISOString();
}
