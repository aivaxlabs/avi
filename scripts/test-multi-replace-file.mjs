import assert from 'node:assert/strict';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = await mkdtemp(join(tmpdir(), 'avi-multi-replace-profile-'));
const testRoot = await mkdtemp(join(tmpdir(), 'avi-multi-replace-files-'));
process.env.USERPROFILE = resolve(testProfile);
process.env.HOME = resolve(testProfile);

const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
const { applyMultiReplaceFile } = await import('../src/main/multi-replace-file.js');
const {
  closeDatabase,
  createConversation,
  getMessage,
  insertMessage,
  updateMessage,
} = await import('../src/main/database.js');
const tool = CLIENT_TOOLS.find(({ name }) => name === 'multi_replace_file');
const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);

async function expectFailure(input, pattern) {
  await assert.rejects(() => tool.execute(input), pattern);
}

try {
  assert.ok(tool);
  assert.equal(tool.canEditFile, true);
  assert.equal(tool.tracksFileChanges, true);
  assert.equal(tool.inputSchema.properties.replacements.minItems, 1);
  assert.deepEqual(tool.inputSchema.required, ['replacements']);
  assert.equal('explanation' in tool.inputSchema.properties, false);

  const sequentialPath = join(testRoot, 'sequential.txt');
  await writeFile(sequentialPath, 'alpha beta gamma\n', 'utf8');
  const sequential = await tool.execute({
    replacements: [
      { filePath: sequentialPath, oldString: 'alpha beta', newString: 'first beta' },
      { filePath: sequentialPath, oldString: 'first beta gamma', newString: 'done' },
    ],
  }, {
    signal: AbortSignal.timeout(10_000),
    workspacePath: testRoot,
  });
  assert.equal(await readFile(sequentialPath, 'utf8'), 'done\n');
  assert.deepEqual(sequential.fileChanges, [{
    filePath: sequentialPath,
    before: 'alpha beta gamma\n',
    after: 'done\n',
  }]);
  assert.equal(sequential.replacementsApplied, 2);
  assert.equal(sequential.filesChanged, 1);
  assert.equal('explanation' in sequential, false);

  const firstPath = join(testRoot, 'first.txt');
  const secondPath = join(testRoot, 'second.txt');
  await Promise.all([
    writeFile(firstPath, 'first old\n', 'utf8'),
    writeFile(secondPath, 'second old\n', 'utf8'),
  ]);
  const multiple = await tool.execute({
    replacements: [
      { filePath: firstPath, oldString: 'old', newString: 'new' },
      { filePath: secondPath, oldString: 'old', newString: 'new' },
    ],
  });
  assert.equal(multiple.filesChanged, 2);
  assert.deepEqual(multiple.files, [firstPath, secondPath]);

  const missingPath = join(testRoot, 'missing-match.txt');
  await writeFile(missingPath, 'unchanged\n', 'utf8');
  await expectFailure({
    replacements: [{ filePath: missingPath, oldString: 'absent', newString: 'new' }],
  }, /was not found.*No files were modified/s);
  assert.equal(await readFile(missingPath, 'utf8'), 'unchanged\n');

  const duplicatePath = join(testRoot, 'duplicate-match.txt');
  await writeFile(duplicatePath, 'same same\n', 'utf8');
  await expectFailure({
    replacements: [{ filePath: duplicatePath, oldString: 'same', newString: 'new' }],
  }, /occurs more than once.*No files were modified/s);
  assert.equal(await readFile(duplicatePath, 'utf8'), 'same same\n');

  await expectFailure({
    replacements: [{ filePath: duplicatePath, oldString: '', newString: 'new' }],
  }, /oldString must be a non-empty string/);
  await expectFailure({
    replacements: [{ filePath: duplicatePath, oldString: 'same same', newString: 'same same' }],
  }, /oldString and newString must differ/);

  const binaryPath = join(testRoot, 'binary.dat');
  await writeFile(binaryPath, Buffer.from([0x61, 0x00, 0x62]));
  await expectFailure({
    replacements: [{ filePath: binaryPath, oldString: 'a', newString: 'c' }],
  }, /not a supported text file/);

  const revertedPath = join(testRoot, 'reverted.txt');
  await writeFile(revertedPath, 'original\n', 'utf8');
  const reverted = await tool.execute({
    replacements: [
      { filePath: revertedPath, oldString: 'original', newString: 'temporary' },
      { filePath: revertedPath, oldString: 'temporary', newString: 'original' },
    ],
  });
  assert.equal(reverted.filesChanged, 0);
  assert.deepEqual(reverted.fileChanges, []);
  assert.equal(await readFile(revertedPath, 'utf8'), 'original\n');

  const crlfBomPath = join(testRoot, 'crlf-bom.txt');
  await writeFile(crlfBomPath, Buffer.concat([
    utf8Bom,
    Buffer.from('one\r\ntwo\r\nthree\r\n', 'utf8'),
  ]));
  if (process.platform !== 'win32') await chmod(crlfBomPath, 0o640);
  const modeBefore = (await stat(crlfBomPath)).mode & 0o777;
  await tool.execute({
    replacements: [{ filePath: crlfBomPath, oldString: 'two', newString: 'changed' }],
  });
  const crlfBomBytes = await readFile(crlfBomPath);
  assert.equal(crlfBomBytes.subarray(0, 3).equals(utf8Bom), true);
  assert.equal(crlfBomBytes.subarray(3).toString('utf8'), 'one\r\nchanged\r\nthree\r\n');
  assert.equal((await stat(crlfBomPath)).mode & 0o777, modeBefore);

  const atomicFirstPath = join(testRoot, 'atomic-first.txt');
  const atomicSecondPath = join(testRoot, 'atomic-second.txt');
  await Promise.all([
    writeFile(atomicFirstPath, 'before first\n', 'utf8'),
    writeFile(atomicSecondPath, 'before second\n', 'utf8'),
  ]);
  let writes = 0;
  await assert.rejects(() => applyMultiReplaceFile({
    replacements: [
      { filePath: atomicFirstPath, oldString: 'before', newString: 'after' },
      { filePath: atomicSecondPath, oldString: 'before', newString: 'after' },
    ],
  }, {
    chmod,
    readFile,
    stat,
    writeFile: async (filePath, content) => {
      if (++writes === 2) throw new Error('simulated disk failure');
      await writeFile(filePath, content);
    },
  }), /simulated disk failure.*All attempted writes were rolled back/s);
  assert.equal(await readFile(atomicFirstPath, 'utf8'), 'before first\n');
  assert.equal(await readFile(atomicSecondPath, 'utf8'), 'before second\n');

  let failedWrites = 0;
  await assert.rejects(() => applyMultiReplaceFile({
    replacements: [
      { filePath: atomicFirstPath, oldString: 'before', newString: 'after' },
      { filePath: atomicSecondPath, oldString: 'before', newString: 'after' },
    ],
  }, {
    chmod,
    readFile,
    stat,
    writeFile: async (filePath, content) => {
      failedWrites += 1;
      if (failedWrites >= 2) throw new Error(`failure ${failedWrites}`);
      await writeFile(filePath, content);
    },
  }), /Rollback also failed for:.*atomic-first\.txt: failure/s);
  await writeFile(atomicFirstPath, 'before first\n', 'utf8');

  const visibleResult = Object.fromEntries(
    Object.entries(multiple).filter(([key]) => key !== 'fileChanges'),
  );
  assert.equal(JSON.stringify(visibleResult).includes('first old'), false);
  assert.deepEqual(Object.keys(visibleResult), [
    'replacementsApplied',
    'filesChanged',
    'files',
  ]);

  const conversation = createConversation({ title: 'multi replace persistence' });
  const message = insertMessage({
    conversationId: conversation.id,
    role: 'assistant',
    status: 'streaming',
  });
  updateMessage(message.id, { edits: multiple.fileChanges });
  assert.deepEqual(getMessage(message.id).edits, multiple.fileChanges);

  console.log('Multi replace file tests passed.');
} finally {
  closeDatabase();
  await Promise.all([
    rm(testProfile, { recursive: true, force: true }),
    rm(testRoot, { recursive: true, force: true }),
  ]);
}
process.exit(0);
