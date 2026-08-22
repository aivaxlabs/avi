import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';

const largeCredentials = {
  accessToken: 'a'.repeat(1_870),
  refreshToken: 'r'.repeat(211),
  idToken: 'i'.repeat(2_457),
  accountId: 'account-id',
};
const storagePhase = process.argv[2];

if (storagePhase?.startsWith('--storage-')) {
  if (storagePhase === '--storage-inspect') {
    const encryptedDatabase = new Database(
      join(process.env.USERPROFILE, '.aivax', 'aivax.sqlite'),
      { readonly: true },
    );
    const encryptedStatement = encryptedDatabase.query(
      "SELECT value FROM session_values WHERE key = 'providerCredentialsV2'",
    );
    const encryptedRow = encryptedStatement.get();
    encryptedStatement.finalize();
    encryptedDatabase.close();
    console.log(JSON.stringify(encryptedRow));
  } else {
    const database = await import('../src/main/database.js');
    await database.initializeSecureStorage();
    if (storagePhase === '--storage-write') {
      assert.equal(database.getProviderCredentials('legacy')?.refreshToken, 'legacy-refresh');
      await database.setProviderCredentials('subscription', largeCredentials);
      assert.deepEqual(database.getProviderCredentials('subscription'), largeCredentials);
    } else if (storagePhase === '--storage-read') {
      assert.deepEqual(database.getProviderCredentials('subscription'), largeCredentials);
      await database.deleteProviderCredentials('subscription');
      assert.equal(database.getProviderCredentials('subscription'), null);
    } else {
      throw new Error(`Unknown storage test phase: ${storagePhase}`);
    }
    database.closeDatabase();
  }
  process.exit(0);
}

if (!storagePhase) {
  const testProfile = mkdtempSync(join(tmpdir(), 'aivax-openai-auth-test-'));
  const resolvedTemp = resolve(tmpdir());
  const resolvedProfile = resolve(testProfile);
  const credentialService = `net.aivax.chat.test.${randomUUID()}`;
  assert.ok(resolvedProfile.startsWith(resolvedTemp));

  try {
    await Bun.secrets.set({
      service: credentialService,
      name: 'provider-credentials',
      value: JSON.stringify({
        legacy: {
          accessToken: 'legacy-access',
          refreshToken: 'legacy-refresh',
          idToken: 'legacy-id',
          accountId: 'legacy-account',
        },
      }),
    });
    const result = spawnSync(process.execPath, [
      fileURLToPath(import.meta.url),
      '--worker',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        USERPROFILE: resolvedProfile,
        CHAT_APP_CREDENTIAL_SERVICE: credentialService,
        CODEX_HOME: join(resolvedProfile, '.codex'),
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    process.stdout.write(result.stdout);
  } finally {
    await Promise.all([
      'mcp-oauth-sessions',
      'provider-credentials',
      'provider-credentials-key',
    ].map((name) => Bun.secrets.delete({
      service: credentialService,
      name,
    }).catch(() => false)));
    assert.ok(resolvedProfile.startsWith(resolvedTemp));
    rmSync(resolvedProfile, { recursive: true, force: true });
  }
  process.exit(0);
}

assert.equal(storagePhase, '--worker');
const resolvedProfile = resolve(process.env.USERPROFILE);
const credentialService = process.env.CHAT_APP_CREDENTIAL_SERVICE;

const nativeFetch = globalThis.fetch;
const runStoragePhase = (phase) => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(import.meta.url),
    phase,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      USERPROFILE: resolvedProfile,
      CHAT_APP_CREDENTIAL_SERVICE: credentialService,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};

const jwt = (exp, marker) => [
  Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp, marker })).toString('base64url'),
  'signature',
].join('.');

try {
  assert.ok(Buffer.byteLength(JSON.stringify(largeCredentials), 'utf8') > 2_560);
  runStoragePhase('--storage-write');

  const encryptedRow = JSON.parse(runStoragePhase('--storage-inspect'));
  assert.ok(encryptedRow?.value);
  assert.doesNotMatch(encryptedRow.value, /legacy-refresh|account-id/);

  runStoragePhase('--storage-read');

  const { setTraceLevel } = await import('../src/main/trace-log.js');
  setTraceLevel('verbose');
  const { openAiSubscriptionProviderType } = await import(
    `../src/providers/openai-subscription.js?test=${randomUUID()}`
  );
  const codexHome = process.env.CODEX_HOME;
  const codexAuthPath = join(codexHome, 'auth.json');
  const idToken = [
    Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'account-id' },
    })).toString('base64url'),
    'signature',
  ].join('.');
  const writeCodexAuth = (accessToken) => {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(codexAuthPath, JSON.stringify({
      tokens: {
        access_token: accessToken,
        id_token: idToken,
        refresh_token: 'never-read-by-avi',
      },
    }), { mode: 0o600 });
  };
  const firstAccessToken = jwt(Math.floor(Date.now() / 1_000) + 3_600, 'first');
  const refreshedAccessToken = jwt(Math.floor(Date.now() / 1_000) + 3_600, 'refreshed');
  writeCodexAuth(firstAccessToken);

  const state = openAiSubscriptionProviderType.getState({});
  assert.equal(state.connection.status, 'connected');
  assert.equal(state.connection.action, undefined);
  assert.match(state.connection.description, /Codex CLI session/);

  let requestCount = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/responses');
    requestCount += 1;
    if (requestCount === 1) {
      assert.equal(init.headers.Authorization, `Bearer ${firstAccessToken}`);
      writeCodexAuth(refreshedAccessToken);
      return new Response('', { status: 401 });
    }
    assert.equal(init.headers.Authorization, `Bearer ${refreshedAccessToken}`);
    return new Response('data: [DONE]\n\n', { status: 200 });
  };

  const response = await openAiSubscriptionProviderType.request({
    provider: { id: 'subscription' },
    body: {},
    signal: new AbortController().signal,
    invocationContext: { conversationId: 'test-conversation' },
    services: {},
  });
  assert.equal(response.status, 200);
  assert.equal(requestCount, 2);

  rmSync(codexAuthPath);
  await assert.rejects(
    openAiSubscriptionProviderType.request({
      provider: { id: 'subscription' },
      body: {},
      signal: new AbortController().signal,
      invocationContext: { conversationId: 'test-conversation' },
      services: {},
    }),
    /Codex CLI credentials were not found/,
  );

  console.log('Codex CLI auth tests passed.');
} finally {
  globalThis.fetch = nativeFetch;
}
