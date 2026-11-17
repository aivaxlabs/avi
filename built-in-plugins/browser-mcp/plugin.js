import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = new URL('./', import.meta.url);
const port = Number(process.env.BROWSER_MCP_SENTINEL_PORT) || 55332;
const origin = `http://127.0.0.1:${port}`;

async function context() {
  const references = (await readdir(new URL('skills/browser-mcp/references/', root))).filter((name) => name.endsWith('.md'));
  const files = ['skills/browser-mcp/SKILL.md', ...references.map((name) => `skills/browser-mcp/references/${name}`)];

  // The instruction is stored as instructions.md because an AGENTS.md here would also be discovered as
  // workspace context of the Avi repository itself.
  return Promise.all([
    readFile(new URL('instructions.md', root), 'utf8').then((content) => ({ path: 'AGENTS.md', content })),
    ...files.map(async (path) => ({ path, content: await readFile(new URL(path, root), 'utf8') })),
  ]);
}

export default async ({ definePlugin }) => definePlugin({
  apiVersion: 2,
  id: 'browser-mcp',
  name: 'Browser MCP',
  version: '1.0.0',
  description: 'Control a dedicated browser window through the Browser MCP daemon, installed from npm on first use, with snapshots, real input, network mocking and saved logins.',
  capabilities: [],
  contributions: {
    context: await context(),
    mcps: [{
      id: 'host',
      name: 'Browser MCP',
      config: { type: 'streamable-http', url: `${origin}/mcp` },
    }],
  },
  async activate(avi) {
    const directory = join(homedir(), '.aivax', 'browser-mcp');
    const electron = join(directory, 'node_modules', 'electron');
    const installed = join(electron, 'path.txt');
    const healthy = () => fetch(`${origin}/health`).then((response) => response.ok, () => false);
    let daemon;

    avi.lifecycle.onDeactivate(() => { daemon?.kill(); });

    const start = async () => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;

      // The package launcher needs a Node.js executable, which may not exist, so the daemon is started the way
      // that launcher starts it: the package's own Electron running the package as its app.
      daemon = spawn(join(electron, 'dist', await readFile(installed, 'utf8')), [
        join(directory, 'node_modules', '@cypherpotato', 'browser-mcp'),
        '--',
        'browser-mcp-http-host',
        '--sentinel-port',
        String(port),
      ], { env, stdio: 'ignore' });

      for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
        if (await healthy()) return;
        await new Promise((done) => setTimeout(done, 100));
      }

      daemon.kill();
      throw new Error(`The Browser MCP daemon did not answer on localhost:${port} within 8 seconds.`);
    };

    if (await healthy()) return;

    // Avi connects an active MCP server once, right after activation, so the daemon must already answer by then.
    if (existsSync(installed)) return start();

    // Not awaited: the first run downloads the package and its Electron, which outlasts the activation limit.
    // That first connection therefore fails, and the server connects when Avi is restarted.
    (async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({
        private: true,
        trustedDependencies: ['electron'],
        pnpm: { onlyBuiltDependencies: ['electron'] },
      }));

      for (const command of ['npm install', 'bun add', 'pnpm add']) {
        if (existsSync(installed)) break;

        await new Promise((done) => spawn(`${command} @cypherpotato/browser-mcp@latest`, {
          cwd: directory,
          shell: true,
          stdio: 'ignore',
          windowsHide: true,
        }).once('error', done).once('exit', done));
      }

      if (!existsSync(installed)) throw new Error('could not install @cypherpotato/browser-mcp with npm, bun or pnpm.');
      if (!avi.lifecycle.signal.aborted) await start();
    })().catch((error) => console.error(`Browser MCP: ${error.message}`));
  },
});
