import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import {
  basename,
  extname,
  isAbsolute,
  join,
} from 'node:path';
import { defineProvider } from '../main/provider-api.js';
import {
  traceError,
  traceVerbose,
} from '../main/trace-log.js';
import { responsesApi } from './openai-compatible.js';

const AUTH_BASE_URL = 'https://auth.openai.com';
const CHATGPT_BACKEND_URL = 'https://chatgpt.com/backend-api';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const RESPONSES_URL = `${CHATGPT_BACKEND_URL}/codex/responses`;
const IMAGE_MODEL = 'gpt-image-2';
const IMAGE_MIME_TYPES = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const refreshPromises = new Map();
const signedOutProviders = new Set();

const THROUGH_MAX_REASONING = ['low', 'medium', 'high', 'xhigh', 'max'];
const THROUGH_XHIGH_REASONING = ['low', 'medium', 'high', 'xhigh'];

const modelDefinitions = [
  {
    id: 'gpt-5.6-sol',
    modelId: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description: 'Frontier model for complex, open-ended work and polished results.',
    context: { input: 272_000, output: 128_000 },
    reasoning: THROUGH_MAX_REASONING,
    imageInput: true,
    fast: true,
  },
  {
    id: 'gpt-5.6-terra',
    modelId: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'Pragmatic all-rounder for everyday reasoning and tool use.',
    context: { input: 272_000, output: 128_000 },
    reasoning: THROUGH_MAX_REASONING,
    imageInput: true,
    fast: true,
  },
  {
    id: 'gpt-5.6-luna',
    modelId: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    description: 'Efficient model for clear, repeatable, high-volume tasks.',
    context: { input: 272_000, output: 128_000 },
    reasoning: THROUGH_MAX_REASONING,
    imageInput: true,
    fast: true,
  },
  {
    id: 'gpt-5.5',
    modelId: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Previous-generation flagship model with strong reasoning and tool use.',
    context: { input: 272_000, output: 128_000 },
    reasoning: THROUGH_XHIGH_REASONING,
    imageInput: true,
    fast: true,
  },
  {
    id: 'gpt-5.4',
    modelId: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'General-purpose reasoning model.',
    context: { input: 272_000, output: 128_000 },
    reasoning: THROUGH_XHIGH_REASONING,
    imageInput: true,
    fast: true,
  },
  {
    id: 'gpt-5.4-mini',
    modelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    description: 'Compact GPT-5.4 model for efficient tasks.',
    context: { input: 272_000, output: 128_000 },
    reasoning: THROUGH_XHIGH_REASONING,
    imageInput: true,
    fast: false,
  },
  {
    id: 'gpt-5.3-codex-spark',
    modelId: 'gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark',
    description: 'Fast Codex model for focused coding tasks.',
    context: { input: 128_000, output: 128_000 },
    reasoning: THROUGH_XHIGH_REASONING,
    imageInput: false,
    fast: false,
  },
];

export const openAiSubscriptionProviderType = defineProvider({
  descriptor: {
    id: 'openai-subscription',
    name: 'OpenAI Subscription',
    defaultName: 'OpenAI Subscription',
    description: 'ChatGPT subscription via OAuth',
    endpoint: '/v1/responses',
    icon: 'sparkles',
    connection: 'managed',
    models: 'managed',
    modelsDescription:
      'GPT-5.6 Sol, Terra, and Luna; GPT-5.5; GPT-5.4 and Mini; '
      + 'GPT-5.3 Codex Spark. Supported models also include Fast variants.',
    fields: [{
      id: 'imageTool',
      type: 'select',
      label: 'GPT Image generation and editing',
      description: 'Expose the GPT Image 2 generation and editing tool to this provider.',
      default: 'enabled',
      options: [
        { value: 'enabled', label: 'Enabled' },
        { value: 'disabled', label: 'Disabled' },
      ],
    }],
  },
  ...responsesApi,
  getContributions: getOpenAiSubscriptionContributions,
  request: requestOpenAiSubscription,
  getState: getOpenAiSubscriptionState,
  async invokeAction({
    provider,
    action,
    input,
    services,
  }) {
    if (action === 'disconnect') {
      await signOutOpenAiSubscription(provider.id, services);
    } else if (action === 'connect') {
      const device = await startOpenAiSubscriptionLogin();
      services.clipboard.writeText(device.userCode);
      await services.shell.openExternal(device.verificationUrl);
      return {
        state: {
          connection: {
            status: 'waiting',
            statusLabel: 'Waiting for authorization',
            title: 'ChatGPT account',
            description: 'Complete the authorization in your browser.',
            verification: {
              label: 'Security code',
              value: device.userCode,
              description: 'Paste this 9-character code into the OpenAI authorization page.',
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
      await completeOpenAiSubscriptionLogin(provider.id, input?.device, services);
    } else {
      throw new Error(`Unsupported provider action: ${action}`);
    }
    return getOpenAiSubscriptionState({ provider, services });
  },
  remove: ({ provider, services }) => signOutOpenAiSubscription(provider.id, services),
});

function getOpenAiSubscriptionState({ provider, services }) {
  const signedIn = isOpenAiSubscriptionSignedIn(provider.id, services);
  return {
    connection: {
      status: signedIn ? 'connected' : 'disconnected',
      statusLabel: signedIn ? 'Connected' : 'Not connected',
      title: 'ChatGPT account',
      description:
        'OAuth credentials are encrypted locally with a key protected by the operating system.',
      action: signedIn
        ? { id: 'disconnect', label: 'Disconnect' }
        : { id: 'connect', label: 'Sign in with ChatGPT' },
    },
  };
}

function getOpenAiSubscriptionContributions({ provider, services }) {
  const models = modelDefinitions.flatMap((model) => [
    {
      ...model,
      capabilities: { images: model.imageInput, audio: false, pdfFiles: true },
      enabled: true,
    },
    ...(model.fast
      ? [{
          ...model,
          id: `${model.id}-fast`,
          name: `${model.name} (Fast)`,
          description: `${model.description} Uses priority processing for lower latency.`,
          capabilities: { images: model.imageInput, audio: false, pdfFiles: true },
          serviceTier: 'priority',
          enabled: true,
        }]
      : []),
  ]);

  return {
    models,
    tools: provider.imageTool === 'disabled' ? [] : [{
      name: 'openai_subscription_generate_or_edit_image',
      description:
        'Generate a new image or edit one or more local reference images with GPT Image 2.',
      globallyAvailable: true,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Complete visual instructions for the generated or edited image.',
          },
          referenced_image_paths: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5,
            description: 'Absolute paths to local images used as edit targets or references.',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      canEditFile: true,
      canPerformDestructiveActions: false,
      execute: (input, context) => generateOrEditImage(provider.id, input, context, services),
    }],
    auxiliaryPanels: [{
      id: 'usage',
      title: `${provider.name} — OpenAI usage`,
      icon: 'gauge',
      load: () => readUsage(provider.id, services),
      invokeAction: (action, input) => invokeUsageAction(provider.id, action, input, services),
    }],
  };
}

function isOpenAiSubscriptionSignedIn(providerId, services) {
  return Boolean(services.credentials.get(providerId)?.refreshToken);
}

async function startOpenAiSubscriptionLogin() {
  const response = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!response.ok) {
    throw new Error(`Unable to start ChatGPT sign-in (${response.status}).`);
  }

  const device = await response.json();
  const userCode = device.user_code ?? device.usercode;
  if (!device.device_auth_id || !userCode) {
    throw new Error('The authentication server did not return a device code.');
  }

  return {
    deviceAuthId: device.device_auth_id,
    userCode,
    interval: Math.max(Number(device.interval) || 5, 1),
    verificationUrl: `${AUTH_BASE_URL}/codex/device`,
  };
}

async function completeOpenAiSubscriptionLogin(providerId, device, services) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15 * 60 * 1_000) {
    const pollResponse = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: device.deviceAuthId,
        user_code: device.userCode,
      }),
    });

    if (pollResponse.ok) {
      const code = await pollResponse.json();
      const tokenResponse = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code.authorization_code,
          redirect_uri: `${AUTH_BASE_URL}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: code.code_verifier,
        }),
      });
      if (!tokenResponse.ok) {
        const oauthError = await readOAuthError(tokenResponse);
        traceError('provider.auth-login-error', {
          provider_id: providerId,
          status: tokenResponse.status,
          code: oauthError.code,
          error: `OAuth code exchange failed (${oauthError.code || tokenResponse.status}).`,
        });
        throw new Error(
          `OAuth code exchange failed (${oauthError.code || tokenResponse.status}).`,
        );
      }

      const tokens = await tokenResponse.json();
      const accountId = decodeJwtPayload(tokens.id_token)?.['https://api.openai.com/auth']
        ?.chatgpt_account_id;
      if (typeof accountId !== 'string' || !accountId) {
        throw new Error('The authenticated account has no identifiable Codex access.');
      }

      signedOutProviders.delete(providerId);
      await services.credentials.set(providerId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        accountId,
      });
      traceVerbose('provider.auth-login-completed', { provider_id: providerId });
      return { signedIn: true };
    }

    if (![403, 404].includes(pollResponse.status)) {
      throw new Error(`Device sign-in failed (${pollResponse.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, device.interval * 1_000));
  }

  throw new Error('Sign-in expired after 15 minutes.');
}

async function signOutOpenAiSubscription(providerId, services) {
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

async function requestOpenAiSubscription({
  provider,
  body,
  signal,
  invocationContext,
  services,
}) {
  const sessionId = invocationContext.conversationId ?? randomUUID();
  const requestBody = {
    ...body,
    ...(body.reasoning
      ? { reasoning: { ...body.reasoning, summary: 'auto' } }
      : {}),
    instructions: body.instructions ?? '',
    tool_choice: 'auto',
    parallel_tool_calls: true,
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: sessionId,
  };
  const send = async (forceRefresh = false) => {
    const tokens = await getTokens(provider.id, services, forceRefresh);
    return fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${tokens.accessToken}`,
        'ChatGPT-Account-ID': tokens.accountId,
        'Content-Type': 'application/json',
        originator: 'codex_vscode',
        'session-id': sessionId,
        'thread-id': sessionId,
        'x-client-request-id': randomUUID(),
      },
      body: JSON.stringify(requestBody),
      signal,
    });
  };

  const response = await send();
  return response.status === 401 ? send(true) : response;
}

async function getTokens(providerId, services, forceRefresh = false) {
  const tokens = services.credentials.get(providerId);
  if (!tokens) {
    throw new Error('Sign in with ChatGPT in Settings before using this provider.');
  }

  const expiresAt = Number(decodeJwtPayload(tokens.accessToken)?.exp) * 1_000;
  if (!forceRefresh && Number.isFinite(expiresAt) && expiresAt > Date.now() + 5 * 60 * 1_000) {
    return tokens;
  }

  if (!refreshPromises.has(providerId)) {
    refreshPromises.set(providerId, fetch(`${AUTH_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    }).then(async (response) => {
      if (!response.ok) {
        const oauthError = await readOAuthError(response);
        traceError('provider.auth-refresh-error', {
          provider_id: providerId,
          status: response.status,
          code: oauthError.code,
          error: `Token refresh failed (${oauthError.code || response.status}).`,
        });
        const reconnectRequired = response.status === 401 || [
          'refresh_token_expired',
          'refresh_token_invalidated',
          'refresh_token_reused',
          'token_expired',
        ].includes(oauthError.code);
        throw new Error(reconnectRequired
          ? `The ChatGPT session expired (${oauthError.code || response.status}). Sign in again.`
          : `Unable to refresh the ChatGPT session (${oauthError.code || response.status}).`);
      }
      const refreshed = await response.json();
      if (typeof refreshed.access_token !== 'string' || !refreshed.access_token) {
        traceError('provider.auth-refresh-error', {
          provider_id: providerId,
          status: response.status,
          code: 'missing_access_token',
          error: 'The token refresh response did not include an access token.',
        });
        throw new Error('The ChatGPT token refresh returned no access token.');
      }
      const refreshedAccountId = decodeJwtPayload(refreshed.id_token)
        ?.['https://api.openai.com/auth']?.chatgpt_account_id;
      const nextTokens = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
        idToken: refreshed.id_token ?? tokens.idToken,
        accountId: typeof refreshedAccountId === 'string' && refreshedAccountId
          ? refreshedAccountId
          : tokens.accountId,
      };
      if (signedOutProviders.has(providerId)) {
        throw new Error('The ChatGPT session was disconnected.');
      }
      await services.credentials.set(providerId, nextTokens);
      traceVerbose('provider.auth-refresh-completed', { provider_id: providerId });
      return nextTokens;
    }).finally(() => refreshPromises.delete(providerId)));
  }

  return refreshPromises.get(providerId);
}

async function readOAuthError(response) {
  const text = (await response.text()).slice(0, 2_000);
  try {
    const payload = JSON.parse(text);
    const error = payload?.error;
    return {
      code: String(
        (error && typeof error === 'object' ? error.code : error)
        ?? payload?.code
        ?? '',
      ).slice(0, 120),
    };
  } catch {
    return { code: '' };
  }
}

async function requestAccountJson(providerId, path, services, init = {}) {
  const send = async (forceRefresh = false) => {
    const tokens = await getTokens(providerId, services, forceRefresh);
    return fetch(`${CHATGPT_BACKEND_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
        'ChatGPT-Account-ID': tokens.accountId,
        originator: 'codex_vscode',
        ...init.headers,
      },
    });
  };
  let response = await send();
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    throw new Error(`The ChatGPT account backend rejected the request (${response.status}).`);
  }
  return response.json();
}

async function readUsage(providerId, services) {
  if (!isOpenAiSubscriptionSignedIn(providerId, services)) {
    return {
      state: {
        title: 'ChatGPT sign-in required',
        description: 'Connect this provider in Settings to view subscription usage.',
      },
      sections: [],
    };
  }

  const [usagePayload, resetPayload] = await Promise.all([
    requestAccountJson(providerId, '/wham/usage', services),
    requestAccountJson(providerId, '/wham/rate-limit-reset-credits', services),
  ]);
  const rateLimit = usagePayload?.rate_limit ?? {};
  const normalizeWindow = (window) => (
    window && Number.isFinite(Number(window.used_percent))
      ? {
          usedPercent: Math.max(0, Math.min(Number(window.used_percent), 100)),
          windowSeconds: Number(window.limit_window_seconds) || 0,
          resetAt: Number(window.reset_at) || null,
        }
      : null
  );
  const resetCredits = Array.isArray(resetPayload?.credits)
    ? resetPayload.credits.filter((credit) => (
        credit?.status === 'available' && typeof credit.id === 'string'
      )).map((credit) => ({
        id: credit.id,
        title: credit.title || 'Banked rate-limit reset',
        description: credit.description || null,
        expiresAt: credit.expires_at || null,
      }))
    : [];

  const windows = [
    ['Session usage limit', normalizeWindow(rateLimit.primary_window)],
    ['Weekly usage limit', normalizeWindow(rateLimit.secondary_window)],
  ].filter(([, window]) => window);
  const availableResetCount = Math.max(
    0,
    Number(usagePayload?.rate_limit_reset_credits?.available_count) || 0,
    resetCredits.length,
  );

  return {
    sections: [
      {
        id: 'limits',
        title: 'General usage limits',
        caption: typeof usagePayload?.plan_type === 'string'
          ? `${usagePayload.plan_type} plan`
          : null,
        items: windows.map(([title, window]) => {
          const remaining = Math.max(0, 100 - Math.round(window.usedPercent));
          return {
            id: title,
            type: 'progress',
            title,
            description: window.resetAt
              ? `Resets ${new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(window.resetAt * 1_000))}`
              : 'Reset unavailable',
            value: remaining,
            valueLabel: `${remaining}% left`,
          };
        }),
        empty: 'No usage windows were returned.',
      },
      {
        id: 'resets',
        title: 'Usage limit resets',
        caption: `${availableResetCount} available`,
        items: resetCredits.map((credit) => ({
          id: credit.id,
          type: 'action',
          title: credit.title,
          description: [
            credit.description,
            credit.expiresAt
              ? `Expires ${new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(credit.expiresAt))}`
              : null,
          ].filter(Boolean).join(' · '),
          action: {
            id: 'consume-reset',
            label: 'Use reset',
            input: { creditId: credit.id },
            confirm: 'Use this banked reset now? This action cannot be undone.',
          },
        })),
        empty: 'No banked resets are currently available.',
      },
    ],
  };
}

async function invokeUsageAction(providerId, action, input, services) {
  if (action !== 'consume-reset') {
    throw new Error(`Unsupported OpenAI usage action: ${action}`);
  }
  if (typeof input?.creditId !== 'string' || !input.creditId) {
    throw new Error('Choose an available banked reset.');
  }

  const result = await requestAccountJson(
    providerId,
    '/wham/rate-limit-reset-credits/consume',
    services,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redeem_request_id: randomUUID(),
        credit_id: input.creditId,
      }),
    },
  );
  if (!['reset', 'nothing_to_reset', 'no_credit', 'already_redeemed'].includes(result?.code)) {
    throw new Error('The backend returned an unknown reset outcome.');
  }
  return {
    panel: await readUsage(providerId, services),
    message: result.code === 'reset' ? null : 'No eligible usage window was reset.',
  };
}

async function generateOrEditImage(providerId, input, context, services) {
  const { signal, workspacePath } = context;
  const prompt = String(input?.prompt ?? '').trim();
  if (!prompt) throw new Error('prompt is required.');

  if (input?.referenced_image_paths !== undefined && !Array.isArray(input.referenced_image_paths)) {
    throw new Error('referenced_image_paths must be an array.');
  }
  const imagePaths = Array.isArray(input?.referenced_image_paths)
    ? input.referenced_image_paths.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (imagePaths.length > 5) {
    throw new Error('At most five reference images can be used.');
  }
  if (imagePaths.some((path) => !isAbsolute(path))) {
    throw new Error('Every referenced image path must be absolute.');
  }

  const endpoint = imagePaths.length > 0 ? '/codex/images/edits' : '/codex/images/generations';
  let body;
  let headers = {};

  if (imagePaths.length > 0) {
    const referenceDirectory = join(
      tmpdir(),
      '.avi',
      'imggenrefs',
      `${Date.now()}-${randomUUID()}`,
    );
    await mkdir(referenceDirectory, { recursive: true });
    try {
      const referencePaths = [];
      for (const imagePath of imagePaths) {
        const extension = extname(imagePath).toLowerCase();
        if (!IMAGE_MIME_TYPES[extension]) {
          throw new Error(`Unsupported reference image type: ${imagePath}`);
        }
        const referencePath = join(referenceDirectory, `${randomUUID()}${extension}`);
        await copyFile(imagePath, referencePath);
        referencePaths.push(referencePath);
      }

      body = new FormData();
      body.append('model', IMAGE_MODEL);
      body.append('prompt', prompt);
      body.append('size', 'auto');
      body.append('quality', 'auto');
      for (const referencePath of referencePaths) {
        body.append(
          'image[]',
          new Blob([await readFile(referencePath)], {
            type: IMAGE_MIME_TYPES[extname(referencePath).toLowerCase()],
          }),
          basename(referencePath),
        );
      }
    } finally {
      await rm(referenceDirectory, { recursive: true, force: true });
    }
  } else {
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      background: 'auto',
      quality: 'auto',
      size: 'auto',
    });
  }

  const send = async (forceRefresh = false) => {
    const tokens = await getTokens(providerId, services, forceRefresh);
    return fetch(`${CHATGPT_BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
        'ChatGPT-Account-ID': tokens.accountId,
        originator: 'codex_vscode',
        ...headers,
      },
      body,
      signal,
    });
  };
  let response = await send();
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const error = (await response.text()).slice(0, 2_000);
    throw new Error(error || `GPT Image 2 rejected the request (${response.status}).`);
  }

  const payload = await response.json();
  const imageBase64 = payload?.data?.[0]?.b64_json;
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    throw new Error('GPT Image 2 returned no image data.');
  }

  const outputDirectory = join(workspacePath || homedir(), '.aivax', 'generated-images');
  const outputPath = join(outputDirectory, `gpt-image-2-${Date.now()}.png`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, Buffer.from(imageBase64, 'base64'));
  const attachment = {
    id: randomUUID(),
    kind: 'image_url',
    source: 'generated_image',
    name: basename(outputPath),
    path: outputPath,
    dataUrl: `data:image/png;base64,${imageBase64}`,
  };
  return {
    output: `Image ${imagePaths.length > 0 ? 'edited' : 'generated'} with ${IMAGE_MODEL}.\nSaved to: ${outputPath}`,
    mediaContent: [{ type: 'image_url', image_url: { url: attachment.dataUrl } }],
    attachments: [attachment],
  };
}

function decodeJwtPayload(token) {
  try {
    const payload = String(token ?? '').split('.')[1];
    return payload
      ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      : {};
  } catch {
    return {};
  }
}
