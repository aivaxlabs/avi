export const MAX_PARALLEL_TOOL_CALLS = 4;

export async function mapToolCalls(toolCalls, execute) {
  const results = new Array(toolCalls.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(MAX_PARALLEL_TOOL_CALLS, toolCalls.length) },
    async () => {
      while (nextIndex < toolCalls.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await execute(toolCalls[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
