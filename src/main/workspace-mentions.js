import { readdir, realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

const INDEX_TTL_MS = 5 * 60_000;
const MAX_RECURSION_DEPTH = 4;
const DIRECTORY_FILE_BUCKET = 2048;
const RESULT_LIMIT = 100;
const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.venv',
  '.vs',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'target',
  'vendor',
  'venv',
]);
const textExtensions = new Set([
  '.c', '.cc', '.conf', '.cpp', '.cs', '.css', '.csv', '.go', '.graphql', '.h', '.hpp',
  '.htm', '.html', '.ini', '.java', '.js', '.json', '.jsx', '.less', '.log', '.lua',
  '.md', '.mdx', '.mjs', '.php', '.properties', '.py', '.rb', '.rs', '.sass', '.scss',
  '.sh', '.sql', '.svelte', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.xcss',
  '.yaml', '.yml',
]);
const indexCache = new Map();

function pathKey(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function displayPath(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

function fuzzyScore(value, query) {
  if (!query) return 0;
  const target = value.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const exactIndex = target.indexOf(normalizedQuery);
  if (exactIndex >= 0) {
    return 10_000 - exactIndex * 10 - Math.max(0, target.length - normalizedQuery.length);
  }

  let score = 0;
  let targetIndex = 0;
  let previousMatch = -2;
  for (const character of normalizedQuery) {
    const matchIndex = target.indexOf(character, targetIndex);
    if (matchIndex < 0) return null;
    score += matchIndex === previousMatch + 1 ? 12 : 3;
    if (matchIndex === 0 || '/\\_- .'.includes(target[matchIndex - 1])) score += 8;
    score -= matchIndex - targetIndex;
    previousMatch = matchIndex;
    targetIndex = matchIndex + 1;
  }
  return score - Math.max(0, target.length - normalizedQuery.length) / 10;
}

async function buildIndex(root) {
  const files = [];
  const directories = [];
  const pending = [{ path: root, depth: 0 }];
  const visited = new Set();

  while (pending.length > 0) {
    const directory = pending.shift();
    let canonicalPath;
    try {
      canonicalPath = await realpath(directory.path);
    } catch {
      continue;
    }
    const canonicalKey = pathKey(canonicalPath);
    if (visited.has(canonicalKey)) continue;
    visited.add(canonicalKey);

    const entries = await readdir(directory.path, { withFileTypes: true }).catch(() => []);
    const childDirectories = [];
    const fileEntries = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          directory.depth < MAX_RECURSION_DEPTH
          && !ignoredDirectories.has(entry.name.toLowerCase())
        ) {
          const childPath = resolve(directory.path, entry.name);
          childDirectories.push({ path: childPath, depth: directory.depth + 1 });
          directories.push({
            name: entry.name,
            path: displayPath(root, childPath),
            type: 'directory',
            depth: directory.depth + 1,
          });
        }
      } else if (entry.isFile()) {
        fileEntries.push(entry);
      }
    }

    fileEntries.sort((left, right) => (
      Number(textExtensions.has(extname(right.name).toLowerCase()))
      - Number(textExtensions.has(extname(left.name).toLowerCase()))
      || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    ));
    for (const entry of fileEntries.slice(0, DIRECTORY_FILE_BUCKET)) {
      const filePath = resolve(directory.path, entry.name);
      const extension = extname(entry.name).toLowerCase();
      files.push({
        name: entry.name,
        path: displayPath(root, filePath),
        type: 'file',
        text: textExtensions.has(extension),
        depth: directory.depth,
      });
    }
    const fileCount = Math.min(fileEntries.length, DIRECTORY_FILE_BUCKET);
    const truncated = fileEntries.length > DIRECTORY_FILE_BUCKET;

    directories.push({
      path: displayPath(root, directory.path),
      depth: directory.depth,
      fileCount,
      truncated,
      indexedDirectory: true,
    });
    pending.push(...childDirectories);
  }

  const items = [...files, ...directories.filter((item) => !item.indexedDirectory)];
  return {
    root,
    items,
    directories: directories.filter((item) => item.indexedDirectory),
  };
}

export async function indexWorkspaceMentions(folderPath, {
  now = Date.now(),
  ttlMs = INDEX_TTL_MS,
} = {}) {
  const root = resolve(folderPath);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`"${folderPath}" is not a directory.`);
  const key = pathKey(root);
  const cached = indexCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildIndex(root).catch((error) => {
    if (indexCache.get(key)?.promise === promise) indexCache.delete(key);
    throw error;
  });
  const entry = { promise, expiresAt: now + ttlMs };
  indexCache.set(key, entry);
  return promise;
}

export async function searchWorkspaceMentions(folderPath, query, options) {
  const index = await indexWorkspaceMentions(folderPath, options);
  const normalizedQuery = String(query ?? '').trim();
  return index.items
    .map((item) => ({
      ...item,
      score: fuzzyScore(`${item.name} ${item.path}`, normalizedQuery),
    }))
    .filter((item) => !normalizedQuery || item.score !== null)
    .sort((left, right) => (
      Number(right.type === 'file' && right.text) - Number(left.type === 'file' && left.text)
      || Number(right.type === 'directory') - Number(left.type === 'directory')
      || (right.score ?? 0) - (left.score ?? 0)
      || left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' })
    ))
    .slice(0, RESULT_LIMIT)
    .map(({ score: _score, ...item }) => item);
}

export function clearWorkspaceMentionCache() {
  indexCache.clear();
}
