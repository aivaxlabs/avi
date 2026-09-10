import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginManager } from '../src/main/plugin-manager.js';

const parent = join(tmpdir(), '.avi', 'visualizations', `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`, 'builtin-tests');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'run-'));
const pluginsDir = join(root, 'installed');
const builtInPluginsDir = join(root, 'bundled');
const directory = join(builtInPluginsDir, 'demo');
await mkdir(directory, { recursive: true });
const source = `globalThis.__builtinImported = true; export default { apiVersion: 2, id: 'demo', name: 'Demo', version: '1.0.0', capabilities: [], contributions: { context: [{path:'skills/demo/SKILL.md',content:'# Demo'}] } };`;
await writeFile(join(directory, 'plugin.js'), source);
await writeFile(join(directory, '.avi-plugin.json'), JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0' }));
try {
  const manager = new PluginManager({ pluginsDir, builtInPluginsDir });
  await manager.initialize();
  assert.equal(globalThis.__builtinImported, undefined);
  assert.equal(manager.list()[0].builtIn, true);
  assert.equal(manager.list()[0].enabled, false);
  await assert.rejects(manager.remove('demo'), /cannot be removed/);
  await manager.setEnabled('demo', true);
  assert.equal(await readFile(join(directory, 'plugin.js'), 'utf8'), source);
  assert.equal(JSON.parse(await readFile(join(pluginsDir, '.avi-built-in-state.json'), 'utf8')).demo, true);
  const enabled = new PluginManager({ pluginsDir, builtInPluginsDir });
  await enabled.initialize();
  assert.equal(enabled.getFailures().length, 0);
  assert.equal(enabled.list()[0].enabled, true);
  assert.equal(enabled.getContributions('context').length, 1);
  const sideload = join(root, 'demo.js');
  await writeFile(sideload, source);
  await assert.rejects(enabled.sideload(sideload), /reserved by a built-in/);
  await enabled.setEnabled('demo', false);
  const disabled = new PluginManager({ pluginsDir, builtInPluginsDir });
  await disabled.initialize();
  assert.equal(disabled.list()[0].enabled, false);
  assert.equal(disabled.getContributions('context').length, 0);
  assert.equal(await readFile(join(directory, 'plugin.js'), 'utf8'), source);
  console.log('Built-in default-disabled, persistence, restart, context and reserved-ID checks passed.');
} finally {
  delete globalThis.__builtinImported;
  await rm(root, { recursive: true, force: true });
}
