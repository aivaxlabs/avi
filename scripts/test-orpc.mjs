import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ORPC_LIMITS,
  ORPC_PROTOCOL,
  OrpcError,
  OrpcPeer,
  OrpcStreamParser,
  parseFrame,
  requestFrame,
  responseFrames,
  utf8Text,
} from '../src/shared/orpc.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ascii = (text) => encoder.encode(text);
const sameBytes = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const assemble = (header, body = new Uint8Array(0)) => {
  const head = encoder.encode(`${header}\n`);
  const prefix = ascii(`${head.length + body.length} `);
  const wire = new Uint8Array(prefix.length + head.length + body.length);
  wire.set(prefix);
  wire.set(head, prefix.length);
  wire.set(body, prefix.length + head.length);
  return wire;
};
const reqHeader = (id, method) => `ORPC/1 REQ${id} ${method}`;
const resHeader = (id, execution, part, final) => `ORPC/1 RES${id} ${execution} ${part} ${final}`;
const frame = (header, bodyText = '') => assemble(header, ascii(bodyText));
const malformed = (error) => error instanceof OrpcError && error.code === 'PROTOCOL' && /Malformed or unsupported ORPC frame/.test(error.message);
const limitError = (error) => error instanceof OrpcError && error.code === 'LIMIT';
const requiresBytes = (error) => error instanceof OrpcError && error.message === 'ORPC requires binary bytes';

function recordPeer(limits = {}, overrides = {}) {
  const sent = [];
  const errors = [];
  const peer = new OrpcPeer({
    send: (wire) => { sent.push(wire); return Promise.resolve(); },
    isOpen: () => true,
    onError: (error) => errors.push(error),
    limits,
    ...overrides,
  });
  return { peer, sent, errors };
}

function respondTo(peer, requestWire, content, execution = 'exec', limit = 256 * 1024) {
  const { id } = parseFrame(requestWire);
  for (const part of responseFrames(id, execution, content, limit)) peer.receive(part);
}

function linkedPair(aLimits = {}, bLimits = {}, aHandler = () => new Uint8Array(0), bHandler = () => new Uint8Array(0)) {
  const errorsA = [];
  const errorsB = [];
  const A = new OrpcPeer({
    isOpen: () => true,
    onRequest: aHandler,
    onError: (error) => errorsA.push(error),
    send: (wire) => { setImmediate(() => B.receive(wire)); return Promise.resolve(); },
    limits: aLimits,
  });
  const B = new OrpcPeer({
    isOpen: () => true,
    onRequest: bHandler,
    onError: (error) => errorsB.push(error),
    send: (wire) => { setImmediate(() => A.receive(wire)); return Promise.resolve(); },
    limits: bLimits,
  });
  return { A, B, errorsA, errorsB };
}

test('protocol constants', () => {
  assert.equal(ORPC_PROTOCOL, 'avi-orpc-draft1');
  assert.ok(Object.isFrozen(ORPC_LIMITS));
  assert.equal(ORPC_LIMITS.framesPerSecond, 64);
  assert.equal(ORPC_LIMITS.bytesPerSecond, 1024 * 1024);
  assert.equal(ORPC_LIMITS.targetFrameBytes, 64 * 1024);
});

test('utf8Text stays an application helper with strict UTF-8 semantics', () => {
  assert.equal(utf8Text('plain'), 'plain');
  assert.equal(utf8Text(encoder.encode('héllo a')), 'héllo a');
  assert.equal(utf8Text(new Uint8Array([0xef, 0xbb, 0xbf])), '\uFEFF');
  assert.throws(() => utf8Text(new Uint8Array([0xff, 0xfe])), (error) => error instanceof OrpcError && error.message === 'Invalid UTF-8');
  assert.throws(() => utf8Text(new Uint8Array([0xc3])), (error) => error.message === 'Invalid UTF-8');
  assert.throws(() => utf8Text(42), (error) => error instanceof OrpcError && error.message === 'Invalid UTF-8');
  assert.throws(() => utf8Text('lone \uD800 surrogate'), (error) => /Ill-formed native string/.test(error.message));
});

test('parseFrame decodes binary REQ and RES frames with opaque byte content', () => {
  const body = new Uint8Array([0x00, 0xff, 0xfe, 0xc3, 0x28, 0x0a, 0x20]);
  const request = parseFrame(assemble(reqHeader('id_1', 'method.name'), body));
  assert.equal(request.type, 'REQ');
  assert.equal(request.id, 'id_1');
  assert.equal(request.method, 'method.name');
  assert.ok(sameBytes(request.content, body));
  const response = parseFrame(assemble(resHeader('id_1', 'exec_1', 3, 1), body));
  assert.equal(response.type, 'RES');
  assert.equal(response.execution, 'exec_1');
  assert.equal(response.part, 3);
  assert.equal(response.final, true);
  assert.ok(sameBytes(response.content, body));
  assert.equal(parseFrame(frame(reqHeader('id_1', 'm'))).content.length, 0);
  assert.ok(sameBytes(parseFrame(frame(reqHeader('id_1', 'm'), 'line1\nline2')).content, ascii('line1\nline2')));
});

test('parseFrame rejects non-byte inputs and accepts ArrayBuffer', () => {
  assert.throws(() => parseFrame('17 ORPC/1 REQi m\nx'), requiresBytes);
  assert.throws(() => parseFrame(17), requiresBytes);
  const wire = requestFrame('id_1', 'm', ascii('buffer content'));
  const parsed = parseFrame(wire.buffer);
  assert.ok(sameBytes(parsed.content, ascii('buffer content')));
});

test('parseFrame enforces the byte-length prefix contract', () => {
  const payloadText = `${reqHeader('id_1', 'm')}\ncontent`;
  const bytes = ascii(payloadText).length;
  assert.throws(() => parseFrame(ascii(`0 ${payloadText}`)), (error) => /Invalid frame length/.test(error.message));
  assert.throws(() => parseFrame(ascii(`0${bytes} ${payloadText}`)), (error) => /Invalid frame length/.test(error.message));
  assert.throws(() => parseFrame(ascii(`1x ${payloadText}`)), (error) => /Invalid frame length/.test(error.message));
  assert.throws(() => parseFrame(ascii('123')), (error) => error.message === 'Frame length mismatch');
  assert.throws(() => parseFrame(ascii(`${bytes + 1} ${payloadText}`)), (error) => error.message === 'Frame length mismatch');
  assert.throws(() => parseFrame(ascii(`${bytes - 1} ${payloadText}`)), (error) => error.message === 'Frame length mismatch');
  const padded = new Uint8Array(ascii(`${bytes} ${payloadText}`).length + 1);
  padded.set(ascii(`${bytes} ${payloadText}`));
  padded[padded.length - 1] = 33;
  assert.throws(() => parseFrame(padded), (error) => error.message === 'Frame length mismatch');
  const unicodePayload = `${reqHeader('u1', 'm')}\né`;
  assert.throws(() => parseFrame(ascii(`${ascii(unicodePayload).length - 1} ${unicodePayload}`)), (error) => error.message === 'Frame length mismatch');
  assert.ok(sameBytes(parseFrame(ascii(`${ascii(unicodePayload).length} ${unicodePayload}`)).content, ascii('é')));
});

test('parseFrame bounds and overflows the length prefix before allocating', () => {
  const payloadText = `${reqHeader('id_1', 'm')}\ncontent`;
  assert.throws(() => parseFrame(ascii(`99999999 ${payloadText}`)), (error) => limitError(error) && /Frame size limit/.test(error.message));
  assert.throws(() => parseFrame(ascii(`10000000000000000 ${payloadText}`), 2 ** 60), (error) => /Invalid frame length/.test(error.message));
  assert.throws(() => parseFrame(ascii(`9999999999999999 ${payloadText}`), 2 ** 60), (error) => /Overflowing frame length/.test(error.message));
});

test('parseFrame bounds the header separator and requires ASCII headers', () => {
  const headless = ascii(`${ascii('ORPC/1 REQid_1 m').length} ORPC/1 REQid_1 m`);
  assert.throws(() => parseFrame(headless), (error) => /Invalid ORPC header separator or size/.test(error.message));
  assert.throws(() => parseFrame(frame('X'.repeat(257), 'body')), (error) => /Invalid ORPC header separator or size/.test(error.message));
  assert.throws(() => parseFrame(frame('X'.repeat(256), 'body')), malformed);
  assert.throws(() => parseFrame(assemble(reqHeader('id_1', 'méthod'), ascii('x'))), (error) => error.message === 'Non-ASCII header');
  const wire = new Uint8Array(17);
  wire.set(ascii('14 '));
  wire.set(ascii('ORPC/1 REQi '), 3);
  wire[15] = 0xc3;
  wire[16] = 0x0a;
  assert.throws(() => parseFrame(wire), (error) => error.message === 'Non-ASCII header');
});

test('parseFrame accepts invalid UTF-8 bytes inside the body', () => {
  const body = new Uint8Array([0xff, 0xfe, 0x81, 0xc3, 0x28, 0xed, 0xa0, 0x80]);
  const parsed = parseFrame(assemble(reqHeader('i', 'm'), body));
  assert.ok(sameBytes(parsed.content, body));
});

test('parseFrame validates header tokens strictly', () => {
  const id64 = 'a'.repeat(64);
  assert.equal(parseFrame(frame(reqHeader(id64, 'm'))).id, id64);
  assert.throws(() => parseFrame(frame(reqHeader('a'.repeat(65), 'm'))), malformed);
  assert.throws(() => parseFrame(frame(reqHeader('id.dot', 'm'))), malformed);
  const method128 = 'm'.repeat(128);
  assert.equal(parseFrame(frame(reqHeader('i', method128))).method, method128);
  assert.throws(() => parseFrame(frame(reqHeader('i', 'm'.repeat(129)))), malformed);
  assert.throws(() => parseFrame(frame(reqHeader('i', 'spa ce'))), malformed);
  assert.throws(() => parseFrame(frame(reqHeader('i', 'sl/ash'))), malformed);
  assert.throws(() => parseFrame(frame(`${reqHeader('i', 'm')} extra`)), malformed);
  assert.throws(() => parseFrame(frame('ORPC/1 REQ')), malformed);
  const exec64 = 'E'.repeat(64);
  assert.equal(parseFrame(frame(resHeader('i', exec64, 1, 0))).execution, exec64);
  assert.throws(() => parseFrame(frame(resHeader('i', 'E'.repeat(65), 1, 0))), malformed);
  assert.throws(() => parseFrame(frame(resHeader('id.dot', 'e', 1, 0))), malformed);
  assert.throws(() => parseFrame(frame(resHeader('i', 'e', 0, 0))), malformed);
  assert.throws(() => parseFrame(frame(resHeader('i', 'e', '9999999999999999', 0))), malformed);
  assert.throws(() => parseFrame(frame(resHeader('i', 'e', '10000000000000000', 0))), malformed);
  assert.throws(() => parseFrame(frame(resHeader('i', 'e', 1, 2))), malformed);
  assert.throws(() => parseFrame(frame(resHeader('i', 'e', 1))), malformed);
});

test('parseFrame rejects unknown protocol versions', () => {
  assert.throws(() => parseFrame(frame('ORPC/2 REQi m')), malformed);
  assert.throws(() => parseFrame(frame('orpc/1 REQi m')), malformed);
  assert.throws(() => parseFrame(frame('ORPC/1 PINGi')), malformed);
});

test('parseFrame enforces frame size limits including the 1MiB default boundary', () => {
  const head = encoder.encode(`${reqHeader('borderline', 'm')}\n`);
  const buildExact = (length) => {
    const prefix = ascii(`${head.length + length} `);
    const wire = new Uint8Array(prefix.length + head.length + length);
    wire.set(prefix);
    wire.set(head, prefix.length);
    wire.fill(120, prefix.length + head.length);
    return wire;
  };
  let length = ORPC_LIMITS.frameBytes - head.length - 8;
  for (let i = 0; i < 8; i++) {
    const overflow = buildExact(length).length - ORPC_LIMITS.frameBytes;
    if (overflow === 0) break;
    length -= overflow;
  }
  assert.equal(buildExact(length).length, ORPC_LIMITS.frameBytes);
  const parsed = parseFrame(buildExact(length));
  assert.equal(parsed.type, 'REQ');
  assert.equal(parsed.content.length, length);
  assert.throws(() => parseFrame(buildExact(length + 1)), (error) => limitError(error) && /Frame size limit/.test(error.message));
  const oversized = assemble(reqHeader('id_1', 'm'), new Uint8Array(300).fill(120));
  assert.equal(parseFrame(oversized).content.length, 300);
  assert.throws(() => parseFrame(oversized, 128), (error) => limitError(error) && /Frame size limit/.test(error.message));
});

test('requestFrame round-trips binary content through parseFrame', () => {
  const wire = requestFrame('id_1', 'compute', ascii('argument'));
  assert.ok(wire instanceof Uint8Array);
  const parsed = parseFrame(wire);
  assert.equal(parsed.type, 'REQ');
  assert.equal(parsed.id, 'id_1');
  assert.equal(parsed.method, 'compute');
  assert.ok(sameBytes(parsed.content, ascii('argument')));
  assert.equal(parseFrame(requestFrame('e1', 'noop', new Uint8Array(0))).content.length, 0);
  const allBytes = new Uint8Array(256).map((_, index) => index);
  assert.ok(sameBytes(parseFrame(requestFrame('b1', 'bin', allBytes)).content, allBytes));
  const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xc3]);
  assert.ok(sameBytes(parseFrame(requestFrame('b2', 'bin', invalidUtf8)).content, invalidUtf8));
  const fromBuffer = requestFrame('b3', 'bin', ascii('array buffer').buffer);
  assert.ok(sameBytes(parseFrame(fromBuffer).content, ascii('array buffer')));
  assert.throws(() => requestFrame('bad.id', 'm', ascii('x')), malformed);
  assert.throws(() => requestFrame('i', 'bad method', ascii('x')), malformed);
  assert.throws(() => requestFrame('i', 'm', 'text content'), requiresBytes);
  assert.throws(() => requestFrame('i', 'm', ascii('x'.repeat(200)), 64), limitError);
});

test('responseFrames segments raw bytes and may cut multi-byte code points', () => {
  const content = ascii('éa中文'.repeat(10));
  const wires = [...responseFrames('id_1', 'exec_1', content, 64)];
  assert.ok(wires.length >= 3, `expected segmentation, got ${wires.length}`);
  const rebuilt = new Uint8Array(content.length);
  let offset = 0;
  let expectedPart = 1;
  for (const wire of wires) {
    const parsed = parseFrame(wire);
    assert.equal(parsed.id, 'id_1');
    assert.equal(parsed.execution, 'exec_1');
    assert.equal(parsed.part, expectedPart++);
    assert.equal(parsed.final, parsed.part === wires.length);
    rebuilt.set(parsed.content, offset);
    offset += parsed.content.length;
  }
  assert.equal(offset, content.length);
  assert.ok(sameBytes(rebuilt, content));
  assert.equal(decoder.decode(rebuilt), 'éa中文'.repeat(10));
});

test('responseFrames emits a single final frame for empty content and rejects impossible limits', () => {
  const [only] = [...responseFrames('i', 'e', new Uint8Array(0), 256 * 1024)];
  const parsed = parseFrame(only);
  assert.equal(parsed.type, 'RES');
  assert.equal(parsed.part, 1);
  assert.equal(parsed.final, true);
  assert.equal(parsed.content.length, 0);
  assert.throws(() => [...responseFrames('i', 'e', ascii('hello'), 20)], (error) => limitError(error) && /no content capacity/.test(error.message));
  assert.throws(() => [...responseFrames('i', 'e', 'text', 20)], requiresBytes);
});

test('OrpcStreamParser assembles frames split at every byte boundary', () => {
  const wireA = requestFrame('id_1', 'm', ascii('hello world'));
  const wireB = requestFrame('id_2', 'n', ascii('second frame'));
  const combined = new Uint8Array(wireA.length + wireB.length);
  combined.set(wireA);
  combined.set(wireB, wireA.length);
  for (let split = 0; split <= combined.length; split++) {
    const parser = new OrpcStreamParser();
    const frames = [...parser.push(combined.subarray(0, split)), ...parser.push(combined.subarray(split))];
    parser.end();
    assert.equal(frames.length, 2);
    assert.ok(sameBytes(frames[0].content, ascii('hello world')));
    assert.equal(frames[0].id, 'id_1');
    assert.ok(sameBytes(frames[1].content, ascii('second frame')));
    assert.equal(frames[1].id, 'id_2');
  }
});

test('OrpcStreamParser reassembles multi-byte bodies delivered byte by byte', () => {
  const wire = requestFrame('id_1', 'unicode', ascii('éa中文 café — ✅'));
  const parser = new OrpcStreamParser();
  let frames = [];
  for (let index = 0; index < wire.length; index++) {
    frames = frames.concat(parser.push(wire.subarray(index, index + 1)));
  }
  parser.end();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].method, 'unicode');
  assert.equal(decoder.decode(frames[0].content), 'éa中文 café — ✅');
  const coalesced = new OrpcStreamParser().push(wire);
  assert.equal(coalesced.length, 1);
  assert.ok(sameBytes(coalesced[0].content, frames[0].content));
});

test('OrpcStreamParser fails irreversibly on malformed input and incomplete EOF', () => {
  {
    const parser = new OrpcStreamParser();
    assert.deepEqual(parser.push(new Uint8Array(0)), []);
    assert.throws(() => parser.push(ascii(' ')), (error) => /Missing frame length/.test(error.message));
    assert.throws(() => parser.push(ascii('1 ')), (error) => /Stream parser has failed/.test(error.message));
    assert.throws(() => parser.end(), (error) => /Stream parser has failed/.test(error.message));
  }
  {
    const parser = new OrpcStreamParser();
    assert.throws(() => parser.push(ascii('0 ')), (error) => /Invalid frame length/.test(error.message));
    assert.throws(() => parser.end(), (error) => /Stream parser has failed/.test(error.message));
  }
  {
    const parser = new OrpcStreamParser();
    parser.push(ascii('10 ORPC/1 RE'));
    assert.throws(() => parser.end(), (error) => error.code === 'INCOMPLETE' && /Incomplete frame at EOF/.test(error.message));
    assert.throws(() => parser.push(ascii('more')), (error) => /Stream parser has failed/.test(error.message));
  }
  {
    const parser = new OrpcStreamParser();
    assert.throws(() => parser.push(ascii('1 x')), (error) => /Invalid ORPC header separator or size/.test(error.message));
    assert.throws(() => parser.end(), (error) => /Stream parser has failed/.test(error.message));
  }
});

test('OrpcStreamParser bounds the length prefix before allocating payload', () => {
  const parser = new OrpcStreamParser();
  assert.throws(() => parser.push(ascii('99999999999')), (error) => limitError(error) && /Frame size limit/.test(error.message));
  assert.throws(() => parser.end(), (error) => /Stream parser has failed/.test(error.message));
  const overflow = new OrpcStreamParser(2 ** 60);
  assert.throws(() => overflow.push(ascii('9999999999999999 0')), (error) => /Overflowing frame length/.test(error.message));
});

test('OrpcPeer validates limits and call arguments', async () => {
  for (const [limits, name] of [[{ concurrent: 0 }, 'concurrent'], [{ frameBytes: -1 }, 'frameBytes'], [{ parts: 1.5 }, 'parts'], [{ framesPerSecond: 0 }, 'framesPerSecond'], [{ retries: 0 }, 'retries']]) {
    assert.throws(() => new OrpcPeer({ send: () => {}, isOpen: () => true, limits }), (error) => limitError(error) && error.message.includes(`Invalid ORPC limit: ${name}`));
  }
  const { peer } = recordPeer({ frameBytes: 64 });
  await assert.rejects(peer.call('m', new Uint8Array(200).fill(120)), (error) => limitError(error) && /Frame size limit/.test(error.message));
  await assert.rejects(peer.call('m', 'text content'), requiresBytes);
  await assert.rejects(peer.call('bad method', ascii('c')), malformed);
  await assert.rejects(peer.call('méthod', ascii('c')), (error) => error.message === 'Non-ASCII header');
  await assert.rejects(peer.call('m', ascii('c'), { attemptMs: 0 }), (error) => limitError(error) && /Invalid deadline/.test(error.message));
  await assert.rejects(peer.call('m', ascii('c'), { overallMs: Number.NaN }), (error) => limitError(error) && /Invalid deadline/.test(error.message));
});

test('OrpcPeer completes single and multi-part calls with byte payloads over a linked pair', async () => {
  const echo = (method, content) => ascii(`ok:${method}:${utf8Text(content)}`);
  const { A, B } = linkedPair({}, { targetFrameBytes: 256 }, () => new Uint8Array(0), echo);
  assert.ok(sameBytes(await A.call('echo', ascii('world')), ascii('ok:echo:world')));
  const long = ascii('y'.repeat(400));
  assert.ok(sameBytes(await A.call('big', long), ascii(`ok:big:${'y'.repeat(400)}`)));
  const empty = await A.call('void', new Uint8Array(0));
  assert.ok(empty instanceof Uint8Array);
  assert.ok(sameBytes(empty, ascii('ok:void:')));
});

test('OrpcPeer reorders response parts and accepts the final part first', async () => {
  const { peer, sent } = recordPeer({ attemptMs: 2000 });
  const expected = new Uint8Array(150);
  expected.fill(65, 0, 50);
  expected.fill(66, 50, 100);
  expected.fill(67, 100, 150);
  const done = peer.call('m', ascii('c'));
  await sleep(10);
  const parts = [...responseFrames(parseFrame(sent[0]).id, 'exec_1', expected, 128)];
  assert.equal(parts.length, 3);
  peer.receive(parts[2]);
  peer.receive(parts[1]);
  peer.receive(parts[0]);
  assert.ok(sameBytes(await done, expected));
});

test('OrpcPeer rejects a final part declared below an already received part', async () => {
  const { peer, sent } = recordPeer({ attemptMs: 2000 });
  const done = peer.call('m', ascii('c'));
  await sleep(10);
  const id = parseFrame(sent[0]).id;
  peer.receive(frame(resHeader(id, 'exec_1', 2, 0), 'two'));
  peer.receive(frame(resHeader(id, 'exec_1', 1, 1), 'one'));
  await assert.rejects(done, (error) => /Conflicting final response position/.test(error.message));
});

test('OrpcPeer rejects parts arriving beyond a declared final position', async () => {
  const { peer, sent } = recordPeer({ attemptMs: 2000 });
  const done = peer.call('m', ascii('c'));
  await sleep(10);
  const id = parseFrame(sent[0]).id;
  peer.receive(frame(resHeader(id, 'exec_1', 2, 1), 'two'));
  peer.receive(frame(resHeader(id, 'exec_1', 3, 0), 'three'));
  await assert.rejects(done, (error) => /Conflicting final response position/.test(error.message));
});

test('OrpcPeer tolerates identical duplicate parts and rejects conflicting ones', async () => {
  {
    const { peer, sent, errors } = recordPeer({ attemptMs: 2000 });
    const done = peer.call('m', ascii('c'));
    await sleep(10);
    const id = parseFrame(sent[0]).id;
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'one'));
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'one'));
    peer.receive(frame(resHeader(id, 'exec_1', 2, 1), 'two'));
    assert.ok(sameBytes(await done, ascii('onetwo')));
    assert.deepEqual(errors, []);
  }
  {
    const { peer, sent } = recordPeer({ attemptMs: 2000 });
    const done = peer.call('m', ascii('c'));
    await sleep(10);
    const id = parseFrame(sent[0]).id;
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'one'));
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'ONE'));
    await assert.rejects(done, (error) => /Conflicting duplicate response part/.test(error.message));
  }
  {
    const { peer, sent } = recordPeer({ attemptMs: 2000 });
    const done = peer.call('m', ascii('c'));
    await sleep(10);
    const id = parseFrame(sent[0]).id;
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'one'));
    peer.receive(frame(resHeader(id, 'exec_1', 1, 1), 'one'));
    await assert.rejects(done, (error) => /Conflicting duplicate response part/.test(error.message));
  }
  {
    const { peer, sent } = recordPeer({ attemptMs: 2000 });
    const done = peer.call('m', ascii('c'));
    await sleep(10);
    const id = parseFrame(sent[0]).id;
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'one'));
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'much longer body'));
    await assert.rejects(done, (error) => /Conflicting duplicate response part/.test(error.message));
  }
});

test('OrpcPeer pins the first execution token and discards frames from other executions', async () => {
  const { peer, sent, errors } = recordPeer({ attemptMs: 2000 });
  const done = peer.call('m', ascii('c'));
  await sleep(10);
  const id = parseFrame(sent[0]).id;
  peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'one'));
  peer.receive(frame(resHeader(id, 'exec_2', 2, 1), 'two-from-exec_2'));
  await sleep(20);
  assert.deepEqual(errors, []);
  peer.receive(frame(resHeader(id, 'exec_1', 2, 1), 'two'));
  assert.ok(sameBytes(await done, ascii('onetwo')));
});

test('OrpcPeer silently ignores responses for unknown or completed calls', async () => {
  const { peer, sent, errors } = recordPeer({ attemptMs: 2000 });
  peer.receive(frame(resHeader('ghost', 'e', 1, 1), 'x'));
  const done = peer.call('m', ascii('c'));
  await sleep(10);
  const id = parseFrame(sent[0]).id;
  respondTo(peer, sent[0], ascii('answer'));
  assert.ok(sameBytes(await done, ascii('answer')));
  peer.receive(frame(resHeader(id, 'e', 1, 1), 'answer'));
  peer.receive(frame(resHeader('ghost-2', 'e', 1, 1), 'x'));
  await sleep(10);
  assert.deepEqual(errors, []);
});

test('OrpcPeer reassembles interleaved parts of concurrent calls independently', async () => {
  const { peer, sent } = recordPeer({ attemptMs: 3000 });
  const contentA = ascii('A'.repeat(300));
  const contentB = ascii('B'.repeat(300));
  const doneA = peer.call('m', ascii('a'));
  const doneB = peer.call('m', ascii('b'));
  await sleep(20);
  const partsA = [...responseFrames(parseFrame(sent[0]).id, 'exec_a', contentA, 256)];
  const partsB = [...responseFrames(parseFrame(sent[1]).id, 'exec_b', contentB, 256)];
  assert.equal(partsA.length, 2);
  assert.equal(partsB.length, 2);
  peer.receive(partsA[0]);
  peer.receive(partsB[0]);
  peer.receive(partsA[1]);
  peer.receive(partsB[1]);
  assert.ok(sameBytes(await doneA, contentA));
  assert.ok(sameBytes(await doneB, contentB));
});

test('OrpcPeer retries an unanswered attempt with a fresh id and immutable payload', async () => {
  const { peer, sent } = recordPeer({ retries: 1, backoffMs: 5, attemptMs: 70 });
  const payload = ascii('same-payload');
  const done = peer.call('compute', payload, { overallMs: 2000 });
  await sleep(30);
  payload.set(ascii('MUTATED-12CH'));
  await sleep(90);
  assert.equal(sent.length, 2);
  const first = parseFrame(sent[0]);
  const second = parseFrame(sent[1]);
  assert.equal(first.type, 'REQ');
  assert.notEqual(first.id, second.id);
  assert.equal(first.method, second.method);
  assert.ok(sameBytes(first.content, second.content));
  assert.ok(sameBytes(second.content, ascii('same-payload')));
  respondTo(peer, sent[1], ascii('recovered'), 'exec_2');
  assert.ok(sameBytes(await done, ascii('recovered')));
  assert.equal(peer.pending.size, 0);
});

test('OrpcPeer holds the request while the channel is closed and sends once it reopens', async () => {
  let open = false;
  const { peer, sent } = recordPeer({ retries: 1, backoffMs: 5, attemptMs: 300 }, { isOpen: () => open });
  const done = peer.call('m', ascii('c'), { overallMs: 5000 });
  await sleep(40);
  assert.deepEqual(sent, []);
  open = true;
  await sleep(120);
  assert.equal(sent.length, 1);
  respondTo(peer, sent[0], ascii('after-reopen'));
  assert.ok(sameBytes(await done, ascii('after-reopen')));
});

test('OrpcPeer fails with INCOMPLETE once the overall deadline is exhausted', async () => {
  const { peer } = recordPeer({ retries: 3, attemptMs: 5000 });
  const started = Date.now();
  await assert.rejects(peer.call('m', ascii('c'), { overallMs: 60 }), (error) => error.code === 'INCOMPLETE' && /recovery budget or overall deadline/.test(error.message));
  assert.ok(Date.now() - started < 500);
});

test('OrpcPeer honours cancellation before, during, and while waiting for the channel', async () => {
  {
    const signal = AbortSignal.abort();
    const { peer } = recordPeer({});
    await assert.rejects(peer.call('m', ascii('c'), { signal }), (error) => error.code === 'CANCELLED');
  }
  {
    const controller = new AbortController();
    const { peer, sent } = recordPeer({ attemptMs: 5000 });
    const done = peer.call('m', ascii('c'), { signal: controller.signal });
    await sleep(20);
    assert.equal(sent.length, 1);
    controller.abort();
    await assert.rejects(done, (error) => error.code === 'CANCELLED');
    const followUp = peer.call('m', ascii('c2'), { attemptMs: 4000 });
    await sleep(10);
    respondTo(peer, sent[1], ascii('after-cancel'));
    assert.ok(sameBytes(await followUp, ascii('after-cancel')));
    assert.equal(peer.pending.size, 0);
  }
  {
    let open = false;
    const controller = new AbortController();
    const { peer } = recordPeer({ retries: 1, backoffMs: 5, attemptMs: 400 }, { isOpen: () => open });
    const done = peer.call('m', ascii('c'), { signal: controller.signal, overallMs: 10000 });
    await sleep(30);
    controller.abort();
    await assert.rejects(done, (error) => error.code === 'CANCELLED');
    open = true;
  }
});

test('OrpcPeer bounds response reconstruction by responseBytes and parts limits', async () => {
  {
    const { peer, sent } = recordPeer({ attemptMs: 2000, responseBytes: 10 });
    const done = peer.call('m', ascii('c'));
    await sleep(10);
    const id = parseFrame(sent[0]).id;
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'aaaa'));
    peer.receive(frame(resHeader(id, 'exec_1', 2, 1), 'bbbbbbbb'));
    await assert.rejects(done, (error) => limitError(error) && /resource limit/.test(error.message));
  }
  {
    const { peer, sent } = recordPeer({ attemptMs: 2000, parts: 1 });
    const done = peer.call('m', ascii('c'));
    await sleep(10);
    const id = parseFrame(sent[0]).id;
    peer.receive(frame(resHeader(id, 'exec_1', 1, 0), 'aaaa'));
    peer.receive(frame(resHeader(id, 'exec_1', 2, 1), 'bbbb'));
    await assert.rejects(done, (error) => limitError(error) && /resource limit/.test(error.message));
  }
});

test('OrpcPeer survives send failures and completes later calls', async () => {
  let failSends = true;
  const sent = [];
  const errors = [];
  const peer = new OrpcPeer({
    isOpen: () => true,
    onError: (error) => errors.push(error),
    limits: { retries: 1, attemptMs: 4000 },
    send: async (wire) => {
      if (failSends) throw new Error('socket exploded');
      sent.push(wire);
    },
  });
  await assert.rejects(peer.call('m', ascii('c')), (error) => error.code === 'INCOMPLETE' && /recovery budget or overall deadline/.test(error.message));
  assert.deepEqual(sent, []);
  failSends = false;
  const done = peer.call('m', ascii('c2'), { attemptMs: 4000 });
  await sleep(10);
  respondTo(peer, sent[0], ascii('recovered'));
  assert.ok(sameBytes(await done, ascii('recovered')));
  assert.deepEqual(errors, []);
});

test('OrpcPeer enforces the client-side concurrent request limit', async () => {
  const { peer } = recordPeer({ concurrent: 1, attemptMs: 3000 });
  const first = peer.call('m', ascii('first'));
  await sleep(10);
  await assert.rejects(peer.call('m', ascii('second')), (error) => limitError(error) && /Concurrent request limit/.test(error.message));
  peer.terminate();
  await assert.rejects(first, (error) => error.code === 'CANCELLED');
  assert.equal(peer.pending.size, 0);
});

test('OrpcPeer terminates the channel when server concurrency is exceeded', async () => {
  let releaseSlow;
  const { peer, errors } = recordPeer({ concurrent: 1 }, {
    onRequest: (method) => new Promise((resolve) => {
      if (method === 'slow') releaseSlow = resolve;
      else resolve(ascii('fast'));
    }),
  });
  peer.receive(frame(reqHeader('req_1', 'slow'), 'a'));
  await sleep(10);
  peer.receive(frame(reqHeader('req_2', 'quick'), 'b'));
  await sleep(10);
  assert.equal(peer.closed, true);
  assert.ok(errors.some((error) => limitError(error) && /Concurrent server execution limit/.test(error.message)));
  releaseSlow(ascii('done'));
  await sleep(10);
});

test('OrpcPeer terminates on malformed inbound frames and ignores later traffic', async () => {
  const { peer, sent, errors } = recordPeer({ attemptMs: 3000 });
  const done = peer.call('m', ascii('c'));
  await sleep(10);
  peer.receive(ascii('nonsense'));
  await assert.rejects(done, (error) => error instanceof OrpcError && error.message === 'Invalid frame length');
  peer.receive(ascii('more nonsense'));
  peer.receive(frame(resHeader(parseFrame(sent[0]).id, 'e', 1, 1), 'late'));
  await sleep(10);
  assert.equal(peer.closed, true);
  assert.equal(errors.length, 1);
  await assert.rejects(peer.call('m', ascii('c')), (error) => error.code === 'CANCELLED');
});

test('OrpcPeer terminates on non-ASCII headers and accepts invalid UTF-8 bodies', async () => {
  {
    const { peer, sent, errors } = recordPeer({ attemptMs: 3000 });
    const done = peer.call('m', ascii('c'));
    await sleep(10);
    const id = parseFrame(sent[0]).id;
    peer.receive(assemble(resHeader(id, 'éxec', 1, 1), ascii('body')));
    await assert.rejects(done, (error) => error.message === 'Non-ASCII header');
    assert.equal(errors.length, 1);
  }
  {
    const { A, B } = linkedPair({}, {}, () => new Uint8Array(0), () => new Uint8Array([0xff, 0xfe, 0x81, 0xc3, 0x28]));
    const result = await A.call('raw', ascii('ignored'));
    assert.ok(sameBytes(result, [0xff, 0xfe, 0x81, 0xc3, 0x28]));
  }
  {
    const nulled = linkedPair({}, {}, () => new Uint8Array(0), () => null);
    const empty = await nulled.A.call('void', ascii('x'));
    assert.equal(empty.length, 0);
  }
});

test('OrpcPeer keeps handler failures opaque to callers and reports them via onError', async () => {
  const failing = linkedPair({ retries: 1, attemptMs: 100 }, {}, null,
    () => { throw new Error('secret-sauce-detail'); });
  await assert.rejects(failing.A.call('probe', ascii('x'), { overallMs: 1000 }), (error) => {
    assert.ok(!error.message.includes('secret'));
    return error.code === 'INCOMPLETE';
  });
  assert.ok(failing.errorsB.some((error) => error.message === 'secret-sauce-detail'));
  const textual = linkedPair({ retries: 1, attemptMs: 100 }, {}, null, () => 'text response');
  await assert.rejects(textual.A.call('probe', ascii('x'), { overallMs: 1000 }), (error) => error.code === 'INCOMPLETE');
  assert.ok(textual.errorsB.some(requiresBytes));
});

test('OrpcPeer drains fairly across concurrent responses when backpressure releases', async () => {
  let blocked = true;
  const sentA = [];
  const sentB = [];
  const B = new OrpcPeer({
    isOpen: () => true,
    bufferedAmount: () => (blocked ? 1e9 : 0),
    limits: { bufferedBytes: 1024, targetFrameBytes: 256 },
    onRequest: async (method, content) => ascii(`r:${utf8Text(content)}`),
    onError: () => {},
    send: (wire) => { sentB.push(wire); setImmediate(() => A.receive(wire)); return Promise.resolve(); },
  });
  const A = new OrpcPeer({
    isOpen: () => true,
    onError: () => {},
    send: (wire) => { sentA.push(wire); setImmediate(() => B.receive(wire)); return Promise.resolve(); },
  });
  const contentA = ascii('a'.repeat(300));
  const contentB = ascii('b'.repeat(300));
  const ra = A.call('m', contentA, { attemptMs: 5000, overallMs: 8000 });
  const rb = A.call('m', contentB, { attemptMs: 5000, overallMs: 8000 });
  await sleep(80);
  blocked = false;
  assert.ok(sameBytes(await ra, ascii(`r:${'a'.repeat(300)}`)));
  assert.ok(sameBytes(await rb, ascii(`r:${'b'.repeat(300)}`)));
  const idA = parseFrame(sentA[0]).id;
  const idB = parseFrame(sentA[1]).id;
  const sequence = sentB
    .map((wire) => parseFrame(wire))
    .filter((parsed) => parsed.type === 'RES')
    .map((parsed) => `${parsed.id === idA ? 'A' : parsed.id === idB ? 'B' : '?'}${parsed.part}`);
  assert.deepEqual(sequence, ['A1', 'B1', 'A2', 'B2']);
});

test('OrpcPeer rejects enqueues beyond the outgoing queue bound', async () => {
  let blocked = true;
  const { peer, sent } = recordPeer({ concurrent: 8 }, { bufferedAmount: () => (blocked ? 1e9 : 0) });
  const attempts = [];
  for (let i = 0; i < 20; i++) {
    attempts.push(peer.enqueue([ascii(`frame-${i}`)][Symbol.iterator](), 10, null).then(() => 'ok', (error) => error));
  }
  blocked = false;
  const results = await Promise.all(attempts);
  const failures = results.filter((result) => result !== 'ok');
  assert.equal(failures.length, 4);
  for (const failure of failures) {
    assert.ok(limitError(failure) && /Outgoing queue limit/.test(failure.message));
  }
  assert.equal(sent.length, 16);
});

test('OrpcPeer rejects enqueues beyond the queued byte budget', async () => {
  const { peer } = recordPeer({ queueBytes: 150 });
  const results = await Promise.allSettled([
    peer.enqueue([ascii('a')][Symbol.iterator](), 100, null),
    peer.enqueue([ascii('b')][Symbol.iterator](), 100, null),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.ok(limitError(results[1].reason) && /Outgoing queue limit/.test(results[1].reason.message));
});

test('OrpcPeer throttles outgoing frames by the frames-per-second budget', async () => {
  const { peer, sent } = recordPeer({ framesPerSecond: 1 });
  const wires = [...responseFrames('i', 'e', ascii('x'.repeat(300)), 256)];
  assert.equal(wires.length, 2);
  const drained = peer.enqueue(wires[Symbol.iterator](), 300, null);
  await sleep(200);
  assert.equal(sent.length, 1);
  await drained;
  assert.equal(sent.length, 2);
});

test('OrpcPeer throttles outgoing frames by the bytes-per-second budget', async () => {
  const { peer, sent } = recordPeer({ bytesPerSecond: 1 });
  const wires = [...responseFrames('i', 'e', ascii('x'.repeat(400)), 256)];
  assert.equal(wires.length, 2);
  const drained = peer.enqueue(wires[Symbol.iterator](), 400, null);
  await sleep(200);
  assert.equal(sent.length, 1);
  await drained;
  assert.equal(sent.length, 2);
});

test('OrpcPeer serves and calls simultaneously over the same channel', async () => {
  const { A, B } = linkedPair({ attemptMs: 600 }, { attemptMs: 600 },
    (method, content) => ascii(`A-ack:${method}:${utf8Text(content)}`),
    (method, content) => ascii(`B-ack:${method}:${utf8Text(content)}`));
  const [toB, toA] = await Promise.all([
    A.call('greet', ascii('hi'), { overallMs: 3000 }),
    B.call('ping', ascii('yo'), { overallMs: 3000 }),
  ]);
  assert.ok(sameBytes(toB, ascii('B-ack:greet:hi')));
  assert.ok(sameBytes(toA, ascii('A-ack:ping:yo')));
});
