const structuredUserMessageParsers = [
  {
    type: 'subagent-report',
    pattern: /^<subagent_report\b([^>]*)>\s*([\s\S]*?)\s*<\/subagent_report>$/,
    parse(attributes, body) {
      const threadId = attributeValue(attributes, 'thread_id');
      const title = attributeValue(attributes, 'title');
      if (!threadId || !title) return null;
      return { threadId, title, body };
    },
  },
  {
    type: 'cross-thread-message',
    pattern: /^<cross-message\b([^>]*)>\s*([\s\S]*?)\s*<\/cross-message>$/,
    parse(attributes, body) {
      const sourceThreadId = attributeValue(attributes, 'from_thread_id');
      if (!sourceThreadId) return null;
      return { sourceThreadId, body };
    },
  },
];

export function parseStructuredUserMessage(message) {
  if (message?.role !== 'user') return null;
  const content = (message.content ?? '').trim();

  for (const parser of structuredUserMessageParsers) {
    const envelope = parser.pattern.exec(content);
    if (!envelope) continue;
    const parsed = parser.parse(envelope[1], envelope[2].trim());
    if (parsed) return { id: message.id, type: parser.type, ...parsed };
  }

  return null;
}

export function groupAssistantTurns(messages) {
  const grouped = [];
  let turn = [];

  const flushTurn = () => {
    if (turn.length === 0) return;
    const finalAssistantIndex = turn.findLastIndex((message) => message.role === 'assistant');
    if (finalAssistantIndex < 0) {
      grouped.push(...turn.map((message) => ({ message, workedMessages: [] })));
      turn = [];
      return;
    }

    const finalAssistant = turn[finalAssistantIndex];
    const workedMessages = turn.filter((_, index) => index !== finalAssistantIndex);
    const workedStartedAt = turn.find((message) => message.role === 'assistant')?.createdAt;

    grouped.push({ message: finalAssistant, workedMessages, workedStartedAt });
    turn = [];
  };

  for (const message of messages) {
    const belongsToAssistantTurn = (
      message.role === 'assistant' || Boolean(parseStructuredUserMessage(message))
    );
    if (!belongsToAssistantTurn) {
      flushTurn();
      grouped.push({ message, workedMessages: [] });
      continue;
    }
    turn.push(message);
  }
  flushTurn();

  return grouped;
}

function attributeValue(attributes, name) {
  return new RegExp(`\\b${name}="([^"]+)"`).exec(attributes)?.[1] ?? null;
}
