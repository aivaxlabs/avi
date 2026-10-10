import { fileBase64JsonValue } from '../main/json-request-body.js';
import { applyCustomJson, prepareProviderInvocation } from '../main/provider-api.js';

const reasoningBudgets = { low: 1_024, medium: 4_096, high: 8_192, max: 32_768 };

function toContent(content) {
  if (!Array.isArray(content)) return content ? [{ type: 'text', text: String(content) }] : [];
  return content.map((item) => {
    if (item.type === 'text') return { type: 'text', text: item.text };
    const media = item.type === 'image_url' ? item.image_url : item.type === 'file' ? item.file : null;
    if (!media) return { type: 'text', text: `Previously referenced ${item.type} content is not supported by Claude Messages. Do not infer its contents.` };
    const type = item.type === 'image_url' ? 'image' : 'document';
    if (media.path) {
      const mime = media.mime ?? (type === 'image' ? 'image/png' : 'application/pdf');
      if (type === 'document' && mime !== 'application/pdf') throw new Error('Claude Messages file attachments must be PDF files.');
      try {
        return { type, source: { type: 'base64', media_type: mime, data: fileBase64JsonValue(media.path, mime, { dataUrl: false }) } };
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        return { type: 'text', text: `Previously referenced media is unavailable: ${media.path}. Do not infer its contents.` };
      }
    }
    const url = media.url ?? media.file_data;
    const inline = typeof url === 'string' && /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
    if (inline) {
      if (type === 'document' && inline[1] !== 'application/pdf') throw new Error('Claude Messages file attachments must be PDF files.');
      return { type, source: { type: 'base64', media_type: inline[1], data: inline[2] } };
    }
    if (media.file_id) return { type: 'text', text: 'Previously referenced provider-hosted file is unavailable to Claude Messages. Do not infer its contents.' };
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return { type, source: { type: 'url', url } };
    throw new Error('Claude Messages requires a local file, base64 data URL, or HTTP(S) media URL.');
  });
}

function toMessage(message, model) {
  if (message.role === 'tool') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: toContent(message.content) }] };
  }
  const saved = message[Symbol.for('avi.providerContinuation')];
  if (message.role === 'assistant' && saved?.model === model.id && saved.interface === model.interface && saved.items?.length) {
    return { role: 'assistant', content: saved.items };
  }
  return {
    role: message.role,
    content: [
      ...toContent(message.content),
      ...(message.tool_calls ?? []).map((call) => ({
        type: 'tool_use', id: call.id, name: call.function.name,
        input: JSON.parse(call.function.arguments || '{}'),
      })),
    ],
  };
}

export const messagesApi = {
  requiresTerminalEvent: true,
  async createBody({ provider, model, messages, tools = [], toolHistory = [], reasoningEffort, invocationContext }) {
    const { dynamicContext } = await prepareProviderInvocation(invocationContext);
    const system = dynamicContext ? [{ type: 'text', text: dynamicContext }] : [];
    const input = [];
    for (const message of messages) {
      if (['system', 'developer'].includes(message.role)) system.push(...toContent(message.content));
      else input.push(toMessage(message, model));
    }
    for (const round of toolHistory) {
      input.push({
        role: 'assistant',
        content: round.continuation?.length ? round.continuation : [
          ...toContent(round.assistantContent),
          ...round.toolCalls.map((call) => ({
            type: 'tool_use', id: call.callId, name: call.name,
            input: JSON.parse(call.argumentsText || '{}'),
          })),
        ],
      });
      if (round.results.length) input.push({
        role: 'user',
        content: round.results.map((result) => ({
          type: 'tool_result', tool_use_id: result.callId,
          content: [...toContent(result.output), ...toContent(result.mediaContent ?? [])],
        })),
      });
      input.push(...(round.messages ?? []).map((message) => toMessage(message, model)));
    }
    const merged = [];
    for (const message of input) {
      if (!message.content.length) continue;
      if (!['user', 'assistant'].includes(message.role)) throw new Error(`Unsupported Claude message role: ${message.role}`);
      const previous = merged.at(-1);
      if (previous?.role === message.role) previous.content.push(...message.content);
      else merged.push({ ...message, content: [...message.content] });
    }
    const maxTokens = model.context?.output || 64_000;
    return applyCustomJson({
      model: model.modelId,
      max_tokens: maxTokens,
      stream: true,
      ...(system.length ? { system } : {}),
      messages: merged,
      ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {}),
      ...(model.adaptiveThinking
        ? {
            thinking: { type: 'adaptive' },
            output_config: { effort: reasoningEffort && reasoningEffort !== 'none' ? reasoningEffort : model.defaultEffort ?? 'high' },
          }
        : reasoningBudgets[reasoningEffort]
          ? { thinking: { type: 'enabled', budget_tokens: Math.min(reasoningBudgets[reasoningEffort], maxTokens - 1) } }
          : {}),
    }, provider, model);
  },
  eventsFrom(payload, state) {
    const events = [];
    if (payload.type === 'message_start') {
      state.blocks = new Map();
      state.usage = payload.message?.usage ?? {};
      state.stopped = false;
    } else if (payload.type === 'content_block_start') {
      const block = structuredClone(payload.content_block);
      state.blocks?.set(payload.index, { block, argumentsText: '' });
      if (block.type === 'tool_use') events.push({
        type: 'tool-call', key: payload.index, callId: block.id, name: block.name,
        argumentsText: '', replaceArguments: true,
      });
      if (block.type === 'text' && block.text) events.push({ type: 'content', text: block.text });
      if (block.type === 'thinking' && block.thinking) events.push({ type: 'reasoning', text: block.thinking });
    } else if (payload.type === 'content_block_delta') {
      const entry = state.blocks?.get(payload.index);
      if (!entry) throw new Error('Claude returned a delta for an unknown content block.');
      const delta = payload.delta;
      if (delta.type === 'text_delta') {
        entry.block.text = (entry.block.text ?? '') + delta.text;
        events.push({ type: 'content', text: delta.text });
      } else if (delta.type === 'thinking_delta') {
        entry.block.thinking = (entry.block.thinking ?? '') + delta.thinking;
        events.push({ type: 'reasoning', text: delta.thinking });
      } else if (delta.type === 'signature_delta') {
        entry.block.signature = (entry.block.signature ?? '') + delta.signature;
      } else if (delta.type === 'input_json_delta') {
        entry.argumentsText += delta.partial_json;
        events.push({ type: 'tool-call', key: payload.index, argumentsDelta: delta.partial_json });
      }
    } else if (payload.type === 'content_block_stop') {
      const entry = state.blocks?.get(payload.index);
      if (!entry) throw new Error('Claude stopped an unknown content block.');
      if (entry.block.type === 'tool_use') {
        try {
          entry.block.input = entry.argumentsText.trim() ? JSON.parse(entry.argumentsText) : entry.block.input;
          if (!entry.block.input || typeof entry.block.input !== 'object' || Array.isArray(entry.block.input)) {
            throw new Error('Tool arguments must be an object.');
          }
        } catch {
          const error = new Error('Claude returned incomplete or invalid tool arguments.');
          error.code = 'incomplete_tool_call';
          throw error;
        }
        events.push({ type: 'tool-call', key: payload.index, argumentsText: JSON.stringify(entry.block.input ?? {}), replaceArguments: true });
      }
      entry.closed = true;
      events.push({ type: 'continuation-item', index: payload.index, item: entry.block });
      events.push({ type: 'item-complete', itemType: entry.block.type === 'tool_use' ? 'tool-call' : ['thinking', 'redacted_thinking'].includes(entry.block.type) ? 'reasoning' : 'content' });
    } else if (payload.type === 'message_delta') {
      state.usage = { ...state.usage, ...payload.usage };
      const usage = state.usage;
      const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      const output = usage.output_tokens ?? 0;
      events.push({ type: 'usage', usage: { inputTokens: input, cachedInputTokens: usage.cache_read_input_tokens ?? 0, outputTokens: output, totalTokens: input + output } });
      const reason = payload.delta?.stop_reason;
      state.stopped = ['end_turn', 'tool_use', 'stop_sequence'].includes(reason);
      if (reason && !state.stopped) events.push({ type: 'error', code: 'response_incomplete', message: `Claude stopped without completing the response (${reason}).` });
    } else if (payload.type === 'message_stop') {
      if (state.stopped && state.blocks?.size && [...state.blocks.values()].every((entry) => entry.closed)) {
        events.push({ type: 'stream-complete', status: 'message_stop' });
      }
      else events.push({ type: 'error', code: 'stream_incomplete', message: 'Claude ended without a completed message.' });
    } else if (payload.type === 'error' || payload.error) {
      const error = payload.error ?? payload;
      events.push({ type: 'error', code: error.type === 'overloaded_error' ? 'server_is_overloaded' : error.type ?? 'stream_error', message: error.message ?? 'Claude streaming failed.', ...(error.type === 'rate_limit_error' ? { status: 429 } : {}) });
    }
    return events;
  },
};
