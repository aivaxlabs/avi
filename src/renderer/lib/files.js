const imageExtensions = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
const audioExtensions = new Set(['flac', 'm4a', 'mp3', 'oga', 'ogg', 'wav', 'webm']);
const videoExtensions = new Set(['avi', 'm4v', 'mov', 'mp4', 'mpeg', 'mpg', 'webm']);
const textExtensions = new Set([
  'css',
  'csv',
  'html',
  'js',
  'json',
  'jsx',
  'log',
  'md',
  'mjs',
  'sql',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

export async function fileToAttachment(file, source = null) {
  const kind = kindFromFile(file);
  const attachment = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind,
    ...(source ? { source } : {}),
    ...(typeof file.path === 'string' && file.path.trim() ? { path: file.path } : {}),
  };
  if (kind === 'text_inline') {
    return {
      ...attachment,
      text: await file.text(),
    };
  }
  const dataUrl = await readAsDataUrl(file);
  if (kind === 'input_audio') {
    return {
      ...attachment,
      base64: dataUrl.split(',')[1] ?? '',
      format: extension(file.name) || 'mp3',
    };
  }
  return {
    ...attachment,
    dataUrl,
  };
}

export function textToAttachment(text, name = 'pasted-text.txt') {
  return {
    id: crypto.randomUUID(),
    name,
    mime: 'text/plain',
    size: new TextEncoder().encode(text).byteLength,
    kind: 'text_inline',
    source: 'pasted_text',
    text,
  };
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function kindFromFile(file) {
  const type = file.type.toLowerCase();
  const ext = extension(file.name);

  if (type.startsWith('image/') || imageExtensions.has(ext)) return 'image_url';
  if (type.startsWith('audio/') || audioExtensions.has(ext)) return 'input_audio';
  if (type.startsWith('video/') || videoExtensions.has(ext)) return 'video_url';
  if (type.startsWith('text/') || textExtensions.has(ext)) return 'text_inline';
  return 'file';
}

function extension(name) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}
