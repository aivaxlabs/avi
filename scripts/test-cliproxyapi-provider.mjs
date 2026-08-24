import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginManager } from '../src/main/plugin-manager.js';
import { ModelProviderRegistry } from '../src/main/model-provider.js';

const root = await mkdtemp(join(tmpdir(), 'avi-cliproxyapi-provider-'));
const pluginsDir = join(root, 'plugins');
const pluginDir = join(pluginsDir, 'cliproxyapi-provider');
const sourcePlugin = join(import.meta.dirname, '..', 'plugins', 'cliproxyapi-provider', 'plugin.js');
const fakeExecutable = join(root, process.platform === 'win32' ? 'fake-cliproxyapi.cmd' : 'fake-cliproxyapi');
const fakeServer = join(root, 'fake-cliproxyapi-server.mjs');
const fakePidFile = join(root, 'fake-cliproxyapi.pid');
const providerId = `cliproxyapi-test-${process.pid}-${Date.now()}`;
const managedDirectory = join(homedir(), '.aivax', 'cliproxyapi', providerId);

try {
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, 'plugin.js'), await readFile(sourcePlugin));
  await writeFile(fakeServer, `
    import { createServer } from 'node:http';
    import { readFileSync, writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(fakePidFile)}, String(process.pid));
    const configPath = process.argv[process.argv.indexOf('-config') + 1];
    const config = readFileSync(configPath, 'utf8');
    const port = Number(config.match(/^port:\\s*(\\d+)$/m)?.[1]);
    const key = JSON.parse(config.match(/^api-keys:\\s*\\[(.+)\\]$/m)?.[1]);
    const models = [
      { id: 'gemini-test', owned_by: 'google', type: 'gemini', display_name: 'Gemini Test', context_length: 123000, max_completion_tokens: 4000, thinking: {} },
      { id: 'claude-test', owned_by: 'anthropic', type: 'claude', display_name: 'Claude Test', context_length: 200000, max_completion_tokens: 64000 },
      { id: 'cursor-test', owned_by: 'cursor', type: 'cursor', display_name: 'Cursor Test' },
    ];
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== \`Bearer \${key}\`) {
        response.writeHead(401).end();
        return;
      }
      if (request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ object: 'list', data: models }));
        return;
      }
      if (request.url === '/v1/chat/completions') {
        response.setHeader('content-type', 'text/event-stream');
        response.end('data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\\n\\ndata: [DONE]\\n\\n');
        return;
      }
      response.writeHead(404).end();
    });
    server.listen(port, '127.0.0.1');
    const stop = () => server.close(() => process.exit(0));
    const parentPid = process.ppid;
    setInterval(() => {
      try { process.kill(parentPid, 0); } catch { stop(); }
    }, 100).unref();
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  `);

  if (process.platform === 'win32') {
    await writeFile(fakeExecutable, `@echo off\r\n"${process.execPath}" "${fakeServer}" %*\r\n`);
  } else {
    await writeFile(fakeExecutable, `#!/bin/sh\nexec "${process.execPath}" "${fakeServer}" "$@"\n`);
    await chmod(fakeExecutable, 0o755);
  }

  const manager = new PluginManager({ pluginsDir });
  const status = await manager.initialize();
  assert.deepEqual(status.failures, []);
  const types = manager.getProviderTypes();
  assert.deepEqual(types.map((type) => type.descriptor.id), [
    'cliproxyapi-gemini',
    'cliproxyapi-anthropic',
    'cliproxyapi-cursor',
  ]);

  let providers = [{
    id: providerId,
    name: 'Gemini Test',
    interface: 'cliproxyapi-gemini',
    enabled: true,
    executablePath: fakeExecutable,
    proxyUrl: 'socks5://127.0.0.1:1080',
    authDirectory: '~/.cli-proxy-api-test',
    lifetime: 'avi',
    models: [],
  }];
  const registry = new ModelProviderRegistry({
    getProviders: () => providers,
    providerTypes: () => manager.getProviderTypes(),
    services: {},
  });

  providers = [registry.normalizeConfig(providers[0])];
  assert.equal((await registry.getState(providerId)).connection.status, 'disconnected');
  await registry.refresh(providerId);
  assert.equal((await registry.getState(providerId)).connection.status, 'connected');
  const [gemini] = registry.listModels();
  assert.equal(gemini.id, `${providerId}:gemini-test`);
  assert.equal(gemini.name, 'Gemini Test');
  assert.deepEqual(gemini.context, { input: 123000, output: 4000 });
  assert.deepEqual(gemini.reasoning, ['low', 'medium', 'high']);

  const generatedConfig = await readFile(join(managedDirectory, 'config.yaml'), 'utf8');
  assert.match(generatedConfig, /^host: "127\.0\.0\.1"$/m);
  assert.match(generatedConfig, /^proxy-url: "socks5:\/\/127\.0\.0\.1:1080"$/m);
  assert.match(generatedConfig, /^auth-dir: "~\/\.cli-proxy-api-test"$/m);
  assert.doesNotMatch(generatedConfig, /your-api-key/);

  const implementation = types.find((type) => type.descriptor.id === 'cliproxyapi-gemini');
  const response = await implementation.request({
    provider: providers[0],
    body: { model: 'gemini-test', messages: [], stream: true },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.ok, true);
  assert.match(await response.text(), /"content":"ok"/);
  assert.deepEqual(implementation.eventsFrom({
    choices: [{ index: 0, delta: { content: 'ok' } }],
  }), [{ type: 'content', text: 'ok' }]);

  providers = [{ ...providers[0], interface: 'cliproxyapi-cursor', name: 'Cursor Test' }];
  await registry.refresh(providerId);
  assert.equal(registry.listModels()[0].modelId, 'cursor-test');

  await manager.deactivateAll('test');
  await implementation.remove({ provider: providers[0], services: {} });
  await assert.rejects(() => readFile(join(managedDirectory, 'config.yaml')), /ENOENT/);
  console.log('CLIProxyAPI provider plugin checks passed.');
} finally {
  if (process.platform === 'win32') {
    const fakePid = Number(await readFile(fakePidFile, 'utf8').catch(() => ''));
    if (Number.isInteger(fakePid)) {
      Bun.spawnSync(['taskkill.exe', '/pid', String(fakePid), '/t', '/f']);
    }
  }
  await rm(managedDirectory, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
