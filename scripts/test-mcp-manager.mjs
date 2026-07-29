import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interceptToolSchemas } from '../src/main/client-tools.js';
import { resolveDynamicContext } from '../src/main/context-injection.js';
import { McpManager } from '../src/main/mcp-manager.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');

const testRoot = await mkdtemp(join(tmpdir(), 'aivax-mcp-test-'));
const workspaceRoot = join(testRoot, 'workspace');
const globalRoot = join(testRoot, 'global');
const configDirectory = join(workspaceRoot, '.agents');
const serverPath = join(
  repositoryRoot,
  'node_modules',
  '@modelcontextprotocol',
  'sdk',
  'dist',
  'esm',
  'examples',
  'server',
  'progressExample.js',
);
let manager;

try {
  await mkdir(configDirectory, { recursive: true });
  await mkdir(globalRoot, { recursive: true });
  await writeFile(join(configDirectory, 'mcpconfig.json'), JSON.stringify({
    servers: {
      'SDK Test': {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    },
  }, null, 2));

  manager = new McpManager({
    globalRoot,
    sendEvent: () => {},
    openExternal: async () => {},
  });
  console.log('Connecting test MCP server...');
  const runtime = await manager.ensureWorkspace(workspaceRoot);
  const tool = runtime.tools.find((item) => item.name === 'mcp_sdk_test_count');
  if (!tool) throw new Error('Prefixed MCP tool was not discovered.');
  const exposedSchema = interceptToolSchemas([tool])[0].parameters;
  if (
    Object.hasOwn(exposedSchema.properties ?? {}, '__invocation_goal')
    || Object.hasOwn(exposedSchema.properties ?? {}, '__requires_human_approval')
  ) {
    throw new Error('MCP tool schema contains local control properties.');
  }

  console.log('Calling prefixed MCP tool...');
  const result = await tool.execute({ n: 2 }, { signal: new AbortController().signal });
  if (result.content?.[0]?.text !== 'Counted to 2') {
    throw new Error('MCP tool result was not returned.');
  }

  let forwardedArguments;
  const boundaryTool = manager.mapTools({
    key: 'test:boundary',
    name: 'Boundary test',
    prefix: 'mcp_boundary_test_',
    status: 'ready',
    logs: [],
    client: {
      callTool: async ({ arguments: input }) => {
        forwardedArguments = input;
        return { content: [] };
      },
    },
  }, [{
    name: 'echo',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
    },
  }])[0];
  await boundaryTool.execute({
    value: 'kept',
    __invocation_goal: 'removed',
    __requires_human_approval: false,
  }, { signal: new AbortController().signal });
  if (
    forwardedArguments.value !== 'kept'
    || Object.hasOwn(forwardedArguments, '__invocation_goal')
    || Object.hasOwn(forwardedArguments, '__requires_human_approval')
  ) {
    throw new Error('MCP boundary forwarded local control properties.');
  }

  console.log('Checking MCP context injection...');
  const context = await resolveDynamicContext({
    workspacePath: workspaceRoot,
    mcpInstructions: [{ from: 'SDK Test', text: 'Use count for deterministic counting.' }],
  });
  if (!context.includes('<mcp_context from="SDK Test">')) {
    throw new Error('MCP instructions were not injected into dynamic context.');
  }

  const server = (await manager.listWorkspace(workspaceRoot))
    .find((item) => item.scope === 'folder' && item.name === 'SDK Test');
  console.log('Restarting test MCP server...');
  await manager.restartServer(server.key);
  if (manager.runtimeForWorkspace(workspaceRoot).tools.length !== 1) {
    throw new Error('MCP server did not recover after restart.');
  }

  console.log('MCP manager test passed.');
} finally {
  console.log('Closing test MCP server...');
  await manager?.closeAll();
  const resolvedTemporaryRoot = resolve(testRoot);
  if (dirname(resolvedTemporaryRoot) !== resolve(tmpdir())) {
    throw new Error('Refusing to remove an unexpected MCP test directory.');
  }
  await rm(resolvedTemporaryRoot, { recursive: true, force: true });
}
process.exit(0);
