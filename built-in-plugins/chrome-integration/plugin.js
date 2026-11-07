import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ChromeBridge } from './bridge.js';

const skillRoot = new URL('./skills/chrome-integration/', import.meta.url);

async function skillContext() {
  const files = ['SKILL.md', ...(await readdir(new URL('references/', skillRoot))).filter((name) => name.endsWith('.md')).map((name) => `references/${name}`)];
  return Promise.all(files.map(async (file) => ({
    path: `skills/chrome-integration/${file}`,
    content: await readFile(new URL(file, skillRoot), 'utf8'),
  })));
}

async function saveFiles(result, workspacePath) {
  let text = result.text;
  for (const file of result.files ?? []) {
    const name = String(file.name || 'file').replace(/[\\/:*?"<>|]/g, '_');
    const target = file.path
      ? resolve(isAbsolute(file.path) ? file.path : join(workspacePath || tmpdir(), file.path))
      : join(tmpdir(), '.avi', 'chrome-integration', `${Date.now()}-${name}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.data, 'base64'));
    text = text.replaceAll(file.marker, JSON.stringify(target).slice(1, -1));
  }
  return text;
}

export default async ({ definePlugin }) => {
  let bridge;
  let storage;
  let timeout = 8000;
  return definePlugin({
    apiVersion: 2,
    id: 'chrome-integration',
    name: 'Chrome Integration',
    version: '1.1.0',
    description: 'Control real Chrome tabs through the bundled Avi extension, with snapshots, screenshots and debugging tools.',
    capabilities: ['tools.register', 'storage'],
    contributions: { context: await skillContext() },
    settings: [{
      label: 'Chrome connection',
      options: [{
        title: 'Default action timeout (milliseconds)',
        description: 'The bundled extension connects locally on port 55334. Install it separately in every Chrome profile you want to control.',
        valueSchema: { type: 'integer', minimum: 1000, maximum: 120000 },
        getValue: () => timeout,
        async setValue(_oldValue, value) { await storage.set('timeout', value); timeout = value; },
      }],
    }],
    async activate(avi) {
      storage = avi.storage;
      timeout = (await storage.get('timeout')) ?? 8000;
      bridge = new ChromeBridge();
      avi.lifecycle.onDeactivate(() => bridge.close());
      try { await bridge.start(); } catch (error) { throw new Error(`Could not start Chrome Integration on localhost:55334. Close the other Avi instance or application using this port. ${error.message}`); }
      avi.tools.register({
        name: 'chrome_get_context',
        description: 'List live Chrome tabs across profiles connected to the Avi Chrome extension. Returns ephemeral tab_id, title, sanitized URL, state, controllable, active and opener_tab_id. Always call before acting; IDs expire on disconnect. An empty list means no profiles are connected or no tabs are open.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnly: true },
        async execute(_input, context) { return JSON.stringify(await bridge.getContext(context.signal)); },
      });
      avi.tools.register({
        name: 'chrome_manage_tab',
        description: 'Open, navigate, reload, go back or forward, activate or close a Chrome tab and wait for it to load. Returns the resulting tab with its tab_id. "open" without tab_id needs exactly one connected profile; with tab_id it opens next to that tab. Read the chrome-integration skill first.',
        inputSchema: { type: 'object', properties: {
          action: { type: 'string', enum: ['open', 'navigate', 'reload', 'back', 'forward', 'activate', 'close'] },
          tab_id: { type: 'string', minLength: 1 },
          url: { type: 'string', minLength: 1 },
          active: { type: 'boolean', description: 'For open: focus the new tab (default true).' },
          new_window: { type: 'boolean', description: 'For open: use a new window.' },
          bypass_cache: { type: 'boolean', description: 'For reload.' },
          timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000 },
        }, required: ['action'], additionalProperties: false },
        annotations: { destructive: true, externalAccess: true },
        async execute(input, context) { return JSON.stringify(await bridge.manageTab(input, context.signal), null, 2); },
      });
      avi.tools.register({
        name: 'chrome_run_actions',
        description: 'Run an async JavaScript function body in a live Chrome tab with the browser helper. Inspect first with return browser.snapshot(). Target elements by @ref from the snapshot, CSS selector, "text=..." or {x,y}: browser.click/fill/type/press/select/check/upload/drag/scroll. Supports waits, screenshots, PDF, console/network inspection and mocking, cookies, permissions, downloads, dialogs and emulation. Pass frame_id to script inside a cross-origin iframe. Read the chrome-integration skill for the full helper contract. Actions may modify websites. Dispatched actions cannot be rolled back by cancellation.',
        inputSchema: { type: 'object', properties: {
          tab_id: { type: 'string', minLength: 1 },
          code: { type: 'string', minLength: 1 },
          frame_id: { type: 'string', minLength: 1, description: 'Frame ID from a snapshot or browser.frames(); omit for the top document.' },
          snapshot: { type: 'boolean', description: 'Append the post-action snapshot (default true).' },
          timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000 },
        }, required: ['tab_id', 'code'], additionalProperties: false },
        annotations: { destructive: true, externalAccess: true },
        async execute(input, context) {
          const result = await bridge.runActions({ timeout_ms: timeout, ...input }, context.signal);
          let output = await saveFiles(result, context.workspacePath);
          if (result.openedTabs.length) output += `\n\nNew tabs opened by this action (tab_id): ${result.openedTabs.join(', ')}`;
          return {
            output,
            mediaContent: (result.images ?? []).map(({ data, mimeType }) => {
              if (!/^image\/(png|jpeg|webp)$/.test(mimeType) || !data) throw new Error('Chrome returned an invalid screenshot.');
              return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } };
            }),
          };
        },
      });
    },
  });
};
