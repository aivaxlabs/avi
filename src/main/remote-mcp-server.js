import { timingSafeEqual } from 'node:crypto';
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
    const previousServer = this.server;
    const previousPort = this.port;
    if (previousServer) {
      await previousServer.stop(true);
      this.server = null;
      this.port = null;
    }
    try {
      this.server = Bun.serve({
        hostname: '127.0.0.1',
        port,
        fetch: (request) => this.handleRequest(request),
      });
      this.port = this.server.port;
    } catch (error) {
      if (previousServer) {
        this.server = Bun.serve({
          hostname: '127.0.0.1',
          port: previousPort,
          fetch: (request) => this.handleRequest(request),
        });
        this.port = previousPort;
      }
      throw error;
    }
  }

  async close() {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (server) await server.stop(true);
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
