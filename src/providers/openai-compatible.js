import { fileBase64JsonValue, sendJsonRequest } from '../main/json-request-body.js';
import { defineProvider, prepareProviderInvocation } from '../main/provider-api.js';

function mediaJsonValue(media, defaultMime) {
  return media?.path
    ? fileBase64JsonValue(media.path, media.mime ?? defaultMime)
    : media?.url;
}

function toResponsesContent(content) {
  return content.map((item) => {
    if (item.type === 'text') return { type: 'input_text', text: item.text };
    if (item.type === 'image_url') {
      return {
        type: 'input_image',
        image_url: mediaJsonValue(item.image_url, 'image/png'),
      };
    }
    if (item.type === 'video_url') {
      return {
        type: 'input_video',
        video_url: mediaJsonValue(item.video_url, 'video/mp4'),
      };
    }
    if (item.type === 'file') {
      return {
        type: 'input_file',
        filename: item.file?.filename,
        file_data: item.file?.file_data,
      };
    }
    return item;
  });
}

function toChatContent(content) {
  return content.map((item) => {
    const media = item[item.type];
    return ['image_url', 'video_url'].includes(item.type) && media?.path
      ? {
          type: item.type,
          [item.type]: {
            url: mediaJsonValue(media, item.type === 'image_url' ? 'image/png' : 'video/mp4'),
          },
        }
      : item;
  });
}

function toResponsesInput(message, model) {
  const providerContinuation = message[Symbol.for('avi.providerContinuation')];
  if (
    providerContinuation?.model === model.id
    && providerContinuation.interface === model.interface
    && Array.isArray(providerContinuation.items)
  ) return providerContinuation.items;

  if (message.role === 'tool') {
    return [{
      type: 'function_call_output',
      call_id: message.tool_call_id,
      output: message.content,
    }];
  }
  if (message.role === 'assistant' && message.tool_calls?.length) {
    const assistantText = [
      message.reasoning_content ? `<think>${message.reasoning_content}</think>` : '',
      message.content ?? '',
    ].filter(Boolean).join('');
    return [
      ...(assistantText
        ? [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: assistantText }],
          }]
        : []),
      ...message.tool_calls.map((toolCall) => ({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })),
    ];
  }

  const {
    reasoning_content: reasoningContent,
    ...inputMessage
  } = message;
  return [{
    ...inputMessage,
    content: Array.isArray(message.content)
      ? toResponsesContent(message.content)
      : reasoningContent
        ? `<think>${reasoningContent}</think>${message.content ?? ''}`
        : message.content,
  }];
}

const reasoningFormatField = {
  id: 'reasoningFormat',
  label: 'Reasoning format',
  type: 'select',
  default: 'default',
  description: 'Controls how the selected reasoning effort is mapped into the request body.',
  options: [
    { value: 'default', label: 'Default ($.reasoning_effort)' },
    { value: 'modern', label: 'Modern ($.reasoning.effort)' },
    { value: 'anthropic', label: 'Anthropic ($.reasoning.max_tokens)' },
    { value: 'qwen', label: 'Qwen ($.enable_thinking + $.thinking_budget)' },
  ],
};
const reasoningBudgets = {
  none: 0,
  minimal: 0,
  low: 512,
  medium: 1_516,
  high: 4_096,
  xhigh: 16_384,
  max: 32_768,
};

function serializeTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export const responsesApi = {
  requiresTerminalEvent: true,
  async createBody({
    provider,
    model,
    messages,
    reasoningEffort,
    tools,
    toolHistory,
    invocationContext,
  }) {
    const prepared = await prepareProviderInvocation(invocationContext);
    const serializedTools = serializeTools(tools);

    return {
      model: model.modelId,
      ...(prepared.dynamicContext ? { instructions: prepared.dynamicContext } : {}),
      input: [
        ...messages.flatMap((message) => toResponsesInput(message, model)),
        ...toolHistory.flatMap((round) => [
          ...(round.continuation ?? []),
          ...((round.reasoningContent || round.assistantContent)
            && !round.continuation?.some((item) => item.type === 'message')
            ? [{
                type: 'message',
                role: 'assistant',
                content: [{
                  type: 'output_text',
                  text: `${round.reasoningContent ? `<think>${round.reasoningContent}</think>` : ''}${round.assistantContent ?? ''}`,
                }],
              }]
            : []),
          ...round.toolCalls
            .filter((toolCall) => !round.continuation?.some((item) => (
              item.type === 'function_call' && item.call_id === toolCall.callId
            )))
            .map((toolCall) => ({
              type: 'function_call',
              call_id: toolCall.callId,
              name: toolCall.name,
              arguments: toolCall.argumentsText,
            })),
          ...round.results.flatMap((result) => [
            {
              type: 'function_call_output',
              call_id: result.callId,
              output: result.output,
            },
            ...(result.mediaContent?.length
              ? [{
                  type: 'message',
                  role: 'user',
                  content: toResponsesContent(result.mediaContent),
                }]
              : []),
          ]),
          ...(round.messages ?? []).map((message) => ({
            ...message,
            content: Array.isArray(message.content)
              ? toResponsesContent(message.content)
              : message.content,
          })),
        ]),
      ],
      ...(serializedTools.length > 0
        ? {
            tools: serializedTools.map((tool) => ({
              type: 'function',
              ...tool,
              strict: false,
            })),
          }
        : {}),
      stream: true,
      store: false,
      ...reasoningRequestFields(reasoningEffort, provider.reasoningFormat ?? 'modern'),
      ...(model.serviceTier ? { service_tier: model.serviceTier } : {}),
    };
  },
  eventsFrom(payload) {
    if (payload?.type === 'response.output_text.delta' && payload.delta) {
      return [{ type: 'content', text: payload.delta }];
    }
    if (
      [
        'response.reasoning_summary_text.delta',
        'response.reasoning_text.delta',
        'response.reasoning.delta',
      ].includes(payload?.type)
      && payload.delta
    ) {
      return [{ type: 'reasoning', text: payload.delta }];
    }
    if (payload?.type === 'response.output_item.added' && payload.item?.type === 'function_call') {
      return [{
        type: 'tool-call',
        key: payload.item.id ?? `response:${payload.output_index ?? 0}`,
        callId: payload.item.call_id ?? null,
        name: payload.item.name ?? null,
        argumentsText: payload.item.arguments ?? '',
        replaceArguments: true,
      }];
    }
    if (payload?.type === 'response.function_call_arguments.delta') {
      return [{
        type: 'tool-call',
        key: payload.item_id ?? `response:${payload.output_index ?? 0}`,
        argumentsDelta: payload.delta ?? '',
      }];
    }
    if (payload?.type === 'response.output_item.done') {
      const itemType = payload.item?.type === 'function_call'
        ? 'tool-call'
        : payload.item?.type === 'reasoning'
          ? 'reasoning'
          : 'content';
      return [
        ...(payload.item?.type === 'function_call'
          ? [{
              type: 'tool-call',
              key: payload.item.id ?? `response:${payload.output_index ?? 0}`,
              callId: payload.item.call_id ?? null,
              name: payload.item.name ?? null,
              argumentsText: payload.item.arguments ?? '',
              replaceArguments: true,
            }]
          : []),
        {
          type: 'continuation-item',
          index: payload.output_index,
          item: payload.item,
        },
        { type: 'item-complete', itemType },
      ];
    }
    if (payload?.type === 'response.function_call_arguments.done') {
      const item = payload.item ?? payload;
      return [{
        type: 'tool-call',
        key: item.id ?? payload.item_id ?? `response:${payload.output_index ?? 0}`,
        callId: item.call_id ?? null,
        name: item.name ?? null,
        argumentsText: item.arguments ?? payload.arguments ?? '',
        replaceArguments: true,
      }];
    }
    if (['response.completed', 'response.done', 'response.incomplete'].includes(payload?.type)) {
      const usage = payload.response?.usage;
      const events = Array.isArray(payload.response?.output)
        ? [{ type: 'continuation', items: payload.response.output }]
        : [];
      if (usage) {
        events.push({ type: 'usage', usage: normalizeUsage(usage) });
      }
      if (payload.type === 'response.incomplete') {
        events.push({
          type: 'error',
          code: 'response_incomplete',
          message:
            payload.response?.incomplete_details?.reason
            ?? 'The provider returned an incomplete response.',
        });
      } else {
        events.push({ type: 'stream-complete', status: payload.type });
      }
      return events;
    }
    if (payload?.type === 'response.failed' || payload?.type === 'error' || payload?.error) {
      const error = payload.response?.error ?? payload.error ?? payload;
      return [{
        type: 'error',
        code: error?.code ?? 'stream_error',
        message: error?.message ?? error?.error ?? 'The provider returned an error while streaming.',
        status: error?.status ?? error?.status_code ?? payload?.status,
      }];
    }
    return [];
  },
};

export const chatCompletionsApi = {
  async createBody({
    provider,
    model,
    messages,
    reasoningEffort,
    tools,
    toolHistory,
    invocationContext,
  }) {
    const prepared = await prepareProviderInvocation(invocationContext);
    const serializedTools = serializeTools(tools);

    return {
      model: model.modelId,
      messages: [
        ...(prepared.dynamicContext
          ? [{ role: 'system', content: prepared.dynamicContext }]
          : []),
        ...messages.map((message) => ({
          ...message,
          content: Array.isArray(message.content)
            ? toChatContent(message.content)
            : message.content,
        })),
        ...toolHistory.flatMap((round) => [
          {
            role: 'assistant',
            content: round.assistantContent || null,
            ...(round.reasoningContent ? { reasoning_content: round.reasoningContent } : {}),
            ...(round.toolCalls.length > 0
              ? {
                  tool_calls: round.toolCalls.map((toolCall) => ({
                    id: toolCall.callId,
                    type: 'function',
                    function: {
                      name: toolCall.name,
                      arguments: toolCall.argumentsText,
                    },
                  })),
                }
              : {}),
          },
          ...round.results.flatMap((result) => [
            {
              role: 'tool',
              tool_call_id: result.callId,
              content: result.output,
            },
            ...(result.mediaContent?.length
              ? [{ role: 'user', content: toChatContent(result.mediaContent) }]
              : []),
          ]),
          ...(round.messages ?? []).map((message) => ({
            ...message,
            content: Array.isArray(message.content)
              ? toChatContent(message.content)
              : message.content,
          })),
        ]),
      ],
      ...(serializedTools.length > 0
        ? {
            tools: serializedTools.map((tool) => ({
              type: 'function',
              function: {
                ...tool,
                strict: false,
              },
            })),
          }
        : {}),
      stream: true,
      stream_options: { include_usage: true },
      ...reasoningRequestFields(reasoningEffort, provider.reasoningFormat),
    };
  },
  eventsFrom(payload) {
    const events = [];

    if (payload?.error) {
      events.push({
        type: 'error',
        code: payload.error.code ?? 'stream_error',
        message: payload.error.message ?? payload.error.error ?? String(payload.error),
        status: payload.error.status ?? payload.error.status_code ?? payload.status,
      });
    }

    for (const choice of payload?.choices ?? []) {
      const delta = choice?.delta;
      if (!delta) continue;

      const reasoningDetails = Array.isArray(delta.reasoning_details)
        ? delta.reasoning_details
          .map((item) => item?.text ?? item?.summary ?? '')
          .filter(Boolean)
          .join('')
        : '';
      const reasoning = reasoningDetails || delta.reasoning || delta.reasoning_content || '';

      if (reasoning) {
        events.push({ type: 'reasoning', text: reasoning });
      }
      if (typeof delta.content === 'string' && delta.content) {
        events.push({ type: 'content', text: delta.content });
      }
      for (const toolCall of delta.tool_calls ?? []) {
        if (!Number.isInteger(toolCall.index) || toolCall.index < 0) {
          events.push({
            type: 'error',
            code: 'provider_error',
            message: 'The provider returned a tool call without a valid non-negative integer index.',
          });
          continue;
        }
        events.push({
          type: 'tool-call',
          key: `chat:${choice.index ?? 0}:${toolCall.index}`,
          callId: typeof toolCall.id === 'string' && toolCall.id.trim() ? toolCall.id : null,
          name: typeof toolCall.function?.name === 'string' && toolCall.function.name.trim()
            ? toolCall.function.name
            : null,
          argumentsDelta: toolCall.function?.arguments ?? '',
        });
      }
      if (choice.finish_reason === 'error') {
        events.push({
          type: 'error',
          code: 'stream_error',
          message: 'The provider returned an error while streaming.',
        });
      }
    }

    if (payload?.usage) {
      events.push({ type: 'usage', usage: normalizeUsage(payload.usage) });
    }

    return events;
  },
};

export const openAiCompatibleProviderTypes = [
  defineProvider({
    descriptor: {
      id: 'responses',
      name: 'OpenAI Compatible',
      description: 'Responses API',
      endpoint: '/v1/responses',
      icon: 'server',
      connection: 'custom',
      models: 'custom',
      fields: [reasoningFormatField],
    },
    ...responsesApi,
    request: (context) => requestOpenAiCompatible(context, '/v1/responses'),
  }),
  defineProvider({
    descriptor: {
      id: 'chat-completions',
      name: 'OpenAI Compatible',
      description: 'Chat completions API',
      endpoint: '/v1/chat/completions',
      icon: 'server',
      connection: 'custom',
      models: 'custom',
      fields: [reasoningFormatField],
    },
    ...chatCompletionsApi,
    request: (context) => requestOpenAiCompatible(context, '/v1/chat/completions'),
  }),
];

function reasoningRequestFields(reasoningEffort, format = 'default') {
  if (!reasoningEffort) return {};
  const budget = reasoningBudgets[reasoningEffort] ?? 0;

  return {
    default: { reasoning_effort: reasoningEffort },
    modern: { reasoning: { effort: reasoningEffort } },
    anthropic: { reasoning: { max_tokens: budget } },
    qwen: {
      enable_thinking: budget > 0,
      thinking_budget: budget,
    },
  }[format];
}

function requestOpenAiCompatible({ provider, body, signal }, interfacePath) {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith(interfacePath)
    ? baseUrl
    : baseUrl.endsWith('/v1')
      ? `${baseUrl}${interfacePath.slice(3)}`
      : `${baseUrl}${interfacePath}`;

  return sendJsonRequest(endpoint, {
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    value: body,
    signal,
  });
}

function normalizeUsage(usage) {
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens:
      usage.input_tokens_details?.cached_tokens
      ?? usage.prompt_tokens_details?.cached_tokens
      ?? 0,
    reasoningTokens:
      usage.output_tokens_details?.reasoning_tokens
      ?? usage.completion_tokens_details?.reasoning_tokens
      ?? 0,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
  };
}
