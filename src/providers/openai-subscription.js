import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import {
  basename,
  extname,
  isAbsolute,
  join,
} from 'node:path';
import { defineProvider } from '../main/provider-api.js';
import { responsesApi } from './openai-compatible.js';

const CHATGPT_BACKEND_URL = 'https://chatgpt.com/backend-api';
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
    name: 'OpenAI Codex',
    defaultName: 'OpenAI Codex',
    description: 'Uses the existing Codex CLI OAuth session',
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
  invokeAction: () => {
    throw new Error('Codex CLI credentials are read-only in Avi.');
  },
});

function getOpenAiSubscriptionState() {
  const credential = readCodexCliCredential();
  const signedIn = Boolean(credential?.accessToken && credential?.accountId);
  return {
    connection: {
      status: signedIn ? 'connected' : 'disconnected',
      statusLabel: signedIn ? 'Connected' : 'Not connected',
      title: 'Codex CLI account',
      description: signedIn
        ? `Using the existing Codex CLI session from ${codexAuthPath()}.`
        : `Run \`codex login\` to create ${codexAuthPath()}; Avi never opens its own ChatGPT sign-in flow.`,
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
    const tokens = getTokens();
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

function codexAuthPath() {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  return join(codexHome, 'auth.json');
}

function readCodexCliCredential() {
  try {
    const payload = JSON.parse(readFileSync(codexAuthPath(), 'utf8'));
    const tokens = payload?.tokens;
    const accessToken = typeof tokens?.access_token === 'string'
      ? tokens.access_token.trim()
      : '';
    const accountId = decodeJwtPayload(tokens?.id_token)?.['https://api.openai.com/auth']
      ?.chatgpt_account_id;
    if (!accessToken || typeof accountId !== 'string' || !accountId) return null;
    return { accessToken, accountId };
  } catch {
    return null;
  }
}

function getTokens() {
  const credential = readCodexCliCredential();
  if (!credential?.accessToken || !credential.accountId) {
    throw new Error(
      `Codex CLI credentials were not found in ${codexAuthPath()}. Run \`codex login\` first.`,
    );
  }
  return credential;
}

async function requestAccountJson(providerId, path, services, init = {}) {
  const send = async (forceRefresh = false) => {
    const tokens = getTokens();
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
  if (!readCodexCliCredential()) {
    return {
      state: {
        title: 'Codex CLI sign-in required',
        description: `Run \`codex login\` to create ${codexAuthPath()}.`,
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
    const tokens = getTokens();
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
