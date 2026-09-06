export const ORPC_PROTOCOL = 'avi-orpc-draft1';
export const ORPC_LIMITS = Object.freeze({
  frameBytes: 1024 * 1024,
  targetFrameBytes: 64 * 1024,
  responseBytes: 32 * 1024 * 1024,
  aggregateBytes: 64 * 1024 * 1024,
  parts: 8192,
  concurrent: 64,
  queueBytes: 64 * 1024 * 1024,
  bufferedBytes: 256 * 1024,
  bytesPerSecond: 1024 * 1024,
  framesPerSecond: 64,
  attemptMs: 60_000,
  overallMs: 150_000,
  retries: 1,
  backoffMs: 250,
});
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class OrpcError extends Error {
  constructor(message, code = 'PROTOCOL') {
    super(message);
    this.name = 'OrpcError';
    this.code = code;
  }
}

export function utf8Text(value) {
  if (typeof value !== 'string') {
    try { value = decoder.decode(value); }
    catch { throw new OrpcError('Invalid UTF-8'); }
  }
  if (!value.isWellFormed()) throw new OrpcError('Ill-formed native string');
  return value;
}

export function binaryBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new OrpcError('ORPC requires binary bytes');
}

function encodeFrame(header, content, limit) {
  const body = binaryBytes(content);
  const head = encoder.encode(`${header}\n`);
  const prefix = encoder.encode(`${head.length + body.length} `);
  if (prefix.length + head.length + body.length > limit) throw new OrpcError('Frame size limit exceeded', 'LIMIT');
  const frame = new Uint8Array(prefix.length + head.length + body.length);
  frame.set(prefix);
  frame.set(head, prefix.length);
  frame.set(body, prefix.length + head.length);
  parseFrame(frame, limit);
  return frame;
}

export function parseFrame(value, limit = ORPC_LIMITS.frameBytes) {
  const wire = binaryBytes(value);
  if (wire.length > limit) throw new OrpcError('Frame size limit exceeded', 'LIMIT');
  let prefix = '';
  let offset = 0;
  while (offset < wire.length && wire[offset] !== 32) {
    const byte = wire[offset++];
    if (byte < 48 || byte > 57 || (!prefix && byte === 48) || prefix.length >= 16) throw new OrpcError('Invalid frame length');
    prefix += String.fromCharCode(byte);
    if (!Number.isSafeInteger(Number(prefix))) throw new OrpcError('Overflowing frame length');
    if (Number(prefix) + prefix.length + 1 > limit) throw new OrpcError('Frame size limit exceeded', 'LIMIT');
  }
  if (!prefix || offset >= wire.length || Number(prefix) !== wire.length - offset - 1) throw new OrpcError('Frame length mismatch');
  offset++;
  const lf = wire.indexOf(10, offset);
  if (lf < 0 || lf - offset > 256) throw new OrpcError('Invalid ORPC header separator or size');
  const headerBytes = wire.subarray(offset, lf);
  if (headerBytes.some((byte) => byte > 127)) throw new OrpcError('Non-ASCII header');
  const header = String.fromCharCode(...headerBytes);
  const content = wire.slice(lf + 1);
  const req = /^ORPC\/1 REQ([A-Za-z0-9_-]{1,64}) ([A-Za-z0-9_.-]{1,128})$/.exec(header);
  if (req) return { type: 'REQ', id: req[1], method: req[2], content };
  const res = /^ORPC\/1 RES([A-Za-z0-9_-]{1,64}) ([A-Za-z0-9_-]{1,64}) ([1-9][0-9]{0,15}) ([01])$/.exec(header);
  if (!res || !Number.isSafeInteger(Number(res[3]))) throw new OrpcError('Malformed or unsupported ORPC frame');
  return { type: 'RES', id: res[1], execution: res[2], part: Number(res[3]), final: res[4] === '1', content };
}

export function requestFrame(id, method, content, limit = ORPC_LIMITS.frameBytes) {
  return encodeFrame(`ORPC/1 REQ${id} ${method}`, content, limit);
}

export function* responseFrames(id, execution, content, limit = ORPC_LIMITS.frameBytes) {
  const bytes = binaryBytes(content);
  let offset = 0;
  let part = 1;
  do {
    const header = `ORPC/1 RES${id} ${execution} ${part} `;
    const capacity = limit - String(limit).length - 1 - encoder.encode(header).length - 2;
    if (capacity < 1) throw new OrpcError('Frame size leaves no content capacity', 'LIMIT');
    const end = Math.min(offset + capacity, bytes.length);
    const final = end === bytes.length;
    yield encodeFrame(`${header}${final ? 1 : 0}`, bytes.subarray(offset, end), limit);
    offset = end;
    part++;
  } while (offset < bytes.length);
}

export class OrpcStreamParser {
  constructor(limit = ORPC_LIMITS.frameBytes) {
    this.limit = limit;
    this.prefix = '';
    this.payload = null;
    this.offset = 0;
    this.failed = false;
  }

  push(bytes) {
    if (this.failed) throw new OrpcError('Stream parser has failed');
    const frames = [];
    try {
      for (let index = 0; index < bytes.length;) {
        if (this.payload === null) {
          const byte = bytes[index++];
          if (byte === 32) {
            if (!this.prefix) throw new OrpcError('Missing frame length');
            this.payload = new Uint8Array(Number(this.prefix));
            this.offset = 0;
          } else {
            if (byte < 48 || byte > 57 || (!this.prefix && byte === 48) || this.prefix.length >= 16) throw new OrpcError('Invalid frame length');
            this.prefix += String.fromCharCode(byte);
            const length = Number(this.prefix);
            if (!Number.isSafeInteger(length)) throw new OrpcError('Overflowing frame length');
            if (length + this.prefix.length + 1 > this.limit) throw new OrpcError('Frame size limit exceeded', 'LIMIT');
          }
        } else {
          const count = Math.min(bytes.length - index, this.payload.length - this.offset);
          this.payload.set(bytes.subarray(index, index + count), this.offset);
          index += count;
          this.offset += count;
          if (this.offset === this.payload.length) {
            const prefix = encoder.encode(`${this.prefix} `);
            const frame = new Uint8Array(prefix.length + this.payload.length);
            frame.set(prefix);
            frame.set(this.payload, prefix.length);
            frames.push(parseFrame(frame, this.limit));
            this.prefix = '';
            this.payload = null;
          }
        }
      }
      return frames;
    } catch (error) {
      this.failed = true;
      this.payload = null;
      throw error;
    }
  }

  end() {
    if (this.failed) throw new OrpcError('Stream parser has failed');
    if (this.prefix || this.payload) {
      this.failed = true;
      this.payload = null;
      throw new OrpcError('Incomplete frame at EOF', 'INCOMPLETE');
    }
  }
}

export class OrpcPeer {
  constructor({ send, isOpen, bufferedAmount = () => 0, onRequest, onError = () => {}, limits = {} }) {
    this.limits = { ...ORPC_LIMITS, ...limits };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new OrpcError(`Invalid ORPC limit: ${name}`, 'LIMIT');
    }
    this.send = send;
    this.isOpen = isOpen;
    this.bufferedAmount = bufferedAmount;
    this.onRequest = onRequest;
    this.onError = onError;
    this.pending = new Map();
    this.operations = new Set();
    this.outgoing = [];
    this.executions = 0;
    this.executionControllers = new Set();
    this.receivedBytes = 0;
    this.queuedBytes = 0;
    this.closed = false;
    this.rateStart = Date.now();
    this.rateBytes = 0;
    this.rateFrames = 0;
  }

  async call(method, content, { signal, attemptMs = this.limits.attemptMs, overallMs = this.limits.overallMs } = {}) {
    if (this.closed || signal?.aborted) throw new OrpcError('Operation cancelled', 'CANCELLED');
    if (this.operations.size >= this.limits.concurrent) throw new OrpcError('Concurrent request limit exceeded', 'LIMIT');
    if (!Number.isFinite(attemptMs) || attemptMs <= 0 || !Number.isFinite(overallMs) || overallMs <= 0) throw new OrpcError('Invalid deadline', 'LIMIT');
    content = binaryBytes(content);
    requestFrame(crypto.randomUUID(), method, content, this.limits.frameBytes);
    content = content.slice();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    this.operations.add(controller);
    const deadline = Date.now() + overallMs;
    try {
      for (let retry = 0; retry <= this.limits.retries; retry++) {
        if (controller.signal.aborted) throw new OrpcError('Operation cancelled', 'CANCELLED');
        if (retry) await this.wait(Math.min(this.limits.backoffMs * 2 ** (retry - 1), 2000, Math.max(0, deadline - Date.now())), controller.signal);
        while (!this.isOpen() && Date.now() < deadline && !controller.signal.aborted) await this.wait(Math.min(50, deadline - Date.now()), controller.signal);
        if (controller.signal.aborted) throw new OrpcError('Operation cancelled', 'CANCELLED');
        if (Date.now() >= deadline) break;
        const id = crypto.randomUUID();
        try {
          return await new Promise((resolve, reject) => {
            const abort = () => this.finish(id, new OrpcError('Operation cancelled', 'CANCELLED'));
            const timer = setTimeout(() => this.finish(id, new OrpcError('Incomplete delivery: attempt deadline expired', 'INCOMPLETE')), Math.min(attemptMs, deadline - Date.now()));
            this.pending.set(id, { resolve, reject, timer, abort, signal: controller.signal, parts: new Map(), bytes: 0, final: null, execution: null });
            controller.signal.addEventListener('abort', abort, { once: true });
            this.enqueue([requestFrame(id, method, content, this.limits.frameBytes)][Symbol.iterator](), content.length + 257, id)
              .catch((error) => this.finish(id, error));
          });
        } catch (error) {
          if (error.code !== 'INCOMPLETE') throw error;
        }
      }
      throw new OrpcError('Incomplete delivery: recovery budget or overall deadline exhausted', 'INCOMPLETE');
    } finally {
      this.operations.delete(controller);
      signal?.removeEventListener('abort', cancel);
    }
  }

  wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new OrpcError('Operation cancelled', 'CANCELLED')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
    });
  }

  finish(id, error, content) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal.removeEventListener('abort', pending.abort);
    this.receivedBytes -= pending.bytes;
    const abandoned = this.outgoing.filter((item) => item.id === id);
    this.outgoing = this.outgoing.filter((item) => item.id !== id);
    for (const item of abandoned) {
      this.queuedBytes -= item.bytes;
      item.reject(error ?? new OrpcError('Transmission completed', 'CANCELLED'));
    }
    if (error) pending.reject(error);
    else pending.resolve(content);
  }

  receive(value) {
    if (this.closed) return;
    let frame;
    try { frame = parseFrame(value, this.limits.frameBytes); }
    catch (error) { this.terminate(error); this.onError(error); return; }
    if (frame.type === 'REQ') {
      if (this.executions >= this.limits.concurrent) {
        const error = new OrpcError('Concurrent server execution limit exceeded', 'LIMIT');
        this.terminate(error);
        this.onError(error);
        return;
      }
      const execution = crypto.randomUUID();
      this.executions++;
      const controller = new AbortController();
      this.executionControllers.add(controller);
      const timer = setTimeout(() => controller.abort(), this.limits.attemptMs);
      Promise.resolve().then(() => this.onRequest?.(frame.method, frame.content, controller.signal))
        .then((content) => {
          if (controller.signal.aborted || this.closed) return;
          content = binaryBytes(content ?? new Uint8Array());
          const bytes = content.length;
          if (bytes > this.limits.responseBytes) throw new OrpcError('Response size limit exceeded', 'LIMIT');
          if (this.queuedBytes + bytes + 257 > this.limits.queueBytes) throw new OrpcError('Outgoing queue limit exceeded', 'LIMIT');
          content = content.slice();
          return this.enqueue(responseFrames(frame.id, execution, content, Math.min(this.limits.targetFrameBytes, this.limits.frameBytes)), bytes + 257, null, controller.signal);
        })
        .catch((error) => this.onError(error))
        .finally(() => { clearTimeout(timer); this.executions--; this.executionControllers.delete(controller); });
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    if (pending.execution !== null && pending.execution !== frame.execution) return;
    pending.execution = frame.execution;
    const previous = pending.parts.get(frame.part);
    if (previous) {
      if (previous.content.length !== frame.content.length || previous.content.some((byte, index) => byte !== frame.content[index]) || previous.final !== frame.final) this.finish(frame.id, new OrpcError('Conflicting duplicate response part'));
      return;
    }
    if ((pending.final !== null && frame.part > pending.final)
      || (frame.final && ((pending.final !== null && pending.final !== frame.part) || [...pending.parts.keys()].some((part) => part > frame.part)))) {
      this.finish(frame.id, new OrpcError('Conflicting final response position'));
      return;
    }
    const bytes = frame.content.length;
    if (pending.parts.size >= this.limits.parts || pending.bytes + bytes > this.limits.responseBytes || this.receivedBytes + bytes > this.limits.aggregateBytes) {
      this.finish(frame.id, new OrpcError('Response reconstruction resource limit exceeded', 'LIMIT'));
      return;
    }
    pending.bytes += bytes;
    this.receivedBytes += bytes;
    pending.parts.set(frame.part, frame);
    if (frame.final) pending.final = frame.part;
    if (pending.final !== null && pending.parts.size === pending.final) {
      const ordered = [...pending.parts.values()].sort((a, b) => a.part - b.part);
      const result = new Uint8Array(pending.bytes);
      let offset = 0;
      for (const part of ordered) {
        result.set(part.content, offset);
        offset += part.content.length;
      }
      this.finish(frame.id, null, result);
    }
  }

  enqueue(iterator, bytes, id, signal) {
    if (this.closed) return Promise.reject(new OrpcError('Channel closed', 'INCOMPLETE'));
    if (this.queuedBytes + bytes > this.limits.queueBytes || this.outgoing.length >= this.limits.concurrent * 2) return Promise.reject(new OrpcError('Outgoing queue limit exceeded', 'LIMIT'));
    return new Promise((resolve, reject) => {
      this.queuedBytes += bytes;
      this.outgoing.push({ iterator, bytes, id, signal, resolve, reject, count: 0 });
      this.pump();
    });
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.outgoing.length && !this.closed) {
        if (!this.isOpen()) { this.channelFailed(); break; }
        if (Date.now() - this.rateStart >= 1000) { this.rateStart = Date.now(); this.rateBytes = 0; this.rateFrames = 0; }
        if (this.bufferedAmount() >= this.limits.bufferedBytes || this.rateBytes >= this.limits.bytesPerSecond || this.rateFrames >= this.limits.framesPerSecond) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }
        const item = this.outgoing.shift();
        try {
          if (item.cancelled || item.signal?.aborted) throw new OrpcError('Transmission abandoned', 'INCOMPLETE');
          const next = item.iterator.next();
          if (!next.done) {
            if (++item.count > this.limits.parts) throw new OrpcError('Outgoing part count limit exceeded', 'LIMIT');
            await this.send(next.value);
            this.rateBytes += next.value.length;
            this.rateFrames++;
            if (this.closed || item.signal?.aborted || (item.id && !this.pending.has(item.id))) {
              this.queuedBytes -= item.bytes;
              item.resolve();
            } else this.outgoing.push(item);
          } else {
            this.queuedBytes -= item.bytes;
            item.resolve();
          }
        } catch (error) {
          this.queuedBytes -= item.bytes;
          item.reject(error instanceof OrpcError ? error : new OrpcError('Channel send failed', 'INCOMPLETE'));
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally { this.pumping = false; }
  }

  channelFailed(error = new OrpcError('Incomplete delivery: channel failed', 'INCOMPLETE')) {
    for (const id of this.pending.keys()) this.finish(id, error);
    for (const item of this.outgoing.splice(0)) { this.queuedBytes -= item.bytes; item.reject(error); }
  }

  terminate(error = new OrpcError('Operation cancelled', 'CANCELLED')) {
    this.closed = true;
    this.channelFailed(error);
    for (const controller of this.operations) controller.abort();
    for (const controller of this.executionControllers) controller.abort();
  }
}
