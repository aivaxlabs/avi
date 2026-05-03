export class StreamAccumulator {
  constructor() {
    this.segments = [];
    this.status = 'streaming';
    this.usage = null;
    this.error = null;
    this.nextSeq = 1;
    this.parser = new TextualBlocksParser();
  }

  get content() {
    return this.segments
      .filter((segment) => segment.type === 'content')
      .map((segment) => segment.text)
      .join('');
  }

  apply(event) {
    if (event.type === 'content') {
      this.appendText('content', event.text, event.source);
    } else if (event.type === 'reasoning') {
      this.appendText('reasoning', event.text, event.source);
    } else if (event.type === 'tool') {
      this.completeOpenText();
      this.upsertParsedTool(event);
    } else if (event.type === 'model-tool') {
      this.upsertModelTool(event);
    } else if (event.type === 'server-tool') {
      this.upsertServerTool(event);
    } else if (event.type === 'usage') {
      this.usage = { ...(this.usage ?? {}), ...event.usage };
    } else if (event.type === 'finish') {
      this.completeOpenText();
    } else if (event.type === 'error') {
      this.status = 'errored';
      this.error = { code: event.code, message: event.message };
      this.completeOpenText();
      this.push({
        type: 'error',
        code: event.code,
        message: event.message,
        status: 'completed',
      });
    }
  }

  feedContent(text) {
    for (const event of this.parser.feed(text)) {
      this.apply(event);
    }
  }

  finish(finalStatus = 'completed') {
    for (const event of this.parser.finish()) {
      this.apply(event);
    }
    this.status = finalStatus;
    this.completeOpenText();
  }

  appendText(type, text, source = 'stream') {
    if (!text) return;
    this.status = 'streaming';
    const last = this.segments.at(-1);
    if (last?.type === type && last.status === 'streaming' && last.source === source) {
      last.text += text;
      return;
    }
    this.completeOpenText();
    this.push({ type, text, source, status: 'streaming' });
  }

  upsertModelTool(event) {
    this.completeOpenText();
    const existing = this.segments.find(
      (segment) => segment.type === 'tool-call'
        && segment.choiceIndex === event.choiceIndex
        && segment.toolIndex === event.toolIndex,
    );
    if (existing) {
      existing.name = event.name ?? existing.name;
      existing.argumentsText = `${existing.argumentsText ?? ''}${event.argumentsText ?? ''}`;
      existing.status = 'running';
      return;
    }
    this.push({
      type: 'tool-call',
      callId: event.callId,
      choiceIndex: event.choiceIndex,
      toolIndex: event.toolIndex,
      toolType: event.toolType,
      name: event.name,
      argumentsText: event.argumentsText ?? '',
      status: 'running',
    });
  }

  upsertServerTool(event) {
    this.completeOpenText();
    const existing = this.segments.find(
      (segment) => segment.type === 'server-tool' && segment.serverToolId === event.id,
    );
    if (existing) {
      existing.name = event.name || existing.name;
      existing.reason = event.reason || existing.reason;
      existing.state = event.state || existing.state;
      existing.contentsText = event.contentsText || existing.contentsText;
      existing.resultText = event.resultText ?? existing.resultText;
      existing.error = event.error ?? existing.error;
      return;
    }
    this.push({
      type: 'server-tool',
      serverToolId: event.id,
      name: event.name,
      reason: event.reason,
      state: event.state,
      contentsText: event.contentsText,
      resultText: event.resultText,
      error: event.error,
      status: 'running',
    });
  }

  upsertParsedTool(event) {
    const existing = this.segments.findLast(
      (segment) =>
        (segment.type === 'tool' || segment.type === 'server-tool') &&
        segment.name === event.name &&
        normalizeToolText(segment.reason || segment.contentsText) === normalizeToolText(event.reason),
    );
    if (existing) return;

    this.push({
      type: 'tool',
      name: event.name,
      reason: event.reason,
      status: 'completed',
    });
  }

  completeOpenText() {
    const last = this.segments.at(-1);
    if (last && (last.type === 'content' || last.type === 'reasoning') && last.status === 'streaming') {
      last.status = 'completed';
    }
  }

  push(segment) {
    this.segments.push({
      id: `${segment.type}-${this.nextSeq}`,
      seq: this.nextSeq,
      ...segment,
    });
    this.nextSeq += 1;
  }
}

export function eventsFromSsePayload(payload, accumulator) {
  let json;
  try {
    json = JSON.parse(payload);
  } catch {
    return [{ type: 'error', code: 'invalid_sse_json', message: 'Received an invalid streaming payload.' }];
  }

  const events = [];
  const servertool = objectOrNull(json.servertool);
  if (servertool) {
    events.push({
      type: 'server-tool',
      name: stringValue(servertool.name),
      id: stringValue(servertool.id),
      state: stringValue(servertool.state),
      reason: stringValue(servertool.reason ?? servertool.toolreason),
      contentsText: stringValue(servertool.contents),
      resultText: nullableString(servertool.result) ?? nullableString(servertool.resultText),
      error: objectOrNull(servertool.error),
    });
  }

  if (Array.isArray(json.choices)) {
    for (const choice of json.choices) {
      events.push(...eventsFromChoice(choice, accumulator));
    }
  }

  if (objectOrNull(json.usage)) {
    events.push({ type: 'usage', usage: json.usage });
  }

  if (json.error) {
    const error = objectOrNull(json.error);
    events.push({
      type: 'error',
      code: stringValue(error?.code, 'stream_error'),
      message: nullableString(error?.message) ?? nullableString(error?.error) ?? String(json.error),
    });
  }

  return events;
}

function eventsFromChoice(choice, accumulator) {
  if (!choice || typeof choice !== 'object') return [];
  const events = [];
  const choiceIndex = numberValue(choice.index);
  const delta = objectOrNull(choice.delta);

  if (delta) {
    if (typeof delta.reasoning === 'string' && delta.reasoning) {
      events.push({ type: 'reasoning', text: delta.reasoning, source: 'delta.reasoning' });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (let index = 0; index < delta.tool_calls.length; index += 1) {
        const toolCall = delta.tool_calls[index];
        const fn = objectOrNull(toolCall?.function);
        events.push({
          type: 'model-tool',
          choiceIndex,
          toolIndex: numberValue(toolCall?.index, index),
          callId: nullableString(toolCall?.id),
          toolType: stringValue(toolCall?.type, 'function'),
          name: nullableString(fn?.name),
          argumentsText: stringValue(fn?.arguments),
        });
      }
    }

    if (typeof delta.content === 'string' && delta.content) {
      accumulator.feedContent(delta.content);
    }
  }

  if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
    events.push({ type: 'finish', reason: choice.finish_reason });
  }

  return events;
}

class TextualBlocksParser {
  constructor() {
    this.buffer = '';
    this.mode = 'content';
  }

  feed(text) {
    this.buffer += text;
    const events = [];

    while (this.buffer) {
      if (this.mode === 'reasoning') {
        const close = firstMatch(this.buffer, ['</think>', '</thinking>']);
        if (!close) {
          const keep = partialSuffixLength(this.buffer, ['</think>', '</thinking>']);
          const ready = this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          if (ready) events.push({ type: 'reasoning', text: ready, source: 'thinking_block' });
          break;
        }
        const textBefore = this.buffer.slice(0, close.index);
        if (textBefore) events.push({ type: 'reasoning', text: textBefore, source: 'thinking_block' });
        this.buffer = this.buffer.slice(close.index + close.tag.length);
        this.mode = 'content';
        continue;
      }

      if (this.mode === 'tool') {
        const close = this.buffer.indexOf('</tool>');
        if (close === -1) break;
        const toolBody = this.buffer.slice(0, close);
        events.push(parseToolBlock(toolBody));
        this.buffer = this.buffer.slice(close + '</tool>'.length);
        this.mode = 'content';
        continue;
      }

      const next = firstMatch(this.buffer, [
        '<thinking-group>',
        '</thinking-group>',
        '<think>',
        '<thinking>',
        '<tool>',
      ]);
      if (!next) {
        const keep = partialSuffixLength(this.buffer, [
          '<thinking-group>',
          '</thinking-group>',
          '<think>',
          '<thinking>',
          '<tool>',
        ]);
        const ready = this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        if (ready) events.push({ type: 'content', text: ready, source: 'textual_blocks' });
        break;
      }

      const beforeTag = this.buffer.slice(0, next.index);
      if (beforeTag) events.push({ type: 'content', text: beforeTag, source: 'textual_blocks' });
      this.buffer = this.buffer.slice(next.index + next.tag.length);

      if (next.tag === '<think>' || next.tag === '<thinking>') {
        this.mode = 'reasoning';
      } else if (next.tag === '<tool>') {
        this.mode = 'tool';
      }
    }

    return events;
  }

  finish() {
    if (!this.buffer) return [];
    const text = this.buffer;
    this.buffer = '';
    if (this.mode === 'reasoning') {
      this.mode = 'content';
      return [{ type: 'reasoning', text, source: 'thinking_block' }];
    }
    if (this.mode === 'tool') {
      this.mode = 'content';
      return [parseToolBlock(text)];
    }
    return [{ type: 'content', text, source: 'textual_blocks' }];
  }
}

function parseToolBlock(body) {
  const metadata = parseToolMetadata(body);
  return {
    type: 'tool',
    name: metadata.command || tagContent(body, 'toolname') || 'tool',
    reason: metadata.toolReason || tagContent(body, 'toolreason') || body.replace(/<[^>]+>/g, '').trim(),
  };
}

function parseToolMetadata(body) {
  const stripped = body.replace(/<[^>]+>/g, '').trim();
  if (!stripped.startsWith('{')) return {};

  try {
    const json = JSON.parse(stripped);
    return {
      command: stringValue(json.command),
      toolReason: stringValue(json._tool_reason ?? json.tool_reason ?? json.reason),
    };
  } catch {
    return {};
  }
}

function tagContent(body, tag) {
  const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function firstMatch(buffer, tags) {
  let best = null;
  for (const tag of tags) {
    const index = buffer.indexOf(tag);
    if (index === -1) continue;
    if (!best || index < best.index) best = { index, tag };
  }
  return best;
}

function partialSuffixLength(buffer, tags) {
  let keep = 0;
  for (const tag of tags) {
    for (let i = 1; i < tag.length; i += 1) {
      if (buffer.endsWith(tag.slice(0, i)) && i > keep) keep = i;
    }
  }
  return keep;
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value, fallback = 0) {
  return typeof value === 'number' ? value : fallback;
}

function normalizeToolText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
