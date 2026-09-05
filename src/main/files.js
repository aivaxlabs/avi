import { execFile, spawn } from 'node:child_process';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { attachmentContentSizeLimit } from '../shared/attachments.js';

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif']);
const videoExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv']);
const audioExtensions = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac']);
const textExtensions = new Set(['.css', '.csv', '.html', '.js', '.json', '.jsx', '.log', '.md', '.mjs', '.sql', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml']);
const previewImageExtensions = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const statusPriority = {
  ignored: 1,
  untracked: 2,
  modified: 3,
  conflict: 4,
};
const workspaceStates = new Map();
const execFileAsync = promisify(execFile);
const previewSizeLimit = 1024 * 1024;
const previewLineLimit = 2000;
const filenameResultLimit = 80;
const contentResultLimit = 120;
const inlineTextAttachmentSizeLimit = 64 * 1024;
const temporaryAttachmentDirectory = resolve(tmpdir(), '.avi', 'chat-attachments');
const mimeTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.sql': 'application/sql',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.pdf': 'application/pdf',
};

export function filePathToAttachment(filePath, { deferImageContent = false } = {}) {
  const path = realpathSync.native(filePath);
  const ext = extname(path).toLowerCase();
  const name = basename(path);
  const mime = mimeTypes[ext] ?? 'application/octet-stream';
  const size = statSync(path).size;
  if (size > attachmentContentSizeLimit) {
    return makeAttachment({ name, mime, size, kind: 'file_reference', path });
  }
  if (videoExtensions.has(ext)) {
    return makeAttachment({ name, mime, size, kind: 'video_url', path });
  }
  if (deferImageContent && imageExtensions.has(ext)) {
    return makeAttachment({ name, mime, size, kind: 'image_url', path });
  }
  const buffer = readFileSync(path);
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  if (imageExtensions.has(ext)) {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'image_url', path, dataUrl });
  }
  if (audioExtensions.has(ext) && ext === '.mp3') {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'input_audio', path, base64, format: 'mp3' });
  }
  if (textExtensions.has(ext) || mime.startsWith('text/')) {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'text_inline', path, text: buffer.toString('utf8') });
  }
  return makeAttachment({ name, mime, size: buffer.length, kind: 'file', path, dataUrl });
}

export async function normalizeAttachmentsForModel(attachments, capabilities = {}) {
  return Promise.all(attachments.map(async (originalAttachment) => {
    let attachment = originalAttachment;
    if (
      attachment.source === 'clipboard'
      && attachment.kind !== 'file_reference'
      && !attachment.temporary
    ) {
      const materialized = await materializeAttachment(attachment);
      if (!materialized) {
        throw new Error(`Could not create a local copy of "${attachment.name ?? 'attachment'}".`);
      }
      attachment = {
        ...attachment,
        path: materialized.path,
        temporary: materialized.temporary,
      };
    }

    if (attachment.kind === 'video_url') {
      attachment = await materializeVideoAttachment(attachment);
    }

    const supported = attachment.kind === 'context_marker'
      || attachment.kind === 'file_reference'
      || (
        attachment.kind === 'text_inline'
        && attachment.source !== 'pasted_text'
        && (attachment.size ?? Buffer.byteLength(attachment.text ?? '', 'utf8')) <= inlineTextAttachmentSizeLimit
      )
      || (attachment.kind === 'image_url' && capabilities.images)
      || (attachment.kind === 'video_url' && capabilities.video)
      || (attachment.kind === 'input_audio' && capabilities.audio)
      || (
        attachment.kind === 'file'
        && attachment.mime === 'application/pdf'
        && capabilities.pdfFiles
      );
    if (supported) return attachment;

    const materialized = await materializeAttachment(attachment);
    if (!materialized) {
      throw new Error(`Could not create a local copy of "${attachment.name ?? 'attachment'}".`);
    }
    const { path, temporary } = materialized;

    const {
      base64: _base64,
      dataUrl: _dataUrl,
      text: _text,
      ...metadata
    } = attachment;
    return {
      ...metadata,
      kind: 'file_reference',
      path,
      temporary,
    };
  }));
}

export async function materializeVideoAttachment(attachment) {
  if (attachment?.kind !== 'video_url') throw new Error('Only video attachments can be materialized.');
  const materialized = await materializeAttachment(attachment);
  if (!materialized) throw new Error(`Could not create a local copy of "${attachment.name ?? 'video'}".`);
  const {
    base64: _base64,
    dataUrl: _dataUrl,
    text: _text,
    ...metadata
  } = attachment;
  return {
    ...metadata,
    path: materialized.path,
    temporary: materialized.temporary,
  };
}

export async function materializeLegacyVideoAttachments(attachments) {
  return Promise.all(attachments.map((attachment) => (
    attachment?.kind === 'video_url' && typeof attachment.dataUrl === 'string'
      ? materializeVideoAttachment(attachment)
      : attachment
  )));
}

export async function createVideoFileResponse(path, rangeHeader = null) {
  const file = await stat(path);
  const size = file.size;
  const extension = extname(path).toLowerCase();
  const mime = mimeTypes[extension] ?? 'application/octet-stream';
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mime,
  };

  if (!rangeHeader || rangeHeader.includes(',')) {
    return new Response(Readable.toWeb(createReadStream(path)), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }

  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  const suffixRange = requestedStart === null;
  const start = suffixRange ? Math.max(0, size - requestedEnd) : requestedStart;
  const end = suffixRange ? size - 1 : Math.min(requestedEnd ?? size - 1, size - 1);
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || start >= size
    || end < start
  ) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }

  return new Response(Readable.toWeb(createReadStream(path, { start, end })), {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
    },
  });
}

export async function materializeAttachment(attachment) {
  if (typeof attachment.path === 'string' && isAbsolute(attachment.path)) {
    try {
      const path = await realpath(attachment.path);
      if ((await lstat(path)).isFile()) {
        return { path, temporary: Boolean(attachment.temporary), materialized: false };
      }
    } catch {}
  }

  const buffer = attachmentToBuffer(attachment);
  if (!buffer) return null;

  await mkdir(temporaryAttachmentDirectory, { recursive: true });
  const safeName = basename(attachment.name || 'attachment.bin')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  const path = resolve(temporaryAttachmentDirectory, `${crypto.randomUUID()}-${safeName}`);
  await writeFile(path, buffer);
  return { path, temporary: true, materialized: true };
}

function attachmentToBuffer(attachment) {
  if (typeof attachment.text === 'string') return Buffer.from(attachment.text, 'utf8');
  if (typeof attachment.base64 === 'string') return Buffer.from(attachment.base64, 'base64');
  if (typeof attachment.dataUrl !== 'string') return null;

  const separatorIndex = attachment.dataUrl.indexOf(',');
  if (separatorIndex < 0) return null;
  const metadata = attachment.dataUrl.slice(0, separatorIndex);
  const encoded = attachment.dataUrl.slice(separatorIndex + 1);
  return metadata.endsWith(';base64')
    ? Buffer.from(encoded, 'base64')
    : Buffer.from(decodeURIComponent(encoded), 'utf8');
}

export async function inspectWorkspaceFiles(folderPath) {
  const root = resolve(folderPath);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`"${folderPath}" is not a directory.`);

  let level = [root];
  const repositories = [];
  for (let depth = 0; depth <= 3 && level.length > 0; depth += 1) {
    const inspected = await Promise.all(level.map(async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      const repository = entries.some((entry) => entry.name === '.git');
      return {
        repository: repository ? directory : null,
        directories: depth === 3 || (repository && depth > 0)
          ? []
          : entries
            .filter((entry) => entry.isDirectory() && entry.name !== '.git')
            .map((entry) => resolve(directory, entry.name)),
      };
    }));
    repositories.push(...inspected.flatMap(({ repository }) => (
      repository ? [repository] : []
    )));
    level = inspected.flatMap(({ directories }) => directories);
  }

  const statuses = new Map();
  await Promise.all(repositories.map(async (repository) => {
    const { stdout } = await execFileAsync(
      'git',
      [
        '-C',
        repository,
        '-c',
        'core.quotepath=false',
        'status',
        '--porcelain=v1',
        '-z',
        '--ignored=matching',
        '--untracked-files=all',
      ],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    ).catch(() => ({ stdout: '' }));
    const records = stdout.split('\0');
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) continue;
      const code = record.slice(0, 2);
      const relativeFilePath = record.slice(3);
      const status = code === '??'
        ? 'untracked'
        : code === '!!'
          ? 'ignored'
          : ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)
            ? 'conflict'
            : 'modified';
      const absolutePath = resolve(repository, relativeFilePath);
      let currentPath = absolutePath;
      while (true) {
        const key = currentPath.toLowerCase();
        if (
          !statuses.has(key)
          || statusPriority[status] > statusPriority[statuses.get(key)]
        ) {
          statuses.set(key, status);
        }
        if (currentPath.toLowerCase() === repository.toLowerCase()) break;
        currentPath = dirname(currentPath);
      }
      if (code.includes('R') || code.includes('C')) index += 1;
    }
  }));

  workspaceStates.set(root.toLowerCase(), {
    repositoryPaths: repositories,
    repositories: new Set(repositories.map((path) => path.toLowerCase())),
    statuses,
  });

  return {
    root,
    name: basename(root),
    repositories: repositories.map((path) => ({
      name: basename(path),
      path: relative(root, path),
    })),
    children: await listWorkspaceDirectory(root),
  };
}

export async function listWorkspaceDirectory(folderPath, directoryPath = '') {
  const root = resolve(folderPath);
  const targetPath = resolveWorkspacePath(root, directoryPath, { allowExternalSymlinks: true });
  const state = workspaceStates.get(root.toLowerCase()) ?? {
    repositories: new Set(),
    statuses: new Map(),
  };
  const entries = await readdir(targetPath, { withFileTypes: true });
  const nodes = await Promise.all(entries.map(async (entry) => {
    const path = relative(root, resolve(targetPath, entry.name));
    const absolutePath = resolve(root, path);
    const symbolicLink = entry.isSymbolicLink();
    const targetStat = symbolicLink
      ? await stat(absolutePath).catch(() => null)
      : entry;
    const type = targetStat?.isDirectory()
      ? 'directory'
      : targetStat?.isFile()
        ? 'file'
        : 'symlink';
    return {
      name: entry.name,
      path,
      type,
      symbolicLink,
      status: statusForWorkspacePath(state, root, absolutePath, type === 'directory'),
      repository: state.repositories.has(absolutePath.toLowerCase()),
    };
  }));

  return nodes.sort((left, right) => (
    Number(right.type === 'directory') - Number(left.type === 'directory')
    || left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  ));
}

export async function searchWorkspaceFiles(folderPath, searchText) {
  const root = resolveWorkspacePath(folderPath);
  const query = String(searchText ?? '').trim();
  if (!query) return { files: [], content: [], truncated: false };
  if (query.length > 200) throw new Error('Search text must be 200 characters or fewer.');

  const state = workspaceStates.get(resolve(folderPath).toLowerCase()) ?? {
    repositories: new Set(),
    statuses: new Map(),
  };
  const files = [];
  const content = [];
  const caseSensitive = query.toLowerCase() !== query;
  const comparableQuery = caseSensitive ? query : query.toLowerCase();
  let filenameLimitReached = false;
  let contentLimitReached = false;

  await Promise.all([
    runRipgrep(root, [
      '--files',
      '--hidden',
      '--follow',
      '--glob',
      '!**/.git/**',
    ], (line) => {
      const comparablePath = caseSensitive ? line : line.toLowerCase();
      if (!comparablePath.includes(comparableQuery)) return true;
      const path = relative(root, resolve(root, line));
      files.push({
        name: basename(path),
        path,
        type: 'file',
        status: statusForWorkspacePath(state, root, resolve(root, path), false),
      });
      if (files.length < filenameResultLimit) return true;
      filenameLimitReached = true;
      return false;
    }),
    runRipgrep(root, [
      '--json',
      '--hidden',
      '--follow',
      '--glob',
      '!**/.git/**',
      '--fixed-strings',
      '--smart-case',
      '--max-filesize',
      '2M',
      '--',
      query,
      '.',
    ], (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return true;
      }
      if (event.type !== 'match') return true;
      const path = relative(root, resolve(root, event.data.path.text));
      content.push({
        name: basename(path),
        path,
        line: event.data.line_number,
        preview: event.data.lines.text.trimEnd(),
        status: statusForWorkspacePath(state, root, resolve(root, path), false),
      });
      if (content.length < contentResultLimit) return true;
      contentLimitReached = true;
      return false;
    }),
  ]);

  files.sort((left, right) => (
    Number(!left.name.toLowerCase().startsWith(query.toLowerCase()))
    - Number(!right.name.toLowerCase().startsWith(query.toLowerCase()))
    || left.path.localeCompare(right.path, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  ));

  return {
    files,
    content,
    truncated: filenameLimitReached || contentLimitReached,
  };
}

export async function readWorkspaceFileDiff(folderPath, filePath) {
  const root = resolve(folderPath);
  const targetPath = resolveWorkspacePath(root, filePath, { allowExternalSymlinks: true });
  const state = workspaceStates.get(root.toLowerCase());
  const repository = (state?.repositoryPaths ?? [])
    .filter((path) => {
      const relativePath = relative(path, targetPath);
      return !relativePath.startsWith('..') && !isAbsolute(relativePath);
    })
    .sort((left, right) => right.length - left.length)[0];
  if (!repository) throw new Error(`"${filePath}" is not inside a Git repository.`);

  const relativeFilePath = relative(repository, targetPath);
  const gitOptions = {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  };
  await execFileAsync(
    'git',
    ['-C', repository, 'ls-files', '--error-unmatch', '--', relativeFilePath],
    gitOptions,
  ).catch(() => {
    throw new Error(`"${filePath}" is not tracked by Git.`);
  });
  const hasHead = await execFileAsync(
    'git',
    ['-C', repository, 'rev-parse', '--verify', 'HEAD'],
    gitOptions,
  ).then(() => true, () => false);
  const { stdout } = await execFileAsync(
    'git',
    [
      '-C',
      repository,
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-ext-diff',
      '--no-color',
      ...(hasHead ? ['HEAD'] : ['--cached']),
      '--',
      relativeFilePath,
    ],
    gitOptions,
  );
  return {
    name: basename(targetPath),
    path: relative(root, targetPath),
    kind: 'diff',
    content: stdout,
  };
}

export async function readWorkspaceFile(
  folderPath,
  filePath,
  { allowExternalReference = false } = {},
) {
  const root = resolve(folderPath);
  const targetPath = resolveWorkspacePath(root, filePath, {
    allowExternalSymlinks: true,
    allowOutsideRoot: allowExternalReference,
  });
  const fileStat = await stat(targetPath);
  if (!fileStat.isFile()) throw new Error(`"${filePath}" is not a regular file.`);

  const result = {
    name: basename(targetPath),
    path: relative(root, targetPath),
    size: fileStat.size,
  };
  if (fileStat.size > previewSizeLimit) {
    return { ...result, kind: 'large' };
  }

  const buffer = await readFile(targetPath);
  const extension = extname(targetPath).toLowerCase();
  if (previewImageExtensions.has(extension)) {
    return {
      ...result,
      kind: 'image',
      dataUrl: `data:${mimeTypes[extension]};base64,${buffer.toString('base64')}`,
    };
  }
  if (buffer.subarray(0, 8192).includes(0)) {
    return { ...result, kind: 'binary' };
  }
  let lineCount = 1;
  for (const byte of buffer) {
    if (byte !== 10) continue;
    lineCount += 1;
    if (lineCount > previewLineLimit) {
      return {
        ...result,
        kind: 'large',
        reason: 'lines',
        lineLimit: previewLineLimit,
      };
    }
  }
  return {
    ...result,
    kind: 'text',
    content: buffer.toString('utf8'),
  };
}

export function resolveWorkspacePath(
  folderPath,
  targetPath = '',
  { allowExternalSymlinks = false, allowOutsideRoot = false } = {},
) {
  const root = resolve(folderPath);
  const path = resolve(root, targetPath);
  const relativePath = relative(root, path);
  if (
    isAbsolute(targetPath)
    || (
      !allowOutsideRoot
      && (
        relativePath === '..'
        || relativePath.startsWith(`..${sep}`)
        || isAbsolute(relativePath)
      )
    )
  ) {
    throw new Error(`"${targetPath}" is outside the current directory.`);
  }
  const realRoot = realpathSync.native(root);
  const realPath = realpathSync.native(path);
  const realRelativePath = relative(realRoot, realPath);
  if (
    !allowExternalSymlinks
    && !allowOutsideRoot
    && (
      realRelativePath === '..'
      || realRelativePath.startsWith(`..${sep}`)
      || isAbsolute(realRelativePath)
    )
  ) {
    throw new Error(`"${targetPath}" resolves outside the current directory.`);
  }
  return allowExternalSymlinks ? path : realPath;
}

function statusForWorkspacePath(state, root, absolutePath, directory) {
  const status = state.statuses.get(absolutePath.toLowerCase()) ?? null;
  if (status || directory) return status;

  let parentPath = dirname(absolutePath);
  while (parentPath.length >= root.length) {
    if (state.statuses.get(parentPath.toLowerCase()) === 'ignored') return 'ignored';
    if (parentPath.toLowerCase() === root.toLowerCase()) break;
    parentPath = dirname(parentPath);
  }
  return null;
}

function runRipgrep(root, args, onLine) {
  return new Promise((resolvePromise, rejectPromise) => {
    const process = spawn('rg', args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = createInterface({
      input: process.stdout,
      crlfDelay: Infinity,
    });
    let stderr = '';
    let stopped = false;
    let settled = false;

    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    lines.on('line', (line) => {
      if (onLine(line) !== false) return;
      stopped = true;
      lines.close();
      process.kill();
    });
    process.on('error', (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(new Error(
        error.code === 'ENOENT'
          ? 'Fast file search requires ripgrep (rg) on PATH.'
          : `Could not search files: ${error.message}`,
      ));
    });
    process.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (stopped || code === 0 || code === 1) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(stderr.trim() || `File search failed with exit code ${code}.`));
    });
  });
}

function makeAttachment(attachment) {
  return {
    id: crypto.randomUUID(),
    ...attachment,
  };
}
