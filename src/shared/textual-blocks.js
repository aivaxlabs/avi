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
  const answers = collectAssistantAnswers(source);
  if (answers.length > 0) {
    return answers.at(-1).trim();
  }

  let output = '';
  let cursor = 0;

  while (cursor < source.length) {
    const marker = findNextTextualBlockMarker(source, cursor);
    if (!marker) {
      output += source.slice(cursor);
      break;
    }

    output += source.slice(cursor, marker.start);
    if (marker.type === 'assistant-answer') {
      const valueStart = marker.start + marker.openTag.length;
      const valueEnd = findTag(source, marker.closeTag, valueStart);
      output += valueEnd >= 0 ? source.slice(valueStart, valueEnd) : source.slice(valueStart);
    }

    cursor = skipTextualBlockMarker(source, marker);
  }

  return output.trim();
}

function collectAssistantAnswers(source) {
  const answers = [];
  let cursor = 0;

  while (cursor < source.length) {
    const marker = findNextTextualBlockMarker(source, cursor);
    if (!marker) break;

    if (marker.type === 'assistant-answer') {
      const valueStart = marker.start + marker.openTag.length;
      const valueEnd = findTag(source, marker.closeTag, valueStart);
      answers.push(valueEnd >= 0 ? source.slice(valueStart, valueEnd) : source.slice(valueStart));
    }

    cursor = skipTextualBlockMarker(source, marker);
  }

  return answers;
}

function findNextTextualBlockMarker(source, start) {
  return textualBlockMarkers
    .map((marker) => ({
      ...marker,
      start: findTag(source, marker.openTag, start),
    }))
    .filter((marker) => marker.start >= 0)
    .sort((a, b) => a.start - b.start)[0] ?? null;
}

function skipTextualBlockMarker(source, marker) {
  const valueEnd = findTag(source, marker.closeTag, marker.start + marker.openTag.length);
  return valueEnd >= 0 ? valueEnd + marker.closeTag.length : source.length;
}

function findTag(source, tag, start) {
  return source.toLowerCase().indexOf(tag.toLowerCase(), start);
}
