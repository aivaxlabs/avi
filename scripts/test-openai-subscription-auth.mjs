import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
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

  const { openAiSubscriptionProviderType } = await import(
    `../src/providers/openai-subscription.js?test=${randomUUID()}`
  );
  const expiredAccessToken = jwt(Math.floor(Date.now() / 1_000) - 60, 'expired');
  const refreshedAccessToken = jwt(Math.floor(Date.now() / 1_000) + 3_600, 'refreshed');
  let storedTokens = {
    accessToken: expiredAccessToken,
    refreshToken: 'refresh-token',
    idToken: jwt(Math.floor(Date.now() / 1_000) + 3_600, 'id'),
    accountId: 'account-id',
  };
  let persisted = false;
  const services = {
    credentials: {
      get: () => storedTokens,
      set: async (_providerId, value) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        storedTokens = value;
        persisted = true;
      },
    },
  };

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({
        access_token: refreshedAccessToken,
        refresh_token: 'rotated-refresh-token',
        id_token: storedTokens.idToken,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.equal(persisted, true);
    return new Response('data: [DONE]\n\n', { status: 200 });
  };

  const response = await openAiSubscriptionProviderType.request({
    provider: { id: 'subscription' },
    body: {},
    signal: new AbortController().signal,
    invocationContext: { conversationId: 'test-conversation' },
    services,
  });
  assert.equal(response.status, 200);
  assert.equal(storedTokens.refreshToken, 'rotated-refresh-token');

  storedTokens = {
    ...storedTokens,
    accessToken: expiredAccessToken,
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 'refresh_token_expired',
      message: 'Sensitive backend detail',
    },
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(
    openAiSubscriptionProviderType.request({
      provider: { id: 'subscription' },
      body: {},
      signal: new AbortController().signal,
      invocationContext: { conversationId: 'test-conversation' },
      services,
    }),
    /refresh_token_expired/,
  );

  const authLog = readFileSync(join(resolvedProfile, '.aivax', 'auth.log'), 'utf8');
  assert.match(authLog, /"event":"refresh-succeeded"/);
  assert.match(authLog, /"event":"refresh-failed"/);
  assert.doesNotMatch(authLog, /refresh-token|Sensitive backend detail/);

  console.log('OpenAI subscription auth tests passed.');
} finally {
  globalThis.fetch = nativeFetch;
}
