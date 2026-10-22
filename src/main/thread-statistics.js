function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function percentiles(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const rank = (percentile) => sorted.length === 0
    ? null
    : sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
  return { p50: rank(0.5), p95: rank(0.95), p99: rank(0.99), samples: sorted.length };
}

export function buildThreadStatistics(messages = []) {
  const requests = [];
  const tokens = {
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  };
  const tools = { calls: 0, invocationErrors: 0, otherErrors: 0 };

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const usage = message.usage ?? {};
    const inputTokens = finite(usage.inputTokens);
    const outputTokens = finite(usage.outputTokens);
    tokens.input += inputTokens;
    tokens.cached += Math.min(inputTokens, finite(usage.cachedInputTokens));
    tokens.output += outputTokens;
    tokens.reasoning += Math.min(outputTokens, finite(usage.reasoningTokens));
    tokens.total += Number.isFinite(Number(usage.totalTokens))
      ? Number(usage.totalTokens)
      : inputTokens + outputTokens;

    if (Array.isArray(usage.requests)) {
      requests.push(...usage.requests);
    } else if (Number.isFinite(usage.latencyMs)) {
      // Responses recorded before per-request metrics only carry an aggregate latency, without a reliable throughput window.
      requests.push({ connectMs: null, firstTokenMs: usage.latencyMs, error: false });
    }

    for (const segment of message.segments ?? []) {
      if (segment.type !== 'tool-call') continue;
      tools.calls += 1;
      if (segment.status !== 'error' || segment.errorKind === 'interrupted') continue;
      if (segment.errorKind === 'invocation') tools.invocationErrors += 1;
      else tools.otherErrors += 1;
    }
  }

  return {
    latency: {
      firstToken: percentiles(requests.map((request) => request.firstTokenMs)),
      connection: percentiles(requests.map((request) => request.connectMs)),
    },
    tokensPerSecond: percentiles(requests
      .filter((request) => !request.error && request.outputTokens > 0 && request.streamMs > 0)
      .map((request) => request.outputTokens / (request.streamMs / 1000))),
    tokens: {
      ...tokens,
      cachedRatio: tokens.input > 0 ? tokens.cached / tokens.input : null,
      reasoningRatio: tokens.output > 0 ? tokens.reasoning / tokens.output : null,
    },
    requests: {
      count: requests.length,
      errors: requests.filter((request) => request.error).length,
    },
    tools,
  };
}
