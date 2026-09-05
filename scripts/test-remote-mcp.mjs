import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-remote-mcp-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

const database = await import('../src/main/database.js');
const { RemoteMcpServer } = await import('../src/main/remote-mcp-server.js');
const apiKey = 'remote-test-key';
const secondApiKey = 'remote-second-key';
const expiredApiKey = 'remote-expired-key';
const rpcOperations = [];
const chatEventListeners = new Set();
const preferences = {
  lastModel: 'test:model',
  defaultModels: { subagents: { enabled: false } },
  tuning: { messageDeliveryMode: 'steer' },
};
let remoteBots = [{
  id: 'remote-bot',
  name: 'Remote bot',
  conversationId: 'remote-bot-thread',
  resolvedWorkingFolder: 'C:\\remote-bot',
  resolvedDataFolder: 'C:\\remote-bot\\.avi-bots\\remote-bot',
  model: 'test:model',
  reasoningEffort: 'low',
  contextSize: null,
  personality: null,
  instructions: 'Test remote bot management.',
  workQueue: [],
  workQueueIndex: 0,
  enabled: false,
  running: false,
  scheduleState: 'disabled',
  activationMode: 'smart',
  activationPeriodMinutes: 30,
  maxActivations: 1,
  activationWindow: null,
  activationWindowDescription: 'Any time',
  nextActivationAt: null,
  pendingApprovals: [],
  conversation: null,
}];
const botOperations = [];
const server = new RemoteMcpServer({
  chatRunner: {
    runs: new Map(),
    reloadSnapshot: () => ({
      conversationIds: ['rpc-thread'],
      runsStartedAt: {},
      approvals: [],
      questions: [],
      semaphoreWaits: [],
    }),
  },
  botManager: {
    describeBots: () => remoteBots,
    createBotFromConfig: async (config) => {
      const bot = {
        ...remoteBots[0],
        ...config,
        id: 'created-bot',
        conversationId: 'created-bot-thread',
      };
      remoteBots.push(bot);
      botOperations.push({ name: 'create', config });
      return bot;
    },
    updateBotConfig: async (id, changes) => {
      const bot = { ...remoteBots.find((item) => item.id === id), ...changes };
      remoteBots = remoteBots.map((item) => item.id === id ? bot : item);
      botOperations.push({ name: 'update', id, changes });
      return bot;
    },
    activateBot: async (id, options) => {
      botOperations.push({ name: 'activate', id, options });
      return true;
    },
    deleteBotById: async (id) => {
      remoteBots = remoteBots.filter((item) => item.id !== id);
      botOperations.push({ name: 'delete', id });
    },
  },
  providerRegistry: {
    listModels: () => [{
      id: 'test:model',
      name: 'Test model',
      reasoning: ['low', 'high'],
    }],
  },
  getPreferences: () => preferences,
  getApiKeys: () => [
    { value: apiKey, expiresAt: null },
    { value: secondApiKey, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    { value: expiredApiKey, expiresAt: new Date(Date.now() - 60_000).toISOString() },
  ],
  invokeApplicationRequest: async (channel, payload) => {
    rpcOperations.push({ channel, payload });
    if (['app:update-state', 'app:check-for-updates', 'app:install-update'].includes(channel)) {
      return { status: channel === 'app:install-update' ? 'installing' : 'available', available: true };
    }
    if (channel === 'conversations:list') return [{ id: 'rpc-thread' }];
    if (channel === 'conversations:messages') {
      const messages = [1, 2, 3].map((number) => ({ id: `message-${number}`, conversationId: 'rpc-thread' }));
      const end = payload.cursor
        ? messages.findIndex((message) => message.id === JSON.parse(Buffer.from(payload.cursor, 'base64url')).messageId)
        : messages.length;
      const start = Math.max(0, end - (payload.limit ?? 100));
      const page = messages.slice(start, end);
      return {
        messages: page,
        cursor: start > 0
          ? Buffer.from(JSON.stringify({ conversationId: payload.conversationId, messageId: page[0].id })).toString('base64url')
          : null,
        hasMore: start > 0,
      };
    }
    if (channel === 'conversations:tool-call-details') {
      return {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        segmentId: payload.segmentId,
        argumentsText: '{"path":"src/main.js"}',
        hasResult: true,
        resultText: 'file contents',
        mediaContent: [],
      };
    }
    if (channel === 'conversations:context') {
      return {
        conversation: { id: payload.conversationId },
        composer: {
          conversationId: payload.conversationId,
          permissionMode: 'approve_for_me',
          model: 'test:model',
          reasoningEffort: null,
          workMode: null,
          ultraMode: false,
          draftText: '',
          attachments: [],
        },
        contextUsage: { tokens: 1200, limit: 128000 },
      };
    }
    if (channel === 'mentions:list') return { paths: [], servers: [] };
    if (channel === 'context:commands') return [];
    if (channel === 'files:diff') return { filePath: payload.filePath, diff: '' };
    if (channel === 'attachments:read') {
      return {
        messageId: payload.messageId,
        attachmentId: payload.attachmentId,
        conversationId: payload.conversationId,
        offset: payload.offset ?? 0,
        data: '',
        hasMore: false,
      };
    }
    if (channel === 'chat:send') return { conversation: { id: payload.conversationId }, queued: false };
    if (channel === 'chat:stop') return true;
    if (channel === 'tags:list') return { tags: [{ id: 'review', name: 'Review', color: '#e3b341' }] };
    if (channel === 'tags:save') return { tags: payload.tags };
    throw new Error(`Test application error: ${channel}`);
  },
  resolveConversationProjectPath: (conversationId) => (
    conversationId === 'rpc-thread' ? 'C:\\rpc-project' : null
  ),
  subscribeChatEvents: (listener) => {
    chatEventListeners.add(listener);
    return () => chatEventListeners.delete(listener);
  },
});

await server.start(0);
const endpoint = `http://127.0.0.1:${server.port}/mcp`;
const pathEndpoint = `${endpoint}/${apiKey}`;
let failure = null;

try {
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
  assert.equal((await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer invalid' },
  })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/missing`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })).status, 404);

  assert.equal((await fetch(`${endpoint}/invalid`, { method: 'POST' })).status, 401);
  assert.notEqual((await fetch(pathEndpoint, { method: 'POST' })).status, 401);
  assert.notEqual((await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secondApiKey}` },
  })).status, 401);
  assert.equal((await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${expiredApiKey}` },
  })).status, 401);
  const hostWithoutPort = await fetch(pathEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      Host: '127.0.0.1',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'host-header-test', version: '1.0.0' },
      },
    }),
  });
  assert.notEqual(await hostWithoutPort.text(), '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host header: 127.0.0.1"},"id":null}');

  const jsonOnlyResponse = await fetch(pathEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'json-only-test', version: '1.0.0' },
      },
    }),
  });
  assert.equal(jsonOnlyResponse.status, 200);
  assert.match(jsonOnlyResponse.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal((await jsonOnlyResponse.json()).result.serverInfo.name, 'avi-remote');

  const client = new Client({ name: 'avi-remote-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(pathEndpoint));
  await client.connect(transport);

  const instructions = client.getInstructions();
  const mgmtInstructions = readFileSync(new URL('../src/prompts/mgmt-instructions.md', import.meta.url), 'utf8');
  assert.equal(instructions, mgmtInstructions);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [
      'bots_activate',
      'bots_create',
      'bots_delete',
      'bots_list',
      'bots_update',
      'chat_create_thread',
      'chat_inspect_thread',
      'chat_interrupt_thread',
      'chat_list_folders',
      'chat_list_threads',
      'chat_send_prompt',
    ],
  );
  const createThread = listed.tools.find((tool) => tool.name === 'chat_create_thread');
  assert.deepEqual(createThread.inputSchema.properties.model_name.enum, ['test:model']);
  assert.deepEqual(createThread.inputSchema.properties.reasoning_effort.enum, ['low', 'high']);
  assert.equal(createThread.inputSchema.properties.wait_for_response.type, 'boolean');

  preferences.defaultModels = {
    subagents: {
      enabled: true,
      small: { modelId: 'test:model', reasoningEffort: 'low' },
      medium: { modelId: 'test:model', reasoningEffort: 'low' },
      large: { modelId: 'test:model', reasoningEffort: 'high' },
    },
  };
  const levelTools = await client.listTools();
  const levelCreateThread = levelTools.tools.find((tool) => tool.name === 'chat_create_thread');
  assert.deepEqual(levelCreateThread.inputSchema.properties.model_level.enum, [
    'small',
    'medium',
    'large',
  ]);
  assert.ok(levelCreateThread.inputSchema.required.includes('model_level'));
  assert.equal(levelCreateThread.inputSchema.properties.model_name, undefined);
  assert.equal(levelCreateThread.inputSchema.properties.reasoning_effort, undefined);

  const result = await client.callTool({
    name: 'chat_list_threads',
    arguments: {},
  });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /^(Threads:|No threads found\.)/);

  const botResult = await client.callTool({
    name: 'bots_list',
    arguments: {},
  });
  assert.equal(botResult.isError, undefined);
  assert.deepEqual(botResult.content, []);
  assert.equal(botResult.structuredContent.bots[0].id, 'remote-bot');
  assert.equal(botResult.structuredContent.bots[0].name, 'Remote bot');

  const createdBot = await client.callTool({
    name: 'bots_create',
    arguments: { name: 'Created remotely', model: 'test:model', enabled: false },
  });
  assert.equal(createdBot.structuredContent.bot.id, 'created-bot');
  assert.equal(createdBot.structuredContent.bot.name, 'Created remotely');

  const updatedBot = await client.callTool({
    name: 'bots_update',
    arguments: { id: 'created-bot', changes: { name: 'Updated remotely' } },
  });
  assert.equal(updatedBot.structuredContent.bot.name, 'Updated remotely');

  const activatedBot = await client.callTool({
    name: 'bots_activate',
    arguments: { id: 'created-bot' },
  });
  assert.deepEqual(activatedBot.structuredContent, {
    id: 'created-bot',
    activated: true,
    status: 'started',
  });

  const deletedBot = await client.callTool({
    name: 'bots_delete',
    arguments: { id: 'created-bot' },
  });
  assert.deepEqual(deletedBot.structuredContent, { deleted: true, id: 'created-bot' });
  assert.deepEqual(botOperations.map((operation) => operation.name), [
    'create',
    'update',
    'activate',
    'delete',
  ]);
  await client.close();

  const rpcHttpEndpoint = `http://127.0.0.1:${server.port}/rpc`;
  assert.equal((await fetch(rpcHttpEndpoint, { method: 'POST' })).status, 426);
  const socketInboxes = new WeakMap();
  const openSocket = (path, key = apiKey, protocols = undefined) => new Promise((resolveSocket, rejectSocket) => {
    const options = key === null ? {} : { headers: { Authorization: `Bearer ${key}` } };
    const socket = protocols
      ? new WebSocket(`ws://127.0.0.1:${server.port}${path}`, protocols, options)
      : new WebSocket(`ws://127.0.0.1:${server.port}${path}`, options);
    const inbox = { messages: [], waiters: [] };
    socketInboxes.set(socket, inbox);
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const waiter = inbox.waiters.shift();
      if (waiter) waiter.resolve(message);
      else inbox.messages.push(message);
    });
    socket.once('open', () => resolveSocket(socket));
    socket.once('error', rejectSocket);
    // A socket may emit another error after its promise settled (for example 1009 during the
    // oversized-payload check); without a remaining listener that EventEmitter throw becomes a
    // silent uncaught exception under Electron and the run hangs without output.
    socket.on('error', () => {});
  });
  const nextSocketMessage = (socket) => {
    const inbox = socketInboxes.get(socket);
    if (inbox.messages.length > 0) return Promise.resolve(inbox.messages.shift());
    return new Promise((resolveMessage, rejectMessage) => {
      inbox.waiters.push({ resolve: resolveMessage, reject: rejectMessage });
      socket.once('error', rejectMessage);
    });
  };
  await assert.rejects(openSocket('/rpc', expiredApiKey));
  const browserProtocols = [
    'avi-rpc-v1',
    `avi-api-key.${Buffer.from(apiKey).toString('base64url')}`,
  ];
  const browserSocket = await openSocket('/rpc', null, browserProtocols);
  assert.equal(browserSocket.protocol, 'avi-rpc-v1');
  assert.equal(browserSocket.protocol.includes(Buffer.from(apiKey).toString('base64url')), false);
  browserSocket.close();
  await assert.rejects(openSocket('/rpc', null, [
    'avi-rpc-v1',
    `avi-api-key.${Buffer.from('invalid').toString('base64url')}`,
  ]));
  await assert.rejects(openSocket('/rpc', null, [
    'avi-rpc-v1',
    `avi-api-key.${Buffer.from(expiredApiKey).toString('base64url')}`,
  ]));
  await assert.rejects(openSocket('/rpc', null, [
    `avi-api-key.${Buffer.from(apiKey).toString('base64url')}`,
  ]));

  const globalSocket = await openSocket('/rpc');
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'rpc:discover' }));
  const globalDiscovery = await nextSocketMessage(globalSocket);
  assert.equal(globalDiscovery.result.appVersion, '0.5.0');
  assert.deepEqual(globalDiscovery.result.versions, {
    core: 2,
    rpc: 1,
    mcp: {
      latest: '2025-11-25',
      supported: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'],
    },
  });
  assert.equal(globalDiscovery.result.scope, 'global');
  assert.deepEqual(globalDiscovery.result.capabilities, [
    'batch', 'notifications', 'models', 'folders', 'conversations', 'bots', 'sidebar-status', 'tags', 'app-updates',
  ]);
  assert.deepEqual(globalDiscovery.result.methods, [
    'app:check-for-updates', 'app:install-update', 'app:update-state',
    'bots:activate', 'bots:clear-thread', 'bots:complete-pendency', 'bots:create', 'bots:delete', 'bots:full-reset',
    'bots:list', 'bots:reply-pendency', 'bots:resolve-approval', 'bots:snooze', 'bots:snooze-one', 'bots:update',
    'conversations:archive', 'conversations:create', 'conversations:delete',
    'conversations:fork', 'conversations:list', 'conversations:search', 'conversations:set-tags',
    'conversations:update', 'folders:list', 'folders:save-color', 'folders:threads', 'models:list',
    'remote:state', 'rpc:discover', 'rubber-ducks:list', 'side-chats:close', 'side-chats:create', 'side-chats:list',
    'sidebar:mark-seen', 'sidebar:status', 'subagents:list', 'tags:list', 'tags:save',
    'workspaces:get', 'workspaces:save',
  ]);
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'models:list' }));
  assert.deepEqual((await nextSocketMessage(globalSocket)).result, {
    models: [{
      id: 'test:model',
      name: 'Test model',
      reasoning: ['low', 'high'],
    }],
    lastModel: 'test:model',
    defaultModels: preferences.defaultModels,
    messageDeliveryMode: 'steer',
  });
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'conversations:list' }));
  assert.deepEqual(await nextSocketMessage(globalSocket), {
    jsonrpc: '2.0',
    id: 10,
    result: [{ id: 'rpc-thread' }],
  });
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tags:list' }));
  assert.deepEqual(await nextSocketMessage(globalSocket), {
    jsonrpc: '2.0',
    id: 30,
    result: { tags: [{ id: 'review', name: 'Review', color: '#e3b341' }] },
  });
  globalSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 31,
    method: 'tags:save',
    params: { tags: [{ id: 'kept', name: 'Kept', color: '#FFAA00' }] },
  }));
  assert.deepEqual(await nextSocketMessage(globalSocket), {
    jsonrpc: '2.0',
    id: 31,
    result: { tags: [{ id: 'kept', name: 'Kept', color: '#FFAA00' }] },
  });
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 32, method: 'sidebar:status' }));
  assert.deepEqual(await nextSocketMessage(globalSocket), {
    jsonrpc: '2.0',
    id: 32,
    result: {
      runningConversationIds: ['rpc-thread'],
      approvalPendingConversationIds: [],
      inputPendingConversationIds: [],
      semaphoreWaitingConversationIds: [],
      completedUnseenConversationIds: [],
    },
  });
  globalSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 33,
    method: 'sidebar:mark-seen',
    params: { conversationId: 'rpc-thread' },
  }));
  assert.deepEqual(await nextSocketMessage(globalSocket), {
    jsonrpc: '2.0',
    id: 33,
    result: { completedUnseenConversationIds: [] },
  });
  globalSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 34,
    method: 'sidebar:mark-seen',
    params: {},
  }));
  assert.match((await nextSocketMessage(globalSocket)).error.data.message, /^sidebar:mark-seen requires/);
  for (const listener of chatEventListeners) {
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: false });
  }
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 35, method: 'sidebar:status' }));
  assert.deepEqual(
    (await nextSocketMessage(globalSocket)).result.completedUnseenConversationIds,
    ['tracker-thread'],
  );
  for (const listener of chatEventListeners) {
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: true });
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: false, sleeping: true });
  }
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 36, method: 'sidebar:status' }));
  assert.deepEqual((await nextSocketMessage(globalSocket)).result.completedUnseenConversationIds, []);
  for (const listener of chatEventListeners) {
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: false });
  }
  globalSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 37,
    method: 'sidebar:mark-seen',
    params: { conversationId: 'tracker-thread' },
  }));
  assert.deepEqual(await nextSocketMessage(globalSocket), {
    jsonrpc: '2.0',
    id: 37,
    result: { completedUnseenConversationIds: [] },
  });
  globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'chat:stop' }));
  assert.deepEqual(await nextSocketMessage(globalSocket), {
    jsonrpc: '2.0',
    id: 11,
    error: { code: -32601, message: 'Method not found' },
  });
  globalSocket.send(JSON.stringify([
    { jsonrpc: '2.0', method: 'conversations:list' },
    { jsonrpc: '2.0', id: 15, method: 'conversations:list' },
    { jsonrpc: '2.0', id: 16, method: 'unknown:method' },
  ]));
  assert.deepEqual(await nextSocketMessage(globalSocket), [
    { jsonrpc: '2.0', id: 15, result: [{ id: 'rpc-thread' }] },
    { jsonrpc: '2.0', id: 16, error: { code: -32601, message: 'Method not found' } },
  ]);

  const oversizedSocket = await openSocket('/rpc');
  const oversizedClose = new Promise((resolveClose) => oversizedSocket.once('close', resolveClose));
  oversizedSocket.send('x'.repeat(1024 * 1024 + 1));
  assert.equal(await oversizedClose, 1009);

  const streamSocket = await openSocket('/rpc/conversations/streams/rpc-thread');
  assert.deepEqual(await nextSocketMessage(streamSocket), {
    jsonrpc: '2.0',
    method: 'conversation:ready',
    params: {
      sequence: 0,
      conversationId: 'rpc-thread',
      recoveryMethod: 'conversations:context',
    },
  });
  streamSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'rpc:discover' }));
  const conversationDiscovery = (await nextSocketMessage(streamSocket)).result;
  assert.equal(conversationDiscovery.scope, 'conversation');
  assert.ok(conversationDiscovery.methods.includes('conversations:tool-call-details'));
  assert.ok(conversationDiscovery.capabilities.includes('tool-call-details'));
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 18,
    method: 'conversations:messages',
    params: { limit: 2 },
  }));
  const firstMessagePage = (await nextSocketMessage(streamSocket)).result;
  assert.deepEqual(firstMessagePage.messages.map((message) => message.id), ['message-2', 'message-3']);
  assert.equal(firstMessagePage.hasMore, true);
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 19,
    method: 'conversations:messages',
    params: { limit: 2, cursor: firstMessagePage.cursor },
  }));
  assert.deepEqual((await nextSocketMessage(streamSocket)).result, {
    messages: [{ id: 'message-1', conversationId: 'rpc-thread' }],
    cursor: null,
    hasMore: false,
  });
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 26,
    method: 'conversations:context',
    params: { limit: 2 },
  }));
  assert.deepEqual((await nextSocketMessage(streamSocket)).result, {
    conversation: { id: 'rpc-thread' },
    composer: {
      conversationId: 'rpc-thread',
      permissionMode: 'approve_for_me',
      model: 'test:model',
      reasoningEffort: null,
      workMode: null,
      ultraMode: false,
      draftText: '',
      attachments: [],
    },
    contextUsage: { tokens: 1200, limit: 128000 },
  });
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 27,
    method: 'conversations:messages',
    params: { bogus: 1 },
  }));
  assert.match(
    (await nextSocketMessage(streamSocket)).error.data.message,
    /^Unsupported pagination parameter: bogus\.$/,
  );
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 28,
    method: 'conversations:tool-call-details',
    params: { messageId: 'message-3', segmentId: 'tool-call-1' },
  }));
  assert.deepEqual((await nextSocketMessage(streamSocket)).result, {
    conversationId: 'rpc-thread',
    messageId: 'message-3',
    segmentId: 'tool-call-1',
    argumentsText: '{"path":"src/main.js"}',
    hasResult: true,
    resultText: 'file contents',
    mediaContent: [],
  });
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 29,
    method: 'conversations:tool-call-details',
    params: { messageId: 'message-3', segmentId: 'tool-call-1', path: 'C:\\Windows\\win.ini' },
  }));
  assert.match(
    (await nextSocketMessage(streamSocket)).error.data.message,
    /^Unsupported tool-call-details parameter: path\.$/,
  );
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 20,
    method: 'mentions:list',
    params: { query: 'src', folderPath: 'C:\\foreign' },
  }));
  assert.deepEqual((await nextSocketMessage(streamSocket)).result, { paths: [], servers: [] });
  streamSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'context:commands' }));
  assert.deepEqual((await nextSocketMessage(streamSocket)).result, []);
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 22,
    method: 'files:diff',
    params: { filePath: 'src/main.js', folderPath: 'C:\\foreign' },
  }));
  assert.deepEqual((await nextSocketMessage(streamSocket)).result, {
    filePath: 'src/main.js',
    diff: '',
  });
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 23,
    method: 'attachments:read',
    params: { messageId: 'message-3', attachmentId: 'attachment-1', offset: 4 },
  }));
  assert.deepEqual((await nextSocketMessage(streamSocket)).result, {
    messageId: 'message-3',
    attachmentId: 'attachment-1',
    conversationId: 'rpc-thread',
    offset: 4,
    data: '',
    hasMore: false,
  });
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 24,
    method: 'attachments:read',
    params: { messageId: 'message-3', attachmentId: 'attachment-1', path: 'C:\\Windows\\win.ini' },
  }));
  assert.match(
    (await nextSocketMessage(streamSocket)).error.data.message,
    /^Unsupported attachments:read parameter: path\.$/,
  );
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 12,
    method: 'chat:send',
    params: { model: 'test:model', text: 'Plan this', workMode: 'plan', attachments: [] },
  }));
  assert.deepEqual(await nextSocketMessage(streamSocket), {
    jsonrpc: '2.0',
    id: 12,
    result: { conversation: { id: 'rpc-thread' }, queued: false },
  });
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 13,
    method: 'chat:stop',
  }));
  assert.deepEqual(await nextSocketMessage(streamSocket), { jsonrpc: '2.0', id: 13, result: true });
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 14,
    method: 'chat:send',
    params: { conversationId: 'other-thread', model: 'test:model', text: 'Wrong thread' },
  }));
  assert.equal((await nextSocketMessage(streamSocket)).error.data.message, 'The conversationId does not match the WebSocket conversation.');
  streamSocket.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 17,
    method: 'chat:send',
    params: { model: 'test:model', text: 'Wrong goal', goalId: 'foreign-goal' },
  }));
  assert.equal(
    (await nextSocketMessage(streamSocket)).error.data.message,
    'Set workMode to goal or use goals:start instead of supplying goalId.',
  );
  for (const [index, method] of ['tags:list', 'tags:save', 'sidebar:status', 'sidebar:mark-seen'].entries()) {
    streamSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 40 + index, method }));
    assert.deepEqual(await nextSocketMessage(streamSocket), {
      jsonrpc: '2.0',
      id: 40 + index,
      error: { code: -32601, message: 'Method not found' },
    });
  }

  const streamedEvent = nextSocketMessage(streamSocket);
  for (const listener of chatEventListeners) {
    listener({ type: 'message', conversationId: 'other-thread', message: { id: 'ignored' } });
    listener({ type: 'message', conversationId: 'rpc-thread', message: { id: 'streamed' } });
  }
  assert.deepEqual(await streamedEvent, {
    jsonrpc: '2.0',
    method: 'conversation:event',
    params: {
      sequence: 1,
      conversationId: 'rpc-thread',
      event: { type: 'message', conversationId: 'rpc-thread', message: { id: 'streamed' } },
    },
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  assert.deepEqual(socketInboxes.get(globalSocket).messages, []);
  assert.deepEqual(rpcOperations, [
    { channel: 'conversations:list', payload: undefined },
    { channel: 'tags:list', payload: undefined },
    { channel: 'tags:save', payload: { tags: [{ id: 'kept', name: 'Kept', color: '#FFAA00' }] } },
    { channel: 'conversations:list', payload: undefined },
    { channel: 'conversations:list', payload: undefined },
    { channel: 'conversations:messages', payload: { limit: 2, cursor: undefined, conversationId: 'rpc-thread' } },
    {
      channel: 'conversations:messages',
      payload: { limit: 2, cursor: firstMessagePage.cursor, conversationId: 'rpc-thread' },
    },
    { channel: 'conversations:context', payload: { limit: 2, cursor: undefined, conversationId: 'rpc-thread' } },
    {
      channel: 'conversations:tool-call-details',
      payload: { messageId: 'message-3', segmentId: 'tool-call-1', conversationId: 'rpc-thread' },
    },
    { channel: 'mentions:list', payload: { query: 'src', folderPath: 'C:\\rpc-project' } },
    { channel: 'context:commands', payload: 'C:\\rpc-project' },
    { channel: 'files:diff', payload: { filePath: 'src/main.js', folderPath: 'C:\\rpc-project' } },
    {
      channel: 'attachments:read',
      payload: {
        messageId: 'message-3',
        attachmentId: 'attachment-1',
        offset: 4,
        limit: undefined,
        conversationId: 'rpc-thread',
      },
    },
    {
      channel: 'chat:send',
      payload: {
        model: 'test:model',
        text: 'Plan this',
        workMode: 'plan',
        attachments: [],
        conversationId: 'rpc-thread',
      },
    },
    { channel: 'chat:stop', payload: 'rpc-thread' },
  ]);
  for (const method of ['app:update-state', 'app:check-for-updates', 'app:install-update']) {
    globalSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 90, method }));
    assert.deepEqual((await nextSocketMessage(globalSocket)).result, {
      status: method === 'app:install-update' ? 'installing' : 'available', available: true,
    });
    assert.deepEqual(rpcOperations.at(-1), { channel: method, payload: undefined });
    streamSocket.send(JSON.stringify({ jsonrpc: '2.0', id: 91, method }));
    assert.equal((await nextSocketMessage(streamSocket)).error.code, -32601);
  }
  globalSocket.close();
  streamSocket.close();

  const occupied = createServer((_request, response) => response.end('occupied'));
  await new Promise((resolveListen) => occupied.listen(0, '127.0.0.1', resolveListen));
  try {
    await assert.rejects(server.start(occupied.address().port));
    assert.equal(String(server.port), new URL(endpoint).port);
    const restoredStatus = await new Promise((resolveRequest, rejectRequest) => {
      const restoredRequest = request(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        agent: false,
      }, (response) => {
        response.resume();
        response.once('end', () => resolveRequest(response.statusCode));
      });
      restoredRequest.once('error', rejectRequest);
      restoredRequest.end();
    });
    assert.notEqual(restoredStatus, 401);
  } finally {
    await new Promise((resolveClose, rejectClose) => occupied.close((error) => (
      error ? rejectClose(error) : resolveClose()
    )));
  }

  console.log('Remote MCP tests passed.');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await server.close();
  database.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(failure ? 1 : 0);
