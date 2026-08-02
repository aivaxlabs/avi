import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_TOOLS } from '../src/main/client-tools.js';
import {
  consolidateFileEdits,
  createUndoPrompt,
} from '../src/renderer/lib/file-edits.js';

const testRoot = await mkdtemp(join(tmpdir(), 'avi-file-edits-'));
const writeFileTool = CLIENT_TOOLS.find((tool) => tool.name === 'write_file');

try {
  assert.ok(writeFileTool);
  const existingPath = join(testRoot, 'existing.txt');
  await writeFile(existingPath, 'one\ntwo\nthree', 'utf8');

  const changed = await writeFileTool.execute({
    filePath: existingPath,
    content: 'one\nchanged\nthree\nfour',
  });
  assert.deepEqual(changed.fileChanges, [{
    filePath: existingPath,
    before: 'one\ntwo\nthree',
    after: 'one\nchanged\nthree\nfour',
  }]);
  assert.equal(await readFile(existingPath, 'utf8'), 'one\nchanged\nthree\nfour');

  const unchanged = await writeFileTool.execute({
    filePath: existingPath,
    content: 'one\nchanged\nthree\nfour',
  });
  assert.deepEqual(unchanged.fileChanges, []);

  const createdPath = join(testRoot, 'created.txt');
  const created = await writeFileTool.execute({
    filePath: createdPath,
    content: 'new file',
  });
  assert.equal(created.fileChanges[0].before, null);

  const edits = consolidateFileEdits([
    { edits: changed.fileChanges },
    { edits: [{ filePath: existingPath, before: 'ignored', after: 'one\nfinal\nthree' }] },
    { edits: created.fileChanges },
  ]);
  assert.equal(edits.length, 2);
  assert.deepEqual(edits[0], {
    filePath: existingPath,
    before: 'one\ntwo\nthree',
    after: 'one\nfinal\nthree',
    beforeLines: ['one', 'two', 'three'],
    afterLines: ['one', 'final', 'three'],
    beforeStartLine: 2,
    beforeEndLine: 2,
    afterStartLine: 2,
    afterEndLine: 2,
    additions: 1,
    deletions: 1,
  });
  assert.match(createUndoPrompt(edits), /existing\.txt \(original lines 2-2; current lines 2-2\)/);
  assert.match(createUndoPrompt(edits), /created\.txt \(file did not exist before this iteration/);

  const deletion = consolidateFileEdits([{ edits: [{
    filePath: existingPath,
    before: 'one\ntwo\nthree',
    after: 'one\nthree',
  }] }]);
  assert.match(createUndoPrompt(deletion), /current insertion point at line 2/);
  assert.equal(deletion[0].additions, 0);

  assert.deepEqual(consolidateFileEdits([{
    edits: [
      { filePath: existingPath, before: 'before', after: 'middle' },
      { filePath: existingPath, before: 'middle', after: 'before' },
    ],
  }]), []);

  console.log('File edits tests passed.');
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
process.exit(0);
