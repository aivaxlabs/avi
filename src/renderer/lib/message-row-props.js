export function areMessageRowPropsEqual(previous, next) {
  const allProps = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...allProps].every((property) => {
    if (property === 'workedMessages') {
      const previousMessages = previous[property] ?? [];
      const nextMessages = next[property] ?? [];
      return previousMessages.length === nextMessages.length
        && previousMessages.every((message, index) => message === nextMessages[index]);
    }
    return Object.is(previous[property], next[property]);
  });
}
