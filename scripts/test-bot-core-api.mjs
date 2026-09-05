import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';

const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const testRoot = join(tmpdir(), '.avi', 'visualizations', timestamp, 'bot-core-api');
mkdirSync(testRoot, { recursive: true });
const profile = mkdtempSync(join(testRoot, 'profile-'));
process.env.USERPROFILE = profile;

let database;
let runtime;
let server;
let socket;
try {
  database = await import('../src/main/database.js');
  const { BotManager } = await import('../src/main/bot-manager.js');
  const { PluginRuntime } = await import('../src/main/plugin-runtime.js');
  const { createPluginDomainApi } = await import('../src/main/plugin-domain-api.js');
  const requests = [];
  const manager = new BotManager();
  manager.attachChatRunner({
    runs: new Map(),
    async send(request) {
      requests.push(request);
      return { message: { id: `reply-${requests.length}` }, queued: true };
    },
  });
  runtime = new PluginRuntime({
    pluginsDir: join(profile, 'plugins'),
    services: {
      botManager: manager,
      createDomainApi: createPluginDomainApi,
    },
  });
  const avi = await runtime.activate({
    id: 'bot-core-test',
    capabilities: ['bots.read', 'bots.manage', 'bots.readState', 'bots.approvals.resolve'],
  });
  const handle = await avi.bots.create({
    name: 'Inbox test',
    model: 'test:model',
    workingFolder: join(profile, 'workspace'),
    enabled: false,
  });
  const bot = await handle.getSnapshot();
  assert.equal(handle.workState, undefined);
  assert.deepEqual(await handle.inbox.list(), []);
  assert.deepEqual(await handle.activity.list(), []);
  const tools = manager.getBotRuntimeContext(bot.conversationId).tools;
  const pending = await tools.find((tool) => tool.name === 'bot_pendency_create').execute({
    title: 'Choose export format',
    content: 'Should I export Acme invoices as CSV or JSON?',
  });
  const dataFolder = join(bot.workingFolder, '.avi-bots', bot.id);
  writeFileSync(join(dataFolder, 'activity.json'), '[{"legacy":true}]');
  assert.deepEqual((await manager.listBotDataByBot())[bot.id].errors, { inbox: null, activity: null });
  assert.equal(readFileSync(join(dataFolder, 'activity.json'), 'utf8'), '[{"legacy":true}]');
  writeFileSync(join(dataFolder, 'diary.json'), '{}');
  const partial = (await manager.listBotDataByBot())[bot.id];
  assert.equal(partial.inbox[0].id, pending.id);
  assert.deepEqual(partial.activity, []);
  assert.equal(partial.errors.inbox, null);
  assert.match(partial.errors.activity, /Invalid diary.json/);
  assert.match(partial.error, /^Activity: /);
  await assert.rejects(handle.inbox.list(), (error) => error.code === 'CONFLICT');
  writeFileSync(join(dataFolder, 'diary.json'), '[]');
  const savedInbox = readFileSync(join(dataFolder, 'inbox.json'), 'utf8');
  writeFileSync(join(dataFolder, 'inbox.json'), '{}');
  const invalidInbox = (await manager.listBotDataByBot())[bot.id];
  assert.match(invalidInbox.errors.inbox, /Invalid inbox.json/);
  assert.equal(invalidInbox.errors.activity, null);
  writeFileSync(join(dataFolder, 'inbox.json'), savedInbox);
  const listed = await handle.inbox.list();
  assert.equal(listed[0].id, pending.id);
  listed[0].messages[0].content = 'Changed snapshot';
  assert.equal((await handle.inbox.list())[0].messages[0].content, 'Should I export Acme invoices as CSV or JSON?');
  const attachments = [{ id: 'inline-note', kind: 'text_inline', name: 'notes.txt', text: 'Keep accents: ação.', size: 25, mime: 'text/plain' }];
  const replied = await handle.inbox.reply(pending.id, { content: 'Use CSV.', attachments });
  assert.equal(replied.delivered, true);
  assert.equal(replied.item.messages.at(-1).role, 'user');
  assert.equal(requests[0].conversationId, bot.conversationId);
  assert.equal(requests[0].queuePriority, true);
  assert.deepEqual(requests[0].attachments, attachments);
  assert.deepEqual(replied.item.messages.at(-1).attachments, attachments);
  assert.match(requests[0].text, /<bot-pendency-update /);
  assert.match(requests[0].text, /Use CSV/);
  assert.equal((await handle.inbox.complete(pending.id)).status, 'completed');

  await tools.find((tool) => tool.name === 'bot_activity_append').execute({
    title: 'I exported Acme invoices',
    description: 'I exported the approved invoices as CSV and verified their totals.',
    category: 'completed',
  });
  const activity = await handle.activity.list();
  assert.equal(activity.length, 1);
  assert.equal(activity[0].category, 'completed');

  const restrictedApi = await runtime.activate({
    id: 'bot-core-readonly',
    capabilities: ['bots.read', 'bots.readState'],
  });
  const restricted = await restrictedApi.bots.get(bot.id);
  assert.equal((await restricted.inbox.list()).length, 1);
  await assert.rejects(restricted.inbox.reply(pending.id, { content: 'No.' }), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(restricted.inbox.complete(pending.id), { code: 'CAPABILITY_REQUIRED' });
  const metadataApi = await runtime.activate({ id: 'bot-core-metadata', capabilities: ['bots.read'] });
  const metadata = await metadataApi.bots.get(bot.id);
  await assert.rejects(metadata.inbox.list(), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(metadata.activity.list(), { code: 'CAPABILITY_REQUIRED' });

  const approval = await manager.queueToolApproval({
    conversationId: bot.conversationId,
    toolName: 'publish_report',
    invocationSummary: 'Publish the Acme report',
    workspacePath: bot.workingFolder,
    input: { report: 'Acme' },
  });
  const approvalPendency = (await handle.inbox.list()).find((item) => item.approval?.id === approval.id);
  assert.ok(approvalPendency);
  await assert.rejects(handle.inbox.complete(approvalPendency.id), /approval/i);
  await assert.rejects(restricted.approvals.resolve(approval.id, true), { code: 'CAPABILITY_REQUIRED' });
  await assert.rejects(handle.approvals.resolve(approval.id, undefined), /decision|boolean/i);
  assert.equal(handle.approvals.list().length, 1);
  const another = await avi.bots.create({ name: 'Other bot', model: 'test:model', workingFolder: join(profile, 'other'), enabled: false });
  await assert.rejects(another.approvals.resolve(approval.id, true), { code: 'NOT_FOUND' });
  const resolved = await handle.approvals.resolve(approval.id, false);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.delivered, true);
  assert.equal(handle.approvals.list().length, 0);
  assert.match(requests.at(-1).text, /decision="denied"/);

  const { RemoteMcpServer } = await import('../src/main/remote-mcp-server.js');
  server = new RemoteMcpServer({
    subscribeChatEvents: () => () => {},
    getApiKeys: () => [{ value: 'bot-inbox-test-key', expiresAt: null }],
    invokeApplicationRequest: async (channel, payload) => {
      if (channel === 'bots:reply-pendency') return manager.replyToPendency(payload.botId, payload.pendencyId, payload);
      if (channel === 'bots:complete-pendency') return manager.completePendency(payload.botId, payload.pendencyId);
      throw new Error(`Unexpected test channel: ${channel}`);
    },
  });
  await server.start(0);
  socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`, { headers: { Authorization: 'Bearer bot-inbox-test-key' } });
  await once(socket, 'open');
  let requestId = 0;
  const rpc = async (method, params) => {
    const response = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }));
    const [data] = await response;
    const result = JSON.parse(data.toString());
    assert.equal(result.id, requestId);
    return result;
  };
  const discovery = await rpc('rpc:discover');
  assert.ok(discovery.result.methods.includes('bots:reply-pendency'));
  assert.ok(discovery.result.methods.includes('bots:complete-pendency'));
  assert.ok(!discovery.result.methods.includes('bots:update-work-item'));
  const rpcPending = await tools.find((tool) => tool.name === 'bot_pendency_create').execute({ title: 'Confirm export', content: 'Is the CSV format correct?' });
  const rpcReply = await rpc('bots:reply-pendency', { botId: bot.id, pendencyId: rpcPending.id, content: 'Correct.', attachments });
  assert.equal(rpcReply.error, undefined);
  assert.equal(rpcReply.result.delivered, true);
  assert.deepEqual(rpcReply.result.item.messages.at(-1).attachments, attachments);
  const rpcComplete = await rpc('bots:complete-pendency', { botId: bot.id, pendencyId: rpcPending.id });
  assert.equal(rpcComplete.result.status, 'completed');
  assert.equal((await rpc('bots:update-work-item', { botId: bot.id })).error.code, -32601);

  await handle.delete();
  await assert.rejects(handle.inbox.list(), { code: 'NOT_FOUND' });
  await assert.rejects(handle.activity.list(), { code: 'NOT_FOUND' });
  console.log('Bot Core API tests passed.');
} finally {
  socket?.terminate();
  await server?.close();
  for (const id of ['bot-core-test', 'bot-core-readonly', 'bot-core-metadata']) {
    await runtime?.deactivate(id, 'test-complete');
  }
  database?.closeDatabase();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(0);
