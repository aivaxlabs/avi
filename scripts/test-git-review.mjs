import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  commitGitPlan,
  pushGitRepository,
  reviewGitWorkspace,
} from '../src/main/git-review.js';

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'avi-git-review-'));
const linkedRepository = await mkdtemp(join(tmpdir(), 'avi-git-review-linked-'));
const repository = join(root, 'project');
const remote = join(root, 'remote.git');

try {
  await mkdir(repository);
  await execFileAsync('git', ['init', repository]);
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Avi Test']);
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'avi@example.invalid']);
  await writeFile(join(repository, 'tracked.txt'), 'before\n');
  await execFileAsync('git', ['-C', repository, 'add', 'tracked.txt']);
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'Initial commit']);

  await writeFile(join(repository, 'tracked.txt'), 'before\nafter\n');
  await writeFile(join(repository, 'new.txt'), 'new file\n');

  const review = await reviewGitWorkspace(root);
  assert.equal(review.repositories.length, 1);
  const [state] = review.repositories;
  assert.equal(state.path, 'project');
  assert.equal(state.files.length, 2);
  assert.equal(state.commitPlanAvailable, true);
  assert.match(state.files.find((file) => file.path === 'tracked.txt').diff, /\+after/);
  assert.match(state.files.find((file) => file.path === 'new.txt').diff, /\+new file/);

  await commitGitPlan(root, 'project', [
    { message: 'Update tracked content', files: ['tracked.txt'] },
    { message: 'Add new content', files: ['new.txt'] },
  ]);
  const log = (await execFileAsync('git', ['-C', repository, 'log', '--format=%s', '-3'])).stdout;
  assert.match(log, /Add new content/);
  assert.match(log, /Update tracked content/);
  assert.equal((await reviewGitWorkspace(root)).repositories[0].files.length, 0);

  await execFileAsync('git', ['init', '--bare', remote]);
  await execFileAsync('git', ['-C', repository, 'remote', 'add', 'origin', remote]);
  const branch = (await execFileAsync('git', ['-C', repository, 'branch', '--show-current'])).stdout.trim();
  await execFileAsync('git', ['-C', repository, 'push', '--set-upstream', 'origin', branch]);
  await writeFile(join(repository, 'push.txt'), 'push test\n');
  await execFileAsync('git', ['-C', repository, 'add', 'push.txt']);
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'Add push test']);
  const push = await pushGitRepository(root, 'project');
  assert.equal(push.pushed, true);
  assert.equal(push.branch, branch);
  assert.deepEqual(push.conflicts, []);

  await writeFile(join(repository, 'tracked.txt'), 'changed again\n');
  await assert.rejects(
    commitGitPlan(root, 'project', [{ message: 'Invalid plan', files: ['missing.txt'] }]),
    /repository changed/i,
  );
  assert.equal(await readFile(join(repository, 'tracked.txt'), 'utf8'), 'changed again\n');

  const largeDiffRepository = join(root, 'large-diffs');
  await mkdir(largeDiffRepository);
  await execFileAsync('git', ['init', largeDiffRepository]);
  await execFileAsync('git', ['-C', largeDiffRepository, 'config', 'user.name', 'Avi Test']);
  await execFileAsync('git', ['-C', largeDiffRepository, 'config', 'user.email', 'avi@example.invalid']);
  for (let index = 1; index <= 270; index += 1) {
    await writeFile(join(largeDiffRepository, `large-${index}.txt`), [
      `original first ${index} ${'a'.repeat(400)}`,
      `original middle ${index} ${'b'.repeat(400)}`,
      `original last ${index} ${'c'.repeat(400)}`,
      '',
    ].join('\n'));
  }
  await execFileAsync('git', ['-C', largeDiffRepository, 'add', '.']);
  await execFileAsync('git', ['-C', largeDiffRepository, 'commit', '-m', 'Initial large files']);
  for (let index = 1; index <= 248; index += 1) {
    await writeFile(join(largeDiffRepository, `large-${index}.txt`), [
      `changed first ${index} ${'x'.repeat(400)}`,
      `changed middle ${index} ${'y'.repeat(400)}`,
      `changed last ${index} ${'z'.repeat(400)}`,
      '',
    ].join('\n'));
  }
  await writeFile(join(largeDiffRepository, 'hunks.txt'), [
    'first original',
    ...Array.from({ length: 20 }, (_, index) => `unchanged ${index}`),
    'middle original',
    ...Array.from({ length: 20 }, (_, index) => `unchanged later ${index}`),
    'last original',
    '',
  ].join('\n'));
  await execFileAsync('git', ['-C', largeDiffRepository, 'add', 'hunks.txt']);
  await execFileAsync('git', ['-C', largeDiffRepository, 'commit', '-m', 'Add hunk fixture']);
  await writeFile(join(largeDiffRepository, 'hunks.txt'), [
    'first changed',
    ...Array.from({ length: 20 }, (_, index) => `unchanged ${index}`),
    'middle changed',
    ...Array.from({ length: 20 }, (_, index) => `unchanged later ${index}`),
    'last changed',
    '',
  ].join('\n'));
  await writeFile(
    join(largeDiffRepository, 'new-large.txt'),
    ['new first', ...Array.from({ length: 80 }, (_, index) => `new middle ${index}`), 'new last', ''].join('\n'),
  );

  const maximumAllowedDiffs = (await reviewGitWorkspace(root)).repositories
    .find(({ path }) => path === 'large-diffs');
  assert.ok(maximumAllowedDiffs.files.every((file) => file.agentDiff.length <= 500));
  assert.ok(maximumAllowedDiffs.diffCharacters <= 128_000);
  assert.equal(maximumAllowedDiffs.commitPlanAvailable, true);
  const largeFile = maximumAllowedDiffs.files.find(({ path }) => path === 'large-1.txt');
  assert.match(largeFile.diff, /changed middle 1/);
  assert.doesNotMatch(largeFile.diff, /\[omitted:/);
  assert.ok(largeFile.diff.length > 500);
  assert.ok(largeFile.agentDiff.length <= 500);
  assert.match(largeFile.agentDiff, /^modified: large-1\.txt/m);
  assert.match(largeFile.agentDiff, /changes: \+3 -3; hunks: 1/);
  assert.match(largeFile.agentDiff, /\[omitted: 0 hunks; \d+ chars\]/);

  const hunkFile = maximumAllowedDiffs.files.find(({ path }) => path === 'hunks.txt');
  assert.doesNotMatch(hunkFile.diff, /\[omitted:/);
  assert.ok(hunkFile.agentDiff.length <= 500);
  assert.match(hunkFile.agentDiff, /changes: \+3 -3; hunks: 3/);
  assert.match(hunkFile.agentDiff, /first changed/);
  assert.match(hunkFile.agentDiff, /middle changed/);
  assert.match(hunkFile.agentDiff, /last changed/);
  assert.doesNotMatch(hunkFile.agentDiff, /^ unchanged/m);

  const newFile = maximumAllowedDiffs.files.find(({ path }) => path === 'new-large.txt');
  assert.match(newFile.diff, /\+new middle 79/);
  assert.doesNotMatch(newFile.diff, /\[omitted:/);
  assert.ok(newFile.agentDiff.length <= 500);
  assert.match(newFile.agentDiff, /^untracked: new-large\.txt/m);
  assert.match(newFile.agentDiff, /changes: \+82 -0; hunks: 1/);
  assert.match(newFile.agentDiff, /metadata: new file mode 100644/);
  assert.match(newFile.agentDiff, /\+new first/);
  assert.match(newFile.agentDiff, /\+new middle 40/);
  assert.match(newFile.agentDiff, /\+new last/);
  assert.match(newFile.agentDiff, /\[omitted: 0 hunks; \d+ chars\]/);
  assert.ok(newFile.agentDiff.length < (await readFile(join(largeDiffRepository, 'new-large.txt'), 'utf8')).length);

  for (let index = 249; index <= 270; index += 1) {
    await writeFile(join(largeDiffRepository, `large-${index}.txt`), [
      `changed first ${index} ${'x'.repeat(400)}`,
      `changed middle ${index} ${'y'.repeat(400)}`,
      `changed last ${index} ${'z'.repeat(400)}`,
      '',
    ].join('\n'));
  }
  const overLimitDiffs = (await reviewGitWorkspace(root)).repositories
    .find(({ path }) => path === 'large-diffs');
  assert.ok(overLimitDiffs.files.every((file) => file.agentDiff.length <= 500));
  assert.ok(overLimitDiffs.diffCharacters > 128_000);
  assert.equal(overLimitDiffs.commitPlanAvailable, false);

  const manyFilesRepository = join(root, 'many-files');
  await mkdir(manyFilesRepository);
  await execFileAsync('git', ['init', manyFilesRepository]);
  for (let index = 1; index <= 31; index += 1) {
    await writeFile(join(manyFilesRepository, `file-${index}.txt`), `file ${index}\n`);
  }
  const manyFiles = (await reviewGitWorkspace(root)).repositories
    .find(({ path }) => path === 'many-files');
  assert.equal(manyFiles.files.length, 31);
  assert.equal(manyFiles.commitPlanAvailable, true);

  const nestedRepository = join(root, 'group', 'nested');
  const depthThreeRepository = join(root, 'one', 'two', 'three');
  const tooDeepRepository = join(root, 'one', 'two', 'other', 'four');
  const containingRepository = join(root, 'containing');
  const hiddenNestedRepository = join(containingRepository, 'nested');
  await Promise.all([
    mkdir(nestedRepository, { recursive: true }),
    mkdir(depthThreeRepository, { recursive: true }),
    mkdir(tooDeepRepository, { recursive: true }),
    mkdir(hiddenNestedRepository, { recursive: true }),
  ]);
  await Promise.all([
    execFileAsync('git', ['init', nestedRepository]),
    execFileAsync('git', ['init', depthThreeRepository]),
    execFileAsync('git', ['init', tooDeepRepository]),
    execFileAsync('git', ['init', containingRepository]),
    execFileAsync('git', ['init', hiddenNestedRepository]),
    execFileAsync('git', ['init', linkedRepository]),
  ]);
  await writeFile(join(linkedRepository, 'linked.txt'), 'linked change\n');
  await symlink(
    linkedRepository,
    join(root, 'linked-repository'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await symlink(
    root,
    join(linkedRepository, 'workspace-cycle'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const discovered = await reviewGitWorkspace(root);
  const discoveredPaths = discovered.repositories.map(({ path }) => path);
  assert.ok(discoveredPaths.includes('project'));
  assert.ok(discoveredPaths.includes('group/nested'));
  assert.ok(discoveredPaths.includes('one/two/three'));
  assert.ok(discoveredPaths.includes('containing'));
  assert.ok(discoveredPaths.includes('linked-repository'));
  assert.ok(!discoveredPaths.includes('one/two/other/four'));
  assert.ok(!discoveredPaths.includes('containing/nested'));
  assert.match(
    discovered.repositories.find(({ path }) => path === 'linked-repository').files
      .find(({ path }) => path === 'linked.txt').diff,
    /linked change/,
  );

  await unlink(join(linkedRepository, 'workspace-cycle'));
  await commitGitPlan(root, 'linked-repository', [
    { message: 'Add linked content', files: ['linked.txt'] },
  ]);
  assert.equal((await reviewGitWorkspace(root)).repositories
    .find(({ path }) => path === 'linked-repository').files.length, 0);

  console.log('Git Review tests passed.');
} finally {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(linkedRepository, { recursive: true, force: true }),
  ]);
}
