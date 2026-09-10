import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const testRoot = join(tmpdir(), '.avi', 'visualizations', timestamp, 'notes-core-api');
mkdirSync(testRoot, { recursive: true });
const profile = mkdtempSync(join(testRoot, 'profile-'));
process.env.USERPROFILE = profile;

let database;
let runtime;
let failed = false;
try {
  database = await import('../src/main/database.js');
  const { PluginRuntime } = await import('../src/main/plugin-runtime.js');
  const { createPluginDomainApi } = await import('../src/main/plugin-domain-api.js');
  runtime = new PluginRuntime({
    pluginsDir: join(profile, 'plugins'),
    services: { createDomainApi: createPluginDomainApi },
  });

  const avi = await runtime.activate({ id: 'notes-full', capabilities: ['notes.read', 'notes.manage'] });

  const list = await avi.notes.saveList({ name: 'Core lab', orderBy: 'manual' });
  assert.ok(list.id);
  assert.equal(list.name, 'Core lab');
  list.name = 'Mutated snapshot';
  assert.equal((await avi.notes.lists()).find((item) => item.id === list.id).name, 'Core lab');

  const note = await avi.notes.save({ listId: list.id, title: 'Detached snapshot', description: 'original' });
  note.title = 'Mutated snapshot';
  note.attachments = [];
  const reread = await avi.notes.get(note.id);
  assert.equal(reread.title, 'Detached snapshot');
  assert.deepEqual(reread.attachments, []);
  reread.title = 'Mutated again';
  assert.equal((await avi.notes.get(note.id)).title, 'Detached snapshot');

  const other = await avi.notes.save({ listId: list.id, title: 'Second note' });
  const third = await avi.notes.save({ listId: list.id, title: 'Third note' });
  const search = await avi.notes.search({ listIds: [list.id], query: 'snapshot' });
  assert.equal(search.total, 1);
  search.notes[0].title = 'Mutated snapshot';
  assert.equal((await avi.notes.search({ listIds: [list.id], query: 'snapshot' })).total, 1);

  const reordered = await avi.notes.reorder({ listId: list.id, ids: [third.id, note.id, other.id] });
  assert.equal(reordered.reordered, 3);
  const manual = await avi.notes.search({ listIds: [list.id], orderBy: 'manual' });
  assert.deepEqual(manual.notes.map((item) => item.title), ['Third note', 'Detached snapshot', 'Second note']);
  assert.deepEqual(manual.notes.map((item) => item.position), [0, 1, 2]);

  const secondList = await avi.notes.saveList({ name: 'Archive me', archived: true });
  assert.deepEqual(await avi.notes.reorder({ ids: [secondList.id, list.id] }), { reordered: 2 });
  assert.deepEqual((await avi.notes.lists({ archived: null })).map((item) => item.id), [secondList.id, list.id]);
  assert.deepEqual(await avi.notes.deleteList({ id: secondList.id }), { deleted: 0 });

  const fixturePath = join(profile, 'fixtures', 'domain.txt');
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, 'domain attachment');
  const withAttachment = await avi.notes.addAttachment({ id: note.id, path: fixturePath });
  assert.equal(withAttachment.attachments.length, 1);
  assert.equal(withAttachment.attachments[0].name, 'domain.txt');
  withAttachment.attachments.pop();
  assert.equal((await avi.notes.get(note.id)).attachments.length, 1);
  const domainAttachment = (await avi.notes.get(note.id)).attachments[0];
  const attachmentRead = await avi.notes.readAttachment({ id: note.id, attachmentId: domainAttachment.id });
  assert.equal(attachmentRead.bytesRead, 'domain attachment'.length);
  assert.equal(Buffer.from(attachmentRead.data, 'base64').toString('utf8'), 'domain attachment');

  const roundtripBytes = Buffer.alloc(300000);
  for (let index = 0; index < roundtripBytes.length; index += 1) roundtripBytes[index] = (index * 31 + (index >>> 8)) & 0xff;
  const chunkSize = 262144;
  let uploadId = null;
  let progress = null;
  for (let offset = 0; offset < roundtripBytes.length; offset += chunkSize) {
    const slice = roundtripBytes.subarray(offset, Math.min(offset + chunkSize, roundtripBytes.length));
    progress = await avi.notes.uploadAttachment({ id: note.id, name: 'roundtrip.bin', size: roundtripBytes.length, uploadId, offset, data: slice.toString('base64') });
    uploadId ??= progress.uploadId;
  }
  assert.equal(progress.complete, true);
  assert.equal(progress.offset, roundtripBytes.length);
  const roundtripAttachment = (await avi.notes.get(note.id)).attachments.find((item) => item.name === 'roundtrip.bin');
  assert.equal(roundtripAttachment.size, roundtripBytes.length);
  const head = await avi.notes.readAttachment({ id: note.id, attachmentId: roundtripAttachment.id });
  assert.equal(head.bytesRead, 262144);
  assert.ok(Buffer.from(head.data, 'base64').equals(roundtripBytes.subarray(0, 262144)));
  const tail = await avi.notes.readAttachment({ id: note.id, attachmentId: roundtripAttachment.id, offset: 262144 });
  assert.equal(tail.bytesRead, 37856);
  assert.ok(Buffer.from(tail.data, 'base64').equals(roundtripBytes.subarray(262144)));

  await assert.rejects(avi.notes.uploadAttachment({ id: note.id, name: 'bad.bin', size: 1, data: '####' }), /Invalid upload chunk/);
  await assert.rejects(avi.notes.uploadAttachment({ id: note.id, uploadId: 'bogus-upload', offset: 0, data: '' }), /Note upload not found or expired/);
  const attachmentsBefore = (await avi.notes.get(note.id)).attachments.length;
  const started = await avi.notes.uploadAttachment({ id: note.id, name: 'cancelled.bin', size: 10, data: 'AAAA' });
  assert.equal(started.complete, false);
  assert.deepEqual(await avi.notes.uploadAttachment({ id: note.id, uploadId: started.uploadId, cancel: true }), { canceled: true });
  assert.equal((await avi.notes.get(note.id)).attachments.length, attachmentsBefore);
  await assert.rejects(avi.notes.uploadAttachment({ id: note.id, uploadId: started.uploadId, offset: 3, data: 'AAAA' }), /Note upload not found or expired/);
  const emptyDone = await avi.notes.uploadAttachment({ id: note.id, name: 'empty.bin', size: 0 });
  assert.equal(emptyDone.complete, true);
  const emptyAttachment = (await avi.notes.get(note.id)).attachments.find((item) => item.name === 'empty.bin');
  assert.equal(emptyAttachment.size, 0);
  const emptyRead = await avi.notes.readAttachment({ id: note.id, attachmentId: emptyAttachment.id });
  assert.equal(emptyRead.bytesRead, 0);
  assert.equal(emptyRead.data, '');

  const reader = await runtime.activate({ id: 'notes-reader', capabilities: ['notes.read'] });
  assert.deepEqual((await reader.notes.lists()).map((item) => item.id), [list.id]);
  assert.equal((await reader.notes.get(note.id)).title, 'Detached snapshot');
  assert.equal((await reader.notes.search({ query: 'snapshot' })).total, 1);
  assert.equal((await reader.notes.readAttachment({ id: note.id, attachmentId: roundtripAttachment.id, offset: 0, length: 4 })).bytesRead, 4);
  await assert.rejects(reader.notes.save({ listId: list.id, title: 'Nope' }), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(reader.notes.saveList({ name: 'Nope' }), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(reader.notes.deleteList({ id: list.id }), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(reader.notes.reorder({ listId: list.id, ids: [note.id] }), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(reader.notes.addAttachment({ id: note.id, path: fixturePath }), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(reader.notes.uploadAttachment({ id: note.id, name: 'nope.bin', size: 1 }), { code: 'CAPABILITY_REQUIRED' });

  const writer = await runtime.activate({ id: 'notes-writer', capabilities: ['notes.manage'] });
  const writerList = await writer.notes.saveList({ name: 'Writer list' });
  assert.ok(writerList.id);
  const blindWrite = await writer.notes.save({ listId: writerList.id, title: 'Blind write' });
  assert.equal(blindWrite.title, 'Blind write');
  await assert.rejects(writer.notes.lists(), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(writer.notes.get(note.id), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(writer.notes.search({}), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(writer.notes.readAttachment({ id: note.id, attachmentId: roundtripAttachment.id }), { code: 'CAPABILITY_REQUIRED' });

  const denied = await runtime.activate({ id: 'notes-denied', capabilities: [] });
  for (const method of ['lists', 'get', 'search', 'readAttachment', 'saveList', 'save', 'deleteList', 'reorder', 'addAttachment', 'uploadAttachment']) {
    await assert.rejects(denied.notes[method]({}), { code: 'CAPABILITY_REQUIRED' }, `notes.${method} should require a capability`);
  }

  await runtime.deactivate('notes-full', 'test-complete');
  await assert.rejects(avi.notes.lists(), { code: 'DISPOSED' });
  await assert.rejects(avi.notes.save({ listId: list.id, title: 'Nope' }), { code: 'DISPOSED' });
  await assert.rejects(avi.notes.uploadAttachment({ id: note.id, name: 'x.bin', size: 1 }), { code: 'DISPOSED' });
  assert.equal((await reader.notes.get(note.id)).title, 'Detached snapshot');

  assert.deepEqual(await writer.notes.deleteList({ id: list.id }), { deleted: 3 });
  assert.deepEqual(await writer.notes.deleteList({ id: writerList.id }), { deleted: 1 });

  console.log('Notes Core API tests passed.');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const id of ['notes-full', 'notes-reader', 'notes-writer', 'notes-denied']) {
    try { await runtime?.deactivate(id, 'test-complete'); } catch { /* already deactivated */ }
  }
  try { database?.closeDatabase(); } catch { /* already closed */ }
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
