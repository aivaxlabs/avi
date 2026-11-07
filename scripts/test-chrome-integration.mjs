import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { ChromeBridge } from '../built-in-plugins/chrome-integration/bridge.js';

const PORT = 55399;
const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error('Condition was not met within timeout.');
};

class MockExtension {
  constructor({ tabs = [], origin = ORIGIN, path = '/extension' } = {}) {
    this.tabs = tabs;
    this.origin = origin;
    this.path = path;
    this.silent = false;
    this.delayMs = 0;
    this.runActionsCalls = [];
    this.manageTabCalls = [];
    this.listTabsCalls = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.socket = new WebSocket(`ws://127.0.0.1:${PORT}${this.path}`, {
        headers: { Origin: this.origin },
      });
      this.socket.on('open', () => {
        this.socket.send(JSON.stringify({ type: 'hello', protocol: 3, tabs: this.tabs }));
      });
      this.socket.on('message', (data) => {
        void this.handleMessage(JSON.parse(data.toString()));
      });
      this.socket.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'ack' && !settled) {
            settled = true;
            resolve(this);
          }
        } catch {}
      });
      this.socket.on('close', () => {
        if (!settled) {
          settled = true;
          reject(new Error('Socket closed before ack.'));
        }
      });
      this.socket.on('error', (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  async handleMessage(message) {
    if (message.type !== 'request' || this.silent) return;
    if (this.delayMs > 0) await sleep(this.delayMs);
    if (this.socket.readyState !== 1) return;
    if (message.method === 'listTabs') {
      this.listTabsCalls += 1;
      this.socket.send(JSON.stringify({ type: 'response', id: message.id, result: this.tabs }));
    } else if (message.method === 'runActions') {
      this.runActionsCalls.push(message.params);
      this.socket.send(JSON.stringify({
        type: 'response',
        id: message.id,
        result: {
          text: `{"ok":true,"tab":"${message.params.tabId}"}`,
          images: [{ data: PNG_1PX, mimeType: 'image/png' }],
          openedTabs: this.tabs.filter((tab) => tab.openerTabId === message.params.tabId).map((tab) => tab.tabId),
        },
      }));
    } else if (message.method === 'manageTab') {
      this.manageTabCalls.push(message.params);
      const { action, tabId } = message.params;
      let result;
      if (action === 'close') {
        this.tabs = this.tabs.filter((tab) => tab.tabId !== tabId);
        result = { closed: true, tabId };
      } else if (action === 'open') {
        const tab = { tabId: 99, title: 'Opened', url: message.params.url, state: 'idle', active: true, openerTabId: tabId ?? null };
        this.tabs = [...this.tabs, tab];
        result = { tab };
      } else {
        result = { tab: this.tabs.find((tab) => tab.tabId === tabId), warning: 'slow' };
      }
      this.socket.send(JSON.stringify({ type: 'response', id: message.id, result }));
    }
  }

  terminate() {
    this.socket?.terminate();
  }
}

const tabsA = () => ([
  { tabId: 11, title: 'Example', url: 'https://example.com/page?q=1#hash', state: 'idle' },
  { tabId: 12, title: 'Settings', url: 'chrome://settings', state: 'idle' },
]);
const tabsB = () => ([
  { tabId: 21, title: 'Docs', url: 'https://docs.example.com/', state: 'waiting' },
]);

const bridge = new ChromeBridge({ port: PORT });
let extA;
let extB;
const tests = [];

tests.push({
  name: 'empty context with no connections',
  fn: async () => {
    await bridge.start();
    assert.deepEqual(await bridge.getContext(), []);
  },
});

tests.push({
  name: 'rejects non-extension origin',
  fn: async () => {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${PORT}/extension`, {
          headers: { Origin: 'https://evil.example' },
        });
        socket.on('open', () => {
          socket.terminate();
          resolve('opened');
        });
        socket.on('error', reject);
      }),
      /./,
      'Handshake with a non-extension origin must fail.',
    );
  },
});

tests.push({
  name: 'rejects wrong path',
  fn: async () => {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${PORT}/`, {
          headers: { Origin: ORIGIN },
        });
        socket.on('open', () => {
          socket.terminate();
          resolve('opened');
        });
        socket.on('error', reject);
      }),
      /./,
      'Handshake on a non-extension path must fail.',
    );
  },
});

tests.push({
  name: 'rejects protocol 2 hello with 4003',
  fn: async () => {
    const code = await new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${PORT}/extension`, {
        headers: { Origin: ORIGIN },
      });
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: 2, tabs: [] })));
      socket.on('close', resolve);
      socket.on('error', () => resolve(-1));
    });
    assert.equal(code, 4003);
  },
});

tests.push({
  name: 'fresh inventory across profiles with sanitized urls',
  fn: async () => {
    extA = await new MockExtension({ tabs: tabsA() }).connect();
    extB = await new MockExtension({ tabs: tabsB() }).connect();
    const context = await bridge.getContext();
    assert.equal(context.length, 3);
    const example = context.find((tab) => tab.title === 'Example');
    assert.equal(example.url, 'https://example.com/page');
    assert.equal(example.controllable, true);
    const settings = context.find((tab) => tab.title === 'Settings');
    assert.equal(settings.controllable, false);

    extA.tabs = [{ tabId: 11, title: 'Example renamed', url: 'https://example.com/other', state: 'idle' }];
    const fresh = await bridge.getContext();
    assert.equal(fresh.length, 2);
    assert.ok(!fresh.some((tab) => tab.title === 'Settings'), 'Removed tabs must not linger from cache.');
    assert.ok(fresh.some((tab) => tab.title === 'Example renamed'), 'Inventory must reflect live extension state.');
  },
});

tests.push({
  name: 'stable ids for unchanged native tabs',
  fn: async () => {
    const before = new Map((await bridge.getContext()).map((tab) => [tab.title, tab.tab_id]));
    extB.tabs = [...tabsB(), { tabId: 22, title: 'New', url: 'https://new.example.com/', state: 'idle' }];
    const after = new Map((await bridge.getContext()).map((tab) => [tab.title, tab.tab_id]));
    assert.equal(after.get('Example renamed'), before.get('Example renamed'));
    assert.equal(after.get('Docs'), before.get('Docs'));
    assert.ok(after.get('New') && after.get('New') !== before.get('Docs'), 'New native tabs must get fresh ids.');
    extB.tabs = tabsB();
  },
});

tests.push({
  name: 'runActions routes to owning connection with native tab id',
  fn: async () => {
    const context = await bridge.getContext();
    const docs = context.find((tab) => tab.title === 'Docs');
    const result = await bridge.runActions({ tab_id: docs.tab_id, code: 'return browser.snapshot();' });
    assert.match(result.text, /"tab":"21"/);
    assert.deepEqual(result.images, [{ data: PNG_1PX, mimeType: 'image/png' }]);
    assert.equal(extB.runActionsCalls.length, 1);
    assert.deepEqual(
      extB.runActionsCalls[0],
      { tabId: 21, code: 'return browser.snapshot();', timeoutMs: 8000 },
    );
    assert.equal(extA.runActionsCalls.length, 0);
  },
});

tests.push({
  name: 'runActions forwards frame and snapshot options and maps opened tabs',
  fn: async () => {
    extB.tabs = [...tabsB(), { tabId: 23, title: 'Popup', url: 'https://auth.example.com/', state: 'idle', openerTabId: 21 }];
    const context = await bridge.getContext();
    const docs = context.find((tab) => tab.title === 'Docs');
    const popup = context.find((tab) => tab.title === 'Popup');
    assert.equal(popup.opener_tab_id, docs.tab_id);
    assert.equal(docs.active, false);
    const result = await bridge.runActions({ tab_id: docs.tab_id, code: 'return 1;', frame_id: 'f2', snapshot: false });
    assert.deepEqual(extB.runActionsCalls.at(-1), { tabId: 21, code: 'return 1;', timeoutMs: 8000, frameId: 'f2', snapshot: false });
    assert.deepEqual(result.openedTabs, [popup.tab_id]);
    extB.tabs = tabsB();
  },
});

tests.push({
  name: 'manageTab opens, reloads and closes with stable ids',
  fn: async () => {
    const docs = (await bridge.getContext()).find((tab) => tab.title === 'Docs');
    const opened = await bridge.manageTab({ action: 'open', tab_id: docs.tab_id, url: 'https://new.example.com/?q=1' });
    assert.equal(opened.tab.url, 'https://new.example.com/');
    assert.equal(opened.tab.opener_tab_id, docs.tab_id);
    assert.deepEqual(extB.manageTabCalls.at(-1).tabId, 21);
    const listed = (await bridge.getContext()).find((tab) => tab.title === 'Opened');
    assert.equal(listed.tab_id, opened.tab.tab_id, 'Opened tab must keep its id in the next inventory.');

    const reloaded = await bridge.manageTab({ action: 'reload', tab_id: docs.tab_id, bypass_cache: true });
    assert.equal(reloaded.tab.tab_id, docs.tab_id);
    assert.equal(reloaded.warning, 'slow');
    assert.equal(extB.manageTabCalls.at(-1).bypassCache, true);

    assert.deepEqual(await bridge.manageTab({ action: 'close', tab_id: opened.tab.tab_id }), { closed: true, tab_id: opened.tab.tab_id });
    assert.throws(() => bridge.runActions({ tab_id: opened.tab.tab_id, code: 'return 1;' }), /expired/);
    await assert.rejects(bridge.manageTab({ action: 'open', url: 'https://x.example/' }), /Several Chrome profiles/);
    await assert.rejects(bridge.manageTab({ action: 'reload' }), /tab_id is required/);
    extB.tabs = tabsB();
  },
});

tests.push({
  name: 'runActions with unknown id throws expired',
  fn: async () => {
    assert.throws(
      () => bridge.runActions({ tab_id: '00000000-0000-4000-8000-000000000000', code: 'return 1;' }),
      /expired/,
    );
  },
});

tests.push({
  name: 'ids expire on disconnect',
  fn: async () => {
    const staleId = (await bridge.getContext()).find((tab) => tab.title === 'Example renamed').tab_id;
    extA.terminate();
    await waitFor(() => bridge.connections.size === 1);
    const context = await bridge.getContext();
    assert.ok(context.every((tab) => tab.title !== 'Example renamed'));
    assert.throws(() => bridge.runActions({ tab_id: staleId, code: 'return 1;' }), /expired/);
  },
});

tests.push({
  name: 'abort rejects pending and cleans up',
  fn: async () => {
    await assert.rejects(bridge.getContext(AbortSignal.abort()), /abort/i);
    extB.silent = true;
    try {
      const docs = (await bridge.getContext.call(bridge, undefined).catch(() => null)) ?? null;
      assert.equal(docs, null);
    } finally {
      extB.silent = false;
    }
    extB.silent = true;
    try {
      const context = await (async () => {
        extB.silent = false;
        const live = await bridge.getContext();
        extB.silent = true;
        return live;
      })();
      const docs = context.find((tab) => tab.title === 'Docs');
      const controller = new AbortController();
      const pending = bridge.runActions({ tab_id: docs.tab_id, code: 'return 1;' }, controller.signal);
      controller.abort();
      await assert.rejects(pending, /interrupted/);
      const connection = [...bridge.connections.values()][0];
      assert.equal(connection.pending.size, 0);
    } finally {
      extB.silent = false;
    }
  },
});

tests.push({
  name: 'timed-out request cleans pending',
  fn: async () => {
    const connection = [...bridge.connections.values()][0];
    extB.silent = true;
    try {
      await assert.rejects(bridge.request(connection, 'listTabs', {}, 150), /timed out/);
      assert.equal(connection.pending.size, 0);
    } finally {
      extB.silent = false;
    }
  },
});

tests.push({
  name: 'close rejects pending, clears state, frees port',
  fn: async () => {
    extB.silent = true;
    const context = await (async () => {
      extB.silent = false;
      const live = await bridge.getContext();
      extB.silent = true;
      return live;
    })();
    const docs = context.find((tab) => tab.title === 'Docs');
    const pending = bridge.runActions({ tab_id: docs.tab_id, code: 'return 1;' });
    const closed = bridge.close();
    await assert.rejects(pending, /stopped/);
    await closed;
    assert.equal(bridge.connections.size, 0);
    assert.equal(bridge.tabs.size, 0);
    extB.terminate();

    const fresh = new ChromeBridge({ port: PORT });
    await fresh.start();
    assert.deepEqual(await fresh.getContext(), []);
    await fresh.close();
  },
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
try {
  extA?.terminate();
  extB?.terminate();
  await bridge.close().catch(() => {});
} catch {}
if (failures > 0) {
  console.error(`${failures} chrome integration test(s) failed.`);
  process.exit(1);
}
console.log(`Chrome integration bridge tests passed (${tests.length}).`);
