import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveDynamicContext } from '../src/main/context-injection.js';
import { composeToolsWithPlugins } from '../src/main/tool-composition.js';
import { PluginManager } from '../src/main/plugin-manager.js';

const root = await mkdtemp(join(tmpdir(), 'avi-plugins-'));
const pluginsDir = join(root, 'plugins');
await mkdir(pluginsDir);

try {
  await writeFile(join(pluginsDir, '01-success.js'), `
    export default async (api) => api.definePlugin({
      apiVersion: api.apiVersion,
      id: 'success', name: 'Success', description: 'Success plugin', version: '1.0.0',
      contributions: {
        context: [{ path: 'skills/demo/SKILL.md', content: '# Demo' }],
        mcps: [{ id: 'demo-mcp', name: 'Demo MCP', config: { type: 'stdio', command: 'demo' } }],
        tools: [{ name: 'demo_tool', description: 'Demo', inputSchema: { type: 'object' }, execute: async () => ({ ok: true }) }],
        auxiliaryPanels: [{ id: 'demo-panel', title: 'Demo', load: async () => ({ sections: [] }) }],
        themes: [{ id: 'demo-theme', name: 'Demo', tagline: 'Demo theme', css: ':root {}' }],
        personalities: [{ id: 'demo-personality', name: 'Demo', description: 'Demo personality', instructions: 'Be helpful.' }],
        providers: [{ descriptor: { id: 'demo-provider', name: 'Demo' }, createBody() {}, request() {}, eventsFrom() {} }]
      }
    });
  `);
  await writeFile(join(pluginsDir, '02-import-error.js'), 'throw new Error("import exploded");');
  await writeFile(join(pluginsDir, '03-factory-error.js'), 'export default async () => { throw new Error("factory exploded"); };');
  await writeFile(join(pluginsDir, '04-invalid.js'), 'export default { apiVersion: 2, id: "invalid", name: "Invalid", version: "1" };');
  await writeFile(join(pluginsDir, '05-collision.js'), `export default {
    apiVersion: 1, id: 'collision', name: 'Collision', version: '1',
    contributions: { tools: [{ name: 'DEMO_TOOL', description: 'Collision', inputSchema: {}, execute() {} }] }
  };`);
  await writeFile(join(pluginsDir, '06-traversal.js'), `export default {
    apiVersion: 1, id: 'traversal', name: 'Traversal', version: '1',
    contributions: { context: [{ path: '../escape.md', content: 'escape' }] }
  };`);
  await writeFile(join(pluginsDir, '07-atomic.js'), `export default {
    apiVersion: 1, id: 'atomic', name: 'Atomic', version: '1',
    contributions: { tools: [{ name: 'atomic_tool', description: 'Atomic', inputSchema: {} }] }
  };`);
  await writeFile(join(pluginsDir, '08-malformed.js'), `export default {
    apiVersion: 1, id: 'malformed', name: 'Malformed', version: '1',
    contributions: { themes: [{ id: 'bad-theme', name: 'Bad' }] }
  };`);
  await writeFile(join(pluginsDir, '09-duplicate-a.js'), `export default {
    apiVersion: 1, id: 'duplicate', name: 'Duplicate A', version: '1'
  };`);
  await writeFile(join(pluginsDir, '10-duplicate-b.js'), `export default {
    apiVersion: 1, id: 'DUPLICATE', name: 'Duplicate B', version: '1'
  };`);
  await writeFile(join(pluginsDir, '11-invalid-mcp.js'), `export default {
    apiVersion: 1, id: 'invalid-mcp', name: 'Invalid MCP', version: '1',
    contributions: {
      mcps: [{ id: 'broken', name: 'Broken', config: {} }],
      tools: [{ name: 'must_not_publish', description: 'Atomicity', inputSchema: {}, execute() {} }]
    }
  };`);
  await writeFile(join(pluginsDir, '12-unknown-field.js'), `export default {
    apiVersion: 1, id: 'unknown-field', name: 'Unknown Field', version: '1',
    contributions: { themes: [{ id: 'strict', name: 'Strict', tagline: 'Strict', css: ':root {}', extra: true }] }
  };`);
  await writeFile(join(pluginsDir, '13-timeout.js'), 'export default async () => new Promise(() => {});');
  await writeFile(join(pluginsDir, '14-materialization-failure.js'), `export default {
    apiVersion: 1, id: 'materialization-failure', name: 'Materialization Failure', version: '1',
    contributions: {
      context: [{ path: 'node', content: 'file' }, { path: 'node/child.md', content: 'child' }],
      tools: [{ name: 'released_tool', description: 'Released after failure', inputSchema: {}, execute() {} }]
    }
  };`);
  await writeFile(join(pluginsDir, '15-after-failure.js'), `export default {
    apiVersion: 1, id: 'after-failure', name: 'After Failure', version: '1',
    contributions: { tools: [{ name: 'released_tool', description: 'Valid claimant', inputSchema: {}, execute() {} }] }
  };`);
  await writeFile(join(pluginsDir, '16-malformed-mcp-nested.js'), `export default {
    apiVersion: 1, id: 'malformed-mcp-nested', name: 'Malformed MCP Nested', version: '1',
    contributions: { mcps: [{ id: 'bad-nested', name: 'Bad Nested', config: {
      type: 'streamable-http', url: 'https://example.com', headers: 'abc', auth: []
    } }] }
  };`);
  await writeFile(join(pluginsDir, '17-unknown-definition.js'), `export default {
    apiVersion: 1, id: 'unknown-definition', name: 'Unknown Definition', version: '1', unexpected: true
  };`);
  await writeFile(join(pluginsDir, '18-unknown-mcp-field.js'), `export default {
    apiVersion: 1, id: 'unknown-mcp-field', name: 'Unknown MCP Field', version: '1',
    contributions: { mcps: [{ id: 'strict-mcp', name: 'Strict MCP', config: {
      type: 'stdio', command: 'node', unexpected: true
    } }] }
  };`);

  const manager = new PluginManager({
    pluginsDir,
    reservedToolNames: ['run_in_terminal'],
    reservedIds: { providers: ['built-in-provider'] },
    loadTimeoutMs: 50,
  });
  const status = await manager.initialize();
  assert.deepEqual(manager.list().map((plugin) => plugin.id), ['success', 'after-failure']);
  assert.equal(status.failures.length, 16);
  assert.match(status.failures.find((failure) => failure.fileName === '02-import-error.js').error, /import exploded/);
  assert.match(status.failures.find((failure) => failure.fileName === '03-factory-error.js').error, /factory exploded/);
  assert.match(status.failures.find((failure) => failure.fileName === '04-invalid.js').error, /apiVersion/);
  assert.match(status.failures.find((failure) => failure.fileName === '05-collision.js').error, /Duplicate tool ID/);
  assert.match(status.failures.find((failure) => failure.fileName === '06-traversal.js').error, /escapes/);
  assert.match(status.failures.find((failure) => failure.fileName === '07-atomic.js').error, /requires an execute/);
  assert.match(status.failures.find((failure) => failure.fileName === '08-malformed.js').error, /tagline/);
  assert.match(status.failures.find((failure) => failure.fileName === '09-duplicate-a.js').error, /Duplicate plugin ID/);
  assert.match(status.failures.find((failure) => failure.fileName === '10-duplicate-b.js').error, /Duplicate plugin ID/);
  assert.match(status.failures.find((failure) => failure.fileName === '11-invalid-mcp.js').error, /transport/);
  assert.match(status.failures.find((failure) => failure.fileName === '12-unknown-field.js').error, /does not support field "extra"/);
  assert.match(status.failures.find((failure) => failure.fileName === '13-timeout.js').error, /did not load within 50 ms/);
  assert.match(status.failures.find((failure) => failure.fileName === '14-materialization-failure.js').error, /EEXIST/);
  assert.match(status.failures.find((failure) => failure.fileName === '16-malformed-mcp-nested.js').error, /headers must be an object/);
  assert.match(status.failures.find((failure) => failure.fileName === '17-unknown-definition.js').error, /does not support field "unexpected"/);
  assert.match(status.failures.find((failure) => failure.fileName === '18-unknown-mcp-field.js').error, /does not support field "unexpected"/);
  assert.equal(manager.getContributions('tools').some((tool) => tool.name === 'must_not_publish'), false);
  assert.equal(manager.getContributions('tools').filter((tool) => tool.name === 'released_tool').length, 1);
  assert.equal(status.plugins[0].description, 'Success plugin');
  assert.equal(status.plugins[0].status, 'loaded');
  assert.deepEqual(status.plugins[0].capabilities, ['context', 'mcps', 'tools', 'auxiliaryPanels', 'themes', 'personalities', 'providers']);
  assert.equal(status.plugins[0].directory, pluginsDir);
  assert.equal(manager.getContributions('tools').length, 2);
  assert.equal(manager.getContributions('tools').some((tool) => tool.name === 'atomic_tool'), false);
  assert.equal(typeof manager.getHandlers('tools', 'demo_tool').execute, 'function');
  assert.equal(typeof manager.getHandlers('providers', 'demo-provider').request, 'function');

  await writeFile(join(pluginsDir, '19-reserved-tool.js'), `export default {
    apiVersion: 1, id: 'reserved-tool', name: 'Reserved Tool', version: '1',
    contributions: { tools: [{ name: 'run_in_terminal', description: 'Conflict', inputSchema: {}, execute() {} }] }
  };`);
  await writeFile(join(pluginsDir, '20-reserved-provider.js'), `export default {
    apiVersion: 1, id: 'reserved-provider', name: 'Reserved Provider', version: '1',
    contributions: { providers: [{
      descriptor: { id: 'built-in-provider', name: 'Conflict' },
      createBody() {}, request() {}, eventsFrom() {}
    }] }
  };`);
  const reservedStatus = await manager.initialize();
  assert.match(
    reservedStatus.failures.find((failure) => failure.fileName === '19-reserved-tool.js').error,
    /Duplicate tool ID/,
  );
  assert.match(
    reservedStatus.failures.find((failure) => failure.fileName === '20-reserved-provider.js').error,
    /Duplicate providers ID/,
  );
  assert.equal(typeof manager.getProviderTypes()[0].request, 'function');
  assert.equal(manager.getProviderTypes()[0].descriptor.id, 'demo-provider');

  const coreTool = { name: 'core', inputSchema: {} };
  const pluginTool = { name: 'dynamic_collision', inputSchema: {}, source: 'plugin' };
  const extensionTool = { name: 'dynamic_collision', inputSchema: {}, source: 'extension' };
  const composedTools = composeToolsWithPlugins([coreTool], [pluginTool], [extensionTool]);
  assert.deepEqual(composedTools.map((tool) => tool.name), ['core', 'dynamic_collision']);
  assert.equal(composedTools[1].source, 'extension');

  const context = manager.getContributions('context')[0];
  assert.equal(context.pluginId, 'success');
  assert.equal(context.path, 'skills/demo/SKILL.md');
  assert.equal(await readFile(join(context.root, context.path), 'utf8'), '# Demo');
  const installationContextPath = join(root, 'installation-context');
  const workspacePath = join(root, 'workspace');
  await mkdir(installationContextPath);
  await mkdir(workspacePath);
  const dynamicContext = await resolveDynamicContext({
    installationContextPath,
    workspacePath,
    tuning: { personality: 'demo-personality' },
    pluginPersonalities: manager.getContributions('personalities'),
    pluginContextRoots: [{ id: 'success', path: context.root }],
  });
  assert.match(dynamicContext, /Be helpful\./);
  assert.match(dynamicContext, /\$INSTALL_DIR\/plugins\/success\/skills\/demo\/SKILL\.md/);

  const sideloadSource = join(root, 'sideloaded.js');
  await writeFile(sideloadSource, 'export default { apiVersion: 1, id: "sideloaded", name: "Sideloaded", version: "1" };');
  const sideloaded = await manager.sideload(sideloadSource);
  assert.equal(sideloaded.restartRequired, true);
  assert.equal(manager.getStatus().restartRequired, true);
  assert.equal(await readFile(join(pluginsDir, 'sideloaded.js'), 'utf8'), await readFile(sideloadSource, 'utf8'));
  await assert.rejects(() => manager.sideload(sideloadSource), /already exists/);
  await assert.rejects(() => manager.sideload(join(pluginsDir, 'sideloaded.js')), /already in/);

  await rm(join(pluginsDir, '01-success.js'));
  await manager.initialize();
  await assert.rejects(() => readFile(join(pluginsDir, '.avi', 'success', 'context', 'skills/demo/SKILL.md')));

  console.log('Plugin runtime tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
