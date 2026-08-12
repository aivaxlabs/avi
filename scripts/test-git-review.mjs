import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  console.log('Git Review tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
