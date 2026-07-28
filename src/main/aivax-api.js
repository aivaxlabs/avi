const baseUrl = 'https://inference.aivax.net';

export async function login(loginKey) {
  const result = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { loginKey },
  });
  return unwrapData(result);
}

export async function fetchModels(token) {
  const result = await request('/v1/models', {
    token,
  });
  return Array.isArray(result.data) ? result.data.map(normalizeModel) : [];
}

export async function fetchBalance(token) {
  const result = await request('/api/v1/information/balance', { token });
  return normalizeBalance(unwrapData(result));
}

export async function generateTitle(token, messages) {
  const result = await request('/api/v2/chat-utilities/chat-title', {
    method: 'POST',
    token,
    body: { messages },
  });
  return unwrapData(result)?.conversation_title ?? null;
}

export async function generateContinuations(token, messages) {
  const result = await request('/api/v2/chat-utilities/chat-continuations', {
    method: 'POST',
    token,
    body: { messages },
  });
  const data = unwrapData(result);
  return Array.isArray(data?.continuation_topics)
    ? data.continuation_topics.filter((topic) => typeof topic === 'string')
    : [];
}

export function chatRequestBody({ model, messages, user }) {
  const body = {
    model,
    messages,
    stream: true,
    rendering_mode: 'textual_blocks',
    tool_invocation_explanations: true,
  };
  if (user) {
    body.user = user;
  }
  return body;
}

export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? parseJson(text) : null;
  if (!response.ok) {
    const message =
      payload?.message ??
      payload?.error?.message ??
      payload?.error ??
      payload?.data?.message ??
      text ??
      response.statusText;
    throw new Error(message || `AIVAX request failed with status ${response.status}`);
  }
  return payload;
}

function unwrapData(result) {
  return result?.data && typeof result.data === 'object' ? result.data : result;
}

function normalizeBalance(data) {
  const source = unwrapData(data) ?? {};
  const planLimits = source.planLimits ?? source.plan_limits ?? {};
  return {
    balance: numberOrNull(source.balance),
    usage24h: numberOrNull(source.usage24h ?? source.usage_24h ?? source.usage24H),
    plan: source.plan ?? null,
    storageUsage: numberOrNull(source.storageUsage ?? source.storage_usage),
    planLimits: {
      includedStorage: numberOrNull(
        planLimits.includedStorage ??
          planLimits.included_storage ??
          source.includedStorage ??
          source.included_storage,
      ),
    },
    raw: source,
  };
}

function normalizeModel(model) {
  const details = model._details ?? {};
  const providerModel = details.provider_model ?? {};
  const aiGateway = details.ai_gateway ?? {};
  const pricingSource = model.pricing ?? model.price ?? model.cost ?? {};
  const firstPricing = basePricingTier(model.pricing) ?? basePricingTier(providerModel.pricing) ?? {};
  const technicalInfo = providerModel.technical_info ?? {};
  const pricing = Array.isArray(pricingSource) ? {} : pricingSource;
  const metadata = model.metadata ?? model.meta ?? {};
  const routed = details.type === 'provider_model' || String(model.id ?? '').startsWith('@');
  const routedProvider = routed ? providerFromModelName(model.id) : providerFromModelName(aiGateway.model_name);
  return {
    ...model,
    id: model.id,
    name: firstText(model.name, metadata.name, model.id),
    description: firstText(model.description, providerModel.description, metadata.description),
    pricing: {
      input: pricing.input ?? pricing.in ?? pricing.prompt ?? firstPricing.input_mtokens ?? firstPricing.inputPerMillionTokens ?? metadata.input_price ?? null,
      output: pricing.output ?? pricing.out ?? pricing.completion ?? firstPricing.output_mtokens ?? firstPricing.outputPerMillionTokens ?? metadata.output_price ?? null,
      cached: pricing.cached ?? pricing.cached_input ?? firstPricing.input_cache_mtokens ?? firstPricing.cachedInputPerMillionTokens ?? metadata.cached_price ?? null,
      subscriptionMultiplier:
        pricing.subscriptionMultiplier ??
        pricing.subscription_multiplier ??
        providerModel.subscriptionMultiplier ??
        providerModel.subscription_multiplier ??
        firstPricing.subscriptionMultiplier ??
        firstPricing.subscription_multiplier ??
        null,
    },
    speed: model.speed ?? technicalInfo.speed ?? metadata.speed ?? null,
    intelligence: model.intelligence ?? technicalInfo.intelligence ?? metadata.intelligence ?? null,
    capabilities: Array.isArray(model.capabilities)
      ? model.capabilities
      : Array.isArray(providerModel.capabilities)
        ? providerModel.capabilities
        : [],
    contextWindow: technicalInfo.context_window ?? model.contextWindow ?? model.context_window ?? null,
    maxCompletionTokens: technicalInfo.max_completion_tokens ?? model.maxCompletionTokens ?? model.max_completion_tokens ?? null,
    routed,
    provider: routedProvider,
    sourceModel: aiGateway.model_name ?? null,
  };
}

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? '';
}

function providerFromModelName(value) {
  const match = String(value ?? '').match(/^@([^/]+)\//);
  return match?.[1] ?? 'AI Gateway';
}

function basePricingTier(pricing) {
  if (!Array.isArray(pricing)) return null;
  return pricing.find((tier) => Number(tier?.tokenThreshold ?? tier?.token_threshold) === 0) ?? pricing[0] ?? {};
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { data: text };
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    return numberOrNull(value.amount ?? value.value ?? value.total ?? value.bytes);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
