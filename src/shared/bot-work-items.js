const closedBotWorkStates = new Set(['completed', 'cancelled']);

export function hasOpenBotUserAction(item) {
  return !closedBotWorkStates.has(item?.state) && Boolean(item?.attention || item?.approval);
}
