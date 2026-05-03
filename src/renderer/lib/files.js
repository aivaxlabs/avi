const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif']);
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export async function fileToAttachment(file) {
  const dataUrl = await readAsDataUrl(file);
  const kind = kindFromFile(file);
  const attachment = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind,
  };
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
  const base64 = btoa(unescape(encodeURIComponent(text)));
  return {
    id: crypto.randomUUID(),
    name,
    mime: 'text/plain',
    size: text.length,
    kind: 'file',
    dataUrl: `data:text/plain;base64,${base64}`,
  };
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function kindFromFile(file) {
  if (imageTypes.has(file.type)) return 'image_url';
  if (videoTypes.has(file.type)) return 'video_url';
  if (file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3')) return 'input_audio';
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
