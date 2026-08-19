import { randomUUID } from 'node:crypto';

const UNAVAILABLE_DURATION_MS = 10 * 60_000;
const REASONING_ORDER = Object.freeze([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const adaptReasoningEffort = (requested, supported) => {
  if (!requested || !Array.isArray(supported) || supported.length === 0) return null;
  if (supported.includes(requested)) return requested;

  const requestedIndex = REASONING_ORDER.indexOf(requested);
  if (requestedIndex < 0) return null;
  return supported
    .map((effort) => ({ effort, index: REASONING_ORDER.indexOf(effort) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => (
      Math.abs(left.index - requestedIndex) - Math.abs(right.index - requestedIndex)
      || left.index - right.index
    ))[0]?.effort ?? null;
};

// Rate limits arrive either as HTTP 429 status or as provider-specific error codes
// (for example AIVAX INFERENCE_CAP_ERROR, which carries no HTTP status). Retrying
// the same model cannot recover a quota ceiling, so the router skips it at once.
const FAILOVER_ERROR_CODES = new Set([
  'inference_cap_error',
  'insufficient_quota',
  'quota_exceeded',
  'rate_limit_error',
  'rate_limit_exceeded',
  'usage_limit_reached',
]);

const isRouterFailoverError = (error) => error?.code === 'provider_retry_exhausted'
  || error?.status === 429
  || FAILOVER_ERROR_CODES.has(String(error?.code ?? '').toLowerCase());

export class RouterProvider {
  constructor(service, router) {
    this.service = service;
    this.router = router;
    this.pendingCandidates = null;
    this.config = {
      id: router.id,
      name: router.name,
      interface: 'router',
      enabled: true,
    };
  }

  listModels() {
    const model = this.service.createCatalogModel(this.router);
    return model ? [model] : [];
  }

  getContributions(context = {}) {
    this.pendingCandidates ??= this.service.orderCandidates(this.router);
    const candidate = this.pendingCandidates[0];
    return candidate?.provider.getContributions({ ...context, model: candidate.model }) ?? {
      models: [],
      tools: [],
      auxiliaryPanels: [],
    };
  }

  async stream(options) {
    const candidates = this.pendingCandidates ?? this.service.orderCandidates(this.router);
    this.pendingCandidates = null;
    if (candidates.length === 0) {
      throw new Error(`No models are currently available for router "${this.router.name}".`);
    }

    let failoverError = null;
    let failoverEvent = null;
    for (const candidate of candidates) {
      let errorEvent = null;
      try {
        return await candidate.provider.stream({
          ...options,
          model: candidate.model,
          reasoningEffort: adaptReasoningEffort(options.reasoningEffort, candidate.model.reasoning),
          onEvent: (event) => {
            if (event.type === 'error') errorEvent = event;
            else options.onEvent(event);
          },
        });
      } catch (error) {
        if (!isRouterFailoverError(error)) {
          if (errorEvent) options.onEvent(errorEvent);
          throw error;
        }
        this.service.markUnavailable(this.router, candidate.model.id);
        options.onEvent({ type: 'retry-clear' });
        failoverError = error;
        failoverEvent = errorEvent;
      }
    }

    if (failoverEvent) options.onEvent(failoverEvent);
    throw failoverError ?? new Error(`No models are currently available for router "${this.router.name}".`);
  }
}

export class ModelRouterService {
  #unavailableUntil = new Map();
  #roundRobinCursors = new Map();

  constructor({ getRouters, setRouters, resolveModel }) {
    this.getRouters = getRouters;
    this.setRouters = setRouters;
    this.resolveModel = resolveModel;
  }

  list() {
    const now = Date.now();
    return this.getRouters().map((router) => ({
      ...router,
      models: router.models.map(({ modelId }) => {
        const unavailableUntil = this.#unavailableUntil.get(`${router.id}\u0000${modelId}`) ?? 0;
        const available = !modelId.startsWith('@')
          && Boolean(this.resolveModel(modelId))
          && unavailableUntil <= now;
        return {
          modelId,
          available,
          ...(unavailableUntil > now && { unavailableUntil }),
        };
      }),
    }));
  }

  normalize(value) {
    const router = value && typeof value === 'object' ? value : {};
    const rawId = String(router.id ?? '').trim().replace(/^@+/, '');
    const id = rawId || randomUUID();
    const name = String(router.name ?? '').trim();
    const mode = router.mode === 'round-robin' ? 'round-robin' : router.mode === 'fallback'
      ? 'fallback'
      : null;

    if (!name) throw new Error('Router name is required.');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
      throw new Error('Router ID must be a slug or UUID.');
    }
    if (!mode) throw new Error('Choose a supported router mode.');

    const modelIds = new Set();
    const models = Array.isArray(router.models) ? router.models.map((candidate) => {
      const modelId = String(candidate?.modelId ?? '').trim();
      if (!modelId) throw new Error('Every router candidate requires a model ID.');
      if (modelId.startsWith('@')) throw new Error('Routers cannot use other routers as candidates.');
      if (modelIds.has(modelId)) throw new Error(`Model "${modelId}" is duplicated in this router.`);
      modelIds.add(modelId);
      return { modelId };
    }) : [];
    if (models.length === 0) throw new Error('Router requires at least one candidate model.');

    return { id: `@${id}`, name, mode, models };
  }

  save(value) {
    const router = this.normalize(value);
    const routers = this.getRouters();
    this.setRouters(routers.some((item) => item.id === router.id)
      ? routers.map((item) => item.id === router.id ? router : item)
      : [...routers, router]);
    this.#roundRobinCursors.delete(router.id);
    return this.list();
  }

  remove(routerId) {
    const id = String(routerId ?? '').trim();
    this.#roundRobinCursors.delete(id);
    this.setRouters(this.getRouters().filter((router) => router.id !== id));
    return this.list();
  }

  resolve(routerId) {
    const router = this.getRouters().find((item) => item.id === routerId);
    if (!router) return null;
    const provider = new RouterProvider(this, router);
    const model = provider.listModels()[0];
    return model ? { provider, model } : null;
  }

  listModels() {
    return this.getRouters().flatMap((router) => new RouterProvider(this, router).listModels());
  }

  resolveCandidates(router, { includeUnavailable = false } = {}) {
    const now = Date.now();
    return router.models.flatMap(({ modelId }) => {
      if (modelId.startsWith('@')) return [];
      const resolved = this.resolveModel(modelId);
      const availabilityKey = `${router.id}\u0000${modelId}`;
      if (!resolved || (!includeUnavailable && (this.#unavailableUntil.get(availabilityKey) ?? 0) > now)) {
        return [];
      }
      return [resolved];
    });
  }

  orderCandidates(router) {
    const candidates = this.resolveCandidates(router);
    if (router.mode !== 'round-robin' || candidates.length < 2) return candidates;

    const cursor = this.#roundRobinCursors.get(router.id) ?? 0;
    const start = cursor % candidates.length;
    this.#roundRobinCursors.set(router.id, (start + 1) % candidates.length);
    return [...candidates.slice(start), ...candidates.slice(0, start)];
  }

  markUnavailable(router, modelId) {
    this.#unavailableUntil.set(`${router.id}\u0000${modelId}`, Date.now() + UNAVAILABLE_DURATION_MS);
  }

  createCatalogModel(router) {
    const candidates = this.resolveCandidates(router, { includeUnavailable: true });
    if (candidates.length === 0) return null;
    const models = candidates.map(({ model }) => model);
    const capabilityNames = ['images', 'audio', 'pdfFiles', 'video'];
    const contextLimit = (field) => models.every((model) => Number.isInteger(model.context?.[field]))
      ? Math.min(...models.map((model) => model.context[field]))
      : null;

    return {
      id: router.id,
      modelId: router.id,
      name: router.name,
      providerId: router.id,
      providerName: router.name,
      interface: 'router',
      endpoint: null,
      capabilities: Object.fromEntries(capabilityNames.map((capability) => [
        capability,
        models.every((model) => model.capabilities?.[capability] === true),
      ])),
      context: {
        input: contextLimit('input'),
        output: contextLimit('output'),
      },
      reasoning: REASONING_ORDER.filter((effort) => (
        models.every((model) => model.reasoning?.includes(effort))
      )),
    };
  }
}
