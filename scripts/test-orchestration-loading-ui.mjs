import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'orchestration-loading');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OrchestrationPage } from '/src/renderer/components/OrchestrationPage.jsx';
import '/src/renderer/styles.css';
const inbox = Array.from({ length: 125 }, (_, index) => ({
  id: 'pendency-' + index,
  title: 'Task ' + index,
  status: 'open',
  updatedAt: new Date(Date.now() - index * 1000).toISOString(),
  messages: [{ role: 'bot', content: index === 0 ? 'x'.repeat(400) : 'Message ' + index }],
}));
window.fixture = { overviewCalls: 0, overviewResolvers: [], botRefreshCalls: 0, botRefreshResolved: false, resolveBots: null };
window.chatApp = { orchestration: { overview: () => {
  window.fixture.overviewCalls += 1;
  return new Promise(resolve => { window.fixture.overviewResolvers.push(resolve); });
} } };
function Harness() {
  return <OrchestrationPage models={[]} bots={[{ id: 'fixture-bot', name: 'Fixture Bot' }]} botDataByBot={{ 'fixture-bot': { inbox } }} onRefreshBots={() => {
    window.fixture.botRefreshCalls += 1;
    return new Promise(resolve => { window.fixture.resolveBots = () => { window.fixture.botRefreshResolved = true; resolve(); }; });
  }} onOpenBotPendency={() => { window.fixture.opened = true; }} />;
}
createRoot(document.getElementById('root')).render(<Harness />);
`;
let server;
let win;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  try {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 5191, strictPort: false }, plugins: [{
      name: 'orchestration-loading-test',
      resolveId(id) { if (id === '/orchestration-loading-test.jsx') return '\0orchestration-loading-test'; },
      async load(id) { if (id === '\0orchestration-loading-test') return (await transformWithEsbuild(entry, 'orchestration-loading-test.jsx', { loader: 'jsx', jsx: 'automatic' })).code; },
      configureServer(vite) { vite.middlewares.use('/__orchestration-loading-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__orchestration-loading-test', '<!doctype html><html data-theme="code" data-color-scheme="dark"><body><div id="root"></div><script type="module" src="/orchestration-loading-test.jsx"></script></body></html>')); }); },
    }] });
    await server.listen();
    win = new BrowserWindow({ show: false, width: 1100, height: 850 });
    await win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://orb.aivax.net/*'] }, (details, callback) => callback({ cancel: true }));
    await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__orchestration-loading-test`);
    await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 200; i += 1) {
        if (window.fixture?.overviewResolvers.length === 1 && window.fixture.resolveBots && document.querySelector('.orchestration-inbox-row')) return true;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Orchestration UI did not mount');
    })()`);
    assert.equal(await win.webContents.executeJavaScript('window.fixture.overviewCalls'), 1, 'overview loads once on mount');
    assert.equal(await win.webContents.executeJavaScript('window.fixture.botRefreshCalls'), 1, 'bot refresh starts independently on mount');
    assert.equal(await win.webContents.executeJavaScript(`window.fixture.overviewResolvers.length === 1 && window.fixture.resolveBots !== null && !window.fixture.botRefreshResolved`), true, 'both mount requests remain pending');
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.orchestration-inbox-row').length"), 50, 'initial inbox is limited to 50 rows');
    assert.equal(await win.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('input[type="search"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Task 124');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      const rows = document.querySelectorAll('.orchestration-inbox-row');
      if (rows.length !== 1 || !rows[0].textContent.includes('Task 124')) throw new Error('Inbox search is not interactive while overview is pending');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      return document.querySelectorAll('.orchestration-inbox-row').length;
    })()`), 50, 'search returns to 50-row initial limit');
    assert.equal(await win.webContents.executeJavaScript(`(async () => {
      const select = document.querySelector('select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'completed');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      if (document.querySelectorAll('.orchestration-inbox-row').length !== 0) throw new Error('Status filter did not apply');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'all');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      return document.querySelectorAll('.orchestration-inbox-row').length;
    })()`), 50, 'status filter restores rows and limit');
    await win.webContents.executeJavaScript(`document.querySelector('.orchestration-inbox').querySelector('.orchestration-refresh')?.click()`);
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.orchestration-inbox-row').length"), 100, 'Show more adds 50 rows');
    const previewLength = await win.webContents.executeJavaScript("document.querySelector('.orchestration-inbox-copy > span').textContent.length");
    assert.ok(previewLength <= 243, `inbox preview must be at most 240 characters plus three dots (got ${previewLength})`);
    assert.equal(await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('[role="tab"][aria-selected="false"]')?.click();
      document.querySelectorAll('[role="tab"]')[1].click();
      await new Promise(resolve => setTimeout(resolve, 30));
      return window.fixture.overviewCalls;
    })()`), 1, 'switching Tasks/Models does not refetch initial overview');
    assert.equal(await win.webContents.executeJavaScript(`(async () => {
      window.fixture.overviewResolvers[0](null);
      await new Promise(resolve => setTimeout(resolve, 50));
      if (window.fixture.botRefreshResolved) throw new Error('Bot refresh resolved before its promise was released');
      window.fixture.resolveBots();
      await new Promise(resolve => setTimeout(resolve, 50));
      return JSON.stringify({ overviewCalls: window.fixture.overviewCalls, botRefreshResolved: window.fixture.botRefreshResolved });
    })()`), '{"overviewCalls":1,"botRefreshResolved":true}', 'both deferred mount requests resolve independently');
    console.log('Orchestration loading Electron UI tests passed. Artifacts: ' + artifacts);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    win?.destroy();
    await server?.close();
    app.exit(process.exitCode || 0);
  }
});
