import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from 'electron';

const timeout = setTimeout(() => app.exit(2), 60_000);
const parent = join(tmpdir(), '.avi', 'visualizations', `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`, 'secret-vault-tests');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'run-'));

async function run() {
  // Electron exits during startup when profile variables change before ready; database.js reads homedir() on import.
  process.env.USERPROFILE = root;
  process.env.HOME = root;
  assert.equal(resolve(homedir()), resolve(root));

  const database = await import('../src/main/database.js');
  const { secretVaultTools, resolveSecretPlaceholders, redactSecrets } = await import('../src/main/tools/secret-vault.js');
  const tool = (name) => secretVaultTools.find((item) => item.name === name);
  const put = (input) => tool('secret_vault_put').execute(input, {});
  const get = (name, conversationId = 'thread-a') => tool('secret_vault_get').execute({ name }, { conversationId });

  try {
    await database.initializeSecureStorage();

    assert.equal(put({ name: 'acme.api_key', content: 'sk-super-secret-1', description: 'Acme' }), 'Secret "acme.api_key" saved.');
    assert.throws(() => put({ name: 'acme.api_key', content: 'other' }), /overwrite/);
    assert.equal(put({ name: 'acme.api_key', content: 'sk-super-secret-2', overwrite: true }), 'Secret "acme.api_key" replaced.');
    assert.throws(() => put({ name: 'bad name', content: 'x' }), /Secret names/);

    const stored = await readFile(join(root, '.aivax', 'secure-storage.json'), 'utf8');
    assert.ok(JSON.parse(stored)['secret-vault'], 'vault persisted in secure storage');
    assert.ok(!stored.includes('sk-super-secret'), 'value is not stored in plain text');

    const listing = tool('secret_vault_list').execute({ filter: 'acme' });
    assert.match(listing, /acme\.api_key/);
    assert.match(listing, /Description: Acme/);
    assert.ok(!listing.includes('sk-super-secret'));

    const exported = get('acme.api_key');
    assert.match(exported, /^Key exported as \{\{acme\.api_key:[A-Z0-9]{10}\}\}, expires at \d{4}-\d\d-\d\dT/);
    assert.ok(!exported.includes('sk-super-secret'));
    const placeholder = exported.match(/\{\{[^}]+\}\}/)[0];

    const input = { command: `curl -H "Authorization: Bearer ${placeholder}" x`, nested: [{ env: placeholder }] };
    const resolved = resolveSecretPlaceholders('run_in_terminal', input, 'thread-a');
    assert.equal(resolved.command, 'curl -H "Authorization: Bearer sk-super-secret-2" x');
    assert.equal(resolved.nested[0].env, 'sk-super-secret-2');
    assert.ok(input.command.includes(placeholder), 'original input keeps the placeholder');

    assert.equal(resolveSecretPlaceholders('memory_write', { contents: placeholder }, 'thread-a').contents, placeholder);
    assert.equal(resolveSecretPlaceholders('chat_send_prompt', { prompt: placeholder }, 'thread-a').prompt, placeholder);
    assert.throws(() => resolveSecretPlaceholders('run_in_terminal', { command: placeholder }, 'thread-b'), /not valid in this thread/);
    assert.throws(() => resolveSecretPlaceholders('run_in_terminal', { command: '{{acme.api_key:AAAAAAAAAA}}' }, 'thread-a'), /not valid/);

    assert.equal(redactSecrets('token=sk-super-secret-2', 'thread-a'), 'token=[secret:acme.api_key]');
    assert.equal(redactSecrets('token=sk-super-secret-2', 'thread-b'), 'token=sk-super-secret-2');

    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      assert.throws(() => resolveSecretPlaceholders('run_in_terminal', { command: placeholder }, 'thread-a'), /expired/);
    } finally {
      Date.now = realNow;
    }

    database.saveSecretVaultEntry({ name: 'acme.token', previousName: 'acme.api_key', description: 'Renamed' });
    assert.equal(database.getSecretVaultValue('acme.token'), 'sk-super-secret-2');
    assert.equal(database.getSecretVaultValue('acme.api_key'), null);
    const [entry] = database.listSecretVaultEntries();
    assert.equal(entry.name, 'acme.token');
    assert.equal(entry.description, 'Renamed');
    assert.ok(entry.createdAt <= entry.updatedAt);
    assert.equal(entry.value, undefined, 'listing never exposes values');

    assert.equal(put({ name: 'acme.token', content: '' }), 'Secret "acme.token" removed.');
    assert.equal(put({ name: 'acme.token' }), 'Secret "acme.token" was not found.');
    assert.throws(() => get('acme.token'), /not found/);
    assert.equal(tool('secret_vault_list').execute({}), 'The Secret Vault is empty.');

    console.log('Secret Vault tests passed.');
  } finally {
    database.closeDatabase();
  }
}

app.whenReady()
  .then(run)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(timeout);
    await rm(root, { recursive: true, force: true }).catch(() => {});
    app.exit(process.exitCode || 0);
  });
