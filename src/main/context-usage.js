const CHARACTERS_PER_TOKEN = 4;
export const QUICK_COMPRESSION_MARKER = '[output truncated due to context compress - invoke this tool again]';

export function countSerializedCharacters(value) {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value)).length;
    } catch {
      return value.length;
    }
  }
  const serialized = JSON.stringify(value);
  return serialized?.length ?? 0;
}

export function countMessageContext(messages) {
  let messagesCharacters = 0;
  let toolResultCharacters = 0;
  let otherCharacters = 0;

  for (const message of messages) {
    if (message.role === 'tool') {
      toolResultCharacters += countSerializedCharacters({ ...message, content: '' });
      toolResultCharacters += countSerializedCharacters(message.content);
      continue;
    }

    const content = Array.isArray(message.content) ? message.content : [message.content];
    const textualContent = [];
    const otherContent = [];
    for (const item of content) {
      if (typeof item === 'string' || item?.type === 'text') textualContent.push(item);
      else if (item != null) otherContent.push(item);
    }
    messagesCharacters += countSerializedCharacters({
      ...message,
      content: Array.isArray(message.content) ? textualContent : message.content,
    });
    otherCharacters += countSerializedCharacters(otherContent);
  }

  return { messagesCharacters, toolResultCharacters, otherCharacters };
}

export function distributeContextUsage({ contextTokens, contextLimit, segments }) {
  const usedTokens = Math.max(0, Number(contextTokens) || 0);
  const usedCharacters = usedTokens * CHARACTERS_PER_TOKEN;
  const measuredCharacters = segments.reduce((total, segment) => (
    total + Math.max(0, Number(segment.characters) || 0)
  ), 0);
  const scale = measuredCharacters > usedCharacters && measuredCharacters > 0
    ? usedCharacters / measuredCharacters
    : 1;
  const distributed = segments.map((segment) => {
    const contextCharacters = (Number(segment.characters) || 0) * scale;
    return {
      ...segment,
      characters: Math.max(0, Number(segment.characters) || 0),
      contextCharacters,
      tokens: contextCharacters / CHARACTERS_PER_TOKEN,
      percent: usedCharacters > 0 ? contextCharacters / usedCharacters : 0,
    };
  });
  const knownCharacters = distributed.reduce((total, segment) => (
    total + segment.contextCharacters
  ), 0);
  const residualCharacters = Math.max(0, usedCharacters - knownCharacters);
  const suppliedOther = distributed.find((segment) => segment.id === 'other');
  const visibleSegments = distributed.filter((segment) => segment.id !== 'other');
  const otherCharacters = (suppliedOther?.contextCharacters ?? 0) + residualCharacters;

  return {
    tokens: usedTokens,
    limit: Number(contextLimit) > 0 ? Number(contextLimit) : null,
    measuredCharacters,
    usedCharacters,
    segments: [
      ...visibleSegments,
      {
        ...suppliedOther,
        id: 'other',
        label: 'Other',
        characters: (suppliedOther?.characters ?? 0) + residualCharacters,
        contextCharacters: otherCharacters,
        tokens: otherCharacters / CHARACTERS_PER_TOKEN,
        percent: usedCharacters > 0 ? otherCharacters / usedCharacters : 0,
      },
    ],
  };
}

export function compactOldToolResults(messages, {
  checkpointMessageId = null,
  recentTurns = 4,
  marker = QUICK_COMPRESSION_MARKER,
} = {}) {
  const checkpointIndex = checkpointMessageId
    ? messages.findIndex((message) => message.id === checkpointMessageId)
    : -1;
  const activeMessages = messages.slice(checkpointIndex + 1);
  const userIndexes = activeMessages.flatMap((message, index) => (
    message.role === 'user' ? [index] : []
  ));
  const protectedStart = userIndexes.length >= recentTurns
    ? userIndexes.at(-recentTurns)
    : 0;
  let replacedResults = 0;
  let charactersRemoved = 0;

  const updates = activeMessages.slice(0, protectedStart).flatMap((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.segments)) return [];
    let changed = false;
    const segments = message.segments.flatMap((segment) => {
      if (segment.type === 'provider-continuation') {
        changed = true;
        charactersRemoved += countSerializedCharacters(segment);
        return [];
      }
      if (segment.type !== 'tool-call' || segment.resultText === undefined) return [segment];
      if (segment.resultText === marker && !segment.mediaContent?.length) return [segment];
      changed = true;
      replacedResults += 1;
      charactersRemoved += Math.max(0, countSerializedCharacters(segment.resultText) - marker.length);
      charactersRemoved += countSerializedCharacters(segment.mediaContent ?? []);
      const next = { ...segment, resultText: marker };
      delete next.mediaContent;
      return [next];
    });
    return changed ? [{ id: message.id, segments }] : [];
  });

  return { updates, replacedResults, charactersRemoved };
}
