import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const BOT_WORK_ITEM_STATES = new Set(['planned', 'active', 'waiting', 'completed', 'cancelled']);
export const BOT_WORK_PRIORITIES = new Set(['critical', 'high', 'normal', 'low']);
export const BOT_ATTENTION_TYPES = new Set(['approval', 'review', 'answer']);
export const BOT_EVIDENCE_TYPES = new Set(['file_reference', 'external_reference', 'text']);
export const BOT_ACTIVITY_TYPES = new Set([
  'created', 'progress', 'discovery', 'decision', 'delegated',
  'blocked', 'attention', 'completed', 'cancelled', 'failure', 'approval',
]);
export const BOT_WORK_STATE_FILES = Object.freeze({
  workItems: 'work-items.json',
  activity: 'activity.json',
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
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${name}: expected non-empty string`);
  }
}

function validateUniqueStrings(value, name) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}: expected array`);
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error(`Invalid ${name} entries must be strings`);
    if (seen.has(entry)) throw new Error(`Duplicate ${name} entry: ${entry}`);
    seen.add(entry);
  }
}

function validateEvidence(value) {
  if (!Array.isArray(value)) throw new Error('Invalid evidence: expected array');
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('Invalid evidence entry: expected object');
    }
    if (!BOT_EVIDENCE_TYPES.has(entry.type)) {
      throw new Error(`Invalid evidence type: ${entry.type}`);
    }
    requireString(entry.value, 'evidence.value');
    if (entry.type === 'external_reference') {
      let url;
      try { url = new URL(entry.value); } catch { throw new Error('Invalid external_reference: expected HTTP or HTTPS URL'); }
      if (!['http:', 'https:'].includes(url.protocol) || !url.host) {
        throw new Error('Invalid external_reference: expected HTTP or HTTPS URL');
      }
    }
    if (entry.type === 'file_reference' && !entry.value.replaceAll('\\', '/').match(/^(?:\.\/|\.\.\/)/)) {
      throw new Error('Invalid file_reference: expected a path starting with ./ or ../');
    }
    const key = `${entry.type}\u0000${entry.value}`;
    if (seen.has(key)) throw new Error(`Duplicate evidence entry: ${entry.value}`);
    seen.add(key);
  }
}

function validateAttention(value) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') throw new Error('Invalid attention: expected null or object');
  if (!BOT_ATTENTION_TYPES.has(value.type)) throw new Error(`Invalid attention type: ${value.type}`);
  requireString(value.summary, 'attention.summary');
}

function validateBlocker(value) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') throw new Error('Invalid blocker: expected null or object');
  requireString(value.reason, 'blocker.reason');
  requireString(value.waitingOn, 'blocker.waitingOn');
}

function validateApprovalObject(value) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') throw new Error('Invalid approval: expected null or object');
  requireString(value.id, 'approval.id');
  requireString(value.botId, 'approval.botId');
  requireString(value.workItemId, 'approval.workItemId');
  if (!VALID_APPROVAL_KINDS.has(value.kind)) throw new Error(`Invalid approval kind: ${value.kind}`);
  requireString(value.context, 'approval.context');
  requireString(value.prompt, 'approval.prompt');
  if (value.status !== 'pending') throw new Error(`Invalid approval status: ${value.status}`);
  requireString(value.createdAt, 'approval.createdAt');
  requireString(value.updatedAt, 'approval.updatedAt');
}

function validateWorkItem(item) {
  if (typeof item !== 'object' || item === null) throw new Error('Invalid work item: expected object');
  requireString(item.id, 'id');
  requireString(item.title, 'title');
  if (typeof item.objective !== 'string') throw new Error('Invalid objective: expected string');
  if (!BOT_WORK_ITEM_STATES.has(item.state)) throw new Error(`Invalid state: ${item.state}`);
  if (typeof item.summary !== 'string') throw new Error('Invalid summary: expected string');
  if (typeof item.lastProgress !== 'string') throw new Error('Invalid lastProgress: expected string');
  if (typeof item.nextStep !== 'string') throw new Error('Invalid nextStep: expected string');
  validateAttention(item.attention);
  validateBlocker(item.blocker);
  if (!BOT_WORK_PRIORITIES.has(item.priority)) throw new Error(`Invalid priority: ${item.priority}`);
  validateUniqueStrings(item.workerThreadIds, 'workerThreadIds');
  validateEvidence(item.evidence);
  validateApprovalObject(item.approval);
  if (item.approval && (
    item.approval.workItemId !== item.id
    || item.state !== 'waiting'
    || item.attention?.type !== 'approval'
  )) {
    throw new Error('A pending approval must belong to a waiting item with approval attention');
  }
  if (item.state === 'waiting' && !item.attention && !item.blocker) {
    throw new Error('Waiting state requires attention or blocker');
  }
  requireString(item.createdAt, 'createdAt');
  requireString(item.updatedAt, 'updatedAt');
  if (item.completedAt !== null && typeof item.completedAt !== 'string') {
    throw new Error('Invalid completedAt: expected null or string');
  }
}

function validateActivityEntry(entry) {
  if (typeof entry !== 'object' || entry === null) throw new Error('Invalid activity entry: expected object');
  requireString(entry.id, 'activity.id');
  if (entry.workItemId !== null && typeof entry.workItemId !== 'string') {
    throw new Error('Invalid activity.workItemId: expected null or string');
  }
  if (!BOT_ACTIVITY_TYPES.has(entry.type)) throw new Error(`Invalid activity type: ${entry.type}`);
  requireString(entry.summary, 'activity.summary');
  if (typeof entry.details !== 'string') throw new Error('Invalid activity.details: expected string');
  requireString(entry.createdAt, 'activity.createdAt');
}

function validateWorkItemsPayload(items) {
  if (!Array.isArray(items)) throw new Error('Invalid work-items.json: expected array');
  for (const item of items) validateWorkItem(item);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate work item id: ${item.id}`);
    ids.add(item.id);
  }
  return items;
}

function validateActivityPayload(entries) {
  if (!Array.isArray(entries)) throw new Error('Invalid activity.json: expected array');
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

async function readWorkItemsFile(dataFolder) {
  return readJsonFile(join(dataFolder, BOT_WORK_STATE_FILES.workItems), (items) => {
    if (!Array.isArray(items)) return validateWorkItemsPayload(items);
    return validateWorkItemsPayload(items.map((item) => ({
      ...item,
      evidence: Array.isArray(item?.evidence)
        ? item.evidence.map((entry) => typeof entry === 'string'
          ? { type: /^https?:\/\//i.test(entry) ? 'external_reference' : 'text', value: entry }
          : entry)
        : item?.evidence,
    })));
  }, () => []);
}

async function readActivityFile(dataFolder) {
  return readJsonFile(join(dataFolder, BOT_WORK_STATE_FILES.activity), validateActivityPayload, () => []);
}

async function writeWorkItemsFile(dataFolder, items) {
  validateWorkItemsPayload(items);
  await atomicWrite(join(dataFolder, BOT_WORK_STATE_FILES.workItems), `${JSON.stringify(items, null, 2)}\n`);
}

async function writeActivityFile(dataFolder, entries) {
  validateActivityPayload(entries);
  await atomicWrite(join(dataFolder, BOT_WORK_STATE_FILES.activity), `${JSON.stringify(entries, null, 2)}\n`);
}

function applyCompletedAt(item, now) {
  item.completedAt = (item.state === 'completed' || item.state === 'cancelled')
    ? (item.completedAt ?? now)
    : null;
}

export async function ensureBotWorkStateFiles(dataFolder) {
  await mkdir(dataFolder, { recursive: true });
  const defaults = [
    [BOT_WORK_STATE_FILES.workItems, '[]\n'],
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
  const [workItems, activity] = await Promise.all([
    readWorkItemsFile(dataFolder),
    readActivityFile(dataFolder),
  ]);
  return { workItems, activity };
}

export async function createBotWorkItem(dataFolder, input, now) {
  const { title, objective, nextStep = '', priority = 'normal', workerThreadIds = [] } = input;
  requireString(title, 'title');
  requireString(objective, 'objective');
  if (typeof nextStep !== 'string') throw new Error('Invalid nextStep: expected string');
  if (!BOT_WORK_PRIORITIES.has(priority)) throw new Error(`Invalid priority: ${priority}`);
  validateUniqueStrings(workerThreadIds, 'workerThreadIds');

  const ts = now ?? new Date().toISOString();
  const item = {
    id: randomUUID(),
    title,
    objective,
    state: 'planned',
    summary: '',
    lastProgress: '',
    nextStep,
    attention: null,
    blocker: null,
    priority,
    workerThreadIds,
    evidence: [],
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
  };

  return mutateBotWorkState(dataFolder, async () => {
    const items = await readWorkItemsFile(dataFolder);
    items.push(item);
    await writeWorkItemsFile(dataFolder, items);
    const activity = await readActivityFile(dataFolder);
    activity.push({
      id: randomUUID(),
      workItemId: item.id,
      type: 'created',
      summary: `Work item created: ${title}`,
      details: '',
      createdAt: ts,
    });
    await writeActivityFile(dataFolder, activity);
    return item;
  });
}

export async function updateBotWorkItem(dataFolder, input, now) {
  const { id, ...patch } = input;
  requireString(id, 'id');

  return mutateBotWorkState(dataFolder, async () => {
    const items = await readWorkItemsFile(dataFolder);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`Work item not found: ${id}`);
    const existing = items[idx];

    if (existing.approval) {
      if (patch.approval !== undefined) throw new Error('Cannot modify approval via update; use consumeBotWorkApproval');
      if (patch.state !== undefined) throw new Error('Cannot change state while approval is pending');
      if (patch.attention !== undefined) throw new Error('Cannot change attention while approval is pending');
      if (patch.blocker !== undefined) throw new Error('Cannot change blocker while approval is pending');
    }

    const ts = now ?? new Date().toISOString();
    const updated = { ...existing };

    for (const key of ['title', 'objective', 'summary', 'lastProgress', 'nextStep', 'priority']) {
      if (patch[key] !== undefined) updated[key] = patch[key];
    }
    if (patch.state !== undefined) {
      if (!BOT_WORK_ITEM_STATES.has(patch.state)) throw new Error(`Invalid state: ${patch.state}`);
      updated.state = patch.state;
    }
    if (patch.attention !== undefined) {
      validateAttention(patch.attention);
      updated.attention = patch.attention;
    }
    if (patch.blocker !== undefined) {
      validateBlocker(patch.blocker);
      updated.blocker = patch.blocker;
    }
    if (patch.workerThreadIds !== undefined) {
      validateUniqueStrings(patch.workerThreadIds, 'workerThreadIds');
      updated.workerThreadIds = patch.workerThreadIds;
    }
    if (patch.evidence !== undefined) {
      validateEvidence(patch.evidence);
      updated.evidence = patch.evidence;
    }

    if (updated.state === 'waiting' && !updated.attention && !updated.blocker) {
      throw new Error('Waiting state requires attention or blocker');
    }
    if (patch.state === 'completed') {
      requireString(updated.summary, 'summary for completed work');
      updated.nextStep = '';
    }
    if (patch.state === 'completed' || patch.state === 'cancelled') {
      updated.attention = null;
      updated.blocker = null;
    }

    applyCompletedAt(updated, ts);
    updated.updatedAt = ts;
    validateWorkItem(updated);

    items[idx] = updated;
    await writeWorkItemsFile(dataFolder, items);
    return updated;
  });
}

export async function appendBotActivity(dataFolder, input, now) {
  const { workItemId = null, type, summary, details = '' } = input;
  if (!BOT_ACTIVITY_TYPES.has(type)) throw new Error(`Invalid activity type: ${type}`);
  requireString(summary, 'summary');
  if (typeof details !== 'string') throw new Error('Invalid details: expected string');

  const ts = now ?? new Date().toISOString();
  const entry = { id: randomUUID(), workItemId, type, summary, details, createdAt: ts };

  return mutateBotWorkState(dataFolder, async () => {
    const activity = await readActivityFile(dataFolder);
    activity.push(entry);
    await writeActivityFile(dataFolder, activity);
    return entry;
  });
}

export async function createBotWorkApproval(dataFolder, approvalInput, now) {
  const { botId, workItemId, kind, context, prompt, toolName, workspacePath, input: approvalInputField } = approvalInput;
  requireString(botId, 'botId');
  requireString(workItemId, 'workItemId');
  if (!VALID_APPROVAL_KINDS.has(kind)) throw new Error(`Invalid approval kind: ${kind}`);
  requireString(context, 'context');
  requireString(prompt, 'prompt');

  const ts = now ?? new Date().toISOString();

  return mutateBotWorkState(dataFolder, async () => {
    const items = await readWorkItemsFile(dataFolder);
    const idx = items.findIndex((i) => i.id === workItemId);
    if (idx === -1) throw new Error(`Work item not found: ${workItemId}`);
    if (items[idx].approval) throw new Error(`Work item already has a pending approval: ${workItemId}`);

    const approval = {
      id: randomUUID(),
      botId,
      workItemId,
      kind,
      context,
      prompt,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
      ...(toolName !== undefined ? { toolName } : {}),
      ...(workspacePath !== undefined ? { workspacePath } : {}),
      ...(approvalInputField !== undefined ? { input: approvalInputField } : {}),
    };

    const updated = {
      ...items[idx],
      approval,
      state: 'waiting',
      attention: { type: 'approval', summary: context },
      updatedAt: ts,
      completedAt: null,
    };
    validateWorkItem(updated);

    items[idx] = updated;
    await writeWorkItemsFile(dataFolder, items);

    const activity = await readActivityFile(dataFolder);
    activity.push({
      id: randomUUID(),
      workItemId,
      type: 'approval',
      summary: `Approval requested: ${context}`,
      details: prompt,
      createdAt: ts,
    });
    await writeActivityFile(dataFolder, activity);
    return updated;
  });
}

export async function consumeBotWorkApproval(dataFolder, approvalId, now) {
  requireString(approvalId, 'approvalId');
  const ts = now ?? new Date().toISOString();

  return mutateBotWorkState(dataFolder, async () => {
    const items = await readWorkItemsFile(dataFolder);
    const idx = items.findIndex((i) => i.approval?.id === approvalId);
    if (idx === -1) throw new Error(`Approval not found: ${approvalId}`);

    const savedApproval = { ...items[idx].approval };
    const updated = {
      ...items[idx],
      approval: null,
      attention: null,
      blocker: null,
      state: 'active',
      updatedAt: ts,
      completedAt: null,
    };
    validateWorkItem(updated);

    items[idx] = updated;
    await writeWorkItemsFile(dataFolder, items);

    const activity = await readActivityFile(dataFolder);
    activity.push({
      id: randomUUID(),
      workItemId: updated.id,
      type: 'approval',
      summary: 'Approval consumed',
      details: approvalId,
      createdAt: ts,
    });
    await writeActivityFile(dataFolder, activity);
    return { item: updated, approval: savedApproval };
  });
}