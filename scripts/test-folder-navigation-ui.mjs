import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'folder-filter');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FolderNavigation } from '/src/renderer/components/FolderNavigation.jsx';
import '/src/renderer/styles.css';
window.chatApp = { folders: { list: async () => Array.from({ length: 80 }, (_, i) => ({ name: i === 0 ? 'A'.repeat(180) : 'Folder ' + i, path: '/projects/project-' + i, displayPath: '/projects/project-' + i })) } };
function Harness() {
  const [selectedFolder, setFolder] = useState(null);
  return <section className="settings-page folders-page" style={{ height: '100vh' }}><FolderNavigation homeFolder={{path:'/home'}} selectedFolder={selectedFolder} view="folder-threads" onSelectFolder={setFolder} onSelectView={()=>{}} /><main className="settings-main">Content</main></section>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`;
let server;
let win;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5189, strictPort: false }, plugins: [{
    name: 'folder-filter-test',
    resolveId(id) { if (id === '/folder-test.jsx') return '\0folder-test'; },
    async load(id) { if (id === '\0folder-test') return (await transformWithEsbuild(entry, 'folder-test.jsx', { loader: 'jsx', jsx: 'automatic' })).code; },
    configureServer(vite) { vite.middlewares.use('/__folder-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__folder-test', '<!doctype html><html data-theme="code" data-color-scheme="dark"><body><div id="root"></div><script type="module" src="/folder-test.jsx"></script></body></html>')); }); },
  }] });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 900, height: 500 });
  win.webContents.on('console-message', (_event, _level, message) => console.log(message));
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__folder-test`);
  assert.equal(await win.webContents.executeJavaScript(`(async () => {
    const wait = async (fn) => { for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI timeout'); };
    const rows = () => document.querySelectorAll('[aria-label="Working folders"] > button');
    await wait(()=>rows().length===80);
    const sidebar = document.querySelector('.folder-navigation');
    const scroll = document.querySelector('.folder-navigation-scroll');
    const global = document.querySelector('.folder-global');
    const input = document.querySelector('input');
    const top = global.getBoundingClientRect().top;
    if(scroll.scrollHeight<=scroll.clientHeight)throw new Error('List is not scrollable');
    if(sidebar.scrollWidth>sidebar.clientWidth+1 || scroll.scrollWidth>scroll.clientWidth+1)throw new Error('Horizontal overflow');
    scroll.scrollTop=scroll.scrollHeight;
    if(global.getBoundingClientRect().top!==top || input.getBoundingClientRect().top<0)throw new Error('Pinned controls moved');
    const set = (value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); };
    set('  PROJECT-79  ');
    await wait(()=>rows().length===1);
    if(rows()[0].textContent!=='Folder 79')throw new Error('Path filter failed');
    set('not-found');
    await wait(()=>document.body.textContent.includes('No folders match your filter.'));
    if(!global.checkVisibility())throw new Error('Global hidden by filter');
    set('Folder 12'); await wait(()=>rows().length===1);
    rows()[0].click(); await wait(()=>document.querySelector('[aria-label="Folder sections"]'));
    document.querySelector('.settings-back').click(); await wait(()=>document.querySelector('input'));
    if(document.querySelector('input').value!=='Folder 12' || rows().length!==1)throw new Error('Filter lost on back');
    return true;
  })()`), true);
  await win.setSize(700, 420);
  await win.webContents.executeJavaScript(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const fits = await win.webContents.executeJavaScript(`(()=>{const s=document.querySelector('.folder-navigation'); return s.scrollWidth<=s.clientWidth+1 && s.getBoundingClientRect().bottom<=innerHeight+1;})()`);
  assert.ok(fits, 'Narrow sidebar must fit its bounds');
  await writeFile(join(artifacts, 'folders-filter.png'), (await win.webContents.capturePage()).toPNG());
  console.log('Folder overflow and filter UI tests passed. Artifacts: ' + artifacts);
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
