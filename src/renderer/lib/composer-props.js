export function areComposerPropsEqual(previous, next) {
  const allProps = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...allProps].every((property) => {
    if (['queuedMessages', 'steeredMessages'].includes(property)) {
      const previousMessages = previous[property] ?? [];
      const nextMessages = next[property] ?? [];
      return previousMessages.length === nextMessages.length
        && previousMessages.every((message, index) => message === nextMessages[index]);
    }
    if (property === 'editStats') {
      return previous[property] === next[property] || (
        previous[property]?.files === next[property]?.files
        && previous[property]?.additions === next[property]?.additions
        && previous[property]?.deletions === next[property]?.deletions
      );
    }
    if (property === 'subagents') {
      const previousSubagents = previous[property] ?? [];
      const nextSubagents = next[property] ?? [];
      return previousSubagents.length === nextSubagents.length
        && ['working', 'finished', 'failed'].every((status) => (
          previousSubagents.filter((subagent) => subagent.status === status).length
          === nextSubagents.filter((subagent) => subagent.status === status).length
        ));
    }
    return Object.is(previous[property], next[property]);
  });
}
