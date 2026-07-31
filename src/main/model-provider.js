import { randomUUID } from 'node:crypto';
import { REASONING_EFFORTS } from './provider-api.js';

const EMPTY_PROVIDER_CONTRIBUTIONS = Object.freeze({
  models: Object.freeze([]),
  tools: Object.freeze([]),
  auxiliaryPanels: Object.freeze([]),
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
      tools: Array.isArray(contributions?.tools) ? contributions.tools : [],
      auxiliaryPanels: Array.isArray(contributions?.auxiliaryPanels)
        ? contributions.auxiliaryPanels
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
      const attemptController = new AbortController();
      const attemptSignal = AbortSignal.any([signal, attemptController.signal]);
      let connectTimedOut = false;
      let response;
      let retryError = null;
      const connectTimeout = setTimeout(() => {
        connectTimedOut = true;
        attemptController.abort(new Error('The server did not respond within 30 seconds.'));
      }, SERVER_CONNECT_TIMEOUT_MS);

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
        if (!connectTimedOut) throw error;
        retryError = {
          code: 'server_timeout',
          message: 'The server did not respond within 30 seconds.',
        };
      } finally {
        clearTimeout(connectTimeout);
      }

      const retryableResponse = response?.status >= 500 && response.status <= 599;
      if (retryableResponse) {
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
            const { value, done } = await reader.read();
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
              } catch {
                throw new Error('The provider returned an invalid SSE payload.');
              }

              for (const event of this.implementation.eventsFrom(json)) {
                if (
                  event.type === 'error'
                  && event.code === 'server_is_overloaded'
                  && !receivedOutput
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
                  existing.callId = providerCallId ?? existing.callId;
                  existing.name = event.name ?? existing.name;
                  existing.argumentsText = event.replaceArguments
                    ? event.argumentsText
                    : `${existing.argumentsText}${event.argumentsDelta ?? ''}`;
                  toolCalls.set(key, existing);
                  normalizedEvent = { ...event, callId: existing.callId };
                }
                receivedOutput ||= ['content', 'reasoning', 'tool-call'].includes(event.type);
                if (retryVisible && receivedOutput) {
                  onEvent({ type: 'retry-clear' });
                  retryVisible = false;
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
        throw new Error(retryError.message);
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
  constructor({ getProviders, providerTypes, services }) {
    this.getProviders = getProviders;
    this.providerTypes = new Map(providerTypes.map((type) => [type.descriptor.id, type]));
    this.services = services;
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
    return new ModelProvider({ ...config, ...fields }, implementation, this.services);
  }

  listModels() {
    return this.getProviders()
      .flatMap((provider) => this.createProvider(provider).listModels());
  }

  resolve(modelId) {
    for (const config of this.getProviders()) {
      const provider = this.createProvider(config);
      const model = provider.listModels().find((item) => item.id === modelId);
      if (model) return { provider, model };
    }
    return null;
  }

  async getState(providerId) {
    const config = this.getProviders().find((provider) => provider.id === providerId);
    if (!config) throw new Error('Provider not found.');
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

  async remove(providerId) {
    const config = this.getProviders().find((provider) => provider.id === providerId);
    if (!config) return;
    const provider = this.createProvider(config);
    if (typeof provider.implementation.remove === 'function') {
      await provider.implementation.remove({
        provider: provider.config,
        services: this.services,
      });
    }
  }

  listAuxiliaryPanels(context = {}) {
    return this.getProviders().flatMap((config) => {
      const provider = this.createProvider(config);
      return provider.getContributions(context).auxiliaryPanels.map((panel) => ({
        id: `${provider.config.id}:${panel.id}`,
        title: panel.title,
        icon: panel.icon ?? null,
        providerId: provider.config.id,
        providerName: provider.config.name,
      }));
    });
  }

  resolveAuxiliaryPanel(panelId, context = {}) {
    if (typeof panelId !== 'string' || !panelId) return null;
    const config = this.getProviders().find((provider) => (
      panelId.startsWith(`${provider.id}:`)
    ));
    if (!config) return null;
    const provider = this.createProvider(config);
    const prefix = `${provider.config.id}:`;
    const panel = provider.getContributions(context).auxiliaryPanels.find(
      (item) => item.id === panelId.slice(prefix.length),
    );
    return panel ? { panel, provider } : null;
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
