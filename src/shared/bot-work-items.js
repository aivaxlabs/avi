export function hasOpenBotUserAction(pendency) {
  if (pendency?.status !== 'open') return false;
  if (pendency.approval) return true;
  const messages = Array.isArray(pendency.messages) ? pendency.messages : [];
  return messages.at(-1)?.role === 'bot';
}
