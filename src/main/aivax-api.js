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

export function chatRequestBody({ model, messages }) {
  return {
    model,
    messages,
    stream: true,
    rendering_mode: 'textual_blocks',
    tool_invocation_explanations: true,
  };
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
  const pricing = model.pricing ?? model.price ?? model.cost ?? {};
  const metadata = model.metadata ?? model.meta ?? {};
  return {
    ...model,
    id: model.id,
    name: model.name ?? metadata.name ?? model.id,
    description: model.description ?? metadata.description ?? '',
    pricing: {
      input: pricing.input ?? pricing.in ?? pricing.prompt ?? metadata.input_price ?? null,
      output: pricing.output ?? pricing.out ?? pricing.completion ?? metadata.output_price ?? null,
      cached: pricing.cached ?? pricing.cached_input ?? metadata.cached_price ?? null,
    },
    speed: model.speed ?? metadata.speed ?? null,
    intelligence: model.intelligence ?? metadata.intelligence ?? null,
    routed: String(model.id ?? '').startsWith('@'),
  };
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
