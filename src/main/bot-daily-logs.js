import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const BOT_DAILY_LOG_STATUSES = Object.freeze([
  'waiting-user-approval',
  'backlog',
  'blocked',
  'discarded',
  'done',
  'ongoing',
  'user-review',
]);

export const BOT_WRITABLE_LOG_STATUSES = Object.freeze(
  BOT_DAILY_LOG_STATUSES.filter((status) => status !== 'waiting-user-approval'),
);

const statusSet = new Set(BOT_DAILY_LOG_STATUSES);
const writableStatusSet = new Set(BOT_WRITABLE_LOG_STATUSES);
const writeLocks = new Map();

function isBotDailyLogDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]);
}

export function botDailyLogFileName(status) {
  if (!statusSet.has(status)) throw new Error(`Invalid bot log status: ${status}.`);
  return `${status}.json`;
}

export function botDailyLogDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function readBotDailyLogs(workingFolder, { status, date } = {}) {
  if (status !== undefined && !statusSet.has(status)) {
    throw new Error(`Invalid bot log status: ${status}.`);
  }
  const normalizedDate = date === undefined ? null : String(date).trim();
  if (normalizedDate && !isBotDailyLogDate(normalizedDate)) {
    throw new Error('date must be a valid date in YYYY-MM-DD format.');
  }
  const statuses = status ? [status] : BOT_DAILY_LOG_STATUSES;
  const entries = (await Promise.all(statuses.map(async (currentStatus) => {
    const filePath = join(workingFolder, botDailyLogFileName(currentStatus));
    let parsed;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Could not read ${botDailyLogFileName(currentStatus)}: ${error.message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${botDailyLogFileName(currentStatus)} must contain a JSON array.`);
    }
    for (const entry of parsed) {
      if (
        !entry
        || typeof entry !== 'object'
        || typeof entry.id !== 'string'
        || !entry.id
        || typeof entry.title !== 'string'
        || !entry.title
        || typeof entry.content !== 'string'
        || entry.status !== currentStatus
        || typeof entry.date !== 'string'
        || !isBotDailyLogDate(entry.date)
        || typeof entry.createdAt !== 'string'
        || !Number.isFinite(Date.parse(entry.createdAt))
        || typeof entry.updatedAt !== 'string'
        || !Number.isFinite(Date.parse(entry.updatedAt))
      ) {
        throw new Error(`${botDailyLogFileName(currentStatus)} contains an invalid log entry.`);
      }
    }
    return parsed;
  }))).flat();
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate bot log entry id: ${entry.id}.`);
    ids.add(entry.id);
  }
  return entries
    .filter((entry) => !normalizedDate || entry.date === normalizedDate)
    .sort((left, right) => (
      right.updatedAt.localeCompare(left.updatedAt)
    ));
}

export async function writeBotDailyLogs(workingFolder, status, entries) {
  const filePath = join(workingFolder, botDailyLogFileName(status));
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export function mutateBotDailyLogs(lockKey, operation) {
  const previous = writeLocks.get(lockKey) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writeLocks.set(lockKey, current);
  return current.finally(() => {
    if (writeLocks.get(lockKey) === current) writeLocks.delete(lockKey);
  });
}

export async function writeBotDailyLog(workingFolder, { title, content, status }, now = new Date()) {
  if (!writableStatusSet.has(status)) {
    throw new Error(`status must be one of: ${BOT_WRITABLE_LOG_STATUSES.join(', ')}.`);
  }
  const normalizedTitle = String(title ?? '').trim();
  const normalizedContent = String(content ?? '').trim();
  if (!normalizedTitle) throw new Error('title is required.');
  if (!normalizedContent) throw new Error('content is required.');
  const timestamp = now.toISOString();
  const entry = {
    id: randomUUID(),
    title: normalizedTitle,
    content: normalizedContent,
    status,
    date: botDailyLogDate(now),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const entries = await readBotDailyLogs(workingFolder, { status });
  await writeBotDailyLogs(workingFolder, status, [...entries, entry]);
  return entry;
}

export async function updateBotDailyLog(
  workingFolder,
  { id, operation, title, content, status },
  now = new Date(),
) {
  const normalizedId = String(id ?? '').trim();
  if (!normalizedId) throw new Error('id is required.');
  if (!['edit', 'move', 'remove'].includes(operation)) {
    throw new Error('operation must be edit, move, or remove.');
  }
  const entries = await readBotDailyLogs(workingFolder);
  const current = entries.find((entry) => entry.id === normalizedId);
  if (!current) throw new Error('Bot log entry not found.');
  if (current.status === 'waiting-user-approval') {
    throw new Error('Waiting user approvals can only be changed by the approval workflow.');
  }
  const sourceEntries = entries.filter((entry) => entry.status === current.status && entry.id !== current.id);
  if (operation === 'remove') {
    await writeBotDailyLogs(workingFolder, current.status, sourceEntries);
    return { removed: true, entry: current };
  }
  if (operation === 'move' && !writableStatusSet.has(status)) {
    throw new Error(`status must be one of: ${BOT_WRITABLE_LOG_STATUSES.join(', ')}.`);
  }
  if (operation === 'edit' && title === undefined && content === undefined) {
    throw new Error('edit requires title and/or content.');
  }
  if (operation !== 'move' && status !== undefined) {
    throw new Error('status is only valid for move.');
  }
  const nextTitle = title === undefined ? current.title : String(title).trim();
  const nextContent = content === undefined ? current.content : String(content).trim();
  if (!nextTitle) throw new Error('title cannot be empty.');
  if (!nextContent) throw new Error('content cannot be empty.');
  const updated = {
    ...current,
    title: nextTitle,
    content: nextContent,
    status: operation === 'move' ? status : current.status,
    updatedAt: now.toISOString(),
  };
  if (updated.status === current.status) {
    await writeBotDailyLogs(workingFolder, current.status, [...sourceEntries, updated]);
  } else {
    const destinationEntries = entries.filter((entry) => entry.status === updated.status);
    await writeBotDailyLogs(workingFolder, updated.status, [...destinationEntries, updated]);
    await writeBotDailyLogs(workingFolder, current.status, sourceEntries);
  }
  return updated;
}
