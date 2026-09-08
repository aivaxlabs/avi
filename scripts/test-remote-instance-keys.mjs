import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from 'electron';

app.whenReady().then(async () => {
const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-') + '-UTC';
const temporaryRoot = join(tmpdir(), '.avi', 'visualizations', timestamp);
mkdirSync(temporaryRoot, { recursive: true });
const testProfile = mkdtempSync(join(temporaryRoot, 'remote-instance-keys-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

const database = await import('../src/main/database.js');
const { RemoteMcpServer } = await import('../src/main/remote-mcp-server.js');

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const toolsListBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const jsonHeaders = { host: '127.0.0.1', 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

const serverDeps = {
  chatRunner: {
    reloadSnapshot: () => ({ conversationIds: [], approvals: [], questions: [], semaphoreWaits: [] }),
  },
  botManager: {},
  providerRegistry: { listModels: () => [] },
  getPreferences: () => ({ lastModel: null, defaultModels: null, tuning: {} }),
  getApiKeys: () => database.getRemoteApiKeys(),
  invokeApplicationRequest: async (channel) => {
    throw new Error(`Unexpected test channel: ${channel}`);
  },
  subscribeChatEvents: () => () => { },
  resolveConversationProjectPath: () => null,
};
const server = new RemoteMcpServer({ ...serverDeps, getInstanceId: () => database.getRemoteSettings().instanceId });
const unconfigured = new RemoteMcpServer(serverDeps);

const callMcp = (serverInstance, instanceKey) => serverInstance.handleMcpRequest(
  new Request('http://127.0.0.1/mcp', { method: 'POST', headers: jsonHeaders, body: toolsListBody }),
  instanceKey,
);

const assertToolsOk = async (promise, label) => {
  const response = await promise;
  assert.equal(response.status, 200, label);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.result?.tools) && payload.result.tools.length > 0, label);
};

const httpRequest = (path, headers) => new Promise((resolvePromise, reject) => {
  const req = request({
    host: '127.0.0.1',
    port: server.port,
    path,
    method: 'POST',
    headers: { ...headers, 'content-length': Buffer.byteLength(toolsListBody) },
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolvePromise({
      status: res.statusCode,
      body: Buffer.concat(chunks).toString('utf8'),
      headers: res.headers,
    }));
  });
  req.on('error', reject);
  req.write(toolsListBody);
  req.end();
});

  let failure;
  try {
    {
      console.log('a fresh install generates and persists a regex-10 instanceId');
      const first = database.getRemoteSettings();
      assert.equal(first.enabled, true, 'local Remote Control must default to enabled');
      assert.equal(first.relayEnabled, false, 'WAN publication remains opt-in');
      database.setRemoteSettings({ enabled: false });
      assert.equal(database.getRemoteSettings().enabled, false, 'explicit disabled preference must persist');
      database.setRemoteSettings({ enabled: true });
      assert.match(first.instanceId, /^[a-z0-9]{10}$/);
      assert.match(first.relayDeviceId, /^[A-Za-z0-9_-]{1,64}$/);
      const again = database.getRemoteSettings();
      assert.equal(again.instanceId, first.instanceId, 'instanceId must persist across reads');
      assert.equal(again.relayDeviceId, first.relayDeviceId, 'relayDeviceId must persist across reads');
    }

    {
      console.log('setRemoteSettings cannot replace instanceId or relayDeviceId');
      const updated = database.setRemoteSettings({ relayEnabled: true, instanceId: 'zzzzzzzzzz', relayDeviceId: 'attacker-device' });
      assert.equal(updated.instanceId, database.getRemoteSettings().instanceId);
      assert.equal(updated.relayDeviceId, database.getRemoteSettings().relayDeviceId);
      assert.equal(updated.relayEnabled, true, 'unrelated remote fields must stay writable');
      assert.match(updated.instanceId, /^[a-z0-9]{10}$/);
    }

    let key;
    let legacy;
    {
      console.log('remote keys store a six character value with label and expiry metadata');
      key = database.createRemoteApiKey({ label: 'laptop' });
      assert.match(key.value, /^[a-z0-9]{6}$/);
      assert.match(key.id, /^[0-9a-f-]{36}$/);
      assert.equal(key.label, 'laptop');
      assert.equal(key.expiresAt, null);
      assert.ok(typeof key.createdAt === 'string' && key.createdAt.length > 0);
      const listed = database.listRemoteApiKeys().find((entry) => entry.id === key.id);
      assert.equal(listed.label, 'laptop');
      assert.equal(Object.hasOwn(listed, 'value'), false, 'listing must not expose key values');
      const expiring = database.createRemoteApiKey({ label: 'temp', expiresAt: new Date(Date.now() + 60_000).toISOString() });
      assert.ok(typeof expiring.expiresAt === 'string' && expiring.expiresAt.length > 0);
      assert.throws(() => database.createRemoteApiKey({ label: 'past', expiresAt: new Date(Date.now() - 1000).toISOString() }),
        /future date/);
      assert.throws(() => database.createRemoteApiKey({ label: '   ' }), /label is required/);
      legacy = { id: randomUUID(), label: 'legacy', expiresAt: null, createdAt: new Date().toISOString(), value: 'k'.repeat(48) };
      database.getRemoteApiKeys().push(legacy);
    }

    {
      console.log('a valid instanceKey authorizes tools/list and forged keys are rejected with 401');
      const soon = database.createRemoteApiKey({ label: 'soon', expiresAt: new Date(Date.now() + 50).toISOString() });
      await sleep(80);
      await assertToolsOk(callMcp(server, `${database.getRemoteSettings().instanceId}@${key.value}`), 'valid instanceKey must reach tools/list');
      const rejections = [
        ['wrong prefix', `other@${key.value}`],
        ['wrong key', `${database.getRemoteSettings().instanceId}@zzzzzz`],
        ['bare key without prefix', key.value],
        ['non-string instanceKey', 42],
        ['expired key', `${database.getRemoteSettings().instanceId}@${soon.value}`],
      ];
      for (const [label, instanceKey] of rejections) {
        const response = await callMcp(server, instanceKey);
        assert.equal(response.status, 401, label);
        assert.equal(response.headers.get('www-authenticate'), 'Bearer', label);
      }
      const revocable = database.createRemoteApiKey({ label: 'revocable' });
      await assertToolsOk(callMcp(server, `${database.getRemoteSettings().instanceId}@${revocable.value}`), 'revocable key must work before deletion');
      assert.equal(database.deleteRemoteApiKey(revocable.id), true);
      assert.equal((await callMcp(server, `${database.getRemoteSettings().instanceId}@${revocable.value}`)).status, 401, 'a revoked key must stop working immediately');
      await assertToolsOk(callMcp(server, `${database.getRemoteSettings().instanceId}@${legacy.value}`), 'a legacy long key must keep working');
      await assertToolsOk(callMcp(server), 'method1 without instanceKey must keep working');
      assert.equal((await callMcp(unconfigured, `${database.getRemoteSettings().instanceId}@${key.value}`)).status, 401, 'a server without getInstanceId must reject every instanceKey');
      await assertToolsOk(callMcp(unconfigured), 'a server without getInstanceId must keep method1 working');
    }

    {
      console.log('local MCP requests still require an authorized local key');
      await server.start(0);
      assert.ok(server.port > 0);
      const unauthorized = await httpRequest('/mcp', jsonHeaders);
      assert.equal(unauthorized.status, 401);
      assert.equal(unauthorized.headers['www-authenticate'], 'Bearer');
      assert.equal((await httpRequest('/mcp', { ...jsonHeaders, authorization: 'Bearer wrong1' })).status, 401);
      const soon = database.getRemoteApiKeys().find((entry) => entry.label === 'soon');
      assert.equal((await httpRequest('/mcp', { ...jsonHeaders, authorization: `Bearer ${soon.value}` })).status, 401, 'expired keys must fail locally too');
      const localOk = await httpRequest('/mcp', { ...jsonHeaders, authorization: `Bearer ${key.value}` });
      assert.equal(localOk.status, 200);
      assert.ok(JSON.parse(localOk.body).result?.tools?.length > 0);
      const localLegacy = await httpRequest('/mcp', { ...jsonHeaders, authorization: `Bearer ${legacy.value}` });
      assert.equal(localLegacy.status, 200, 'a legacy long key must keep working locally');
    }

    console.log('Remote instance key tests passed.');
  } catch (error) {
    failure = error;
  } finally {
    try {
      await server.close();
    } catch { }
    try {
      await unconfigured.close();
    } catch { }
    try {
      database?.closeDatabase?.();
    } catch { }
    rmSync(testProfile, { recursive: true, force: true });
  }
  if (failure) {
    console.error(failure);
    process.exit(1);
  }
  process.exit(0);
});
