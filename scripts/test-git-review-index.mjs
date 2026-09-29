import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  listGitRepositories,
  mutateGitRepository,
  readGitRepositoryIndex,
  readGitReviewFile,
} from '../src/main/git-review.js';

const execFileAsync = promisify(execFile);
const pad = (value) => String(value).padStart(2, '0');
const now = new Date();
const tzMinutes = -now.getTimezoneOffset();
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes()),
  `UTC${tzMinutes < 0 ? '-' : '+'}${String(Math.abs(tzMinutes) / 60).replace('.', '-')}`,
].join('-');
const base = join(tmpdir(), '.avi', 'visualizations', stamp, `git-review-tests-${randomUUID()}`);
const ws = join(base, 'workspace');
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Avi Test',
  GIT_AUTHOR_EMAIL: 'avi@example.invalid',
  GIT_COMMITTER_NAME: 'Avi Test',
  GIT_COMMITTER_EMAIL: 'avi@example.invalid',
};

const git = (repo, args) => execFileAsync('git', ['-C', repo, ...args], { env: gitEnv });
const w = (repo, name, content) => writeFile(join(repo, name), content);
const idx = (repo) => readGitRepositoryIndex(ws, repo, { refresh: true });

const initRepo = async (dir) => {
  await mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init', dir], { env: gitEnv });
  await git(dir, ['config', 'user.name', 'Avi Test']);
  await git(dir, ['config', 'user.email', 'avi@example.invalid']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['config', 'core.autocrlf', 'false']);
};

const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL - ${name}: ${error.message}`);
  }
};

try {
  const outer = join(ws, 'outer');
  const nested = join(outer, 'nested');
  const preview = join(ws, 'preview');
  const unborn = join(ws, 'unborn');
  const special = join(ws, 'special');
  const discard = join(ws, 'discard');
  const discardRoot = join(ws, 'discardroot');
  const ignore = join(ws, 'ignorerepo');
  const ignorefresh = join(ws, 'ignorefresh');
  const commit = join(ws, 'commitrepo');
  const del = join(ws, 'delrepo');
  const rnm = join(ws, 'renamerepo');
  const stale = join(ws, 'stalerepo');
  const sv = join(ws, 'staleview');
  const linkrepo = join(ws, 'linkrepo');
  const submod = join(ws, 'submodrepo');
  const ext = join(base, 'ext-repo');

  await Promise.all([
    initRepo(outer), initRepo(nested), initRepo(preview), initRepo(unborn),
    initRepo(special), initRepo(discard), initRepo(discardRoot),
    initRepo(ignore), initRepo(ignorefresh), initRepo(commit), initRepo(ext),
    initRepo(del), initRepo(rnm), initRepo(stale), initRepo(sv),
    initRepo(linkrepo), initRepo(submod),
  ]);

  await w(outer, 'outer.txt', 'outer base\n');
  await git(outer, ['add', 'outer.txt']);
  await git(outer, ['commit', '-m', 'outer base']);
  await w(nested, 'inner.txt', 'inner change\n');

  await w(preview, 'base.txt', 'line1\n');
  await w(preview, 'seed.txt', 'seed\n');
  await git(preview, ['add', '.']);
  await git(preview, ['commit', '-m', 'preview base']);
  await w(preview, 'base.txt', 'staged v1\n');
  await git(preview, ['add', 'base.txt']);
  await w(preview, 'base.txt', 'worktree v2\n');
  await w(preview, 'new.txt', 'hello untracked\n');

  await w(unborn, 'u.txt', 'unborn content\n');

  await w(special, 'seed.txt', 'seed\n');
  await git(special, ['add', 'seed.txt']);
  await git(special, ['commit', '-m', 'special base']);

  await w(discard, 'mod.txt', 'orig\n');
  await git(discard, ['add', '.']);
  await git(discard, ['commit', '-m', 'discard base']);
  await w(discard, 'mod.txt', 'changed\n');
  const fixtureBlob = (await git(discard, ['rev-parse', 'HEAD:mod.txt'])).stdout.trim();
  await git(discard, ['update-index', '--add', '--cacheinfo', `100644,${fixtureBlob},.env`]);

  await w(discardRoot, 'r.txt', 'orig\n');
  await git(discardRoot, ['add', '.']);
  await git(discardRoot, ['commit', '-m', 'root base']);
  await w(discardRoot, 'r.txt', 'changed\n');
  await w(discardRoot, 'del.txt', 'remove me\n');

  await w(ignore, 't.txt', 'tracked\n');
  await w(ignore, '.gitignore', '# seed\n');
  await git(ignore, ['add', '.']);
  await git(ignore, ['commit', '-m', 'ignore base']);
  await w(ignore, 't.txt', 'tracked modified\n');

  await w(ignorefresh, 't.txt', 'tracked\n');
  await git(ignorefresh, ['add', '.']);
  await git(ignorefresh, ['commit', '-m', 'fresh base']);

  await w(commit, 'a.txt', 'a1\n');
  await w(commit, 'b.txt', 'b1\n');
  await git(commit, ['add', '.']);
  await git(commit, ['commit', '-m', 'commit base']);

  await w(del, 'gone.txt', 'bye\n');
  await w(del, 'keep.txt', 'keep\n');
  await git(del, ['add', '.']);
  await git(del, ['commit', '-m', 'del base']);

  await w(rnm, 'a.txt', 'rename me\n');
  await git(rnm, ['add', '.']);
  await git(rnm, ['commit', '-m', 'rename base']);

  await w(stale, 'm.txt', 'base\n');
  await git(stale, ['add', '.']);
  await git(stale, ['commit', '-m', 'stale base']);

  await w(sv, 's.txt', 'base\n');
  await git(sv, ['add', '.']);
  await git(sv, ['commit', '-m', 'staleview base']);

  await w(linkrepo, 'seed.txt', 'seed\n');
  await git(linkrepo, ['add', '.']);
  await git(linkrepo, ['commit', '-m', 'link base']);
  await w(linkrepo, 'real-ignore-target.txt', 'target\n');

  await w(submod, 'base.txt', 'base\n');
  await git(submod, ['add', '.']);
  await git(submod, ['commit', '-m', 'submod base']);
  const subInner = join(submod, 'sub');
  await initRepo(subInner);
  await w(subInner, 'f.txt', 'inner\n');
  await git(subInner, ['add', '.']);
  await git(subInner, ['commit', '-m', 'inner base']);
  const subSha = (await git(subInner, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(submod, ['update-index', '--add', '--cacheinfo', `160000,${subSha},sub`]);

  await w(ext, 'ext.txt', 'ext base\n');
  await git(ext, ['add', '.']);
  await git(ext, ['commit', '-m', 'ext base']);

  const junction = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(ext, join(ws, 'linked-ext'), junction);
  await symlink(ws, join(ext, 'cycle'), junction);

  let symlinkCreated = true;
  try {
    await symlink(join(discard, 'mod.txt'), join(discard, 'newlink'), 'file');
  } catch {
    symlinkCreated = false;
  }

  let ignoreLinkCreated = true;
  try {
    await symlink(join(linkrepo, 'real-ignore-target.txt'), join(linkrepo, '.gitignore'), 'file');
  } catch {
    ignoreLinkCreated = false;
  }

  await test('catalog lists nested repos and survives symlink cycle', async () => {
    const catalog = await listGitRepositories(ws, { refresh: true });
    const paths = catalog.repositories.map((repo) => repo.path);
    assert.ok(paths.includes('outer'));
    assert.ok(paths.includes('outer/nested'));
    assert.ok(paths.includes('linked-ext'));
    const cached = await listGitRepositories(ws);
    assert.equal(cached.repositories.length, catalog.repositories.length);
  });

  await test('index carries no diff payloads', async () => {
    const index = await idx('preview');
    assert.ok(index.files.length > 0);
    assert.ok(index.files.every((file) => !('diff' in file) && !('agentDiff' in file)));
  });

  await test('nested paths are isolated from outer index', async () => {
    const index = await idx('outer');
    assert.ok(!index.files.some((file) => file.path === 'nested/' || file.path.startsWith('nested/')));
    await assert.rejects(readGitReviewFile(ws, 'outer', 'nested/inner.txt'), /no longer changed/i);
    const inner = await idx('outer/nested');
    assert.ok(inner.files.some((file) => file.path === 'inner.txt'));
  });

  await test('preview shows current worktree content', async () => {
    const file = await readGitReviewFile(ws, 'preview', 'base.txt');
    assert.equal(file.content, 'worktree v2\n');
    assert.match(file.diff, /worktree v2/);
  });

  await test('preview staged shows index content', async () => {
    const file = await readGitReviewFile(ws, 'preview', 'base.txt', { staged: true });
    assert.equal(file.content, 'staged v1\n');
    assert.match(file.diff, /staged v1/);
    assert.doesNotMatch(file.diff, /worktree v2/);
  });

  await test('unstaged preview compares worktree against staged content', async () => {
    const file = await readGitReviewFile(ws, 'preview', 'base.txt', { unstaged: true });
    assert.match(file.diff, /-staged v1/);
    assert.match(file.diff, /\+worktree v2/);
    assert.doesNotMatch(file.diff, /-line1/);
  });

  await test('preview covers untracked files', async () => {
    const file = await readGitReviewFile(ws, 'preview', 'new.txt');
    assert.equal(file.content, 'hello untracked\n');
    assert.match(file.diff, /hello untracked/);
  });

  await test('literal pathspec handles special names', async () => {
    const names = ['-dash.txt', '[brackets].txt', 'hash#tag.txt', 'sp ace.txt', 'plus+.txt'];
    for (const name of names) await w(special, name, `content of ${name}\n`);
    await mkdir(join(special, 'dir[1]'), { recursive: true });
    await w(special, 'dir[1]/inside.txt', 'inside\n');
    for (const name of names) {
      await mutateGitRepository(ws, 'special', { action: 'stage', path: name });
      const file = await readGitReviewFile(ws, 'special', name);
      assert.equal(file.content, `content of ${name}\n`);
    }
    await mutateGitRepository(ws, 'special', { action: 'stage', path: 'dir[1]' });
    let index = await idx('special');
    assert.ok(names.every((name) => index.files.find((file) => file.path === name)?.staged));
    assert.ok(index.files.find((file) => file.path === 'dir[1]/inside.txt')?.staged);
    await mutateGitRepository(ws, 'special', { action: 'unstage', path: '.' });
    index = await idx('special');
    assert.ok(index.files.every((file) => !file.staged));
  });

  await test('stage and unstage work on a normal repo', async () => {
    await w(commit, 'b.txt', 'b2\n');
    await mutateGitRepository(ws, 'commitrepo', { action: 'stage', path: 'b.txt' });
    let index = await idx('commitrepo');
    assert.equal(index.files.find((file) => file.path === 'b.txt')?.staged, true);
    await mutateGitRepository(ws, 'commitrepo', { action: 'unstage', path: 'b.txt' });
    index = await idx('commitrepo');
    assert.equal(index.files.find((file) => file.path === 'b.txt')?.staged, false);
    assert.equal(await readFile(join(commit, 'b.txt'), 'utf8'), 'b2\n');
  });

  await test('stage and unstage work on unborn repo', async () => {
    let index = await idx('unborn');
    assert.equal(index.hasHead, false);
    await mutateGitRepository(ws, 'unborn', { action: 'stage', path: 'u.txt' });
    index = await idx('unborn');
    assert.equal(index.files.find((file) => file.path === 'u.txt')?.staged, true);
    const staged = await readGitReviewFile(ws, 'unborn', 'u.txt', { staged: true });
    assert.equal(staged.content, 'unborn content\n');
    await mutateGitRepository(ws, 'unborn', { action: 'unstage', path: 'u.txt' });
    index = await idx('unborn');
    const file = index.files.find((item) => item.path === 'u.txt');
    assert.equal(file?.staged, false);
    assert.equal(await readFile(join(unborn, 'u.txt'), 'utf8'), 'unborn content\n');
  });

  await test('discard requires explicit confirmation', async () => {
    const index = await idx('discard');
    await assert.rejects(
      mutateGitRepository(ws, 'discard', { action: 'discard', path: 'mod.txt', confirmed: false, version: index.version }),
      /confirmation/i,
    );
  });

  await test('discard rejects stale version', async () => {
    const before = await idx('discard');
    await w(discard, 'other.txt', 'x\n');
    await assert.rejects(
      mutateGitRepository(ws, 'discard', { action: 'discard', path: 'mod.txt', confirmed: true, version: before.version }),
      /refresh/i,
    );
    await rm(join(discard, 'other.txt'), { force: true });
  });

  await test('discard rejects paths outside the repository root', async () => {
    const index = await idx('discard');
    await assert.rejects(
      mutateGitRepository(ws, 'discard', { action: 'discard', path: '../escape', confirmed: true, version: index.version }),
      /outside/i,
    );
  });

  await test('discard rejects sensitive configuration', async () => {
    const index = await idx('discard');
    await assert.rejects(
      mutateGitRepository(ws, 'discard', { action: 'discard', path: '.env', confirmed: true, version: index.version }),
      /sensitive/i,
    );
    assert.equal((await git(discard, ['rev-parse', ':.env'])).stdout.trim(), fixtureBlob);
    assert.equal(await lstat(join(discard, '.env')).catch(() => null), null);
  });

  if (symlinkCreated) {
    await test('discard rejects symbolic links', async () => {
      const index = await idx('discard');
      assert.ok(index.files.some((file) => file.path === 'newlink'));
      await assert.rejects(
        mutateGitRepository(ws, 'discard', { action: 'discard', path: 'newlink', confirmed: true, version: index.version }),
        /symbolic/i,
      );
      assert.equal((await lstat(join(discard, 'newlink'))).isSymbolicLink(), true);
    });
  } else {
    console.log('skip - discard rejects symbolic links (symlink privilege unavailable)');
  }

  await test('discard of nested path from outer index matches nothing', async () => {
    const index = await idx('outer');
    await assert.rejects(
      mutateGitRepository(ws, 'outer', { action: 'discard', path: 'nested/inner.txt', confirmed: true, version: index.version }),
      /no changed files/i,
    );
  });

  await test('discard restores tracked and removes untracked at root', async () => {
    const index = await idx('discardroot');
    await mutateGitRepository(ws, 'discardroot', { action: 'discard', path: '.', confirmed: true, version: index.version });
    assert.equal(await readFile(join(discardRoot, 'r.txt'), 'utf8'), 'orig\n');
    assert.equal((await idx('discardroot')).files.length, 0);
  });

  await test('ignore writes literal pattern and hides untracked file', async () => {
    await w(ignore, 'weird[1]#.txt', 'weird\n');
    const result = await mutateGitRepository(ws, 'ignorerepo', { action: 'ignore', path: 'weird[1]#.txt' });
    assert.equal(result.ignored, 'weird[1]#.txt');
    const gitignore = await readFile(join(ignore, '.gitignore'), 'utf8');
    assert.ok(gitignore.split(/\r?\n/).includes('/weird\\[1\\]\\#.txt'));
    const index = await idx('ignorerepo');
    assert.ok(!index.files.some((file) => file.path === 'weird[1]#.txt'));
  });

  await test('ignore keeps tracked files tracked', async () => {
    const result = await mutateGitRepository(ws, 'ignorerepo', { action: 'ignore', path: 't.txt' });
    assert.equal(result.trackedFilesRemainTracked, true);
    const index = await idx('ignorerepo');
    assert.ok(index.files.some((file) => file.path === 't.txt'));
  });

  await test('ignore rejects repository root', async () => {
    await assert.rejects(mutateGitRepository(ws, 'ignorerepo', { action: 'ignore', path: '.' }), /root cannot be ignored/i);
  });

  if (ignoreLinkCreated) {
    await test('ignore refuses symbolic-link .gitignore', async () => {
      await w(linkrepo, 'junk.txt', 'junk\n');
      await assert.rejects(
        mutateGitRepository(ws, 'linkrepo', { action: 'ignore', path: 'junk.txt' }),
        /symbolic link/i,
      );
      assert.equal(await readFile(join(linkrepo, 'real-ignore-target.txt'), 'utf8'), 'target\n');
      await unlink(join(linkrepo, '.gitignore'));
    });
  } else {
    console.log('skip - ignore refuses symbolic-link .gitignore (symlink privilege unavailable)');
  }

  await test('ignore creates a missing .gitignore', async () => {
    await w(ignorefresh, 'junk.txt', 'junk\n');
    const result = await mutateGitRepository(ws, 'ignorefresh', { action: 'ignore', path: 'junk.txt' });
    assert.equal(result.ignored, 'junk.txt');
    assert.ok((await readFile(join(ignorefresh, '.gitignore'), 'utf8')).split(/\r?\n/).includes('/junk.txt'));
  });

  await test('preview shows deleted tracked file and discard restores it', async () => {
    await unlink(join(del, 'gone.txt'));
    const file = await readGitReviewFile(ws, 'delrepo', 'gone.txt');
    assert.equal(file.status, 'deleted');
    assert.equal(file.content, '');
    assert.match(file.diff, /-bye/);
    const index = await idx('delrepo');
    await mutateGitRepository(ws, 'delrepo', { action: 'discard', path: 'gone.txt', confirmed: true, version: index.version });
    assert.equal(await readFile(join(del, 'gone.txt'), 'utf8'), 'bye\n');
  });

  await test('staged rename can be unstaged and discarded', async () => {
    await git(rnm, ['mv', 'a.txt', 'b.txt']);
    let index = await idx('renamerepo');
    assert.equal(index.files.find((item) => item.path === 'b.txt')?.status, 'renamed');
    await mutateGitRepository(ws, 'renamerepo', { action: 'unstage', path: 'b.txt' });
    const status = (await git(rnm, ['status', '--porcelain'])).stdout;
    assert.match(status, / D a\.txt/);
    assert.match(status, /\?\? b\.txt/);
    await git(rnm, ['checkout', '--', 'a.txt']);
    await unlink(join(rnm, 'b.txt'));
    await git(rnm, ['mv', 'a.txt', 'b.txt']);
    const fresh = await idx('renamerepo');
    await mutateGitRepository(ws, 'renamerepo', { action: 'discard', path: '.', confirmed: true, version: fresh.version });
    assert.equal(await readFile(join(rnm, 'a.txt'), 'utf8'), 'rename me\n');
    assert.equal((await idx('renamerepo')).files.length, 0);
  });

  await test('discard rejects same-status content change after version capture', async () => {
    await w(stale, 'm.txt', 'v1\n');
    await git(stale, ['add', 'm.txt']);
    await w(stale, 'm.txt', 'v2\n');
    const before = await idx('stalerepo');
    assert.equal(before.files.find((item) => item.path === 'm.txt')?.staged, true);
    await w(stale, 'm.txt', 'v3\n');
    await assert.rejects(
      mutateGitRepository(ws, 'stalerepo', { action: 'discard', path: 'm.txt', confirmed: true, version: before.version }),
      /refresh/i,
    );
  });

  await test('discard refuses staged submodule root', async () => {
    const index = await idx('submodrepo');
    assert.ok(index.files.some((item) => item.path === 'sub'));
    await assert.rejects(
      mutateGitRepository(ws, 'submodrepo', { action: 'discard', path: '.', confirmed: true, version: index.version }),
      /directories, submodules, or symbolic links/i,
    );
  });

  await test('staged preview reflects external git add with same status', async () => {
    await w(sv, 's.txt', 'v1\n');
    await git(sv, ['add', 's.txt']);
    const first = await readGitReviewFile(ws, 'staleview', 's.txt', { staged: true });
    assert.equal(first.content, 'v1\n');
    await w(sv, 's.txt', 'v2\n');
    await git(sv, ['add', 's.txt']);
    await readGitRepositoryIndex(ws, 'staleview', { refresh: true });
    const second = await readGitReviewFile(ws, 'staleview', 's.txt', { staged: true });
    assert.equal(second.content, 'v2\n');
  });

  await test('commit persists only staged changes', async () => {
    await w(commit, 'a.txt', 'a2\n');
    await w(commit, 'b.txt', 'b3\n');
    await w(commit, 'c.txt', 'c1\n');
    await mutateGitRepository(ws, 'commitrepo', { action: 'stage', path: 'a.txt' });
    await mutateGitRepository(ws, 'commitrepo', { action: 'commit', message: 'Save a' });
    const log = (await git(commit, ['log', '--format=%s', '-1'])).stdout;
    assert.match(log, /Save a/);
    const index = await idx('commitrepo');
    assert.ok(!index.files.some((file) => file.path === 'a.txt'));
    assert.ok(index.files.some((file) => file.path === 'b.txt'));
    assert.ok(index.files.some((file) => file.path === 'c.txt'));
  });

  await test('commit requires staged changes', async () => {
    await assert.rejects(mutateGitRepository(ws, 'commitrepo', { action: 'commit', message: 'Empty' }), /stage changes/i);
  });

  console.log(failures.length === 0 ? `All Git Review index tests passed (${stamp}).` : `${failures.length} test(s) failed.`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await rm(base, { recursive: true, force: true });
}
