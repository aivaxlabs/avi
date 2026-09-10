import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const stampNow = new Date();
const offsetMinutes = -stampNow.getTimezoneOffset();
const timezone = `utc${offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`;
const stamp = `${stampNow.getFullYear()}-${String(stampNow.getMonth() + 1).padStart(2, '0')}-${String(stampNow.getDate()).padStart(2, '0')}-${String(stampNow.getHours()).padStart(2, '0')}-${String(stampNow.getMinutes()).padStart(2, '0')}-${timezone}`;
const testRoot = join(tmpdir(), '.avi', 'visualizations', stamp, 'notes-test', randomUUID());
const resolvedRoot = resolve(testRoot);
assert.ok(resolvedRoot.startsWith(resolve(tmpdir())));
mkdirSync(testRoot, { recursive: true });

const dbPath = join(testRoot, 'notes.sqlite');
const storageDir = join(testRoot, 'storage');
const fixturesDir = join(testRoot, 'fixtures');
mkdirSync(fixturesDir, { recursive: true });

// Windows Date.now() can tick in ~15ms steps; small waits keep createdAt/updatedAt
// strictly ordered so time-based sorting and range filters stay deterministic.
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const futureISO = (days, base = Date.now()) => new Date(base + days * 86400000).toISOString();

let database = new DatabaseSync(dbPath);
let store = null;
let changes = 0;
let failed = false;

try {
  const { NotesStore } = await import('../src/main/notes-store.js');
  store = new NotesStore(database, storageDir);
  store.on('changed', () => { changes += 1; });

  assert.deepEqual(store.lists(), []);
  assert.throws(() => store.saveList(), /A list name is required/);
  assert.throws(() => store.saveList({ name: '   ' }), /Invalid list name/);
  assert.throws(() => store.saveList({ name: 'x'.repeat(201) }), /Invalid list name/);
  assert.throws(() => store.saveList({ name: 'F', orderBy: 'nope' }), /Invalid note ordering/);
  assert.throws(() => store.saveList({ name: 'F', archived: 'yes' }), /Invalid archived flag/);
  assert.throws(() => store.saveList({ name: 'F', position: -1 }), /Invalid list position/);
  assert.throws(() => store.saveList({ name: 'F', folderPath: 123 }), /Invalid folder path/);
  assert.throws(() => store.saveList({ name: 'F', folderPath: 'relative/path' }), /Folder path must be absolute/);
  assert.throws(() => store.lists({ folderPath: 'relative/path' }), /Folder path must be absolute/);
  assert.throws(() => store.saveList({ id: 'missing', name: 'F' }), /Note list not found/);

  const work = store.saveList({ name: 'Work', folderPath: 'C:/proj/alpha' });
  assert.equal(changes, 1);
  assert.equal(work.name, 'Work');
  assert.equal(work.folderPath, normalize('C:/proj/alpha'));
  assert.equal(work.archived, false);
  assert.equal(work.orderBy, 'urgency');
  assert.equal(work.position, 0);
  const personal = store.saveList({ name: 'Personal' });
  const archivedProjects = store.saveList({ name: 'Archived projects', folderPath: null });
  assert.deepEqual(store.lists().map((list) => list.id), [work.id, personal.id, archivedProjects.id]);
  assert.deepEqual(store.lists({ folderPath: 'C:/proj/alpha' }).map((list) => list.id), [work.id]);
  assert.deepEqual(store.lists({ folderPath: null }).map((list) => list.id), [personal.id, archivedProjects.id]);

  const renamed = store.saveList({ id: personal.id, name: '  Personal life  ' });
  assert.equal(renamed.name, 'Personal life');
  assert.equal(renamed.createdAt, personal.createdAt);
  assert.ok(renamed.updatedAt >= personal.updatedAt);
  assert.equal(store.saveList({ id: personal.id, name: 'Personal' }).name, 'Personal');

  assert.throws(() => store.save({ listId: work.id }), /A title is required/);
  assert.throws(() => store.save({ listId: work.id, title: '   ' }), /Invalid title/);
  assert.throws(() => store.save({ listId: work.id, title: 123 }), /Invalid title/);
  assert.throws(() => store.save({ listId: work.id, title: 'x'.repeat(501) }), /Invalid title/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', description: 'x'.repeat(200001) }), /Invalid description/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', priority: 'asap' }), /Invalid priority/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', dueAt: 'not-a-date' }), /Invalid due date/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', dueAt: 5 }), /Invalid due date/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', done: 'yes' }), /Invalid done flag/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', archived: 'yes' }), /Invalid archived flag/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', position: -1 }), /Invalid note position/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', position: 1.5 }), /Invalid note position/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', subtasks: 'nope' }), /Invalid subtasks/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', subtasks: [{ text: 'a' }] }), /Invalid subtask/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', subtasks: [{ id: 'a', text: 'a', done: false }, { id: 'a', text: 'b', done: false }] }), /Duplicate subtask IDs/);
  assert.throws(() => store.save({ listId: work.id, title: 'T', subtasks: [{ text: '   ', done: false }] }), /Invalid subtask text/);
  assert.throws(() => store.save({ id: 'nope', title: 'T' }), /Note not found/);
  assert.throws(() => store.get(''), /Invalid note ID/);
  assert.throws(() => store.get('x'.repeat(101)), /Invalid note ID/);
  assert.throws(() => store.get('missing-note'), /Note not found/);

  const dueString = new Date(Date.now() + 86400000).toUTCString();
  const nLogin = store.save({ listId: work.id, title: '  Fix login bug  ', priority: 'high', dueAt: dueString, description: 'Auth regression', position: 2 });
  assert.equal(nLogin.title, 'Fix login bug');
  assert.equal(nLogin.dueAt, new Date(dueString).toISOString());
  assert.equal(nLogin.priority, 'high');
  assert.equal(nLogin.position, 2);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(nLogin.createdAt));
  await wait(25);
  const nPay = store.save({ listId: work.id, title: 'Send invoice', priority: 'urgent' });
  await wait(25);
  const nDoc = store.save({ listId: work.id, title: 'Write docs', priority: 'low', subtasks: [{ text: 'Outline sections', done: false }] });
  await wait(25);
  const nOld = store.save({ listId: work.id, title: 'Archive old files', priority: 'none', dueAt: futureISO(-2) });
  const nUpd = store.save({ listId: personal.id, title: 'Update target', description: 'before' });

  await wait(25);
  const updated = store.save({ id: nUpd.id, priority: 'urgent', dueAt: null, description: 'after' });
  assert.equal(updated.priority, 'urgent');
  assert.equal(updated.dueAt, null);
  assert.equal(updated.description, 'after');
  assert.equal(updated.title, 'Update target');
  assert.equal(updated.id, nUpd.id);
  assert.equal(updated.createdAt, nUpd.createdAt);
  assert.ok(updated.updatedAt > updated.createdAt);
  assert.throws(() => store.save({ id: nUpd.id, title: '' }), /Invalid title/);

  const withSubtasks = store.save({
    listId: personal.id,
    title: 'Subtask keeper',
    subtasks: [
      { id: 'fixed-1', text: '  keep me  ', done: true },
      { text: 'generated id', done: false },
    ],
  });
  assert.deepEqual(withSubtasks.subtasks.map((item) => [item.id, item.text, item.done]), [
    ['fixed-1', 'keep me', true],
    [withSubtasks.subtasks[1].id, 'generated id', false],
  ]);

  assert.throws(() => store.search({ listIds: 'nope' }), /Invalid list IDs/);
  assert.throws(() => store.search({ orderBy: 'random' }), /Invalid note ordering/);
  assert.throws(() => store.search({ priority: 'asap' }), /Invalid priority/);
  assert.throws(() => store.search({ done: 'yes' }), /Invalid done flag/);
  assert.throws(() => store.search({ archived: 0 }), /Invalid archived flag/);
  assert.throws(() => store.search({ limit: 0 }), /Invalid pagination/);
  assert.throws(() => store.search({ limit: 5001 }), /Invalid pagination/);
  assert.throws(() => store.search({ offset: -1 }), /Invalid pagination/);
  assert.throws(() => store.search({ query: 'x'.repeat(10001) }), /Invalid search query/);
  assert.throws(() => store.search({ createdAfter: 'bad' }), /Invalid createdAt/);

  const workSearch = () => store.search({ listIds: [work.id] });
  assert.deepEqual(workSearch().notes.map((note) => note.title).sort(), ['Archive old files', 'Fix login bug', 'Send invoice', 'Write docs']);
  assert.equal(workSearch().total, 4);
  assert.deepEqual(store.search({ listIds: [work.id], priority: 'high' }).notes.map((note) => note.id), [nLogin.id]);
  assert.deepEqual(store.search({ listIds: [work.id], priority: 'urgent' }).notes.map((note) => note.id), [nPay.id]);
  assert.deepEqual(store.search({ listIds: [work.id], priority: 'medium' }).notes, []);

  const boundary = futureISO(0);
  assert.deepEqual(store.search({ listIds: [work.id], dueAfter: boundary }).notes.map((note) => note.id), [nLogin.id]);
  assert.deepEqual(store.search({ listIds: [work.id], dueBefore: boundary }).notes.map((note) => note.id), [nOld.id]);
  assert.deepEqual(store.search({ listIds: [work.id], priority: 'high', dueAfter: boundary }).notes.map((note) => note.id), [nLogin.id]);
  assert.deepEqual(store.search({ listIds: [work.id], dueAfter: futureISO(-1), dueBefore: futureISO(3) }).notes.map((note) => note.id), [nLogin.id]);

  assert.deepEqual(store.search({ listIds: [personal.id] }).notes.map((note) => note.id).sort(), [withSubtasks.id, nUpd.id].sort());
  assert.deepEqual(store.search({ listIds: [personal.id], archived: true }).notes, []);

  const nShop = store.save({ listId: personal.id, title: 'Shopping', subtasks: [{ text: 'Renew SSL certificate', done: false }] });
  assert.match(nShop.subtasks[0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(store.search({ listIds: [personal.id] }).notes.map((note) => note.id).sort(), [nShop.id, withSubtasks.id, nUpd.id].sort());
  assert.deepEqual(store.search({ query: 'certificate' }).notes.map((note) => note.id), [nShop.id]);
  assert.deepEqual(store.search({ query: 'SSL CERT' }).notes.map((note) => note.id), [nShop.id]);
  assert.deepEqual(store.search({ query: 'login bug' }).notes.map((note) => note.id), [nLogin.id]);
  assert.deepEqual(store.search({ query: 'no-such-needle' }).notes, []);
  const folderScoped = store.search({ folderPath: 'C:/proj/alpha' });
  assert.ok(folderScoped.total >= 4);
  assert.ok(folderScoped.notes.every((note) => note.listId === work.id));

  const paged = store.search({ listIds: [work.id], limit: 2, offset: 1, orderBy: 'createdAt' });
  assert.equal(paged.total, 4);
  assert.equal(paged.notes.length, 2);
  const orderedByCreation = store.search({ listIds: [work.id], orderBy: 'createdAt' }).notes;
  assert.deepEqual(paged.notes.map((note) => note.id), orderedByCreation.slice(1, 3).map((note) => note.id));
  assert.deepEqual(store.search({ listIds: [work.id], offset: 99 }).notes, []);
  assert.equal(store.search({ listIds: [work.id], offset: 99 }).total, 4);

  const markedDone = store.save({ id: nOld.id, done: true });
  assert.equal(markedDone.done, true);
  assert.equal(markedDone.archived, false);
  assert.deepEqual(store.search({ listIds: [work.id], done: true }).notes.map((note) => note.id), [nOld.id]);
  assert.deepEqual(store.search({ listIds: [work.id], done: false }).notes.map((note) => note.id).sort(), [nDoc.id, nLogin.id, nPay.id].sort());

  const sortLab = store.saveList({ name: 'Sort lab' });
  await wait(25);
  const s1 = store.save({ listId: sortLab.id, title: 's1 none', priority: 'none' });
  await wait(25);
  const s2 = store.save({ listId: sortLab.id, title: 's2 low', priority: 'low' });
  await wait(25);
  const s3 = store.save({ listId: sortLab.id, title: 's3 medium', priority: 'medium' });
  await wait(25);
  const s4 = store.save({ listId: sortLab.id, title: 's4 high', priority: 'high' });
  await wait(25);
  const s5 = store.save({ listId: sortLab.id, title: 's5 urgent', priority: 'urgent' });
  await wait(25);
  const s6 = store.save({ listId: sortLab.id, title: 's6 due late', priority: 'none', dueAt: futureISO(30) });
  await wait(25);
  const s7 = store.save({ listId: sortLab.id, title: 's7 due soon', priority: 'none', dueAt: futureISO(1) });
  await wait(25);
  const s8 = store.save({ listId: sortLab.id, title: 's8 done urgent', priority: 'urgent', done: true });

  const sortSearch = (orderBy) => store.search({ listIds: [sortLab.id], orderBy }).notes.map((note) => note.title);
  assert.deepEqual(sortSearch('urgency'), ['s5 urgent', 's4 high', 's3 medium', 's7 due soon', 's2 low', 's1 none', 's6 due late', 's8 done urgent']);
  assert.deepEqual(sortSearch('priority'), ['s5 urgent', 's8 done urgent', 's4 high', 's3 medium', 's2 low', 's1 none', 's6 due late', 's7 due soon']);
  assert.deepEqual(sortSearch('createdAt'), ['s8 done urgent', 's7 due soon', 's6 due late', 's5 urgent', 's4 high', 's3 medium', 's2 low', 's1 none']);
  assert.deepEqual(sortSearch('dueAt').slice(0, 2), ['s7 due soon', 's6 due late']);
  assert.deepEqual(sortSearch('dueAt').slice(2).sort(), ['s1 none', 's2 low', 's3 medium', 's4 high', 's5 urgent', 's8 done urgent']);

  await wait(25);
  store.save({ id: s2.id, description: 'bumped for updatedAt sort' });
  assert.deepEqual(sortSearch('updatedAt'), ['s2 low', 's8 done urgent', 's7 due soon', 's6 due late', 's5 urgent', 's4 high', 's3 medium', 's1 none']);
  assert.deepEqual(sortSearch('urgency'), ['s5 urgent', 's4 high', 's3 medium', 's7 due soon', 's2 low', 's1 none', 's6 due late', 's8 done urgent']);

  assert.throws(() => store.reorder({ listId: sortLab.id, ids: [s1.id, s1.id] }), /Invalid reorder IDs/);
  assert.throws(() => store.reorder({ listId: sortLab.id, ids: ['unknown'] }), /Reorder contains unknown IDs/);
  const scratch = store.saveList({ name: 'Scratch' });

  const noteReorder = store.reorder({ listId: sortLab.id, ids: [s8.id, s5.id, s1.id] });
  assert.equal(noteReorder.reordered, 8);
  assert.equal(store.lists({ archived: null }).find((list) => list.id === sortLab.id).orderBy, 'manual');
  assert.deepEqual(store.search({ listIds: [sortLab.id], orderBy: 'manual' }).notes.map((note) => note.title), [
    's8 done urgent', 's5 urgent', 's1 none', 's2 low', 's3 medium', 's4 high', 's6 due late', 's7 due soon',
  ]);
  const manualNotes = store.search({ listIds: [sortLab.id], orderBy: 'manual' }).notes;
  assert.deepEqual(manualNotes.map((note) => note.position), [0, 1, 2, 3, 4, 5, 6, 7]);

  const listReorder = store.reorder({ ids: [personal.id, work.id] });
  assert.equal(listReorder.reordered, 5);
  const listPositions = new Map(store.lists({ archived: null }).map((list) => [list.id, list.position]));
  assert.deepEqual([...listPositions.entries()], [
    [personal.id, 0], [work.id, 1], [archivedProjects.id, 2], [sortLab.id, 3], [scratch.id, 4],
  ]);
  assert.equal(store.lists({ archived: null }).find((list) => list.id === personal.id).orderBy, 'urgency');

  const fixtureA = join(fixturesDir, 'report.txt');
  const fixtureB = join(fixturesDir, 'data.md');
  const fixtureC = join(fixturesDir, 'invoice.csv');
  writeFileSync(fixtureA, 'attachment alpha');
  writeFileSync(fixtureB, '# data body');
  writeFileSync(fixtureC, 'id,total\n1,42\n');

  const nAttach = store.save({ listId: scratch.id, title: 'Attachments home' });
  assert.throws(() => store.addAttachment({ id: 'missing-note', path: fixtureA }), /Note not found/);
  assert.throws(() => store.addAttachment({ id: nAttach.id, path: join(fixturesDir, 'missing.bin') }), /ENOENT/);
  const notAFile = join(fixturesDir, 'not-a-file');
  mkdirSync(notAFile);
  assert.throws(() => store.addAttachment({ id: nAttach.id, path: notAFile }), /Attachments must be files/);
  const oversized = join(fixturesDir, 'oversized.bin');
  writeFileSync(oversized, Buffer.alloc(50 * 1024 * 1024 + 1));
  assert.throws(() => store.addAttachment({ id: nAttach.id, path: oversized }), /Attachments must be files/);

  const withA = store.addAttachment({ id: nAttach.id, path: fixtureA });
  assert.equal(withA.attachments.length, 1);
  assert.equal(withA.attachments[0].name, 'report.txt');
  assert.equal(withA.attachments[0].size, 'attachment alpha'.length);
  const resolvedA = store.attachment({ id: nAttach.id, attachmentId: withA.attachments[0].id });
  assert.equal(resolvedA.name, 'report.txt');
  assert.ok(existsSync(resolvedA.path));
  assert.equal(readFileSync(resolvedA.path, 'utf8'), 'attachment alpha');

  const withB = store.addAttachment({ id: nAttach.id, path: fixtureB });
  assert.equal(withB.attachments.length, 2);
  const idA = withA.attachments[0].id;
  const idB = withB.attachments[1].id;
  const pruned = store.save({ id: nAttach.id, removeAttachmentIds: [idA] });
  assert.deepEqual(pruned.attachments.map((item) => item.id), [idB]);
  assert.equal(existsSync(join(storageDir, 'note-attachments', nAttach.id, idA)), false);
  assert.equal(existsSync(join(storageDir, 'note-attachments', nAttach.id, idB)), true);
  assert.throws(() => store.save({ id: nAttach.id, removeAttachmentIds: [idA] }), /Invalid attachment IDs/);
  assert.throws(() => store.attachment({ id: nAttach.id, attachmentId: idA }), /Attachment not found/);

  const withC = store.addAttachment({ id: nPay.id, path: fixtureC });
  assert.equal(withC.attachments.length, 1);

  const capNote = store.save({ listId: scratch.id, title: 'Cap note' });
  for (let index = 0; index < 50; index += 1) {
    const part = join(fixturesDir, `part-${index}.txt`);
    writeFileSync(part, `part ${index}`);
    store.addAttachment({ id: capNote.id, path: part });
  }
  assert.equal(store.get(capNote.id).attachments.length, 50);
  const extra = join(fixturesDir, 'part-50.txt');
  writeFileSync(extra, 'one too many');
  assert.throws(() => store.addAttachment({ id: capNote.id, path: extra }), /Attachments must be files/);

  const nProj = store.save({ listId: archivedProjects.id, title: 'Migrate project' });
  const nArch = store.save({ listId: personal.id, title: 'Archived memo', archived: true });
  assert.equal(nArch.done, false);

  store.saveList({ id: archivedProjects.id, archived: true });
  assert.throws(() => store.save({ listId: archivedProjects.id, title: 'Blocked' }), /Cannot add notes to an archived list/);
  assert.throws(() => store.save({ id: nShop.id, listId: archivedProjects.id }), /Cannot add notes to an archived list/);

  const byId = (result) => new Set(result.notes.map((note) => note.id));
  assert.equal(byId(store.search({ listIds: [archivedProjects.id] })).has(nProj.id), false);
  assert.equal(byId(store.search({ listIds: [archivedProjects.id], archived: true })).has(nProj.id), false);
  assert.equal(byId(store.search({ listIds: [archivedProjects.id], archived: null })).has(nProj.id), true);
  assert.equal(byId(store.search({ archived: true })).has(nArch.id), true);
  assert.equal(byId(store.search({ archived: true })).has(nProj.id), false);
  assert.equal(byId(store.search({ done: false, archived: true })).has(nArch.id), true);
  assert.equal(byId(store.search({ done: true, archived: true })).size, 0);
  assert.equal(byId(store.search({ done: true, archived: null })).has(nOld.id), true);
  assert.equal(byId(store.search({ done: true, archived: null })).has(s8.id), true);
  assert.equal(byId(store.search({ done: true, archived: null })).has(nArch.id), false);

  assert.throws(() => store.deleteList({ id: 'missing' }), /Note list not found/);
  store.save({ id: nProj.id, archived: true });
  assert.deepEqual(store.deleteList({ id: archivedProjects.id, archivedOnly: true }), { deleted: 1 });
  assert.throws(() => store.get(nProj.id), /Note not found/);
  assert.ok(store.lists({ archived: null }).some((list) => list.id === archivedProjects.id));
  assert.deepEqual(store.deleteList({ id: archivedProjects.id }), { deleted: 0 });
  assert.equal(store.lists({ archived: null }).some((list) => list.id === archivedProjects.id), false);

  const deletedScratch = store.deleteList({ id: scratch.id });
  assert.deepEqual(deletedScratch, { deleted: 2 });
  assert.equal(existsSync(join(storageDir, 'note-attachments', nAttach.id)), false);
  assert.equal(existsSync(join(storageDir, 'note-attachments', capNote.id)), false);
  assert.throws(() => store.get(nAttach.id), /Note not found/);

  const uploadLab = store.saveList({ name: 'Upload lab' });
  const uploadNote = store.save({ listId: uploadLab.id, title: 'Binary home' });
  const uploadNote2 = store.save({ listId: uploadLab.id, title: 'Wrong home' });

  assert.throws(() => store.uploadAttachment({ id: 'missing-note', name: 'a.txt', size: 1 }), /Note not found/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: 1, data: 42 }), /Invalid upload chunk/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: 1, data: '####' }), /Invalid upload chunk/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: 1, data: 'QR==' }), /Invalid upload chunk/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: 1, data: Buffer.alloc(262145, 7).toString('base64') }), /Invalid upload chunk/);
  assert.equal(store.uploads.size, 0);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: -1 }), /Invalid attachment size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: 1.5 }), /Invalid attachment size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: 50 * 1024 * 1024 + 1 }), /Invalid attachment size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'a.txt', size: 10, offset: 4 }), /Invalid attachment size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: '../evil.txt', size: 10 }), /Invalid attachment name/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'sub/dir.txt', size: 10 }), /Invalid attachment name/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'back\\slash.txt', size: 10 }), /Invalid attachment name/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: '..', size: 10 }), /Invalid attachment name/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: '   ', size: 10 }), /Invalid attachment name/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'x'.repeat(256), size: 10 }), /Invalid attachment name/);

  const small = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const first = store.uploadAttachment({ id: uploadNote.id, name: 'small.bin', size: small.length, data: small.subarray(0, 4).toString('base64') });
  assert.equal(first.complete, false);
  assert.equal(first.offset, 4);
  assert.ok(first.uploadId);
  const smallDir = store.uploads.get(first.uploadId).directory;
  assert.ok(smallDir.startsWith(join(tmpdir(), '.avi', 'visualizations')));
  assert.ok(smallDir.endsWith(join('note-uploads', first.uploadId)));
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, uploadId: first.uploadId, offset: 0, data: small.subarray(4).toString('base64') }), /Unexpected upload offset or size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, uploadId: first.uploadId, offset: 5, data: small.subarray(5).toString('base64') }), /Unexpected upload offset or size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, uploadId: first.uploadId, offset: 4, data: small.toString('base64') }), /Unexpected upload offset or size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, uploadId: first.uploadId, offset: 4, data: '' }), /Unexpected upload offset or size/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote2.id, uploadId: first.uploadId, offset: 4, data: small.subarray(4).toString('base64') }), /Note upload not found or expired/);
  const smallDone = store.uploadAttachment({ id: uploadNote.id, uploadId: first.uploadId, offset: 4, data: small.subarray(4).toString('base64') });
  assert.equal(smallDone.complete, true);
  assert.equal(smallDone.offset, small.length);
  assert.deepEqual(smallDone.note.attachments.map((item) => [item.name, item.size]), [['small.bin', 10]]);
  assert.equal(store.uploads.size, 0);
  assert.equal(existsSync(smallDir), false);
  const smallRead = await store.readAttachment({ id: uploadNote.id, attachmentId: smallDone.note.attachments[0].id });
  assert.equal(smallRead.bytesRead, 10);
  assert.ok(Buffer.from(smallRead.data, 'base64').equals(small));

  const roundtripBytes = Buffer.alloc(300000);
  for (let index = 0; index < roundtripBytes.length; index += 1) roundtripBytes[index] = (index * 31 + (index >>> 8)) & 0xff;
  const chunkSize = 262144;
  let roundtripId = null;
  let roundtripDir = null;
  const chunkResults = [];
  for (let offset = 0; offset < roundtripBytes.length; offset += chunkSize) {
    const slice = roundtripBytes.subarray(offset, Math.min(offset + chunkSize, roundtripBytes.length));
    const result = store.uploadAttachment({ id: uploadNote.id, name: 'roundtrip.bin', size: roundtripBytes.length, uploadId: roundtripId, offset, data: slice.toString('base64') });
    if (!roundtripId) {
      roundtripId = result.uploadId;
      roundtripDir = store.uploads.get(roundtripId).directory;
    }
    chunkResults.push(result);
  }
  assert.deepEqual(chunkResults.map((result) => [result.offset, result.complete]), [[262144, false], [300000, true]]);
  assert.equal(chunkResults[1].note.attachments.at(-1).name, 'roundtrip.bin');
  assert.equal(chunkResults[1].note.attachments.at(-1).size, 300000);
  assert.equal(existsSync(roundtripDir), false);
  assert.equal(store.uploads.size, 0);
  const roundtripAttachment = chunkResults[1].note.attachments.at(-1);
  assert.ok(readFileSync(store.attachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id }).path).equals(roundtripBytes));

  await assert.rejects(store.readAttachment({ id: 'missing-note', attachmentId: roundtripAttachment.id }), /Note not found/);
  await assert.rejects(store.readAttachment({ id: uploadNote.id, attachmentId: withC.attachments[0].id }), /Attachment not found/);
  await assert.rejects(store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id, offset: -1 }), /Invalid attachment range/);
  await assert.rejects(store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id, offset: 1.5 }), /Invalid attachment range/);
  await assert.rejects(store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id, length: 0 }), /Invalid attachment range/);
  await assert.rejects(store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id, length: 262145 }), /Invalid attachment range/);
  const head = await store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id });
  assert.deepEqual([head.name, head.size, head.offset, head.bytesRead], ['roundtrip.bin', 300000, 0, 262144]);
  assert.ok(Buffer.from(head.data, 'base64').equals(roundtripBytes.subarray(0, 262144)));
  const tail = await store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id, offset: 262144 });
  assert.deepEqual([tail.offset, tail.bytesRead], [262144, 37856]);
  assert.ok(Buffer.from(tail.data, 'base64').equals(roundtripBytes.subarray(262144)));
  const midWindow = await store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id, offset: 1000, length: 500 });
  assert.equal(midWindow.bytesRead, 500);
  assert.ok(Buffer.from(midWindow.data, 'base64').equals(roundtripBytes.subarray(1000, 1500)));
  const pastEnd = await store.readAttachment({ id: uploadNote.id, attachmentId: roundtripAttachment.id, offset: 300000 });
  assert.equal(pastEnd.bytesRead, 0);
  assert.equal(pastEnd.data, '');

  const emptyDone = store.uploadAttachment({ id: uploadNote.id, name: 'empty.bin', size: 0 });
  assert.equal(emptyDone.complete, true);
  const emptyAttachment = emptyDone.note.attachments.at(-1);
  assert.deepEqual([emptyAttachment.name, emptyAttachment.size], ['empty.bin', 0]);
  const emptyRead = await store.readAttachment({ id: uploadNote.id, attachmentId: emptyAttachment.id });
  assert.equal(emptyRead.bytesRead, 0);
  assert.equal(emptyRead.data, '');

  const attachmentsBefore = store.get(uploadNote.id).attachments.length;
  const activeIds = [];
  const activeDirs = [];
  for (let index = 0; index < 4; index += 1) {
    const started = store.uploadAttachment({ id: uploadNote.id, name: `active-${index}.bin`, size: 10, data: 'AAAA' });
    activeIds.push(started.uploadId);
    activeDirs.push(store.uploads.get(started.uploadId).directory);
  }
  assert.equal(store.uploads.size, 4);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, name: 'active-4.bin', size: 10, data: 'AAAA' }), /Too many attachments or active uploads/);
  assert.deepEqual(store.uploadAttachment({ id: uploadNote.id, uploadId: activeIds[0], cancel: true }), { canceled: true });
  assert.equal(existsSync(activeDirs[0]), false);
  assert.equal(store.get(uploadNote.id).attachments.length, attachmentsBefore);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, uploadId: activeIds[0], offset: 3, data: 'AAAA' }), /Note upload not found or expired/);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, uploadId: 'bogus-upload', cancel: true }), /Note upload not found or expired/);
  assert.deepEqual(store.uploadAttachment({ id: uploadNote.id, cancel: true }), { canceled: true });
  for (const uploadId of activeIds.slice(1)) store.uploads.get(uploadId).expiresAt = Date.now() - 1;
  assert.deepEqual(store.uploadAttachment({ id: uploadNote.id, cancel: true }), { canceled: true });
  assert.equal(store.uploads.size, 0);
  for (const directory of activeDirs.slice(1)) assert.equal(existsSync(directory), false);
  assert.throws(() => store.uploadAttachment({ id: uploadNote.id, uploadId: activeIds[3], offset: 3, data: 'AAAA' }), /Note upload not found or expired/);
  const fifth = store.uploadAttachment({ id: uploadNote.id, name: 'fifth.bin', size: 10, data: 'AAAA' });
  assert.ok(store.uploads.has(fifth.uploadId));
  const maxDeclared = store.uploadAttachment({ id: uploadNote.id, name: 'max-declared.bin', size: 50 * 1024 * 1024, data: 'AAAA' });
  assert.deepEqual([maxDeclared.complete, maxDeclared.offset], [false, 3]);
  store.uploadAttachment({ id: uploadNote.id, uploadId: fifth.uploadId, cancel: true });
  store.uploadAttachment({ id: uploadNote.id, uploadId: maxDeclared.uploadId, cancel: true });
  assert.equal(store.uploads.size, 0);

  assert.deepEqual(store.deleteList({ id: uploadLab.id }), { deleted: 2 });
  assert.equal(existsSync(join(storageDir, 'note-attachments', uploadNote.id)), false);
  assert.equal(existsSync(join(storageDir, 'note-attachments', uploadNote2.id)), false);

  const listsSnapshot = store.lists({ archived: null }).map((list) => [list.id, list.position, list.orderBy]);
  const nPaySnapshot = store.get(nPay.id);
  const manualSnapshot = store.search({ listIds: [sortLab.id], orderBy: 'manual' }).notes.map((note) => note.id);
  const attachmentCPath = store.attachment({ id: nPay.id, attachmentId: nPaySnapshot.attachments[0].id }).path;

  database.close();
  database = new DatabaseSync(dbPath);
  const { NotesStore: ReopenedStore } = await import('../src/main/notes-store.js');
  const reopened = new ReopenedStore(database, storageDir);
  let reopenedChanges = 0;
  reopened.on('changed', () => { reopenedChanges += 1; });

  assert.deepEqual(reopened.lists({ archived: null }).map((list) => [list.id, list.position, list.orderBy]), listsSnapshot);
  assert.deepEqual(reopened.get(nPay.id), nPaySnapshot);
  assert.deepEqual(reopened.search({ listIds: [sortLab.id], orderBy: 'manual' }).notes.map((note) => note.id), manualSnapshot);
  const reopenedAttachment = reopened.attachment({ id: nPay.id, attachmentId: withC.attachments[0].id });
  assert.equal(reopenedAttachment.path, attachmentCPath);
  assert.equal(readFileSync(reopenedAttachment.path, 'utf8'), 'id,total\n1,42\n');
  assert.equal(existsSync(join(storageDir, 'note-attachments', nAttach.id)), false);

  const renamedAfterReopen = reopened.saveList({ id: work.id, name: 'Work renamed' });
  assert.equal(renamedAfterReopen.name, 'Work renamed');
  assert.equal(reopenedChanges, 1);
  assert.ok(changes > 5);

  console.log('Notes store flow passed.');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  database?.close();
  rmSync(resolvedRoot, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
