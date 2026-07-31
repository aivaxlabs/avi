import { execFile, spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

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
const filenameResultLimit = 80;
const contentResultLimit = 120;
const temporaryAttachmentDirectory = resolve(tmpdir(), '.avi', 'chat-attachments');
const attachmentExtensionsByMime = {
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

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

export function filePathToAttachment(filePath) {
  const path = realpathSync.native(filePath);
  const ext = extname(path).toLowerCase();
  const name = basename(path);
  const mime = mimeTypes[ext] ?? 'application/octet-stream';
  const buffer = readFileSync(path);
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  if (imageExtensions.has(ext)) {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'image_url', path, dataUrl });
  }
  if (videoExtensions.has(ext)) {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'video_url', path, dataUrl });
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
  const clipboardDirectory = resolve(temporaryAttachmentDirectory, String(Date.now()));
  return Promise.all(attachments.map(async (originalAttachment) => {
    let attachment = originalAttachment;
    if (attachment.source === 'clipboard' && !attachment.temporary) {
      const buffer = attachmentToBuffer(attachment);
      if (!buffer) {
        throw new Error(`Could not create a local copy of "${attachment.name ?? 'attachment'}".`);
      }

      const extension = extname(attachment.name || '').toLowerCase()
        || attachmentExtensionsByMime[attachment.mime]
        || '.bin';
      await mkdir(clipboardDirectory, { recursive: true });
      const path = resolve(clipboardDirectory, `${crypto.randomUUID()}${extension}`);
      await writeFile(path, buffer);
      attachment = { ...attachment, path, temporary: true };
    }

    const supported = attachment.kind === 'context_marker'
      || attachment.kind === 'file_reference'
      || (attachment.kind === 'text_inline' && attachment.source !== 'pasted_text')
      || (attachment.kind === 'image_url' && capabilities.images)
      || (attachment.kind === 'input_audio' && capabilities.audio)
      || (
        attachment.kind === 'file'
        && attachment.mime === 'application/pdf'
        && capabilities.pdfFiles
      );
    if (supported) return attachment;

    let path = null;
    if (typeof attachment.path === 'string' && isAbsolute(attachment.path)) {
      try {
        const realPath = await realpath(attachment.path);
        if ((await lstat(realPath)).isFile()) path = realPath;
      } catch {}
    }

    let temporary = Boolean(attachment.temporary);
    if (!path) {
      const buffer = attachmentToBuffer(attachment);
      if (!buffer) {
        throw new Error(`Could not create a local copy of "${attachment.name ?? 'attachment'}".`);
      }

      await mkdir(temporaryAttachmentDirectory, { recursive: true });
      const safeName = basename(attachment.name || 'attachment')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
      path = resolve(temporaryAttachmentDirectory, `${crypto.randomUUID()}-${safeName}`);
      await writeFile(path, buffer);
      temporary = true;
    }

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
  const rootStat = await lstat(root);
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
  const targetPath = resolveWorkspacePath(root, directoryPath);
  const state = workspaceStates.get(root.toLowerCase()) ?? {
    repositories: new Set(),
    statuses: new Map(),
  };
  const entries = await readdir(targetPath, { withFileTypes: true });

  return entries
    .map((entry) => {
      const path = relative(root, resolve(targetPath, entry.name));
      const absolutePath = resolve(root, path);
      return {
        name: entry.name,
        path,
        type: entry.isDirectory()
          ? 'directory'
          : entry.isSymbolicLink()
            ? 'symlink'
            : 'file',
        status: statusForWorkspacePath(state, root, absolutePath, entry.isDirectory()),
        repository: state.repositories.has(absolutePath.toLowerCase()),
      };
    })
    .sort((left, right) => (
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

export async function readWorkspaceFile(folderPath, filePath) {
  const root = resolve(folderPath);
  const targetPath = resolveWorkspacePath(root, filePath);
  const fileStat = await lstat(targetPath);
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
  return {
    ...result,
    kind: 'text',
    content: buffer.toString('utf8'),
  };
}

export function resolveWorkspacePath(folderPath, targetPath = '') {
  const root = resolve(folderPath);
  const path = resolve(root, targetPath);
  const relativePath = relative(root, path);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`"${targetPath}" is outside the current directory.`);
  }
  const realRoot = realpathSync.native(root);
  const realPath = realpathSync.native(path);
  const realRelativePath = relative(realRoot, realPath);
  if (realRelativePath.startsWith('..') || isAbsolute(realRelativePath)) {
    throw new Error(`"${targetPath}" resolves outside the current directory.`);
  }
  return realPath;
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
