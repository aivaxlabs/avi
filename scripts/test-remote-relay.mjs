import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { AIVAX_RELAY_URL, RemoteRelay } from '../src/main/remote-relay.js';

const TOKEN = 'secret-aivax-token';
const DEVICE_ID = 'desktop-test-01';
const NAME = 'Test desktop';
const ACCOUNT_ID = '1b2b3b4b-5b6b-4b7b-8b9b-0b1b2b3b4b5b';
const TICKET_PROTOCOL_PREFIX = 'avi-relay-ticket.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalRandom = Math.random;

class MockRelay {
  constructor() {
    this.requests = [];
    this.issuedTickets = [];
    this.validTickets = new Set();
    this.publishers = new Set();
    this.envelopes = [];
    this.waiters = [];
    this.upgrades = 0;
    this.lastProtocols = null;
    this.ticketDelayMs = 0;
    this.upgradeDelayMs = 0;
    this.script = [];
    this.server = createServer((request, response) => this.handleTicket(request, response));
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 4 * 1024 * 1024,
      handleProtocols: (protocols) => (protocols.has('avi-relay-v1') ? 'avi-relay-v1' : false),
    });
    this.server.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head));
  }

  async listen() {
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = this.server.address().port;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async close() {
    for (const publisher of this.publishers) publisher.terminate();
    const closed = new Promise((resolve) => this.server.close(resolve));
    this.server.closeAllConnections?.();
    await closed;
  }

  ticketBody(overrides = {}) {
    return {
      ticket: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + 60_000,
      websocketUrl: `ws://127.0.0.1:${this.port}/v1/relays/${ACCOUNT_ID}/${DEVICE_ID}/connect`,
      protocol: 'avi-relay-v1',
      ...overrides,
    };
  }

  handleTicket(request, response) {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      this.requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
        at: Date.now(),
      });
      const next = this.script.shift() ?? (() => {
        const body = this.ticketBody();
        return { status: 201, body };
      })();
      if (this.ticketDelayMs > 0) await sleep(this.ticketDelayMs);
      if (next.status === 201 && typeof next.body?.ticket === 'string') {
        this.issuedTickets.push(next.body.ticket);
        this.validTickets.add(next.body.ticket);
      }
      response.writeHead(next.status, next.headers ?? { 'content-type': 'application/json' });
      response.end(typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {}));
    });
  }

  handleUpgrade(request, socket, head) {
    this.upgrades += 1;
    this.lastProtocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((item) => item.trim());
    const ticketProtocol = this.lastProtocols.find((protocol) => protocol.startsWith(TICKET_PROTOCOL_PREFIX));
    const ticket = ticketProtocol?.slice(TICKET_PROTOCOL_PREFIX.length) ?? null;
    if (!this.lastProtocols.includes('avi-relay-v1') || !ticket || !this.validTickets.has(ticket)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.validTickets.delete(ticket);
    const accept = () => {
      if (socket.destroyed) return;
      this.wss.handleUpgrade(request, socket, head, (client) => {
        this.publishers.add(client);
        client.on('message', (data, isBinary) => {
          if (isBinary) return;
          const envelope = JSON.parse(data.toString('utf8'));
          this.envelopes.push(envelope);
          for (const waiter of [...this.waiters]) waiter(envelope);
        });
        client.once('close', () => this.publishers.delete(client));
      });
    };
    if (this.upgradeDelayMs > 0) setTimeout(accept, this.upgradeDelayMs);
    else accept();
  }

  sendToPublisher(envelope) {
    for (const publisher of this.publishers) publisher.send(JSON.stringify(envelope));
  }

  closePublisher(code, reason) {
    for (const publisher of this.publishers) publisher.close(code, reason);
  }

  async takeEnvelope(predicate = () => true, timeoutMs = 2_000) {
    const index = this.envelopes.findIndex(predicate);
    if (index !== -1) return this.envelopes.splice(index, 1)[0];
    return new Promise((resolve, reject) => {
      const waiter = (envelope) => {
        if (!predicate(envelope)) return;
        const index = this.envelopes.indexOf(envelope);
        if (index !== -1) this.envelopes.splice(index, 1);
        clearTimeout(timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        resolve(envelope);
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error('timed out waiting for a publisher envelope'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  takeChannelError(channelId, code, timeoutMs = 2_000) {
    return this.takeEnvelope((envelope) => {
      if (envelope.type !== 'data' || envelope.channelId !== channelId || envelope.encoding !== 'text') return false;
      try {
        const frame = JSON.parse(envelope.data);
        return frame.type === 'avi-remote-error' && frame.version === 2 && frame.code === code;
      } catch {
        return false;
      }
    }, timeoutMs);
  }

  takeChannelClose(channelId, timeoutMs = 2_000) {
    return this.takeEnvelope((envelope) => envelope.type === 'close' && envelope.channelId === channelId, timeoutMs);
  }

  async expectNoEnvelope(predicate, waitMs = 60) {
    await sleep(waitMs);
    assert.equal(this.envelopes.find(predicate), undefined, 'unexpected publisher envelope');
  }
}

class MockLocal {
  constructor() {
    this.sockets = [];
    this.messages = [];
    this.connections = 0;
    this.lastHeaders = null;
    this.lastPath = null;
    this.onConnection = null;
    this.server = createServer();
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1024 * 1024,
    });
    this.server.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head));
  }

  async listen() {
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = this.server.address().port;
  }

  async close() {
    for (const socket of [...this.sockets]) socket.terminate();
    const closed = new Promise((resolve) => this.server.close(resolve));
    this.server.closeAllConnections?.();
    await closed;
  }

  handleUpgrade(request, socket, head) {
    this.lastHeaders = request.headers;
    this.lastPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const route = this.lastPath === '/rpc' || /^\/rpc\/conversations\/streams\/[^/]+$/.test(this.lastPath);
    if (!route) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (client) => {
      this.connections += 1;
      this.sockets.push(client);
      client.on('message', (data, isBinary) => this.messages.push({ socket: client, isBinary, data }));
      client.once('close', () => {
        this.sockets = this.sockets.filter((candidate) => candidate !== client);
      });
      this.onConnection?.(client);
    });
  }

  async waitForSockets(count, timeoutMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.sockets.length < count && Date.now() < deadline) await sleep(10);
    assert.equal(this.sockets.length, count, `expected ${count} local socket(s), got ${this.sockets.length}`);
  }
}

const createRelay = ({ relay, local, ...overrides } = {}) => new RemoteRelay({
  deviceId: DEVICE_ID,
  name: NAME,
  relayBaseUrl: relay.baseUrl,
  retryBaseMs: 20,
  retryStableMs: 150,
  revocationCheckMs: 40,
  handshakeTimeoutMs: 400,
  ...(local ? { createLocalSocket: (path) => new WebSocket(`ws://127.0.0.1:${local.port}${path}`) } : {}),
  ...overrides,
});

async function waitForStatus(relay, status, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (relay.snapshot().status !== status && Date.now() < deadline) await sleep(10);
  assert.equal(relay.snapshot().status, status, `expected status ${status}, got ${JSON.stringify(relay.snapshot())}`);
}

async function establishChannel() {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  await relay.update({ accessToken: TOKEN });
  await waitForStatus(relay, 'connected');
  return { relayServer, local, relay };
}

async function openReadyChannel(relayServer, local, channelId, { path = '/rpc' } = {}) {
  const expectedSockets = local.sockets.length + 1;
  relayServer.sendToPublisher({ type: 'open', channelId });
  relayServer.sendToPublisher({
    type: 'data',
    channelId,
    encoding: 'text',
    data: JSON.stringify({ type: 'avi-remote-open', version: 2, path }),
  });
  const ready = await relayServer.takeEnvelope((envelope) => envelope.channelId === channelId
    && envelope.encoding === 'text' && envelope.data.includes('avi-remote-ready'));
  assert.deepEqual(JSON.parse(ready.data), { type: 'avi-remote-ready', version: 2 });
  await local.waitForSockets(expectedSockets);
  return channelId;
}

async function closeAll(handles) {
  await handles.relay.update().catch(() => {});
  await Promise.all([handles.relayServer.close(), handles.local.close()]);
}

const newChannelId = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

function expectNoSecrets(relay, ...extra) {
  const serialized = JSON.stringify(relay.snapshot());
  for (const secret of [TOKEN, ...extra]) {
    assert.ok(!serialized.includes(secret), `snapshot leaked secret: ${secret}`);
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('starts idle with the exact secret-free snapshot shape and no network activity', async () => {
  const relay = new RemoteRelay({ deviceId: DEVICE_ID, name: NAME });
  assert.deepEqual(relay.snapshot(), {
    status: 'stopped',
    serverUrl: AIVAX_RELAY_URL,
    deviceId: DEVICE_ID,
    localPort: null,
    error: '',
  });
});

test('makes no network call when the token or deviceId is missing', async () => {
  const relayServer = new MockRelay();
  await relayServer.listen();
  try {
    const relay = new RemoteRelay({ deviceId: '', relayBaseUrl: relayServer.baseUrl });
    await relay.update({ accessToken: TOKEN });
    assert.equal(relay.snapshot().status, 'error');
    const idle = createRelay({ relay: relayServer, local: undefined });
    for (const update of [{ accessToken: '' }, { accessToken: null }, {}]) {
      await idle.update(update);
      assert.equal(idle.snapshot().status, 'stopped');
    }
    assert.equal(relayServer.requests.length, 0);
    await idle.update();
  } finally {
    await relayServer.close();
  }
});

test('starts from the token alone, keeps localPort null, and requests a publisher ticket with the exact shape', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    const request = relayServer.requests[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `/v1/relays/${DEVICE_ID}/tickets`);
    assert.equal(request.authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(request.body), { role: 'publisher', name: NAME });
    assert.equal(relay.snapshot().localPort, null, 'token-only updates must not report a local port');
    await relay.update({ accessToken: TOKEN, port: local.port });
    await waitForStatus(relay, 'connected');
    assert.equal(relay.snapshot().localPort, local.port, 'the port argument stays accepted for snapshot compatibility');
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    assert.equal(relay.snapshot().localPort, null);
    assert.equal(relayServer.upgrades, 3, 'each configuration change must reconnect with a fresh ticket');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('stops with unauthorized status on ticket 401 and never retries or upgrades', async () => {
  const relayServer = new MockRelay();
  await relayServer.listen();
  const relay = createRelay({ relay: relayServer, local: undefined });
  try {
    relayServer.script.push({ status: 401, body: { error: 'invalid key' } });
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'unauthorized');
    assert.match(relay.snapshot().error, /AIVAX credential/);
    await sleep(80);
    assert.equal(relayServer.requests.length, 1);
    assert.equal(relayServer.upgrades, 0);
    expectNoSecrets(relay);
  } finally {
    await closeAll({ relayServer, local: new MockLocal(), relay });
  }
});

test('stops with unauthorized status on ticket 403', async () => {
  const relayServer = new MockRelay();
  await relayServer.listen();
  const relay = createRelay({ relay: relayServer, local: undefined });
  try {
    relayServer.script.push({ status: 403, body: {} });
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'unauthorized');
  } finally {
    await closeAll({ relayServer, local: new MockLocal(), relay });
  }
});

test('treats ticket 409 as transient and reconnects with a fresh ticket', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    relayServer.script.push({ status: 409, body: { error: 'publisher exists' } });
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    assert.equal(relayServer.requests.length, 2);
    assert.equal(relayServer.upgrades, 1);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('rejects redirect responses on ticket acquisition as transient', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    relayServer.script.push({ status: 302, headers: { location: `${relayServer.baseUrl}/elsewhere` }, body: {} });
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    assert.equal(relayServer.requests.length, 2);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('rejects malformed or mismatched ticket shapes permanently without contacting the relay socket', async () => {
  const relayServer = new MockRelay();
  await relayServer.listen();
  const relay = createRelay({ relay: relayServer, local: undefined });
  try {
    const variants = [
      relayServer.ticketBody({ ticket: 'not-hex' }),
      relayServer.ticketBody({ protocol: 'avi-relay-v2' }),
      relayServer.ticketBody({ expiresAt: 'soon' }),
      relayServer.ticketBody({ websocketUrl: undefined }),
      relayServer.ticketBody({ websocketUrl: `ws://evil.example/v1/relays/${ACCOUNT_ID}/${DEVICE_ID}/connect` }),
      relayServer.ticketBody({ websocketUrl: `ws://user:pass@127.0.0.1:${relayServer.port}/v1/relays/${ACCOUNT_ID}/${DEVICE_ID}/connect` }),
      relayServer.ticketBody({ websocketUrl: `ws://127.0.0.1:${relayServer.port}/v1/relays/${ACCOUNT_ID}/${DEVICE_ID}/connect#fragment` }),
      relayServer.ticketBody({ websocketUrl: `ws://127.0.0.1:${relayServer.port}/v1/relays/${ACCOUNT_ID}/${DEVICE_ID}/connect?x=1` }),
      relayServer.ticketBody({ websocketUrl: `ws://127.0.0.1:${relayServer.port}/v1/relays/not-a-uuid/${DEVICE_ID}/connect` }),
      relayServer.ticketBody({ websocketUrl: `ws://127.0.0.1:${relayServer.port}/v1/relays/${ACCOUNT_ID}/other-device/connect` }),
    ];
    for (const [index, body] of variants.entries()) {
      relayServer.script.push({ status: 201, body });
      await relay.update({ accessToken: TOKEN });
      await waitForStatus(relay, 'error');
      assert.match(relay.snapshot().error, /unexpected session ticket/);
      assert.equal(relayServer.requests.length, index + 1);
      assert.equal(relayServer.upgrades, 0);
      await relay.update({ enabled: false });
      await relay.update({ accessToken: TOKEN });
    }
  } finally {
    await closeAll({ relayServer, local: new MockLocal(), relay });
  }
});

test('treats an already expired ticket as transient and recovers with a fresh one', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    relayServer.script.push({ status: 201, body: relayServer.ticketBody({ expiresAt: Date.now() - 1 }) });
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    assert.equal(relayServer.requests.length, 2);
    assert.equal(relayServer.upgrades, 1);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('offers exactly avi-relay-v1 plus the fresh single-use ticket protocol', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    assert.deepEqual(relayServer.lastProtocols, ['avi-relay-v1', `${TICKET_PROTOCOL_PREFIX}${relayServer.issuedTickets[0]}`]);
    assert.equal(relayServer.validTickets.size, 0);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('completes the opening handshake without any credential and ready precedes data', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    local.onConnection = (socket) => socket.send('early-notification');
    const channelId = newChannelId();
    await openReadyChannel(relayServer, local, channelId);
    assert.equal(local.lastPath, '/rpc');
    assert.equal(local.lastHeaders.authorization, undefined, 'the local open must carry no credential');
    assert.equal(local.lastHeaders['sec-websocket-protocol'], undefined, 'the local open must offer no key subprotocol');
    const forwarded = await relayServer.takeEnvelope((envelope) => envelope.channelId === channelId);
    assert.equal(forwarded.encoding, 'text');
    assert.equal(forwarded.data, 'early-notification');
    expectNoSecrets(relay);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('accepts the conversation stream route with an encoded but safe id', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = newChannelId();
    await openReadyChannel(relayServer, local, channelId, { path: '/rpc/conversations/streams/conv%20name' });
    assert.equal(local.lastPath, '/rpc/conversations/streams/conv%20name');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('rejects unapproved or unsafe opening paths without local contact', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const rejectedPaths = [
      '/mcp',
      '/rpc/',
      '/rpc/extra',
      '/rpc/conversations/streams/x/y',
      '/rpc?query=1',
      '/rpc#fragment',
      '/rpc\\..',
      '/rpc%2F',
      '/rpc/conversations/streams/..%2F..%2Fetc%2Fpasswd',
      '/rpc/conversations/streams/..',
      '/rpc/conversations/streams/.',
      '/rpc/conversations/streams/a%2Fb',
      '/rpc/conversations/streams/bad%ZZ',
      '/rpc/conversations/streams/%00',
      '/rpc/conversations/streams/%3F',
      '/rpc/conversations/streams/%23',
    ];
    for (const path of rejectedPaths) {
      const channelId = newChannelId();
      relayServer.sendToPublisher({ type: 'open', channelId });
      relayServer.sendToPublisher({
        type: 'data',
        channelId,
        encoding: 'text',
        data: JSON.stringify({ type: 'avi-remote-open', version: 2, path }),
      });
      await relayServer.takeChannelError(channelId, 'invalid_open');
      await relayServer.takeChannelClose(channelId);
      assert.equal(local.connections, 0, `local server contacted for path ${path}`);
    }
    assert.equal(relay.snapshot().status, 'connected');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('rejects legacy version-1 and apiKey-bearing opens before any local contact', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const rejectedFrames = [
      { type: 'avi-remote-open', version: 1, apiKey: 'remote-key-abc', path: '/rpc' },
      { type: 'avi-remote-open', version: 1, path: '/rpc' },
      { type: 'avi-remote-open', version: 2, apiKey: 'remote-key-abc', path: '/rpc' },
      { type: 'avi-remote-open', version: 3, path: '/rpc' },
      { type: 'avi-remote-open', path: '/rpc' },
    ];
    for (const frame of rejectedFrames) {
      const channelId = newChannelId();
      relayServer.sendToPublisher({ type: 'open', channelId });
      relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'text', data: JSON.stringify(frame) });
      await relayServer.takeChannelError(channelId, 'invalid_open');
      await relayServer.takeChannelClose(channelId);
      assert.equal(local.connections, 0, `local contacted for frame ${JSON.stringify(frame)}`);
    }
    assert.equal(local.connections, 0);
    assert.equal(relay.snapshot().status, 'connected');
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    assert.ok(channelId, 'a valid v2 open without apiKey must still work after rejections');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('reports unavailable per channel when the local socket factory is missing and keeps the session alive', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local: undefined, createLocalSocket: undefined });
  try {
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    for (let index = 0; index < 2; index += 1) {
      const channelId = newChannelId();
      relayServer.sendToPublisher({ type: 'open', channelId });
      relayServer.sendToPublisher({
        type: 'data',
        channelId,
        encoding: 'text',
        data: JSON.stringify({ type: 'avi-remote-open', version: 2, path: '/rpc' }),
      });
      await relayServer.takeChannelError(channelId, 'unavailable');
      await relayServer.takeChannelClose(channelId);
    }
    assert.equal(relay.snapshot().status, 'connected', 'a missing factory must fail per channel, not kill the session');
    assert.equal(relayServer.publishers.size, 1);
    assert.equal(local.connections, 0);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('ignores data for unknown channels and rejects frames before the opening completes', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    relayServer.sendToPublisher({ type: 'data', channelId: newChannelId(), encoding: 'text', data: 'stray' });
    await relayServer.expectNoEnvelope(() => true);

    const channelId = newChannelId();
    relayServer.sendToPublisher({ type: 'open', channelId });
    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'text', data: '{"jsonrpc":"2.0"}' });
    await relayServer.takeChannelError(channelId, 'invalid_open');
    await relayServer.takeChannelClose(channelId);
    assert.equal(local.connections, 0);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('closes a channel that never completes the opening handshake', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = newChannelId();
    relayServer.sendToPublisher({ type: 'open', channelId });
    await relayServer.takeChannelClose(channelId, 1_500);
    await relayServer.expectNoEnvelope((envelope) => envelope.channelId === channelId && envelope.type === 'avi-remote-error');
    assert.equal(local.connections, 0);
    assert.equal(relay.snapshot().status, 'connected');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('keeps conversation channels isolated and cleans up independently', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const first = await openReadyChannel(relayServer, local, newChannelId());
    const second = await openReadyChannel(relayServer, local, newChannelId(), { path: '/rpc/conversations/streams/conv-1' });
    const [firstSocket, secondSocket] = local.sockets;

    relayServer.sendToPublisher({ type: 'data', channelId: first, encoding: 'text', data: JSON.stringify({ only: 'first' }) });
    await sleep(20);
    assert.equal(local.messages.length, 1, 'data must reach only the addressed channel');
    assert.equal(local.messages[0].socket, firstSocket);

    relayServer.sendToPublisher({ type: 'close', channelId: first });
    await sleep(30);
    assert.equal(local.sockets.length, 1, 'closing one channel must not touch the other');
    assert.equal(local.sockets[0], secondSocket);
    local.sockets[0].send('still-alive');
    const forwarded = await relayServer.takeEnvelope((envelope) => envelope.channelId === second && envelope.data === 'still-alive');
    assert.equal(forwarded.channelId, second);

    await openReadyChannel(relayServer, local, newChannelId());
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('passes text and binary payloads opaquely in both directions', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());

    const rpcText = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'rpc:discover', params: {} });
    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'text', data: rpcText });
    await sleep(20);
    assert.equal(local.messages.filter((message) => !message.isBinary).at(-1).data.toString('utf8'), rpcText);

    local.sockets[0].send(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ok: true } }));
    const reply = await relayServer.takeEnvelope((envelope) => envelope.channelId === channelId && envelope.data.includes('"id":7'));
    assert.equal(reply.encoding, 'text');

    const bytes = Buffer.from([0, 255, 1, 2, 254]);
    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'base64', data: bytes.toString('base64') });
    await sleep(20);
    const binaryMessage = local.messages.find((message) => message.isBinary);
    assert.ok(binaryMessage);
    assert.ok(binaryMessage.data.equals(bytes));

    const replyBytes = Buffer.from([9, 8, 7]);
    local.sockets[0].send(replyBytes);
    const binaryReply = await relayServer.takeEnvelope((envelope) => envelope.channelId === channelId && envelope.encoding === 'base64');
    assert.ok(Buffer.from(binaryReply.data, 'base64').equals(replyBytes));
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('rejects non-canonical base64 payloads without local delivery', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'base64', data: 'not base64!!' });
    await relayServer.takeChannelClose(channelId, 1_000);
    await sleep(20);
    assert.equal(local.messages.length, 0);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('closes a channel whose post-ready text payload exceeds 1 MiB', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'text', data: 'x'.repeat(1024 * 1024 + 1) });
    await relayServer.takeChannelClose(channelId, 1_000);
    await sleep(20);
    assert.equal(local.messages.length, 0);
    assert.equal(relay.snapshot().status, 'connected');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('answers v2 application pings after ready without forwarding them to the local server', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());

    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'text', data: JSON.stringify({ type: 'avi-remote-ping', version: 2, id: 'p-1' }) });
    const pong = await relayServer.takeEnvelope((envelope) => envelope.data.includes('avi-remote-pong'));
    assert.equal(pong.channelId, channelId);
    assert.deepEqual(JSON.parse(pong.data), { type: 'avi-remote-pong', version: 2, id: 'p-1' });
    await sleep(20);
    assert.equal(local.messages.length, 0);

    for (const ping of [
      { type: 'avi-remote-ping', version: 1, id: 'legacy' },
      { type: 'avi-remote-ping', id: 'no-version' },
      { type: 'avi-remote-ping', version: 2, id: 'x'.repeat(200) },
    ]) {
      relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'text', data: JSON.stringify(ping) });
    }
    await relayServer.expectNoEnvelope((envelope) => envelope.data.includes('avi-remote-pong'));
    assert.equal(local.messages.length, 0);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('ignores data addressed to a channel after it closed', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    relayServer.sendToPublisher({ type: 'close', channelId });
    await sleep(30);
    assert.equal(local.sockets.length, 0);

    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'text', data: JSON.stringify({ jsonrpc: '2.0', id: 99, result: 'late' }) });
    await relayServer.expectNoEnvelope(() => true);
    assert.equal(relay.snapshot().status, 'connected');

    await openReadyChannel(relayServer, local, newChannelId());
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('closes the local socket on consumer close and allows a fresh channel afterwards', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    relayServer.sendToPublisher({ type: 'close', channelId });
    await sleep(30);
    assert.equal(local.sockets.length, 0);

    await openReadyChannel(relayServer, local, newChannelId());
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('closes the channel with a close envelope when the local socket ends', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    local.sockets[0].close(1000);
    const closed = await relayServer.takeChannelClose(channelId);
    assert.deepEqual(closed, { type: 'close', channelId });
    assert.equal(relay.snapshot().status, 'connected');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('caps active channels at 32 and refuses the 33rd without touching existing ones', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    for (let index = 0; index < 32; index += 1) {
      const channelId = `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, '0')}`;
      await openReadyChannel(relayServer, local, channelId);
    }
    const overflow = 'aaaaaaaa-0000-4000-8000-ffffffffffff';
    relayServer.sendToPublisher({ type: 'open', channelId: overflow });
    await relayServer.takeChannelError(overflow, 'unavailable');
    await relayServer.takeChannelClose(overflow);
    assert.equal(local.connections, 32);
    assert.equal(local.sockets.length, 32);
    assert.equal(relay.snapshot().status, 'connected');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('fails closed on a duplicated channel open and does not blind-retry', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    relayServer.sendToPublisher({ type: 'open', channelId });
    await sleep(60);
    assert.equal(relayServer.publishers.size, 0);
    assert.equal(relay.snapshot().status, 'error');
    assert.match(relay.snapshot().error, /reused an active channel/);
    const tickets = relayServer.requests.length;
    await sleep(100);
    assert.equal(relayServer.requests.length, tickets);
    assert.equal(local.sockets.length, 0);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('reconnects with cleanup after a 4001 session expiry and honors 1009 as permanent', async () => {
  const handles = await establishChannel();
  const { relayServer, local, relay } = handles;
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());

    relayServer.closePublisher(4001);
    await sleep(120);
    assert.equal(local.sockets.length, 0);
    await waitForStatus(relay, 'connected', 3_000);
    assert.equal(relay.snapshot().error, '');
    await openReadyChannel(relayServer, local, newChannelId());

    relayServer.closePublisher(1009);
    await waitForStatus(relay, 'error');
    assert.match(relay.snapshot().error, /oversized payload/);
    const tickets = relayServer.requests.length;
    await sleep(120);
    assert.equal(relayServer.requests.length, tickets);
    await relay.update({ accessToken: TOKEN });
    assert.equal(relayServer.requests.length, tickets, 'same-config update must not restart after a terminal error');
  } finally {
    await closeAll(handles);
  }
});

test('fails closed on the outbound rate limit instead of retrying into a 1008 violation', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = newChannelId();
    local.onConnection = (socket) => {
      for (let index = 0; index < 200; index += 1) socket.send(`burst-${index}`);
    };
    await openReadyChannel(relayServer, local, channelId);
    await waitForStatus(relay, 'error');
    assert.match(relay.snapshot().error, /rate/);
    const tickets = relayServer.requests.length;
    await sleep(120);
    assert.equal(relayServer.requests.length, tickets);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('drops a channel whose outbound envelope would exceed the service size bound', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    local.sockets[0].send(Buffer.alloc(Math.ceil(1.6 * 1024 * 1024)));
    await relayServer.takeChannelClose(channelId, 1_000);
    await sleep(30);
    assert.equal(local.sockets.length, 0);
    assert.equal(relay.snapshot().status, 'connected');
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('rejects an inbound payload larger than 1 MiB without local delivery', async () => {
  const { relayServer, local, relay } = await establishChannel();
  try {
    const channelId = await openReadyChannel(relayServer, local, newChannelId());
    relayServer.sendToPublisher({ type: 'data', channelId, encoding: 'base64', data: Buffer.alloc(1024 * 1024 + 1).toString('base64') });
    await relayServer.takeChannelClose(channelId, 1_000);
    await sleep(30);
    assert.equal(local.messages.length, 0);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('shutdown aborts an in-flight ticket, stops the retry cycle, and restarts cleanly', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    relayServer.ticketDelayMs = 200;
    const startedAt = Date.now();
    const updatePromise = relay.update({ accessToken: TOKEN });
    await sleep(30);
    await updatePromise;
    assert.ok(Date.now() - startedAt < 150, 'update must return promptly');
    await relay.update();
    assert.equal(relay.snapshot().status, 'stopped');
    relayServer.ticketDelayMs = 0;

    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    expectNoSecrets(relay, TOKEN);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('grows backoff during an outage after a short connection and resets after a stable one', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    Math.random = () => 0.5; // deterministic jitter midpoint: delay = raw * 0.75
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    relayServer.closePublisher(4001);
    for (let index = 0; index < 5; index += 1) relayServer.script.push({ status: 409, body: {} });
    const startCount = relayServer.requests.length;
    const deadline = Date.now() + 10_000;
    while (relayServer.requests.length < startCount + 5 && Date.now() < deadline) await sleep(5);
    assert.equal(relayServer.requests.length, startCount + 5);
    const stamps = relayServer.requests.slice(startCount, startCount + 5).map((request) => request.at);
    const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index]);
    assert.ok(gaps[0] < 100, `first retry gap ${gaps[0]}ms should stay near the base delay`);
    assert.ok(gaps.at(-1) > 150, `last retry gap ${gaps.at(-1)}ms should reflect exponential growth`);
    await waitForStatus(relay, 'connected', 10_000);
    await sleep(250);
    const closeAt = Date.now();
    relayServer.closePublisher(4001);
    const before = relayServer.requests.length;
    const stableDeadline = closeAt + 2_000;
    while (relayServer.requests.length === before && Date.now() < stableDeadline) await sleep(5);
    assert.ok(Date.now() - closeAt < 400, 'a stable connection must reset the backoff to the base delay');
  } finally {
    Math.random = originalRandom;
    await closeAll({ relayServer, local, relay });
  }
});

test('supports injectable fetch and relay socket factories', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const fetchCalls = [];
  let wrappedSockets = 0;
  const relay = new RemoteRelay({
    deviceId: DEVICE_ID,
    name: NAME,
    relayBaseUrl: relayServer.baseUrl,
    retryBaseMs: 20,
    retryStableMs: 150,
    revocationCheckMs: 40,
    handshakeTimeoutMs: 400,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetch(url, init);
    },
    createRelaySocket: (url, protocols, options) => {
      wrappedSockets += 1;
      return new WebSocket(url, protocols, options);
    },
    createLocalSocket: (path) => new WebSocket(`ws://127.0.0.1:${local.port}${path}`),
  });
  try {
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init.method, 'POST');
    assert.ok(fetchCalls[0].url.endsWith(`/v1/relays/${DEVICE_ID}/tickets`));
    assert.equal(wrappedSockets, 1);
  } finally {
    await closeAll({ relayServer, local, relay });
  }
});

test('the stable backoff reset is consumed once and later failures grow again', async () => {
  const relayServer = new MockRelay();
  const local = new MockLocal();
  await Promise.all([relayServer.listen(), local.listen()]);
  const relay = createRelay({ relay: relayServer, local });
  try {
    Math.random = () => 0.5; // deterministic jitter midpoint: delay = raw * 0.75
    await relay.update({ accessToken: TOKEN });
    await waitForStatus(relay, 'connected');
    await sleep(250);
    for (let index = 0; index < 5; index += 1) relayServer.script.push({ status: 409, body: {} });
    relayServer.closePublisher(4001);
    const startCount = relayServer.requests.length;
    const deadline = Date.now() + 10_000;
    while (relayServer.requests.length < startCount + 5 && Date.now() < deadline) await sleep(5);
    assert.equal(relayServer.requests.length, startCount + 5);
    const stamps = relayServer.requests.slice(startCount, startCount + 5).map((request) => request.at);
    const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index]);
    assert.ok(gaps[0] < 100, `first retry after a stable session ${gaps[0]}ms should use the consumed reset`);
    assert.ok(gaps[1] > gaps[0] && gaps[2] > gaps[1] && gaps[3] > gaps[2], `gaps ${gaps.join(',')}ms must grow again once the reset is consumed`);
    assert.ok(gaps.at(-1) > 150, `last retry gap ${gaps.at(-1)}ms must reflect exponential growth after the reset is consumed`);
    await waitForStatus(relay, 'connected', 10_000);
  } finally {
    Math.random = originalRandom;
    await closeAll({ relayServer, local, relay });
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`fail - ${name}`);
    console.error(error);
  }
}
if (failures > 0) {
  console.error(`${failures} remote relay test(s) failed.`);
  process.exit(1);
}
console.log(`Remote relay WebSocket publisher tests passed (${tests.length}).`);
