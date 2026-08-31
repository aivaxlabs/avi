import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearWorkspaceMentionCache,
  indexWorkspaceMentions,
  searchWorkspaceMentions,
} from '../src/main/workspace-mentions.js';

const root = await mkdtemp(join(tmpdir(), 'avi-workspace-mentions-'));

try {
  await mkdir(join(root, 'src', 'features', 'chat', 'deep', 'excluded'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'hidden'), { recursive: true });
  await writeFile(join(root, 'src', 'features', 'chat', 'Composer.jsx'), 'export {}\n');
  await writeFile(join(root, 'src', 'features', 'chat', 'screen.png'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'src', 'features', 'chat', 'deep', 'visible.md'), '# visible\n');
  await writeFile(join(root, 'src', 'features', 'chat', 'deep', 'excluded', 'too-deep.txt'), 'hidden\n');
  await writeFile(join(root, 'node_modules', 'hidden', 'ignored.js'), 'ignored\n');

  const index = await indexWorkspaceMentions(root, { now: 100, ttlMs: 50 });
  assert(index.items.some(({ path }) => path === 'src/features/chat/deep/visible.md'));
  assert(!index.items.some(({ path }) => path.includes('too-deep.txt')));
  assert(!index.items.some(({ path }) => path.includes('node_modules')));

  const fuzzy = await searchWorkspaceMentions(root, 'cmpjsx', { now: 110, ttlMs: 50 });
  assert.equal(fuzzy[0]?.path, 'src/features/chat/Composer.jsx');
  const prioritized = await searchWorkspaceMentions(root, 'chat', { now: 110, ttlMs: 50 });
  const textIndex = prioritized.findIndex(({ path }) => path.endsWith('Composer.jsx'));
  const binaryIndex = prioritized.findIndex(({ path }) => path.endsWith('screen.png'));
  assert(textIndex >= 0 && binaryIndex >= 0 && textIndex < binaryIndex);

  await writeFile(join(root, 'cached.txt'), 'cached\n');
  const cached = await indexWorkspaceMentions(root, { now: 120, ttlMs: 50 });
  assert.strictEqual(cached, index);
  const refreshed = await indexWorkspaceMentions(root, { now: 151, ttlMs: 50 });
  assert.notStrictEqual(refreshed, index);
  assert(refreshed.items.some(({ path }) => path === 'cached.txt'));

  const bucket = join(root, 'bucket');
  await mkdir(bucket);
  await Promise.all(Array.from({ length: 2050 }, (_, indexValue) => (
    writeFile(join(bucket, `file-${String(indexValue).padStart(4, '0')}.txt`), '')
  )));
  clearWorkspaceMentionCache();
  const bucketIndex = await indexWorkspaceMentions(root);
  const bucketInfo = bucketIndex.directories.find(({ path }) => path === 'bucket');
  assert.equal(bucketInfo.fileCount, 2048);
  assert.equal(bucketInfo.truncated, true);
  assert.equal(bucketIndex.items.filter(({ path }) => path.startsWith('bucket/')).length, 2048);

  console.log('Workspace mention index tests passed.');
} finally {
  clearWorkspaceMentionCache();
  await rm(root, { recursive: true, force: true });
}
