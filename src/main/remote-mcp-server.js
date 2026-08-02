import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { homedir } from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CLIENT_TOOLS } from './client-tools.js';
import { applySubagentModelSchema } from './default-models.js';

const REMOTE_TOOL_NAMES = new Set([
  'chat_list_folders',
  'chat_list_threads',
  'chat_create_thread',
  'chat_send_prompt',
  'chat_interrupt_thread',
  'chat_inspect_thread',
]);
const remoteTools = CLIENT_TOOLS.filter((tool) => REMOTE_TOOL_NAMES.has(tool.name));
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export class RemoteMcpServer {
  constructor({ chatRunner, providerRegistry, getPreferences, getApiKey }) {
    this.chatRunner = chatRunner;
    this.providerRegistry = providerRegistry;
    this.getPreferences = getPreferences;
    this.getApiKey = getApiKey;
    this.server = null;
    this.port = null;
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
        const pathParts = requestUrl.pathname.split('/').filter(Boolean);
        if (pathParts[0] !== 'mcp' || pathParts.length > 2) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        const allowedHosts = new Set(['127.0.0.1', 'localhost', `127.0.0.1:${this.port}`, `localhost:${this.port}`]);
        if (!allowedHosts.has(request.headers.host ?? '')) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Invalid host');
          return;
        }
        if (!this.isAuthorized(request.headers.authorization, pathParts[1])) {
          response.writeHead(401, {
            'content-type': 'text/plain; charset=utf-8',
            'www-authenticate': 'Bearer',
          });
          response.end('Unauthorized');
          return;
        }
        const body = request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await new Promise((resolve, reject) => {
            const chunks = [];
            let size = 0;
            request.on('data', (chunk) => {
              size += chunk.length;
              if (size > MAX_REQUEST_BODY_BYTES) {
                const error = new Error('Payload too large');
                error.status = 413;
                reject(error);
                request.removeAllListeners('data');
                request.resume();
                return;
              }
              chunks.push(chunk);
            });
            request.on('end', () => resolve(Buffer.concat(chunks)));
            request.on('error', reject);
          });
        const webRequest = new Request(`http://${request.headers.host ?? '127.0.0.1'}${request.url}`, {
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
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    this.server = server;
    this.port = server.address().port;
  }

  async close() {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }
  async handleRequest(request) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts[0] !== 'mcp' || pathParts.length > 2) {
      return new Response('Not found', { status: 404 });
    }
    if (!this.isAuthorized(request.headers.get('authorization'), pathParts[1])) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

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
      { capabilities: { tools: {} } },
    );
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.listTools(),
    }));
    mcpServer.setRequestHandler(CallToolRequestSchema, async (requestInfo) => {
      const tool = remoteTools.find((item) => item.name === requestInfo.params.name);
      if (!tool) throw new Error(`Unknown tool: ${requestInfo.params.name}`);
      try {
        const result = await tool.execute(requestInfo.params.arguments ?? {}, {
          chatRunner: this.chatRunner,
          conversationId: null,
          model: this.getPreferences().lastModel,
          models: this.providerRegistry.listModels(),
          defaultModels: this.getPreferences().defaultModels,
          workspacePath: homedir(),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          }],
        };
      }
    });

    await mcpServer.connect(transport);
    try {
      const transportRequest = request.method === 'POST'
        ? new Request(request, {
          headers: new Headers([
            ...request.headers,
            ['accept', 'application/json, text/event-stream'],
          ]),
        })
        : request;
      // The SDK currently enforces SSE negotiation even in JSON response mode. Keep the
      // public stateless endpoint JSON-only until the transport supports that mode natively.
      return await transport.handleRequest(transportRequest);
    } finally {
      await mcpServer.close();
    }
  }

  listTools() {
    const models = this.providerRegistry.listModels();
    return remoteTools.map((tool) => {
      const inputSchema = applySubagentModelSchema(
        tool,
        models,
        this.getPreferences().defaultModels,
      );
      return {
        name: tool.name,
        description: tool.description,
        inputSchema,
        annotations: {
          readOnlyHint: !tool.canPerformDestructiveActions,
          destructiveHint: Boolean(tool.canPerformDestructiveActions),
        },
      };
    });
  }

  isAuthorized(authorization, pathApiKey) {
    const apiKey = this.getApiKey();
    if (!apiKey) return false;
    const candidate = typeof pathApiKey === 'string'
      ? pathApiKey
      : typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : null;
    if (candidate === null) return false;
    const supplied = Buffer.from(candidate);
    const expected = Buffer.from(apiKey);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}
