import { toString } from 'mdast-util-to-string';

const CHART_TYPES = new Set(['bar', 'line', 'pie', 'progress']);
const CALLOUT_KINDS = new Set(['info', 'success', 'warning', 'danger']);
const MAX_CHART_ITEMS = 24;
const MAX_TITLE_LENGTH = 240;
const MAX_SOURCE_LENGTH = 20_000;
const DIRECTIVE_TYPES = new Set(['textDirective', 'leafDirective', 'containerDirective']);

export function remarkAviDirectives() {
  return (tree, file) => {
    const visit = (node) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        const replacement = transformDirective(child, file);
        if (replacement !== child) return replacement;
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

function transformDirective(node, file) {
  if (!DIRECTIVE_TYPES.has(node.type)) return node;
  if (node.type === 'containerDirective' && !sourceForNode(node, file).trimEnd().endsWith(':::')) {
    return { type: 'text', value: sourceForNode(node, file) };
  }

  const transformed = node.type === 'textDirective' && node.name === 'fileref'
    ? transformFileReference(node)
    : node.type === 'leafDirective' && node.name === 'avi-chart'
      ? transformChart(node)
      : node.type === 'leafDirective' && node.name === 'avi-copy'
        ? transformCopy(node)
        : node.type === 'leafDirective' && node.name === 'callout'
          ? transformHeader(node, 'callout')
          : node.type === 'leafDirective' && node.name === 'finding'
            ? transformHeader(node, 'finding')
            : node.type === 'leafDirective' && node.name === 'latex'
              ? transformSource(node, toString(node), 'avi-latex', { displayMode: false })
              : node.type === 'containerDirective' && node.name === 'avi-file-mention'
                ? transformFileMention(node, file)
                : node.type === 'containerDirective' && node.name === 'avi-diff'
                  ? transformCodeContainer(node, 'diff', 'avi-diff', {
                    title: boundedTitle(node.attributes?.title, 'Diff'),
                  })
                  : node.type === 'containerDirective' && node.name === 'mermaid-diagram'
                    ? transformCodeContainer(node, 'mermaid', 'avi-mermaid')
                    : node.type === 'containerDirective' && node.name === 'latex'
                      ? transformSource(node, sourceForChildren(node, file), 'avi-latex', { displayMode: true })
                      : null;

  if (transformed) return transformed;
  return { type: 'text', value: sourceForNode(node, file) };
}

function transformFileReference(node) {
  const reference = parseFileReference(node.attributes);
  if (!reference) return null;
  return withElement(node, 'avi-fileref', {
    path: reference.path,
    lineFrom: reference.lineFrom ?? undefined,
    lineTo: reference.lineTo ?? undefined,
  });
}

function transformChart(node) {
  const chartType = node.attributes?.type?.toLowerCase();
  const source = node.attributes?.data ?? node.attributes?.source;
  let data;
  try {
    data = JSON.parse(source);
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
      || (chartType === 'progress' && (!Number.isFinite(item.max) || item.max <= 0 || item.value > item.max))
    ))
  ) {
    return null;
  }

  const normalizedData = data.map((item) => ({
    label: item.label.trim(),
    value: item.value,
    ...(chartType === 'progress' ? { max: item.max } : {}),
  }));
  if (new Set(normalizedData.map((item) => item.label)).size !== normalizedData.length) return null;
  const title = boundedTitle(node.attributes?.title, chartType === 'progress' ? 'Progress' : 'Chart');
  if (!title) return null;
  return withElement(node, 'avi-chart', {
    chartType,
    title,
    chartData: JSON.stringify(normalizedData),
  });
}

function transformCopy(node) {
  const value = node.attributes?.value;
  if (!value) return null;
  return withElement(node, 'avi-copy', {
    label: node.attributes?.label?.trim() || 'Copyable text',
    value,
  });
}

function transformHeader(node, type) {
  const title = toString(node).trim();
  if (!title || title.length > MAX_TITLE_LENGTH) return null;
  if (type === 'callout') {
    const kind = node.attributes?.kind?.toLowerCase() || 'info';
    return CALLOUT_KINDS.has(kind) ? withElement(node, 'avi-callout', { kind, title }) : null;
  }
  const level = node.attributes?.level?.toUpperCase();
  return /^P[0-3]$/.test(level) ? withElement(node, 'avi-finding', { level, title }) : null;
}

function transformFileMention(node, file) {
  const reference = parseFileReference(node.attributes);
  const value = sourceForChildren(node, file).trim();
  if (!reference || !value || value.length > MAX_SOURCE_LENGTH) return null;
  const language = node.attributes?.language || /\.([\w]+)$/.exec(reference.path)?.[1] || 'text';
  return withElement(node, 'avi-file-mention', {
    path: reference.path,
    lineFrom: reference.lineFrom ?? undefined,
    lineTo: reference.lineTo ?? undefined,
    language: normalizeLanguage(language),
    value,
  });
}

function transformCodeContainer(node, language, hName, properties = {}) {
  const [code] = node.children ?? [];
  if (
    Object.values(properties).some((value) => value === null)
    || node.children?.length !== 1
    || code?.type !== 'code'
    || code.lang?.toLowerCase() !== language
    || !code.value.trim()
    || code.value.length > MAX_SOURCE_LENGTH
  ) {
    return null;
  }
  return withElement(node, hName, { ...properties, source: code.value });
}

function transformSource(node, value, hName, properties = {}) {
  const source = value.trim();
  if (!source || source.length > MAX_SOURCE_LENGTH) return null;
  return withElement(node, hName, { ...properties, source });
}

function boundedTitle(value, fallback) {
  const title = value?.trim() || fallback;
  return title.length <= MAX_TITLE_LENGTH ? title : null;
}

function parseFileReference(attributes = {}) {
  const path = attributes.path?.trim().replaceAll('\\', '/');
  const lineFromText = attributes['line-from'] ?? '';
  const lineToText = attributes['line-to'] ?? '';
  const lineFrom = /^\d+$/.test(lineFromText) && Number(lineFromText) > 0
    ? Number(lineFromText)
    : null;
  const lineTo = lineToText
    ? (/^\d+$/.test(lineToText) && Number(lineToText) > 0 ? Number(lineToText) : null)
    : lineFrom;
  if (
    (!path?.startsWith('./') && !path?.startsWith('../'))
    || (lineFromText && lineFrom === null)
    || (lineToText && (lineFrom === null || lineTo === null))
    || (lineFrom !== null && lineTo < lineFrom)
  ) {
    return null;
  }
  return { path, lineFrom, lineTo };
}

function normalizeLanguage(language) {
  const normalized = language.toLowerCase();
  return {
    cs: 'csharp',
    html: 'markup',
    js: 'javascript',
    md: 'markdown',
    ps1: 'powershell',
    sh: 'bash',
    ts: 'typescript',
    xml: 'markup',
  }[normalized] ?? normalized;
}

function withElement(node, hName, hProperties) {
  node.data = { ...node.data, hName, hProperties };
  return node;
}

function sourceForNode(node, file) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return Number.isInteger(start) && Number.isInteger(end)
    ? String(file.value).slice(start, end)
    : toString(node);
}

function sourceForChildren(node, file) {
  const start = node.children?.[0]?.position?.start?.offset;
  const end = node.children?.at(-1)?.position?.end?.offset;
  return Number.isInteger(start) && Number.isInteger(end)
    ? String(file.value).slice(start, end)
    : toString(node);
}
