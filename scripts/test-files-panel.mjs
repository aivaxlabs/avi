import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectWorkspaceFiles,
  listWorkspaceDirectory,
  readWorkspaceFile,
  searchWorkspaceFiles,
} from '../src/main/files.js';

const testRoot = await mkdtemp(join(tmpdir(), 'aivax-files-panel-'));
const repository = join(testRoot, 'nested', 'repository');

function git(...args) {
  return spawnSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
}

try {
  await mkdir(repository, { recursive: true });
  git('init');
  const baseBranch = git('branch', '--show-current').stdout.trim();
  git('config', 'user.email', 'files-panel@example.test');
  git('config', 'user.name', 'Files Panel Test');
  await writeFile(join(repository, '.gitignore'), 'ignored/\n');
  await writeFile(join(repository, 'modified.txt'), 'original\n');
  await writeFile(join(repository, 'conflict.txt'), 'base\n');
  git('add', '.');
  git('commit', '-m', 'initial');

  git('checkout', '-b', 'other');
  await writeFile(join(repository, 'conflict.txt'), 'other\n');
  git('commit', '-am', 'other');
  git('checkout', baseBranch);
  await writeFile(join(repository, 'conflict.txt'), 'master\n');
  git('commit', '-am', 'master');
  assert.notEqual(git('merge', 'other').status, 0);

  await writeFile(join(repository, 'modified.txt'), 'changed\n');
  await writeFile(join(repository, 'untracked.txt'), 'new\n');
  await mkdir(join(repository, 'ignored'), { recursive: true });
  await writeFile(join(repository, 'ignored', 'hidden.txt'), 'ignored\n');

  await mkdir(join(repository, 'nested-repository'), { recursive: true });
  spawnSync('git', ['init'], {
    cwd: join(repository, 'nested-repository'),
    windowsHide: true,
  });
  const deepRepository = join(testRoot, 'one', 'two', 'three', 'four');
  await mkdir(deepRepository, { recursive: true });
  spawnSync('git', ['init'], { cwd: deepRepository, windowsHide: true });

  const workspace = await inspectWorkspaceFiles(testRoot);
  assert.deepEqual(
    workspace.repositories.map(({ path }) => path.replaceAll('\\', '/')),
    ['nested/repository'],
  );
  const rootRepository = join(testRoot, 'root-repository');
  const childRepository = join(rootRepository, 'agent-hub');
  const ignoredGrandchildRepository = join(childRepository, 'nested-repository');
  await mkdir(ignoredGrandchildRepository, { recursive: true });
  for (const directory of [
    rootRepository,
    childRepository,
    ignoredGrandchildRepository,
  ]) {
    spawnSync('git', ['init'], { cwd: directory, windowsHide: true });
  }
  const nestedWorkspace = await inspectWorkspaceFiles(rootRepository);
  assert.deepEqual(
    nestedWorkspace.repositories.map(({ path }) => path.replaceAll('\\', '/')),
    ['', 'agent-hub'],
  );

  const repositoryEntries = await listWorkspaceDirectory(
    testRoot,
    join('nested', 'repository'),
  );
  assert.equal(
    repositoryEntries.find(({ name }) => name === 'modified.txt')?.status,
    'modified',
  );
  assert.equal(
    repositoryEntries.find(({ name }) => name === 'conflict.txt')?.status,
    'conflict',
  );
  assert.equal(
    repositoryEntries.find(({ name }) => name === 'untracked.txt')?.status,
    'untracked',
  );
  assert.equal(
    repositoryEntries.find(({ name }) => name === 'ignored')?.status,
    'ignored',
  );

  const ignoredEntries = await listWorkspaceDirectory(
    testRoot,
    join('nested', 'repository', 'ignored'),
  );
  assert.equal(ignoredEntries[0]?.status, 'ignored');

  const preview = await readWorkspaceFile(
    testRoot,
    join('nested', 'repository', 'modified.txt'),
  );
  assert.equal(preview.kind, 'text');
  assert.equal(preview.content, 'changed\n');

  const filenameSearch = await searchWorkspaceFiles(testRoot, 'untracked');
  assert.equal(
    filenameSearch.files[0]?.path.replaceAll('\\', '/'),
    'nested/repository/untracked.txt',
  );
  const contentSearch = await searchWorkspaceFiles(testRoot, 'changed');
  assert.equal(
    contentSearch.content[0]?.path.replaceAll('\\', '/'),
    'nested/repository/modified.txt',
  );
  assert.equal(contentSearch.content[0]?.line, 1);
  assert.equal(
    (await searchWorkspaceFiles(testRoot, 'ignored')).files.length,
    0,
  );

  await assert.rejects(() => readWorkspaceFile(testRoot, '..\\outside.txt'));

  console.log('Files panel tests passed.');
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
