export const ORPC_PROTOCOL = 'avi-orpc-draft2';
export const ORPC_LIMITS = Object.freeze({
  frameBytes: 1024 * 1024,
  targetFrameBytes: 64 * 1024,
  requestBytes: 32 * 1024 * 1024,
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
  const match = /^ORPC\/1 (REQ|RES)([0-9a-zA-Z_.@]{1,64}(?:#[0-9A-Z]+)?|#[0-9A-Z]+) (?:([A-Za-z0-9_.-]{1,128}) )?([1-9][0-9]{0,15}) ([01])$/.exec(header);
  if (!match || !Number.isSafeInteger(Number(match[4])) || (match[1] === 'REQ') !== Boolean(match[3])) throw new OrpcError('Malformed or unsupported ORPC frame');
  const [, type, id, method, part, final] = match;
  const [baseId, control = null] = id.split('#');
  if (control && (part !== '1' || final !== '1' || (type === 'REQ' && method !== '0'))) throw new OrpcError('Malformed control frame');
  return { type, id, baseId, control, ...(method ? { method } : {}), part: Number(part), final: final === '1', content };
}

export function requestFrame(id, method, content, limit = ORPC_LIMITS.frameBytes) {
  return encodeFrame(`ORPC/1 REQ${id} ${method} 1 1`, content, limit);
}

export function controlFrame(type, id, content = new Uint8Array(), limit = ORPC_LIMITS.frameBytes) {
  if (!id.includes('#') || !['REQ', 'RES'].includes(type)) throw new OrpcError('Invalid control identifier or direction');
  return encodeFrame(`ORPC/1 ${type}${id}${type === 'REQ' ? ' 0' : ''} 1 1`, content, limit);
}

export function requestFrames(id, method, content, limit = ORPC_LIMITS.frameBytes) {
  return contentFrames(`REQ${id} ${method}`, content, limit);
}

export function responseFrames(id, content, limit = ORPC_LIMITS.frameBytes) {
  return contentFrames(`RES${id}`, content, limit);
}

function* contentFrames(route, content, limit) {
  const bytes = binaryBytes(content);
  let offset = 0;
  let part = 1;
  do {
    const header = `ORPC/1 ${route} ${part} `;
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
  constructor({ send, isOpen, bufferedAmount = () => 0, onRequest, onError = () => {}, onClose = () => {}, integrity = true, limits = {} }) {
    this.limits = { ...ORPC_LIMITS, ...limits };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < (name === 'retries' ? 0 : 1)) throw new OrpcError(`Invalid ORPC limit: ${name}`, 'LIMIT');
    }
    this.send = send;
    this.isOpen = isOpen;
    this.bufferedAmount = bufferedAmount;
    this.onRequest = onRequest;
    this.onError = onError;
    this.onClose = onClose;
    this.integrity = integrity;
    this.incoming = new Map();
    this.controls = new Map();
    this.closing = false;
    this.pending = new Map();
    this.operations = new Set();
    this.outgoing = [];
    this.executions = 0;
    this.receivedBytes = 0;
    this.requestBytes = 0;
    this.queuedBytes = 0;
    this.closed = false;
    this.rateStart = Date.now();
    this.rateBytes = 0;
    this.rateFrames = 0;
  }

  async call(method, content, { signal, attemptMs = this.limits.attemptMs, overallMs = this.limits.overallMs } = {}) {
    if (this.closed || this.closing || signal?.aborted) throw new OrpcError('Operation cancelled', 'CANCELLED');
    if (this.operations.size + this.incoming.size >= this.limits.concurrent) throw new OrpcError('Concurrent request limit exceeded', 'LIMIT');
    if (!Number.isFinite(attemptMs) || attemptMs <= 0 || !Number.isFinite(overallMs) || overallMs <= 0) throw new OrpcError('Invalid deadline', 'LIMIT');
    content = binaryBytes(content);
    requestFrame('validate', method, new Uint8Array(), this.limits.frameBytes);
    if (content.length > this.limits.requestBytes || this.requestBytes + content.length > this.limits.queueBytes) throw new OrpcError('Request size limit exceeded', 'LIMIT');
    content = content.slice();
    this.requestBytes += content.length;
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    this.operations.add(controller);
    const deadline = Date.now() + overallMs;
    try {
      for (let retry = 0; retry <= this.limits.retries; retry++) {
        if (this.closing || controller.signal.aborted) throw new OrpcError('Operation cancelled', 'CANCELLED');
        if (retry) await this.wait(Math.min(this.limits.backoffMs * 2 ** (retry - 1), 2000, Math.max(0, deadline - Date.now())), controller.signal);
        while (!this.isOpen() && Date.now() < deadline && !controller.signal.aborted) await this.wait(Math.min(50, deadline - Date.now()), controller.signal);
        if (this.closing || controller.signal.aborted) throw new OrpcError('Operation cancelled', 'CANCELLED');
        if (Date.now() >= deadline) break;
        let id;
        do { id = crypto.randomUUID().replaceAll('-', ''); } while (this.pending.has(id) || this.incoming.has(id));
        try {
          return await new Promise((resolve, reject) => {
            const abort = () => {
              this.sendControl('REQ', `${id}#CANCEL`);
              this.finish(id, new OrpcError('Operation cancelled', 'CANCELLED'));
            };
            const timer = setTimeout(() => {
              this.sendControl('REQ', `${id}#CANCEL`);
              this.finish(id, new OrpcError('Incomplete delivery: attempt deadline expired', 'INCOMPLETE'));
            }, Math.min(attemptMs, deadline - Date.now()));
            this.pending.set(id, { resolve, reject, timer, abort, signal: controller.signal, parts: new Map(), bytes: 0, final: null });
            controller.signal.addEventListener('abort', abort, { once: true });
            this.transmit('REQ', id, method, content, controller.signal).catch((error) => this.finish(id, error));
          });
        } catch (error) {
          if (error.code !== 'INCOMPLETE') throw error;
        }
      }
      throw new OrpcError('Incomplete delivery: recovery budget or overall deadline exhausted', 'INCOMPLETE');
    } finally {
      this.requestBytes -= content.length;
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
    if (frame.control) {
      this.receiveControl(frame).catch((error) => { this.terminate(error); this.onError(error); });
      return;
    }
    const request = frame.type === 'REQ';
    let transfer = request ? this.incoming.get(frame.id) : this.pending.get(frame.id);
    if (request) {
      if (this.closing && !transfer) {
        this.sendControl('REQ', `${frame.id}#CANCEL`);
        return;
      }
      if (this.pending.has(frame.id) || (transfer && (transfer.processing || transfer.method !== frame.method))) {
        this.sendControl('RES', `${frame.id}#LOCKED`);
        return;
      }
      if (!transfer) {
        if (this.incoming.size + this.pending.size >= this.limits.concurrent || this.executions >= this.limits.concurrent) {
          const error = new OrpcError('Concurrent operation limit exceeded', 'LIMIT');
          this.terminate(error);
          this.onError(error);
          return;
        }
        const controller = new AbortController();
        transfer = { method: frame.method, parts: new Map(), bytes: 0, final: null, controller };
        transfer.timer = setTimeout(() => {
          this.releaseIncoming(frame.id);
          this.sendControl('REQ', `${frame.id}#CANCEL`);
        }, this.limits.attemptMs);
        this.incoming.set(frame.id, transfer);
      }
    }
    if (!transfer) return;
    let error;
    const previous = transfer.parts.get(frame.part);
    if (previous) {
      if (previous.content.length === frame.content.length && previous.content.every((byte, index) => byte === frame.content[index]) && previous.final === frame.final) return;
      error = new OrpcError('Conflicting duplicate part');
    } else if ((transfer.final !== null && frame.part > transfer.final)
      || (frame.final && ((transfer.final !== null && transfer.final !== frame.part) || [...transfer.parts.keys()].some((part) => part > frame.part)))) {
      error = new OrpcError('Conflicting final part position');
    } else if (frame.part > this.limits.parts || transfer.parts.size >= this.limits.parts || transfer.bytes + frame.content.length > (request ? this.limits.requestBytes : this.limits.responseBytes) || this.receivedBytes + frame.content.length > this.limits.aggregateBytes) {
      error = new OrpcError('Reconstruction resource limit exceeded', 'LIMIT');
    }
    if (error) {
      if (request) this.releaseIncoming(frame.id);
      else this.finish(frame.id, error);
      this.sendControl('REQ', `${frame.id}#CANCEL`);
      return;
    }
    transfer.bytes += frame.content.length;
    this.receivedBytes += frame.content.length;
    transfer.parts.set(frame.part, frame);
    if (frame.final) transfer.final = frame.part;
    if (transfer.final !== null && transfer.parts.size === transfer.final) {
      const result = new Uint8Array(transfer.bytes);
      let offset = 0;
      for (let part = 1; part <= transfer.final; part++) {
        const bytes = transfer.parts.get(part).content;
        result.set(bytes, offset);
        transfer.parts.get(part).content = result.subarray(offset, offset + bytes.length);
        offset += bytes.length;
      }
      transfer.content = result;
      if (!this.integrity) this.completeTransfer(frame.type, frame.id, transfer);
    }
  }

  async transmit(type, id, method, content, signal) {
    const limit = Math.min(this.limits.targetFrameBytes, this.limits.frameBytes);
    if (this.queuedBytes + content.length + 512 > this.limits.queueBytes) throw new OrpcError('Outgoing queue limit exceeded', 'LIMIT');
    const reserved = content.length + 512;
    this.queuedBytes += reserved;
    try {
      if (type === 'RES') content = content.slice();
      const hash = this.integrity ? await crypto.subtle.digest('SHA-256', content) : null;
      if (signal?.aborted || this.closed || !(type === 'REQ' ? this.pending : this.incoming).has(id)) return;
      const frames = type === 'REQ' ? requestFrames(id, method, content, limit) : responseFrames(id, content, limit);
      const check = hash ? encoder.encode(`sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`) : null;
      const transfer = (type === 'REQ' ? this.pending : this.incoming).get(id);
      const iterator = (function* () {
        yield* frames;
        if (check) {
          transfer.awaitingCheck = true;
          yield controlFrame(type, `${id}#CHECKSEND`, check, limit);
        }
      })();
      await this.enqueue(iterator, 0, id, signal);
    } finally { this.queuedBytes -= reserved; }
  }

  sendControl(type, id, content) {
    if (this.closed || !this.isOpen()) return Promise.resolve();
    const frame = controlFrame(type, id, content, this.limits.frameBytes);
    if (id.endsWith('#RESEND')) {
      const baseId = id.slice(0, -7);
      const transfer = this.pending.get(baseId) ?? this.incoming.get(baseId);
      if (transfer) transfer.resendRequested = true;
    }
    return this.enqueue([frame][Symbol.iterator](), frame.length, null).catch((error) => {
      if (!this.closed) { this.terminate(error); this.onError(error); }
    });
  }

  releaseIncoming(id, completed = false) {
    const transfer = this.incoming.get(id);
    if (!transfer) return;
    this.incoming.delete(id);
    clearTimeout(transfer.timer);
    transfer.controller.abort();
    this.receivedBytes -= transfer.bytes;
    const abandoned = this.outgoing.filter((item) => item.id === id);
    this.outgoing = this.outgoing.filter((item) => item.id !== id);
    for (const item of abandoned) {
      this.queuedBytes -= item.bytes;
      if (completed) item.resolve();
      else item.reject(new OrpcError('Transmission abandoned', 'CANCELLED'));
    }
  }

  completeTransfer(type, id, transfer) {
    if (type === 'RES') { this.finish(id, null, transfer.content); return; }
    if (transfer.processing || this.incoming.get(id) !== transfer) return;
    transfer.processing = true;
    this.executions++;
    const signal = transfer.controller.signal;
    Promise.resolve().then(() => signal.aborted ? undefined : this.onRequest?.(transfer.method, transfer.content, signal))
      .then((content) => {
        if (signal.aborted || this.closed) return;
        content = binaryBytes(content ?? new Uint8Array());
        if (content.length > this.limits.responseBytes) throw new OrpcError('Response size limit exceeded', 'LIMIT');
        return this.transmit('RES', id, null, content, signal);
      })
      .then(() => { if (!this.integrity) this.releaseIncoming(id); })
      .catch((error) => {
        if (signal.aborted || this.closed) return;
        this.releaseIncoming(id);
        this.sendControl('REQ', `${id}#CANCEL`);
        this.onError(error);
      })
      .finally(() => { this.executions--; });
  }

  async receiveControl(frame) {
    const { type, baseId: id, control } = frame;
    const reply = type === 'REQ' ? 'RES' : 'REQ';
    if (!id) {
      if (!['PING', 'PONG', 'EXIT', 'BYE'].includes(control)) throw new OrpcError('Unknown global control');
      if (control === 'PING') { await this.sendControl(reply, '#PONG'); return; }
      if (control === 'PONG' || control === 'BYE') {
        const waiting = this.controls.get(control);
        if (waiting) { clearTimeout(waiting.timer); this.controls.delete(control); waiting.resolve(); }
        if (control === 'BYE') { this.terminate(); this.onClose(); }
        return;
      }
      this.closing = true;
      await this.sendControl(reply, '#BYE');
      this.terminate();
      this.onClose();
      return;
    }
    if (!['CANCEL', 'CANCELACK', 'CHECKSEND', 'CHECKOK', 'CHECKFAIL', 'RESEND', 'LOCKED'].includes(control)) throw new OrpcError('Unknown operation control');
    if (control === 'CANCEL') {
      this.releaseIncoming(id);
      this.finish(id, new OrpcError('Operation cancelled by peer', 'CANCELLED'));
      await this.sendControl(reply, `${id}#CANCELACK`);
    } else if (control === 'CHECKSEND') {
      const transfer = type === 'REQ' ? this.incoming.get(id) : this.pending.get(id);
      if (transfer?.verifying) return;
      if (!transfer?.content) {
        await this.sendControl(reply, `${id}#CHECKFAIL`);
        this.releaseIncoming(id);
        this.finish(id, new OrpcError('Integrity check before complete content', 'INCOMPLETE'));
        return;
      }
      transfer.verifying = true;
      let hashes;
      try { hashes = utf8Text(frame.content).split(';'); }
      catch { hashes = []; }
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', transfer.content));
      const expected = `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const valid = hashes.length > 0 && hashes.every((hash) => hash === expected);
      if ((type === 'REQ' ? this.incoming : this.pending).get(id) !== transfer) return;
      await this.sendControl(reply, `${id}#${valid ? 'CHECKOK' : 'CHECKFAIL'}`);
      if ((type === 'REQ' ? this.incoming : this.pending).get(id) !== transfer) return;
      if (valid) this.completeTransfer(type, id, transfer);
      else {
        this.releaseIncoming(id);
        this.finish(id, new OrpcError('Content integrity check failed', 'INCOMPLETE'));
      }
    } else if (control === 'CHECKOK') {
      if (type === 'REQ' && this.incoming.get(id)?.awaitingCheck) this.releaseIncoming(id, true);
      else if (type === 'RES' && this.pending.has(id)) this.pending.get(id).awaitingCheck = false;
    } else if (['CHECKFAIL', 'RESEND', 'LOCKED'].includes(control)) {
      if (control === 'RESEND') {
        const transfer = this.pending.get(id) ?? this.incoming.get(id);
        if (type === 'RES' && !transfer) return;
        if (!transfer?.resendRequested || type !== 'RES') await this.sendControl('RES', frame.id);
      }
      if (control !== 'LOCKED') this.releaseIncoming(id);
      this.finish(id, new OrpcError(`Peer requested recovery: ${control}`, 'INCOMPLETE'));
    }
  }

  ping() {
    return this.waitControl('PING', 'PONG');
  }

  shutdown() {
    if (this.closed) return Promise.resolve();
    this.closing = true;
    return this.waitControl('EXIT', 'BYE');
  }

  waitControl(control, expected) {
    if (this.closed || !this.isOpen()) return Promise.reject(new OrpcError('Channel closed', 'INCOMPLETE'));
    if (this.controls.has(expected)) return this.controls.get(expected).promise;
    const waiting = {};
    waiting.promise = new Promise((resolve, reject) => {
      waiting.resolve = resolve;
      waiting.reject = reject;
      waiting.timer = setTimeout(() => {
        this.controls.delete(expected);
        reject(new OrpcError(`Missing #${expected}`, 'INCOMPLETE'));
      }, this.limits.attemptMs);
    });
    this.controls.set(expected, waiting);
    this.sendControl('REQ', `#${control}`);
    return waiting.promise;
  }

  enqueue(iterator, bytes, id, signal) {
    if (this.closed) return Promise.reject(new OrpcError('Channel closed', 'INCOMPLETE'));
    if (this.queuedBytes + bytes > this.limits.queueBytes || this.outgoing.length >= this.limits.concurrent * 2) return Promise.reject(new OrpcError('Outgoing queue limit exceeded', 'LIMIT'));
    return new Promise((resolve, reject) => {
      this.queuedBytes += bytes;
      this.outgoing.push({ iterator, bytes, id, signal, resolve, reject, count: 0, deadline: Date.now() + this.limits.attemptMs });
      this.pump();
    });
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.outgoing.length && !this.closed) {
        if (!this.isOpen()) { this.channelFailed(); break; }
        if (this.outgoing.some((item) => item.deadline <= Date.now())) {
          const error = new OrpcError('Outgoing delivery deadline expired', 'INCOMPLETE');
          this.terminate(error);
          this.onError(error);
          break;
        }
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
            if (!parseFrame(next.value, this.limits.frameBytes).control && ++item.count > this.limits.parts) throw new OrpcError('Outgoing part count limit exceeded', 'LIMIT');
            await this.send(next.value);
            this.rateBytes += next.value.length;
            this.rateFrames++;
            if (this.closed || item.signal?.aborted || (item.id && !this.pending.has(item.id) && !this.incoming.has(item.id))) {
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
    for (const id of this.incoming.keys()) this.releaseIncoming(id);
    for (const waiting of this.controls.values()) { clearTimeout(waiting.timer); waiting.reject(error); }
    this.controls.clear();
    for (const item of this.outgoing.splice(0)) { this.queuedBytes -= item.bytes; item.reject(error); }
  }

  terminate(error = new OrpcError('Operation cancelled', 'CANCELLED')) {
    this.closed = true;
    this.channelFailed(error);
    for (const controller of this.operations) controller.abort();
  }
}
