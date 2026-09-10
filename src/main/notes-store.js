import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFileSync, copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { open } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize } from 'node:path';
import { compareNotes } from '../shared/notes.js';

const priorities = ['none', 'low', 'medium', 'high', 'urgent'];
const orders = ['urgency', 'createdAt', 'updatedAt', 'priority', 'dueAt', 'manual'];

function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`Invalid ${name}.`);
  }
  return required ? value.trim() : value;
}

function date(value, name) {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${name}.`);
  return new Date(value).toISOString();
}

export class NotesStore extends EventEmitter {
  constructor(db, storageDirectory) {
    super();
    this.db = db;
    this.directory = join(storageDirectory, 'note-attachments');
    this.uploads = new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS note_lists (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_notes (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES note_lists(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS user_notes_list ON user_notes(list_id);`);
  }

  lists({ folderPath, archived = false } = {}) {
    if (archived !== null && typeof archived !== 'boolean') throw new Error('Invalid archived flag.');
    if (folderPath !== undefined && folderPath !== null) {
      text(folderPath, 'folder path', 4096, true);
      if (!isAbsolute(folderPath)) throw new Error('Folder path must be absolute.');
      folderPath = normalize(folderPath);
    }
    return this.db.prepare('SELECT data FROM note_lists').all().map((row) => JSON.parse(row.data))
      .filter((list) => (folderPath === undefined || list.folderPath === folderPath)
        && (archived === null || list.archived === archived))
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }

  saveList(input = {}) {
    const current = input.id ? this.lists({ archived: null }).find((list) => list.id === input.id) : null;
    if (input.id && !current) throw new Error('Note list not found.');
    const now = new Date().toISOString();
    const next = { id: randomUUID(), name: '', folderPath: null, archived: false, orderBy: 'urgency',
      position: this.lists({ archived: null }).length, createdAt: now, ...current, updatedAt: now };
    if (input.name !== undefined) next.name = text(input.name, 'list name', 200, true);
    if (!next.name) throw new Error('A list name is required.');
    if (input.folderPath !== undefined) {
      next.folderPath = input.folderPath === null ? null : text(input.folderPath, 'folder path', 4096, true);
      if (next.folderPath !== null) {
        if (!isAbsolute(next.folderPath)) throw new Error('Folder path must be absolute.');
        next.folderPath = normalize(next.folderPath);
      }
    }
    if (input.archived !== undefined) {
      if (typeof input.archived !== 'boolean') throw new Error('Invalid archived flag.');
      next.archived = input.archived;
    }
    if (input.orderBy !== undefined) {
      if (!orders.includes(input.orderBy)) throw new Error('Invalid note ordering.');
      next.orderBy = input.orderBy;
    }
    if (input.position !== undefined) {
      if (!Number.isInteger(input.position) || input.position < 0) throw new Error('Invalid list position.');
      next.position = input.position;
    }
    this.db.prepare('INSERT INTO note_lists(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(next.id, JSON.stringify(next));
    this.emit('changed');
    return next;
  }

  search({ listIds, folderPath, query = '', done, archived = false, priority, createdAfter, createdBefore,
    updatedAfter, updatedBefore, dueAfter, dueBefore, orderBy = 'urgency', limit = 500, offset = 0 } = {}) {
    if (listIds !== undefined && (!Array.isArray(listIds) || listIds.some((id) => typeof id !== 'string'))) throw new Error('Invalid list IDs.');
    if (!orders.includes(orderBy)) throw new Error('Invalid note ordering.');
    if (priority !== undefined && !priorities.includes(priority)) throw new Error('Invalid priority.');
    if (done !== undefined && typeof done !== 'boolean') throw new Error('Invalid done flag.');
    if (archived !== null && typeof archived !== 'boolean') throw new Error('Invalid archived flag.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid pagination.');
    const ranges = [['createdAt', createdAfter, createdBefore], ['updatedAt', updatedAfter, updatedBefore], ['dueAt', dueAfter, dueBefore]]
      .map(([field, after, before]) => [field, after === undefined ? null : date(after, field), before === undefined ? null : date(before, field)]);
    const lists = new Map(this.lists({ folderPath, archived: null }).map((list) => [list.id, list]));
    const needle = text(query, 'search query', 10000).trim().toLowerCase();
    const notes = this.db.prepare('SELECT data FROM user_notes').all().map((row) => JSON.parse(row.data))
      .filter((note) => lists.has(note.listId) && (archived === null || (note.archived === archived && (archived || !lists.get(note.listId).archived)))
        && (!listIds || listIds.includes(note.listId)) && (done === undefined || note.done === done)
        && (priority === undefined || note.priority === priority)
        && (!needle || `${note.title}\n${note.description}\n${note.subtasks.map((item) => item.text).join('\n')}`.toLowerCase().includes(needle))
        && ranges.every(([field, after, before]) => (!after || (note[field] && note[field] >= after)) && (!before || (note[field] && note[field] <= before))))
      .sort((a, b) => compareNotes(a, b, orderBy));
    return { notes: notes.slice(offset, offset + limit), total: notes.length };
  }

  get(id) {
    const row = this.db.prepare('SELECT data FROM user_notes WHERE id = ?').get(text(id, 'note ID', 100, true));
    if (!row) throw new Error('Note not found.');
    return JSON.parse(row.data);
  }

  save(input = {}) {
    const current = input.id ? this.get(input.id) : null;
    const now = new Date().toISOString();
    const next = { id: randomUUID(), title: '', description: '', priority: 'none', dueAt: null, done: false, archived: false,
      subtasks: [], attachments: [], position: 0, createdAt: now, ...current, updatedAt: now };
    if (input.listId !== undefined) next.listId = text(input.listId, 'list ID', 100, true);
    const list = this.lists({ archived: null }).find((item) => item.id === next.listId);
    if (!list) throw new Error('Note list not found.');
    if (list.archived && (!current || current.listId !== next.listId)) throw new Error('Cannot add notes to an archived list.');
    if (input.title !== undefined) next.title = text(input.title, 'title', 500, true);
    if (!next.title) throw new Error('A title is required.');
    if (input.description !== undefined) next.description = text(input.description, 'description', 200000);
    if (input.priority !== undefined) {
      if (!priorities.includes(input.priority)) throw new Error('Invalid priority.');
      next.priority = input.priority;
    }
    if (input.dueAt !== undefined) next.dueAt = date(input.dueAt, 'due date');
    for (const field of ['done', 'archived']) {
      if (input[field] === undefined) continue;
      if (typeof input[field] !== 'boolean') throw new Error(`Invalid ${field} flag.`);
      next[field] = input[field];
    }
    if (input.position !== undefined) {
      if (!Number.isInteger(input.position) || input.position < 0) throw new Error('Invalid note position.');
      next.position = input.position;
    }
    if (input.subtasks !== undefined) {
      if (!Array.isArray(input.subtasks) || input.subtasks.length > 500) throw new Error('Invalid subtasks.');
      next.subtasks = input.subtasks.map((item) => {
        if (!item || typeof item.done !== 'boolean') throw new Error('Invalid subtask.');
        return { id: item.id === undefined ? randomUUID() : text(item.id, 'subtask ID', 100, true), text: text(item.text, 'subtask text', 2000, true), done: item.done };
      });
      if (new Set(next.subtasks.map((item) => item.id)).size !== next.subtasks.length) throw new Error('Duplicate subtask IDs.');
    }
    if (input.removeAttachmentIds !== undefined) {
      if (!Array.isArray(input.removeAttachmentIds) || input.removeAttachmentIds.some((id) => !next.attachments.some((item) => item.id === id))) throw new Error('Invalid attachment IDs.');
      next.attachments = next.attachments.filter((item) => !input.removeAttachmentIds.includes(item.id));
    }
    this.db.prepare('INSERT INTO user_notes(id, list_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET list_id=excluded.list_id, data=excluded.data')
      .run(next.id, next.listId, JSON.stringify(next));
    for (const item of current?.attachments ?? []) {
      if (!next.attachments.some((attachment) => attachment.id === item.id)) rmSync(join(this.directory, next.id, item.id), { force: true });
    }
    this.emit('changed');
    return next;
  }

  addAttachment({ id, path }) {
    const note = this.get(id);
    const source = text(path, 'attachment path', 4096, true);
    const stat = statSync(source);
    if (!stat.isFile() || stat.size > 50 * 1024 * 1024 || note.attachments.length >= 50) throw new Error('Attachments must be files up to 50 MiB; at most 50 per note.');
    const attachment = { id: randomUUID(), name: basename(source), size: stat.size };
    mkdirSync(join(this.directory, note.id), { recursive: true });
    const target = join(this.directory, note.id, attachment.id);
    copyFileSync(source, target);
    note.attachments.push(attachment);
    note.updatedAt = new Date().toISOString();
    try {
      this.db.prepare('UPDATE user_notes SET data = ? WHERE id = ?').run(JSON.stringify(note), note.id);
    } catch (error) {
      rmSync(target, { force: true });
      throw error;
    }
    this.emit('changed');
    return note;
  }

  async readAttachment(payload) {
    const attachment = this.attachment(payload);
    const offset = payload.offset ?? 0;
    const length = payload.length ?? 262144;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > 262144) throw new Error('Invalid attachment range.');
    const handle = await open(attachment.path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return { name: attachment.name, size: attachment.size, offset, bytesRead, data: buffer.subarray(0, bytesRead).toString('base64') };
    } finally { await handle.close(); }
  }

  uploadAttachment({ id, uploadId, name, size, offset = 0, data = '', cancel = false } = {}) {
    for (const [key, item] of this.uploads) {
      if (item.expiresAt <= Date.now()) { rmSync(item.directory, { recursive: true, force: true }); this.uploads.delete(key); }
    }
    const note = this.get(id);
    let upload = uploadId ? this.uploads.get(uploadId) : null;
    if (uploadId && (!upload || upload.id !== id)) throw new Error('Note upload not found or expired.');
    if (cancel) {
      if (upload) { rmSync(upload.directory, { recursive: true, force: true }); this.uploads.delete(uploadId); }
      return { canceled: true };
    }
    if (!Number.isInteger(offset) || offset < 0 || typeof data !== 'string' || data.length > 349528 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid upload chunk.');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 262144 || bytes.toString('base64') !== data) throw new Error('Invalid upload chunk.');
    if (!upload) {
      text(name, 'attachment name', 255, true);
      if (name !== basename(name) || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || ['.', '..'].includes(name)) throw new Error('Invalid attachment name.');
      if (!Number.isInteger(size) || size < 0 || size > 50 * 1024 * 1024 || offset !== 0 || bytes.length > size || (size > 0 && bytes.length === 0)) throw new Error('Invalid attachment size.');
      if (this.uploads.size >= 4 || note.attachments.length >= 50) throw new Error('Too many attachments or active uploads.');
      uploadId = randomUUID();
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-') + '-UTC';
      const directory = join(tmpdir(), '.avi', 'visualizations', stamp, 'note-uploads', uploadId);
      mkdirSync(directory, { recursive: true });
      const path = join(directory, name);
      writeFileSync(path, Buffer.alloc(0), { flag: 'wx' });
      upload = { id, size, path, directory, offset: 0, expiresAt: Date.now() + 600000 };
      this.uploads.set(uploadId, upload);
      const timer = setTimeout(() => {
        const current = this.uploads.get(uploadId);
        if (current === upload) { rmSync(upload.directory, { recursive: true, force: true }); this.uploads.delete(uploadId); }
      }, 600000);
      timer.unref();
    }
    if (offset !== upload.offset || offset + bytes.length > upload.size || (!bytes.length && upload.size !== 0)) throw new Error('Unexpected upload offset or size.');
    appendFileSync(upload.path, bytes);
    upload.offset += bytes.length;
    if (upload.offset < upload.size) return { uploadId, offset: upload.offset, complete: false };
    try {
      const updated = this.addAttachment({ id, path: upload.path });
      return { uploadId, offset: upload.offset, complete: true, note: updated };
    } finally { rmSync(upload.directory, { recursive: true, force: true }); this.uploads.delete(uploadId); }
  }

  attachment({ id, attachmentId }) {
    const note = this.get(id);
    const attachment = note.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new Error('Attachment not found.');
    return { ...attachment, path: join(this.directory, note.id, attachment.id) };
  }

  deleteList({ id, archivedOnly = false }) {
    if (typeof archivedOnly !== 'boolean') throw new Error('Invalid archivedOnly flag.');
    if (!this.lists({ archived: null }).some((list) => list.id === id)) throw new Error('Note list not found.');
    const notes = this.db.prepare('SELECT id, data FROM user_notes WHERE list_id = ?').all(id)
      .filter((row) => {
        const note = JSON.parse(row.data);
        return !archivedOnly || note.archived;
      });
    this.db.exec('BEGIN');
    try {
      for (const note of notes) this.db.prepare('DELETE FROM user_notes WHERE id = ?').run(note.id);
      if (!archivedOnly) this.db.prepare('DELETE FROM note_lists WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const note of notes) rmSync(join(this.directory, note.id), { recursive: true, force: true });
    this.emit('changed');
    return { deleted: notes.length };
  }

  reorder({ listId, ids }) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Invalid reorder IDs.');
    const items = listId ? this.db.prepare('SELECT data FROM user_notes WHERE list_id = ?').all(listId)
      .map((row) => JSON.parse(row.data)).sort((a, b) => a.position - b.position) : this.lists({ archived: null });
    const available = new Set(items.map((item) => item.id));
    const selected = new Set(ids);
    if (ids.some((id) => !available.has(id))) throw new Error('Reorder contains unknown IDs.');
    const ordered = [...ids, ...items.filter((item) => !selected.has(item.id)).map((item) => item.id)];
    this.db.exec('BEGIN');
    try {
      ordered.forEach((id, position) => listId ? this.save({ id, position }) : this.saveList({ id, position }));
      if (listId) this.saveList({ id: listId, orderBy: 'manual' });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { reordered: ordered.length };
  }
}
