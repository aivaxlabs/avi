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
