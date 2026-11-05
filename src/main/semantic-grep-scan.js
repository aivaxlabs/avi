import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SKIPPED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'jspm_packages',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache',
  '.cache', '__pycache__', '.venv', '.tox', '.mypy_cache', '.pytest_cache', '.gradle', '.vs', '.idea', '.dart_tool',
]);

const MSBUILD_PROJECT = /\.(cs|vb|fs|vcx|sql|es|dc|wap|wix|msbuild)?proj$/;
const MSBUILD_ROOT = /(\.slnx?|^directory\.build\.props)$/;
const BUILD_OUTPUT_DIRS = {
  bin: [MSBUILD_PROJECT, /^\.classpath$/],
  obj: [MSBUILD_PROJECT],
  artifacts: [MSBUILD_ROOT],
  out: [/^package\.json$/, /\.iml$/],
  dist: [/^package\.json$/, /^(pyproject\.toml|setup\.py|setup\.cfg)$/],
  build: [/^(pyproject\.toml|setup\.py|setup\.cfg)$/, /^build\.gradle(\.kts)?$/, /^pubspec\.yaml$/],
  coverage: [/^package\.json$/],
  htmlcov: [/^(pyproject\.toml|setup\.py|setup\.cfg)$/],
  target: [/^(pom\.xml|build\.sbt|cargo\.toml)$/],
  _build: [/^mix\.exs$/],
  deps: [/^mix\.exs$/],
  vendor: [/^(composer\.json|go\.mod)$/],
};
const SELF_MARKED_DIR_FILES = new Set(['pyvenv.cfg', 'cachedir.tag']);
const SKIPPED_FILES = new Set([
  'bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'deno.lock',
  'composer.lock', 'gemfile.lock', 'cargo.lock', 'poetry.lock', 'pipfile.lock', 'uv.lock', 'pdm.lock', 'go.sum',
  'packages.lock.json', 'project.assets.json', 'flake.lock', 'mix.lock', 'pubspec.lock', 'podfile.lock',
  'package.resolved', 'gradle.lockfile',
]);
const SKIPPED_FILE_PATTERN = /\.(min\.(js|mjs|cjs|css)|map|bundle\.js|chunk\.js|tsbuildinfo|designer\.cs|g\.cs|g\.i\.cs|g\.vb|deps\.json|nuget\.cache)$/i;
const TEXT_EXTENSIONS = new Set([
  'bash', 'bat', 'c', 'cc', 'cfg', 'cjs', 'clj', 'cljs', 'cmd', 'conf', 'cpp', 'cs', 'csproj', 'css', 'csv',
  'dart', 'diff', 'editorconfig', 'ejs', 'env', 'ex', 'exs', 'fs', 'fsproj', 'go', 'gradle', 'graphql', 'h', 'hh',
  'hpp', 'htm', 'html', 'ini', 'java', 'js', 'json', 'json5', 'jsx', 'less', 'lua', 'm', 'md', 'mjs', 'php', 'pl',
  'props', 'ps1', 'py', 'r', 'rb', 'rs', 'scss', 'sh', 'sln', 'sql', 'svg', 'swift', 'toml', 'ts', 'tsx', 'txt',
  'vb', 'vue', 'xaml', 'xcss', 'xml', 'yaml', 'yml',
]);
const MAX_CHUNK_CHARS = 6_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_DOC_NAME_CHARS = 120;
const SNIFF_BYTES = 8_192;

export function fileExtension(filePath) {
  return extname(filePath).replace(/^\./, '').toLowerCase();
}

export function hasTextExtension(filePath) {
  return TEXT_EXTENSIONS.has(fileExtension(filePath));
}

function looksLikeText(bytes) {
  const sample = bytes.subarray(0, SNIFF_BYTES);
  if (sample.includes(0)) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) control += 1;
  }
  return control <= sample.length * 0.01;
}

function isSkippedDir(name, siblingFiles) {
  if (SKIPPED_DIRS.has(name)) return true;
  const markers = BUILD_OUTPUT_DIRS[name.toLowerCase()];
  return Boolean(markers && siblingFiles.some((file) => markers.some((marker) => marker.test(file))));
}

function isGeneratedFile(name) {
  return SKIPPED_FILES.has(name.toLowerCase()) || SKIPPED_FILE_PATTERN.test(name);
}

export function pathHash(absolutePath) {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 16);
}

export function splitChunks(text) {
  const chunks = [];
  const lines = text.split(/\r?\n/);
  const syntheticTrailingBlank = lines.length > 1 && (text.endsWith('\n') || text.endsWith('\r'));
  let current = '';
  let chunkStart = 1;
  let chunkEnd = 1;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const countsAsSourceLine = !(syntheticTrailingBlank && index === lines.length - 1);
    for (let start = 0; start < Math.max(line.length, 1); start += MAX_CHUNK_CHARS) {
      const piece = line.slice(start, start + MAX_CHUNK_CHARS);
      if (current.length + piece.length + 1 > MAX_CHUNK_CHARS && current.length > 0) {
        chunks.push({ text: current, sourceLineStart: chunkStart, sourceLineEnd: chunkEnd });
        current = '';
      }
      if (current.length === 0 && countsAsSourceLine) {
        chunkStart = lineNumber;
        chunkEnd = lineNumber;
      }
      current += current.length > 0 ? `\n${piece}` : piece;
      if (countsAsSourceLine) chunkEnd = lineNumber;
    }
  });
  if (current.trim().length > 0) {
    chunks.push({ text: current, sourceLineStart: chunkStart, sourceLineEnd: chunkEnd });
  }
  return chunks;
}

function isInsideAny(path, roots) {
  return roots.some((root) => {
    const relativePath = relative(resolve(root), path);
    return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
  });
}

async function listGitFiles(root) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    const entries = new Set();
    const dirs = new Set();
    for (const listed of stdout.split('\0')) {
      const entry = listed.replace(/\/$/, '');
      if (!entry) continue;
      entries.add(entry);
      let end = entry.lastIndexOf('/');
      while (end > 0) {
        const dir = entry.slice(0, end);
        if (dirs.has(dir)) break;
        dirs.add(dir);
        end = entry.lastIndexOf('/', end - 1);
      }
    }
    return { root, entries, dirs };
  } catch {
    return null;
  }
}

async function* walk(root, { maxDepth, roots, signal }) {
  const visited = new Set();
  async function* visit(dir, depth, repository) {
    if (signal?.aborted || depth > maxDepth) return;
    const real = await realpath(dir).catch(() => dir);
    if (visited.has(real)) return;
    visited.add(real);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.name === '.git')) {
      if (directoryKey(await canonicalWorktree(dir, roots)) !== directoryKey(dir)) return;
      repository = await listGitFiles(dir);
    }
    const siblingFiles = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name.toLowerCase());
    if (depth > 0 && siblingFiles.some((file) => SELF_MARKED_DIR_FILES.has(file))) return;
    for (const entry of entries) {
      if (signal?.aborted) return;
      const fullPath = join(dir, entry.name);
      let directory = entry.isDirectory();
      let file = entry.isFile();
      if (entry.isSymbolicLink()) {
        const info = await stat(fullPath).catch(() => null);
        if (!info) continue;
        directory = info.isDirectory();
        file = info.isFile();
      }
      const gitPath = repository && relative(repository.root, fullPath).split(sep).join('/');
      if (directory) {
        if (isSkippedDir(entry.name, siblingFiles)) continue;
        if (!repository || repository.dirs.has(gitPath)) {
          yield* visit(fullPath, depth + 1, repository);
        } else if (repository.entries.has(gitPath)) {
          // Git lists nested repositories, submodules, and symbolic links as single entries.
          yield* visit(fullPath, depth + 1, null);
        }
      } else if (
        file
        && (!repository || repository.entries.has(gitPath))
        && hasTextExtension(entry.name)
        && !isGeneratedFile(entry.name)
      ) {
        yield fullPath;
      }
    }
  }

  const enclosing = await gitRepositoryRoot(root).catch(() => null);
  if (enclosing && directoryKey(enclosing.path) !== directoryKey(root)) {
    if (directoryKey(await canonicalWorktree(enclosing.path, roots)) !== directoryKey(enclosing.path)) return;
    yield* visit(root, 0, await listGitFiles(enclosing.path));
  } else {
    yield* visit(root, 0, null);
  }
}

function documentsForFile(filePath, root, bytes, info) {
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES || !looksLikeText(bytes)) return [];
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
  const relativePath = relative(root, filePath);
  const extension = fileExtension(filePath);
  const hash = pathHash(filePath);
  const name = basename(filePath);
  const docName = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, MAX_DOC_NAME_CHARS);
  const tags = [...new Set([...relativePath.split(sep).slice(0, -1), extension, name].filter(Boolean))];
  return splitChunks(text).map((chunk, index) => ({
    docId: `${hash}-${docName}:${index}`,
    text: chunk.text,
    __ref: hash,
    __tags: tags,
    __meta: {
      source: 'avi-semantic-grep',
      real_path: filePath,
      relative_path: relativePath,
      extension,
      file_modified_date: info.mtime.toISOString(),
      file_created_at: info.birthtime.toISOString(),
      source_line_start: chunk.sourceLineStart,
      source_line_end: chunk.sourceLineEnd,
    },
  }));
}

export async function scanDirectories(dirs, {
  maxDepth = 8,
  onFile,
  signal,
  workers = 4,
} = {}) {
  const pending = new Set();
  const roots = dirs.map((dir) => resolve(dir));
  let files = 0;
  let documents = 0;
  for (const root of roots) {
    try {
      if (!(await stat(root)).isDirectory()) continue;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for await (const filePath of walk(root, { maxDepth, roots, signal })) {
      if (signal?.aborted) break;
      const task = (async () => {
        const info = await stat(filePath);
        if (info.size > MAX_FILE_BYTES) return;
        const bytes = await readFile(filePath);
        const lines = documentsForFile(filePath, root, bytes, info);
        if (lines.length === 0) return;
        files += 1;
        documents += lines.length;
        onFile?.({ path: filePath, relativePath: relative(root, filePath), bytes: bytes.length, lines });
      })().catch(() => {}).finally(() => pending.delete(task));
      pending.add(task);
      if (pending.size >= workers) await Promise.race(pending);
    }
  }
  await Promise.all(pending);
  return { files, documents };
}

export async function gitRepositoryRoot(start) {
  let current = resolve(start);
  while (true) {
    try {
      const info = await lstat(join(current, '.git'));
      return { path: current, linked: info.isFile() };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function canonicalWorktree(worktree, roots) {
  const root = resolve(worktree);
  const dotGit = join(root, '.git');
  if (!(await lstat(dotGit).catch(() => null))?.isFile()) return root;

  const gitDir = await readFile(dotGit, 'utf8')
    .then((text) => text.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim())
    .catch(() => null);
  const commonDir = gitDir && await readFile(join(resolve(root, gitDir), 'commondir'), 'utf8')
    .then((text) => resolve(root, gitDir, text.trim()))
    .catch(() => null);
  if (!commonDir) return root;

  const main = basename(commonDir) === '.git' ? dirname(commonDir) : null;
  if (main && isInsideAny(main, roots) && (await lstat(commonDir).catch(() => null))?.isDirectory()) return main;

  const names = await readdir(join(commonDir, 'worktrees')).catch(() => []);
  const linked = await Promise.all(names.map(async (name) => {
    try {
      const gitFile = join(commonDir, 'worktrees', name, 'gitdir');
      const path = dirname(resolve(dirname(gitFile), (await readFile(gitFile, 'utf8')).trim()));
      return isInsideAny(path, roots) && (await lstat(join(path, '.git'))).isFile() ? path : null;
    } catch {
      return null;
    }
  }));
  return [root, ...linked.filter(Boolean)]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
}

export function directoryKey(filePath) {
  const path = resolve(filePath);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function formatLineRanges(ranges) {
  const unique = [];
  for (const range of ranges ?? []) {
    if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end) || range.start < 1 || range.end < range.start) continue;
    if (unique.some((item) => item.start === range.start && item.end === range.end)) continue;
    unique.push(range);
  }
  unique.sort((left, right) => left.start - right.start || left.end - right.end);
  if (unique.length === 0) return '';
  return `:${unique.map((range) => `${range.start}-${range.end}`).join(',')}`;
}

export function formatFileSearchResults(directory, hits) {
  if (hits.length === 0) {
    return `No semantic matches in ${directory}. This is not evidence that the text is absent. Use rg or a similar exact search.`;
  }
  return hits.map((hit) => `${hit.score.toFixed(3)}  ${hit.relativePath}${formatLineRanges(hit.ranges)}`).join('\n');
}

export function semanticPathFilter(directory) {
  const root = resolve(directory);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return `metadata.real_path startswith ${JSON.stringify(prefix)}`;
}
