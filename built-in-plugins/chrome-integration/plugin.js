import { readFile } from 'node:fs/promises';
import { ChromeBridge } from './bridge.js';

export default async ({ definePlugin }) => {
  let bridge;
  let storage;
  let timeout = 8000;
  return definePlugin({
    apiVersion: 2,
    id: 'chrome-integration',
    name: 'Chrome Integration',
    version: '1.0.0',
    description: 'Control real Chrome tabs through the bundled Avi extension, with snapshots, screenshots and debugging tools.',
    capabilities: ['tools.register', 'storage'],
    contributions: {
      context: [{ path: 'skills/chrome-integration/SKILL.md', content: await readFile(new URL('./skills/chrome-integration/SKILL.md', import.meta.url), 'utf8') }],
    },
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
        description: 'List live Chrome tabs across profiles connected to the Avi Chrome extension. Returns ephemeral tab_id, title, sanitized URL, state and controllable. Always call before acting; IDs expire on disconnect. An empty list means no profiles are connected or no tabs are open.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnly: true },
        async execute(_input, context) { return JSON.stringify(await bridge.getContext(context.signal)); },
      });
      avi.tools.register({
        name: 'chrome_run_actions',
        description: 'Run an async JavaScript function body in a live Chrome tab with the browser helper. Inspect first with return browser.snapshot(). Use document queries and observed getBoundingClientRect coordinates, then browser.leftClick/type/scroll/drag. Supports screenshots, console/network inspection, dialogs and emulation. Read the chrome-integration skill for the full helper contract. Actions may modify websites. Dispatched actions cannot be rolled back by cancellation.',
        inputSchema: { type: 'object', properties: {
          tab_id: { type: 'string', minLength: 1 }, code: { type: 'string', minLength: 1 },
          timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000 },
        }, required: ['tab_id', 'code'], additionalProperties: false },
        annotations: { destructive: true, externalAccess: true },
        async execute(input, context) {
          const result = await bridge.runActions({ timeout_ms: timeout, ...input }, context.signal);
          return {
            output: result.text,
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
