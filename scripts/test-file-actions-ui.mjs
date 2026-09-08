import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'file-actions-ui');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Message } from '/src/renderer/components/Message.jsx';
import '/src/renderer/styles.css';
window.__calls = [];
window.chatApp = {};
createRoot(document.getElementById('root')).render(<Message
  message={{ id: 'test', role: 'assistant', status: 'completed',
    content: ':fileref{path="./example.txt"} [Local](file:///C:/My%20Files/example.txt)',
    segments: [], attachments: [], continuations: [], usage: {},
    edits: [{filePath: 'C:/My Files/example.txt', before: 'before', after: 'after'}],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z' }}
  modelName="Test" workedMessages={[]} runActive={false} questionPending={false}
  onOpenFileReference={(ref) => window.__calls.push(['open', ref.path])}
  onOpenFileEdit={(ref) => window.__calls.push(['edit', ref.path])}
  onFileReferenceAction={(action, ref) => window.__calls.push([action, ref.path])}
/>);
`;
let server;
let window;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'file-actions-test',
    resolveId(id) { if (id === '/file-actions-test.jsx') return '\0file-actions-test'; },
    async load(id) { if (id === '\0file-actions-test') return (await transformWithEsbuild(entry, 'file-actions-test.jsx', { loader: 'jsx', jsx: 'transform' })).code; },
    configureServer(vite) { vite.middlewares.use('/__file-actions', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/__file-actions', '<html><body><div id="root"></div><script type="module" src="/file-actions-test.jsx"></script></body></html>'));
    }); },
  }] });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { backgroundThrottling: false } });
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__file-actions`);
  assert.equal(await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate) => { for (let i=0;i<150;i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,20)); } throw new Error('UI timeout'); };
    await wait(() => document.querySelector('.edit-summary-files button'));
    const targets = [...document.querySelectorAll('.file-reference-link'), document.querySelector('.edit-summary-files button')];
    if (targets.length !== 3) throw new Error('Missing file links or edit summary');
    for (const target of targets) {
      for (const [index, expected] of ['Open', 'Copy path', 'Open in explorer'].entries()) {
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
        await wait(() => document.querySelector('[role=menu]'));
        const items = [...document.querySelectorAll('[role=menuitem]')];
        if (items.map(el=>el.textContent.trim()).join('|') !== 'Open|Copy path|Open in explorer') throw new Error('Wrong menu');
        const before = window.__calls.length;
        items[index].click();
        await wait(() => !document.querySelector('[role=menu]'));
        if (window.__calls.length !== before + 1) throw new Error('Missing action: ' + expected);
      }
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await wait(() => document.querySelector('[role=menu]'));
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      if (document.activeElement.textContent.trim() !== 'Copy path') throw new Error('Arrow navigation failed');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(() => !document.querySelector('[role=menu]'));
      if (document.activeElement !== target) throw new Error('Focus not restored');
    }
    targets[1].click();
    if (window.__calls.at(-1)[1] !== 'file:///C:/My%20Files/example.txt') throw new Error('File URL changed');
    return true;
  })()`), true);
  console.log('File actions UI tests passed.');
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
