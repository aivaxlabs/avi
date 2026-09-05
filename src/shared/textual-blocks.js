const textualBlockMarkers = [
  { type: 'assistant-answer', openTag: '<assistant-answer>', closeTag: '</assistant-answer>' },
  { type: 'thinking', openTag: '<thinking-group>', closeTag: '</thinking-group>' },
  { type: 'thinking', openTag: '<thinking-blocks>', closeTag: '</thinking-blocks>' },
  { type: 'thinking', openTag: '<thinking-block>', closeTag: '</thinking-block>' },
  { type: 'thinking', openTag: '<think>', closeTag: '</think>' },
  { type: 'thinking', openTag: '<tool>', closeTag: '</tool>' },
];

export function executionPlansFromTextualBlocks(content) {
  return [...String(content ?? '').matchAll(
    /<execution-plan>\s*([\s\S]*?\S)\s*<\/execution-plan>/gi,
  )].map((match) => match[1].trim());
}

export function answerTextFromTextualBlocks(content) {
  const source = String(content ?? '');
  const normalizedSource = source.toLowerCase();
  const answers = collectAssistantAnswers(source, normalizedSource);
  if (answers.length > 0) {
    return answers.at(-1).trim();
  }

  const turns = [];
  let cursor = 0;

  while (cursor < source.length) {
    const marker = findNextTextualBlockMarker(normalizedSource, cursor);
    if (!marker) {
      turns.push(source.slice(cursor));
      break;
    }

    turns.push(source.slice(cursor, marker.start));
    cursor = skipTextualBlockMarker(normalizedSource, marker);
  }

  return turns.findLast((turn) => turn.trim())?.trim() ?? '';
}

function collectAssistantAnswers(source, normalizedSource) {
  const answers = [];
  let cursor = 0;

  while (cursor < source.length) {
    const marker = findNextTextualBlockMarker(normalizedSource, cursor);
    if (!marker) break;

    if (marker.type === 'assistant-answer') {
      const valueStart = marker.start + marker.openTag.length;
      const valueEnd = findTag(normalizedSource, marker.closeTag, valueStart);
      answers.push(valueEnd >= 0 ? source.slice(valueStart, valueEnd) : source.slice(valueStart));
    }

    cursor = skipTextualBlockMarker(normalizedSource, marker);
  }

  return answers;
}

function findNextTextualBlockMarker(normalizedSource, start) {
  return textualBlockMarkers
    .map((marker) => ({
      ...marker,
      start: findTag(normalizedSource, marker.openTag, start),
    }))
    .filter((marker) => marker.start >= 0)
    .sort((a, b) => a.start - b.start)[0] ?? null;
}

function skipTextualBlockMarker(normalizedSource, marker) {
  const valueEnd = findTag(normalizedSource, marker.closeTag, marker.start + marker.openTag.length);
  return valueEnd >= 0 ? valueEnd + marker.closeTag.length : normalizedSource.length;
}

function findTag(normalizedSource, tag, start) {
  return normalizedSource.indexOf(tag, start);
}
