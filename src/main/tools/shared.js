export function isThreadWaitingForInput(chatRunner, conversationId) {
  return Boolean(
    chatRunner.getPendingQuestion?.(conversationId)
    || chatRunner.getPendingApprovals?.(conversationId)?.length,
  );
}
