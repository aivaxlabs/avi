import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'activity-counts');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityBar } from '/src/renderer/components/ActivityBar.jsx';
import '/src/renderer/styles.css';
function Harness() {
  const [active, setActive] = useState('home');
  const [counts, setCounts] = useState({ home: 120, inbox: 7 });
  window.setCounts = setCounts;
  return <div className="app-shell"><ActivityBar active={active} onSelect={setActive} counts={counts} updateAvailable /><div className="app-composer">{active}</div></div>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`;
let server;
let win;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5190, strictPort: false }, plugins: [{
    name: 'activity-test',
    resolveId(id) { if (id === '/activity-test.jsx') return '\0activity-test'; },
    async load(id) { if (id === '\0activity-test') return (await transformWithEsbuild(entry, 'activity-test.jsx', { loader: 'jsx', jsx: 'automatic' })).code; },
    configureServer(vite) { vite.middlewares.use('/__activity-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__activity-test', '<!doctype html><html data-theme="code" data-color-scheme="dark"><body><div id="root"></div><script type="module" src="/activity-test.jsx"></script></body></html>')); }); },
  }] });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 700, height: 500 });
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__activity-test`);
  await win.webContents.executeJavaScript(`(async () => {
    for(let i=0;i<150;i++) { if(document.querySelector('.activity-count-badge')) return; await new Promise(r=>setTimeout(r,20)); }
    throw new Error('UI timeout');
  })()`);
  for (const scheme of ['light', 'dark']) {
    for (const opaque of [false, true]) {
      assert.equal(await win.webContents.executeJavaScript(`(async () => {
        document.documentElement.dataset.colorScheme = '${scheme}';
        document.documentElement.dataset.transparencyMode = '${opaque ? 'opaque' : 'transparent'}';
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const rail = document.querySelector('.activity-bar').getBoundingClientRect();
        for (const badge of document.querySelectorAll('.activity-count-badge')) {
          const rect = badge.getBoundingClientRect();
          if(rect.left < rail.left || rect.right > rail.right || rect.top < 0 || rect.bottom > innerHeight) throw new Error('Badge clipped');
          if(badge.scrollWidth > badge.clientWidth) throw new Error('Badge text overflow');
          const style = getComputedStyle(badge);
          if(style.color === style.backgroundColor) throw new Error('Unreadable badge');
        }
        if(document.documentElement.scrollWidth > innerWidth) throw new Error('Horizontal overflow');
        return true;
      })()`), true);
      await writeFile(join(artifacts, `${scheme}-${opaque ? 'opaque' : 'transparent'}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  assert.equal(await win.webContents.executeJavaScript(`(async () => {
    const buttons = document.querySelectorAll('.activity-bar > button');
    buttons[1].click();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    if(buttons[1].getAttribute('aria-current') !== 'page') throw new Error('Navigation failed');
    window.setCounts({ home: 0, inbox: 0 });
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    if(document.querySelector('.activity-count-badge')) throw new Error('Zero badge remains');
    window.setCounts({ home: 2, inbox: 101 });
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    if(buttons[1].title !== 'Inbox, 101 unread messages' || buttons[1].textContent !== '99+') throw new Error('Count update failed');
    buttons[0].focus();
    if(document.activeElement !== buttons[0]) throw new Error('Focus failed');
    return true;
  })()`), true);
  console.log('ActivityBar Electron UI tests passed. Artifacts: ' + artifacts);
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
