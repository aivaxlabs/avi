import { randomUUID } from 'node:crypto';
import { REASONING_EFFORTS } from './provider-api.js';
import { traceError, traceVerbose } from './trace-log.js';

const EMPTY_PROVIDER_CONTRIBUTIONS = Object.freeze({
  models: Object.freeze([]),
  tools: Object.freeze([]),
  auxiliaryPanels: Object.freeze([]),
  usageProviders: Object.freeze([]),
});
const SERVER_CONNECT_TIMEOUT_MS = 30_000;
const NORMAL_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000];
const GOAL_RETRY_DELAYS_MS = [1_000, 4_000, 8_000, 30_000, 60_000, 5 * 60_000];

export class ModelProvider {
  constructor(config, implementation, services) {
    this.config = config;
    this.implementation = implementation;
    this.services = services;
  }

  listModels() {
    if (!this.config.enabled) return [];

    const contributedModels = this.getContributions().models;
    const configuredModelIds = new Set(this.config.models.map((model) => model.id));
    const models = [
      ...contributedModels.filter((model) => !configuredModelIds.has(model.id)),
      ...this.config.models,
    ];

    return models.map((model) => ({
      ...model,
      id: `${this.config.id}:${model.id}`,
      modelId: model.modelId ?? model.id,
      providerId: this.config.id,
      providerName: this.config.name,
      interface: this.config.interface,
      endpoint: this.implementation.descriptor.endpoint,
    })).filter((model) => model.enabled !== false);
  }

  getContributions(context = {}) {
    if (!this.config.enabled || typeof this.implementation.getContributions !== 'function') {
      return EMPTY_PROVIDER_CONTRIBUTIONS;
    }

    const contributions = this.implementation.getContributions({
      ...context,
      provider: this.config,
      services: this.services,
    });

    return {
      models: Array.isArray(contributions?.models) ? contributions.models : [],
      tools: Array.isArray(contributions?.tools)
        ? [...new Map(contributions.tools.map((tool) => [tool?.name, tool])).values()]
        : [],
      auxiliaryPanels: Array.isArray(contributions?.auxiliaryPanels)
        ? contributions.auxiliaryPanels
        : [],
      usageProviders: Array.isArray(contributions?.usageProviders)
        ? contributions.usageProviders
        : [],
    };
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

    const body = await this.implementation.createBody({
      provider: this.config,
      model,
      messages,
      reasoningEffort,
      tools,
      toolHistory,
      invocationContext,
    });
    const goalMode = invocationContext.workMode === 'goal';
    const retryDelays = goalMode ? GOAL_RETRY_DELAYS_MS : NORMAL_RETRY_DELAYS_MS;
    const maxAttempts = goalMode ? Infinity : retryDelays.length + 1;
    let assistantContent = '';
    let completedContinuation = null;
    const continuationItems = new Map();
    const toolCalls = new Map();
    let retryVisible = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      const attemptController = new AbortController();
      const attemptSignal = AbortSignal.any([signal, attemptController.signal]);
      let connectTimedOut = false;
      let response;
      let retryError = null;
      const connectTimeout = setTimeout(() => {
        connectTimedOut = true;
        attemptController.abort(new Error('The server did not respond within 30 seconds.'));
      }, SERVER_CONNECT_TIMEOUT_MS);
      traceVerbose('provider.attempt-started', {
        provider_id: this.config.id,
        model: model.modelId,
        attempt,
      });

      try {
        response = await this.implementation.request({
          provider: this.config,
          model,
          body,
          signal: attemptSignal,
          invocationContext,
          services: this.services,
        });
      } catch (error) {
        if (signal.aborted) {
          throw signal.reason instanceof Error ? signal.reason : error;
        }
        if (!connectTimedOut && !(error instanceof TypeError)) throw error;
        traceError(connectTimedOut ? 'provider.connect-timeout' : 'provider.transport-error', {
          provider_id: this.config.id,
          model: model.modelId,
          attempt,
          duration_ms: Date.now() - attemptStartedAt,
          ...(!connectTimedOut && {
            error: error instanceof Error ? error.message : String(error),
          }),
        });
        retryError = connectTimedOut
          ? {
              code: 'server_timeout',
              message: 'The server did not respond within 30 seconds.',
            }
          : {
              code: 'provider_error',
              message: error.message || 'The provider connection was interrupted.',
            };
      } finally {
        clearTimeout(connectTimeout);
      }

      const retryableResponse = response?.status >= 500 && response.status <= 599;
      if (retryableResponse) {
        traceVerbose('provider.retryable-response', {
          provider_id: this.config.id,
          model: model.modelId,
          attempt,
          http_status: response.status,
        });
        retryError = {
          code: `http_${response.status}`,
          message: await response.text() || `${response.status} ${response.statusText}`,
        };
      }

      if (!retryError) {
        if (!response.ok) {
          const responseText = await response.text();
          const error = new Error(responseText || `${response.status} ${response.statusText}`);
          error.status = response.status;
          throw error;
        }
        if (!response.body) {
          throw new Error('The provider returned no streaming body.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let receivedOutput = false;
        let activeItemType = null;
        const abortReader = () => {
          reader.cancel(signal.reason).catch(() => {});
        };
        signal.addEventListener('abort', abortReader, { once: true });

        try {
          if (signal.aborted) abortReader();
          while (true) {
            let chunk;
            try {
              chunk = await reader.read();
            } catch (error) {
              if (signal.aborted) {
                throw signal.reason instanceof Error ? signal.reason : error;
              }
              if (!(error instanceof TypeError)) throw error;
              traceError('provider.stream-transport-error', {
                provider_id: this.config.id,
                model: model.modelId,
                attempt,
                duration_ms: Date.now() - attemptStartedAt,
                error: error.message,
              });
              retryError = {
                code: 'provider_error',
                message: error.message || 'The provider stream was interrupted.',
              };
              break;
            }
            const { value, done } = chunk;
            if (signal.aborted) {
              throw signal.reason instanceof Error
                ? signal.reason
                : new Error('The request was aborted.');
            }
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
              } catch (error) {
                traceError('provider.sse-parse-error', {
                  provider_id: this.config.id,
                  model: model.modelId,
                  attempt,
                  error: error instanceof Error ? error.message : String(error),
                });
                throw new Error('The provider returned an invalid SSE payload.');
              }

              for (const event of this.implementation.eventsFrom(json)) {
                if (
                  event.type === 'error'
                  && (
                    event.code === 'server_error'
                    || event.code === 'provider_error'
                    || (event.code === 'server_is_overloaded' && !receivedOutput)
                  )
                ) {
                  retryError = event;
                  break;
                }

                let normalizedEvent = event;
                if (event.type === 'continuation-item') {
                  continuationItems.set(event.index ?? continuationItems.size, event.item);
                  continue;
                }
                if (event.type === 'item-complete') {
                  onEvent({
                    ...event,
                    itemType: event.itemType ?? activeItemType,
                  });
                  activeItemType = null;
                  continue;
                }
                if (event.type === 'continuation') {
                  completedContinuation = event.items;
                  continue;
                }
                const semanticItemType = ['content', 'reasoning', 'tool-call'].includes(event.type)
                  ? event.type
                  : null;
                if (semanticItemType && activeItemType && activeItemType !== semanticItemType) {
                  onEvent({ type: 'item-complete', itemType: activeItemType });
                }
                if (semanticItemType) activeItemType = semanticItemType;
                if (event.type === 'content') {
                  assistantContent += event.text;
                }
                if (event.type === 'tool-call') {
                  const key = event.key ?? event.callId;
                  const providerCallId = typeof event.callId === 'string' && event.callId.trim()
                    ? event.callId
                    : null;
                  const existing = toolCalls.get(key) ?? {
                    key,
                    callId: providerCallId ?? `call_${randomUUID()}`,
                    name: null,
                    argumentsText: '',
                  };
                  const providerName = typeof event.name === 'string' && event.name.trim()
                    ? event.name
                    : null;
                  if (providerCallId && providerCallId !== existing.callId) {
                    const error = new Error(`The provider changed the tool call ID for index "${key}".`);
                    error.code = 'provider_error';
                    throw error;
                  }
                  if (providerName && existing.name && providerName !== existing.name) {
                    const error = new Error(`The provider changed the tool call name for index "${key}".`);
                    error.code = 'provider_error';
                    throw error;
                  }
                  existing.name = providerName ?? existing.name;
                  existing.argumentsText = event.replaceArguments
                    ? event.argumentsText
                    : `${existing.argumentsText}${event.argumentsDelta ?? ''}`;
                  toolCalls.set(key, existing);
                  normalizedEvent = {
                    ...event,
                    callId: existing.callId,
                    name: existing.name,
                  };
                }
                receivedOutput ||= ['content', 'reasoning', 'tool-call'].includes(event.type);
                if (retryVisible && receivedOutput) {
                  onEvent({ type: 'retry-clear' });
                  retryVisible = false;
                }
                if (event.type === 'usage') {
                  const inputTokens = event.usage?.inputTokens;
                  const cachedInputTokens = event.usage?.cachedInputTokens;
                  traceVerbose('provider.inference-usage', {
                    thread_id: invocationContext.conversationId,
                    provider_id: this.config.id,
                    interface: this.config.interface,
                    model: model.modelId,
                    operation: invocationContext.traceOperation
                      ?? (invocationContext.quickChat
                        ? 'quick-chat'
                        : invocationContext.auxiliary
                          ? 'auxiliary'
                          : 'chat'),
                    round: invocationContext.traceRound,
                    attempt,
                    message_count: messages?.length ?? 0,
                    tool_count: tools?.length ?? 0,
                    tool_history_count: toolHistory?.length ?? 0,
                    input_tokens: inputTokens,
                    cached_input_tokens: cachedInputTokens,
                    cache_ratio: inputTokens > 0 && cachedInputTokens !== undefined
                      ? cachedInputTokens / inputTokens
                      : null,
                    output_tokens: event.usage?.outputTokens,
                    reasoning_tokens: event.usage?.reasoningTokens,
                    total_tokens: event.usage?.totalTokens,
                  });
                }
                onEvent(normalizedEvent);
                if (event.type === 'error') {
                  const error = new Error(event.message);
                  error.code = event.code;
                  const status = Number(event.status);
                  if (Number.isInteger(status) && status >= 400 && status <= 599) {
                    error.status = status;
                  } else if (event.code === 'context_length_exceeded') {
                    error.status = 400;
                  }
                  throw error;
                }
              }
              if (retryError) break;
            }

            if (retryError) {
              await reader.cancel();
              break;
            }
            if (done) break;
          }
        } finally {
          signal.removeEventListener('abort', abortReader);
        }

        if (!retryError) {
          if (retryVisible) onEvent({ type: 'retry-clear' });
          return {
            assistantContent,
            continuation: completedContinuation ?? [...continuationItems.entries()]
              .sort(([left], [right]) => left - right)
              .map(([, item]) => item),
            toolCalls: [...toolCalls.values()],
          };
        }
      }

      const exhausted = attempt === maxAttempts;
      const displayedMaxAttempts = Number.isFinite(maxAttempts) ? retryDelays.length : null;
      if (exhausted) {
        onEvent({
          type: 'error',
          code: retryError.code,
          message: retryError.message,
          retryAttempt: retryDelays.length,
          maxAttempts: displayedMaxAttempts,
        });
        const error = new Error(retryError.message);
        error.code = 'provider_retry_exhausted';
        throw error;
      }

      onEvent({
        type: 'retry',
        code: retryError.code,
        message: retryError.message,
        attempt,
        maxAttempts: displayedMaxAttempts,
      });
      retryVisible = true;

      const retryDelay = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
      traceVerbose('provider.retry-scheduled', {
        provider_id: this.config.id,
        model: model.modelId,
        attempt,
        retry_after_ms: retryDelay,
      });
      await new Promise((resolveDelay, rejectDelay) => {
        const retryTimeout = setTimeout(() => {
          signal.removeEventListener('abort', abortDelay);
          resolveDelay();
        }, retryDelay);
        const abortDelay = () => {
          clearTimeout(retryTimeout);
          rejectDelay(signal.reason instanceof Error
            ? signal.reason
            : new Error('The request was aborted.'));
        };
        signal.addEventListener('abort', abortDelay, { once: true });
        if (signal.aborted) abortDelay();
      });
    }
  }
}

export class ModelProviderRegistry {
  #providerTypes;

  constructor({ getProviders, providerTypes, services, routerService = null }) {
    this.getProviders = getProviders;
    this.#providerTypes = providerTypes;
    this.services = services;
    this.routerService = routerService;
  }

  get providerTypes() {
    const types = typeof this.#providerTypes === 'function'
      ? this.#providerTypes()
      : this.#providerTypes;
    return new Map((types ?? []).map((type) => [type.descriptor.id, type]));
  }

  listTypes() {
    return [...this.providerTypes.values()].map((type) => type.descriptor);
  }

  normalizeConfig(value) {
    const provider = value && typeof value === 'object' ? value : {};
    const interfaceId = String(provider.interface ?? '').trim();
    const implementation = this.providerTypes.get(interfaceId);
    const name = String(provider.name ?? '').trim();
    const baseUrl = String(provider.baseUrl ?? '').trim().replace(/\/+$/, '');

    if (!name) {
      throw new Error('Provider name is required.');
    }
    if (!implementation) {
      throw new Error('Choose a supported provider interface.');
    }
    if (implementation.descriptor.connection === 'custom') {
      try {
        const url = new URL(baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        throw new Error('Provider base URL must be a valid HTTP or HTTPS URL.');
      }
    }

    const modelIds = new Set();
    const models = implementation.descriptor.models === 'managed'
      ? []
      : Array.isArray(provider.models)
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
                pdfFiles: Boolean(model?.capabilities?.pdfFiles),
                video: Boolean(model?.capabilities?.video),
              },
              context: {
                input: inputContext,
                output: outputContext,
              },
              reasoning: REASONING_EFFORTS.filter((effort) => model?.reasoning?.includes(effort)),
            };
          })
        : [];
    const fields = Object.fromEntries((implementation.descriptor.fields ?? []).map((field) => {
      const fieldValue = String(provider[field.id] ?? field.default ?? '');
      if (
        Array.isArray(field.options)
        && !field.options.some((option) => option.value === fieldValue)
      ) {
        throw new Error(`Choose a valid value for "${field.label}".`);
      }
      return [field.id, fieldValue];
    }));

    return {
      id: String(provider.id ?? '').trim() || crypto.randomUUID(),
      name,
      baseUrl: implementation.descriptor.connection === 'custom' ? baseUrl : '',
      interface: interfaceId,
      apiKey: implementation.descriptor.connection === 'custom'
        ? String(provider.apiKey ?? '').trim()
        : '',
      ...fields,
      enabled: provider.enabled !== false,
      models,
    };
  }

  createProvider(config) {
    const implementation = this.providerTypes.get(config.interface);
    if (!implementation) {
      throw new Error(`Provider interface "${config.interface}" is unavailable.`);
    }
    const fields = Object.fromEntries((implementation.descriptor.fields ?? []).map((field) => [
      field.id,
      config[field.id] ?? field.default ?? '',
    ]));
    const credentials = this.services.credentials?.get(config.id) ?? {};
    return new ModelProvider({ ...config, ...fields, ...credentials }, implementation, this.services);
  }

  listModels() {
    return [
      ...this.getProviders().flatMap((config) => {
        if (!this.providerTypes.has(config.interface)) return [];
        try {
          return this.createProvider(config).listModels();
        } catch (error) {
          traceError('provider.list-models-error', {
            provider_id: config.id,
            interface: config.interface,
            error: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      }),
      ...(this.routerService?.listModels() ?? []),
    ];
  }

  listGlobalTools(context = {}) {
    return [...new Map(this.getProviders().flatMap((config) => {
      if (!this.providerTypes.has(config.interface)) return [];
      try {
        return this.createProvider(config)
          .getContributions(context)
          .tools
          .filter((tool) => tool.globallyAvailable === true)
          .map((tool) => [tool.name, tool]);
      } catch (error) {
        traceError('provider.contributions-error', {
          provider_id: config.id,
          interface: config.interface,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    })).values()];
  }

  resolve(modelId) {
    if (typeof modelId === 'string' && modelId.startsWith('@')) {
      return this.routerService?.resolve(modelId) ?? null;
    }
    for (const config of this.getProviders()) {
      if (!this.providerTypes.has(config.interface)) continue;
      try {
        const provider = this.createProvider(config);
        const model = provider.listModels().find((item) => item.id === modelId);
        if (model) return { provider, model };
      } catch (error) {
        traceError('provider.resolve-error', {
          provider_id: config.id,
          interface: config.interface,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return null;
  }

  async getState(providerId) {
    const config = this.getProviders().find((provider) => provider.id === providerId);
    if (!config) throw new Error('Provider not found.');
    if (!this.providerTypes.has(config.interface)) return {};
    const provider = this.createProvider(config);
    return typeof provider.implementation.getState === 'function'
      ? provider.implementation.getState({
          provider: provider.config,
          services: this.services,
        })
      : {};
  }

  async invokeAction(providerId, action, input) {
    const config = this.getProviders().find((provider) => provider.id === providerId);
    if (!config) throw new Error('Provider not found.');
    if (!this.providerTypes.has(config.interface)) {
      throw new Error(`Provider interface "${config.interface}" is unavailable.`);
    }
    const provider = this.createProvider(config);
    if (typeof provider.implementation.invokeAction !== 'function') {
      throw new Error('This provider does not expose settings actions.');
    }
    return provider.implementation.invokeAction({
      provider: provider.config,
      action,
      input,
      services: this.services,
    });
  }

  async refresh(providerId) {
    const config = this.getProviders().find((provider) => provider.id === providerId);
    if (!config || !this.providerTypes.has(config.interface)) return;
    const provider = this.createProvider(config);
    if (typeof provider.implementation.refresh === 'function') {
      await provider.implementation.refresh({
        provider: provider.config,
        services: this.services,
      });
    }
  }

  async remove(providerId) {
    const config = this.getProviders().find((provider) => provider.id === providerId);
    if (!config || !this.providerTypes.has(config.interface)) return;
    const provider = this.createProvider(config);
    if (typeof provider.implementation.remove === 'function') {
      await provider.implementation.remove({
        provider: provider.config,
        services: this.services,
      });
    }
  }

  listUsageProviders() {
    return this.getProviders().flatMap((config) => {
      if (!this.providerTypes.has(config.interface)) return [];
      try {
        const provider = this.createProvider(config);
        return provider.getContributions().usageProviders.map((usageProvider) => ({
          id: `${provider.config.id}:${usageProvider.id}`,
          title: usageProvider.title,
          source: 'provider',
          providerId: provider.config.id,
        }));
      } catch (error) {
        traceError('provider.usage-providers-error', {
          provider_id: config.id,
          interface: config.interface,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    });
  }

  resolveUsageProvider(usageProviderId) {
    if (typeof usageProviderId !== 'string' || !usageProviderId) return null;
    const config = this.getProviders().find((provider) => (
      usageProviderId.startsWith(`${provider.id}:`)
    ));
    if (!config || !this.providerTypes.has(config.interface)) return null;
    try {
      const provider = this.createProvider(config);
      const prefix = `${provider.config.id}:`;
      const usageProvider = provider.getContributions().usageProviders.find(
        (item) => item.id === usageProviderId.slice(prefix.length),
      );
      return usageProvider ? { usageProvider, provider } : null;
    } catch (error) {
      traceError('provider.resolve-usage-provider-error', {
        provider_id: config.id,
        interface: config.interface,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async readUsageProvider(usageProviderId) {
    const selection = this.resolveUsageProvider(usageProviderId);
    if (!selection || typeof selection.usageProvider.load !== 'function') {
      throw new Error('The usage provider is unavailable.');
    }
    return selection.usageProvider.load();
  }

  listAuxiliaryPanels(context = {}) {
    return this.getProviders().flatMap((config) => {
      if (!this.providerTypes.has(config.interface)) return [];
      try {
        const provider = this.createProvider(config);
        return provider.getContributions(context).auxiliaryPanels.map((panel) => ({
          id: `${provider.config.id}:${panel.id}`,
          title: panel.title,
          icon: panel.icon ?? null,
          providerId: provider.config.id,
          providerName: provider.config.name,
        }));
      } catch (error) {
        traceError('provider.auxiliary-panels-error', {
          provider_id: config.id,
          interface: config.interface,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    });
  }

  resolveAuxiliaryPanel(panelId, context = {}) {
    if (typeof panelId !== 'string' || !panelId) return null;
    const config = this.getProviders().find((provider) => (
      panelId.startsWith(`${provider.id}:`)
    ));
    if (!config || !this.providerTypes.has(config.interface)) return null;
    try {
      const provider = this.createProvider(config);
      const prefix = `${provider.config.id}:`;
      const panel = provider.getContributions(context).auxiliaryPanels.find(
        (item) => item.id === panelId.slice(prefix.length),
      );
      return panel ? { panel, provider } : null;
    } catch (error) {
      traceError('provider.resolve-auxiliary-panel-error', {
        provider_id: config.id,
        interface: config.interface,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async readAuxiliaryPanel(panelId, context = {}) {
    const selection = this.resolveAuxiliaryPanel(panelId, context);
    const panel = selection?.panel;
    if (!panel || typeof panel.load !== 'function') {
      throw new Error('The provider panel is unavailable.');
    }
    return panel.load(context);
  }

  async invokeAuxiliaryPanelAction(panelId, action, input, context = {}) {
    const selection = this.resolveAuxiliaryPanel(panelId, context);
    const panel = selection?.panel;
    if (!panel || typeof panel.invokeAction !== 'function') {
      throw new Error('The provider panel action is unavailable.');
    }
    return panel.invokeAction(action, input, context);
  }
}

