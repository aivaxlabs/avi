import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'remote-settings-ui');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteSettings } from '/src/renderer/components/RemoteSettings.jsx';
import '/src/renderer/styles.css';
window.__calls = [];
const keys = [
  { id: 'k1', label: 'Workspace', value: 'ws9k2m', createdAt: new Date('2026-01-01T12:00:00Z').getTime(), expiresAt: null },
  { id: 'k2', label: 'Legacy key', value: 'b68df35a-9c31-4f57-a2ce-e07a6f8f83d0', createdAt: new Date('2025-06-01T12:00:00Z').getTime(), expiresAt: null },
];
window.chatApp = { remote: {
  state: async () => ({
    enabled: true,
    port: 18992,
    running: true,
    relayEnabled: true,
    relayDeviceId: 'device-uuid-1',
    instanceId: 'ab12cd34ef',
    relay: { status: 'connected', mcpUrl: 'wss://relay/mcp/device-uuid-1' },
    apiKeys: keys,
  }),
  save: async (value) => { window.__calls.push(['save', value]); return value; },
  createKey: async (payload) => { window.__calls.push(['createKey', payload]); return null; },
  copyKey: async (id) => { window.__calls.push(['copyKey', id]); return { copied: true }; },
  copyInstanceKey: async (id) => { window.__calls.push(['copyInstanceKey', id]); return { copied: true }; },
  removeKey: async (id) => {
    window.__calls.push(['removeKey', id]);
    const index = keys.findIndex((key) => key.id === id);
    if (index >= 0) keys.splice(index, 1);
  },
}};
const root = createRoot(document.getElementById('root'));
root.render(<RemoteSettings />);
`;
let server;
let window;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{
    name: 'remote-settings-test',
    resolveId(id) { if (id === '/remote-settings-test.jsx') return '\0remote-settings-test'; },
    async load(id) { if (id === '\0remote-settings-test') return (await transformWithEsbuild(entry, 'remote-settings-test.jsx', { loader: 'jsx', jsx: 'transform' })).code; },
    configureServer(vite) { vite.middlewares.use('/__remote-settings', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/__remote-settings', '<html data-theme="code" data-color-scheme="dark"><body><div id="root"></div><script type="module" src="/remote-settings-test.jsx"></script></body></html>'));
    }); },
  }] });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, _level, message) => console.log(message));
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__remote-settings`);
  const passed = await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label = 'unlabeled') => { for(let i=0;i<150;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,20)); } throw new Error('UI timeout: ' + label); };
    const page = () => document.querySelector('.remote-settings');
    const text = () => page().textContent;
    const trigger = (label) => [...document.querySelectorAll('.remote-key-menu > button[aria-haspopup=menu]')].find((el) => el.getAttribute('aria-label') === label);
    const openMenu = async (label) => {
      await wait(() => !document.querySelector('[role=menu]'), 'menu closed before opening ' + label);
      await wait(() => trigger(label) && !trigger(label).disabled, 'trigger enabled ' + label);
      trigger(label).click();
      await wait(() => document.querySelector('[role=menu]'), 'open menu ' + label);
      return document.querySelector('[role=menu]');
    };
    const menuItem = (menu, label) => [...menu.querySelectorAll('[role=menuitem]')].find((el) => el.textContent.trim() === label);

    await wait(() => text().includes('Instance ID: ab12cd34ef'), 'instance id rendered');
    if (!text().includes('Device ID: device-uuid-1')) throw new Error('Device ID missing');
    if (!text().includes('Public MCP URL: https://avi-relay.projpw.workers.dev/mcp')) throw new Error('Public MCP URL missing');
    const details = document.querySelector('[aria-labelledby="remote-connect-heading"]');
    if (!details || document.querySelector('.remote-settings details')) throw new Error('Connection guide must be permanently visible');
    if (details.querySelector('strong').textContent !== 'How to connect') throw new Error('Guide label missing');
    const remoteSection = document.querySelector('section[aria-labelledby="aivax-remote-heading"]');
    if (!remoteSection || !remoteSection.contains(details)) throw new Error('Remote must have its own section and connection guide');
    if (remoteSection.contains(document.querySelector('.remote-port-input'))) throw new Error('Local server controls must remain separate');
    if (details.closest('.settings-card-row').querySelector('input')) throw new Error('Connection guide must be separate from controls');
    if (!details.textContent.includes('Pass instanceKey with every tool call')) throw new Error('Per-call instanceKey explanation missing');
    if (!details.textContent.includes('Authenticate with your AIVAX bearer token')) throw new Error('Device URL auth explanation missing');
    if (!details.getBoundingClientRect().height) throw new Error('Connection guide is hidden');
    if (!text().includes('New keys are 6 characters')) throw new Error('New key format hint missing');

    const first = await openMenu('API key actions for Workspace');
    if (!menuItem(first, 'Copy API key')) throw new Error('Copy API key item missing');
    if (!menuItem(first, 'Copy MCP instance key')) throw new Error('Copy MCP instance key item missing');
    if (first.querySelectorAll('.dropdown-menu-divider').length !== 1) throw new Error('Menu separator missing');
    if (!menuItem(first, 'Delete')) throw new Error('Delete item missing');
    if (trigger('API key actions for Workspace').getAttribute('aria-expanded') !== 'true') throw new Error('aria-expanded not set');

    menuItem(first, 'Copy API key').click();
    await wait(() => window.__calls.some(([name, id]) => name === 'copyKey' && id === 'k1'), 'copyKey k1');
    await wait(() => !document.querySelector('[role=menu]'), 'menu closed after copy');
    await wait(() => [...document.querySelectorAll('[role=status]')].some((el) => el.textContent === 'Copied API key'), 'copied api status');

    const menu2 = await openMenu('API key actions for Workspace');
    menuItem(menu2, 'Copy MCP instance key').click();
    await wait(() => window.__calls.some(([name, id]) => name === 'copyInstanceKey' && id === 'k1'), 'copyInstanceKey k1');
    await wait(() => [...document.querySelectorAll('[role=status]')].some((el) => el.textContent === 'Copied MCP instance key'), 'copied instance status');

    const menu3 = await openMenu('API key actions for Legacy key');
    menuItem(menu3, 'Copy API key').click();
    await wait(() => window.__calls.some(([name, id]) => name === 'copyKey' && id === 'k2'), 'copyKey k2');

    const menu4 = await openMenu('API key actions for Legacy key');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wait(() => !document.querySelector('[role=menu]'), 'escape closes');
    if (trigger('API key actions for Legacy key').getAttribute('aria-expanded') !== 'false') throw new Error('aria-expanded not cleared on Escape');

    const menu5 = await openMenu('API key actions for Legacy key');
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await wait(() => !document.querySelector('[role=menu]'), 'outside click closes');

    const menu6 = await openMenu('API key actions for Legacy key');
    menuItem(menu6, 'Delete').click();
    await wait(() => window.__calls.some(([name, id]) => name === 'removeKey' && id === 'k2'), 'removeKey k2');
    await wait(() => !trigger('API key actions for Legacy key'), 'legacy trigger removed');
    if (document.querySelectorAll('.remote-key-menu').length !== 1) throw new Error('Deleted key row still rendered');
    return true;
  })()`);
  assert.equal(passed, true);
  console.log('Remote settings UI tests passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  window?.destroy();
  await server?.close();
  app.exit(process.exitCode || 0);
}
});
