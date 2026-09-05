import WebSocket from 'ws';

export const AIVAX_RELAY_URL = 'https://avi-relay.projpw.workers.dev';

const RELAY_PROTOCOL = 'avi-relay-v1';
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_PATTERN = /^[0-9a-f]{64}$/;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONVERSATION_STREAM_PATTERN = /^\/rpc\/conversations\/streams\/([^/]+)$/;

const MAX_CHANNEL_BYTES = 1024 * 1024;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024 + 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_OPEN_PATH_LENGTH = 512;
const RATE_WINDOW_MS = 1_000;
const RATE_MAX_MESSAGES = 128;
const RATE_MAX_BYTES = 4 * 1024 * 1024;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 60_000;
const RETRY_MAX_DELAY_MS = 30_000;
const TEARDOWN_TIMEOUT_MS = 2_000;
const CHANNEL_LIMIT = 32;
const PERMANENT_CLOSE_CODES = new Set([1008, 1009, 4003]);
const PERMANENT_CLOSE_MESSAGES = new Map([
  [1008, 'The relay closed the session for a policy or rate violation; Remote stopped.'],
  [1009, 'The relay rejected an oversized payload; Remote stopped.'],
  [4003, 'The relay reported an invalid channel close; Remote stopped.'],
]);
const CREDENTIAL_ERROR = 'The relay rejected the AIVAX credential. Sign in to or repair the AIVAX integration to use Remote.';

export class RemoteRelay {
  constructor({
    deviceId,
    name = null,
    createLocalSocket = null,
    relayBaseUrl = AIVAX_RELAY_URL,
    fetchImpl = null,
    createRelaySocket = null,
    retryBaseMs = 1_000,
    retryStableMs = 30_000,
    revocationCheckMs = 15_000,
    handshakeTimeoutMs = 10_000,
  } = {}) {
    this.deviceId = typeof deviceId === 'string' ? deviceId : '';
    this.name = typeof name === 'string' && name.length >= 1 && name.length <= 128 ? name : null;
    this.createLocalSocket = createLocalSocket;
    this.relayBaseUrl = relayBaseUrl;
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : fetch.bind(globalThis);
    this.createRelaySocket = typeof createRelaySocket === 'function'
      ? createRelaySocket
      : (url, protocols, options) => new WebSocket(url, protocols, options);
    let relayBaseUrlAllowed = false;
    try {
      const base = new URL(relayBaseUrl);
      const loopback = ['127.0.0.1', 'localhost', '::1'].includes(base.hostname);
      relayBaseUrlAllowed = base.protocol === 'https:' || (base.protocol === 'http:' && loopback);
    } catch {
      relayBaseUrlAllowed = false;
    }
    this.relayBaseUrlAllowed = relayBaseUrlAllowed;
    this.retryBaseMs = retryBaseMs;
    this.retryStableMs = retryStableMs;
    this.revocationCheckMs = revocationCheckMs;
    this.handshakeTimeoutMs = handshakeTimeoutMs;
    this.accessToken = null;
    this.localPort = null;
    this.enabled = true;
    this.status = 'stopped';
    this.error = '';
    this.generation = 0;
    this.socket = null;
    this.channels = new Map();
    this.timers = { ping: null, revocation: null };
    this.ticketAbort = null;
    this.cancelRetryWait = null;
    this.teardown = Promise.resolve();
    this.fatal = false;
    this.connectedAt = 0;
    this.stableDurationMs = 0;
    this.hasConnected = false;
    this.tickRelayBuffered = 0;
    this.lastPongAt = 0;
    this.rateWindowStart = 0;
    this.rateMessages = 0;
    this.rateBytes = 0;
  }

  snapshot() {
    return {
      status: this.status,
      serverUrl: AIVAX_RELAY_URL,
      deviceId: this.deviceId || null,
      localPort: this.localPort,
      error: this.error,
    };
  }

  update({ accessToken = null, port = null, enabled = true } = {}) {
    const apply = async () => {
      const token = typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null;
      const configuredPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
      const isEnabled = enabled !== false;
      const live = this.status === 'connecting' || this.status === 'connected' || this.status === 'reconnecting';
      const terminal = this.status === 'unauthorized' || this.status === 'error';
      const sameConfiguration = this.enabled && this.accessToken === token && this.localPort === configuredPort;
      if (isEnabled && sameConfiguration && (live || terminal)) return;
      await this.stopSession();
      this.enabled = isEnabled;
      this.accessToken = token;
      this.localPort = configuredPort;
      this.status = 'stopped';
      this.error = '';
      if (!isEnabled) {
        this.error = 'Remote relay is disabled.';
        return;
      }
      if (!token) return;
      if (!this.relayBaseUrlAllowed) {
        this.status = 'error';
        this.error = 'The relay endpoint must use HTTPS.';
        return;
      }
      if (!DEVICE_ID_PATTERN.test(this.deviceId)) {
        this.status = 'error';
        this.error = 'The configured relay deviceId is missing or invalid.';
        return;
      }
      this.status = 'connecting';
      this.runLoop(this.generation);
    };
    this.teardown = this.teardown.then(apply, apply);
    return this.teardown;
  }

  async stopSession() {
    this.generation += 1;
    this.fatal = false;
    this.clearTimers();
    this.cancelRetryWait?.();
    this.cancelRetryWait = null;
    this.ticketAbort?.abort();
    this.ticketAbort = null;
    const channels = this.channels;
    this.channels = new Map();
    for (const channel of channels.values()) this.discardChannel(channel);
    const socket = this.socket;
    this.socket = null;
    this.rateMessages = 0;
    this.rateBytes = 0;
    this.connectedAt = 0;
    this.stableDurationMs = 0;
    this.hasConnected = false;
    this.tickRelayBuffered = 0;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const guard = setTimeout(() => {
        socket.terminate();
        resolve();
      }, TEARDOWN_TIMEOUT_MS);
      socket.once('close', () => {
        clearTimeout(guard);
        resolve();
      });
      if (socket.readyState === WebSocket.OPEN) socket.close(1000);
      else if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.CLOSING) socket.terminate();
    });
  }

  clearTimers() {
    clearInterval(this.timers.ping);
    clearInterval(this.timers.revocation);
    this.timers.ping = null;
    this.timers.revocation = null;
  }

  waitRetry(delay) {
    return new Promise((resolve) => {
      const cancel = () => {
        clearTimeout(timer);
        if (this.cancelRetryWait === cancel) this.cancelRetryWait = null;
        resolve();
      };
      const timer = setTimeout(() => {
        if (this.cancelRetryWait === cancel) this.cancelRetryWait = null;
        resolve();
      }, delay);
      this.cancelRetryWait = cancel;
    });
  }

  async runLoop(generation) {
    let attempt = 0;
    while (this.generation === generation) {
      let outcome;
      try {
        outcome = await this.connectOnce(generation);
      } catch {
        if (this.generation !== generation) return;
        this.setTransientError('The relay session failed unexpectedly; retrying.');
        outcome = 'transient';
      }
      if (this.generation !== generation || outcome === 'permanent' || outcome === 'aborted') return;
      attempt = this.stableDurationMs >= this.retryStableMs ? 0 : attempt + 1;
      this.stableDurationMs = 0;
      const raw = Math.min(RETRY_MAX_DELAY_MS, this.retryBaseMs * 2 ** attempt);
      await this.waitRetry(raw / 2 + Math.random() * (raw / 2));
    }
  }

  setTransientError(message) {
    this.error = message;
    this.status = this.hasConnected ? 'reconnecting' : 'connecting';
  }

  async connectOnce(generation) {
    this.fatal = false;
    const ticket = await this.acquireTicket(generation);
    if (this.generation !== generation) return 'aborted';
    if (ticket === 'aborted') return 'aborted';
    if (ticket === 'transient' || ticket === 'permanent') return ticket;

    const socket = this.createRelaySocket(ticket.websocketUrl, [RELAY_PROTOCOL, `avi-relay-ticket.${ticket.secret}`], {
      handshakeTimeout: this.handshakeTimeoutMs,
      maxPayload: MAX_ENVELOPE_BYTES,
    });
    this.socket = socket;
    const opened = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve(value);
      };
      const guard = setTimeout(() => socket.terminate(), this.handshakeTimeoutMs);
      socket.once('open', () => finish({ ok: true }));
      socket.once('unexpected-response', (_request, response) => finish({ ok: false }));
      socket.once('error', () => finish({ ok: false }));
      socket.once('close', () => finish({ ok: false }));
    });
    if (this.generation !== generation || !opened.ok) {
      const aborted = this.generation !== generation;
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.terminate();
      if (this.socket === socket) this.socket = null;
      if (aborted) return 'aborted';
      this.setTransientError('The relay connection could not be established; retrying.');
      return 'transient';
    }
    if (socket.protocol !== RELAY_PROTOCOL) {
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.terminate();
      if (this.socket === socket) this.socket = null;
      this.status = 'error';
      this.error = 'The relay did not select the expected subprotocol; Remote stopped.';
      return 'permanent';
    }

    this.channels = new Map();
    this.fatal = false;
    this.connectedAt = Date.now();
    this.hasConnected = true;
    this.tickRelayBuffered = 0;
    this.lastPongAt = Date.now();
    this.rateWindowStart = Date.now();
    this.rateMessages = 0;
    this.rateBytes = 0;
    this.status = 'connected';
    this.error = '';

    socket.on('pong', () => {
      if (this.socket !== socket) return;
      this.lastPongAt = Date.now();
    });
    socket.on('error', () => {
      // Recovered through the close event and the pong deadline; never surface raw errors.
    });
    socket.on('message', (data, isBinary) => {
      if (this.generation !== generation || this.socket !== socket) return;
      if (isBinary) {
        this.failSession(socket, 'The relay sent an unexpected binary frame; Remote stopped.');
        return;
      }
      this.handleEnvelope(socket, generation, data.toString('utf8'));
    });
    socket.on('close', (code) => {
      if (this.generation !== generation || this.socket !== socket) return;
      if (this.connectedAt > 0) {
        this.stableDurationMs = Date.now() - this.connectedAt;
        this.connectedAt = 0;
      }
      this.clearTimers();
      this.teardownChannels();
      this.socket = null;
      if (this.fatal) return;
      if (PERMANENT_CLOSE_CODES.has(code)) {
        this.status = 'error';
        this.error = PERMANENT_CLOSE_MESSAGES.get(code);
        return;
      }
      this.setTransientError('The relay connection was lost; reconnecting automatically.');
    });

    this.timers.ping = setInterval(() => {
      if (this.generation !== generation || this.socket !== socket) return;
      this.runPeriodicChecks(socket, generation);
      if (this.generation !== generation || this.socket !== socket) return;
      if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
        socket.terminate();
        return;
      }
      socket.ping();
    }, PING_INTERVAL_MS);
    this.timers.revocation = setInterval(() => {
      if (this.generation !== generation || this.socket !== socket) return;
      this.runPeriodicChecks(socket, generation);
    }, this.revocationCheckMs);

    const closeCode = await new Promise((resolve) => socket.once('close', (code) => resolve(code)));
    if (this.fatal || PERMANENT_CLOSE_CODES.has(closeCode)) return 'permanent';
    return 'transient';
  }

  runPeriodicChecks(socket, generation) {
    if (this.tickRelayBuffered > 0 && socket.bufferedAmount >= this.tickRelayBuffered) {
      socket.terminate();
      return;
    }
    this.tickRelayBuffered = socket.bufferedAmount;
    for (const channel of [...this.channels.values()]) {
      const local = channel.local;
      if (!channel.ready || !local || local.readyState !== WebSocket.OPEN) continue;
      if (channel.tickBuffered !== null && channel.tickBuffered > 0 && local.bufferedAmount >= channel.tickBuffered) {
        local.terminate();
        continue;
      }
      channel.tickBuffered = local.bufferedAmount;
    }
  }

  async acquireTicket(generation) {
    const controller = new AbortController();
    this.ticketAbort = controller;
    const guard = setTimeout(() => controller.abort(), this.handshakeTimeoutMs);
    let response = null;
    let ticket = null;
    try {
      response = await this.fetchImpl(`${this.relayBaseUrl}/v1/relays/${encodeURIComponent(this.deviceId)}/tickets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(this.name ? { role: 'publisher', name: this.name } : { role: 'publisher' }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.ok) ticket = await response.json();
    } catch {
      if (this.generation !== generation) return 'aborted';
      this.setTransientError('The relay could not be reached to request a session ticket; retrying.');
      return 'transient';
    } finally {
      clearTimeout(guard);
      if (this.ticketAbort === controller) this.ticketAbort = null;
    }
    if (this.generation !== generation) return 'aborted';
    if (response.status === 401 || response.status === 403) {
      this.status = 'unauthorized';
      this.error = CREDENTIAL_ERROR;
      return 'permanent';
    }
    if (response.status !== 201) {
      if (response.status === 400 || response.status === 413 || response.status === 426) {
        this.status = 'error';
        this.error = 'The relay rejected the session ticket request; Remote stopped.';
        return 'permanent';
      }
      this.setTransientError(
        response.status === 409
          ? 'The relay already has a publisher for this deviceId; retrying.'
          : 'The relay is not issuing session tickets right now; retrying.',
      );
      return 'transient';
    }
    if (!this.isTicketShapeValid(ticket)) {
      this.status = 'error';
      this.error = 'The relay returned an unexpected session ticket; Remote stopped.';
      return 'permanent';
    }
    if (ticket.expiresAt <= Date.now()) {
      this.setTransientError('The relay issued an already expired session ticket; retrying.');
      return 'transient';
    }
    return { secret: ticket.ticket, websocketUrl: ticket.websocketUrl };
  }

  isTicketShapeValid(ticket) {
    if (typeof ticket !== 'object' || ticket === null) return false;
    if (typeof ticket.ticket !== 'string' || !TICKET_PATTERN.test(ticket.ticket)) return false;
    if (ticket.protocol !== RELAY_PROTOCOL) return false;
    if (typeof ticket.expiresAt !== 'number' || !Number.isFinite(ticket.expiresAt)) return false;
    if (typeof ticket.websocketUrl !== 'string') return false;
    try {
      const base = new URL(this.relayBaseUrl);
      const url = new URL(ticket.websocketUrl);
      const expectedProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      const segments = url.pathname.split('/').filter(Boolean);
      return url.protocol === expectedProtocol
        && url.host === base.host
        && url.username === ''
        && url.password === ''
        && url.hash === ''
        && url.search === ''
        && segments.length === 5
        && segments[0] === 'v1'
        && segments[1] === 'relays'
        && ACCOUNT_ID_PATTERN.test(segments[2])
        && segments[3] === this.deviceId
        && segments[4] === 'connect';
    } catch {
      return false;
    }
  }

  failSession(socket, message) {
    if (this.socket !== socket) return;
    this.fatal = true;
    this.status = 'error';
    this.error = message;
    this.clearTimers();
    this.teardownChannels();
    socket.terminate();
  }

  teardownChannels() {
    const channels = this.channels;
    this.channels = new Map();
    for (const channel of channels.values()) this.discardChannel(channel);
  }

  discardChannel(channel) {
    channel.dead = true;
    clearTimeout(channel.openTimer);
    channel.openTimer = null;
    channel.cancelOpening?.();
    channel.cancelOpening = null;
    channel.path = null;
    channel.tickBuffered = null;
    channel.local?.terminate();
    channel.local = null;
  }

  sendEnvelope(socket, generation, envelope) {
    if (this.generation !== generation || this.socket !== socket || socket.readyState !== WebSocket.OPEN) return 'closed';
    const json = JSON.stringify(envelope);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > MAX_ENVELOPE_BYTES) return 'oversize';
    const now = Date.now();
    if (now - this.rateWindowStart >= RATE_WINDOW_MS) {
      this.rateWindowStart = now;
      this.rateMessages = 0;
      this.rateBytes = 0;
    }
    if (this.rateMessages + 1 > RATE_MAX_MESSAGES || this.rateBytes + bytes > RATE_MAX_BYTES) {
      this.failSession(socket, 'The relay outbound message rate would be exceeded; Remote stopped to protect the service limit.');
      return 'rate';
    }
    if (socket.bufferedAmount + bytes > MAX_BUFFERED_BYTES) {
      socket.terminate();
      return 'slow';
    }
    this.rateMessages += 1;
    this.rateBytes += bytes;
    try {
      socket.send(json);
    } catch {
      socket.terminate();
      return 'failed';
    }
    return 'sent';
  }

  sendChannelData(socket, generation, channel, payload) {
    return this.sendEnvelope(socket, generation, {
      type: 'data',
      channelId: channel.id,
      encoding: typeof payload === 'string' ? 'text' : 'base64',
      data: typeof payload === 'string' ? payload : payload.toString('base64'),
    });
  }

  sendChannelError(socket, generation, channel, code) {
    this.sendEnvelope(socket, generation, {
      type: 'data',
      channelId: channel.id,
      encoding: 'text',
      data: JSON.stringify({ type: 'avi-remote-error', version: 2, code }),
    });
  }

  closeChannel(socket, generation, channel, { notifyRelay = true, errorCode = null } = {}) {
    if (channel.dead) return;
    this.discardChannel(channel);
    this.channels.delete(channel.id);
    if (errorCode) this.sendChannelError(socket, generation, channel, errorCode);
    if (notifyRelay) {
      this.sendEnvelope(socket, generation, { type: 'close', channelId: channel.id });
    }
  }

  handleEnvelope(socket, generation, text) {
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      this.failSession(socket, 'The relay sent a malformed envelope; Remote stopped.');
      return;
    }
    const channelId = typeof envelope?.channelId === 'string' ? envelope.channelId : null;
    if (envelope?.type === 'open') {
      if (channelId === null || !CHANNEL_ID_PATTERN.test(channelId)) {
        this.failSession(socket, 'The relay sent a malformed envelope; Remote stopped.');
        return;
      }
      if (this.channels.has(channelId)) {
        this.failSession(socket, 'The relay reused an active channel id; Remote stopped.');
        return;
      }
      if (this.channels.size >= CHANNEL_LIMIT) {
        const overflow = { id: channelId, path: null, local: null, ready: false, dead: false, openTimer: null, cancelOpening: null, tickBuffered: null };
        this.closeChannel(socket, generation, overflow, { errorCode: 'unavailable' });
        return;
      }
      const channel = { id: channelId, path: null, local: null, ready: false, dead: false, openTimer: null, cancelOpening: null, tickBuffered: null };
      channel.openTimer = setTimeout(() => {
        channel.openTimer = null;
        if (!channel.dead && !channel.ready) this.closeChannel(socket, generation, channel);
      }, this.handshakeTimeoutMs);
      this.channels.set(channelId, channel);
      return;
    }
    if (envelope?.type === 'data') {
      const channel = this.channels.get(channelId);
      if (!channel) return;
      if (envelope.encoding === 'text') {
        if (typeof envelope.data !== 'string') {
          this.failSession(socket, 'The relay sent a malformed envelope; Remote stopped.');
          return;
        }
        this.handleChannelText(socket, generation, channel, envelope.data);
        return;
      }
      if (envelope.encoding === 'base64') {
        if (typeof envelope.data !== 'string') {
          this.failSession(socket, 'The relay sent a malformed envelope; Remote stopped.');
          return;
        }
        if (!channel.ready) {
          this.closeChannel(socket, generation, channel, { errorCode: 'invalid_open' });
          return;
        }
        if (!CANONICAL_BASE64_PATTERN.test(envelope.data)) {
          this.closeChannel(socket, generation, channel);
          return;
        }
        const payload = Buffer.from(envelope.data, 'base64');
        if (payload.length > MAX_CHANNEL_BYTES) {
          this.closeChannel(socket, generation, channel);
          return;
        }
        this.sendToLocal(channel, payload);
        return;
      }
      this.failSession(socket, 'The relay sent a malformed envelope; Remote stopped.');
      return;
    }
    if (envelope?.type === 'close') {
      if (channelId === null) {
        this.failSession(socket, 'The relay sent a malformed envelope; Remote stopped.');
        return;
      }
      const channel = this.channels.get(channelId);
      if (!channel) return;
      this.closeChannel(socket, generation, channel, { notifyRelay: false });
      return;
    }
    this.failSession(socket, 'The relay sent a malformed envelope; Remote stopped.');
  }

  handleChannelText(socket, generation, channel, text) {
    if (Buffer.byteLength(text, 'utf8') > MAX_CHANNEL_BYTES) {
      this.closeChannel(socket, generation, channel);
      return;
    }
    if (!channel.ready) {
      if (channel.local) {
        this.closeChannel(socket, generation, channel, { errorCode: 'invalid_open' });
        return;
      }
      this.handleOpeningFrame(socket, generation, channel, text);
      return;
    }
    if (text.length <= 512 && text.includes('avi-remote-ping')) {
      let frame;
      try {
        frame = JSON.parse(text);
      } catch {
        frame = null;
      }
      if (frame?.type === 'avi-remote-ping') {
        if (frame.version === 2 && typeof frame.id === 'string' && frame.id.length >= 1 && frame.id.length <= 128) {
          this.sendEnvelope(socket, generation, {
            type: 'data',
            channelId: channel.id,
            encoding: 'text',
            data: JSON.stringify({ type: 'avi-remote-pong', version: 2, id: frame.id }),
          });
        }
        return;
      }
    }
    this.sendToLocal(channel, text);
  }

  sendToLocal(channel, payload) {
    const local = channel.local;
    if (!local || local.readyState !== WebSocket.OPEN) return;
    const size = typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.length;
    if (local.bufferedAmount + size > MAX_BUFFERED_BYTES) {
      local.terminate();
      return;
    }
    try {
      local.send(payload);
    } catch {
      local.terminate();
    }
  }

  forwardToPublisher(socket, generation, channel, payload) {
    const result = this.sendChannelData(socket, generation, channel, payload);
    if (result === 'oversize') this.closeChannel(socket, generation, channel);
  }

  isApprovedPath(path) {
    if (path === '/rpc') return true;
    if (typeof path !== 'string' || path.length > MAX_OPEN_PATH_LENGTH) return false;
    if (path.includes('\\') || path.includes('?') || path.includes('#') || path.includes('\0')) return false;
    const match = CONVERSATION_STREAM_PATTERN.exec(path);
    if (!match) return false;
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return false;
    }
    return id.length > 0 && id !== '.' && id !== '..' && !/[\/\\?#\u0000]/.test(id);
  }

  handleOpeningFrame(socket, generation, channel, text) {
    if (Buffer.byteLength(text, 'utf8') > MAX_CHANNEL_BYTES) {
      this.closeChannel(socket, generation, channel, { errorCode: 'invalid_open' });
      return;
    }
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      this.closeChannel(socket, generation, channel, { errorCode: 'invalid_open' });
      return;
    }
    const path = frame?.path;
    if (frame?.type !== 'avi-remote-open'
      || frame?.version !== 2
      || Object.hasOwn(frame, 'apiKey')
      || !this.isApprovedPath(path)) {
      this.closeChannel(socket, generation, channel, { errorCode: 'invalid_open' });
      return;
    }
    channel.path = path;
    let local;
    try {
      local = this.createLocalSocket(path);
    } catch {
      this.closeChannel(socket, generation, channel, { errorCode: 'unavailable' });
      return;
    }
    channel.local = local;
    let settled = false;
    const guard = setTimeout(() => failOpen('unavailable'), this.handshakeTimeoutMs);
    channel.cancelOpening = () => clearTimeout(guard);
    const failOpen = (errorCode) => {
      if (settled || channel.dead) return;
      settled = true;
      clearTimeout(guard);
      local.removeAllListeners();
      local.on('error', () => {});
      local.terminate();
      channel.local = null;
      this.closeChannel(socket, generation, channel, { errorCode });
    };
    local.once('unexpected-response', (_request, response) => {
      failOpen(response.statusCode === 401 || response.statusCode === 403 ? 'unauthorized' : 'unavailable');
    });
    local.once('error', () => failOpen('unavailable'));
    local.once('open', () => {
      if (settled || channel.dead || this.generation !== generation || this.socket !== socket) {
        failOpen('unavailable');
        return;
      }
      settled = true;
      clearTimeout(guard);
      channel.cancelOpening = null;
      clearTimeout(channel.openTimer);
      channel.openTimer = null;
      const sent = this.sendEnvelope(socket, generation, {
        type: 'data',
        channelId: channel.id,
        encoding: 'text',
        data: JSON.stringify({ type: 'avi-remote-ready', version: 2 }),
      });
      if (sent !== 'sent') {
        local.terminate();
        channel.local = null;
        this.closeChannel(socket, generation, channel);
        return;
      }
      channel.ready = true;
      local.on('message', (data, isBinary) => {
        if (channel.dead || this.generation !== generation || this.socket !== socket) return;
        if (isBinary ? data.length > MAX_CHANNEL_BYTES : Buffer.byteLength(data, 'utf8') > MAX_CHANNEL_BYTES) {
          this.closeChannel(socket, generation, channel);
          return;
        }
        this.forwardToPublisher(socket, generation, channel, isBinary ? data : data.toString('utf8'));
      });
      local.once('close', () => {
        this.closeChannel(socket, generation, channel);
      });
    });
  }
}
