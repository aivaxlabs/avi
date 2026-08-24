import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AviError, PluginRuntime, createPluginDisposable } from '../src/main/plugin-runtime.js';

const root = await mkdtemp(join(tmpdir(), 'avi-plugin-runtime-v2-'));
const events = [];
const conceptualEvents = [];
const lifecycle = [];

try {
  const runtime = new PluginRuntime({
    pluginsDir: root,
    services: {
      appInfo: () => ({ name: 'Avi', version: 'test' }),
      createDomainApi: () => ({
        threads: Object.freeze({ marker: 'threads' }),
        bots: Object.freeze({ marker: 'bots' }),
      }),
      registerTool: ({ runtime: currentRuntime, record, tool, threadId }) => {
        const key = `${threadId ?? '*'}\0${tool.name}`;
        currentRuntime.tools.set(key, { pluginId: record.id, threadId, tool });
        return currentRuntime.track(record, {
          disposed: false,
          dispose() {
            this.disposed = true;
            currentRuntime.tools.delete(key);
          },
        });
      },
    },
  });

  assert.deepEqual(runtime.validateCapabilities(['storage', 'events.subscribe']), [
    'storage',
    'events.subscribe',
  ]);
  assert.throws(() => runtime.validateCapabilities(['unknown']), /Unknown plugin capability/);
  assert.throws(() => runtime.validateCapabilities(['storage', 'storage']), /duplicates/);

  const api = await runtime.activate({
    id: 'runtime-test',
    capabilities: [
      'storage',
      'events.subscribe',
      'tools.register',
      'tools.intercept',
    ],
    async activate(avi) {
      assert.equal(avi.apiVersion, 2);
      assert.equal(avi.threads.marker, 'threads');
      assert.equal((await avi.app.getInfo()).name, 'Avi');
      avi.lifecycle.onDeactivate((reason) => lifecycle.push(`handler:${reason}`));
      avi.events.on('message.updated', (event) => events.push(event));
      avi.events.on('thread.tasks.changed', (event) => conceptualEvents.push(event));
      avi.events.on('thread.work-status.changed', (event) => conceptualEvents.push(event));
      avi.events.on('semaphore.state.changed', (event) => conceptualEvents.push(event));
      avi.tools.register({ name: 'dynamic_tool' });
      avi.interceptors.tools.register({
        id: 'replace-input',
        priority: 10,
        beforeExecute({ input }) {
          return { action: 'replaceInput', input: { ...input, changed: true } };
        },
        afterExecute({ output }) {
          return { action: 'replaceOutput', output: `${output}:filtered` };
        },
      });
      await avi.storage.set('state', { ready: true });
    },
    async deactivate(reason) {
      lifecycle.push(`definition:${reason}`);
    },
  });

  assert.equal(api.plugin.id, 'runtime-test');
  assert.deepEqual(await api.storage.get('state'), { ready: true });
  assert.deepEqual(await api.storage.list(), ['state']);
  assert.equal(runtime.listTools().length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(root, '.avi-storage', 'runtime-test', 'storage.json'), 'utf8')), {
    state: { ready: true },
  });

  runtime.emitChatEvent({
    type: 'message',
    conversationId: 'thread-1',
    message: {
      id: 'message-1',
      conversationId: 'thread-1',
      content: 'secret',
      attachments: [{ id: 'file' }],
      segments: [{ type: 'reasoning', text: 'private' }],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.length, 1);
  assert.equal(events[0].threadId, 'thread-1');
  assert.equal(events[0].data.message.content, undefined);
  assert.equal(events[0].data.message.segments, undefined);

  runtime.emitChatEvent({
    type: 'tasks',
    conversationId: 'thread-1',
    tasks: [{
      title: 'Secret task',
      description: 'Private details',
      done: false,
      status: 'inconclusive',
      result: 'Private blocker',
    }],
  });
  runtime.emitChatEvent({
    type: 'block-state',
    conversationId: 'thread-1',
    blocked: true,
  });
  runtime.emitChatEvent({
    type: 'semaphore-state',
    waits: [],
    semaphores: [{
      name: 'deploy',
      maxCount: 1,
      waitingCount: 1,
      holders: [{ conversationId: 'thread-1', count: 1, blocked: 'Private blocker' }],
      queue: [{ conversationId: 'thread-2', position: 1 }],
    }],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(conceptualEvents.map((event) => event.type), [
    'thread.tasks.changed',
    'thread.work-status.changed',
    'semaphore.state.changed',
  ]);
  assert.deepEqual(conceptualEvents[0].data.tasks, [{ done: false, status: 'inconclusive' }]);
  assert.equal(conceptualEvents[1].data.blocked, true);
  assert.equal(conceptualEvents[2].data.semaphores[0].waitingCount, 1);
  assert.equal(conceptualEvents[2].data.semaphores[0].holders[0].blocked, true);

  const before = await runtime.beforeTool({
    tool: {
      name: 'demo',
      inputSchema: {
        type: 'object',
        properties: { changed: { type: 'boolean' } },
        required: ['changed'],
        additionalProperties: false,
      },
    },
    input: {},
  });
  assert.deepEqual(before, {
    input: { changed: true },
    requireApproval: true,
    inputChanged: true,
  });
  assert.equal(await runtime.afterTool({ tool: { name: 'demo' }, input: before.input, output: 'ok' }), 'ok:filtered');

  await assert.rejects(() => runtime.activate({
    id: 'activation-failure',
    capabilities: ['tools.register'],
    activate(avi) {
      avi.tools.register({ name: 'temporary' });
      throw new Error('activation exploded');
    },
  }), /activation exploded/);
  assert.equal(runtime.listTools().some((tool) => tool.name === 'temporary'), false);

  const restricted = await runtime.activate({ id: 'restricted', capabilities: [] });
  assert.throws(() => restricted.events.on('thread.created', () => {}), (error) => (
    error instanceof AviError && error.code === 'CAPABILITY_REQUIRED'
  ));
  assert.throws(() => restricted.storage.get('state'), (error) => (
    error instanceof AviError && error.code === 'CAPABILITY_REQUIRED'
  ));

  await runtime.deactivate('runtime-test', 'test');
  assert.deepEqual(lifecycle, ['handler:test', 'definition:test']);
  assert.equal(runtime.listTools().length, 0);
  assert.throws(() => api.storage.get('state'), (error) => (
    error instanceof AviError && error.code === 'DISPOSED'
  ));

  await runtime.deactivateAll('complete');
  assert.equal(runtime.records.size, 0);

  // --- Regression: P1 validateSchema keywords ---
  {
    const rt = new PluginRuntime({ pluginsDir: root });
    await rt.activate({ id: 'schema-test', capabilities: ['tools.register'], activate() {} });
    const tool = {
      name: 't',
      inputSchema: {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0, maximum: 150 },
          name: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[a-z]+$' },
          tags: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true },
          status: { const: 'active' },
          value: { type: ['string', 'null'] },
        },
        required: ['age', 'name'],
      },
    };
    const r = await rt.beforeTool({ tool, input: { age: 25, name: 'abc', tags: ['a'], status: 'active', value: null } });
    assert.equal(r.input.age, 25);
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: -1, name: 'abc' } }), (e) => e.message.includes('below minimum'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 200, name: 'abc' } }), (e) => e.message.includes('above maximum'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: '' } }), (e) => e.message.includes('below minLength'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: 'x'.repeat(51) } }), (e) => e.message.includes('exceeds maxLength'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: 'ABC' } }), (e) => e.message.includes('does not match pattern'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: 'abc', tags: [] } }), (e) => e.message.includes('fewer items than minItems'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: 'abc', tags: ['a', 'b', 'c', 'd'] } }), (e) => e.message.includes('more items than maxItems'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: 'abc', tags: ['a', 'a'] } }), (e) => e.message.includes('not unique'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: 'abc', status: 'inactive' } }), (e) => e.message.includes('must be the const value'));
    await assert.rejects(() => rt.beforeTool({ tool, input: { age: 25, name: 'abc', value: 42 } }), (e) => e.message.includes('does not match any allowed type'));
    await rt.deactivateAll('test');
  }

  // --- Regression: P1 event redaction ---
  {
    const rt = new PluginRuntime({ pluginsDir: root });
    const received = [];
    await rt.activate({
      id: 'redact-test',
      capabilities: ['events.subscribe'],
      activate(avi) { avi.events.on('*', (event) => received.push(event)); },
    });
    received.length = 0;
    rt.emit('test.input', { data: { input: { secret: true }, questions: [{ q: 'what?' }], invocationSummary: 'do stuff', workspacePath: 'C:/secret' } });
    rt.emit('test.snapshot', { data: { conversation: { id: 'c1', messages: ['m1'], content: 'hello', initialPrompt: 'secret', contextCheckpoint: 'secret', firstPrompt: 'secret', projectPath: 'C:/secret', goal: { specification: 'secret' } } } });
    rt.emit('test.error', { data: { error: { message: 'fail', stack: '...', details: { k: 'v' } } } });
    rt.emit('test.bot', { data: { bot: { id: 'b1', payload: { secret: true } }, log: { id: 'l1', payload: { secret: true } } } });
    rt.emit('inference.delta', { data: { event: { type: 'tool-call', name: 'run_in_terminal', argumentsText: '{"command":"secret"}' } } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(received.length, 5);
    assert.equal(received[0].data.input, undefined);
    assert.equal(received[0].data.questions, undefined);
    assert.equal(received[0].data.invocationSummary, undefined);
    assert.equal(received[0].data.workspacePath, undefined);
    assert.deepEqual(received[1].data.conversation, { id: 'c1' });
    assert.deepEqual(received[2].data.error, {});
    assert.equal(received[3].data.bot.payload, undefined);
    assert.equal(received[3].data.bot.id, 'b1');
    assert.equal(received[3].data.log.payload, undefined);
    assert.equal(received[3].data.log.id, 'l1');
    assert.deepEqual(received[4].data.event, { type: 'tool-call', name: 'run_in_terminal', redacted: true });
    await rt.deactivateAll('test');
  }

  // --- Regression: P1 storage queue recovery ---
  {
    const rt = new PluginRuntime({ pluginsDir: root });
    const api = await rt.activate({ id: 'queue-test', capabilities: ['storage'], activate() {} });
    await api.storage.set('a', 1);
    const circular = {};
    circular.self = circular;
    await assert.rejects(() => api.storage.set('b', circular));
    await api.storage.set('c', 3);
    assert.equal(await api.storage.get('a'), 1);
    assert.equal(await api.storage.get('c'), 3);
    await rt.deactivateAll('test');
  }

  // --- Regression: P1 storage SyntaxError throws AviError without overwrite ---
  {
    const rt = new PluginRuntime({ pluginsDir: root });
    const api = await rt.activate({ id: 'corrupt-test', capabilities: ['storage'], activate() {} });
    await api.storage.set('key', 'value');
    const storagePath = join(root, '.avi-storage', 'corrupt-test', 'storage.json');
    await writeFile(storagePath, '{bad json', 'utf8');
    await assert.rejects(() => api.storage.get('key'), (e) => e instanceof AviError && e.code === 'VALIDATION_FAILED' && e.message.includes('corrupted'));
    const after = await readFile(storagePath, 'utf8');
    assert.equal(after, '{bad json');
    await rt.deactivateAll('test');
  }

  // --- Regression: P2 createPluginDisposable awaits async dispose ---
  {
    let resolved = false;
    const d = createPluginDisposable(async () => { await new Promise((r) => setTimeout(r, 10)); resolved = true; });
    await d.dispose();
    assert.equal(resolved, true);
    assert.equal(d.disposed, true);
  }

  // --- Regression: P2 lifecycle assertActive ---
  {
    const rt = new PluginRuntime({ pluginsDir: root });
    const api = await rt.activate({ id: 'lifecycle-test', capabilities: [], activate() {} });
    await rt.deactivate('lifecycle-test', 'test');
    assert.throws(() => api.lifecycle.onDeactivate(() => {}), (e) => e instanceof AviError && e.code === 'DISPOSED');
    assert.throws(() => api.lifecycle.track({ dispose() {} }), (e) => e instanceof AviError && e.code === 'DISPOSED');
  }

  // --- Regression: P2 resource dispose with timeout ---
  {
    const rt = new PluginRuntime({ pluginsDir: root });
    await rt.activate({
      id: 'timeout-test',
      capabilities: [],
      activate(avi) { avi.lifecycle.track({ dispose() { return new Promise(() => {}); } }); },
    });
    const start = Date.now();
    await rt.deactivate('timeout-test', 'test');
    assert.ok(Date.now() - start < 10_000);
  }

  // --- Regression: P2 activation failure cleans up resources ---
  {
    const rt = new PluginRuntime({ pluginsDir: root });
    let disposed = false;
    await assert.rejects(() => rt.activate({
      id: 'fail-test',
      capabilities: [],
      activate(avi) {
        avi.lifecycle.track({ dispose() { disposed = true; } });
        throw new Error('boom');
      },
    }), /boom/);
    assert.equal(rt.records.size, 0);
    assert.equal(disposed, true);
  }

  console.log('Plugin API v2 runtime checks passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
