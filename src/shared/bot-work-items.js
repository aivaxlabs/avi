export const BOT_PENDENCY_COMPLETION_REASONS = Object.freeze({
  abandon: 'Abandon',
  duplicate: 'Duplicate',
  'already-worked': 'Already worked',
});

export function hasOpenBotUserAction(pendency) {
  if (pendency?.status !== 'open') return false;
  if (pendency.approval) return true;
  const messages = Array.isArray(pendency.messages) ? pendency.messages : [];
  const latest = messages.at(-1);
  return latest?.role === 'bot' && (latest.requiresUserResponse !== false || !latest.readAt);
}

export function getBotPendencyStatusLabel(pendency) {
  if (pendency.status === 'completed') return 'Completed';
  if (pendency.approval) return 'Needs you';
  const latest = pendency.messages.at(-1);
  if (latest?.role !== 'bot') return 'Waiting for bot';
  if (latest.requiresUserResponse !== false) return 'Needs you';
  return latest.readAt ? 'Read' : 'Unread';
}
