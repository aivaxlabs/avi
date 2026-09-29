import { execFile } from 'node:child_process';
import { appendFile, lstat, readFile, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { resolveWorkspacePath } from './files.js';

const execFileAsync = promisify(execFile);
const gitOptions = {
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
  windowsHide: true,
};
const repositoryLimit = 20;
const agentFileDiffCharacterLimit = 500;
const agentTotalDiffCharacterLimit = 32_000 * 4;
const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

async function runGit(repository, args, options = {}) {
  try {
    const result = await execFileAsync('git', ['--literal-pathspecs', '-C', repository, ...args], {
      ...gitOptions,
      ...options,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        code: error.code,
      };
    }
    throw new Error((error.stderr || error.message || 'Git command failed.').trim());
  }
}

const pathKey = (path) => process.platform === 'win32' ? path.toLowerCase() : path;

async function discoverRepositories(workspacePath, includeNested = false) {
  const root = resolveWorkspacePath(workspacePath);
  let level = [root];
  const repositories = [];
  const visitedDirectories = new Set();

  for (let depth = 0; depth <= 3 && level.length > 0 && repositories.length < repositoryLimit; depth += 1) {
    const nextLevel = [];
    for (const directory of level) {
      let canonicalDirectory;
      let entries;
      try {
        canonicalDirectory = await realpath(directory);
        const key = pathKey(canonicalDirectory);
        if (visitedDirectories.has(key)) continue;
        visitedDirectories.add(key);
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }

      const hasGitMarker = entries.some((entry) => entry.name.toLowerCase() === '.git');
      if (hasGitMarker) {
        const topLevelResult = await runGit(directory, ['rev-parse', '--show-toplevel'], { allowFailure: true });
        const topLevel = topLevelResult.ok
          ? await realpath(topLevelResult.stdout.trim()).catch(() => null)
          : null;
        if (topLevel && pathKey(topLevel) === pathKey(canonicalDirectory)) {
          repositories.push({
            directory: canonicalDirectory,
            path: relative(root, directory).replaceAll('\\', '/') || '.',
          });
          if (!includeNested) continue;
        }
      }

      if (depth === 3) continue;
      const childDirectories = await Promise.all(entries
        .filter((entry) => !['.git', 'node_modules', 'dist', 'artifacts', 'bin', 'obj'].includes(entry.name.toLowerCase()))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        .map(async (entry) => {
          if (entry.isDirectory()) return resolve(directory, entry.name);
          if (!entry.isSymbolicLink()) return null;
          const child = resolve(directory, entry.name);
          return (await stat(child).catch(() => null))?.isDirectory() ? child : null;
        }));
      nextLevel.push(...childDirectories.filter(Boolean));
    }
    level = nextLevel;
  }

  return repositories.slice(0, repositoryLimit);
}

async function resolveRepository(workspacePath, repositoryPath) {
  if (typeof repositoryPath !== 'string') throw new Error('The repository path is invalid.');
  const requestedPath = repositoryPath.replaceAll('\\', '/');
  const repository = (await listGitRepositories(workspacePath)).repositories.find(({ path }) => (
    pathKey(path) === pathKey(requestedPath)
  ));
  if (!repository) throw new Error('The selected repository was not found in the current workspace.');
  return repository.directory;
}

function parseStatus(output) {
  const records = output.split('\0');
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const code = record.slice(0, 2);
    const path = record.slice(3).replaceAll('\\', '/');
    const renamed = code.includes('R') || code.includes('C');
    const previousPath = renamed ? records[index += 1]?.replaceAll('\\', '/') : null;
    files.push({
      path,
      previousPath,
      status: code === '??'
        ? 'untracked'
        : conflictCodes.has(code)
          ? 'conflict'
          : code.includes('D')
            ? 'deleted'
            : renamed
              ? 'renamed'
              : code.includes('A')
                ? 'added'
                : 'modified',
      staged: code[0] !== ' ' && code[0] !== '?',
      unstaged: code[1] !== ' ' && code[1] !== '?',
      conflict: conflictCodes.has(code),
    });
  }
  return files;
}

async function readFileDiff(repository, file, hasHead) {
  const args = file.status === 'untracked'
    ? ['diff', '--unified=0', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', resolve(repository, file.path)]
    : hasHead
      ? ['-c', 'core.quotepath=false', 'diff', '--unified=0', '--no-ext-diff', '--no-color', 'HEAD', '--', file.path]
      : ['-c', 'core.quotepath=false', 'diff', '--unified=0', '--no-ext-diff', '--no-color', '--cached', '--', file.path];
  const result = await runGit(repository, args, { allowFailure: file.status === 'untracked' });
  let originalDiff = result.stdout;
  if (!hasHead && file.status !== 'untracked' && file.unstaged) {
    const unstaged = await runGit(repository, [
      '-c', 'core.quotepath=false', 'diff', '--unified=0', '--no-ext-diff', '--no-color', '--', file.path,
    ], { allowFailure: true });
    originalDiff += unstaged.stdout;
  }

  const lines = originalDiff.split('\n');
  const metadata = [...new Set(lines.filter((line) => /^(new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files |GIT binary patch|Submodule |[-+]Subproject commit )/.test(line)))];
  const hunkStarts = lines.reduce((indexes, line, index) => {
    if (line.startsWith('@@')) indexes.push(index);
    return indexes;
  }, []);
  const hunks = hunkStarts.map((start, index) => lines.slice(start, hunkStarts[index + 1] ?? lines.length));
  const additions = lines.filter((line) => /^\+(?!\+\+)/.test(line)).length;
  const deletions = lines.filter((line) => /^-(?!--)/.test(line)).length;
  const summary = [
    `${file.status}: ${file.previousPath ? `${file.previousPath} -> ` : ''}${file.path}`,
    `changes: +${additions} -${deletions}; hunks: ${hunks.length}`,
    ...(metadata.length > 0 ? [`metadata: ${metadata.join('; ')}`] : []),
  ];
  const selectedHunkIndexes = [...new Set(hunks.length > 2
    ? [0, Math.floor(hunks.length / 2), hunks.length - 1]
    : hunks.map((_, index) => index))];
  const omittedHunks = hunks.length - selectedHunkIndexes.length;
  const omissionReserve = `[omitted: ${omittedHunks} hunks; ${originalDiff.length} chars]`.length + 1;
  const availableCharacters = Math.max(
    0,
    agentFileDiffCharacterLimit - summary.join('\n').length - omissionReserve - selectedHunkIndexes.length,
  );
  const perHunkCharacters = selectedHunkIndexes.length > 0
    ? Math.floor(availableCharacters / selectedHunkIndexes.length)
    : 0;
  let retainedCharacters = metadata.reduce((total, line) => total + line.length + 1, 0);
  const samples = selectedHunkIndexes.map((hunkIndex) => {
    const hunk = hunks[hunkIndex];
    const changedLines = hunk.slice(1).filter((line) => /^\+(?!\+\+)|^-(?!--)/.test(line));
    const selectedLineIndexes = [...new Set(changedLines.length > 2
      ? [0, Math.floor(changedLines.length / 2), changedLines.length - 1]
      : changedLines.map((_, index) => index))];
    const header = hunk[0].match(/^@@ .*? @@/)?.[0] ?? hunk[0];
    retainedCharacters += header.length + 1;
    const lineBudget = Math.max(0, perHunkCharacters - header.length - selectedLineIndexes.length);
    const perLineCharacters = selectedLineIndexes.length > 0
      ? Math.floor(lineBudget / selectedLineIndexes.length)
      : 0;
    const sampledLines = selectedLineIndexes.map((lineIndex) => {
      const line = changedLines[lineIndex];
      if (line.length <= perLineCharacters) {
        retainedCharacters += line.length + 1;
        return line;
      }
      const retained = Math.max(0, perLineCharacters - 3);
      retainedCharacters += retained + 1;
      return perLineCharacters >= 3 ? `${line.slice(0, retained)}...` : '';
    }).filter(Boolean);
    return [header, ...sampledLines].filter(Boolean).join('\n');
  }).filter(Boolean);
  const omittedCharacters = Math.max(0, originalDiff.length - retainedCharacters);
  const omission = `[omitted: ${omittedHunks} hunks; ${omittedCharacters} chars]`;
  const agentDiff = [...summary, ...samples, omission].filter(Boolean).join('\n');

  return {
    ...file,
    diff: originalDiff,
    agentDiff,
    additions,
    deletions,
    diffBytes: Buffer.byteLength(agentDiff, 'utf8'),
    diffCharacters: agentDiff.length,
    diffTruncated: omittedHunks > 0 || omittedCharacters > 0,
    binary: originalDiff.includes('Binary files ') || originalDiff.includes('GIT binary patch'),
  };
}

export async function reviewGitWorkspace(workspacePath, selectedRepositoryPath = null) {
  const root = resolveWorkspacePath(workspacePath);
  const discoveredRepositories = selectedRepositoryPath === null
    ? await discoverRepositories(root)
    : [{ directory: await resolveRepository(root, selectedRepositoryPath), path: selectedRepositoryPath }];

  const repositories = [];
  for (const { directory, path: repositoryPath } of discoveredRepositories) {
    const [branchResult, statusResult, headResult] = await Promise.all([
      runGit(directory, ['branch', '--show-current'], { allowFailure: true }),
      runGit(directory, [
        '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all',
      ]),
      runGit(directory, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }),
    ]);
    const parsed = selectedRepositoryPath === null
      ? parseStatus(statusResult.stdout)
      : (await readGitRepositoryIndex(root, repositoryPath, { refresh: true })).files;
    const files = [];
    for (const file of parsed) {
      files.push(await readFileDiff(directory, file, headResult.ok));
    }
    const branch = branchResult.stdout.trim() || (headResult.ok
      ? `detached@${(await runGit(directory, ['rev-parse', '--short', 'HEAD'])).stdout.trim()}`
      : 'No commits');
    repositories.push({
      id: repositoryPath,
      name: repositoryPath === '.' ? basename(root) : basename(repositoryPath),
      path: repositoryPath,
      branch,
      files,
      conflicts: files.filter((file) => file.conflict).map((file) => file.path),
      truncated: files.some((file) => file.diffTruncated),
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      diffBytes: files.reduce((total, file) => total + file.diffBytes, 0),
      diffCharacters: files.reduce((total, file) => total + file.diffCharacters, 0),
      commitPlanAvailable: files.length > 0
        && files.reduce((total, file) => total + file.diffCharacters, 0) <= agentTotalDiffCharacterLimit,
    });
  }

  const changedFiles = repositories.reduce((total, repository) => total + repository.files.length, 0);
  return {
    root,
    name: basename(root),
    repositories,
    truncated: repositories.some((repository) => repository.truncated),
    commitPlanAvailable: changedFiles > 0
      && repositories.every((repository) => (
        repository.files.length === 0 || repository.commitPlanAvailable
      )),
    limits: {
      repositories: repositoryLimit,
      agentFileDiffCharacters: agentFileDiffCharacterLimit,
      agentTotalDiffCharacters: agentTotalDiffCharacterLimit,
    },
  };
}

async function resolveGitPath(repository, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error('The Git path is outside the repository or invalid.');
  }
  let target = repository;
  for (const segment of path.split('/').filter((part) => part && part !== '.')) {
    target = resolve(target, segment);
    const info = await lstat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (info?.isSymbolicLink()) throw new Error('Git operations on symbolic links are not supported.');
  }
  return target;
}

const discoveryCache = new Map();
const repositoryIndexes = new Map();
const fileDiffCache = new Map();
const repositoryOperations = new Set();

export async function listGitRepositories(workspacePath, { refresh = false } = {}) {
  const root = resolveWorkspacePath(workspacePath);
  const key = pathKey(root);
  let cached = discoveryCache.get(key);
  if (refresh || !cached || Date.now() - cached.time > 30_000) {
    const promise = discoverRepositories(root, true).then((repositories) => ({
      root,
      repositories: repositories.map((repository) => ({
        ...repository,
        id: repository.path,
        name: repository.path === '.' ? basename(root) : basename(repository.path),
      })),
    }));
    cached = { time: Date.now(), promise };
    discoveryCache.set(key, cached);
    if (discoveryCache.size > 20) discoveryCache.delete(discoveryCache.keys().next().value);
    promise.catch(() => { if (discoveryCache.get(key) === cached) discoveryCache.delete(key); });
  }
  return cached.promise;
}

export async function readGitRepositoryIndex(workspacePath, repositoryPath, { refresh = false } = {}) {
  const directory = await resolveRepository(workspacePath, repositoryPath);
  const key = pathKey(directory);
  let cached = repositoryIndexes.get(key);
  if (refresh || !cached || Date.now() - cached.time > 1500) {
    const promise = Promise.all([
      runGit(directory, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
      runGit(directory, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }),
      runGit(directory, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }),
      listGitRepositories(workspacePath),
    ]).then(async ([status, branch, head, catalog]) => {
      const nested = catalog.repositories.filter((item) => item.directory !== directory
        && !relative(directory, item.directory).startsWith('..')
        && !relative(directory, item.directory).includes(':'))
        .map((item) => relative(directory, item.directory).replaceAll('\\', '/'));
      const files = parseStatus(status.stdout).filter((file) => !nested.some((path) => file.path.startsWith(`${path}/`)));
      const indexPath = await runGit(directory, ['rev-parse', '--git-path', 'index']);
      const [indexStat, fingerprints] = await Promise.all([
        stat(resolve(directory, indexPath.stdout.trim())).catch(() => null),
        Promise.all(files.map(async (file) => {
          const info = await lstat(resolve(directory, file.path)).catch(() => null);
          return `${file.path}:${info?.mtimeMs}:${info?.ctimeMs}:${info?.size}`;
        })),
      ]);
      return {
        id: repositoryPath, path: repositoryPath, directory, name: basename(directory),
        branch: branch.stdout.trim() || (head.ok ? `detached@${head.stdout.trim().slice(0, 8)}` : 'No commits'),
        hasHead: head.ok,
        version: createHash('sha256').update([head.stdout, status.stdout, indexStat?.mtimeMs, indexStat?.ctimeMs, indexStat?.size, ...fingerprints].join('\0')).digest('hex'),
        files,
        conflicts: files.filter((file) => file.conflict).map((file) => file.path),
      };
    });
    cached = { time: Date.now(), promise };
    repositoryIndexes.set(key, cached);
    if (repositoryIndexes.size > 40) repositoryIndexes.delete(repositoryIndexes.keys().next().value);
    promise.catch(() => { if (repositoryIndexes.get(key) === cached) repositoryIndexes.delete(key); });
  }
  const index = await cached.promise;
  return { ...index, id: repositoryPath, path: repositoryPath };
}

export async function readGitReviewFile(workspacePath, repositoryPath, filePath, { staged = false, unstaged = false } = {}) {
  const index = await readGitRepositoryIndex(workspacePath, repositoryPath);
  const file = index.files.find((item) => item.path === filePath);
  if (!file) throw new Error('The file is no longer changed. Refresh Git Review.');
  if (staged && !file.staged) return { ...file, diff: '', content: '', binary: false };
  const target = await resolveGitPath(index.directory, filePath);
  const info = await lstat(target).catch(() => null);
  if (info?.isDirectory() || info?.isSymbolicLink()) {
    return { ...file, diff: '', content: '', binary: true, message: 'Submodule or symbolic link: open its repository or inspect it in the file explorer.' };
  }
  if (info?.size > 2 * 1024 * 1024) {
    return { ...file, diff: '', content: '', binary: true, message: 'File exceeds the 2 MiB text preview limit.' };
  }
  const key = JSON.stringify([pathKey(index.directory), filePath, staged, unstaged, index.version, info?.mtimeMs, info?.ctimeMs, info?.size]);
  let pending = fileDiffCache.get(key);
  if (!pending) {
    pending = (async () => {
      let content = '';
      let diff;
      if (file.status === 'untracked' || (!index.hasHead && !staged && !unstaged)) {
        content = info ? await readFile(target, 'utf8') : '';
        diff = info ? (await runGit(index.directory, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--', '/dev/null', target], { allowFailure: true })).stdout : '';
      } else {
        const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3'];
        if (staged || (!index.hasHead && !unstaged)) args.push('--cached'); else if (!unstaged) args.push('HEAD');
        args.push('--', file.path);
        if (file.previousPath) args.push(file.previousPath);
        diff = (await runGit(index.directory, args)).stdout;
        if (staged || (!index.hasHead && !unstaged)) {
          const result = await runGit(index.directory, ['show', `:${file.path}`], { allowFailure: true });
          content = result.ok ? result.stdout : '';
        } else if (info) content = await readFile(target, 'utf8');
      }
      if (content.split('\n').length + diff.split('\n').length > 10_000) {
        return { ...file, diff: '', content: '', binary: false, message: 'This change exceeds the 10,000-line preview budget. Open the file to inspect it without blocking the panel.' };
      }
      const binary = content.includes('\0') || diff.includes('Binary files ') || diff.includes('GIT binary patch');
      return { ...file, diff: binary ? '' : diff, content: binary ? '' : content, binary };
    })();
    fileDiffCache.set(key, pending);
    if (fileDiffCache.size > 12) fileDiffCache.delete(fileDiffCache.keys().next().value);
    pending.catch(() => fileDiffCache.delete(key));
  }
  return pending;
}

export async function mutateGitRepository(workspacePath, repositoryPath, payload = {}) {
  const repository = await resolveRepository(workspacePath, repositoryPath);
  const key = pathKey(repository);
  if (repositoryOperations.has(key)) throw new Error('Another Git operation is running in this repository.');
  repositoryOperations.add(key);
  try {
    const index = await readGitRepositoryIndex(workspacePath, repositoryPath, { refresh: true });
    const { action, path: selectedPath = '.', confirmed = false, message } = payload;
    if (!['stage', 'unstage', 'discard', 'ignore', 'commit'].includes(action)) throw new Error('Unknown Git action.');
    if (action === 'commit') {
      if (payload.version && payload.version !== index.version) throw new Error('Staged changes changed. Refresh before committing.');
      const text = String(message ?? '').trim();
      if (!text || text.length > 10_000) throw new Error('Enter a commit message (up to 10,000 characters).');
      if (index.conflicts.length) throw new Error('Resolve conflicts before committing.');
      if (!index.files.some((file) => file.staged)) throw new Error('Stage changes before creating a commit.');
      await runGit(repository, ['commit', '-m', text]);
      return { repositoryPath, committed: true };
    }
    if (typeof selectedPath !== 'string' || !selectedPath || selectedPath.includes('\0')) throw new Error('Invalid Git path.');
    await resolveGitPath(repository, selectedPath);
    const files = index.files.filter((file) => selectedPath === '.' || file.path === selectedPath || file.path.startsWith(`${selectedPath}/`));
    if (!files.length) throw new Error('No changed files match this selection. Refresh Git Review.');
    const paths = [...new Set(files.flatMap((file) => [file.path, ...(file.previousPath ? [file.previousPath] : [])]))];
    await Promise.all(paths.map((path) => resolveGitPath(repository, path)));
    if (action === 'ignore') {
      if (selectedPath === '.') throw new Error('The repository root cannot be ignored.');
      const ignorePath = await resolveGitPath(repository, '.gitignore');
      const info = await lstat(ignorePath).catch(() => null);
      if (info?.isSymbolicLink()) throw new Error('Cannot modify a symbolic-link .gitignore.');
      const existing = info ? await readFile(ignorePath, 'utf8') : '';
      const pattern = `/${selectedPath.replace(/[\\*?\[\]#! ]/g, '\\$&')}${files.some((file) => file.path.startsWith(`${selectedPath}/`)) ? '/' : ''}`;
      if (!existing.split(/\r?\n/).includes(pattern)) await appendFile(ignorePath, `${existing && !existing.endsWith('\n') ? '\n' : ''}${pattern}\n`, 'utf8');
      return { repositoryPath, ignored: selectedPath, trackedFilesRemainTracked: files.some((file) => file.status !== 'untracked') };
    }
    if (action === 'discard') {
      if (!confirmed) throw new Error('Discard requires explicit confirmation.');
      if (payload.version !== index.version) throw new Error('The repository changed. Refresh and confirm discard again.');
      for (const path of paths) {
        if (/^(?:\.env(?:\..*)?|appservice\.ini)$/i.test(basename(path))) throw new Error('Sensitive configuration must be backed up and discarded separately.');
        const target = await resolveGitPath(repository, path);
        const info = await lstat(target).catch(() => null);
        if (info?.isDirectory() || info?.isSymbolicLink()) throw new Error('Discard does not remove directories, submodules, or symbolic links.');
      }
    }
    for (let offset = 0; offset < paths.length; offset += 80) {
      const batch = paths.slice(offset, offset + 80);
      if (action === 'stage') await runGit(repository, ['add', '--', ...batch]);
      if (action === 'unstage') await runGit(repository, index.hasHead
        ? ['reset', 'HEAD', '--', ...batch]
        : ['rm', '--cached', '--ignore-unmatch', '--', ...batch]);
    }
    if (action === 'discard') {
      for (const file of files) {
        if (file.status === 'untracked' || !index.hasHead) {
          if (file.staged) await runGit(repository, ['rm', '--cached', '--force', '--ignore-unmatch', '--', file.path]);
          await unlink(await resolveGitPath(repository, file.path)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        } else {
          const existsInHead = await runGit(repository, ['cat-file', '-e', `HEAD:${file.path}`], { allowFailure: true });
          if (existsInHead.ok) await runGit(repository, ['restore', '--source=HEAD', '--staged', '--worktree', '--', file.path]);
          else {
            await runGit(repository, ['rm', '--cached', '--force', '--ignore-unmatch', '--', file.path]);
            await unlink(await resolveGitPath(repository, file.path)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
          }
          if (file.previousPath) await runGit(repository, ['restore', '--source=HEAD', '--staged', '--worktree', '--', file.previousPath]);
        }
      }
    }
    return { repositoryPath, action, paths };
  } finally {
    repositoryOperations.delete(key);
    repositoryIndexes.delete(key);
    for (const cacheKey of fileDiffCache.keys()) if (cacheKey.startsWith(`[${JSON.stringify(key)},`)) fileDiffCache.delete(cacheKey);
  }
}

export async function commitGitPlan(workspacePath, repositoryPath, commits) {
  const repository = await resolveRepository(workspacePath, repositoryPath);
  if (!Array.isArray(commits) || commits.length === 0) throw new Error('The commit plan is empty.');
  const status = (await readGitRepositoryIndex(workspacePath, repositoryPath, { refresh: true })).files;
  const changedFiles = new Set(status.map((file) => file.path));
  const plannedFiles = commits.flatMap((commit) => commit.files ?? []);
  if (
    plannedFiles.length !== new Set(plannedFiles).size
    || plannedFiles.some((path) => typeof path !== 'string' || !changedFiles.has(path))
    || plannedFiles.length !== changedFiles.size
  ) {
    throw new Error('The repository changed after the plan was created. Refresh and create a new plan.');
  }

  for (const commit of commits) {
    const message = String(commit.message ?? '').trim();
    if (!message || message.length > 200 || !Array.isArray(commit.files) || commit.files.length === 0) throw new Error('The commit plan contains an invalid commit.');
    await Promise.all(commit.files.map((path) => resolveGitPath(repository, path)));
  }
  const created = [];
  for (const commit of commits) {
    const message = String(commit.message ?? '').trim();
    if (!message || message.length > 200 || !Array.isArray(commit.files) || commit.files.length === 0) {
      throw new Error('The commit plan contains an invalid commit.');
    }
    await runGit(repository, ['add', '--', ...commit.files]);
    await runGit(repository, ['commit', '--only', '-m', message, '--', ...commit.files]);
    created.push({ message, files: commit.files });
  }
  repositoryIndexes.delete(pathKey(repository));
  return { repositoryPath, commits: created };
}

export async function pushGitRepository(workspacePath, repositoryPath) {
  const repository = await resolveRepository(workspacePath, repositoryPath);
  const branch = (await runGit(repository, ['branch', '--show-current'], { allowFailure: true })).stdout.trim();
  const push = await runGit(repository, ['push'], { allowFailure: true });
  const conflicts = (await runGit(repository, ['diff', '--name-only', '--diff-filter=U'], {
    allowFailure: true,
  })).stdout.split(/\r?\n/).filter(Boolean);
  return {
    repositoryPath,
    branch: branch || null,
    pushed: push.ok,
    message: (push.ok ? push.stdout || push.stderr : push.stderr || push.stdout).trim(),
    conflicts,
    canResolveWithAgent: !push.ok
      && conflicts.length > 0
      && !['main', 'master'].includes(branch),
  };
}
