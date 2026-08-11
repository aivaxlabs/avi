import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decorateToolsForInvocation } from '../src/main/client-tools.js';
import { resolveDynamicContext } from '../src/main/context-injection.js';
import { McpManager } from '../src/main/mcp-manager.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');

async function assertRejects(action, pattern) {
  try {
    await action();
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  throw new Error(`Expected rejection matching ${pattern}.`);
}

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
    managedServers: [{
      name: 'plugin-demo-managed',
      config: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    }],
  });
  console.log('Connecting test MCP server...');
  const runtime = await manager.ensureWorkspace(workspaceRoot);
  const tool = runtime.tools.find((item) => item.name === 'mcp_sdk_test_count');
  if (!tool) throw new Error('Prefixed MCP tool was not discovered.');
  const managedTool = runtime.tools.find((item) => item.name === 'mcp_plugin-demo-managed_count');
  if (!managedTool) {
    const servers = await manager.listWorkspace(workspaceRoot);
    throw new Error(`Managed plugin MCP tool was not discovered. Tools=${runtime.tools.map((item) => item.name).join(',')} Servers=${servers.map((server) => `${server.name}:${server.status}`).join(',')}`);
  }
  const managedServer = (await manager.listWorkspace(workspaceRoot))
    .find((item) => item.name === 'plugin-demo-managed');
  if (!managedServer?.managed) throw new Error('Managed plugin MCP was not marked read-only.');
  await assertRejects(
    () => manager.setServerEnabled(managedServer.key, false),
    /Managed MCP server .* is read-only/,
  );
  await assertRejects(
    () => manager.removeServer(globalRoot, managedServer.name),
    /Managed MCP server .* is read-only/,
  );
  const exposedSchema = decorateToolsForInvocation([tool])[0].inputSchema;
  if (
    !Object.hasOwn(exposedSchema.properties ?? {}, '__invocation_goal')
    || !Object.hasOwn(exposedSchema.properties ?? {}, '__requires_human_approval')
    || Object.hasOwn(exposedSchema.properties.__requires_human_approval, 'enum')
    || !exposedSchema.required.includes('__requires_human_approval')
  ) {
    throw new Error('MCP tool schema does not expose model-controlled approval properties.');
  }
  const expectedMetaParameters = ['__invocation_goal', '__requires_human_approval'];
  if (
    JSON.stringify(Object.keys(exposedSchema.properties).slice(0, 2))
      !== JSON.stringify(expectedMetaParameters)
    || JSON.stringify(exposedSchema.required.slice(0, 2))
      !== JSON.stringify(expectedMetaParameters)
  ) {
    throw new Error('Tool schema does not expose local control properties first.');
  }
  const permissionDescriptions = [
    'ask_for_approval',
    'approve_for_me',
    'full_access',
  ].map((permissionMode) => (
    decorateToolsForInvocation([tool], permissionMode)[0]
      .inputSchema
      .properties
      .__requires_human_approval
      .description
  ));
  if (
    !permissionDescriptions[0].includes('true for every tool invocation')
    || !permissionDescriptions[1].includes('true only when')
    || !permissionDescriptions[2].includes('false')
  ) {
    throw new Error('Permission mode was not reflected in the approval parameter contract.');
  }

  console.log('Calling prefixed MCP tool...');
  const result = await tool.execute({ n: 2 }, { signal: new AbortController().signal });
  if (result !== 'Counted to 2') {
    throw new Error('MCP tool result was not returned.');
  }

  const combinedResultTool = manager.mapTools({
    key: 'test:combined-result',
    name: 'Combined result test',
    prefix: 'mcp_combined_result_test_',
    status: 'ready',
    logs: [],
    client: {
      callTool: async () => ({
        content: [
          { type: 'text', text: 'Plain MCP text' },
          { type: 'image', mimeType: 'image/png', data: Buffer.from('media').toString('base64') },
        ],
        structuredContent: { count: 2, nested: { preserved: true } },
      }),
    },
  }, [{ name: 'combined', inputSchema: { type: 'object', properties: {} } }])[0];
  const combinedResult = await combinedResultTool.execute(
    {},
    { signal: new AbortController().signal },
  );
  if (
    !combinedResult.startsWith('Plain MCP text\n\n')
    || !combinedResult.includes('{"count":2,"nested":{"preserved":true}}')
    || !combinedResult.includes('\n\nFiles created from tool response:\n- ')
  ) {
    throw new Error('MCP text, structured content, and media were not all preserved.');
  }
  const mediaPath = combinedResult.split('\n- ')[1];
  if (!mediaPath || (await readFile(mediaPath, 'utf8')) !== 'media') {
    throw new Error('MCP media was not written to the returned file path.');
  }
  await rm(dirname(mediaPath), { recursive: true, force: true });

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
  if (manager.runtimeForWorkspace(workspaceRoot).tools.length !== 2) {
    throw new Error('MCP servers did not remain available after restart.');
  }

  const collisionRoot = join(testRoot, 'collision-global');
  await mkdir(join(collisionRoot, '.agents'), { recursive: true });
  await writeFile(join(collisionRoot, '.agents', 'mcpconfig.json'), JSON.stringify({
    servers: {
      'plugin-demo-managed': { type: 'stdio', command: 'replacement' },
    },
  }));
  const collisionManager = new McpManager({
    globalRoot: collisionRoot,
    sendEvent: () => {},
    openExternal: async () => {},
    managedServers: [{
      name: 'plugin-demo-managed',
      config: { type: 'stdio', command: process.execPath },
    }],
  });
  await assertRejects(
    () => collisionManager.loadScope(collisionRoot, 'global'),
    /conflicts with a managed plugin server/,
  );

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
