import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import { OrpcPeer, ORPC_LIMITS, ORPC_PROTOCOL, requestFrame } from '../src/shared/orpc.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
    if (channel === 'context:commands') return [
      { id: 'workflow:side', type: 'interceptor', name: 'side' },
      { id: 'workflow:quick-compress', type: 'interceptor', name: 'quick-compress' },
      { id: 'workflow:optimize-prompt', type: 'interceptor', name: 'optimize-prompt' },
      { id: 'workflow:future-action', type: 'interceptor', name: 'future-action' },
      { id: 'workflow:review', type: 'workflow', name: 'review' },
      { id: 'skill:side', type: 'skill', name: 'side' },
    ];
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
      'bots_read_work_log',
      'bots_send_work_log_message',
      'bots_update',
      'chat_create_thread',
      'chat_inspect_thread',
      'chat_interrupt_thread',
      'chat_list_folders',
      'chat_list_threads',
      'chat_overview',
      'chat_send_prompt',
      'note_create',
      'note_edit',
      'note_lists',
      'note_search',
    ],
  );
  assert.equal(listed.tools.find((tool) => tool.name === 'note_create').annotations.readOnlyHint, false);
  assert.equal(listed.tools.find((tool) => tool.name === 'note_search').annotations.readOnlyHint, true);
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
  const openSocket = (path, key = apiKey, protocols = [ORPC_PROTOCOL]) => new Promise((resolveSocket, rejectSocket) => {
    const options = key === null ? {} : { headers: { Authorization: `Bearer ${key}` } };
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, protocols, options);
    const inbox = { events: [], waiters: [] };
    socketInboxes.set(socket, { peer: null, inbox });
    const peer = new OrpcPeer({
      send: (frame) => socket.send(Buffer.from(frame)),
      isOpen: () => socket.readyState === WebSocket.OPEN,
      bufferedAmount: () => socket.bufferedAmount,
      onRequest: (method, content) => {
        const event = { method: method.replace('.', ':'), ...JSON.parse(textDecoder.decode(content)) };
        const waiter = inbox.waiters.shift();
        if (waiter) waiter.resolve(event);
        else inbox.events.push(event);
        return textEncoder.encode('OK');
      },
    });
    socketInboxes.get(socket).peer = peer;
    socket.on('message', (data, isBinary) => {
      if (isBinary) peer.receive(new Uint8Array(data));
    });
    socket.once('open', () => resolveSocket(socket));
    socket.once('error', rejectSocket);
    // A socket may emit another error after its promise settled (for example 1009 during the
    // oversized-payload check); without a remaining listener that EventEmitter throw becomes a
    // silent uncaught exception under Electron and the run hangs without output.
    socket.on('error', () => {});
  });
  const closeSocket = (socket) => new Promise((resolveClose) => {
    socket.once('close', resolveClose);
    socket.close();
  });
  const callRpcRaw = (socket, method, contentBytes) => socketInboxes.get(socket).peer
    .call(method.replace(':', '.'), contentBytes)
    .then((bytes) => JSON.parse(textDecoder.decode(bytes)));
  const callRpc = (socket, method, params, { operationId = crypto.randomUUID(), expiresAt = Date.now() + 60_000 } = {}) => callRpcRaw(
    socket,
    method,
    textEncoder.encode(JSON.stringify({ operationId, expiresAt, params })),
  );
  const nextSocketEvent = (socket) => {
    const { inbox } = socketInboxes.get(socket);
    if (inbox.events.length > 0) return Promise.resolve(inbox.events.shift());
    return new Promise((resolveEvent) => inbox.waiters.push({ resolve: resolveEvent }));
  };
  await assert.rejects(openSocket('/rpc', expiredApiKey));
  // The avi-orpc-draft1 subprotocol is mandatory even when the Authorization header carries the key.
  await assert.rejects(openSocket('/rpc', apiKey, []));
  const browserProtocols = [
    ORPC_PROTOCOL,
    `avi-api-key.${Buffer.from(apiKey).toString('base64url')}`,
  ];
  const browserSocket = await openSocket('/rpc', null, browserProtocols);
  assert.equal(browserSocket.protocol, ORPC_PROTOCOL);
  assert.equal(browserSocket.protocol.includes(Buffer.from(apiKey).toString('base64url')), false);
  await closeSocket(browserSocket);
  await assert.rejects(openSocket('/rpc', null, [
    ORPC_PROTOCOL,
    `avi-api-key.${Buffer.from('invalid').toString('base64url')}`,
  ]));
  await assert.rejects(openSocket('/rpc', null, [
    ORPC_PROTOCOL,
    `avi-api-key.${Buffer.from(expiredApiKey).toString('base64url')}`,
  ]));
  await assert.rejects(openSocket('/rpc', null, [
    `avi-api-key.${Buffer.from(apiKey).toString('base64url')}`,
  ]));

  const globalSocket = await openSocket('/rpc');
  const globalDiscovery = (await callRpc(globalSocket, 'rpc:discover')).result;
  assert.equal(globalDiscovery.appVersion, '0.6.0');
  assert.deepEqual(globalDiscovery.versions, {
    core: 2,
    rpc: 1,
    mcp: {
      latest: '2025-11-25',
      supported: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'],
    },
  });
  assert.deepEqual(globalDiscovery.transport, {
    protocol: ORPC_PROTOCOL,
    framing: 'complete-frame',
    limits: ORPC_LIMITS,
  });
  assert.equal(globalDiscovery.scope, 'global');
  assert.deepEqual(globalDiscovery.capabilities, [
    'acknowledged-events', 'models', 'folders', 'conversations', 'bots', 'sidebar-status', 'tags', 'app-updates', 'notes',
  ]);
  assert.deepEqual(globalDiscovery.methods, [
    'app:check-for-updates', 'app:install-update', 'app:update-state',
    'bots:activate', 'bots:clear-thread', 'bots:complete-pendency', 'bots:create', 'bots:delete', 'bots:full-reset',
    'bots:list', 'bots:reply-pendency', 'bots:resolve-approval', 'bots:snooze', 'bots:snooze-one', 'bots:update',
    'conversations:archive', 'conversations:create', 'conversations:delete',
    'conversations:fork', 'conversations:list', 'conversations:search', 'conversations:set-tags',
    'conversations:update', 'folders:list', 'folders:save-color', 'folders:threads', 'models:list',
    'notes:add-attachment', 'notes:delete-list', 'notes:generate', 'notes:get', 'notes:lists', 'notes:read-attachment',
    'notes:reorder', 'notes:save', 'notes:save-list', 'notes:search', 'notes:upload-attachment',
    'remote:state', 'rpc:discover', 'rubber-ducks:list', 'shortcuts:list', 'shortcuts:save',
    'side-chats:close', 'side-chats:create', 'side-chats:list',
    'sidebar:mark-seen', 'sidebar:status', 'subagents:list', 'tags:list', 'tags:save',
    'workspaces:get', 'workspaces:save',
  ]);
  assert.deepEqual((await callRpc(globalSocket, 'models:list')).result, {
    models: [{
      id: 'test:model',
      name: 'Test model',
      reasoning: ['low', 'high'],
    }],
    lastModel: 'test:model',
    defaultModels: preferences.defaultModels,
    messageDeliveryMode: 'steer',
  });
  assert.deepEqual((await callRpc(globalSocket, 'conversations:list')).result, [{ id: 'rpc-thread' }]);
  assert.deepEqual((await callRpc(globalSocket, 'tags:list')).result, {
    tags: [{ id: 'review', name: 'Review', color: '#e3b341' }],
  });
  assert.deepEqual((await callRpc(globalSocket, 'tags:save', { tags: [{ id: 'kept', name: 'Kept', color: '#FFAA00' }] })).result, {
    tags: [{ id: 'kept', name: 'Kept', color: '#FFAA00' }],
  });
  assert.deepEqual((await callRpc(globalSocket, 'sidebar:status')).result, {
    runningConversationIds: ['rpc-thread'],
    approvalPendingConversationIds: [],
    inputPendingConversationIds: [],
    semaphoreWaitingConversationIds: [],
    completedUnseenConversationIds: [],
  });
  assert.deepEqual((await callRpc(globalSocket, 'sidebar:mark-seen', { conversationId: 'rpc-thread' })).result, {
    completedUnseenConversationIds: [],
  });
  assert.match((await callRpc(globalSocket, 'sidebar:mark-seen', {})).error.data.message, /^sidebar:mark-seen requires/);
  for (const listener of chatEventListeners) {
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: false });
  }
  assert.deepEqual(
    (await callRpc(globalSocket, 'sidebar:status')).result.completedUnseenConversationIds,
    ['tracker-thread'],
  );
  for (const listener of chatEventListeners) {
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: true });
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: false, sleeping: true });
  }
  assert.deepEqual((await callRpc(globalSocket, 'sidebar:status')).result.completedUnseenConversationIds, []);
  for (const listener of chatEventListeners) {
    listener({ type: 'run-state', conversationId: 'tracker-thread', running: false });
  }
  assert.deepEqual((await callRpc(globalSocket, 'sidebar:mark-seen', { conversationId: 'tracker-thread' })).result, {
    completedUnseenConversationIds: [],
  });
  assert.deepEqual(await callRpc(globalSocket, 'chat:stop'), {
    error: { code: -32601, message: 'Method not found' },
  });

  const textFrameSocket = await openSocket('/rpc');
  const textFrameClose = new Promise((resolveClose) => textFrameSocket.once('close', resolveClose));
  textFrameSocket.send('x');
  assert.equal(await textFrameClose, 1002, 'text frames must close the socket because ORPC requires binary messages');

  const oversizedSocket = await openSocket('/rpc');
  const oversizedClose = new Promise((resolveClose) => oversizedSocket.once('close', resolveClose));
  oversizedSocket.send(Buffer.alloc(1024 * 1024 + 1));
  assert.equal(await oversizedClose, 1009);

  const streamSocket = await openSocket('/rpc/conversations/streams/rpc-thread');
  const readyEvent = await nextSocketEvent(streamSocket);
  assert.ok(/^[A-Za-z0-9_-]{16,64}$/.test(readyEvent.eventId), 'server events must carry an event id');
  assert.ok(Number.isSafeInteger(readyEvent.expiresAt) && readyEvent.expiresAt > Date.now(), 'server events must carry a future deadline');
  assert.deepEqual(readyEvent.params, {
    sequence: 0,
    conversationId: 'rpc-thread',
    recoveryMethod: 'conversations:context',
  });
  const conversationDiscovery = (await callRpc(streamSocket, 'rpc:discover')).result;
  assert.equal(conversationDiscovery.scope, 'conversation');
  assert.ok(conversationDiscovery.methods.includes('conversations:tool-call-details'));
  assert.ok(conversationDiscovery.capabilities.includes('acknowledged-events'));
  assert.ok(conversationDiscovery.capabilities.includes('tool-call-details'));
  const firstMessagePage = (await callRpc(streamSocket, 'conversations:messages', { limit: 2 })).result;
  assert.deepEqual(firstMessagePage.messages.map((message) => message.id), ['message-2', 'message-3']);
  assert.equal(firstMessagePage.hasMore, true);
  assert.deepEqual((await callRpc(streamSocket, 'conversations:messages', { limit: 2, cursor: firstMessagePage.cursor })).result, {
    messages: [{ id: 'message-1', conversationId: 'rpc-thread' }],
    cursor: null,
    hasMore: false,
  });
  assert.deepEqual((await callRpc(streamSocket, 'conversations:context', { limit: 2 })).result, {
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
  assert.match(
    (await callRpc(streamSocket, 'conversations:messages', { bogus: 1 })).error.data.message,
    /^Unsupported pagination parameter: bogus\.$/,
  );
  assert.deepEqual((await callRpc(streamSocket, 'conversations:tool-call-details', { messageId: 'message-3', segmentId: 'tool-call-1' })).result, {
    conversationId: 'rpc-thread',
    messageId: 'message-3',
    segmentId: 'tool-call-1',
    argumentsText: '{"path":"src/main.js"}',
    hasResult: true,
    resultText: 'file contents',
    mediaContent: [],
  });
  assert.match(
    (await callRpc(streamSocket, 'conversations:tool-call-details', { messageId: 'message-3', segmentId: 'tool-call-1', path: 'C:\\Windows\\win.ini' })).error.data.message,
    /^Unsupported tool-call-details parameter: path\.$/,
  );
  assert.deepEqual((await callRpc(streamSocket, 'mentions:list', { query: 'src', folderPath: 'C:\\foreign' })).result, { paths: [], servers: [] });
  assert.deepEqual((await callRpc(streamSocket, 'context:commands')).result, [
    { id: 'workflow:review', type: 'workflow', name: 'review' },
    { id: 'skill:side', type: 'skill', name: 'side' },
  ]);
  assert.deepEqual((await callRpc(streamSocket, 'files:diff', { filePath: 'src/main.js', folderPath: 'C:\\foreign' })).result, {
    filePath: 'src/main.js',
    diff: '',
  });
  assert.deepEqual((await callRpc(streamSocket, 'attachments:read', { messageId: 'message-3', attachmentId: 'attachment-1', offset: 4 })).result, {
    messageId: 'message-3',
    attachmentId: 'attachment-1',
    conversationId: 'rpc-thread',
    offset: 4,
    data: '',
    hasMore: false,
  });
  assert.match(
    (await callRpc(streamSocket, 'attachments:read', { messageId: 'message-3', attachmentId: 'attachment-1', path: 'C:\\Windows\\win.ini' })).error.data.message,
    /^Unsupported attachments:read parameter: path\.$/,
  );
  assert.deepEqual((await callRpc(streamSocket, 'chat:send', { model: 'test:model', text: 'Plan this', workMode: 'plan', attachments: [] })).result, {
    conversation: { id: 'rpc-thread' },
    queued: false,
  });
  assert.deepEqual(await callRpc(streamSocket, 'chat:stop'), { result: true });
  assert.equal(
    (await callRpc(streamSocket, 'chat:send', { conversationId: 'other-thread', model: 'test:model', text: 'Wrong thread' })).error.data.message,
    'The conversationId does not match the WebSocket conversation.',
  );
  assert.equal(
    (await callRpc(streamSocket, 'chat:send', { model: 'test:model', text: 'Wrong goal', goalId: 'foreign-goal' })).error.data.message,
    'Set workMode to goal or use goals:start instead of supplying goalId.',
  );
  for (const method of ['tags:list', 'tags:save', 'sidebar:status', 'sidebar:mark-seen']) {
    assert.deepEqual(await callRpc(streamSocket, method), {
      error: { code: -32601, message: 'Method not found' },
    });
  }

  const streamedEvent = nextSocketEvent(streamSocket);
  for (const listener of chatEventListeners) {
    listener({ type: 'message', conversationId: 'other-thread', message: { id: 'ignored' } });
    listener({ type: 'message', conversationId: 'rpc-thread', message: { id: 'streamed' } });
  }
  const streamed = await streamedEvent;
  assert.equal(streamed.method, 'conversation:event');
  assert.deepEqual(streamed.params, {
    sequence: 1,
    conversationId: 'rpc-thread',
    event: { type: 'message', conversationId: 'rpc-thread', message: { id: 'streamed' } },
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  assert.equal(socketInboxes.get(globalSocket).inbox.events.length, 0, 'global sockets must not receive conversation events');
  assert.deepEqual(rpcOperations, [
    { channel: 'conversations:list', payload: undefined },
    { channel: 'tags:list', payload: undefined },
    { channel: 'tags:save', payload: { tags: [{ id: 'kept', name: 'Kept', color: '#FFAA00' }] } },
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
    assert.deepEqual((await callRpc(globalSocket, method)).result, {
      status: method === 'app:install-update' ? 'installing' : 'available', available: true,
    });
    assert.deepEqual(rpcOperations.at(-1), { channel: method, payload: undefined });
    assert.equal((await callRpc(streamSocket, method)).error.code, -32601);
  }

  assert.equal(
    (await callRpcRaw(globalSocket, 'rpc.discover', textEncoder.encode('{broken'))).error.code,
    -32700,
  );
  const dispatchBeforeTokens = rpcOperations.length;
  assert.equal(
    (await callRpcRaw(globalSocket, 'rpc.discover', textEncoder.encode(JSON.stringify({ operationId: 'short-token', expiresAt: Date.now() + 60_000 })))).error.message,
    'Invalid or expired operation token',
  );
  assert.equal(
    (await callRpcRaw(globalSocket, 'rpc.discover', textEncoder.encode(JSON.stringify({ operationId: crypto.randomUUID(), expiresAt: Date.now() - 1_000 })))).error.message,
    'Invalid or expired operation token',
  );
  assert.equal(
    (await callRpcRaw(globalSocket, 'rpc.discover', textEncoder.encode(JSON.stringify({ operationId: crypto.randomUUID(), expiresAt: Date.now() + 300_000 })))).error.message,
    'Invalid or expired operation token',
  );
  assert.equal(rpcOperations.length, dispatchBeforeTokens, 'requests rejected before the journal must not dispatch');

  const idempotentTags = [{ id: 'idempotent', name: 'Idempotent', color: '#101010' }];
  const idempotentOperation = crypto.randomUUID();
  const idempotentExpiresAt = Date.now() + 60_000;
  const dispatchBeforeIdempotency = rpcOperations.length;
  const firstAttempt = await callRpc(globalSocket, 'tags:save', { tags: idempotentTags }, { operationId: idempotentOperation, expiresAt: idempotentExpiresAt });
  const secondAttempt = await callRpc(globalSocket, 'tags:save', { tags: idempotentTags }, { operationId: idempotentOperation, expiresAt: idempotentExpiresAt });
  assert.deepEqual(firstAttempt.result, { tags: idempotentTags });
  assert.deepEqual(secondAttempt, firstAttempt);
  assert.equal(rpcOperations.length, dispatchBeforeIdempotency + 1, 'a repeated operation token must dispatch exactly once');

  const replaySocket = await openSocket('/rpc');
  const replayAttempt = await callRpc(replaySocket, 'tags:save', { tags: idempotentTags }, { operationId: idempotentOperation, expiresAt: idempotentExpiresAt });
  assert.deepEqual(replayAttempt, firstAttempt);
  assert.equal(rpcOperations.length, dispatchBeforeIdempotency + 1, 'the journal must replay across connections with the same identity');
  await closeSocket(replaySocket);

  assert.deepEqual(
    await callRpc(globalSocket, 'tags:save', { tags: [{ id: 'other' }] }, { operationId: idempotentOperation, expiresAt: idempotentExpiresAt }),
    { error: { code: -32600, message: 'Operation token conflict' } },
  );
  assert.deepEqual(
    await callRpc(globalSocket, 'tags:save', { tags: idempotentTags }, { operationId: crypto.randomUUID(), expiresAt: Date.now() - 1_000 }),
    { error: { code: -32600, message: 'Invalid or expired operation token' } },
  );

  // Mirrors the server journal key derivation to plant a reservation that never completed, as if
  // the process had restarted between reserve and complete.
  const strandedOperation = crypto.randomUUID();
  const strandedExpiresAt = Date.now() + 60_000;
  const socketIdentity = createHash('sha256').update(apiKey).digest('hex');
  const strandedId = createHash('sha256').update(JSON.stringify([socketIdentity, 'global', '', strandedOperation])).digest('hex');
  const strandedFingerprint = createHash('sha256')
    .update('tags.save')
    .update('\n')
    .update(JSON.stringify({ operationId: strandedOperation, expiresAt: strandedExpiresAt, params: undefined }))
    .digest('hex');
  database.remoteOperationStatements.reserve.run(strandedId, strandedFingerprint, strandedExpiresAt);
  const dispatchBeforeStranded = rpcOperations.length;
  const strandedAttempt = await callRpc(globalSocket, 'tags:save', undefined, { operationId: strandedOperation, expiresAt: strandedExpiresAt });
  assert.equal(strandedAttempt.error.code, 'OUTCOME_UNKNOWN');
  assert.equal(rpcOperations.length, dispatchBeforeStranded, 'a persisted reservation must not re-dispatch');

  const concurrentNames = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  const dispatchBeforeConcurrent = rpcOperations.length;
  const concurrentResults = await Promise.all(concurrentNames.map((name) => callRpc(globalSocket, 'tags:save', {
    tags: [{ id: name, name: `Tag ${name}`, color: '#FFFFFF' }],
  })));
  for (const [index, name] of concurrentNames.entries()) {
    assert.deepEqual(
      concurrentResults[index].result,
      { tags: [{ id: name, name: `Tag ${name}`, color: '#FFFFFF' }] },
      `concurrent response ${index} must correlate with its own ORPC frame id`,
    );
  }
  assert.equal(rpcOperations.length, dispatchBeforeConcurrent + concurrentNames.length);

  await closeSocket(globalSocket);
  await closeSocket(streamSocket);

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
