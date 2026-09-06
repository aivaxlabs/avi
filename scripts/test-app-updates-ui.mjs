import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'updates-ui');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPage } from '/src/renderer/components/SettingsPage.jsx';
import { Sidebar } from '/src/renderer/components/Sidebar.jsx';
import '/src/renderer/styles.css';
window.__calls = [];
window.chatApp = { tuning: { shells: async () => [] }, app: {
  checkForUpdates: async () => { window.__calls.push('check'); },
  installUpdate: async () => { window.__calls.push('install'); if(window.__fail) throw new Error('Download failed'); }
}};
const root = createRoot(document.getElementById('root'));
window.renderUpdate = (state) => root.render(<div style={{display:'flex',height:'100vh'}}>
  <Sidebar conversations={[]} running={{}} completedUnseen={{}} updateState={state} onSettings={()=>{}} />
  <SettingsPage providers={[]} providerTypes={[]} models={[]} tuning={{terminalShell:'auto',verbosity:'medium'}} appearance={{scheme:'dark'}} desktop={{}} updateState={state} />
</div>);
window.renderUpdate({status:'available',supported:true,available:true,latestVersion:'0.7.0',currentVersion:'0.6.0'});
`;
let server;
let window;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'updates-test',
    resolveId(id) { if (id === '/updates-test.jsx') return '\0updates-test'; },
    async load(id) { if (id === '\0updates-test') return (await transformWithEsbuild(entry, 'updates-test.jsx', { loader: 'jsx', jsx: 'transform' })).code; },
    configureServer(vite) { vite.middlewares.use('/__updates', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/__updates', '<html data-theme="code" data-color-scheme="dark"><body><div id="root"></div><script type="module" src="/updates-test.jsx"></script></body></html>'));
    }); },
  }] });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, _level, message) => console.log(message));
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__updates`);
  const passed = await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate) => { for(let i=0;i<150;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,20)); } throw new Error('UI timeout'); };
    const button = (text) => [...document.querySelectorAll('.settings-update button')].find(el=>el.textContent.trim()===text);
    await wait(()=>button('Install update'));
    if(!document.querySelector('.settings-update.available') || !document.querySelector('.settings-update-badge')) throw new Error('Update indicators missing');
    button('Install update').click();
    await wait(()=>window.__calls.includes('install'));
    window.renderUpdate({status:'downloading',available:true,supported:true,progress:42,latestVersion:'0.7.0'});
    await wait(()=>document.querySelector('progress')?.value===42);
    if([...document.querySelectorAll('.settings-update button')].some(el=>!el.disabled)) throw new Error('Busy buttons enabled');
    window.renderUpdate({status:'error',available:true,supported:true,error:'Digest mismatch',latestVersion:'0.7.0'});
    await wait(()=>button('Install update') && !button('Install update').disabled);
    if(!document.querySelector('.settings-update [role=alert]').textContent.includes('Digest mismatch')) throw new Error('Error missing');
    window.__fail=true;
    button('Install update').click();
    await wait(()=>document.querySelector('.settings-update [role=alert]')?.textContent==='Download failed');
    button('Check for updates').click();
    await wait(()=>window.__calls.includes('check'));
    window.renderUpdate({status:'idle',available:false,supported:false,unsupportedReason:'Development build'});
    await wait(()=>!document.querySelector('.settings-update-badge'));
    await wait(()=>!document.querySelector('.settings-update'));
    const about = [...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='About');
    about.click();
    await wait(()=>button('Check for updates'));
    if(!button('Check for updates').disabled || button('Install update')) throw new Error('Unsupported install enabled');
    window.renderUpdate({status:'idle',available:false,supported:true,latestVersion:'0.6.0',currentVersion:'0.6.0'});
    await wait(()=>button('Check for updates') && !button('Check for updates').disabled);
    if(!document.querySelector('.settings-update').textContent.includes('up to date')) throw new Error('About update status missing');
    return true;
  })()`);
  assert.equal(passed, true);
  console.log('Updater Electron UI tests passed.');
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
