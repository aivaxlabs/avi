export class StreamAccumulator {
  constructor({ segments = [], usage = null } = {}) {
    this.segments = segments.map((segment) => ({ ...segment }));
    this.usage = usage;
    this.error = null;
    this.nextSequence = Math.max(
      0,
      ...this.segments.map((segment) => Number(segment.sequence) || 0),
    ) + 1;
  }

  get content() {
    return this.segments
      .map((segment) => {
        if (segment.type === 'content') return segment.text;
        if (segment.type === 'reasoning') return `<think>${segment.text}</think>`;
        if (segment.type === 'tool-call') {
          return [
            '<tool>',
            `<toolname>${escapeTextualBlock(segment.name || 'tool')}</toolname>`,
            `<toolreason>${escapeTextualBlock(segment.invocationGoal || '')}</toolreason>`,
            '</tool>',
          ].join('');
        }
        if (segment.type === 'error') {
          const code = segment.code ? ` (${segment.code})` : '';
          const retry = segment.retryAttempt
            ? `\n\nRetry attempt ${segment.retryAttempt}${segment.maxAttempts
              ? `/${segment.maxAttempts}`
              : ''}`
            : '';
          return `\n\n**Streaming error${code}:** ${segment.message}${retry}`;
        }
        if (segment.type === 'retry') {
          const code = segment.code ? ` (${segment.code})` : '';
          const attempt = `${segment.attempt}${segment.maxAttempts
            ? `/${segment.maxAttempts}`
            : ''}`;
          return `\n\n**Streaming error${code}:** ${segment.message}\n\nRetry attempt ${attempt}`;
        }
        return '';
      })
      .join('');
  }

  apply(event) {
    if (event.type === 'usage') {
      const previous = this.usage ?? {};
      this.usage = {
        inputTokens: (previous.inputTokens ?? 0) + (event.usage.inputTokens ?? 0),
        outputTokens: (previous.outputTokens ?? 0) + (event.usage.outputTokens ?? 0),
        cachedInputTokens:
          (previous.cachedInputTokens ?? 0) + (event.usage.cachedInputTokens ?? 0),
        reasoningTokens:
          (previous.reasoningTokens ?? 0) + (event.usage.reasoningTokens ?? 0),
        totalTokens: (previous.totalTokens ?? 0) + (event.usage.totalTokens ?? 0),
      };
      return;
    }
    if (event.type === 'retry-clear') {
      this.segments = this.segments.filter((segment) => segment.type !== 'retry');
      return;
    }
    if (event.type === 'item-complete') {
      const last = this.segments.at(-1);
      if (['content', 'reasoning'].includes(last?.type) && last.status === 'streaming') {
        last.status = 'completed';
      }
      return;
    }
    if (event.type === 'retry') {
      const existing = this.segments.find((segment) => segment.type === 'retry');
      if (existing) {
        existing.code = event.code;
        existing.message = event.message;
        existing.attempt = event.attempt;
        existing.maxAttempts = event.maxAttempts;
        return;
      }
      const last = this.segments.at(-1);
      if (['running', 'streaming'].includes(last?.status)) {
        last.status = 'completed';
      }
      this.segments.push({
        id: `retry-${this.nextSequence}`,
        sequence: this.nextSequence,
        type: 'retry',
        code: event.code,
        message: event.message,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        status: 'streaming',
      });
      this.nextSequence += 1;
      return;
    }
    if (event.type === 'tool-call') {
      const last = this.segments.at(-1);
      if (last?.status === 'streaming') {
        last.status = 'completed';
      }

      const existing = this.segments.find(
        (segment) => segment.type === 'tool-call' && segment.key === event.key,
      );
      if (existing) {
        existing.callId = typeof event.callId === 'string' && event.callId.trim()
          ? event.callId
          : existing.callId;
        existing.name = typeof event.name === 'string' && event.name.trim()
          ? event.name
          : existing.name;
        existing.argumentsText = event.replaceArguments
          ? event.argumentsText
          : `${existing.argumentsText}${event.argumentsDelta ?? ''}`;
        existing.invocationGoal = event.invocationGoal ?? existing.invocationGoal;
        existing.requiresHumanApproval =
          event.requiresHumanApproval ?? existing.requiresHumanApproval;
        existing.isMcp = event.isMcp ?? existing.isMcp;
        return;
      }

      this.segments.push({
        id: `tool-call-${this.nextSequence}`,
        sequence: this.nextSequence,
        type: 'tool-call',
        key: event.key,
        callId: event.callId,
        name: event.name,
        argumentsText: event.argumentsText ?? event.argumentsDelta ?? '',
        invocationGoal: event.invocationGoal ?? '',
        requiresHumanApproval: event.requiresHumanApproval ?? false,
        isMcp: event.isMcp ?? false,
        status: 'running',
      });
      this.nextSequence += 1;
      return;
    }
    if (event.type === 'tool-result') {
      const toolCall = this.segments.find(
        (segment) => segment.type === 'tool-call' && segment.callId === event.callId,
      );
      if (toolCall) {
        toolCall.status = event.isError ? 'error' : 'completed';
        toolCall.resultText = event.output;
      }
      return;
    }
    if (event.type === 'error') {
      this.error = { code: event.code, message: event.message };
      const retry = this.segments.find((segment) => segment.type === 'retry');
      if (retry) {
        retry.type = 'error';
        retry.code = event.code;
        retry.message = event.message;
        retry.retryAttempt = event.retryAttempt ?? retry.attempt;
        retry.maxAttempts = event.maxAttempts ?? retry.maxAttempts;
        delete retry.attempt;
        retry.status = 'completed';
        return;
      }
      const last = this.segments.at(-1);
      if (['running', 'streaming'].includes(last?.status)) {
        last.status = 'completed';
      }
      this.segments.push({
        id: `error-${this.nextSequence}`,
        sequence: this.nextSequence,
        type: 'error',
        code: event.code,
        message: event.message,
        status: 'completed',
      });
      this.nextSequence += 1;
      return;
    }
    if (!['content', 'reasoning'].includes(event.type) || !event.text) return;

    const last = this.segments.at(-1);
    if (last?.type === event.type && last.status === 'streaming') {
      last.text += event.text;
      return;
    }
    if (last?.status === 'streaming') {
      last.status = 'completed';
    }
    this.segments.push({
      id: `${event.type}-${this.nextSequence}`,
      sequence: this.nextSequence,
      type: event.type,
      text: event.text,
      status: 'streaming',
    });
    this.nextSequence += 1;
  }

  finish() {
    for (const segment of this.segments) {
      if (['running', 'streaming'].includes(segment.status)) {
        segment.status = 'completed';
      }
    }
  }
}

function escapeTextualBlock(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
