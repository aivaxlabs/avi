import { getConversation } from '../database.js';

export function compactionContextMessage(message) {
  const continuation = message[Symbol.for('avi.providerContinuation')]?.items ?? [];
  const content = message.content || continuation
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' || part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
  const toolCalls = new Map((message.tool_calls ?? []).map((call) => [call.id, call]));
  for (const item of continuation) {
    if (item.type === 'function_call' && !toolCalls.has(item.call_id)) {
      toolCalls.set(item.call_id, {
        id: item.call_id,
        function: { name: item.name, arguments: item.arguments ?? '' },
      });
    }
  }
  return {
    role: message.role,
    content: Array.isArray(content) ? content.flatMap((part) => {
      if (part.type === 'text') return [{ type: 'text', text: part.text }];
      if (part.type === 'image_url' || part.type === 'video_url') {
        const media = part[part.type];
        return [{ type: part.type, [part.type]: {
          ...(media.url !== undefined ? { url: media.url } : {}),
          ...(media.path !== undefined ? { path: media.path, mime: media.mime } : {}),
          ...(media.detail !== undefined ? { detail: media.detail } : {}),
        } }];
      }
      if (part.type === 'input_audio') return [{ type: 'input_audio', input_audio: {
        data: part.input_audio.data,
        format: part.input_audio.format,
        ...(part.input_audio.path !== undefined ? { path: part.input_audio.path, mime: part.input_audio.mime } : {}),
      } }];
      if (part.type === 'file') return [{ type: 'file', file: {
        ...(part.file.filename !== undefined ? { filename: part.file.filename } : {}),
        ...(part.file.file_data !== undefined ? { file_data: part.file.file_data } : {}),
        ...(part.file.file_id !== undefined ? { file_id: part.file.file_id } : {}),
        ...(part.file.path !== undefined ? { path: part.file.path, mime: part.file.mime } : {}),
      } }];
      return [];
    }) : content ?? null,
    ...(message.role === 'tool' ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.role === 'assistant' && toolCalls.size > 0 ? {
      tool_calls: [...toolCalls.values()].map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.function.name, arguments: call.function.arguments ?? '' },
      })),
    } : {}),
  };
}

export function modelMessagesToToolHistory(messages, sourceMessages, model) {
  const rounds = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      const callIds = new Set((message.tool_calls ?? []).map((call) => call.id));
      const sourceMessage = sourceMessages.find((candidate) => (
        candidate.role === 'assistant'
        && candidate.segments.some((segment) => (
          segment.type === 'tool-call' && callIds.has(segment.callId)
        ))
      ));
      const continuation = message[Symbol.for('avi.providerContinuation')];
      rounds.push({
        assistantContent: message.content ?? '',
        reasoningContent: message.reasoning_content ?? '',
        continuation: continuation?.model === model.id
          && continuation.interface === model.interface
          && Array.isArray(continuation.items)
          ? continuation.items
          : [],
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          key: sourceMessage?.segments.find((segment) => (
            segment.type === 'tool-call' && segment.callId === call.id
          ))?.key,
          callId: call.id,
          name: call.function.name,
          argumentsText: call.function.arguments ?? '',
        })),
        results: [],
        messages: [],
        sourceMessageId: sourceMessage?.id ?? null,
      });
    } else {
      const round = rounds.at(-1);
      if (message.role === 'tool' && round?.toolCalls.some((call) => (
        call.callId === message.tool_call_id
      ))) {
        round.results.push({
          callId: message.tool_call_id,
          output: message.content,
          isError: sourceMessages.some((source) => source.segments?.some((segment) => (
            segment.type === 'tool-call'
            && segment.callId === message.tool_call_id
            && segment.status === 'error'
          ))),
        });
      } else if (round) {
        round.messages.push(message);
      }
    }
  }
  return rounds;
}

export function compactionInFlightMessages(toolHistory, streamingSegments) {
  const streamingRound = { assistantContent: '', toolCalls: [], results: [], continuation: [] };
  for (const segment of streamingSegments) {
    if (segment.type === 'content') streamingRound.assistantContent += segment.text ?? '';
    if (segment.type === 'provider-continuation') streamingRound.continuation.push(...(segment.items ?? []));
    if (segment.type === 'tool-call' && segment.callId && segment.name) {
      streamingRound.toolCalls.push(segment);
      if (segment.resultText !== undefined) {
        streamingRound.results.push({
          callId: segment.callId,
          output: segment.resultText ?? '',
          ...(segment.mediaContent?.length ? { mediaContent: segment.mediaContent } : {}),
        });
      }
    }
  }
  const rounds = [...toolHistory, ...(streamingSegments.length > 0 ? [streamingRound] : [])];
  const messages = [];
  const emittedCallIds = new Set();
  for (const round of rounds) {
    const resultCallIds = new Set(round.results.map((result) => result.callId));
    const assistantMessage = compactionContextMessage({
      role: 'assistant',
      content: round.assistantContent,
      tool_calls: round.toolCalls.map((call) => ({
        id: call.callId,
        function: { name: call.name, arguments: call.argumentsText ?? '' },
      })),
      [Symbol.for('avi.providerContinuation')]: { items: round.continuation ?? [] },
    });
    const toolCalls = (assistantMessage.tool_calls ?? []).filter((call) => {
      if (!call.id || !resultCallIds.has(call.id) || emittedCallIds.has(call.id)) return false;
      emittedCallIds.add(call.id);
      return true;
    });
    const roundCallIds = new Set(toolCalls.map((call) => call.id));
    if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
    else delete assistantMessage.tool_calls;
    if (assistantMessage.content || toolCalls.length > 0) messages.push(assistantMessage);
    const mediaMessages = [];
    for (const result of round.results) {
      if (!roundCallIds.delete(result.callId)) continue;
      messages.push({
        role: 'tool',
        tool_call_id: result.callId,
        content: result.output ?? '',
      });
      if (result.mediaContent?.length) {
        mediaMessages.push(compactionContextMessage({ role: 'user', content: result.mediaContent }));
      }
    }
    messages.push(...mediaMessages);
    for (const extraMessage of round.messages ?? []) {
      messages.push(compactionContextMessage(extraMessage));
    }
  }
  return messages;
}

export function isContextLengthError(error) {
  const errorText = `${error?.code ?? ''} ${
    error instanceof Error ? error.message : String(error)
  }`.toLowerCase();
  return error?.status >= 400
    && error.status <= 499
    && errorText.includes('context')
    && (errorText.includes('length') || errorText.includes('window'));
}

export function traceContext(conversationId, selection, details = {}) {
  const conversation = getConversation(conversationId);
  return {
    thread_id: conversationId,
    parent_thread_id: conversation?.parentConversationId,
    side_chat: conversation?.isSideChat,
    subagent: conversation?.isSubagent,
    provider_id: selection?.model.providerId,
    provider: selection?.model.providerName,
    model: selection?.model.modelId,
    interface: selection?.model.interface,
    ...details,
  };
}
