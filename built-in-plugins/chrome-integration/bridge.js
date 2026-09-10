import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

export class ChromeBridge {
  constructor() {
    this.connections = new Map();
    this.tabs = new Map();
  }

  async start() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 55334, maxPayload: 32 * 1024 * 1024,
      verifyClient: ({ origin, req }) => /^chrome-extension:\/\/[a-z]{32}$/.test(origin ?? '') && req.url === '/extension',
    });
    this.server.on('connection', (socket) => {
      const connection = { socket, tabs: new Map(), pending: new Map(), ready: false };
      this.connections.set(socket, connection);
      socket.on('error', () => socket.terminate());
      socket.on('close', () => {
        this.connections.delete(socket);
        for (const id of connection.tabs.keys()) this.tabs.delete(id);
        for (const pending of connection.pending.values()) pending.reject(new Error('Chrome extension disconnected. Refresh Chrome context.'));
      });
      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'hello') {
            if (message.protocol !== 2 || !Array.isArray(message.tabs)) return socket.close(4003, 'Reload the Avi Chrome extension.');
            connection.ready = true;
            this.reconcile(connection, message.tabs);
            socket.send(JSON.stringify({ type: 'ack', protocol: 2 }));
          } else if (message.type === 'response') {
            const pending = connection.pending.get(message.id);
            if (pending) message.error ? pending.reject(new Error(typeof message.error === 'string' ? message.error : message.error.message)) : pending.resolve(message.result);
          } else if (connection.ready && message.type === 'event' && message.event === 'tabsChanged') {
            this.reconcile(connection, message.params.tabs);
          }
        } catch {
          socket.close(4002, 'Invalid extension message');
        }
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('listening', resolve);
      this.server.once('error', reject);
    });
  }

  reconcile(connection, tabs) {
    if (!Array.isArray(tabs)) throw new Error('Chrome returned an invalid tab inventory.');
    const previous = new Map([...connection.tabs].map(([id, tab]) => [tab.tabId, id]));
    for (const id of connection.tabs.keys()) this.tabs.delete(id);
    connection.tabs.clear();
    for (const tab of tabs) {
      const id = previous.get(tab.tabId) ?? randomUUID();
      connection.tabs.set(id, tab);
      this.tabs.set(id, { connection, tab });
    }
  }

  request(connection, method, params, timeout, signal) {
    signal?.throwIfAborted();
    if (connection.socket.readyState !== 1) throw new Error('Chrome extension disconnected.');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        connection.pending.delete(id);
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(new Error('Chrome action interrupted. Already dispatched browser actions may still complete.'));
      const timer = setTimeout(() => finish(new Error('Chrome request timed out. Refresh context before retrying.')), timeout);
      connection.pending.set(id, { resolve: (result) => finish(null, result), reject: (error) => finish(error) });
      signal?.addEventListener('abort', abort, { once: true });
      connection.socket.send(JSON.stringify({ type: 'request', id, method, params }), (error) => { if (error) finish(error); });
    });
  }

  async getContext(signal) {
    signal?.throwIfAborted();
    const connections = [...this.connections.values()].filter((connection) => connection.ready);
    await Promise.all(connections.map(async (connection) => {
      const tabs = await this.request(connection, 'listTabs', {}, 10000, signal);
      if (!this.connections.has(connection.socket)) throw new Error('Chrome connection changed. Refresh context.');
      this.reconcile(connection, tabs);
    }));
    if (connections.length !== [...this.connections.values()].filter((connection) => connection.ready).length
      || connections.some((connection) => this.connections.get(connection.socket) !== connection)) {
      throw new Error('Chrome connections changed. Refresh context.');
    }
    return connections.flatMap((connection) => [...connection.tabs].map(([id, tab]) => {
      let url = String(tab.url || 'about:blank');
      try { const parsed = new URL(url); parsed.search = ''; parsed.hash = ''; url = parsed.href; } catch { url = url.split(/[?#]/, 1)[0]; }
      return { tab_id: id, title: tab.title || null, url, state: tab.state || 'idle', controllable: /^(?:https?:|file:|about:blank$)/i.test(url) };
    }));
  }

  runActions({ tab_id, code, timeout_ms = 8000 }, signal) {
    const entry = this.tabs.get(tab_id);
    if (!entry) throw new Error('Tab ID expired or not found. Call chrome_get_context first.');
    return this.request(entry.connection, 'runActions', { tabId: entry.tab.tabId, code, timeoutMs: timeout_ms }, timeout_ms + 5000, signal);
  }

  async close() {
    for (const connection of this.connections.values()) {
      for (const pending of connection.pending.values()) pending.reject(new Error('Chrome Integration stopped.'));
      connection.socket.terminate();
    }
    if (this.server) {
      for (const socket of this.server.clients) socket.terminate();
      await new Promise((resolve) => this.server.close(resolve));
    }
    this.connections.clear();
    this.tabs.clear();
  }
}
