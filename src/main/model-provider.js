import { interceptToolSchemas } from './client-tools.js';
import { resolveDynamicContext } from './context-injection.js';

export const MODEL_PROVIDER_INTERFACES = Object.freeze([
  { id: 'chat-completions', path: '/v1/chat/completions' },
  { id: 'responses', path: '/v1/responses' },
]);

export const REASONING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

const interfacesById = {
  'chat-completions': {
    async createBody({
      model,
      messages,
      reasoningEffort,
      tools,
      toolHistory,
      invocationContext,
    }) {
      const dynamicContext = await resolveDynamicContext(invocationContext);

      return {
        model: model.modelId,
        messages: [
          ...(dynamicContext ? [{ role: 'system', content: dynamicContext }] : []),
          ...messages,
          ...toolHistory.flatMap((round) => [
            {
              role: 'assistant',
              content: round.assistantContent || null,
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
            ...round.results.map((result) => ({
              role: 'tool',
              tool_call_id: result.callId,
              content: result.output,
            })),
          ]),
        ],
        ...(tools.length > 0
          ? {
              tools: interceptToolSchemas(tools).map((tool) => ({
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
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      };
    },
    eventsFrom(payload) {
      const events = [];

      if (payload?.error) {
        events.push({
          type: 'error',
          code: payload.error.code ?? 'stream_error',
          message: payload.error.message ?? payload.error.error ?? String(payload.error),
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
        for (let toolIndex = 0; toolIndex < (delta.tool_calls?.length ?? 0); toolIndex += 1) {
          const toolCall = delta.tool_calls[toolIndex];
          events.push({
            type: 'tool-call',
            key: `chat:${choice.index ?? 0}:${toolCall.index ?? toolIndex}`,
            callId: toolCall.id ?? null,
            name: toolCall.function?.name ?? null,
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
        events.push({
          type: 'usage',
          usage: normalizeUsage(payload.usage),
        });
      }

      return events;
    },
  },
  responses: {
    async createBody({
      model,
      messages,
      reasoningEffort,
      tools,
      toolHistory,
      invocationContext,
    }) {
      const dynamicContext = await resolveDynamicContext(invocationContext);

      return {
        model: model.modelId,
        ...(dynamicContext ? { instructions: dynamicContext } : {}),
        input: [
          ...messages.map((message) => ({
            ...message,
            content: Array.isArray(message.content)
              ? message.content.map((item) => {
                  if (item.type === 'text') {
                    return { type: 'input_text', text: item.text };
                  }
                  if (item.type === 'image_url') {
                    return { type: 'input_image', image_url: item.image_url?.url };
                  }
                  if (item.type === 'file') {
                    return {
                      type: 'input_file',
                      filename: item.file?.filename,
                      file_data: item.file?.file_data,
                    };
                  }
                  return item;
                })
              : message.content,
          })),
          ...toolHistory.flatMap((round) => [
            ...round.responseItems,
            ...round.results.map((result) => ({
              type: 'function_call_output',
              call_id: result.callId,
              output: result.output,
            })),
          ]),
        ],
        ...(tools.length > 0
          ? {
              tools: interceptToolSchemas(tools).map((tool) => ({
                type: 'function',
                ...tool,
                strict: false,
              })),
            }
          : {}),
        stream: true,
        store: false,
        ...(model.reasoning.length > 0
          ? {
              reasoning: {
                summary: 'auto',
                ...(reasoningEffort ? { effort: reasoningEffort } : {}),
              },
            }
          : {}),
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
      if (
        payload?.type === 'response.function_call_arguments.done'
        || (payload?.type === 'response.output_item.done' && payload.item?.type === 'function_call')
      ) {
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
        const events = [];
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
        }
        return events;
      }
      if (payload?.type === 'response.failed' || payload?.type === 'error' || payload?.error) {
        const error = payload.response?.error ?? payload.error ?? payload;
        return [{
          type: 'error',
          code: error?.code ?? 'stream_error',
          message: error?.message ?? error?.error ?? 'The provider returned an error while streaming.',
        }];
      }
      return [];
    },
  },
};

export class ModelProvider {
  constructor(config) {
    this.config = normalizeProviderConfig(config);
    this.interface = interfacesById[this.config.interface];
  }

  listModels() {
    if (!this.config.enabled) return [];

    return this.config.models.map((model) => ({
      ...model,
      id: `${this.config.id}:${model.id}`,
      modelId: model.id,
      providerId: this.config.id,
      providerName: this.config.name,
      interface: this.config.interface,
    })).filter((model) => model.enabled);
  }

  async stream({
    model,
    messages,
    tools,
    toolHistory,
    reasoningEffort = null,
    invocationContext = {},
    signal,
    onEvent,
  }) {
    if (reasoningEffort && !model.reasoning.includes(reasoningEffort)) {
      throw new Error(`Reasoning effort "${reasoningEffort}" is not supported by ${model.name}.`);
    }

    const interfacePath = MODEL_PROVIDER_INTERFACES
      .find((item) => item.id === this.config.interface)
      .path;
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const endpoint = baseUrl.endsWith(interfacePath)
      ? baseUrl
      : baseUrl.endsWith('/v1')
        ? `${baseUrl}${interfacePath.slice(3)}`
        : `${baseUrl}${interfacePath}`;
    const body = await this.interface.createBody({
      model,
      messages,
      reasoningEffort,
      tools,
      toolHistory,
      invocationContext,
    });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(responseText || `${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error('The provider returned no streaming body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';
    let completedResponseItems = null;
    const responseItems = new Map();
    const toolCalls = new Map();

    while (true) {
      const { value, done } = await reader.read();
      buffer = (
        buffer + decoder.decode(value ?? new Uint8Array(), { stream: !done })
      ).replaceAll('\r\n', '\n');
      const blocks = buffer.split('\n\n');
      buffer = done ? '' : blocks.pop() ?? '';

      for (const block of blocks) {
        const payload = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
          .trim();
        if (!payload || payload === '[DONE]') continue;

        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          throw new Error('The provider returned an invalid SSE payload.');
        }

        if (json.type === 'response.output_item.done' && json.item) {
          responseItems.set(json.output_index ?? responseItems.size, json.item);
        }
        if (
          ['response.completed', 'response.done', 'response.incomplete'].includes(json.type)
          && Array.isArray(json.response?.output)
        ) {
          completedResponseItems = json.response.output;
        }

        for (const event of this.interface.eventsFrom(json)) {
          if (event.type === 'content') {
            assistantContent += event.text;
          }
          if (event.type === 'tool-call') {
            const key = event.key ?? event.callId;
            const existing = toolCalls.get(key) ?? {
              key,
              callId: null,
              name: null,
              argumentsText: '',
            };
            existing.callId = event.callId ?? existing.callId;
            existing.name = event.name ?? existing.name;
            existing.argumentsText = event.replaceArguments
              ? event.argumentsText
              : `${existing.argumentsText}${event.argumentsDelta ?? ''}`;
            toolCalls.set(key, existing);
          }
          onEvent(event);
          if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }

      if (done) break;
    }

    return {
      assistantContent,
      responseItems: completedResponseItems ?? [...responseItems.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item),
      toolCalls: [...toolCalls.values()],
    };
  }
}

export class ModelProviderRegistry {
  constructor(getProviders) {
    this.getProviders = getProviders;
  }

  listModels() {
    return this.getProviders()
      .flatMap((provider) => new ModelProvider(provider).listModels());
  }

  resolve(modelId) {
    for (const config of this.getProviders()) {
      const provider = new ModelProvider(config);
      const model = provider.listModels().find((item) => item.id === modelId);
      if (model) return { provider, model };
    }
    return null;
  }
}

export function normalizeProviderConfig(value) {
  const provider = value && typeof value === 'object' ? value : {};
  const interfaceId = String(provider.interface ?? '').trim();
  const name = String(provider.name ?? '').trim();
  const baseUrl = String(provider.baseUrl ?? '').trim().replace(/\/+$/, '');

  if (!name) {
    throw new Error('Provider name is required.');
  }
  if (!interfacesById[interfaceId]) {
    throw new Error('Choose a supported provider interface.');
  }
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error('Provider base URL must be a valid HTTP or HTTPS URL.');
  }

  const modelIds = new Set();
  const models = Array.isArray(provider.models)
    ? provider.models.map((model) => {
        const id = String(model?.id ?? '').trim();
        const modelName = String(model?.name ?? '').trim();
        if (!id || !modelName) {
          throw new Error('Every model requires an ID and a name.');
        }
        if (modelIds.has(id)) {
          throw new Error(`Model ID "${id}" is duplicated in this provider.`);
        }
        modelIds.add(id);

        const inputContext = model?.context?.input === '' || model?.context?.input == null
          ? null
          : Number(model.context.input);
        const outputContext = model?.context?.output === '' || model?.context?.output == null
          ? null
          : Number(model.context.output);
        if (
          (inputContext !== null && (!Number.isInteger(inputContext) || inputContext <= 0))
          || (outputContext !== null && (!Number.isInteger(outputContext) || outputContext <= 0))
        ) {
          throw new Error(`Context limits for "${modelName}" must be positive integers.`);
        }

        return {
          id,
          name: modelName,
          enabled: model?.enabled !== false,
          capabilities: {
            images: Boolean(model?.capabilities?.images),
            audio: Boolean(model?.capabilities?.audio),
          },
          context: {
            input: inputContext,
            output: outputContext,
          },
          reasoning: REASONING_EFFORTS.filter((effort) => model?.reasoning?.includes(effort)),
        };
      })
    : [];

  return {
    id: String(provider.id ?? '').trim() || crypto.randomUUID(),
    name,
    baseUrl,
    interface: interfaceId,
    apiKey: String(provider.apiKey ?? '').trim(),
    enabled: provider.enabled !== false,
    models,
  };
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
