import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';
import WebSocket, { WebSocketServer } from 'ws';
import { CLIENT_TOOLS } from './client-tools.js';
import { applySubagentModelSchema } from './default-models.js';

const REMOTE_TOOL_NAMES = new Set([
  'bots_list',
  'bots_create',
  'bots_update',
  'bots_delete',
  'bots_activate',
  'chat_list_folders',
  'chat_list_threads',
  'chat_create_thread',
  'chat_send_prompt',
  'chat_interrupt_thread',
  'chat_inspect_thread',
]);
const GLOBAL_RPC_METHODS = new Set([
  'rpc:discover',
  'models:list',
  'bots:list',
  'bots:snooze',
  'bots:snooze-one',
  'bots:create',
  'bots:update',
  'bots:delete',
  'bots:clear-thread',
  'bots:full-reset',
  'bots:activate',
  'bots:resolve-approval',
  'bots:update-work-item',
  'conversations:list',
  'conversations:create',
  'conversations:update',
  'conversations:archive',
  'conversations:delete',
  'conversations:fork',
  'conversations:search',
  'conversations:set-tags',
  'folders:list',
  'folders:threads',
  'folders:save-color',
  'side-chats:list',
  'side-chats:create',
  'side-chats:close',
  'subagents:list',
  'rubber-ducks:list',
  'sidebar:status',
  'sidebar:mark-seen',
  'tags:list',
  'tags:save',
]);
const CONVERSATION_RPC_METHODS = new Set([
  'rpc:discover',
  'composer-state:get',
  'composer-state:save',
  'conversations:update',
  'conversations:messages',
  'conversations:tool-call-details',
  'conversations:context',
  'mentions:list',
  'context:commands',
  'files:diff',
  'attachments:read',
  'side-chats:list',
  'side-chats:create',
  'subagents:list',
  'rubber-ducks:list',
  'chat:send',
  'chat:replace-user-message',
  'chat:retry',
  'chat:expand-prompt',
  'chat:resolve-approval',
  'chat:answer-question',
  'chat:context-usage',
  'chat:compress-quick',
  'chat:compress',
  'chat:cancel-queued',
  'chat:reorder-queued',
  'chat:run-semaphore-now',
  'chat:cancel-semaphore',
  'chat:stop',
  'tasks:list',
  'goals:start',
  'goals:change',
]);
const CONVERSATION_SCALAR_METHODS = new Set([
  'composer-state:get',
  'side-chats:list',
  'subagents:list',
  'rubber-ducks:list',
  'chat:run-semaphore-now',
  'chat:cancel-semaphore',
  'chat:stop',
  'tasks:list',
]);
const remoteTools = CLIENT_TOOLS.filter((tool) => REMOTE_TOOL_NAMES.has(tool.name));
const REMOTE_MCP_INSTRUCTIONS = readFileSync(new URL('../prompts/mgmt-instructions.md', import.meta.url), 'utf8');
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 1024 * 1024;
const RPC_PROTOCOL = 'avi-rpc-v1';
const RPC_API_KEY_PROTOCOL_PREFIX = 'avi-api-key.';
const RPC_API_VERSION = 1;
const APP_VERSION = '0.5.0';

const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});
const socketSend = (socket, value) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
};

export class RemoteMcpServer {
  constructor({
    chatRunner,
    botManager,
    providerRegistry,
    getPreferences,
    getApiKeys,
    invokeApplicationRequest,
    subscribeChatEvents,
    resolveConversationProjectPath,
  }) {
    this.chatRunner = chatRunner;
    this.botManager = botManager;
    this.providerRegistry = providerRegistry;
    this.getPreferences = getPreferences;
    this.getApiKeys = getApiKeys;
    this.invokeApplicationRequest = invokeApplicationRequest;
    this.subscribeChatEvents = subscribeChatEvents;
    this.resolveConversationProjectPath = resolveConversationProjectPath;
    this.server = null;
    this.webSocketServer = null;
    this.port = null;
    this.completedUnseenConversationIds = new Set();
    this.subscribeChatEvents((event) => {
      if (event?.type !== 'run-state' || !event.conversationId) return;
      if (event.running || event.stoppedByUser) {
        this.completedUnseenConversationIds.delete(event.conversationId);
      } else if (!event.sleeping) {
        this.completedUnseenConversationIds.add(event.conversationId);
      }
    });
  }

  get running() {
    return Boolean(this.server);
  }

  async start(port) {
    if (this.server && this.port === port) return;
    const previousPort = this.port;
    if (this.server) await this.close();
    try {
      await this.listen(port);
    } catch (error) {
      if (previousPort !== null) await this.listen(previousPort);
      throw error;
    }
  }

  async listen(port) {
    const server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
        if (!this.isAllowedHost(request.headers.host)) {
          response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Invalid Host header.');
          return;
        }
        const pathParts = requestUrl.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 'mcp' && pathParts.length <= 2 && !this.isAuthorized(request.headers.authorization, pathParts[1])) {
          response.writeHead(401, {
            'content-type': 'text/plain; charset=utf-8',
            'www-authenticate': 'Bearer',
          });
          response.end('Unauthorized');
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_REQUEST_BODY_BYTES) {
            const error = new Error('Request body exceeds 1 MiB.');
            error.status = 413;
            throw error;
          }
          chunks.push(chunk);
        }
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
        const webRequest = new Request(requestUrl, {
          method: request.method,
          headers: request.headers,
          body,
          duplex: body ? 'half' : undefined,
        });
        const webResponse = await this.handleRequest(webRequest);
        response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
        if (!webResponse.body) {
          response.end();
          return;
        }
        await new Promise((resolve, reject) => {
          Readable.fromWeb(webResponse.body).once('error', reject).pipe(response).once('finish', resolve);
        });
      } catch (error) {
        response.writeHead(error?.status ?? 500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    const webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
      handleProtocols: (protocols) => protocols.has(RPC_PROTOCOL) ? RPC_PROTOCOL : false,
    });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      const route = this.resolveWebSocketRoute(url.pathname);
      if (!this.isAllowedHost(request.headers.host) || !route) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const offeredProtocols = String(request.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((protocol) => protocol.trim())
        .filter(Boolean);
      const protocolApiKeys = offeredProtocols
        .filter((protocol) => protocol.startsWith(RPC_API_KEY_PROTOCOL_PREFIX))
        .map((protocol) => this.decodeProtocolApiKey(protocol))
        .filter((apiKey) => apiKey !== null);
      const authorized = this.isAuthorized(request.headers.authorization)
        || protocolApiKeys.some((apiKey) => this.isAuthorized(undefined, apiKey));
      if (!authorized || (protocolApiKeys.length > 0 && !offeredProtocols.includes(RPC_PROTOCOL))) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      webSocketServer.handleUpgrade(request, socket, head, (client) => {
        if (route.type === 'global') this.attachGlobalSocket(client);
        else this.attachConversationSocket(client, route.conversationId);
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    this.server = server;
    this.webSocketServer = webSocketServer;
    this.port = server.address().port;
  }

  async close() {
    const server = this.server;
    const webSocketServer = this.webSocketServer;
    this.server = null;
    this.webSocketServer = null;
    this.port = null;
    if (!server) return;
    for (const client of webSocketServer?.clients ?? []) client.terminate();
    webSocketServer?.close();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }

  async handleRequest(request) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'mcp' && pathParts.length <= 2) {
      if (!this.isAuthorized(request.headers.get('authorization'), pathParts[1])) return this.unauthorized();
      return this.handleMcpRequest(request);
    }
    if (this.resolveWebSocketRoute(url.pathname)) {
      return new Response('Upgrade Required', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }
    return new Response('Not found', { status: 404 });
  }

  unauthorized() {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    });
  }

  resolveWebSocketRoute(pathname) {
    if (pathname === '/rpc') return { type: 'global' };
    const match = /^\/rpc\/conversations\/streams\/([^/]+)$/.exec(pathname);
    return match ? { type: 'conversation', conversationId: decodeURIComponent(match[1]) } : null;
  }

  attachGlobalSocket(socket) {
    this.attachRpcSocket(socket, {
      scope: 'global',
      methods: GLOBAL_RPC_METHODS,
      preparePayload: (_method, payload) => payload,
    });
  }

  attachConversationSocket(socket, conversationId) {
    let sequence = 0;
    const unsubscribe = this.subscribeChatEvents((event) => {
      if (event?.conversationId !== conversationId) return;
      sequence += 1;
      socketSend(socket, {
        jsonrpc: '2.0',
        method: 'conversation:event',
        params: { sequence, conversationId, event },
      });
    });
    socket.once('close', unsubscribe);
    socket.once('error', unsubscribe);
    socketSend(socket, {
      jsonrpc: '2.0',
      method: 'conversation:ready',
      params: { sequence, conversationId, recoveryMethod: 'conversations:context' },
    });
    this.attachRpcSocket(socket, {
      scope: 'conversation',
      methods: CONVERSATION_RPC_METHODS,
      preparePayload: (method, payload) => this.prepareConversationPayload(method, payload, conversationId),
    });
  }

  attachRpcSocket(socket, { scope, methods, preparePayload }) {
    socket.on('message', async (data, isBinary) => {
      if (isBinary) {
        socketSend(socket, rpcError(null, -32600, 'Binary JSON-RPC messages are not supported'));
        return;
      }
      let document;
      try {
        document = JSON.parse(data.toString());
      } catch {
        socketSend(socket, rpcError(null, -32700, 'Parse error'));
        return;
      }
      if (Array.isArray(document) && document.length === 0) {
        socketSend(socket, rpcError(null, -32600, 'Invalid Request'));
        return;
      }
      const requests = Array.isArray(document) ? document : [document];
      const responses = (await Promise.all(requests.map((request) => (
        this.executeRpcRequest(request, scope, methods, preparePayload)
      )))).filter(Boolean);
      if (responses.length > 0) socketSend(socket, Array.isArray(document) ? responses : responses[0]);
    });
  }

  async executeRpcRequest(request, scope, methods, preparePayload) {
    const validObject = request && typeof request === 'object' && !Array.isArray(request);
    const notification = validObject && !Object.hasOwn(request, 'id');
    if (
      !validObject
      || request.jsonrpc !== '2.0'
      || typeof request.method !== 'string'
      || (request.params !== undefined && (request.params === null || typeof request.params !== 'object'))
    ) return rpcError(request?.id, -32600, 'Invalid Request');
    if (!methods.has(request.method)) {
      return notification ? null : rpcError(request.id, -32601, 'Method not found');
    }
    if (request.method === 'rpc:discover') {
      return notification ? null : {
        jsonrpc: '2.0',
        id: request.id,
        result: this.rpcDiscovery(scope, methods),
      };
    }
    if (request.method === 'models:list') {
      const preferences = this.getPreferences();
      return notification ? null : {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          models: this.providerRegistry.listModels(),
          lastModel: preferences.lastModel ?? null,
          defaultModels: preferences.defaultModels ?? null,
          messageDeliveryMode: preferences.tuning?.messageDeliveryMode === 'steer' ? 'steer' : 'queue',
        },
      };
    }
    const rawPayload = request.params && !Array.isArray(request.params) && Object.hasOwn(request.params, 'payload')
      ? request.params.payload
      : request.params;
    try {
      if (request.method === 'sidebar:status') {
        return notification ? null : { jsonrpc: '2.0', id: request.id, result: this.sidebarStatus() };
      }
      if (request.method === 'sidebar:mark-seen') {
        const conversationId = rawPayload?.conversationId;
        if (typeof conversationId !== 'string' || !conversationId) {
          throw new Error('sidebar:mark-seen requires a conversationId string.');
        }
        this.completedUnseenConversationIds.delete(conversationId);
        return notification ? null : {
          jsonrpc: '2.0',
          id: request.id,
          result: { completedUnseenConversationIds: [...this.completedUnseenConversationIds] },
        };
      }
      const payload = preparePayload(request.method, rawPayload);
      const result = await this.invokeApplicationRequest(request.method, payload);
      return notification ? null : { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      return notification ? null : rpcError(request.id, -32603, 'Application request failed', {
        name: error?.name ?? 'Error',
        message: error instanceof Error ? error.message : String(error),
        ...(error?.code === undefined ? {} : { code: error.code }),
        ...(error?.status === undefined ? {} : { status: error.status }),
      });
    }
  }

  sidebarStatus() {
    const chatState = this.chatRunner.reloadSnapshot();
    return {
      runningConversationIds: [...new Set(chatState.conversationIds)],
      approvalPendingConversationIds: [...new Set(chatState.approvals.map((item) => item.conversationId))],
      inputPendingConversationIds: [...new Set(chatState.questions.map((item) => item.conversationId))],
      semaphoreWaitingConversationIds: [...new Set(chatState.semaphoreWaits.map((item) => item.conversationId))],
      completedUnseenConversationIds: [...this.completedUnseenConversationIds],
    };
  }

  rpcDiscovery(scope, methods) {
    return {
      appVersion: APP_VERSION,
      versions: {
        core: 2,
        rpc: RPC_API_VERSION,
        mcp: {
          latest: LATEST_PROTOCOL_VERSION,
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
        },
      },
      scope,
      methods: [...methods].sort(),
      capabilities: scope === 'global'
        ? ['batch', 'notifications', 'models', 'folders', 'conversations', 'bots', 'sidebar-status', 'tags']
        : [
            'batch',
            'notifications',
            'conversation-events',
            'message-pagination',
            'tool-call-details',
            'mentions',
            'context-commands',
            'file-diffs',
            'attachment-chunks',
          ],
    };
  }

  prepareConversationPayload(method, payload, conversationId) {
    if (CONVERSATION_SCALAR_METHODS.has(method)) {
      if (payload !== undefined && payload !== conversationId) {
        throw new Error('The payload conversationId does not match the WebSocket conversation.');
      }
      return conversationId;
    }
    const next = payload === undefined ? {} : payload;
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error('Conversation RPC params must be an object.');
    }
    for (const field of ['conversationId', 'parentConversationId']) {
      if (next[field] !== undefined && next[field] !== conversationId) {
        throw new Error(`The ${field} does not match the WebSocket conversation.`);
      }
    }
    const projectPath = this.resolveConversationProjectPath(conversationId);
    if (['mentions:list', 'context:commands', 'files:diff'].includes(method) && !projectPath) {
      throw new Error('Conversation not found.');
    }
    if (method === 'mentions:list') return { query: next.query, folderPath: projectPath };
    if (method === 'context:commands') return projectPath;
    if (method === 'files:diff') return { filePath: next.filePath, folderPath: projectPath };
    if (['conversations:messages', 'conversations:context'].includes(method)) {
      const invalidField = Object.keys(next).find((field) => !['limit', 'cursor', 'conversationId'].includes(field));
      if (invalidField) throw new Error(`Unsupported pagination parameter: ${invalidField}.`);
      return { limit: next.limit, cursor: next.cursor, conversationId };
    }
    if (method === 'conversations:tool-call-details') {
      const invalidField = Object.keys(next).find((field) => (
        !['messageId', 'segmentId', 'conversationId'].includes(field)
      ));
      if (invalidField) throw new Error(`Unsupported tool-call-details parameter: ${invalidField}.`);
      return {
        messageId: next.messageId,
        segmentId: next.segmentId,
        conversationId,
      };
    }
    if (method === 'attachments:read') {
      const invalidField = Object.keys(next).find((field) => (
        !['messageId', 'attachmentId', 'offset', 'limit', 'conversationId'].includes(field)
      ));
      if (invalidField) throw new Error(`Unsupported attachments:read parameter: ${invalidField}.`);
      return {
        messageId: next.messageId,
        attachmentId: next.attachmentId,
        offset: next.offset,
        limit: next.limit,
        conversationId,
      };
    }
    if (method === 'conversations:update') {
      if (next.id !== undefined && next.id !== conversationId) {
        throw new Error('The conversation id does not match the WebSocket conversation.');
      }
      return { ...next, id: conversationId };
    }
    if (method === 'side-chats:create') return { ...next, parentConversationId: conversationId };
    if (method === 'chat:send' && next.goalId !== undefined && next.goalId !== null) {
      throw new Error('Set workMode to goal or use goals:start instead of supplying goalId.');
    }
    return { ...next, conversationId };
  }

  async handleMcpRequest(request) {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      allowedHosts: [
        '127.0.0.1',
        'localhost',
        `127.0.0.1:${this.port}`,
        `localhost:${this.port}`,
      ],
      enableDnsRebindingProtection: true,
    });
    const mcpServer = new Server(
      { name: 'avi-remote', version: '1.0.0' },
      { capabilities: { tools: {} }, instructions: REMOTE_MCP_INSTRUCTIONS },
    );
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.listTools() }));
    mcpServer.setRequestHandler(CallToolRequestSchema, async (requestInfo) => {
      const tool = remoteTools.find((item) => item.name === requestInfo.params.name);
      if (!tool) throw new Error(`Unknown tool: ${requestInfo.params.name}`);
      try {
        const result = await tool.execute(requestInfo.params.arguments ?? {}, {
          chatRunner: this.chatRunner,
          botManager: this.botManager,
          conversationId: null,
          model: this.getPreferences().lastModel,
          models: this.providerRegistry.listModels(),
          defaultModels: this.getPreferences().defaultModels,
          workspacePath: homedir(),
        });
        return typeof result === 'string'
          ? { content: [{ type: 'text', text: result }] }
          : { content: [], structuredContent: result };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
      }
    });
    await mcpServer.connect(transport);
    try {
      const transportRequest = request.method === 'POST'
        ? new Request(request, {
          headers: new Headers([...request.headers, ['accept', 'application/json, text/event-stream']]),
        })
        : request;
      return await transport.handleRequest(transportRequest);
    } finally {
      await mcpServer.close();
    }
  }

  listTools() {
    const models = this.providerRegistry.listModels();
    return remoteTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: applySubagentModelSchema(tool, models, this.getPreferences().defaultModels),
      annotations: {
        readOnlyHint: !tool.canPerformDestructiveActions,
        destructiveHint: Boolean(tool.canPerformDestructiveActions),
      },
    }));
  }

  isAllowedHost(host) {
    return [
      '127.0.0.1',
      'localhost',
      `127.0.0.1:${this.port}`,
      `localhost:${this.port}`,
    ].includes(host);
  }

  decodeProtocolApiKey(protocol) {
    const encoded = protocol.slice(RPC_API_KEY_PROTOCOL_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    try {
      const decoded = Buffer.from(encoded, 'base64url');
      if (decoded.toString('base64url') !== encoded) return null;
      return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    } catch {
      return null;
    }
  }

  isAuthorized(authorization, pathApiKey) {
    const candidate = typeof pathApiKey === 'string'
      ? pathApiKey
      : typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : null;
    if (candidate === null) return false;
    const supplied = Buffer.from(candidate);
    const now = Date.now();
    return this.getApiKeys().some((apiKey) => {
      if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now) return false;
      const expected = Buffer.from(apiKey.value);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    });
  }
}
