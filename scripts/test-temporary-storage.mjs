import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearTemporaryStorage, getTemporaryStorage } from '../src/main/temporary-storage.js';

const root = await mkdtemp(join(tmpdir(), 'avi-temporary-storage-test-'));

try {
  await mkdir(join(root, 'nested'));
  await Promise.all([
    writeFile(join(root, 'first.txt'), Buffer.alloc(11)),
    writeFile(join(root, 'nested', 'second.txt'), Buffer.alloc(29)),
  ]);

  assert.deepEqual(await getTemporaryStorage(root), { path: root, bytes: 40 });
  assert.deepEqual(await clearTemporaryStorage(root), { path: root, bytes: 0 });
  assert.deepEqual(await getTemporaryStorage(root), { path: root, bytes: 0 });
  console.log('Temporary storage checks passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
