import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { RemoteRelay } from '../src/main/remote-relay.js';

const CHANNEL_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CHANNEL_B = '11111111-2222-4333-8444-555555555555';
const MCP_FAILURE_BODY = 'MCP request failed or response exceeded 1 MiB.';

class FakeRelaySocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = WebSocket.OPEN;
    this.bufferedAmount = 0;
    this.protocol = 'avi-relay-v1';
    this.sent = [];
  }

  send(json) {
    this.sent.push(json);
  }

  ping() { }

  close(code = 1000) {
    if (this.readyState !== WebSocket.CLOSED) {
      this.readyState = WebSocket.CLOSED;
      this.emit('close', code);
    }
  }

  terminate() {
    this.close(1006);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, label, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(10);
  }
}

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

function makeRelay(handle) {
  const calls = [];
  const relay = new RemoteRelay({
    deviceId: 'test-device',
    handleMcpRequest: async (request, instanceKey) => {
      calls.push({ request, instanceKey, signal: request.signal });
      return handle(request);
    },
  });
  const socket = new FakeRelaySocket();
  relay.socket = socket;
  return { relay, socket, calls };
}

const openChannel = (relay, socket, channelId) =>
  relay.handleEnvelope(socket, relay.generation, JSON.stringify({ type: 'open', channelId }));

const sendChannelFrame = (relay, socket, frame, channelId = CHANNEL_A) =>
  relay.handleEnvelope(socket, relay.generation, JSON.stringify({ type: 'data', channelId, encoding: 'text', data: JSON.stringify(frame) }));

const sendChannelText = (relay, socket, text, channelId = CHANNEL_A) =>
  relay.handleEnvelope(socket, relay.generation, JSON.stringify({ type: 'data', channelId, encoding: 'text', data: text }));

const envelopes = (socket) => socket.sent.map((json) => JSON.parse(json));

const channelDataFrames = (socket, channelId = CHANNEL_A) => envelopes(socket)
  .filter((envelope) => envelope.type === 'data' && envelope.channelId === channelId)
  .map((envelope) => JSON.parse(envelope.data));

const errorCodes = (socket) => channelDataFrames(socket)
  .filter((frame) => frame.type === 'avi-remote-error')
  .map((frame) => frame.code);

const mcpRequestFrame = (overrides = {}) => ({
  type: 'avi-mcp-request', version: 1, method: 'POST', body: '', headers: {}, ...overrides,
});

async function relayTicketSession(instanceId) {
  const captures = [];
  const relay = new RemoteRelay({
    deviceId: 'test-device',
    ...(instanceId === undefined ? {} : { instanceId }),
    fetchImpl: async (url, options) => {
      captures.push({ url, options });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          ticket: 'a'.repeat(64),
          protocol: 'avi-relay-v1',
          expiresAt: Date.now() + 60_000,
          websocketUrl: 'wss://avi-relay.aivax.net/v1/relays/0b9e6c59-8f2a-4c7e-9d31-52a4b6c8d9e0/test-device/connect',
        }),
      };
    },
    createRelaySocket: () => {
      const socket = new FakeRelaySocket();
      setImmediate(() => socket.emit('open'));
      return socket;
    },
  });
  await relay.update({ accessToken: 'aivax-token' });
  await waitFor(() => captures.length === 1, 'publisher ticket request');
  await waitFor(() => relay.status === 'connected', 'relay session connected');
  return { relay, capture: captures[0] };
}

const failure = await (async () => {
  try {
    {
      console.log('POST forwards sanitized headers and returns the handler response');
      const postBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      const { relay, socket, calls } = makeRelay(() => new Response('{"jsonrpc":"2.0","id":1,"result":{}}', {
        status: 202,
        headers: {
          'content-type': 'application/json',
          allow: 'GET, POST',
          'mcp-protocol-version': '2025-06-18',
          'x-secret': 'nope',
          authorization: 'Bearer nope',
        },
      }));
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({
        body: postBody,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
          authorization: 'Bearer stolen-key',
          host: 'attacker.example',
          cookie: 'session=stolen',
          'x-instance-key': 'nope',
        },
      }));
      await waitFor(() => calls.length === 1, 'handler invocation');
      const call = calls[0];
      assert.equal(call.instanceKey, undefined, 'method1 frames must invoke the handler without an instanceKey');
      assert.equal(call.request.method, 'POST');
      assert.equal(call.request.url, 'http://localhost/mcp');
      assert.equal(call.request.headers.get('content-type'), 'application/json');
      assert.equal(call.request.headers.get('accept'), 'application/json, text/event-stream');
      assert.equal(call.request.headers.get('mcp-protocol-version'), '2025-06-18');
      assert.equal(call.request.headers.get('authorization'), null, 'Authorization must not be forwarded');
      assert.equal(call.request.headers.get('host'), 'localhost', 'Caller Host must be replaced with the trusted loopback authority');
      assert.equal(call.request.headers.get('cookie'), null);
      assert.equal(call.request.headers.get('x-instance-key'), null);
      assert.equal(call.request.signal.aborted, false);
      assert.equal(await call.request.text(), postBody);
      await waitFor(() => channelDataFrames(socket).some((frame) => frame.type === 'avi-mcp-response'), 'relay response frame');
      const [responseFrame] = channelDataFrames(socket);
      assert.equal(responseFrame.version, 1);
      assert.equal(responseFrame.status, 202);
      assert.deepEqual(responseFrame.headers, {
        'content-type': 'application/json',
        allow: 'GET, POST',
        'mcp-protocol-version': '2025-06-18',
      }, 'only protocol and content headers may survive the response');
      assert.equal(responseFrame.body, '{"jsonrpc":"2.0","id":1,"result":{}}');
      assert.equal(envelopes(socket).filter((envelope) => envelope.type === 'data').length, 1);
      assert.deepEqual(envelopes(socket).filter((envelope) => envelope.type === 'close').map((envelope) => envelope.channelId), [CHANNEL_A]);
      assert.equal(relay.channels.size, 0, 'the channel must be closed after the MCP response');
    }

    {
      console.log('GET and DELETE requests carry no body and forward the handler response');
      const { relay, socket, calls } = makeRelay(() => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({ method: 'GET', body: '' }));
      await waitFor(() => calls.length === 1, 'GET handler invocation');
      assert.equal(calls[0].request.method, 'GET');
      assert.equal(calls[0].request.body, null);
      assert.equal(calls[0].instanceKey, undefined);
      await waitFor(() => channelDataFrames(socket).length === 1, 'GET response frame');
      assert.equal(channelDataFrames(socket)[0].status, 200);
      assert.equal(relay.channels.size, 0);
      openChannel(relay, socket, CHANNEL_B);
      sendChannelFrame(relay, socket, mcpRequestFrame({ method: 'DELETE', body: '' }), CHANNEL_B);
      await waitFor(() => calls.length === 2, 'DELETE handler invocation');
      assert.equal(calls[1].request.method, 'DELETE');
      assert.equal(calls[1].request.body, null);
      await waitFor(() => relay.channels.size === 0, 'DELETE channel close');
    }

    {
      console.log('invalid MCP frames reject the channel with invalid_open and never reach the handler');
      const cases = [
        ['wrong version', { type: 'avi-mcp-request', version: 2, method: 'POST', body: '{}' }],
        ['unsupported method', { type: 'avi-mcp-request', version: 1, method: 'PUT', body: '{}' }],
        ['missing method', { type: 'avi-mcp-request', version: 1, body: '{}' }],
        ['missing body', { type: 'avi-mcp-request', version: 1, method: 'POST' }],
        ['non-string body', { type: 'avi-mcp-request', version: 1, method: 'POST', body: 42 }],
        ['GET with body', { type: 'avi-mcp-request', version: 1, method: 'GET', body: '{}' }],
        ['DELETE with body', { type: 'avi-mcp-request', version: 1, method: 'DELETE', body: 'x' }],
        ['request body over 512 KiB', { type: 'avi-mcp-request', version: 1, method: 'POST', body: 'x'.repeat(512 * 1024 + 1) }],
      ];
      for (const [label, frame] of cases) {
        const { relay, socket, calls } = makeRelay(() => new Response('unused'));
        openChannel(relay, socket, CHANNEL_A);
        sendChannelFrame(relay, socket, frame);
        assert.deepEqual(errorCodes(socket), ['invalid_open'], label);
        assert.deepEqual(envelopes(socket).filter((envelope) => envelope.type === 'close').map((envelope) => envelope.channelId), [CHANNEL_A], label);
        assert.equal(calls.length, 0, label);
        assert.equal(relay.channels.size, 0, label);
      }
      for (const [label, text] of [['malformed frame JSON', '{nope'], ['non-object frame', 'null']]) {
        const { relay, socket, calls } = makeRelay(() => new Response('unused'));
        openChannel(relay, socket, CHANNEL_A);
        sendChannelText(relay, socket, text);
        assert.deepEqual(errorCodes(socket), ['invalid_open'], label);
        assert.equal(calls.length, 0, label);
        assert.equal(relay.channels.size, 0, label);
      }
      const unconfigured = new RemoteRelay({ deviceId: 'test-device' });
      const socket = new FakeRelaySocket();
      unconfigured.socket = socket;
      openChannel(unconfigured, socket, CHANNEL_A);
      sendChannelFrame(unconfigured, socket, mcpRequestFrame({ body: '{}' }));
      assert.deepEqual(errorCodes(socket), ['invalid_open'], 'missing handler');
      assert.equal(unconfigured.channels.size, 0, 'missing handler');
    }

    {
      console.log('a POST body of exactly 512 KiB is accepted');
      const boundaryBody = 'x'.repeat(512 * 1024);
      const { relay, socket, calls } = makeRelay(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({ body: boundaryBody }));
      await waitFor(() => calls.length === 1, 'boundary handler invocation');
      assert.equal(await calls[0].request.text(), boundaryBody);
      await waitFor(() => relay.channels.size === 0, 'boundary channel close');
      assert.equal(channelDataFrames(socket).find((frame) => frame.type === 'avi-mcp-response')?.status, 200);
    }

    {
      console.log('a handler response over 1 MiB degrades to the 502 failure frame');
      const { relay, socket, calls } = makeRelay(() => new Response('x'.repeat(1024 * 1024), { status: 200, headers: { 'content-type': 'text/plain' } }));
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({ method: 'GET', body: '' }));
      await waitFor(() => channelDataFrames(socket).length === 1, 'failure frame');
      const [failureFrame] = channelDataFrames(socket);
      assert.equal(failureFrame.type, 'avi-mcp-response');
      assert.equal(failureFrame.version, 1);
      assert.equal(failureFrame.status, 502);
      assert.deepEqual(failureFrame.headers, {});
      assert.equal(failureFrame.body, MCP_FAILURE_BODY);
      assert.equal(calls.length, 1, 'the handler must still have been invoked once');
      await waitFor(() => relay.channels.size === 0, 'channel close after failure frame');
    }

    {
      console.log('a relay close while the handler is pending aborts the request and suppresses the reply');
      const gate = deferred();
      const { relay, socket, calls } = makeRelay(() => gate.promise);
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({ body: '{"x":1}' }));
      await waitFor(() => calls.length === 1, 'pending handler');
      const sentBeforeClose = socket.sent.length;
      relay.handleEnvelope(socket, relay.generation, JSON.stringify({ type: 'close', channelId: CHANNEL_A }));
      assert.equal(calls[0].request.signal.aborted, true, 'the handler signal must be aborted on channel close');
      assert.equal(socket.sent.length, sentBeforeClose, 'closing must not emit envelopes for the relay');
      gate.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      await sleep(50);
      assert.equal(socket.sent.length, sentBeforeClose, 'a closed channel must never receive the MCP response');
      assert.equal(relay.channels.size, 0);
    }

    {
      console.log('a stale generation suppresses the MCP reply');
      const gate = deferred();
      const { relay, socket, calls } = makeRelay(() => gate.promise);
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({ body: '{"x":1}' }));
      await waitFor(() => calls.length === 1, 'pending handler');
      const sentBeforeBump = socket.sent.length;
      relay.generation += 1;
      gate.resolve(new Response('{}', { status: 200 }));
      await sleep(50);
      assert.equal(socket.sent.length, sentBeforeBump, 'a stale generation must never receive the MCP response');
      relay.teardownChannels();
    }

    {
      console.log('a second opening frame while an MCP request is pending rejects the channel and aborts the handler');
      const gate = deferred();
      const { relay, socket, calls } = makeRelay(() => gate.promise);
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({ body: '{}' }));
      await waitFor(() => calls.length === 1, 'pending handler');
      sendChannelFrame(relay, socket, mcpRequestFrame({ body: '{}' }));
      assert.deepEqual(errorCodes(socket), ['invalid_open']);
      assert.equal(calls[0].request.signal.aborted, true);
      gate.resolve(new Response('{}', { status: 200 }));
      await sleep(50);
      assert.equal(channelDataFrames(socket).some((frame) => frame.type === 'avi-mcp-response'), false, 'no reply after the channel was rejected');
      assert.equal(relay.channels.size, 0);
    }

    {
      console.log('instanceKey reaches the handler unchanged and never leaks into headers or body');
      const instanceKey = 'relaynode1@local-key-value';
      const postBody = '{"jsonrpc":"2.0","id":7,"method":"tools/list"}';
      const { relay, socket, calls } = makeRelay(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      openChannel(relay, socket, CHANNEL_A);
      sendChannelFrame(relay, socket, mcpRequestFrame({
        body: postBody,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        instanceKey,
      }));
      await waitFor(() => calls.length === 1, 'handler invocation with instanceKey');
      const call = calls[0];
      assert.equal(call.instanceKey, instanceKey, 'the handler must receive the exact instanceKey string');
      assert.equal(call.request.headers.get('authorization'), null);
      assert.equal(call.request.headers.get('instance-key'), null);
      assert.equal(call.request.headers.get('x-instance-key'), null);
      assert.deepEqual([...call.request.headers.keys()].sort(), ['accept', 'content-type', 'host'], 'only protocol headers and synthesized loopback Host may reach the handler');
      assert.equal(await call.request.text(), postBody, 'the body must be forwarded untouched');
      await waitFor(() => relay.channels.size === 0, 'instanceKey response delivery');
      assert.equal(channelDataFrames(socket).find((frame) => frame.type === 'avi-mcp-response')?.status, 200);
    }

    {
      console.log('a valid instanceId is forwarded in the publisher ticket body');
      const { relay, capture } = await relayTicketSession('relaynode1');
      assert.equal(capture.url, 'https://avi-relay.aivax.net/v1/relays/test-device/tickets');
      assert.equal(capture.options.method, 'POST');
      assert.equal(capture.options.headers.authorization, 'Bearer aivax-token');
      const body = JSON.parse(capture.options.body);
      assert.equal(body.role, 'publisher');
      assert.equal(body.instanceId, 'relaynode1');
      await relay.stopSession();
    }

    {
      console.log('invalid instanceId values are omitted from the publisher ticket body');
      for (const invalid of ['RELAYNODE1', 'relaynode', 'relaynode11', 'relay node1', '']) {
        const { relay, capture } = await relayTicketSession(invalid);
        assert.equal(Object.hasOwn(JSON.parse(capture.options.body), 'instanceId'), false, `invalid instanceId ${JSON.stringify(invalid)} must be omitted`);
        await relay.stopSession();
      }
    }

    {
      console.log('an absent instanceId is omitted from the publisher ticket body');
      const { relay, capture } = await relayTicketSession();
      assert.equal(Object.hasOwn(JSON.parse(capture.options.body), 'instanceId'), false);
      await relay.stopSession();
    }

    console.log('Remote relay MCP frame tests passed.');
    return null;
  } catch (error) {
    return error;
  }
})();

if (failure) {
  console.error(failure);
  process.exit(1);
}
process.exit(0);
