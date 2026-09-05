import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const BOT_PENDENCY_STATUSES = new Set(['open', 'completed']);
export const BOT_MESSAGE_ROLES = new Set(['bot', 'user']);
export const BOT_ACTIVITY_CATEGORIES = new Set(['progress', 'discovery', 'decision', 'completed', 'failure']);
export const BOT_WORK_STATE_FILES = Object.freeze({
  inbox: 'inbox.json',
  activity: 'diary.json',
});

const VALID_APPROVAL_KINDS = new Set(['work', 'tool']);

const locks = new Map();

export function mutateBotWorkState(lockKey, operation) {
  const previous = locks.get(lockKey) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(lockKey, current);
  return current.finally(() => {
    if (locks.get(lockKey) === current) locks.delete(lockKey);
  });
}

async function atomicWrite(filePath, contents) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = join(dirname(filePath), `.tmp-${randomUUID()}`);
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, filePath);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${name}: expected non-empty string`);
  }
}

function validateAttachment(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid attachment: expected object');
  }
  requireString(value.id, 'attachment.id');
  requireString(value.kind, 'attachment.kind');
  const hasPath = typeof value.path === 'string' && value.path.length > 0;
  const hasInlineContent = ['dataUrl', 'base64', 'text'].some((key) => (
    typeof value[key] === 'string' && value[key].length > 0
  ));
  if (!hasPath && !hasInlineContent) {
    throw new Error('Invalid attachment: expected a file path or inline content');
  }
}

function validateAttachments(value) {
  if (!Array.isArray(value)) throw new Error('Invalid attachments: expected array');
  const seen = new Set();
  for (const entry of value) {
    validateAttachment(entry);
    if (seen.has(entry.id)) throw new Error(`Duplicate attachments entry: ${entry.id}`);
    seen.add(entry.id);
  }
  return value;
}

function validateMessage(message) {
  if (typeof message !== 'object' || message === null) throw new Error('Invalid message: expected object');
  requireString(message.id, 'message.id');
  if (!BOT_MESSAGE_ROLES.has(message.role)) throw new Error(`Invalid message role: ${message.role}`);
  if (typeof message.content !== 'string') throw new Error('Invalid message content: expected string');
  if (!Array.isArray(message.attachments)) throw new Error('Invalid message attachments: expected array');
  validateAttachments(message.attachments);
  requireString(message.createdAt, 'message.createdAt');
}

function validateApprovalObject(value) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') throw new Error('Invalid approval: expected null or object');
  requireString(value.id, 'approval.id');
  requireString(value.botId, 'approval.botId');
  requireString(value.pendencyId, 'approval.pendencyId');
  if (!VALID_APPROVAL_KINDS.has(value.kind)) throw new Error(`Invalid approval kind: ${value.kind}`);
  requireString(value.context, 'approval.context');
  requireString(value.prompt, 'approval.prompt');
  if (value.status !== 'pending') throw new Error(`Invalid approval status: ${value.status}`);
  requireString(value.createdAt, 'approval.createdAt');
  requireString(value.updatedAt, 'approval.updatedAt');
}

function validatePendency(pendency) {
  if (typeof pendency !== 'object' || pendency === null) throw new Error('Invalid pendency: expected object');
  requireString(pendency.id, 'id');
  requireString(pendency.title, 'title');
  if (!BOT_PENDENCY_STATUSES.has(pendency.status)) throw new Error(`Invalid pendency status: ${pendency.status}`);
  if (!Array.isArray(pendency.messages)) throw new Error('Invalid pendency messages: expected array');
  for (const message of pendency.messages) validateMessage(message);
  validateApprovalObject(pendency.approval);
  if (pendency.approval && (
    pendency.approval.pendencyId !== pendency.id
    || pendency.status !== 'open'
  )) {
    throw new Error('A pending approval must belong to an open pendency');
  }
  requireString(pendency.createdAt, 'createdAt');
  requireString(pendency.updatedAt, 'updatedAt');
  if (pendency.completedAt !== null && typeof pendency.completedAt !== 'string') {
    throw new Error('Invalid completedAt: expected null or string');
  }
  if ((pendency.status === 'completed') !== (pendency.completedAt !== null)) {
    throw new Error('completedAt must be set exactly when the pendency is completed');
  }
}

function validateActivityEntry(entry) {
  if (typeof entry !== 'object' || entry === null) throw new Error('Invalid activity entry: expected object');
  requireString(entry.id, 'activity.id');
  requireString(entry.title, 'activity.title');
  if (typeof entry.description !== 'string') throw new Error('Invalid activity.description: expected string');
  if (!BOT_ACTIVITY_CATEGORIES.has(entry.category)) throw new Error(`Invalid activity category: ${entry.category}`);
  requireString(entry.createdAt, 'activity.createdAt');
}

function validatePendenciesPayload(pendencies) {
  if (!Array.isArray(pendencies)) throw new Error('Invalid inbox.json: expected array');
  const ids = new Set();
  for (const pendency of pendencies) {
    validatePendency(pendency);
    if (ids.has(pendency.id)) throw new Error(`Duplicate pendency id: ${pendency.id}`);
    ids.add(pendency.id);
  }
  return pendencies;
}

function validateActivityPayload(entries) {
  if (!Array.isArray(entries)) throw new Error('Invalid diary.json: expected array');
  const ids = new Set();
  for (const entry of entries) {
    validateActivityEntry(entry);
    if (ids.has(entry.id)) throw new Error(`Duplicate activity id: ${entry.id}`);
    ids.add(entry.id);
  }
  return entries;
}

async function readJsonFile(filePath, validator, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${filePath}`); }
    return validator(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback();
    throw error;
  }
}

export async function readInboxFile(dataFolder) {
  return readJsonFile(join(dataFolder, BOT_WORK_STATE_FILES.inbox), validatePendenciesPayload, () => []);
}

export async function readActivityFile(dataFolder) {
  return readJsonFile(join(dataFolder, BOT_WORK_STATE_FILES.activity), validateActivityPayload, () => []);
}

async function writeInboxFile(dataFolder, pendencies) {
  validatePendenciesPayload(pendencies);
  await atomicWrite(join(dataFolder, BOT_WORK_STATE_FILES.inbox), `${JSON.stringify(pendencies, null, 2)}\n`);
}

async function writeActivityFile(dataFolder, entries) {
  validateActivityPayload(entries);
  await atomicWrite(join(dataFolder, BOT_WORK_STATE_FILES.activity), `${JSON.stringify(entries, null, 2)}\n`);
}

export async function ensureBotWorkStateFiles(dataFolder) {
  await mkdir(dataFolder, { recursive: true });
  const defaults = [
    [BOT_WORK_STATE_FILES.inbox, '[]\n'],
    [BOT_WORK_STATE_FILES.activity, '[]\n'],
  ];
  for (const [fileName, defaultContent] of defaults) {
    const filePath = join(dataFolder, fileName);
    try {
      await readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await writeFile(filePath, defaultContent, { encoding: 'utf8', flag: 'wx' });
      } catch (writeError) {
        if (writeError?.code !== 'EEXIST') throw writeError;
      }
    }
  }
}

export async function readBotWorkState(dataFolder) {
  const [inbox, activity] = await Promise.all([
    readInboxFile(dataFolder),
    readActivityFile(dataFolder),
  ]);
  return { inbox, activity };
}

export async function createBotPendency(dataFolder, input, now) {
  const { title, content, attachments = [] } = input;
  requireString(title, 'title');
  requireString(content, 'content');
  const messageAttachments = validateAttachments(attachments);
  const ts = now ?? new Date().toISOString();
  const pendency = {
    id: randomUUID(),
    title,
    status: 'open',
    messages: [{ id: randomUUID(), role: 'bot', content, attachments: messageAttachments, createdAt: ts }],
    approval: null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
  };

  return mutateBotWorkState(dataFolder, async () => {
    const inbox = await readInboxFile(dataFolder);
    inbox.push(pendency);
    await writeInboxFile(dataFolder, inbox);
    return pendency;
  });
}

export async function attachBotPendencyApproval(dataFolder, input, now) {
  const { botId, kind, title, context, prompt, toolName, workspacePath, input: approvalInput } = input;
  requireString(botId, 'botId');
  if (!VALID_APPROVAL_KINDS.has(kind)) throw new Error(`Invalid approval kind: ${kind}`);
  requireString(title, 'title');
  requireString(context, 'context');
  requireString(prompt, 'prompt');

  const ts = now ?? new Date().toISOString();

  return mutateBotWorkState(dataFolder, async () => {
    const inbox = await readInboxFile(dataFolder);
    const pendency = {
      id: randomUUID(),
      title,
      status: 'open',
      messages: [{ id: randomUUID(), role: 'bot', content: context, attachments: [], createdAt: ts }],
      approval: null,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
    };
    pendency.approval = {
      id: randomUUID(),
      botId,
      pendencyId: pendency.id,
      kind,
      context,
      prompt,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
      ...(toolName !== undefined ? { toolName } : {}),
      ...(workspacePath !== undefined ? { workspacePath } : {}),
      ...(approvalInput !== undefined ? { input: approvalInput } : {}),
    };
    validatePendency(pendency);

    inbox.push(pendency);
    await writeInboxFile(dataFolder, inbox);
    return pendency;
  });
}

export async function appendBotPendencyMessage(dataFolder, input, now) {
  const { pendencyId, role, content, attachments = [] } = input;
  requireString(pendencyId, 'pendencyId');
  if (!BOT_MESSAGE_ROLES.has(role)) throw new Error(`Invalid message role: ${role}`);
  if (typeof content !== 'string') throw new Error('Invalid content: expected string');
  const messageAttachments = validateAttachments(attachments);
  if (content.trim().length === 0 && messageAttachments.length === 0) {
    throw new Error('Invalid message: write a content or attach at least one file');
  }
  const ts = now ?? new Date().toISOString();

  return mutateBotWorkState(dataFolder, async () => {
    const inbox = await readInboxFile(dataFolder);
    const idx = inbox.findIndex((entry) => entry.id === pendencyId);
    if (idx === -1) throw new Error(`Pendency not found: ${pendencyId}`);
    const existing = inbox[idx];
    if (role === 'user' && existing.status === 'completed') {
      throw new Error('Pendency is completed; the bot must reopen it with a new message first.');
    }

    const updated = {
      ...existing,
      status: 'open',
      completedAt: null,
      messages: [...existing.messages, {
        id: randomUUID(),
        role,
        content,
        attachments: messageAttachments,
        createdAt: ts,
      }],
      updatedAt: ts,
    };
    validatePendency(updated);

    inbox[idx] = updated;
    await writeInboxFile(dataFolder, inbox);
    return updated;
  });
}

export async function completeBotPendency(dataFolder, pendencyId, now) {
  requireString(pendencyId, 'pendencyId');
  const ts = now ?? new Date().toISOString();

  return mutateBotWorkState(dataFolder, async () => {
    const inbox = await readInboxFile(dataFolder);
    const idx = inbox.findIndex((entry) => entry.id === pendencyId);
    if (idx === -1) throw new Error(`Pendency not found: ${pendencyId}`);
    const existing = inbox[idx];
    if (existing.approval) {
      throw new Error('Resolve the pending approval before completing this pendency.');
    }
    if (existing.status === 'completed') return existing;

    const updated = { ...existing, status: 'completed', completedAt: ts, updatedAt: ts };
    validatePendency(updated);

    inbox[idx] = updated;
    await writeInboxFile(dataFolder, inbox);
    return updated;
  });
}

export async function consumeBotPendencyApproval(dataFolder, approvalId, decision, now) {
  requireString(approvalId, 'approvalId');
  if (typeof decision !== 'boolean') {
    throw new Error('Approval decision must be an explicit boolean.');
  }
  const ts = now ?? new Date().toISOString();

  return mutateBotWorkState(dataFolder, async () => {
    const inbox = await readInboxFile(dataFolder);
    const idx = inbox.findIndex((entry) => entry.approval?.id === approvalId);
    if (idx === -1) throw new Error(`Approval not found: ${approvalId}`);

    const savedApproval = { ...inbox[idx].approval };
    // Consuming the approval and recording the user decision must stay atomic:
    // a window between them would let the pendency be completed without the
    // decision message ever reaching the bot.
    const updated = {
      ...inbox[idx],
      approval: null,
      messages: [...inbox[idx].messages, {
        id: randomUUID(),
        role: 'user',
        content: decision
          ? 'The user approved this request. Execute only what was approved.'
          : 'The user denied this request. Choose a safe alternative or cancel it with a clear reason. Do not retry the denied action.',
        attachments: [],
        createdAt: ts,
      }],
      updatedAt: ts,
    };
    validatePendency(updated);

    inbox[idx] = updated;
    await writeInboxFile(dataFolder, inbox);
    return { item: updated, approval: savedApproval };
  });
}

export async function appendBotActivity(dataFolder, input, now) {
  const { title, description = '', category } = input;
  requireString(title, 'title');
  if (typeof description !== 'string') throw new Error('Invalid description: expected string');
  if (!BOT_ACTIVITY_CATEGORIES.has(category)) throw new Error(`Invalid activity category: ${category}`);

  const ts = now ?? new Date().toISOString();
  const entry = { id: randomUUID(), title, description, category, createdAt: ts };

  return mutateBotWorkState(dataFolder, async () => {
    const activity = await readActivityFile(dataFolder);
    activity.push(entry);
    await writeActivityFile(dataFolder, activity);
    return entry;
  });
}
