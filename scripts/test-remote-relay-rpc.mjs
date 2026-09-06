import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-') + '-UTC';
const temporaryRoot = join(tmpdir(), '.avi', 'visualizations', timestamp);
mkdirSync(temporaryRoot, { recursive: true });
const testProfile = mkdtempSync(join(temporaryRoot, 'remote-relay-rpc-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

const database = await import('../src/main/database.js');
const { RemoteMcpServer } = await import('../src/main/remote-mcp-server.js');
const { AIVAX_RELAY_URL, RemoteRelay } = await import('../src/main/remote-relay.js');

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const attachmentPayload = 'x'.repeat(2 * 1024 * 1024);
const attachmentMessage = {
  id: 'large-message', conversationId: 'conv-1', role: 'user',
  attachments: [{ id: 'large-attachment', name: 'capture.png', mime: 'image/png', kind: 'image_url', dataUrl: `data:image/png;base64,${attachmentPayload}`, base64: attachmentPayload, text: attachmentPayload }],
};
const attachmentMetadata = { id: 'large-attachment', name: 'capture.png', mime: 'image/png', kind: 'image_url' };
const localKeys = [];
const dispatched = [];
let delayNextApplicationRequest = 0;
const chatEventHandlers = new Set();
const emitChatEvent = (event) => {
  for (const handler of [...chatEventHandlers]) handler(event);
};

const server = new RemoteMcpServer({
  chatRunner: {
    reloadSnapshot: () => ({ conversationIds: [], approvals: [], questions: [], semaphoreWaits: [] }),
  },
  botManager: {},
  providerRegistry: { listModels: () => [] },
  getPreferences: () => ({ lastModel: null, defaultModels: null, tuning: {} }),
  getApiKeys: () => localKeys,
  invokeApplicationRequest: async (channel, payload) => {
    if (delayNextApplicationRequest > 0) await sleep(delayNextApplicationRequest);
    dispatched.push({ channel, payload });
    if (channel === 'remote:state') return { running: true, relay: { status: 'connected' } };
    if (channel === 'conversations:messages') return { messages: [attachmentMessage], cursor: null, hasMore: false };
    if (channel === 'conversations:context') return {
      messages: [attachmentMessage], queue: { steer: [attachmentMessage], queued: [attachmentMessage] },
      composer: { draftText: 'Preserve draft', attachments: [{ id: 'draft', dataUrl: 'data:image/png;base64,eA==' }] },
    };
    if (channel === 'attachments:read') return { attachmentId: payload.attachmentId, data: attachmentPayload.slice(payload.offset, payload.offset + 16), hasMore: true };
    throw new Error(`Unexpected test channel: ${channel}`);
  },
  subscribeChatEvents: (handler) => {
    chatEventHandlers.add(handler);
    return () => chatEventHandlers.delete(handler);
  },
  resolveConversationProjectPath: () => null,
});

const httpRequest = (path, headers, body) => new Promise((resolvePromise, reject) => {
  const req = request({
    host: '127.0.0.1',
    port: server.port,
    path,
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { ...headers, 'content-length': Buffer.byteLength(body) },
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolvePromise({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  if (body !== undefined) req.write(body);
  req.end();
});

const upgradeRequest = (path, headers) => new Promise((resolvePromise, reject) => {
  const req = request({
    host: '127.0.0.1',
    port: server.port,
    path,
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      ...headers,
    },
  });
  req.on('upgrade', (res, socket) => resolvePromise({ status: res.statusCode, socket }));
  req.on('response', (res) => {
    res.resume();
    resolvePromise({ status: res.statusCode });
  });
  req.on('error', reject);
  req.end();
});

const rejectedUpgrade = async (path, headers = {}) => {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, { headers });
  try {
    const [error] = await once(socket, 'error', { signal: AbortSignal.timeout(5000) });
    return error;
  } finally {
    socket.terminate();
  }
};

const collectMessage = (socket, predicate, label) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for a WebSocket message: ${label}.`)), 5000);
  const onMessage = (data) => {
    const message = JSON.parse(data.toString());
    if (!predicate(message)) return;
    socket.off('message', onMessage);
    clearTimeout(timer);
    resolvePromise(message);
  };
  socket.on('message', onMessage);
});

const jsonRpc = (socket, id, method, params) => {
  const pending = collectMessage(socket, (message) => message.id === id, `${method}#${id}`);
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return pending;
};

const initializeRequest = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'remote-relay-rpc-test', version: '0.0.0' },
  },
});
const mcpHeaders = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
const validAuth = () => ({ authorization: 'Bearer local-key' });

class PairChannel {
  constructor(socket, label) {
    this.socket = socket;
    this.label = label;
    this.opened = false;
    this.closed = false;
    this.messages = [];
    this.waiters = [];
    this.closeWaiters = [];
    socket.once('open', () => {
      this.opened = true;
      for (const waiter of this.closeWaiters.splice(0)) waiter();
    });
    socket.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()));
      for (const waiter of [...this.waiters]) waiter(this.messages.at(-1));
    });
    socket.once('close', () => {
      this.closed = true;
      for (const waiter of this.closeWaiters.splice(0)) waiter();
    });
  }

  async waitOpen() {
    await once(this.socket, 'open', { signal: AbortSignal.timeout(5000) });
  }

  async waitClose() {
    if (this.closed) return;
    await new Promise((resolvePromise) => this.closeWaiters.push(resolvePromise));
  }

  async next(predicate, label, timeoutMs = 5000) {
    const found = this.messages.find(predicate);
    if (found) return found;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        rejectPromise(new Error(`Timed out waiting for ${this.label}: ${label}.`));
      }, timeoutMs);
      const waiter = (message) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        resolvePromise(message);
      };
      this.waiters.push(waiter);
    });
  }

  async expectSilence(predicate, waitMs = 80) {
    await sleep(waitMs);
    assert.equal(this.messages.find(predicate), undefined, `${this.label} delivered an unexpected message`);
  }

  send(message) {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  async json(id, method, params) {
    const pending = this.next((message) => message.id === id, `${method}#${id}`);
    this.send({ jsonrpc: '2.0', id, method, params });
    return pending;
  }
}

let failure = null;
const sockets = [];
let reopenedDatabase = null;
try {
  const initialRemote = database.getRemoteSettings();
  assert.equal(initialRemote.relayEnabled, false);
  assert.match(initialRemote.relayDeviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(database.getRemoteSettings().relayDeviceId, initialRemote.relayDeviceId);
  assert.throws(() => database.setRemoteSettings({ relayEnabled: 'yes' }), /Remote settings are invalid/);
  assert.equal(database.getRemoteSettings().relayEnabled, false);
  const enabledRemote = database.setRemoteSettings({ relayEnabled: true });
  assert.equal(enabledRemote.relayEnabled, true);
  assert.equal(database.getRemoteSettings().relayEnabled, true);
  const forgedRemote = database.setRemoteSettings({ relayDeviceId: 'forged-device-id' });
  assert.equal(forgedRemote.relayDeviceId, initialRemote.relayDeviceId);

  database.closeDatabase();
  reopenedDatabase = await import('../src/main/database.js?remote-relay-reopen');
  assert.notEqual(reopenedDatabase.getRemoteSettings, database.getRemoteSettings);
  const reopenedRemote = reopenedDatabase.getRemoteSettings();
  assert.equal(reopenedRemote.relayEnabled, true);
  assert.equal(reopenedRemote.relayDeviceId, initialRemote.relayDeviceId);

  assert.equal(server.running, false);
  assert.equal(server.port, null);
  assert.deepEqual(localKeys, [], 'the WAN contract must hold with zero local keys configured');

  const global = new PairChannel(server.createRelaySocket('/rpc'), 'native global channel');
  await global.waitOpen();
  const globalDiscover = await global.json(1, 'rpc:discover');
  assert.equal(globalDiscover.result.scope, 'global');
  assert.ok(globalDiscover.result.methods.includes('remote:state'));
  const globalState = await global.json(2, 'remote:state', { payload: { includeRelay: true } });
  assert.deepEqual(globalState.result, { running: true, relay: { status: 'connected' } });
  assert.deepEqual(dispatched.at(-1), { channel: 'remote:state', payload: { includeRelay: true } });

  const stream = new PairChannel(server.createRelaySocket('/rpc/conversations/streams/conv-1'), 'native stream channel');
  await stream.waitOpen();
  const streamReady = await stream.next((message) => message.method === 'conversation:ready', 'conversation:ready');
  assert.equal(streamReady.params.conversationId, 'conv-1');
  assert.equal(streamReady.params.recoveryMethod, 'conversations:context');
  const streamDiscover = await stream.json(10, 'rpc:discover');
  assert.equal(streamDiscover.result.scope, 'conversation');
  assert.ok(!streamDiscover.result.methods.includes('remote:state'));
  const streamDenied = await stream.json(11, 'remote:state');
  assert.equal(streamDenied.error.code, -32601);

  for (const method of ['conversations:context', 'conversations:messages']) {
    const response = await stream.json(12, method, { limit: 40 });
    assert.ok(Buffer.byteLength(JSON.stringify(response)) < 1024 * 1024);
    assert.deepEqual(response.result.messages[0].attachments, [attachmentMetadata]);
    if (method === 'conversations:context') {
      assert.deepEqual(response.result.queue.steer[0].attachments, [attachmentMetadata]);
      assert.deepEqual(response.result.queue.queued[0].attachments, [attachmentMetadata]);
      assert.equal(response.result.composer.attachments[0].dataUrl, 'data:image/png;base64,eA==');
    }
  }
  emitChatEvent({ conversationId: 'conv-1', type: 'message', message: attachmentMessage });
  const attachmentEvent = await stream.next((message) => message.method === 'conversation:event', 'metadata message event');
  assert.deepEqual(attachmentEvent.params.event.message.attachments, [attachmentMetadata]);
  assert.equal(attachmentMessage.attachments[0].base64, attachmentPayload, 'RPC projection must not mutate persisted/local attachments');
  assert.equal(attachmentMessage.attachments[0].text, attachmentPayload);
  const chunk = await stream.json(13, 'attachments:read', { messageId: 'large-message', attachmentId: 'large-attachment', offset: 16 });
  assert.equal(chunk.result.data, attachmentPayload.slice(16, 32));
  assert.equal((await stream.json(14, 'rpc:discover')).result.scope, 'conversation', 'large history must leave the relay channel usable');

  assert.throws(() => server.createRelaySocket('/mcp'), /Invalid relay RPC route/);

  const early = new PairChannel(server.createRelaySocket('/rpc/conversations/streams/conv-early'), 'closed-before-open channel');
  early.socket.terminate();
  await sleep(20);
  assert.equal(early.opened, false, 'a socket terminated before the microtask must never open');
  assert.equal(early.messages.length, 0, 'a closed-before-open socket must never receive conversation:ready');

  const fatDownstream = new PairChannel(server.createRelaySocket('/rpc'), 'oversize client channel');
  await fatDownstream.waitOpen();
  const dispatchCountBefore = dispatched.length;
  fatDownstream.send('x'.repeat(1024 * 1024 + 1));
  await fatDownstream.waitClose();
  await sleep(20);
  assert.equal(dispatched.length, dispatchCountBefore, 'oversize client payloads must close the pair without dispatch');
  fatDownstream.expectSilence(() => true, 0);

  const fatUpstream = new PairChannel(server.createRelaySocket('/rpc/conversations/streams/conv-3'), 'oversize server channel');
  await fatUpstream.waitOpen();
  await fatUpstream.next((message) => message.method === 'conversation:ready', 'conversation:ready');
  emitChatEvent({ conversationId: 'conv-3', type: 'run-state', blob: 'y'.repeat(1024 * 1024 + 1) });
  await fatUpstream.waitClose();
  assert.equal(fatUpstream.messages.find((message) => message.method === 'conversation:event'), undefined,
    'oversize server payloads must close the pair without delivery');

  delayNextApplicationRequest = 120;
  const lateReply = new PairChannel(server.createRelaySocket('/rpc'), 'late reply channel');
  await lateReply.waitOpen();
  const replyCount = lateReply.messages.length;
  lateReply.send({ jsonrpc: '2.0', id: 30, method: 'remote:state', params: {} });
  lateReply.socket.terminate();
  await lateReply.waitClose();
  await sleep(180);
  delayNextApplicationRequest = 0;
  assert.equal(lateReply.messages.length, replyCount, 'a reply resolving after termination must not be delivered');

  const lateEvent = new PairChannel(server.createRelaySocket('/rpc/conversations/streams/conv-4'), 'late event channel');
  await lateEvent.waitOpen();
  await lateEvent.next((message) => message.method === 'conversation:ready', 'conversation:ready');
  const lateEventCount = lateEvent.messages.length;
  lateEvent.socket.terminate();
  await lateEvent.waitClose();
  emitChatEvent({ conversationId: 'conv-4', type: 'conversation', payload: { text: 'late' } });
  await sleep(40);
  assert.equal(lateEvent.messages.length, lateEventCount, 'events after termination must not be delivered');

  const relayDeviceId = 'bridge-test-device';
  const accountUuid = '11111111-2222-4333-8444-555555555555';
  const accountToken = 'aivax-account-token';
  let issuedTicket = null;
  const pendingEnvelopes = [];
  const envelopeWaiters = [];
  const publishers = new Set();
  const mockRelay = createServer((incoming, response) => {
    if (incoming.method === 'POST' && incoming.url === `/v1/relays/${relayDeviceId}/tickets`) {
      if (incoming.headers.authorization !== `Bearer ${accountToken}`) {
        response.writeHead(401).end();
        return;
      }
      issuedTicket = randomBytes(32).toString('hex');
      validTickets.add(issuedTicket);
      const websocketUrl = `ws://127.0.0.1:${mockRelay.address().port}/v1/relays/${accountUuid}/${relayDeviceId}/connect`;
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ticket: issuedTicket,
        protocol: 'avi-relay-v1',
        expiresAt: Date.now() + 60_000,
        websocketUrl,
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const relayWss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
    handleProtocols: (protocols) => (protocols.has('avi-relay-v1') ? 'avi-relay-v1' : false),
  });
  const validTickets = new Set();
  mockRelay.on('upgrade', (req, socket, head) => {
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((item) => item.trim());
    const ticket = protocols.find((protocol) => protocol.startsWith('avi-relay-ticket.'))?.slice('avi-relay-ticket.'.length) ?? null;
    if (!protocols.includes('avi-relay-v1') || !ticket || !validTickets.delete(ticket)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    relayWss.handleUpgrade(req, socket, head, (client) => {
      publishers.add(client);
      client.on('message', (data, isBinary) => {
        if (isBinary) return;
        const envelope = JSON.parse(data.toString('utf8'));
        const waiterIndex = envelopeWaiters.findIndex((waiter) => waiter.predicate(envelope));
        if (waiterIndex !== -1) {
          const [waiter] = envelopeWaiters.splice(waiterIndex, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(envelope);
          return;
        }
        pendingEnvelopes.push(envelope);
      });
      client.once('close', () => publishers.delete(client));
    });
  });
  await new Promise((resolvePromise) => mockRelay.listen(0, '127.0.0.1', resolvePromise));
  const sendToPublisher = (envelope) => {
    for (const publisher of publishers) publisher.send(JSON.stringify(envelope));
  };
  const awaitEnvelope = (predicate, label) => new Promise((resolvePromise, rejectPromise) => {
    const index = pendingEnvelopes.findIndex(predicate);
    if (index !== -1) {
      resolvePromise(pendingEnvelopes.splice(index, 1)[0]);
      return;
    }
    const waiter = {
      predicate,
      resolve: resolvePromise,
      timer: setTimeout(() => {
        const waiterIndex = envelopeWaiters.indexOf(waiter);
        if (waiterIndex !== -1) envelopeWaiters.splice(waiterIndex, 1);
        rejectPromise(new Error(`Timed out waiting for a relay envelope: ${label}.`));
      }, 5000),
    };
    envelopeWaiters.push(waiter);
  });
  const expectNoEnvelope = async (predicate, waitMs = 80) => {
    await sleep(waitMs);
    assert.equal(pendingEnvelopes.find(predicate), undefined, 'unexpected publisher envelope');
  };
  const waitForState = async (predicate, label) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
      await sleep(20);
    }
  };
  const awaitChannelJson = async (channelId, predicate, label) => {
    const envelope = await awaitEnvelope((item) => {
      if (item.type !== 'data' || item.channelId !== channelId || typeof item.data !== 'string') return false;
      try {
        return predicate(JSON.parse(item.data));
      } catch {
        return false;
      }
    }, label);
    return JSON.parse(envelope.data);
  };
  const openWanChannel = (path) => {
    const channelId = randomUUID();
    sendToPublisher({ type: 'open', channelId });
    sendToPublisher({
      type: 'data',
      channelId,
      encoding: 'text',
      data: JSON.stringify({ type: 'avi-remote-open', version: 2, path }),
    });
    return channelId;
  };
  const sendWanJson = (channelId, id, method, params) => sendToPublisher({
    type: 'data',
    channelId,
    encoding: 'text',
    data: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const relay = new RemoteRelay({
    deviceId: relayDeviceId,
    name: 'remote-relay-rpc-test',
    relayBaseUrl: `http://127.0.0.1:${mockRelay.address().port}`,
    retryBaseMs: 20,
    retryStableMs: 150,
    revocationCheckMs: 40,
    handshakeTimeoutMs: 400,
    createLocalSocket: (path) => server.createRelaySocket(path),
  });
  assert.equal(relay.snapshot().serverUrl, AIVAX_RELAY_URL);
  await relay.update({ accessToken: accountToken });
  await waitForState(() => relay.snapshot().status === 'connected', 'relay connection');
  assert.equal(relay.snapshot().deviceId, relayDeviceId);
  assert.equal(relay.snapshot().localPort, null, 'token-only updates keep the compatibility localPort null');
  assert.equal(server.running, false, 'the WAN session must not require a local listener');
  assert.equal(localKeys.length, 0, 'the WAN session must not require local keys');

  const wanGlobal = openWanChannel('/rpc');
  const wanReady = await awaitChannelJson(wanGlobal, (message) => message.type !== undefined, 'WAN global ready');
  assert.deepEqual(wanReady, { type: 'avi-remote-ready', version: 2 });
  sendWanJson(wanGlobal, 20, 'rpc:discover');
  const wanDiscover = await awaitChannelJson(wanGlobal, (message) => message.id === 20, 'WAN discover');
  assert.equal(wanDiscover.result.scope, 'global');

  const dispatchBeforeRejection = dispatched.length;
  for (const frame of [
    { type: 'avi-remote-open', version: 1, apiKey: 'legacy-key', path: '/rpc' },
    { type: 'avi-remote-open', version: 2, apiKey: 'smuggled-key', path: '/rpc' },
  ]) {
    const rejectedId = randomUUID();
    sendToPublisher({ type: 'open', channelId: rejectedId });
    sendToPublisher({ type: 'data', channelId: rejectedId, encoding: 'text', data: JSON.stringify(frame) });
    const rejectedError = await awaitChannelJson(rejectedId, (message) => message.type === 'avi-remote-error', 'rejected open');
    assert.equal(rejectedError.version, 2);
    assert.equal(rejectedError.code, 'invalid_open');
    await awaitEnvelope((item) => item.type === 'close' && item.channelId === rejectedId, 'rejected close');
  }
  assert.equal(dispatched.length, dispatchBeforeRejection, 'legacy or key-bearing opens must never reach RPC dispatch');

  sendToPublisher({ type: 'data', channelId: wanGlobal, encoding: 'text', data: JSON.stringify({ type: 'avi-remote-ping', version: 2, id: 'wan-ping-1' }) });
  const wanPong = await awaitChannelJson(wanGlobal, (message) => message.type === 'avi-remote-pong', 'WAN pong');
  assert.deepEqual(wanPong, { type: 'avi-remote-pong', version: 2, id: 'wan-ping-1' });

  const wanStream = openWanChannel('/rpc/conversations/streams/conv-1');
  const wanStreamReady = await awaitChannelJson(wanStream, (message) => message.type !== undefined, 'WAN stream ready');
  assert.deepEqual(wanStreamReady, { type: 'avi-remote-ready', version: 2 });
  const bridgeReady = await awaitChannelJson(wanStream, (message) => message.method === 'conversation:ready', 'bridge conversation:ready');
  assert.equal(bridgeReady.params.conversationId, 'conv-1');
  emitChatEvent({ conversationId: 'conv-1', type: 'conversation', payload: { text: 'hello-wan' } });
  const bridgeEvent = await awaitChannelJson(wanStream, (message) => message.method === 'conversation:event', 'bridge conversation:event');
  assert.equal(bridgeEvent.params.conversationId, 'conv-1');
  assert.deepEqual(bridgeEvent.params.event, { conversationId: 'conv-1', type: 'conversation', payload: { text: 'hello-wan' } });

  sendToPublisher({ type: 'close', channelId: wanStream });
  await sleep(60);
  emitChatEvent({ conversationId: 'conv-1', type: 'conversation', payload: { text: 'late-after-close' } });
  await expectNoEnvelope((item) => item.type === 'data' && String(item.data ?? '').includes('late-after-close'));

  localKeys.push({ value: 'local-key', expiresAt: null });
  await sleep(80);
  sendWanJson(wanGlobal, 22, 'rpc:discover');
  assert.equal((await awaitChannelJson(wanGlobal, (message) => message.id === 22, 'discover with local key')).result.scope, 'global');
  localKeys.splice(0, localKeys.length);
  await sleep(80);
  sendWanJson(wanGlobal, 23, 'rpc:discover');
  assert.equal((await awaitChannelJson(wanGlobal, (message) => message.id === 23, 'discover after key deletion')).result.scope, 'global',
    'deleting the last local key must not affect the WAN session');
  assert.equal(relay.snapshot().status, 'connected');

  sendWanJson(wanGlobal, 24, 'remote:state', { payload: { includeRelay: true } });
  const wanState = await awaitChannelJson(wanGlobal, (message) => message.id === 24, 'WAN state');
  assert.deepEqual(wanState.result, { running: true, relay: { status: 'connected' } });

  await server.start(0);
  assert.ok(server.port > 0);

  assert.equal((await httpRequest('/mcp', mcpHeaders, initializeRequest)).status, 401);
  assert.equal((await httpRequest('/mcp', { ...mcpHeaders, authorization: 'Bearer wrong-key' }, initializeRequest)).status, 401);
  localKeys.push({ value: 'local-key', expiresAt: null });
  const localOk = await httpRequest('/mcp', { ...mcpHeaders, ...validAuth() }, initializeRequest);
  assert.equal(localOk.status, 200);
  assert.ok(JSON.parse(localOk.body).result);

  for (const foreignHost of ['attacker.example:8081', 'avi-relay.aivax.net', 'avi-relay.aivax.net:18443']) {
    assert.equal((await httpRequest('/mcp', { ...mcpHeaders, host: foreignHost, ...validAuth() }, initializeRequest)).status, 403);
    assert.equal((await httpRequest('/mcp', { ...mcpHeaders, host: foreignHost }, initializeRequest)).status, 403);
    assert.equal((await upgradeRequest('/rpc', { host: foreignHost, ...validAuth() })).status, 404);
  }

  const protocolKey = `avi-api-key.${Buffer.from('local-key').toString('base64url')}`;
  const protocolUpgrade = await upgradeRequest('/rpc', {
    ...validAuth(),
    'sec-websocket-protocol': `${protocolKey}, avi-rpc-v1`,
  });
  assert.equal(protocolUpgrade.status, 101);
  protocolUpgrade.socket.destroy();

  assert.match((await rejectedUpgrade('/rpc')).message, /: 401$/);
  const forgedProtocol = `avi-api-key.${Buffer.from('wrong-key').toString('base64url')}`;
  assert.match((await rejectedUpgrade('/rpc', { 'sec-websocket-protocol': forgedProtocol })).message, /: 401$/);

  localKeys.splice(0, localKeys.length);
  assert.equal((await httpRequest('/mcp', { ...mcpHeaders, ...validAuth() }, initializeRequest)).status, 401,
    'a deleted local key must stop authenticating direct local requests');

  sendWanJson(wanGlobal, 25, 'rpc:discover');
  assert.equal((await awaitChannelJson(wanGlobal, (message) => message.id === 25, 'discover after listener start')).result.scope, 'global',
    'the WAN session must ignore local listener and key state entirely');

  await relay.update({ accessToken: 'revoked-aivax-token' });
  await waitForState(() => relay.snapshot().status === 'unauthorized', 'relay credential loss');
  assert.match(relay.snapshot().error, /AIVAX credential/);
  assert.equal((await httpRequest('/mcp', mcpHeaders, initializeRequest)).status, 401, 'local auth must be unchanged by the relay credential loss');

  await relay.update();
  await waitForState(() => relay.snapshot().status === 'stopped', 'relay stop');
  assert.equal(relay.snapshot().error, '');
  await waitForState(() => publishers.size === 0, 'publisher disconnect');
  console.log('Remote relay RPC contract tests passed.');
} catch (error) {
  failure = error;
} finally {
  for (const socket of sockets.splice(0)) socket.terminate();
  try {
    await server.close();
  } catch { }
  try {
    database?.closeDatabase?.();
  } catch { }
  try {
    reopenedDatabase?.closeDatabase?.();
  } catch { }
  rmSync(testProfile, { recursive: true, force: true });
}
if (failure) {
  console.error(failure);
  process.exit(1);
}
process.exit(0);
