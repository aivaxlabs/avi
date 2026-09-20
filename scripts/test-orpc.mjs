import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORPC_PROTOCOL, OrpcPeer, OrpcStreamParser, parseFrame, requestFrame, requestFrames, responseFrames, controlFrame, utf8Text } from '../src/shared/orpc.js';

const bytes = (text) => new TextEncoder().encode(text);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wire = (header, content = new Uint8Array()) => {
  const head = bytes(`${header}\n`);
  return new Uint8Array([...bytes(`${head.length + content.length} `), ...head, ...content]);
};
async function until(condition) {
  const end = Date.now() + 4000;
  while (!condition()) {
    assert.ok(Date.now() < end, 'Condition deadline expired');
    await pause(5);
  }
}
function recorder(options = {}) {
  const sent = [], errors = [];
  const peer = new OrpcPeer({ integrity: false, isOpen: () => true, send: (frame) => sent.push(parseFrame(frame)), onError: (error) => errors.push(error), limits: { attemptMs: 1000, overallMs: 3000, retries: 0 }, ...options });
  return { peer, sent, errors };
}
function pair() {
  const sentA = [], sentB = [], errors = [];
  let A, B;
  const common = { isOpen: () => true, onError: (error) => errors.push(error), limits: { attemptMs: 2000, overallMs: 5000, backoffMs: 1, targetFrameBytes: 256 }, onRequest: (method, content) => content };
  A = new OrpcPeer({ ...common, send: (frame) => { sentA.push(parseFrame(frame)); B.receive(frame); } });
  B = new OrpcPeer({ ...common, send: (frame) => { sentB.push(parseFrame(frame)); A.receive(frame); } });
  return { A, B, sentA, sentB, errors };
}

test('Draft 2 framing, opaque bytes, IDs and strict UTF-8 helper', () => {
  assert.equal(ORPC_PROTOCOL, 'avi-orpc-draft2');
  const body = new Uint8Array([0, 255, 128, 10, 13]);
  const request = parseFrame(requestFrame('a._@9', 'folder.read', body));
  assert.deepEqual(request.content, body);
  assert.equal(request.part, 1);
  assert.equal(request.final, true);
  assert.equal(request.baseId, 'a._@9');
  assert.equal(request.control, null);
  assert.equal(parseFrame([...responseFrames('a', body)][0]).execution, undefined);
  assert.equal(parseFrame(controlFrame('REQ', 'a#CANCEL')).method, '0');
  assert.equal(parseFrame(controlFrame('RES', '#PONG')).baseId, '');
  assert.throws(() => requestFrame('bad-id', 'm', body));
  assert.throws(() => utf8Text(body));
  assert.throws(() => utf8Text(String.fromCharCode(0xd800)));
  assert.equal(utf8Text(bytes('ação 日本語')), 'ação 日本語');
});

test('rejects malformed lengths, ASCII headers, Draft 1 and control grammar', () => {
  for (const invalid of ['0 ', '01 x', '-1 x', '999999999999999999 x', '1 xx', '9 ORPC/1\nx']) assert.throws(() => parseFrame(bytes(invalid)));
  for (const header of ['ORPC/1 REQa m', 'ORPC/1 RESa execution 1 1', 'ORPC/1 REQa m 0 1', 'ORPC/1 RESa 1 2', 'ORPC/1 RESa 9007199254740992 1', 'ORPC/1 REQa#CANCEL m 1 1', 'ORPC/1 REQ#PING 0 2 1', 'ORPC/1 RESa#CHECKOK 1 0', 'ORPC/1 REQé m 1 1']) assert.throws(() => parseFrame(wire(header)));
  assert.throws(() => parseFrame('text'));
  assert.throws(() => parseFrame(requestFrame('a', 'm', bytes('x')), 4), { code: 'LIMIT' });
});

test('stream parser handles fragments, coalescing, limits and incomplete EOF', () => {
  const frames = [requestFrame('a', 'm', bytes('α')), ...responseFrames('b', new Uint8Array([255]))];
  const parser = new OrpcStreamParser();
  const result = [];
  for (const frame of frames) for (const byte of frame) result.push(...parser.push(new Uint8Array([byte])));
  parser.end();
  assert.equal(result.length, 2);
  assert.deepEqual(result[1].content, new Uint8Array([255]));
  assert.equal(new OrpcStreamParser().push(new Uint8Array([...frames[0], ...frames[1]])).length, 2);
  const partial = new OrpcStreamParser();
  partial.push(frames[0].slice(0, -1));
  assert.throws(() => partial.end(), { code: 'INCOMPLETE' });
  assert.throws(() => partial.push(frames[0]));
  assert.throws(() => new OrpcStreamParser(32).push(bytes('100 ')), { code: 'LIMIT' });
});

test('multipart request and response encoding preserves bytes and frame bounds', () => {
  const body = bytes('ação 日本語'.repeat(50));
  for (const frames of [[...requestFrames('a', 'echo', body, 128)], [...responseFrames('a', body, 128)]]) {
    assert.ok(frames.length > 1);
    const parsed = frames.map((frame) => { assert.ok(frame.length <= 128); return parseFrame(frame); });
    assert.deepEqual(new Uint8Array(parsed.flatMap((frame) => [...frame.content])), body);
    assert.deepEqual(parsed.map((frame) => frame.part), parsed.map((_, index) => index + 1));
    assert.equal(parsed.filter((frame) => frame.final).length, 1);
    assert.equal(parsed.at(-1).final, true);
  }
  assert.equal([...requestFrames('a', 'm', new Uint8Array())].length, 1);
  assert.equal([...responseFrames('a', new Uint8Array())].length, 1);
});

test('out-of-order interleaved requests and identical duplicates', async () => {
  const calls = [];
  const { peer } = recorder({ onRequest: (method, content) => { calls.push(utf8Text(content)); return content; } });
  try {
    peer.receive(wire('ORPC/1 REQa echo 2 1', bytes('B')));
    peer.receive(wire('ORPC/1 REQb echo 1 0', bytes('C')));
    peer.receive(wire('ORPC/1 REQa echo 2 1', bytes('B')));
    assert.equal(calls.length, 0);
    peer.receive(wire('ORPC/1 REQa echo 1 0', bytes('A')));
    peer.receive(wire('ORPC/1 REQb echo 2 1', bytes('D')));
    await until(() => calls.length === 2);
    assert.deepEqual(calls.sort(), ['AB', 'CD']);
  } finally { peer.terminate(); }
});

test('conflicting duplicates and final positions invalidate responses', async () => {
  for (const frames of [[['2 0', 'A'], ['2 0', 'B']], [['3 1', 'A'], ['2 1', 'B']], [['2 1', 'A'], ['3 0', 'B']]]) {
    const { peer, sent } = recorder();
    try {
      const rejected = assert.rejects(peer.call('m', bytes('x')), { code: 'PROTOCOL' });
      await until(() => sent.length);
      for (const [metadata, content] of frames) peer.receive(wire(`ORPC/1 RES${sent[0].id} ${metadata}`, bytes(content)));
      await rejected;
      assert.equal(peer.receivedBytes, 0);
    } finally { peer.terminate(); }
  }
});

test('response order and duplicates are tolerated but missing parts never complete', async () => {
  const { peer, sent } = recorder();
  try {
    const result = peer.call('m', bytes('x'));
    await until(() => sent.length);
    const id = sent[0].id;
    peer.receive(wire(`ORPC/1 RES${id} 2 1`, bytes('B')));
    peer.receive(wire(`ORPC/1 RES${id} 2 1`, bytes('B')));
    assert.equal(peer.pending.size, 1);
    peer.receive(wire(`ORPC/1 RES${id} 1 0`, bytes('A')));
    assert.equal(utf8Text(await result), 'AB');
    const rejected = assert.rejects(peer.call('m', bytes('x'), { attemptMs: 100 }), { code: 'INCOMPLETE' });
    await until(() => sent.filter((frame) => !frame.control).length === 2);
    const nextId = sent.filter((frame) => !frame.control)[1].id;
    peer.receive(wire(`ORPC/1 RES${nextId} 2 1`, bytes('B')));
    await rejected;
  } finally { peer.terminate(); }
});

test('integrity-gated multipart echo and early CHECKOK release all resources', async () => {
  const { A, B, errors, sentA, sentB } = pair();
  try {
    const body = new Uint8Array(2048).map((_, index) => index % 256);
    assert.deepEqual(await A.call('echo', body), body);
    await until(() => A.queuedBytes === 0 && B.queuedBytes === 0 && B.incoming.size === 0);
    assert.deepEqual(errors, []);
    assert.ok(sentA.some((frame) => frame.control === 'CHECKSEND'));
    assert.ok(sentB.some((frame) => frame.control === 'CHECKSEND'));
    assert.equal(A.receivedBytes + B.receivedBytes + A.requestBytes, 0);
  } finally { A.terminate(); B.terminate(); }
});

test('ordinary bidirectional calls coexist', async () => {
  const { A, B } = pair();
  try {
    const [first, second] = await Promise.all([A.call('echo', bytes('one')), B.call('echo', new Uint8Array([255, 0]))]);
    assert.equal(utf8Text(first), 'one');
    assert.deepEqual(second, new Uint8Array([255, 0]));
  } finally { A.terminate(); B.terminate(); }
});

test('invalid or unsupported hashes cannot dispatch application content', async () => {
  for (const hash of [bytes('sha256:bad'), bytes('md5:abc'), new Uint8Array([255])]) {
    let calls = 0;
    const { peer, sent } = recorder({ integrity: true, onRequest: () => { calls++; return new Uint8Array(); } });
    try {
      peer.receive(requestFrame('a', 'm', bytes('body')));
      assert.equal(calls, 0);
      peer.receive(controlFrame('REQ', 'a#CHECKSEND', hash));
      await until(() => sent.some((frame) => frame.control === 'CHECKFAIL') && peer.incoming.size === 0);
      assert.equal(calls, 0);
      assert.equal(peer.closed, false);
      assert.equal(peer.receivedBytes, 0);
    } finally { peer.terminate(); }
  }
});

test('multiple SHA-256 hashes validate only the complete content', async () => {
  let calls = 0;
  const { peer, sent } = recorder({ integrity: true, onRequest: () => { calls++; return new Uint8Array(); } });
  try {
    const body = bytes('abc');
    const hex = Buffer.from(await crypto.subtle.digest('SHA-256', body)).toString('hex');
    peer.receive(requestFrame('a', 'm', body));
    peer.receive(controlFrame('REQ', 'a#CHECKSEND', bytes(`sha256:${hex};sha256:${hex}`)));
    await until(() => calls === 1);
    assert.ok(sent.some((frame) => frame.control === 'CHECKOK'));
  } finally { peer.terminate(); }
});

test('CHECKFAIL, LOCKED and RESEND retry whole content with fresh IDs', async () => {
  for (const control of ['CHECKFAIL', 'LOCKED', 'RESEND']) {
    const { peer, sent } = recorder({ limits: { attemptMs: 1000, overallMs: 4000, retries: 1, backoffMs: 1 } });
    try {
      const result = peer.call('m', bytes('original'));
      await until(() => sent.length);
      const first = sent[0];
      peer.receive(controlFrame('RES', `${first.id}#${control}`));
      await until(() => sent.filter((frame) => !frame.control).length === 2);
      const second = sent.filter((frame) => !frame.control)[1];
      assert.notEqual(first.id, second.id);
      assert.deepEqual(first.content, second.content);
      if (control === 'RESEND') assert.ok(sent.some((frame) => frame.control === 'RESEND' && frame.type === 'RES'));
      peer.receive([...responseFrames(second.id, bytes('ok'))][0]);
      assert.equal(utf8Text(await result), 'ok');
    } finally { peer.terminate(); }
  }
});

test('active ID collisions do not replace processing state', async () => {
  let calls = 0;
  const { peer, sent } = recorder({ onRequest: () => { calls++; return new Promise(() => {}); } });
  try {
    peer.receive(requestFrame('a', 'm', bytes('first')));
    await until(() => calls === 1);
    const transfer = peer.incoming.get('a');
    peer.receive(requestFrame('a', 'm', bytes('second')));
    await until(() => sent.some((frame) => frame.control === 'LOCKED'));
    assert.equal(peer.incoming.get('a'), transfer);
    assert.equal(calls, 1);
  } finally { peer.terminate(); }
});

test('CANCEL aborts the operation, receives CANCELACK and never retries', async () => {
  const { A, B, sentA, sentB } = pair();
  let started = false, aborted = false;
  B.onRequest = (method, content, signal) => new Promise((resolve) => {
    started = true;
    signal.addEventListener('abort', () => { aborted = true; resolve(content); }, { once: true });
  });
  try {
    const controller = new AbortController();
    const rejected = assert.rejects(A.call('m', bytes('body'), { signal: controller.signal }), { code: 'CANCELLED' });
    await until(() => started);
    controller.abort();
    await rejected;
    await until(() => aborted && sentB.some((frame) => frame.control === 'CANCELACK'));
    assert.equal(new Set(sentA.filter((frame) => !frame.control).map((frame) => frame.id)).size, 1);
    assert.equal(B.incoming.size, 0);
  } finally { A.terminate(); B.terminate(); }
});

test('PING/PONG and EXIT/BYE wait for acknowledgment before closing', async () => {
  const { A, B, sentA, sentB } = pair();
  try {
    await A.ping();
    assert.ok(sentA.some((frame) => frame.control === 'PING'));
    assert.ok(sentB.some((frame) => frame.control === 'PONG'));
    await A.shutdown();
    await until(() => B.closed);
    assert.ok(A.closed);
    await assert.rejects(A.call('m', bytes('x')), { code: 'CANCELLED' });
  } finally { A.terminate(); B.terminate(); }
  let closes = 0;
  const { peer } = recorder({ onClose: () => closes++, limits: { attemptMs: 100 } });
  try {
    await assert.rejects(peer.shutdown(), { code: 'INCOMPLETE' });
    assert.equal(closes, 0);
    peer.receive(controlFrame('RES', '#BYE'));
    await until(() => closes === 1);
  } finally { peer.terminate(); }
});

test('channel failure clears data, control waiters and queues', async () => {
  const { peer } = recorder({ bufferedAmount: () => 1e9 });
  try {
    const call = peer.call('m', bytes('body')).catch((error) => error);
    const ping = peer.ping().catch((error) => error);
    await pause(10);
    peer.channelFailed();
    assert.equal((await call).code, 'INCOMPLETE');
    assert.equal((await ping).code, 'INCOMPLETE');
    await until(() => peer.queuedBytes === 0);
    assert.equal(peer.controls.size + peer.pending.size + peer.incoming.size + peer.outgoing.length + peer.receivedBytes + peer.requestBytes, 0);
  } finally { peer.terminate(); }
});

test('request, response, aggregate, part and concurrency bounds', async () => {
  const { peer } = recorder({ limits: { requestBytes: 2, concurrent: 1, retries: 0, attemptMs: 1000 } });
  try {
    await assert.rejects(peer.call('m', bytes('big')), { code: 'LIMIT' });
    const pending = peer.call('m', bytes('ok')).catch((error) => error);
    await assert.rejects(peer.call('m', bytes('ok')), { code: 'LIMIT' });
    peer.terminate();
    await pending;
  } finally { peer.terminate(); }
  for (const limits of [{ responseBytes: 1 }, { aggregateBytes: 1 }, { parts: 1 }]) {
    const { peer: bounded, sent } = recorder({ limits: { ...limits, retries: 0, attemptMs: 1000 } });
    try {
      const rejected = assert.rejects(bounded.call('m', bytes('x')), { code: 'LIMIT' });
      await until(() => sent.length);
      bounded.receive(wire(`ORPC/1 RES${sent[0].id} 2 1`, bytes('xx')));
      await rejected;
      assert.equal(bounded.receivedBytes, 0);
    } finally { bounded.terminate(); }
  }
});

test('queue bounds, rate limiting and stalled backpressure cleanup', async () => {
  const { peer, sent } = recorder({ limits: { queueBytes: 100, framesPerSecond: 1, attemptMs: 3000 } });
  try {
    const frames = [controlFrame('REQ', '#PING'), controlFrame('REQ', '#PING')];
    const drain = peer.enqueue(frames[Symbol.iterator](), 80, null);
    await assert.rejects(peer.enqueue(frames[Symbol.iterator](), 80, null), { code: 'LIMIT' });
    await pause(100);
    assert.equal(sent.length, 1);
    await drain;
    assert.equal(sent.length, 2);
  } finally { peer.terminate(); }
  const blocked = recorder({ bufferedAmount: () => 1e9, limits: { retries: 0, attemptMs: 100, overallMs: 500 } });
  try {
    await assert.rejects(blocked.peer.call('m', bytes('x')), { code: 'INCOMPLETE' });
    await until(() => blocked.peer.queuedBytes === 0);
    assert.equal(blocked.sent.length, 0);
  } finally { blocked.peer.terminate(); }
});

test('malformed input terminates once and application exceptions remain opaque', async () => {
  const { peer, errors } = recorder();
  const rejected = assert.rejects(peer.call('m', bytes('body')), { code: 'PROTOCOL' });
  peer.receive(bytes('bad'));
  peer.receive(bytes('bad'));
  await rejected;
  assert.equal(errors.length, 1);
  const { A, B, errors: failures } = pair();
  B.onRequest = () => { throw new Error('private handler detail'); };
  try {
    await assert.rejects(A.call('m', bytes('body')), (error) => error.code === 'CANCELLED' && !error.message.includes('private'));
    assert.ok(failures.some((error) => error.message === 'private handler detail'));
  } finally { A.terminate(); B.terminate(); }
});
