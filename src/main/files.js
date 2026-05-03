import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif']);
const videoExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv']);
const audioExtensions = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac']);

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
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

export function filePathToAttachment(filePath) {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath);
  const mime = mimeTypes[ext] ?? 'application/octet-stream';
  const buffer = readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  if (imageExtensions.has(ext)) {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'image_url', dataUrl });
  }
  if (videoExtensions.has(ext)) {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'video_url', dataUrl });
  }
  if (audioExtensions.has(ext) && ext === '.mp3') {
    return makeAttachment({ name, mime, size: buffer.length, kind: 'input_audio', base64, format: 'mp3' });
  }
  return makeAttachment({ name, mime, size: buffer.length, kind: 'file', dataUrl });
}

function makeAttachment(attachment) {
  return {
    id: crypto.randomUUID(),
    ...attachment,
  };
}
