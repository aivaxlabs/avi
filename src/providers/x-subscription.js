import { randomUUID } from 'node:crypto';
import packageMetadata from '../../package.json' with { type: 'json' };
import { sendJsonRequest } from '../main/json-request-body.js';
import { diagnosticFetch as fetch } from '../main/request-diagnostics.js';
import { defineProvider } from '../main/provider-api.js';
import {
  traceError,
  traceVerbose,
} from '../main/trace-log.js';
import { responsesApi } from './openai-compatible.js';

const AUTH_BASE_URL = 'https://auth.x.ai';
const DEVICE_URL = `${AUTH_BASE_URL}/oauth2/device/code`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth2/token`;
const RESPONSES_URL = 'https://api.x.ai/v1/responses';
const PROXY_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
// Workaround: xAI has no official usage API for subscriptions. Usage is read from the Grok CLI
// proxy, which rejects clients below its minimum Grok CLI version (1.0.13 as of 2026-10-22).
// Raise this value when usage reports an outdated version; replace the proxy once xAI publishes
// a supported usage endpoint. Inference does not use the proxy.
const PROXY_CLIENT_VERSION = '1.0.13';
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const VERIFICATION_ORIGINS = [AUTH_BASE_URL, 'https://accounts.x.ai'];
const CLIENT_IDENTIFIER = packageMetadata.name;
const USER_AGENT = `${CLIENT_IDENTIFIER}/${packageMetadata.version}`;
const refreshPromises = new Map();
const signedOutProviders = new Set();

const modelDefinitions = [
  {
    id: 'grok-4.7',
    name: 'Grok 4.7',
    description: 'Flagship Grok model for complex reasoning and agentic coding.',
    context: { input: 500_000, output: 131_072 },
    reasoning: ['low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    description: 'Previous flagship Grok model with strong reasoning and tool use.',
    context: { input: 500_000, output: 131_072 },
    reasoning: ['low', 'medium', 'high'],
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5',
    description: 'Grok model tuned for coding and agentic work.',
    context: { input: 500_000, output: 131_072 },
    reasoning: ['low', 'medium', 'high'],
  },
  {
    id: 'grok-4.3',
    name: 'Grok 4.3',
    description: 'Cost-efficient Grok model with a 1M-token context window.',
    context: { input: 1_000_000, output: 30_000 },
    reasoning: ['low', 'medium', 'high'],
  },
  {
    id: 'grok-build-0.1',
    name: 'Grok Build 0.1',
    description: 'The model behind the Grok Build terminal coding agent.',
    context: { input: 256_000, output: 30_000 },
    reasoning: [],
  },
];

export const xSubscriptionProviderType = defineProvider({
  descriptor: {
    id: 'x-subscription',
    name: 'X Subscription',
    defaultName: 'X Subscription',
    description: 'SuperGrok or X Premium subscription via OAuth',
    endpoint: '/v1/responses',
    icon: 'sparkles',
    connection: 'managed',
    models: 'managed',
    modelsDescription: 'Grok 4.7, 4.6, 4.5, and 4.3; Grok Build 0.1.',
  },
  ...responsesApi,
  getContributions: ({ provider, services }) => ({
    models: modelDefinitions.map((model) => ({
      ...model,
      modelId: model.id,
      capabilities: { images: true, audio: false, pdfFiles: true },
      enabled: true,
    })),
    usageProviders: [{
      id: 'usage',
      title: `${provider.name} usage`,
      load: () => readUsage(provider.id, services),
    }],
  }),
  request: requestXSubscription,
  getState: getXSubscriptionState,
  async invokeAction({
    provider,
    action,
    input,
    services,
  }) {
    if (action === 'disconnect') {
      await signOutXSubscription(provider.id, services);
    } else if (action === 'connect') {
      const device = await startXSubscriptionLogin();
      services.clipboard.writeText(device.userCode);
      await services.shell.openExternal(device.verificationUrl);
      return {
        state: {
          connection: {
            status: 'waiting',
            statusLabel: 'Waiting for authorization',
            title: 'xAI account',
            description: 'Complete the authorization in your browser.',
            verification: {
              label: 'Security code',
              value: device.userCode,
              description: 'Enter this code on the xAI authorization page.',
              copyLabel: 'Copy code',
            },
          },
        },
        followUp: {
          action: 'complete-connect',
          input: { device },
        },
      };
    } else if (action === 'complete-connect') {
      await completeXSubscriptionLogin(provider.id, input?.device, services);
    } else {
      throw new Error(`Unsupported provider action: ${action}`);
    }
    return getXSubscriptionState({ provider, services });
  },
  remove: ({ provider, services }) => signOutXSubscription(provider.id, services),
});

function getXSubscriptionState({ provider, services }) {
  const signedIn = Boolean(services.credentials.get(provider.id)?.refreshToken);
  return {
    connection: {
      status: signedIn ? 'connected' : 'disconnected',
      statusLabel: signedIn ? 'Connected' : 'Not connected',
      title: 'xAI account',
      description:
        'OAuth credentials are encrypted locally with a key protected by the operating system.',
      action: signedIn
        ? { id: 'disconnect', label: 'Disconnect' }
        : { id: 'connect', label: 'Sign in with xAI' },
    },
  };
}

async function postForm(url, form) {
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(form).toString(),
  });
}

async function startXSubscriptionLogin() {
  const response = await postForm(DEVICE_URL, {
    client_id: CLIENT_ID,
    scope: SCOPE,
    referrer: CLIENT_IDENTIFIER,
  });
  if (!response.ok) {
    throw new Error(`Unable to start xAI sign-in (${response.status}).`);
  }

  const device = await response.json();
  const verificationUrl = String(device.verification_uri ?? '');
  if (
    !device.device_code
    || !device.user_code
    || !VERIFICATION_ORIGINS.some((origin) => verificationUrl.startsWith(`${origin}/`))
  ) {
    throw new Error('The xAI authentication server returned an invalid device code.');
  }

  return {
    deviceCode: device.device_code,
    userCode: device.user_code,
    interval: Math.max(Number(device.interval) || 5, 1),
    expiresIn: Math.min(Number(device.expires_in) || 900, 900),
    verificationUrl,
  };
}

async function completeXSubscriptionLogin(providerId, device, services) {
  const startedAt = Date.now();
  let interval = device.interval;

  while (Date.now() - startedAt < device.expiresIn * 1_000) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1_000));
    const response = await postForm(TOKEN_URL, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: device.deviceCode,
      client_id: CLIENT_ID,
    });
    const payload = await response.json().catch(() => ({}));

    if (response.ok) {
      if (!payload.access_token || !payload.refresh_token) {
        throw new Error('xAI sign-in returned incomplete credentials.');
      }
      signedOutProviders.delete(providerId);
      await services.credentials.set(providerId, tokensFrom(payload));
      traceVerbose('provider.auth-login-completed', { provider_id: providerId });
      return { signedIn: true };
    }

    if (payload.error === 'authorization_pending') continue;
    if (payload.error === 'slow_down') {
      interval += 5;
      continue;
    }
    if (payload.error === 'access_denied') throw new Error('xAI sign-in was denied.');
    if (payload.error === 'expired_token') break;
    throw new Error(`xAI sign-in failed (${payload.error || response.status}).`);
  }

  throw new Error('xAI sign-in expired. Start the sign-in again.');
}

function tokensFrom(payload, previousRefreshToken) {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? previousRefreshToken,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3_600) * 1_000,
  };
}

async function signOutXSubscription(providerId, services) {
  if (!services.credentials.get(providerId)) return { signedIn: false };
  signedOutProviders.add(providerId);
  try {
    await services.credentials.delete(providerId);
  } catch (error) {
    signedOutProviders.delete(providerId);
    throw error;
  }
  refreshPromises.delete(providerId);
  traceVerbose('provider.auth-signed-out', { provider_id: providerId });
  return { signedIn: false };
}

async function getTokens(providerId, services, forceRefresh = false) {
  const tokens = services.credentials.get(providerId);
  if (!tokens) {
    throw new Error('Sign in with xAI in Settings before using this provider.');
  }
  if (!forceRefresh && tokens.expiresAt > Date.now() + 2 * 60 * 1_000) {
    return tokens;
  }

  if (!refreshPromises.has(providerId)) {
    refreshPromises.set(providerId, postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.access_token) {
        const code = payload.error || response.status;
        traceError('provider.auth-refresh-error', {
          provider_id: providerId,
          status: response.status,
          code: String(code).slice(0, 120),
          error: `Token refresh failed (${code}).`,
        });
        throw new Error(response.status === 400 || response.status === 401
          ? `The xAI session expired (${code}). Sign in again.`
          : `Unable to refresh the xAI session (${code}).`);
      }
      if (signedOutProviders.has(providerId)) {
        throw new Error('The xAI session was disconnected.');
      }
      const nextTokens = tokensFrom(payload, tokens.refreshToken);
      await services.credentials.set(providerId, nextTokens);
      traceVerbose('provider.auth-refresh-completed', { provider_id: providerId });
      return nextTokens;
    }).finally(() => refreshPromises.delete(providerId)));
  }

  return refreshPromises.get(providerId);
}

async function requestProxyJson(providerId, path, services, userId) {
  const send = async (forceRefresh = false) => {
    const tokens = await getTokens(providerId, services, forceRefresh);
    return fetch(`${PROXY_BASE_URL}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
        'User-Agent': USER_AGENT,
        'X-XAI-Token-Auth': 'xai-grok-cli',
        'x-grok-client-version': PROXY_CLIENT_VERSION,
        'x-grok-client-mode': 'interactive',
        ...(userId ? { 'x-userid': userId } : {}),
      },
    });
  };

  let response = await send();
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`xAI usage request failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

async function readUsage(providerId, services) {
  const { userId } = await requestProxyJson(providerId, '/user', services);
  if (typeof userId !== 'string' || !userId) {
    throw new Error('xAI did not return the account identity required to read usage.');
  }

  const billing = await requestProxyJson(providerId, '/billing?format=credits', services, userId);
  const config = billing?.config ?? {};
  const cents = (value) => (value && typeof value === 'object' && Number.isFinite(Number(value.val ?? 0))
    ? Number(value.val ?? 0)
    : null);
  const dollars = (value) => `$${(value / 100).toFixed(2)}`;
  const used = cents(config.used);
  const monthlyLimit = cents(config.monthlyLimit);
  const onDemandUsed = cents(config.onDemandUsed);
  const onDemandCap = cents(config.onDemandCap);
  const prepaid = cents(config.prepaidBalance);
  const percent = Number.isFinite(config.creditUsagePercent)
    ? config.creditUsagePercent / 100
    : used !== null && monthlyLimit > 0 ? used / monthlyLimit : null;
  const resetAt = Date.parse(config.currentPeriod?.end ?? config.billingPeriodEnd ?? '');

  return {
    accountDetails: typeof billing?.subscriptionTier === 'string' && billing.subscriptionTier
      ? `${billing.subscriptionTier} subscription`
      : 'xAI subscription',
    limits: [
      ...(percent !== null
        ? [{
            label: 'Included usage',
            amountConsumed: Math.max(0, Math.min(percent, 1)),
            resetsAt: Number.isFinite(resetAt) ? new Date(resetAt) : null,
          }]
        : []),
      ...(onDemandUsed !== null && onDemandCap > 0
        ? [{
            label: 'On-demand credits',
            amountConsumed: Math.max(0, Math.min(onDemandUsed / onDemandCap, 1)),
            resetsAt: Number.isFinite(resetAt) ? new Date(resetAt) : null,
          }]
        : []),
    ],
    counters: [
      ...(used !== null
        ? [{
            label: 'Included credits',
            description: 'Credits used in the current billing period.',
            valueString: monthlyLimit !== null ? `${dollars(used)} of ${dollars(monthlyLimit)}` : dollars(used),
          }]
        : []),
      ...(prepaid !== null && prepaid > 0
        ? [{
            label: 'Prepaid balance',
            description: 'Prepaid credits available for on-demand usage.',
            valueString: dollars(prepaid),
          }]
        : []),
    ],
  };
}

async function requestXSubscription({
  provider,
  model,
  body,
  signal,
  invocationContext,
  services,
}) {
  const requestBody = {
    ...body,
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: invocationContext.conversationId ?? randomUUID(),
  };

  const send = async (forceRefresh = false) => {
    const tokens = await getTokens(provider.id, services, forceRefresh);
    return sendJsonRequest(RESPONSES_URL, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      value: requestBody,
      signal,
      logContext: { model: model?.modelId, providerId: provider.id },
    });
  };

  const response = await send();
  return response.status === 401 ? send(true) : response;
}
