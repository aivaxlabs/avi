export function canRetryAssistantMessage(message, lastAssistantMessage, isRunning) {
  return message.id === lastAssistantMessage?.id
    && message.status === 'completed'
    && !isRunning;
}

export function canResumeAssistantMessage(message, lastAssistantMessage, isRunning) {
  return message.id === lastAssistantMessage?.id
    && ['error', 'aborted', 'streaming'].includes(message.status)
    && !message.stoppedByUser
    && !isRunning;
}
