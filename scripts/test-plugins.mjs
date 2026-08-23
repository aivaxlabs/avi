import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import yazl from 'yazl';
import { resolveDynamicContext } from '../src/main/context-injection.js';
import { composeToolsWithPlugins } from '../src/main/tool-composition.js';
import { PluginManager } from '../src/main/plugin-manager.js';

const root = await mkdtemp(join(tmpdir(), 'avi-plugins-'));
const pluginsDir = join(root, 'plugins');
await mkdir(pluginsDir);

const writePlugin = async (directory, source, disabled = false) => {
  const target = join(pluginsDir, directory);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, disabled ? 'plugin.js.disabled' : 'plugin.js'), source);
};
const createZip = async (path, entries) => {
  const archive = new yazl.ZipFile();
  for (const [name, content] of entries) archive.addBuffer(Buffer.from(content), name);
  archive.end();
  archive.outputStream.pipe(createWriteStream(path));
  await once(archive.outputStream, 'end');
};

try {
  await writePlugin('success', `
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
  await writePlugin('import-error', 'throw new Error("import exploded");');
  await writePlugin('factory-error', 'export default async () => { throw new Error("factory exploded"); };');
  await writePlugin('invalid', 'export default { apiVersion: 1, id: "invalid", name: "Invalid", version: "1.0.0" };');
  await writePlugin('collision', `export default {
    apiVersion: 2, id: 'collision', name: 'Collision', version: '1.0.0',
    contributions: { tools: [{ name: 'RUN_IN_TERMINAL', description: 'Collision', inputSchema: {}, execute() {} }] }
  };`);
  await writePlugin('traversal', `export default {
    apiVersion: 2, id: 'traversal', name: 'Traversal', version: '1.0.0',
    contributions: { context: [{ path: '../escape.md', content: 'escape' }] }
  };`);
  await writePlugin('atomic', `export default {
    apiVersion: 2, id: 'atomic', name: 'Atomic', version: '1.0.0',
    contributions: { tools: [{ name: 'atomic_tool', description: 'Atomic', inputSchema: {} }] }
  };`);
  await writePlugin('malformed', `export default {
    apiVersion: 2, id: 'malformed', name: 'Malformed', version: '1.0.0',
    contributions: { themes: [{ id: 'bad-theme', name: 'Bad' }] }
  };`);
  await writePlugin('duplicate-a', `export default { apiVersion: 2, id: 'duplicate', name: 'Duplicate A', version: '1.0.0' };`);
  await writePlugin('duplicate-b', `export default { apiVersion: 2, id: 'DUPLICATE', name: 'Duplicate B', version: '1.0.0' };`);
  await writePlugin('invalid-mcp', `export default {
    apiVersion: 2, id: 'invalid-mcp', name: 'Invalid MCP', version: '1.0.0',
    contributions: {
      mcps: [{ id: 'broken', name: 'Broken', config: {} }],
      tools: [{ name: 'must_not_publish', description: 'Atomicity', inputSchema: {}, execute() {} }]
    }
  };`);
  await writePlugin('unknown-field', `export default {
    apiVersion: 2, id: 'unknown-field', name: 'Unknown Field', version: '1.0.0',
    contributions: { themes: [{ id: 'strict', name: 'Strict', tagline: 'Strict', css: ':root {}', extra: true }] }
  };`);
  await writePlugin('timeout', 'export default async () => new Promise(() => {});');
  await writePlugin('a-materialization-failure', `export default {
    apiVersion: 2, id: 'a-materialization-failure', name: 'Materialization Failure', version: '1.0.0',
    contributions: {
      context: [{ path: 'node', content: 'file' }, { path: 'node/child.md', content: 'child' }],
      tools: [{ name: 'released_tool', description: 'Released after failure', inputSchema: {}, execute() {} }]
    }
  };`);
  await writePlugin('z-after-failure', `export default {
    apiVersion: 2, id: 'z-after-failure', name: 'After Failure', version: '1.0.0',
    contributions: { tools: [{ name: 'released_tool', description: 'Valid claimant', inputSchema: {}, execute() {} }] }
  };`);
  await writePlugin('malformed-mcp-nested', `export default {
    apiVersion: 2, id: 'malformed-mcp-nested', name: 'Malformed MCP Nested', version: '1.0.0',
    contributions: { mcps: [{ id: 'bad-nested', name: 'Bad Nested', config: {
      type: 'streamable-http', url: 'https://example.com', headers: 'abc', auth: []
    } }] }
  };`);
  await writePlugin('unknown-definition', `export default {
    apiVersion: 2, id: 'unknown-definition', name: 'Unknown Definition', version: '1.0.0', unexpected: true
  };`);
  await writePlugin('unknown-mcp-field', `export default {
    apiVersion: 2, id: 'unknown-mcp-field', name: 'Unknown MCP Field', version: '1.0.0',
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
  assert.deepEqual(manager.list().filter((plugin) => plugin.status === 'loaded').map((plugin) => plugin.id), ['success', 'z-after-failure']);
  assert.equal(status.failures.length, 16);
  assert.match(status.failures.find((failure) => failure.pluginId === 'import-error').error, /import exploded/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'factory-error').error, /factory exploded/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'invalid').error, /apiVersion/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'collision').error, /Duplicate tool ID/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'traversal').error, /escapes/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'atomic').error, /requires an execute function/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'malformed').error, /tagline/);
  assert.equal(status.failures.filter((failure) => failure.error.includes('does not match directory')).length, 2);
  assert.match(status.failures.find((failure) => failure.pluginId === 'invalid-mcp').error, /MCP transport/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'unknown-field').error, /does not support field "extra"/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'timeout').error, /did not load within 50 ms/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'a-materialization-failure').error, /EEXIST|exist/i);
  assert.match(status.failures.find((failure) => failure.pluginId === 'malformed-mcp-nested').error, /headers must be an object/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'unknown-definition').error, /does not support field "unexpected"/);
  assert.match(status.failures.find((failure) => failure.pluginId === 'unknown-mcp-field').error, /does not support field "unexpected"/);
  assert.equal(manager.getContributions('tools').some((tool) => tool.name === 'must_not_publish'), false);

  const tool = manager.getContributions('tools').find((entry) => entry.name === 'demo_tool');
  assert.equal(tool.pluginId, 'success');
  assert.equal('execute' in tool, false);
  assert.deepEqual(await manager.getHandlers('tools', 'demo_tool').execute(), { ok: true });
  assert.equal(manager.getProviderTypes()[0].descriptor.id, 'demo-provider');
  const pluginTools = manager.getContributions('tools').map((entry) => ({
    ...entry,
    execute: manager.getHandlers('tools', entry.name).execute,
  }));
  assert.deepEqual(composeToolsWithPlugins(
    [{ name: 'dynamic_tool' }],
    [...pluginTools, { name: 'dynamic_tool', execute() {} }],
    [],
  ).map((entry) => entry.name), ['dynamic_tool', 'demo_tool', 'released_tool']);

  const dynamicContext = await resolveDynamicContext({
    cwd: root,
    prompt: '/demo $demo-personality',
    installationContextDir: join(root, 'missing-installation'),
    globalContextDir: join(root, 'missing-global'),
    pluginContextRoots: manager.getContributions('context').map((entry) => ({
      id: entry.pluginId,
      path: join(pluginsDir, '.avi', entry.pluginId, 'context'),
    })),
    pluginPersonalities: manager.getContributions('personalities'),
    tuning: { personality: 'demo-personality' },
  });
  assert.match(dynamicContext, /Be helpful\./);
  assert.match(dynamicContext, /\$INSTALL_DIR\/plugins\/success\/skills\/demo\/SKILL\.md/);

  const lifecycleDir = join(root, 'lifecycle-plugins');
  await mkdir(lifecycleDir);
  const disabledDirectory = join(lifecycleDir, 'never-execute');
  await mkdir(disabledDirectory);
  await writeFile(join(disabledDirectory, 'plugin.js.disabled'), 'throw new Error("disabled plugin executed");');
  await writeFile(join(disabledDirectory, '.avi-plugin.json'), JSON.stringify({
    id: 'never-execute', name: 'Never Execute', description: 'Disabled', version: '1.0.0',
  }));
  const activeDirectory = join(lifecycleDir, 'active');
  await mkdir(activeDirectory);
  const activePluginSource = `export default {
    apiVersion: 2, id: 'active', name: 'Active', version: '1.0.0',
    contributions: { tools: [{ name: 'active_tool', description: 'Active', inputSchema: {}, execute() {} }] }
  };`;
  await writeFile(join(activeDirectory, 'plugin.js'), activePluginSource);
  const lifecycleManager = new PluginManager({ pluginsDir: lifecycleDir });
  const lifecycleStatus = await lifecycleManager.initialize();
  assert.equal(lifecycleStatus.failures.length, 0);
  assert.deepEqual(lifecycleStatus.plugins.map((plugin) => [plugin.id, plugin.status]), [
    ['active', 'loaded'],
    ['never-execute', 'disabled'],
  ]);
  const disabled = await lifecycleManager.setEnabled('active', false);
  assert.equal(disabled.fileName, 'plugin.js.disabled');
  assert.equal(disabled.status, 'pending disable');
  assert.equal(await readFile(join(activeDirectory, 'plugin.js.disabled'), 'utf8'), activePluginSource);
  const enabled = await lifecycleManager.setEnabled('active', true);
  assert.equal(enabled.fileName, 'plugin.js');
  await assert.rejects(() => lifecycleManager.setEnabled('../active', false), /Plugin ID.*invalid/);
  await lifecycleManager.setEnabled('active', false);
  await lifecycleManager.remove('active');
  await assert.rejects(() => readdir(activeDirectory));
  await lifecycleManager.remove('never-execute');
  assert.equal(lifecycleManager.list().length, 0);

  // remove() regression: deactivate runs before file removal, context and storage cleaned up
  const removeRegDir = join(root, 'remove-regression');
  await mkdir(removeRegDir);
  const removeRegActive = join(removeRegDir, 'deactivable');
  await mkdir(removeRegActive);
  await writeFile(join(removeRegActive, 'plugin.js'), `export default {
    apiVersion: 2, id: 'deactivable', name: 'Deactivable', version: '1.0.0', capabilities: [],
    contributions: { context: [{ path: 'notes/README.md', content: '# Notes' }] },
    activate(api) { api.lifecycle.onDeactivate(() => { globalThis.removeDeactivateCalled = true; }); }
  };
  `);
  const removeManager = new PluginManager({ pluginsDir: removeRegDir, loadTimeoutMs: 100 });
  await removeManager.initialize();
  await removeManager.activateAll();
  assert.equal(removeManager.list()[0]?.status, 'active');
  globalThis.removeDeactivateCalled = false;
  await removeManager.remove('deactivable');
  assert.equal(globalThis.removeDeactivateCalled, true, 'deactivate callback must fire before files are removed');
  await assert.rejects(() => readdir(removeRegActive), /ENOENT/);
  await assert.rejects(() => readdir(join(removeRegDir, '.avi', 'deactivable')), /ENOENT/);
  await assert.rejects(() => readdir(join(removeRegDir, '.avi-storage', 'deactivable')), /ENOENT/);
  assert.equal(removeManager.list().length, 0);
  assert.equal(removeManager.restartRequired, true);

  const installDir = join(root, 'install-plugins');
  await mkdir(installDir);
  const installManager = new PluginManager({ pluginsDir: installDir });
  await installManager.initialize();
  const arbitrarySource = join(root, 'anything.js');
  const versionSource = (version, marker = version) => `export default {
    apiVersion: 2, id: 'installed-plugin', name: 'Installed Plugin', version: '${version}',
    description: '${marker}'
  };`;
  await writeFile(arbitrarySource, versionSource('1.0.0'));
  const installed = await installManager.sideload(arbitrarySource);
  assert.equal(installed.path, join(installDir, 'installed-plugin', 'plugin.js'));
  assert.equal(installed.replaced, false);
  assert.equal(await readFile(installed.path, 'utf8'), versionSource('1.0.0'));
  assert.equal(installManager.getStatus().restartRequired, true);

  await writeFile(arbitrarySource, versionSource('1.0.0', 'same version replacement'));
  const sameVersion = await installManager.sideload(arbitrarySource);
  assert.equal(sameVersion.replaced, true);
  assert.match(await readFile(sameVersion.path, 'utf8'), /same version replacement/);

  const zipPath = join(root, 'plugin.zip');
  await createZip(zipPath, [
    ['plugin.js', versionSource('2.0.0', 'zip replacement')],
    ['assets/readme.txt', 'plugin asset'],
  ]);
  const upgraded = await installManager.sideload(zipPath);
  assert.equal(upgraded.version, '2.0.0');
  assert.equal(await readFile(join(installDir, 'installed-plugin', 'assets', 'readme.txt'), 'utf8'), 'plugin asset');

  await writeFile(arbitrarySource, versionSource('1.5.0', 'downgrade'));
  let downgradePrompt;
  const canceledDowngrade = await installManager.sideload(arbitrarySource, {
    confirmDowngrade: async (details) => {
      downgradePrompt = details;
      return false;
    },
  });
  assert.equal(canceledDowngrade, null);
  assert.deepEqual(downgradePrompt, {
    id: 'installed-plugin', name: 'Installed Plugin', installedVersion: '2.0.0', incomingVersion: '1.5.0',
  });
  assert.match(await readFile(join(installDir, 'installed-plugin', 'plugin.js'), 'utf8'), /zip replacement/);
  await installManager.sideload(arbitrarySource, { confirmDowngrade: async () => true });
  assert.match(await readFile(join(installDir, 'installed-plugin', 'plugin.js'), 'utf8'), /downgrade/);

  await installManager.setEnabled('installed-plugin', false);
  globalThis.disabledUpdateImports = 0;
  await writeFile(arbitrarySource, `globalThis.disabledUpdateImports += 1; export default {
    apiVersion: 2, id: 'installed-plugin', name: 'Installed Plugin', version: '2.0.0'
  };`);
  await installManager.sideload(arbitrarySource);
  assert.equal(globalThis.disabledUpdateImports, 1);
  assert.equal(installManager.list().find((plugin) => plugin.id === 'installed-plugin').enabled, false);
  await assert.rejects(() => readFile(join(installDir, 'installed-plugin', 'plugin.js')));
  assert.match(await readFile(join(installDir, 'installed-plugin', 'plugin.js.disabled'), 'utf8'), /disabledUpdateImports/);
  const restartedInstallManager = new PluginManager({ pluginsDir: installDir });
  await restartedInstallManager.initialize();
  assert.equal(globalThis.disabledUpdateImports, 1);
  assert.equal(restartedInstallManager.list()[0].status, 'disabled');

  const preflightDir = join(root, 'preflight-plugins');
  await mkdir(preflightDir);
  const stableSource = `export default {
    apiVersion: 2, id: 'stable', name: 'Stable', version: '1.0.0', description: 'working'
  };`;
  await mkdir(join(preflightDir, 'stable'));
  await writeFile(join(preflightDir, 'stable', 'plugin.js'), stableSource);
  await mkdir(join(preflightDir, 'neighbor'));
  await writeFile(join(preflightDir, 'neighbor', 'plugin.js'), `export default {
    apiVersion: 2, id: 'neighbor', name: 'Neighbor', version: '1.0.0',
    contributions: { tools: [{ name: 'neighbor_tool', description: 'Neighbor', inputSchema: {}, execute() {} }] }
  };`);
  const preflightManager = new PluginManager({ pluginsDir: preflightDir });
  await preflightManager.initialize();
  const rejectedUpdate = join(root, 'rejected-update.js');
  await writeFile(rejectedUpdate, `export default {
    apiVersion: 2, id: 'stable', name: 'Stable', version: '2.0.0',
    contributions: { tools: [{ name: 'neighbor_tool', description: 'Collision', inputSchema: {}, execute() {} }] }
  };`);
  await assert.rejects(() => preflightManager.sideload(rejectedUpdate), /Duplicate tool ID/);
  assert.equal(await readFile(join(preflightDir, 'stable', 'plugin.js'), 'utf8'), stableSource);
  await writeFile(rejectedUpdate, `export default {
    apiVersion: 2, id: 'stable', name: 'Stable', version: '2.0.0',
    contributions: { context: [{ path: 'node', content: 'file' }, { path: 'node/child.md', content: 'child' }] }
  };`);
  await assert.rejects(() => preflightManager.sideload(rejectedUpdate), /EEXIST|exist/i);
  assert.equal(await readFile(join(preflightDir, 'stable', 'plugin.js'), 'utf8'), stableSource);

  const caseDir = join(root, 'case-plugins');
  await mkdir(caseDir);
  await mkdir(join(caseDir, 'CasePlugin'));
  await writeFile(join(caseDir, 'CasePlugin', 'plugin.js'), `export default {
    apiVersion: 2, id: 'CasePlugin', name: 'Case Plugin', version: '1.0.0'
  };`);
  await mkdir(join(caseDir, 'caseplugin'), { recursive: true });
  await writeFile(join(caseDir, 'caseplugin', 'plugin.js'), `export default {
    apiVersion: 2, id: 'caseplugin', name: 'Case Plugin', version: '1.0.0'
  };`);
  if ((await readdir(caseDir)).length === 2) {
    const caseManager = new PluginManager({ pluginsDir: caseDir });
    await caseManager.initialize();
    const caseSource = join(root, 'case-update.js');
    await writeFile(caseSource, `export default {
      apiVersion: 2, id: 'caseplugin', name: 'Case Plugin', version: '2.0.0'
    };`);
    await assert.rejects(() => caseManager.sideload(caseSource), /multiple case-insensitive installation directories/);
  }

  const invalidMetadata = join(root, 'invalid-metadata.js');
  await writeFile(invalidMetadata, 'export default { apiVersion: 2, name: "Missing ID", version: "1.0.0" };');
  await assert.rejects(() => installManager.sideload(invalidMetadata), /Plugin ID/);
  await writeFile(invalidMetadata, 'export default { apiVersion: 2, id: "bad-version", name: "Bad Version", version: "latest" };');
  await assert.rejects(() => installManager.sideload(invalidMetadata), /valid semantic version/);
  await writeFile(invalidMetadata, 'export default { apiVersion: 2, id: "bad-version", name: "Bad Version", version: "release-2" };');
  await assert.rejects(() => installManager.sideload(invalidMetadata), /valid semantic version/);
  const unsafeZip = join(root, 'unsafe.zip');
  await createZip(unsafeZip, [['plugin.js', versionSource('3.0.0')]]);
  const unsafeArchive = await readFile(unsafeZip);
  for (let offset = unsafeArchive.indexOf('plugin.js'); offset !== -1; offset = unsafeArchive.indexOf('plugin.js', offset + 1)) {
    unsafeArchive.write('../evil.j', offset, 'ascii');
  }
  await writeFile(unsafeZip, unsafeArchive);
  await assert.rejects(() => installManager.sideload(unsafeZip), /safe to extract|invalid relative path|central directory/i);
  const missingEntrypointZip = join(root, 'missing-entrypoint.zip');
  await createZip(missingEntrypointZip, [['nested/plugin.js', versionSource('3.0.0')]]);
  await assert.rejects(() => installManager.sideload(missingEntrypointZip), /managed plugin source|ENOENT/i);
  const duplicateZip = join(root, 'duplicate.zip');
  await createZip(duplicateZip, [
    ['plugin.js', versionSource('3.0.0')],
    ['PLUGIN.JS', versionSource('4.0.0')],
  ]);
  await assert.rejects(() => installManager.sideload(duplicateZip), /duplicated/);
  assert.equal((await readdir(installDir)).some((name) => name.startsWith('.install-') || name.startsWith('.backup-')), false);

  // Test ModelProviderRegistry resilience when plugin provider interfaces are unloaded or unavailable
  const { ModelProviderRegistry } = await import('../src/main/model-provider.js');
  let dynamicProviders = [
    {
      id: 'configured-active',
      name: 'Active Plugin Provider',
      interface: 'demo-provider',
      enabled: true,
      models: [{ id: 'm1', name: 'Model 1' }],
    },
    {
      id: 'configured-unloaded',
      name: 'Unloaded OAuth Provider',
      interface: 'antigravity-oauth',
      enabled: true,
      models: [{ id: 'm2', name: 'Model 2' }],
    },
  ];
  const testRegistry = new ModelProviderRegistry({
    getProviders: () => dynamicProviders,
    providerTypes: () => manager.getProviderTypes(),
    services: {},
  });

  // Verify listTypes only returns loaded provider descriptors
  assert.deepEqual(testRegistry.listTypes().map((t) => t.id), ['demo-provider']);

  // Verify listModels does NOT throw on the unloaded 'antigravity-oauth' provider
  const availableModels = testRegistry.listModels();
  assert.equal(availableModels.length, 1);
  assert.equal(availableModels[0].id, 'configured-active:m1');

  // Verify listGlobalTools and listAuxiliaryPanels do not throw
  assert.deepEqual(testRegistry.listGlobalTools(), []);
  assert.deepEqual(testRegistry.listAuxiliaryPanels(), []);

  // Verify resolve returns null for models from missing provider interfaces without throwing
  assert.equal(testRegistry.resolve('configured-unloaded:m2'), null);

  // Verify getState returns empty object for missing provider interfaces
  assert.deepEqual(await testRegistry.getState('configured-unloaded'), {});

  // Verify remove succeeds without throwing when provider interface is missing
  await testRegistry.remove('configured-unloaded');

  // Verify removing an available provider
  dynamicProviders = dynamicProviders.filter((p) => p.id !== 'configured-unloaded');
  assert.equal(testRegistry.listModels().length, 1);

  // Verify startup error logging to trace.log
  const { traceError, setTraceLevel } = await import('../src/main/trace-log.js');
  setTraceLevel('minimal');
  traceError('app.failed-to-start', {
    operation: 'startup',
    error: 'Provider interface "antigravity-oauth" is unavailable.',
  });
  const traceLogContent = await readFile(join(homedir(), '.aivax', 'trace.log'), 'utf8');
  assert.match(traceLogContent, /-- ERROR -- app\.failed-to-start: operation="startup" error="Provider interface \\"antigravity-oauth\\" is unavailable\."/);

  console.log('Plugin runtime checks passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}

