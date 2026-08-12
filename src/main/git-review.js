import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
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
const fileLimit = 100;
const fileDiffLimit = 160 * 1024;
const totalDiffLimit = 1024 * 1024;
const commitPlanFileLimit = 30;
const commitPlanDiffLimit = 512 * 1024;
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

async function resolveRepository(workspacePath, repositoryPath) {
  const repository = resolveWorkspacePath(workspacePath, repositoryPath === '.' ? '' : repositoryPath);
  const result = await runGit(repository, ['rev-parse', '--show-toplevel']);
  const topLevel = resolve(result.stdout.trim());
  if (topLevel.toLowerCase() !== resolve(repository).toLowerCase()) {
    throw new Error('The selected path is not a repository root.');
  }
  return repository;
}

async function discoverRepositories(workspacePath) {
  const root = resolveWorkspacePath(workspacePath);
  let level = [root];
  const repositories = [];

  for (let depth = 0; depth <= 3 && level.length > 0 && repositories.length < repositoryLimit; depth += 1) {
    const inspected = await Promise.all(level.map(async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      const isRepository = entries.some((entry) => entry.name === '.git');
      return {
        repository: isRepository ? directory : null,
        directories: depth === 3 || (isRepository && depth > 0)
          ? []
          : entries
            .filter((entry) => entry.isDirectory() && entry.name !== '.git')
            .map((entry) => resolve(directory, entry.name)),
      };
    }));
    repositories.push(...inspected.flatMap(({ repository }) => repository ? [repository] : []));
    level = inspected.flatMap(({ directories }) => directories);
  }

  return repositories.slice(0, repositoryLimit);
}

function parseStatus(output) {
  const records = output.split('\0');
  const files = [];
  for (let index = 0; index < records.length && files.length < fileLimit; index += 1) {
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
  return { files, truncated: records.filter(Boolean).length > fileLimit };
}

async function readFileDiff(repository, file, hasHead) {
  const args = file.status === 'untracked'
    ? ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', resolve(repository, file.path)]
    : hasHead
      ? ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', 'HEAD', '--', file.path]
      : ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--cached', '--', file.path];
  const result = await runGit(repository, args, { allowFailure: file.status === 'untracked' });
  let diff = result.stdout;
  if (!hasHead && file.status !== 'untracked' && file.unstaged) {
    const unstaged = await runGit(repository, [
      '-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--', file.path,
    ], { allowFailure: true });
    diff += unstaged.stdout;
  }
  const bytes = Buffer.byteLength(diff, 'utf8');
  return {
    ...file,
    diff: bytes > fileDiffLimit ? `${diff.slice(0, fileDiffLimit)}\n\n[Diff truncated]` : diff,
    diffBytes: Math.min(bytes, fileDiffLimit),
    diffTruncated: bytes > fileDiffLimit,
    binary: diff.includes('Binary files ') || diff.includes('GIT binary patch'),
  };
}

export async function reviewGitWorkspace(workspacePath) {
  const root = resolveWorkspacePath(workspacePath);
  const repositoryPaths = await discoverRepositories(root);
  let remainingDiffBytes = totalDiffLimit;
  let anyDiffTruncated = false;

  const repositories = [];
  for (const repository of repositoryPaths) {
    const [branchResult, statusResult, headResult] = await Promise.all([
      runGit(repository, ['branch', '--show-current'], { allowFailure: true }),
      runGit(repository, [
        '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all',
      ]),
      runGit(repository, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }),
    ]);
    const parsed = parseStatus(statusResult.stdout);
    const files = [];
    for (const file of parsed.files) {
      if (remainingDiffBytes <= 0) {
        files.push({ ...file, diff: '', diffBytes: 0, diffTruncated: true, binary: false });
        anyDiffTruncated = true;
        continue;
      }
      const next = await readFileDiff(repository, file, headResult.ok);
      if (next.diffBytes > remainingDiffBytes) {
        next.diff = `${next.diff.slice(0, remainingDiffBytes)}\n\n[Workspace diff limit reached]`;
        next.diffBytes = remainingDiffBytes;
        next.diffTruncated = true;
      }
      remainingDiffBytes -= next.diffBytes;
      anyDiffTruncated ||= next.diffTruncated;
      files.push(next);
    }
    const repositoryPath = relative(root, repository).replaceAll('\\', '/') || '.';
    const branch = branchResult.stdout.trim() || (headResult.ok
      ? `detached@${(await runGit(repository, ['rev-parse', '--short', 'HEAD'])).stdout.trim()}`
      : 'No commits');
    repositories.push({
      id: repositoryPath,
      name: basename(repository),
      path: repositoryPath,
      branch,
      files,
      conflicts: files.filter((file) => file.conflict).map((file) => file.path),
      truncated: parsed.truncated || files.some((file) => file.diffTruncated),
      additions: files.reduce((total, file) => total + (file.diff.match(/^\+(?!\+\+)/gm)?.length ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.diff.match(/^-(?!--)/gm)?.length ?? 0), 0),
      diffBytes: files.reduce((total, file) => total + file.diffBytes, 0),
      commitPlanAvailable: files.length > 0
        && files.length <= commitPlanFileLimit
        && files.reduce((total, file) => total + file.diffBytes, 0) <= commitPlanDiffLimit
        && !parsed.truncated
        && !files.some((file) => file.diffTruncated),
    });
  }

  const changedFiles = repositories.reduce((total, repository) => total + repository.files.length, 0);
  const diffBytes = repositories.reduce((total, repository) => total + repository.diffBytes, 0);
  return {
    root,
    name: basename(root),
    repositories,
    truncated: anyDiffTruncated || repositories.some((repository) => repository.truncated),
    commitPlanAvailable: changedFiles > 0
      && changedFiles <= commitPlanFileLimit
      && diffBytes <= commitPlanDiffLimit
      && !anyDiffTruncated
      && repositories.every((repository) => (
        repository.files.length === 0 || repository.commitPlanAvailable
      )),
    limits: {
      repositories: repositoryLimit,
      filesPerRepository: fileLimit,
      fileDiffBytes: fileDiffLimit,
      totalDiffBytes: totalDiffLimit,
      commitPlanFiles: commitPlanFileLimit,
      commitPlanDiffBytes: commitPlanDiffLimit,
    },
  };
}

export async function commitGitPlan(workspacePath, repositoryPath, commits) {
  const repository = await resolveRepository(workspacePath, repositoryPath);
  if (!Array.isArray(commits) || commits.length === 0) throw new Error('The commit plan is empty.');
  const status = parseStatus((await runGit(repository, [
    '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ])).stdout);
  const changedFiles = new Set(status.files.map((file) => file.path));
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
