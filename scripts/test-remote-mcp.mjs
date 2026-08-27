import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-remote-mcp-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

const database = await import('../src/main/database.js');
const { RemoteMcpServer } = await import('../src/main/remote-mcp-server.js');
const apiKey = 'remote-test-key';
const preferences = {
  lastModel: 'test:model',
  defaultModels: { subagents: { enabled: false } },
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
  chatRunner: { runs: new Map() },
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
  getApiKey: () => apiKey,
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
