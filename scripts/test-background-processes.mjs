import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createPlugin from '../built-in-plugins/background-processes/plugin.js';

const NODE = 'node';
const root = await mkdtemp(join(tmpdir(), 'avi-background-processes-'));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (predicate, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms.`);
};
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const store = new Map();
const deactivateHandlers = [];
let page;
const definition = createPlugin({ definePlugin: (value) => value });
const invoke = (action, input) => page.invokeAction(action, input, {});
const find = async (id) => (await invoke('list')).find((entry) => entry.id === id);

try {
  const loop = join(root, 'loop.js');
  const fail = join(root, 'fail.js');
  await writeFile(loop, `process.stdout.write('x'.repeat(30000) + 'END'); console.error('err-line'); setInterval(() => {}, 1000);`);
  await writeFile(fail, `console.log('ran'); process.exit(3);`);
  const leafPidFile = join(root, 'leaf.pid');
  const leaf = join(root, 'leaf.js');
  await writeFile(leaf, `require('fs').writeFileSync(${JSON.stringify(leafPidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);

  await definition.activate({
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => { store.set(key, structuredClone(value)); },
    },
    lifecycle: { onDeactivate: (handler) => deactivateHandlers.push(handler) },
    actionPages: { register: (descriptor) => { page = descriptor; } },
  });
  assert.match((await page.load({})).html, /Background Processes/);
  assert.deepEqual(await invoke('list'), []);

  await assert.rejects(invoke('save', { executable: '', retry: 'none' }), /Executable is required/);
  await assert.rejects(invoke('save', { executable: 'node', retry: '10s' }), /Retry must be/);
  await assert.rejects(invoke('save', { executable: 'node', retry: 'none', workingDirectory: join(root, 'missing') }), /Working directory/);

  const [loopProcess] = await invoke('save', {
    executable: NODE,
    arguments: JSON.stringify(loop),
    workingDirectory: root,
    retry: 'none',
    enabled: true,
  });
  assert.equal(loopProcess.status, 'running');
  assert.equal(store.get('processes')[0].executable, NODE);

  const logs = await waitFor(async () => {
    const value = await invoke('logs', { id: loopProcess.id });
    return value.stdout.endsWith('END') && value.stderr.includes('err-line') ? value : null;
  });
  assert.equal(Buffer.byteLength(logs.stdout), 10 * 1024, 'stdout keeps the newest 10 KiB');
  const { pid } = await waitFor(() => find(loopProcess.id).then((entry) => entry.pid && entry));
  assert.ok(isAlive(pid));

  await invoke('restart', { id: loopProcess.id });
  const restarted = await waitFor(() => find(loopProcess.id).then((entry) => entry.pid && entry.pid !== pid && entry));
  await waitFor(() => !isAlive(pid));
  assert.equal(restarted.status, 'running');

  await invoke('setEnabled', { id: loopProcess.id, enabled: false });
  const disabled = await find(loopProcess.id);
  assert.equal(disabled.status, 'disabled');
  assert.equal(store.get('processes')[0].enabled, false);
  await waitFor(() => !isAlive(restarted.pid));
  await invoke('start', { id: loopProcess.id });
  assert.equal((await find(loopProcess.id)).status, 'disabled', 'disabled processes do not start');

  const [, failing] = await invoke('save', {
    executable: NODE,
    arguments: JSON.stringify(fail),
    workingDirectory: root,
    retry: '2s',
  });
  const retrying = await waitFor(() => find(failing.id).then((entry) => entry.status === 'retrying' && entry));
  assert.equal(retrying.exitCode, 3);
  assert.ok(retrying.retryAt - Date.now() <= 2_000);
  await waitFor(async () => (await invoke('logs', { id: failing.id })).stdout.split('ran').length > 2, 6_000);
  await invoke('stop', { id: failing.id });
  assert.equal((await find(failing.id)).status, 'stopped');

  await invoke('setEnabled', { id: loopProcess.id, enabled: true });
  const running = await waitFor(() => find(loopProcess.id).then((entry) => entry.pid && entry));
  await Promise.all(deactivateHandlers.map((handler) => handler()));
  await waitFor(() => !isAlive(running.pid));

  await invoke('remove', { id: failing.id });
  assert.equal(store.get('processes').length, 1);

  const orphanScript = join(root, 'orphan-host.mjs');
  await writeFile(orphanScript, `
    import createPlugin from ${JSON.stringify(new URL('../built-in-plugins/background-processes/plugin.js', import.meta.url).href)};
    const definition = createPlugin({ definePlugin: (value) => value });
    let page;
    const store = new Map([['processes', [{ id: 'a', executable: ${JSON.stringify(NODE)}, arguments: ${JSON.stringify(JSON.stringify(leaf))}, workingDirectory: '', retry: 'none', enabled: true }]]]);
    await definition.activate({
      storage: { get: async (key) => store.get(key) ?? null, set: async () => {} },
      lifecycle: { onDeactivate: () => {} },
      actionPages: { register: (descriptor) => { page = descriptor; } },
    });
    const timer = setInterval(async () => {
      const [entry] = await page.invokeAction('list');
      if (entry.pid) { clearInterval(timer); process.send(entry.pid); }
    }, 50);
  `);
  const host = fork(orphanScript, { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  await new Promise((resolve) => host.once('message', resolve));
  const leafPid = Number(await waitFor(() => readFile(leafPidFile, 'utf8').catch(() => null)));
  assert.ok(isAlive(leafPid));
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(host.pid), '/F']);
  else host.kill('SIGKILL');
  await waitFor(() => !isAlive(leafPid));

  console.log('Background Processes plugin tests passed.');
} finally {
  await Promise.all(deactivateHandlers.map((handler) => handler()));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(0);
