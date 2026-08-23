const RICH_BLOCK_PATTERN = /^(<avi-(chart|file-mention|copy)\b[^>]*>)([\s\S]*?)(<\/avi-\2>)\s*$/i;
const RICH_BLOCK_START_PATTERN = /^<avi-(chart|file-mention|copy)\b/i;
const CHART_TYPES = new Set(['bar', 'line', 'pie']);
const MAX_CHART_ITEMS = 24;

export function splitRichMarkdownBlocks(text) {
  const source = String(text ?? '');
  const lines = source.split(/(?<=\n)/);
  const parts = [];
  let markdown = '';
  let fenced = false;

  const pushMarkdown = () => {
    if (!markdown) return;
    parts.push({ type: 'markdown', text: markdown });
    markdown = '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || !RICH_BLOCK_START_PATTERN.test(trimmed)) {
      markdown += line;
      continue;
    }

    const tagName = /^<avi-([\w-]+)/i.exec(trimmed)?.[1];
    const collected = [line];
    while (!new RegExp(`<\\/avi-${tagName}>`, 'i').test(collected.at(-1)) && index + 1 < lines.length) {
      index += 1;
      collected.push(lines[index]);
    }
    const parsed = parseRichBlock(collected.join('').trim());
    if (!parsed) {
      markdown += collected.join('');
      continue;
    }
    pushMarkdown();
    parts.push(parsed);
  }

  pushMarkdown();
  return parts;
}

export function parseRichBlock(raw) {
  const match = RICH_BLOCK_PATTERN.exec(raw);
  if (!match) return null;
  const [, openingTag, type, body] = match;
  const attributes = Object.fromEntries([...openingTag.matchAll(/([\w-]+)=["']([^"']*)["']/g)]
    .map((attribute) => [attribute[1].toLowerCase(), decodeXmlEntities(attribute[2]).trim()]));

  if (type === 'chart') {
    const chartType = attributes.type?.toLowerCase();
    let data;
    try {
      data = JSON.parse(decodeXmlEntities(body).trim());
    } catch {
      return null;
    }
    if (
      !CHART_TYPES.has(chartType)
      || !Array.isArray(data)
      || data.length === 0
      || data.length > MAX_CHART_ITEMS
      || data.some((item) => (
        !item
        || typeof item.label !== 'string'
        || !item.label.trim()
        || !Number.isFinite(item.value)
        || item.value < 0
      ))
    ) {
      return null;
    }
    const normalizedData = data.map((item) => ({ label: item.label.trim(), value: item.value }));
    if (new Set(normalizedData.map((item) => item.label)).size !== normalizedData.length) return null;
    return {
      type: 'chart',
      chartType,
      title: attributes.title || 'Chart',
      data: normalizedData,
    };
  }

  const value = decodeXmlEntities(body).replace(/^\n|\n$/g, '');
  if (!value) return null;
  if (type === 'copy') {
    return { type: 'copy', label: attributes.label || 'Copyable text', value };
  }

  const path = attributes.path?.replaceAll('\\', '/');
  const lineFrom = /^\d+$/.test(attributes['line-from'] ?? '') && Number(attributes['line-from']) > 0
    ? Number(attributes['line-from'])
    : null;
  const lineTo = attributes['line-to']
    ? (/^\d+$/.test(attributes['line-to']) && Number(attributes['line-to']) > 0
      ? Number(attributes['line-to'])
      : null)
    : lineFrom;
  if (
    (!path?.startsWith('./') && !path?.startsWith('../'))
    || (attributes['line-from'] && lineFrom === null)
    || (attributes['line-to'] && (lineFrom === null || lineTo === null))
    || (lineFrom !== null && lineTo < lineFrom)
  ) {
    return null;
  }
  const language = attributes.language || /\.([\w]+)$/.exec(path)?.[1] || 'text';
  return {
    type: 'file-mention',
    path,
    lineFrom,
    lineTo,
    language: {
      cs: 'csharp',
      html: 'markup',
      js: 'javascript',
      md: 'markdown',
      ps1: 'powershell',
      sh: 'bash',
      ts: 'typescript',
      xml: 'markup',
    }[language.toLowerCase()] ?? language.toLowerCase(),
    value,
  };
}

function decodeXmlEntities(text) {
  return String(text ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}
