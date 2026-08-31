export function findComposerInvocation(text, cursorPosition) {
  const match = text.slice(0, cursorPosition).match(/(?:^|\s)([/$@])([^\s]*)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    query: match[2],
    start: cursorPosition - match[1].length - match[2].length,
  };
}
