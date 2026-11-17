import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Downloads the real package and its Electron, so it needs network access and is not part of test:built-ins.
const PORT = 55398;
const home = await mkdtemp(join(tmpdir(), 'avi-browser-mcp-test-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.BROWSER_MCP_SENTINEL_PORT = String(PORT);
process.env.BROWSER_MCP_DATA_DIR = join(home, 'profile');
assert.equal(resolve(homedir()), resolve(home));
await mkdir(join(home, 'AppData', 'Roaming'), { recursive: true });
await mkdir(join(home, 'AppData', 'Local'), { recursive: true });

const { PluginManager } = await import('../src/main/plugin-manager.js');
const health = () => fetch(`http://127.0.0.1:${PORT}/health`).then((response) => response.ok, () => false);
const until = async (expected, timeoutMs) => {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    if (await health() === expected) return true;
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
};
const options = {
  pluginsDir: join(home, 'plugins'),
  builtInPluginsDir: fileURLToPath(new URL('../built-in-plugins/', import.meta.url)),
  getBuiltInPluginState: () => ({ 'browser-mcp': true }),
  setBuiltInPluginState: () => {},
};
const manager = new PluginManager(options);
const restarted = new PluginManager(options);

try {
  assert.equal(await health(), false, `port ${PORT} must be free`);
  assert.equal(existsSync(new URL('../built-in-plugins/browser-mcp/node_modules', import.meta.url)), false, 'the package is not distributed');
  await manager.initialize();
  assert.deepEqual(manager.getFailures(), []);

  const [server] = manager.getContributions('mcps');
  assert.equal(server.config.url, `http://127.0.0.1:${PORT}/mcp`);
  assert.equal(server.config.lifecycle, 'active');

  const context = manager.getContributions('context').map((item) => item.path);
  assert.ok(context.includes('AGENTS.md'));
  assert.ok(context.includes('skills/browser-mcp/SKILL.md'));
  assert.equal(context.filter((path) => path.startsWith('skills/browser-mcp/references/')).length, 10);

  const startedAt = Date.now();
  await manager.activateAll();
  assert.deepEqual(manager.getFailures(), []);
  assert.ok(Date.now() - startedAt < 5_000, 'activation does not wait for the installation');
  assert.equal(await until(true, 240_000), true, 'first use installs the package and starts the daemon');
  assert.ok(existsSync(join(home, '.aivax', 'browser-mcp', 'node_modules', '@cypherpotato', 'browser-mcp', 'package.json')));

  const client = new Client({ name: 'avi-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.config.url)));
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['browser_get_context', 'browser_import_session', 'browser_run_actions', 'browser_toggle_session'],
  );

  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const page = 'data:text/html,<title>Avi</title><button>Save</button>';
  const { session_id } = await call('browser_toggle_session', { action: 'start', start_url: page });
  const snapshot = await call('browser_run_actions', { session_id, code: 'return browser.snapshot();' });
  assert.match(snapshot.result, /button "Save" \[ref=e\d+\]/);
  await call('browser_toggle_session', { action: 'stop', session_id });
  await client.close();

  await manager.deactivateAll('test');
  assert.equal(await until(false, 5_000), true, 'deactivation stops the daemon');

  await restarted.initialize();
  await restarted.activateAll();
  assert.deepEqual(restarted.getFailures(), []);
  assert.equal(await health(), true, 'with the package installed, activation returns with the daemon answering');
  await restarted.deactivateAll('test');
  assert.equal(await until(false, 5_000), true, 'deactivation stops the restarted daemon');
  console.log(`Browser MCP first-use install, daemon start, MCP session and shutdown checks passed in ${Math.round((Date.now() - startedAt) / 1000)} s.`);
} finally {
  await manager.deactivateAll('test');
  await restarted.deactivateAll('test');
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
process.exit(0);
