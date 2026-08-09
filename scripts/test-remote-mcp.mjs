import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RemoteMcpServer } from '../src/main/remote-mcp-server.js';

const apiKey = 'remote-test-key';
const preferences = {
  lastModel: 'test:model',
  defaultModels: { subagents: { enabled: false } },
};
const server = new RemoteMcpServer({
  chatRunner: { runs: new Map() },
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

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [
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
  assert.match(JSON.parse(result.content[0].text), /^(Threads:|No threads found\.)/);
  await client.close();

  const occupied = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('occupied'),
  });
  try {
    await assert.rejects(server.start(occupied.port));
    assert.equal(String(server.port), new URL(endpoint).port);
    const restored = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.notEqual(restored.status, 401);
  } finally {
    await occupied.stop(true);
  }

  console.log('Remote MCP tests passed.');
} finally {
  await server.close();
}
