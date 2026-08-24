import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(homedir(), '.aivax', 'cliproxyapi');
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5_000;
const processes = new Map();
const catalogs = new Map();

const families = [
  {
    id: 'cliproxyapi-gemini',
    name: 'CLIProxyAPI · Google Gemini',
    defaultName: 'Google Gemini via CLIProxyAPI',
    description: 'Google Gemini models exposed by a managed CLIProxyAPI sidecar.',
    family: 'Gemini',
    matches: new Set(['google', 'gemini']),
  },
  {
    id: 'cliproxyapi-anthropic',
    name: 'CLIProxyAPI · Anthropic',
    defaultName: 'Anthropic via CLIProxyAPI',
    description: 'Anthropic Claude models exposed by a managed CLIProxyAPI sidecar.',
    family: 'Anthropic',
    matches: new Set(['anthropic', 'claude']),
  },
  {
    id: 'cliproxyapi-cursor',
    name: 'CLIProxyAPI · Cursor',
    defaultName: 'Cursor via CLIProxyAPI',
    description: 'Cursor models exposed by a CLIProxyAPI build or plugin with Cursor support.',
    family: 'Cursor',
    matches: new Set(['cursor']),
  },
];

const fields = [
  {
    id: 'executablePath',
    type: 'text',
    label: 'CLIProxyAPI executable',
    description: 'Absolute path to the CLIProxyAPI executable.',
    placeholder: 'C:\\Tools\\CLIProxyAPI\\CLIProxyAPI.exe',
  },
  {
    id: 'proxyUrl',
    type: 'text',
    label: 'Upstream proxy URL',
    description: 'Optional socks5, HTTP, or HTTPS URL written to proxy-url.',
    placeholder: 'socks5://127.0.0.1:1080',
  },
  {
    id: 'authDirectory',
    type: 'text',
    label: 'Authentication directory',
    description: 'Optional CLIProxyAPI auth directory. Defaults to ~/.cli-proxy-api.',
    placeholder: '~/.cli-proxy-api',
  },
  {
    id: 'lifetime',
    type: 'select',
    label: 'Process lifetime',
    description: 'Keep the sidecar for Avi or stop it after 15 minutes without a completed request.',
    default: 'avi',
    options: [
      { value: 'avi', label: 'Until Avi closes' },
      { value: 'idle-15', label: 'Stop after 15 idle minutes' },
    ],
  },
];

export default {
  apiVersion: 2,
  id: 'cliproxyapi-provider',
  name: 'CLIProxyAPI Providers',
  version: '1.0.0',
  description: 'Runs CLIProxyAPI as a managed sidecar for Gemini, Anthropic, and Cursor catalogs.',
  capabilities: [],
  contributions: {
    providers: families.map((family) => ({
      descriptor: {
        id: family.id,
        name: family.name,
        defaultName: family.defaultName,
        description: family.description,
        endpoint: '/v1/chat/completions',
        icon: 'server',
        connection: 'managed',
        models: 'managed',
        modelsDescription: `${family.family} models discovered from CLIProxyAPI.`,
        fields,
      },
      createBody,
      request,
      eventsFrom,
      getContributions: ({ provider }) => ({ models: readCatalog(provider.id) }),
      getState: ({ provider }) => providerState(provider),
      invokeAction: ({ provider, action }) => invokeAction(provider, action),
      refresh: ({ provider }) => refreshProvider(provider),
      remove: ({ provider }) => removeProvider(provider.id),
    })),
  },
  deactivate: () => Promise.all([...processes.keys()].map(stopSidecar)),
};

async function createBody({ model, messages, reasoningEffort, tools, toolHistory }) {
  return {
    model: model.modelId,
    messages: [
      ...messages,
      ...toolHistory.flatMap((round) => [
        {
          role: 'assistant',
          content: round.assistantContent || null,
          ...(round.reasoningContent ? { reasoning_content: round.reasoningContent } : {}),
          ...(round.toolCalls.length ? {
            tool_calls: round.toolCalls.map((toolCall) => ({
              id: toolCall.callId,
              type: 'function',
              function: { name: toolCall.name, arguments: toolCall.argumentsText },
            })),
          } : {}),
        },
        ...round.results.flatMap((result) => [
          { role: 'tool', tool_call_id: result.callId, content: result.output },
          ...(result.mediaContent?.length ? [{ role: 'user', content: result.mediaContent }] : []),
        ]),
        ...(round.messages ?? []),
      ]),
    ],
    ...(tools.length ? {
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: false,
        },
      })),
    } : {}),
    stream: true,
    stream_options: { include_usage: true },
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
}

async function request({ provider, body, signal }) {
  const sidecar = await ensureSidecar(provider);
  const response = await fetch(`http://127.0.0.1:${sidecar.port}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${sidecar.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (provider.lifetime !== 'idle-15' || !response.body) return response;
  return new Response(response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
    flush() {
      scheduleIdleStop(provider.id);
    },
  })), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function eventsFrom(payload) {
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
    const reasoning = delta.reasoning || delta.reasoning_content || '';
    if (reasoning) events.push({ type: 'reasoning', text: reasoning });
    if (typeof delta.content === 'string' && delta.content) {
      events.push({ type: 'content', text: delta.content });
    }
    for (const toolCall of delta.tool_calls ?? []) {
      if (!Number.isInteger(toolCall.index) || toolCall.index < 0) {
        events.push({
          type: 'error',
          code: 'provider_error',
          message: 'CLIProxyAPI returned a tool call without a valid index.',
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
      events.push({ type: 'error', code: 'stream_error', message: 'CLIProxyAPI stopped with an error.' });
    }
  }
  if (payload?.usage) {
    const inputTokens = payload.usage.input_tokens ?? payload.usage.prompt_tokens ?? 0;
    const outputTokens = payload.usage.output_tokens ?? payload.usage.completion_tokens ?? 0;
    events.push({
      type: 'usage',
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens:
          payload.usage.input_tokens_details?.cached_tokens
          ?? payload.usage.prompt_tokens_details?.cached_tokens
          ?? 0,
        reasoningTokens:
          payload.usage.output_tokens_details?.reasoning_tokens
          ?? payload.usage.completion_tokens_details?.reasoning_tokens
          ?? 0,
        totalTokens: payload.usage.total_tokens ?? inputTokens + outputTokens,
      },
    });
  }
  return events;
}

async function refreshProvider(provider) {
  try {
    const sidecar = await ensureSidecar(provider);
    const response = await fetch(`http://127.0.0.1:${sidecar.port}/v1/models`, {
      headers: { Authorization: `Bearer ${sidecar.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Model discovery failed with HTTP ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) throw new Error('CLIProxyAPI returned an invalid model catalog.');
    const family = families.find((item) => item.id === provider.interface);
    const models = payload.data
      .filter((model) => family?.matches.has(String(model.owned_by ?? '').toLowerCase())
        || family?.matches.has(String(model.type ?? '').toLowerCase()))
      .map((model) => {
        const input = Number(model.context_length ?? model.max_input_tokens);
        const output = Number(model.max_completion_tokens ?? model.max_tokens);
        const supportsReasoning = Boolean(model.thinking)
          || (Array.isArray(model.supported_parameters)
            && model.supported_parameters.some((parameter) => String(parameter).includes('reasoning')));
        return {
          id: String(model.id ?? '').trim(),
          name: String(model.display_name ?? model.name ?? model.id ?? '').trim(),
          enabled: true,
          capabilities: { images: false, audio: false, pdfFiles: false, video: false },
          context: {
            input: Number.isInteger(input) && input > 0 ? input : null,
            output: Number.isInteger(output) && output > 0 ? output : null,
          },
          reasoning: supportsReasoning ? ['low', 'medium', 'high'] : [],
        };
      })
      .filter((model) => model.id)
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    if (!models.length) {
      const cursorHint = family?.family === 'Cursor'
        ? ' The official CLIProxyAPI v7.2.140 build does not include Cursor; configure openai-compatibility or a CLIProxyAPI plugin that exposes Cursor models.'
        : '';
      throw new Error(`CLIProxyAPI did not expose any ${family?.family ?? 'matching'} models.${cursorHint}`);
    }
    catalogs.set(provider.id, models);
    mkdirSync(join(ROOT, provider.id), { recursive: true });
    writeFileSync(join(ROOT, provider.id, 'models.json'), `${JSON.stringify(models, null, 2)}\n`, 'utf8');
    if (provider.lifetime === 'idle-15') scheduleIdleStop(provider.id);
  } catch (error) {
    await stopSidecar(provider.id);
    throw error;
  }
}

function readCatalog(providerId) {
  if (catalogs.has(providerId)) return catalogs.get(providerId);
  try {
    const models = JSON.parse(readFileSync(join(ROOT, providerId, 'models.json'), 'utf8'));
    if (!Array.isArray(models)) return [];
    catalogs.set(providerId, models);
    return models;
  } catch {
    return [];
  }
}

async function ensureSidecar(provider) {
  const executableValue = String(provider.executablePath ?? '').trim();
  if (!executableValue) throw new Error('Choose the CLIProxyAPI executable.');
  const executablePath = resolve(executableValue);
  if (!existsSync(executablePath)) {
    throw new Error(`CLIProxyAPI executable was not found at "${executablePath}".`);
  }
  const fingerprint = JSON.stringify([executablePath, provider.proxyUrl, provider.authDirectory]);
  const existing = processes.get(provider.id);
  if (existing && existing.child.exitCode == null && existing.fingerprint === fingerprint) {
    clearTimeout(existing.idleTimer);
    existing.idleTimer = null;
    return existing;
  }
  if (existing) await stopSidecar(provider.id);

  const port = await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
  const apiKey = randomBytes(32).toString('hex');
  const directory = join(ROOT, provider.id);
  const configPath = join(directory, 'config.yaml');
  mkdirSync(directory, { recursive: true });
  writeFileSync(configPath, [
    'host: "127.0.0.1"',
    `port: ${port}`,
    `auth-dir: ${JSON.stringify(String(provider.authDirectory ?? '').trim() || '~/.cli-proxy-api')}`,
    `api-keys: [${JSON.stringify(apiKey)}]`,
    `proxy-url: ${JSON.stringify(String(provider.proxyUrl ?? '').trim())}`,
    'debug: false',
    'remote-management:',
    '  allow-remote: false',
    '  secret-key: ""',
    '  disable-control-panel: true',
    '',
  ].join('\n'), 'utf8');

  const child = spawn(executablePath, ['-config', configPath], {
    cwd: dirname(executablePath),
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const sidecar = { child, port, apiKey, fingerprint, idleTimer: null, stderr: '' };
  processes.set(provider.id, sidecar);
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    sidecar.stderr = `${sidecar.stderr}${chunk}`.slice(-4_096);
  });
  child.once('exit', () => {
    clearTimeout(sidecar.idleTimer);
    if (processes.get(provider.id) === sidecar) processes.delete(provider.id);
  });

  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode != null) throw new Error(`CLIProxyAPI exited with code ${child.exitCode}.`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) return sidecar;
      } catch {}
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    }
    throw new Error(`CLIProxyAPI did not start within ${START_TIMEOUT_MS / 1_000} seconds.`);
  } catch (error) {
    await stopSidecar(provider.id);
    const details = sidecar.stderr.trim();
    throw new Error(details ? `${error.message} CLIProxyAPI: ${details}` : error.message);
  }
}

function scheduleIdleStop(providerId) {
  const sidecar = processes.get(providerId);
  if (!sidecar) return;
  clearTimeout(sidecar.idleTimer);
  sidecar.idleTimer = setTimeout(() => stopSidecar(providerId), 15 * 60_000);
  sidecar.idleTimer.unref();
}

async function stopSidecar(providerId) {
  const sidecar = processes.get(providerId);
  if (!sidecar) return;
  processes.delete(providerId);
  clearTimeout(sidecar.idleTimer);
  if (sidecar.child.exitCode != null) return;
  sidecar.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => sidecar.child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, STOP_TIMEOUT_MS)),
  ]);
  if (sidecar.child.exitCode == null) sidecar.child.kill('SIGKILL');
}

function providerState(provider) {
  const sidecar = processes.get(provider.id);
  const running = Boolean(sidecar && sidecar.child.exitCode == null);
  const modelCount = readCatalog(provider.id).length;
  return {
    connection: {
      status: running ? 'connected' : 'disconnected',
      statusLabel: running ? 'Running' : 'Stopped',
      title: 'CLIProxyAPI sidecar',
      description: modelCount
        ? `${modelCount} models discovered. Generated config: ${join(ROOT, provider.id, 'config.yaml')}`
        : 'Save or refresh this provider to start CLIProxyAPI and discover models.',
      action: { id: running ? 'stop' : 'refresh', label: running ? 'Stop' : 'Start and refresh models' },
    },
  };
}

async function invokeAction(provider, action) {
  if (action === 'stop') await stopSidecar(provider.id);
  else if (action === 'refresh') await refreshProvider(provider);
  else throw new Error(`Unsupported CLIProxyAPI action: ${action}`);
  return providerState(provider);
}

async function removeProvider(providerId) {
  await stopSidecar(providerId);
  catalogs.delete(providerId);
  rmSync(join(ROOT, providerId), { recursive: true, force: true });
}
