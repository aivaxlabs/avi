import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  sep,
} from 'node:path';

const conversationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storedReferences = new WeakMap();

export function activeMediaDirectory() {
  return join(homedir(), '.aivax', 'media');
}

export function archivedMediaDirectory() {
  return join(tmpdir(), '.avi', 'archived-media');
}

export function storesConversationMedia(media, conversationId) {
  if (inlineMediaData(media)) return true;
  const path = media?.[media?.type]?.path;
  if (typeof path !== 'string') return false;
  const conversationDirectory = dirname(path);
  return basename(conversationDirectory) !== conversationId
    && [activeMediaDirectory(), archivedMediaDirectory()].includes(dirname(conversationDirectory));
}

export function storeConversationMedia(media, conversationId) {
  if (!storesConversationMedia(media, conversationId)) return media;
  const stored = storedReferences.get(media);
  if (stored) return stored;

  const directory = join(activeMediaDirectory(), conversationId);
  const inline = inlineMediaData(media);
  let reference;
  if (inline) {
    const buffer = Buffer.from(inline.data.slice(inline.offset), 'base64');
    if (buffer.length === 0) return media;
    const hash = createHash('sha256').update(buffer).digest('hex');
    const extension = inline.mime.split('/')[1]?.split(/[;+]/)[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const path = join(directory, `${hash}.${extension}`);
    if (!existsSync(path)) {
      mkdirSync(directory, { recursive: true });
      const temporaryPath = `${path}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, buffer);
      renameSync(temporaryPath, path);
    }
    reference = media.type === 'input_audio'
      ? { path, mime: inline.mime, format: media.input_audio.format ?? 'mp3' }
      : media.type === 'file'
        ? { path, mime: inline.mime, filename: media.file.filename ?? basename(path) }
        : { path, mime: inline.mime };
  } else {
    const source = media[media.type];
    const path = join(directory, basename(source.path));
    if (!existsSync(path)) {
      if (!existsSync(source.path)) return media;
      mkdirSync(directory, { recursive: true });
      try {
        linkSync(source.path, path);
      } catch {
        copyFileSync(source.path, path);
      }
    }
    reference = { ...source, path };
  }

  const result = { ...media, [media.type]: reference };
  storedReferences.set(media, result);
  return result;
}

export function listMediaConversationIds(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && conversationIdPattern.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function moveConversationMedia(conversationId, fromRoot, toRoot) {
  const source = join(fromRoot, conversationId);
  const target = join(toRoot, conversationId);
  mkdirSync(toRoot, { recursive: true });
  try {
    if (existsSync(target)) throw new Error('Target media directory already exists.');
    renameSync(source, target);
  } catch {
    cpSync(source, target, { recursive: true, force: false });
    rmSync(source, { recursive: true, force: true });
  }
  return { from: `${source}${sep}`, to: `${target}${sep}` };
}

function inlineMediaData(media) {
  if (media?.type === 'input_audio' && typeof media.input_audio?.data === 'string') {
    return {
      data: media.input_audio.data,
      offset: 0,
      mime: `audio/${media.input_audio.format ?? 'mp3'}`,
    };
  }
  const data = media?.type === 'image_url'
    ? media.image_url?.url
    : media?.type === 'video_url'
      ? media.video_url?.url
      : media?.type === 'file'
        ? media.file?.file_data
        : null;
  const header = typeof data === 'string' ? /^data:([^;,]+);base64,/.exec(data.slice(0, 256)) : null;
  return header ? { data, offset: header[0].length, mime: header[1] } : null;
}
