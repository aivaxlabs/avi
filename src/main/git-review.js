import { execFile } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
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
    const result = await execFileAsync('git', ['-C', repository, ...args], {
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

async function discoverRepositories(workspacePath) {
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
          continue;
        }
      }

      if (depth === 3) continue;
      const childDirectories = await Promise.all(entries
        .filter((entry) => entry.name.toLowerCase() !== '.git')
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
  const repository = (await discoverRepositories(workspacePath)).find(({ path }) => (
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
  const diff = [...summary, ...samples, omission].filter(Boolean).join('\n');

  return {
    ...file,
    diff,
    additions,
    deletions,
    diffBytes: Buffer.byteLength(diff, 'utf8'),
    diffCharacters: diff.length,
    diffTruncated: omittedHunks > 0 || omittedCharacters > 0,
    binary: originalDiff.includes('Binary files ') || originalDiff.includes('GIT binary patch'),
  };
}

export async function reviewGitWorkspace(workspacePath) {
  const root = resolveWorkspacePath(workspacePath);
  const discoveredRepositories = await discoverRepositories(root);

  const repositories = [];
  for (const { directory, path: repositoryPath } of discoveredRepositories) {
    const [branchResult, statusResult, headResult] = await Promise.all([
      runGit(directory, ['branch', '--show-current'], { allowFailure: true }),
      runGit(directory, [
        '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all',
      ]),
      runGit(directory, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }),
    ]);
    const parsed = parseStatus(statusResult.stdout);
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

export async function commitGitPlan(workspacePath, repositoryPath, commits) {
  const repository = await resolveRepository(workspacePath, repositoryPath);
  if (!Array.isArray(commits) || commits.length === 0) throw new Error('The commit plan is empty.');
  const status = parseStatus((await runGit(repository, [
    '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ])).stdout);
  const changedFiles = new Set(status.map((file) => file.path));
  const plannedFiles = commits.flatMap((commit) => commit.files ?? []);
  if (
    plannedFiles.length !== new Set(plannedFiles).size
    || plannedFiles.some((path) => typeof path !== 'string' || !changedFiles.has(path))
    || plannedFiles.length !== changedFiles.size
  ) {
    throw new Error('The repository changed after the plan was created. Refresh and create a new plan.');
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
