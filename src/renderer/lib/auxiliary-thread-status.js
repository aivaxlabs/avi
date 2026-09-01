const ignoredMessageStatuses = new Set(['queued', 'steered']);

export function updateAuxiliaryMessageStates(current, message, conversationIds = null) {
  if (
    !message?.conversationId
    || (conversationIds && !conversationIds.has(message.conversationId))
    || !['user', 'assistant'].includes(message.role)
    || ignoredMessageStatuses.has(message.status)
  ) {
    return current;
  }

  const state = `${message.role}:${message.status ?? ''}`;
  return current[message.conversationId] === state
    ? current
    : { ...current, [message.conversationId]: state };
}

export function deriveAuxiliaryThreadStatuses(
  previous,
  threads,
  running,
  semaphoreWaits,
  messageStates,
) {
  const sleepingIds = new Set(semaphoreWaits.map((wait) => wait.conversationId));
  const next = Object.fromEntries(threads.map((thread) => {
    const messageState = messageStates[thread.id]
      ?? `${thread.lastMessageRole ?? ''}:${thread.lastMessageStatus ?? ''}`;
    const status = sleepingIds.has(thread.id)
      ? 'sleeping'
      : running[thread.id]
        ? 'working'
        : messageState === 'assistant:completed'
          ? 'finished'
          : ['assistant:error', 'assistant:aborted', 'assistant:streaming'].includes(messageState)
            ? 'failed'
            : 'waiting';
    return [thread.id, status];
  }));

  return Object.keys(previous).length === threads.length
    && threads.every((thread) => previous[thread.id] === next[thread.id])
    ? previous
    : next;
}

export function deriveAuxiliaryThreadStatusList(previous, threads, statuses) {
  const next = threads.map((thread) => ({
    id: thread.id,
    status: statuses[thread.id] ?? 'waiting',
  }));
  return previous.length === next.length
    && previous.every((thread, index) => (
      thread.id === next[index].id && thread.status === next[index].status
    ))
    ? previous
    : next;
}
