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
  const replacementSchema = tool.inputSchema.properties.replacements.items;
  assert.deepEqual(replacementSchema.properties.occurrence.enum, ['unique', 'all']);
  assert.equal(replacementSchema.properties.expectedOccurrences.minimum, 1);
  assert.deepEqual(replacementSchema.required, ['filePath', 'oldString', 'newString']);

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
  assert.equal(sequential.occurrencesReplaced, 2);
  assert.deepEqual(sequential.results, [
    { replacement: 1, occurrencesReplaced: 1 },
    { replacement: 2, occurrencesReplaced: 1 },
  ]);
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
  const missingContent = [
    'const unrelated = true;',
    'const result = await processData(input);',
    'const other = await processData( data );',
    'const third = await processData(source);',
    'const fourth = await processData(record);',
    '',
  ].join('\n');
  await writeFile(missingPath, missingContent, 'utf8');
  let fuzzyError;
  await assert.rejects(() => tool.execute({
    replacements: [{
      filePath: missingPath,
      oldString: 'const result = await processData(payload);',
      newString: 'const result = await transformData(payload);',
    }],
  }), (error) => {
    fuzzyError = error;
    return /was not found.*Closest matches \(fuzzy\):.*Match 1 \(line 2, similarity \d+%\):.*processData\(input\);.*Your oldString was:.*processData\(payload\);.*No files were modified/s.test(error.message);
  });
  assert.equal((fuzzyError.message.match(/^Match \d+/gm) ?? []).length, 3);
  assert.equal(fuzzyError.message.includes('Match 4'), false);
  assert.equal(await readFile(missingPath, 'utf8'), missingContent);

  const duplicatePath = join(testRoot, 'duplicate-match.txt');
  await writeFile(duplicatePath, [
    'function first() {',
    '  validate();',
    '}',
    '',
    'function second() {',
    '  validate();',
    '}',
    '',
  ].join('\n'), 'utf8');
  await expectFailure({
    replacements: [{ filePath: duplicatePath, oldString: '  validate();', newString: '  submit();' }],
  }, /oldString occurs 2 times.*Add more unique context.*Occurrence 1 \(line 2\):.*Occurrence 2 \(line 6\):.*No files were modified/s);
  assert.equal((await readFile(duplicatePath, 'utf8')).includes('submit'), false);

  const previewLimitPath = join(testRoot, 'preview-limit.txt');
  await writeFile(previewLimitPath, 'same\nsame\nsame\nsame\nsame\nsame\n', 'utf8');
  await expectFailure({
    replacements: [{ filePath: previewLimitPath, oldString: 'same', newString: 'new' }],
  }, /occurs 6 times.*Occurrence 5 \(line 5\):.*Showing 5 of 6 occurrences/s);

  const replaceAllPath = join(testRoot, 'replace-all.txt');
  await writeFile(replaceAllPath, 'aa aa aa\n', 'utf8');
  const replaceAll = await tool.execute({
    replacements: [{
      filePath: replaceAllPath,
      oldString: 'aa',
      newString: 'aaaa',
      occurrence: 'all',
      expectedOccurrences: 3,
    }],
  });
  assert.equal(await readFile(replaceAllPath, 'utf8'), 'aaaa aaaa aaaa\n');
  assert.equal(replaceAll.occurrencesReplaced, 3);
  assert.deepEqual(replaceAll.results, [{ replacement: 1, occurrencesReplaced: 3 }]);

  const sequentialAllPath = join(testRoot, 'sequential-all.txt');
  await writeFile(sequentialAllPath, 'a a\n', 'utf8');
  const sequentialAll = await tool.execute({
    replacements: [
      { filePath: sequentialAllPath, oldString: 'a', newString: 'ab', occurrence: 'all' },
      { filePath: sequentialAllPath, oldString: 'ab ab', newString: 'done' },
    ],
  });
  assert.equal(await readFile(sequentialAllPath, 'utf8'), 'done\n');
  assert.deepEqual(sequentialAll.results, [
    { replacement: 1, occurrencesReplaced: 2 },
    { replacement: 2, occurrencesReplaced: 1 },
  ]);

  const overlappingPath = join(testRoot, 'overlapping.txt');
  await writeFile(overlappingPath, 'aaaa\n', 'utf8');
  const overlapping = await tool.execute({
    replacements: [{
      filePath: overlappingPath,
      oldString: 'aa',
      newString: 'b',
      occurrence: 'all',
      expectedOccurrences: 2,
    }],
  });
  assert.equal(await readFile(overlappingPath, 'utf8'), 'bb\n');
  assert.equal(overlapping.occurrencesReplaced, 2);

  const countMismatchPath = join(testRoot, 'count-mismatch.txt');
  await writeFile(countMismatchPath, 'token token token\n', 'utf8');
  await expectFailure({
    replacements: [{
      filePath: countMismatchPath,
      oldString: 'token',
      newString: 'value',
      occurrence: 'all',
      expectedOccurrences: 2,
    }],
  }, /expectedOccurrences is 2, but oldString occurs 3 times.*Occurrence 1 \(line 1\):.*No files were modified/s);
  assert.equal(await readFile(countMismatchPath, 'utf8'), 'token token token\n');

  const sequentialFailurePath = join(testRoot, 'sequential-failure.txt');
  await writeFile(sequentialFailurePath, 'alpha beta\n', 'utf8');
  await expectFailure({
    replacements: [
      { filePath: sequentialFailurePath, oldString: 'alpha', newString: 'first' },
      { filePath: sequentialFailurePath, oldString: 'first gamma', newString: 'done' },
    ],
  }, /Replacement 2 failed:.*Diagnostics reflect the in-memory state after replacements 1-1; no files were written.*No files were modified/s);
  assert.equal(await readFile(sequentialFailurePath, 'utf8'), 'alpha beta\n');

  await expectFailure({
    replacements: [{ filePath: duplicatePath, oldString: '', newString: 'new' }],
  }, /oldString must be a non-empty string/);
  await expectFailure({
    replacements: [{ filePath: duplicatePath, oldString: 'validate', newString: 'validate' }],
  }, /oldString and newString must differ/);
  await expectFailure({
    replacements: [{
      filePath: duplicatePath,
      oldString: 'validate',
      newString: 'submit',
      occurrence: 'first',
    }],
  }, /occurrence must be "unique" or "all"/);
  await expectFailure({
    replacements: [{
      filePath: duplicatePath,
      oldString: 'validate',
      newString: 'submit',
      expectedOccurrences: 2,
    }],
  }, /expectedOccurrences can only be used when occurrence is "all"/);
  await expectFailure({
    replacements: [{
      filePath: duplicatePath,
      oldString: 'validate',
      newString: 'submit',
      occurrence: 'all',
      expectedOccurrences: 0,
    }],
  }, /expectedOccurrences must be a positive integer/);

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

  const normalizedPath = join(testRoot, 'normalized.txt');
  await writeFile(
    normalizedPath,
    'Cafe\u0301 Ａction 👩‍💻\r\nsecond line\nthird line\r\n',
    'utf8',
  );
  const normalized = await tool.execute({
    replacements: [{
      filePath: normalizedPath,
      oldString: 'Action 👩‍💻\nsecond line',
      newString: 'edição 👍🏽\nupdated line',
    }],
  });
  const normalizedContent = 'Café edição 👍🏽\r\nupdated line\r\nthird line\r\n';
  assert.equal(await readFile(normalizedPath, 'utf8'), normalizedContent);
  assert.deepEqual(normalized.fileChanges, [{
    filePath: normalizedPath,
    before: 'Cafe\u0301 Ａction 👩‍💻\r\nsecond line\nthird line\r\n',
    after: normalizedContent,
  }]);

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
    'occurrencesReplaced',
    'results',
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
