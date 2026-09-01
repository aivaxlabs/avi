export function projectMessageForClient(message) {
  if (!Array.isArray(message?.segments)) return message;
  return {
    ...message,
    segments: message.segments.map((segment) => {
      if (segment.type !== 'tool-call') return segment;
      const {
        argumentsText,
        resultText,
        mediaContent,
        ...summary
      } = segment;
      return {
        ...summary,
        conversationId: message.conversationId,
        messageId: message.id,
        detailsAvailable: true,
        hasArguments: Object.hasOwn(segment, 'argumentsText'),
        hasResult: Object.hasOwn(segment, 'resultText'),
        hasMediaContent: Array.isArray(mediaContent) && mediaContent.length > 0,
      };
    }),
  };
}

export function projectChatEventForClient(event) {
  return event.type === 'message' && event.message
    ? { ...event, message: projectMessageForClient(event.message) }
    : event;
}

