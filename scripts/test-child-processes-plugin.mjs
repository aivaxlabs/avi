import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginManager } from '../src/main/plugin-manager.js';
import createPlugin from '../plugins/child-processes/plugin.js';

const root = await mkdtemp(join(tmpdir(), 'avi-child-processes-'));
const state = new Map();
let panel;
const disposables = [];
const definition = createPlugin({ definePlugin: (value) => value });
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms.`);
};

const setting = definition.settings[0].options[0];
const commandLine = (script) => `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
const processConfiguration = (overrides = {}) => ({
  commandLine: '',
  workingDirectory: root,
  retry: false,
  retryDelaySeconds: 0.02,
  maxRetries: 0,
  ...overrides,
});

try {
  const pluginsDir = join(root, 'plugins');
  const pluginDir = join(pluginsDir, 'child-processes');
  await mkdir(pluginDir, { recursive: true });
  await Promise.all([
    copyFile(new URL('../plugins/child-processes/plugin.js', import.meta.url), join(pluginDir, 'plugin.js')),
    copyFile(new URL('../plugins/child-processes/supervisor.js', import.meta.url), join(pluginDir, 'supervisor.js')),
  ]);
  const manager = new PluginManager({ pluginsDir });
  const managerStatus = await manager.initialize();
  assert.equal(managerStatus.failures.length, 0);
  assert.equal(manager.list()[0]?.id, 'child-processes');

  const successFixture = join(root, 'success.mjs');
  const retryFixture = join(root, 'retry.mjs');
  const longFixture = join(root, 'long.mjs');
  const retryCounter = join(root, 'retry-count.txt');
  await writeFile(successFixture, `console.log('stdout marker'); console.error('stderr marker'); process.exit(7);\n`);
  await writeFile(retryFixture, `
    import { readFile, writeFile } from 'node:fs/promises';
    const path = ${JSON.stringify(retryCounter)};
    let count = 0;
    try { count = Number(await readFile(path, 'utf8')); } catch {}
    await writeFile(path, String(count + 1));
    console.error('attempt ' + (count + 1));
    process.exit(9);
  `);
  await writeFile(longFixture, `setInterval(() => console.log('alive'), 25);\n`);

  const avi = {
    storage: {
      async get(key) { return structuredClone(state.get(key) ?? null); },
      async set(key, value) { state.set(key, structuredClone(value)); },
    },
    panels: {
      register(descriptor) {
        panel = descriptor;
        return { refresh() {}, dispose() {} };
      },
    },
    lifecycle: {
      onDeactivate(handler) {
        disposables.push(handler);
        return { dispose() {} };
      },
    },
  };

  await definition.activate(avi);
  assert.deepEqual(await setting.getValue(), []);
  assert.match(setting.validate([
    processConfiguration(),
  ]), /program or command is required/);

  const failureConfig = processConfiguration({ commandLine: commandLine(successFixture) });
  await setting.setValue([], [failureConfig]);
  await waitFor(async () => {
    const snapshot = await panel.load();
    const log = snapshot.sections[0]?.items[0]?.description ?? '';
    return log.includes('stdout marker') && log.includes('stderr marker') && log.includes('code 7') && log;
  });

  const retryConfig = processConfiguration({
    commandLine: commandLine(retryFixture),
    retry: true,
    maxRetries: 2,
  });
  await setting.setValue([failureConfig], [retryConfig]);
  await waitFor(async () => Number(await readFile(retryCounter, 'utf8').catch(() => '0')) === 3);
  const retryLog = (await panel.load()).sections[0].items[0].description;
  assert.match(retryLog, /Retry 1 scheduled/);
  assert.match(retryLog, /Retry 2 scheduled/);
  assert.match(retryLog, /code 9/);

  const noisyFixture = join(root, 'noisy.mjs');
  await writeFile(noisyFixture, `process.stdout.write('x'.repeat(1200000)); process.exit(0);\n`);
  const noisyConfig = processConfiguration({ commandLine: commandLine(noisyFixture) });
  await setting.setValue([retryConfig], [noisyConfig]);
  const cappedLog = await waitFor(async () => {
    const value = (await panel.load()).sections[0].items[0].description;
    return value.length >= 1_000_000 && value;
  });
  assert.ok(Buffer.byteLength(cappedLog) <= 1024 * 1024);

  const longConfig = processConfiguration({ commandLine: commandLine(longFixture) });
  await setting.setValue([noisyConfig], [longConfig]);
  const longLog = await waitFor(async () => {
    const value = (await panel.load()).sections[0].items[0].description;
    return value.includes('Started PID') && value;
  });
  const pid = Number(/Started PID (\d+)/.exec(longLog)?.[1]);
  assert.ok(pid > 0);
  assert.deepEqual((await panel.load()).sections[0].items.slice(1).map((item) => item.action.id), ['stop', 'restart']);

  const restarted = await panel.invokeAction('restart', { id: '0' });
  assert.deepEqual(restarted.panel.sections[0].items.slice(1).map((item) => item.action.id), ['stop', 'restart']);
  const restartedLog = await waitFor(async () => {
    const value = (await panel.load()).sections[0].items[0].description;
    return (value.match(/Started PID \d+/g)?.length ?? 0) >= 2 && value;
  });
  const restartedPid = Number([...restartedLog.matchAll(/Started PID (\d+)/g)].at(-1)?.[1]);
  assert.ok(restartedPid > 0 && restartedPid !== pid);
  await waitFor(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) { return error?.code === 'ESRCH'; }
  });

  const stopped = await panel.invokeAction('stop', { id: '0' });
  assert.deepEqual(stopped.panel.sections[0].items.slice(1).map((item) => item.action.id), ['start']);
  await waitFor(() => {
    try { process.kill(restartedPid, 0); return false; }
    catch (error) { return error?.code === 'ESRCH'; }
  });

  const started = await panel.invokeAction('start', { id: '0' });
  assert.deepEqual(started.panel.sections[0].items.slice(1).map((item) => item.action.id), ['stop', 'restart']);
  const finalLog = await waitFor(async () => {
    const value = (await panel.load()).sections[0].items[0].description;
    return (value.match(/Started PID \d+/g)?.length ?? 0) >= 3 && value;
  });
  const finalPid = Number([...finalLog.matchAll(/Started PID (\d+)/g)].at(-1)?.[1]);
  assert.ok(finalPid > 0 && finalPid !== restartedPid);

  const startedAt = Date.now();
  await Promise.all(disposables.map((handler) => handler('test')));
  assert.ok(Date.now() - startedAt < 5_000);
  await waitFor(() => {
    try { process.kill(finalPid, 0); return false; }
    catch (error) { return error?.code === 'ESRCH'; }
  });

  console.log('Child Processes plugin tests passed.');
} finally {
  await Promise.allSettled(disposables.map((handler) => handler('cleanup')));
  await rm(root, { recursive: true, force: true });
}
