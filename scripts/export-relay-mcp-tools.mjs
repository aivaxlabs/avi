import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv.at(-1);
if (!output || output === '--help' || resolve(output) === fileURLToPath(import.meta.url)) {
  console.log('Usage: electron scripts/export-relay-mcp-tools.mjs <output-file>\nExport device-independent public Relay MCP schemas from the Desktop tool catalog.');
  process.exit(0);
}
const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-') + '-UTC';
const root = join(tmpdir(), '.avi', 'visualizations', timestamp);
mkdirSync(root, { recursive: true });
process.env.USERPROFILE = mkdtempSync(join(root, 'relay-mcp-catalog-'));
const { RemoteMcpServer } = await import('../src/main/remote-mcp-server.js');
const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
const tools = RemoteMcpServer.prototype.listTools.call({
  providerRegistry: { listModels: () => [] },
  getPreferences: () => ({ defaultModels: {} }),
}).map((tool) => {
  const inputSchema = CLIENT_TOOLS.find((definition) => definition.name === tool.name).inputSchema;
  return {
    ...tool,
    inputSchema: {
      ...inputSchema,
      properties: {
        ...inputSchema.properties,
        instanceKey: { type: 'string', description: 'Required device credential: <instance-id>@<api-key>. Copy MCP instance key in Avi Remote control. Never include it in prompts, output, or logs.', minLength: 17, maxLength: 256 },
      },
      required: [...new Set([...(inputSchema.required ?? []), 'instanceKey'])],
    },
  };
});
const path = resolve(output);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `export const publicMcpTools = ${JSON.stringify(tools, null, 2)};\n`);
console.log(`Exported ${tools.length} public MCP tool schemas to ${path}`);
process.exit(0);
