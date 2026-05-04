import { dialog, shell } from 'electron';
import { basename, extname } from 'node:path';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const baseUrl = 'https://inference.aivax.net';

const mimeTypes = {
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
};

const textExtensions = new Set(['.css', '.csv', '.html', '.js', '.json', '.log', '.md', '.mjs', '.sql', '.txt', '.xml', '.yaml', '.yml']);

export async function listDirectory({ token, workspaceId, path = '/' }) {
  const normalizedPath = normalizeRemotePath(path);
  const result = await shellRequest('/api/v1/shell/io/listing', {
    token,
    workspaceId,
    query: { path: normalizedPath },
  }, { allowRootNotFound: true });
  return {
    path: normalizedPath,
    entries: (result.entries ?? result.data?.entries ?? []).map((entry) => ({
      name: entry.name,
      path: joinRemotePath(normalizedPath, entry.name),
      isDirectory: Boolean(entry.isDirectory),
      size: entry.size ?? null,
      lastModifiedUtc: entry.lastModifiedUtc ?? null,
      createdAtUtc: entry.createdAtUtc ?? null,
    })),
  };
}

export async function getFileDetails({ token, workspaceId, path }) {
  const result = await shellRequest('/api/v1/shell/io/file/details', {
    token,
    workspaceId,
    query: { path: normalizeRemotePath(path) },
  });
  return result.data ?? result;
}

export async function getPublicAddress({ token, workspaceId, path }) {
  const result = await shellRequest('/api/v1/shell/io/file/public-address', {
    token,
    workspaceId,
    query: { path: normalizeRemotePath(path) },
  });
  return result.data ?? result;
}

export async function previewFile({ token, workspaceId, path }) {
  const response = await downloadResponse({ token, workspaceId, path });
  const buffer = Buffer.from(await response.arrayBuffer());
  const details = await getOptionalDetails({ token, workspaceId, path });
  const name = details?.name ?? basename(path);
  const mime = details?.mimeType ?? mimeFromPath(name);
  const plainText = Boolean(details?.isPlainText) || isPlainText(name, mime);
  return {
    name,
    path: normalizeRemotePath(path),
    mime,
    size: details?.size ?? buffer.length,
    isPlainText: plainText,
    text: plainText ? buffer.toString('utf8') : null,
    dataUrl: plainText ? null : `data:${mime};base64,${buffer.toString('base64')}`,
  };
}

export async function downloadFile({ token, workspaceId, path, window }) {
  const response = await downloadResponse({ token, workspaceId, path });
  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = basename(path);
  const result = await dialog.showSaveDialog(window, {
    defaultPath: filename,
  });
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, buffer);
  return { path: result.filePath };
}

export async function uploadFiles({ token, workspaceId, path = '/', window }) {
  const selected = await selectUploadFiles({ window });
  const uploaded = [];
  for (const file of selected) {
    await uploadLocalFile({
      token,
      workspaceId,
      remotePath: joinRemotePath(path, file.name),
      filePath: file.filePath,
    });
    uploaded.push({ name: file.name, path: joinRemotePath(path, file.name) });
  }
  return uploaded;
}

export async function selectUploadFiles({ window }) {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths.map((filePath) => ({
    filePath,
    name: basename(filePath),
    size: statSync(filePath).size,
  }));
}

export async function uploadLocalFile({ token, workspaceId, remotePath, filePath, signal }) {
  const name = basename(filePath);
  await shellRequest('/api/v1/shell/io/file', {
    method: 'POST',
    token,
    workspaceId,
    query: { path: normalizeRemotePath(remotePath) },
    body: readFileSync(filePath),
    contentType: mimeFromPath(name),
    signal,
  });
  return true;
}

export async function deleteFile({ token, workspaceId, path }) {
  await shellRequest('/api/v1/shell/io/file', {
    method: 'DELETE',
    token,
    workspaceId,
    query: { path: normalizeRemotePath(path) },
  });
  return true;
}

export async function createDirectory({ token, workspaceId, path }) {
  await shellRequest('/api/v1/shell/io/directory', {
    method: 'POST',
    token,
    workspaceId,
    query: { path: normalizeRemotePath(path) },
  });
  return true;
}

export async function deleteDirectory({ token, workspaceId, path }) {
  await shellRequest('/api/v1/shell/io/directory', {
    method: 'DELETE',
    token,
    workspaceId,
    query: { path: normalizeRemotePath(path) },
  });
  return true;
}

export async function openPublicAddress(publicUrl) {
  if (publicUrl) {
    await shell.openExternal(publicUrl);
  }
  return true;
}

export function joinRemotePath(parentPath, name) {
  const parent = normalizeRemotePath(parentPath);
  const cleanName = String(name ?? '').replaceAll('\\', '/').split('/').filter(Boolean).join('/');
  if (!cleanName) return parent;
  return parent === '/' ? `/${cleanName}` : `${parent}/${cleanName}`;
}

async function downloadResponse({ token, workspaceId, path }) {
  const response = await shellFetch('/api/v1/shell/io/file', {
    token,
    workspaceId,
    query: { path: normalizeRemotePath(path) },
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return response;
}

async function getOptionalDetails(payload) {
  try {
    return await getFileDetails(payload);
  } catch {
    return null;
  }
}

async function shellRequest(path, options, behavior = {}) {
  const response = await shellFetch(path, options);
  const text = await response.text();
  const payload = text ? parseJson(text) : {};
  if (
    behavior.allowRootNotFound &&
    response.status === 404 &&
    normalizeRemotePath(options?.query?.path) === '/'
  ) {
    return { entries: [] };
  }
  if (!response.ok) {
    throw new Error(messageFromPayload(payload) || response.statusText);
  }
  return payload;
}

function shellFetch(path, { method = 'GET', token, workspaceId, query = {}, body, contentType, signal } = {}) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Shell-User-Id': workspaceId,
      ...(body ? { 'Content-Type': contentType ?? 'application/octet-stream' } : {}),
    },
    body,
    signal,
  });
}

async function errorMessage(response) {
  const text = await response.text();
  const payload = text ? parseJson(text) : {};
  return messageFromPayload(payload) || response.statusText || `Shell I/O failed with status ${response.status}`;
}

function messageFromPayload(payload) {
  return payload?.message ?? payload?.error?.message ?? payload?.error ?? payload?.data?.message ?? '';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeRemotePath(path) {
  const value = String(path || '/').replaceAll('\\', '/').trim();
  const parts = value.split('/').filter(Boolean);
  return `/${parts.join('/')}`;
}

function mimeFromPath(path) {
  return mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function isPlainText(path, mime) {
  return mime.startsWith('text/') || textExtensions.has(extname(path).toLowerCase());
}
