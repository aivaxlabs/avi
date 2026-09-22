import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PluginManager } from '../src/main/plugin-manager.js';

const parent = join(tmpdir(), '.avi', 'visualizations', `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`, 'builtin-tests');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'run-'));
process.env.USERPROFILE = root;
process.env.HOME = root;
assert.equal(resolve(homedir()), resolve(root));
let database;
let persisted;
try {
  database = await import('../src/main/database.js');
  const { getBuiltInPluginState, setBuiltInPluginState } = database;
  const options = {
    pluginsDir: join(root, 'installed'),
    builtInPluginsDir: join(root, 'bundled'),
    getBuiltInPluginState,
    setBuiltInPluginState,
  };
  const directory = join(options.builtInPluginsDir, 'demo');
  const legacyPath = join(options.pluginsDir, '.avi-built-in-state.json');
  await mkdir(directory, { recursive: true });
  const source = `globalThis.__builtinImported = true; export default { apiVersion: 2, id: 'demo', name: 'Demo', version: '1.0.0', capabilities: [], contributions: { context: [{path:'skills/demo/SKILL.md',content:'# Demo'}] } };`;
  await writeFile(join(directory, 'plugin.js'), source);
  await writeFile(join(directory, '.avi-plugin.json'), JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0' }));
  persisted = new DatabaseSync(join(root, '.aivax', 'aivax.sqlite'));

  assert.equal(getBuiltInPluginState(), null);
  assert.throws(() => new PluginManager({ ...options, getBuiltInPluginState: undefined }), /persistent state storage/);
  const manager = new PluginManager(options);
  await manager.initialize();
  assert.equal(globalThis.__builtinImported, undefined);
  assert.equal(manager.list()[0].builtIn, true);
  assert.equal(manager.list()[0].enabled, false);
  assert.deepEqual(getBuiltInPluginState(), {});
  await assert.rejects(manager.remove('demo'), /cannot be removed/);
  await manager.setEnabled('demo', true);
  assert.equal(await readFile(join(directory, 'plugin.js'), 'utf8'), source);
  assert.deepEqual(getBuiltInPluginState(), { demo: true });
  assert.deepEqual(JSON.parse(persisted.prepare('SELECT value FROM session_values WHERE key = ?').get('builtInPluginState').value), { demo: true });
  await assert.rejects(readFile(legacyPath), { code: 'ENOENT' });

  await rm(options.pluginsDir, { recursive: true });
  const enabled = new PluginManager(options);
  await enabled.initialize();
  assert.equal(enabled.getFailures().length, 0);
  assert.equal(enabled.list()[0].enabled, true, 'installation directory replacement preserves enablement');
  assert.equal(enabled.getContributions('context').length, 1);
  const sideload = join(root, 'demo.js');
  await writeFile(sideload, source);
  await assert.rejects(enabled.sideload(sideload), /reserved by a built-in/);
  await enabled.setEnabled('demo', false);
  const disabled = new PluginManager(options);
  await disabled.initialize();
  assert.equal(disabled.list()[0].enabled, false);
  assert.equal(disabled.getContributions('context').length, 0);
  assert.equal(await readFile(join(directory, 'plugin.js'), 'utf8'), source);

  const legacy = JSON.stringify({ demo: true, 'other-plugin': false });
  await writeFile(legacyPath, legacy);
  const authoritative = new PluginManager(options);
  await authoritative.initialize();
  assert.equal(authoritative.list()[0].enabled, false, 'legacy state never overrides the database');

  persisted.prepare('DELETE FROM session_values WHERE key = ?').run('builtInPluginState');
  const migrated = new PluginManager(options);
  await migrated.initialize();
  assert.deepEqual(getBuiltInPluginState(), { demo: true, 'other-plugin': false });
  assert.equal(migrated.list()[0].enabled, true);
  assert.equal(await readFile(legacyPath, 'utf8'), legacy, 'migration preserves the legacy file');
  await migrated.setEnabled('demo', false);
  await writeFile(legacyPath, 'invalid JSON');
  const restarted = new PluginManager(options);
  await restarted.initialize();
  assert.equal(restarted.getFailures().length, 0, 'legacy file is ignored after migration');
  assert.equal(restarted.list()[0].enabled, false);

  const unwritable = new PluginManager({
    ...options,
    setBuiltInPluginState: () => { throw new Error('Database write failed'); },
  });
  await unwritable.initialize();
  await assert.rejects(unwritable.setEnabled('demo', true), /Database write failed/);
  assert.equal(unwritable.list()[0].enabled, false);
  assert.equal(unwritable.getStatus().restartRequired, false);
  assert.equal(getBuiltInPluginState().demo, false);

  persisted.prepare('DELETE FROM session_values WHERE key = ?').run('builtInPluginState');
  for (const invalid of ['invalid JSON', 'null', '[]']) {
    await writeFile(legacyPath, invalid);
    const corruptLegacy = new PluginManager(options);
    await corruptLegacy.initialize();
    assert.equal(corruptLegacy.list()[0].enabled, false);
    assert.ok(corruptLegacy.getFailures().some((failure) => failure.fileName === '.avi-built-in-state.json'));
    assert.equal(getBuiltInPluginState(), null, 'invalid legacy state is not marked migrated');
  }
  await writeFile(legacyPath, legacy);
  await assert.rejects(unwritable.initialize(), /Database write failed/);
  assert.equal(getBuiltInPluginState(), null);
  assert.equal(await readFile(legacyPath, 'utf8'), legacy);
  const retry = new PluginManager(options);
  await retry.initialize();
  assert.deepEqual(getBuiltInPluginState(), { demo: true, 'other-plugin': false });

  const unreadable = new PluginManager({
    ...options,
    getBuiltInPluginState: () => { throw new Error('Database read failed'); },
  });
  await assert.rejects(unreadable.initialize(), /Database read failed/);
  assert.deepEqual(getBuiltInPluginState(), { demo: true, 'other-plugin': false });
  assert.throws(() => setBuiltInPluginState({ demo: 'true' }), /boolean preferences/);
  for (const invalid of ['invalid JSON', 'null', '[]', '{"demo":"true"}']) {
    persisted.prepare('UPDATE session_values SET value = ? WHERE key = ?').run(invalid, 'builtInPluginState');
    const corruptDatabase = new PluginManager(options);
    await assert.rejects(corruptDatabase.initialize());
    assert.equal(persisted.prepare('SELECT value FROM session_values WHERE key = ?').get('builtInPluginState').value, invalid);
  }
  setBuiltInPluginState({ demo: true, 'other-plugin': false });

  database.closeDatabase();
  database = await import(`../src/main/database.js?reopen=${Date.now()}`);
  const reopened = new PluginManager({
    ...options,
    getBuiltInPluginState: database.getBuiltInPluginState,
    setBuiltInPluginState: database.setBuiltInPluginState,
  });
  await reopened.initialize();
  assert.equal(reopened.list()[0].enabled, true, 'state survives closing and reopening SQLite');
  console.log('Built-in SQLite persistence, installation replacement, migration, failure and lifecycle checks passed.');
} finally {
  delete globalThis.__builtinImported;
  persisted?.close();
  database?.closeDatabase();
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
