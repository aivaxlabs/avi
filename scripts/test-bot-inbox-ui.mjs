import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'bot-inbox-ui');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const moduleId = '\0bot-inbox-ui-test.jsx';
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuxiliaryPanel } from '/src/renderer/components/AuxiliaryPanel.jsx';
import '/src/renderer/styles.css';
window.__test = { replies: [], mode: 'success' };
window.chatApp = { files: { select: async () => [{ id: 'note', kind: 'text_inline', name: 'notes.txt', mime: 'text/plain', size: 10, text: 'Olá, ação.' }] }, app: { openExternal: () => {} } };
const pending = { id: 'pending', title: 'Choose the Acme invoice export format', status: 'open', messages: [{ id: 'm1', role: 'bot', content: 'I verified the Acme invoices. Should I send the export as **CSV** or **JSON**?', attachments: [], createdAt: '2026-09-04T15:00:00Z' }, { id: 'm2', role: 'bot', content: 'Which format preserves the original values?', attachments: [], createdAt: '2026-09-04T16:00:00Z' }], updatedAt: '2026-09-04T16:00:00Z', approval: null };
const other = { ...pending, id: 'other', title: 'Review the Acme export totals', updatedAt: '2026-09-04T14:00:00Z', messages: [{ ...pending.messages[0], id: 'm3', content: 'Please confirm the totals in the Acme invoice export.' }] };
const approval = { ...pending, id: 'approval', title: 'Publish the Acme report', approval: { id: 'approval-id', kind: 'tool', prompt: 'Publish the report to the shared workspace?', toolName: 'publish_report', workspacePath: 'C:/Acme', input: { report: 'invoices' } } };
createRoot(document.getElementById('root')).render(React.createElement(() => {
  const [inbox, setInbox] = useState([pending, other, approval]);
  const [errors, setErrors] = useState({ inbox: null, activity: null });
  window.__test.setErrors = setErrors;
  window.__test.setInbox = setInbox;
  return <AuxiliaryPanel sideChats={[]} subagents={[]} bots={[{ id: 'bot-1', name: 'Acme assistant' }]} botDataByBot={{ 'bot-1': { inbox, errors, error: errors.inbox || errors.activity, activity: [{ id: 'a1', title: 'I verified the Acme invoice export', description: 'I checked the invoice totals and found no differences. The export is ready for the format you choose.', category: 'completed', createdAt: '2026-09-04T14:00:00Z' }, { id: 'a2', title: 'I found an export encoding issue', description: 'I found that the Acme CSV export was dropping accented characters.', category: 'discovery', createdAt: '2026-09-04T13:00:00Z' }] } }} botQueueTabOpen selectedBotId="bot-1" activeTab="bot-queue" visibleMessagesByConversation={{}} visibleRunning={{}} models={[]} favorites={[]} recentModels={[]} recentProjects={[]} onSelectBot={() => {}} onClosePanel={() => {}}
    onReplyBotPendency={async (payload) => {
      window.__test.replies.push(payload);
      if (window.__test.mode === 'reject') throw new Error('Test save failed');
      const current = inbox.find((item) => item.id === payload.pendencyId);
      const item = { ...current, updatedAt: new Date().toISOString(), messages: [...current.messages, { id: crypto.randomUUID(), role: 'user', content: payload.content, attachments: payload.attachments, createdAt: new Date().toISOString() }] };
      setInbox((items) => items.map((value) => value.id === item.id ? item : value));
      return { item, delivered: window.__test.mode !== 'delivery-failed', ...(window.__test.mode === 'delivery-failed' ? { error: 'Model unavailable.' } : {}) };
    }}
    onCompleteBotPendency={async ({pendencyId}) => { const item = { ...inbox.find((value) => value.id === pendencyId), status: 'completed' }; setInbox((items) => items.map((value) => value.id === pendencyId ? item : value)); return item; }}
    onResolveBotApproval={async (id, decision) => { window.__test.decision = decision; setInbox((items) => items.map((item) => item.approval?.id === id ? { ...item, approval: null, messages: [...item.messages, { id: 'decision', role: 'user', content: decision ? 'Approved.' : 'Denied.', attachments: [], createdAt: new Date().toISOString() }] } : item)); return { delivered: true }; }} />;
}));
`;
let vite;
let window;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
try {
  vite = await createServer({
    root,
    server: { port: 0, host: '127.0.0.1', strictPort: false },
    plugins: [{
      name: 'bot-inbox-ui-test',
      resolveId(id) { if (id === '/bot-inbox-ui-test.jsx') return moduleId; },
      async load(id) { if (id === moduleId) return (await transformWithEsbuild(entry, 'bot-inbox-ui-test.jsx', { loader: 'jsx', jsx: 'transform' })).code; },
      configureServer(server) {
        server.middlewares.use('/__bot-inbox-test', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(await server.transformIndexHtml('/__bot-inbox-test', '<!doctype html><html data-theme="code" data-color-scheme="light"><head><meta charset="utf-8"><style>#root > .auxiliary-panel { width:100%; flex:1; }</style></head><body style="margin:0;background:var(--background-1)"><div id="root" style="width:100vw;height:100vh;display:flex"></div><script type="module" src="/bot-inbox-ui-test.jsx"></script></body></html>'));
        });
      },
    }],
  });
  await vite.listen();
  window = new BrowserWindow({ width: 580, height: 840, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, _level, message) => console.log(`Renderer: ${message}`));
  window.webContents.on('did-fail-load', (_event, code, description) => console.error(`Load failed: ${code} ${description}`));
  await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/__bot-inbox-test`);
  const results = await window.webContents.executeJavaScript(`(async () => {
    const checks = [];
    const check = (name, value) => { checks.push({ name, pass: Boolean(value) }); if (!value) throw new Error(name); };
    const wait = async (predicate) => { for (let i=0;i<100;i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('UI wait timed out'); };
    const button = (text, root = document) => [...root.querySelectorAll('button')].find(el => el.textContent.trim() === text);
    const setText = (value) => { const el = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); };
    await wait(() => document.getElementById('bot-pendency-pending'));
    check('Only Inbox and Activity tabs', [...document.querySelectorAll('.bot-work-tabs button')].map(el=>el.textContent).join('|') === 'Inbox|Activity');
    document.getElementById('bot-pendency-pending').click();
    await wait(() => document.querySelector('textarea'));
    check('Conversation has full date and time', document.querySelector('.bot-inbox-messages time').dateTime === '2026-09-04T16:00:00Z');
    const renderedMessages = [...document.querySelectorAll('.bot-inbox-messages li')].map((item) => item.textContent);
    check('Conversation messages show newest first', renderedMessages[0].includes('Which format preserves the original values?') && renderedMessages.at(-1).includes('I verified the Acme invoices.'));
    setText('Please use CSV.');
    await wait(() => document.querySelector('textarea').value === 'Please use CSV.');
    button('Inbox',document.querySelector('.bot-inbox-detail')).click();
    await wait(() => document.getElementById('bot-pendency-other'));
    document.getElementById('bot-pendency-other').click();
    await wait(() => document.querySelector('textarea'));
    check('Drafts isolated by pendency', document.querySelector('textarea').value === '');
    button('Inbox',document.querySelector('.bot-inbox-detail')).click();
    await wait(() => document.getElementById('bot-pendency-pending'));
    document.getElementById('bot-pendency-pending').click();
    await wait(() => document.querySelector('textarea')?.value === 'Please use CSV.');
    check('Draft survives navigation', true);
    button('Attach').click();
    await wait(() => document.querySelector('.bot-inbox-composer summary'));
    check('Inline text attachment retained', document.querySelector('.bot-inbox-composer pre').textContent === 'Olá, ação.');
    window.__test.mode = 'reject';
    button('Send reply').click();
    await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('Test save failed'));
    check('Save failure preserves draft and attachment', document.querySelector('textarea').value === 'Please use CSV.' && document.querySelector('.bot-inbox-composer summary').textContent === 'notes.txt');
    window.__test.mode = 'delivery-failed';
    button('Send reply').click();
    await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('Saved in Inbox'));
    check('Delivery failure records message once and clears submitted draft', document.querySelectorAll('.bot-inbox-messages li.from-user').length === 1 && document.querySelector('textarea').value === '');
    check('Payload carries inline attachment', window.__test.replies.at(-1).attachments[0].text === 'Olá, ação.');
    button('Complete').click();
    await wait(() => !document.querySelector('textarea'));
    check('Completed conversation has no reply composer', true);
    button('Activity').click();
    await wait(() => document.querySelector('.bot-diary-list'));
    check('Activity renders title description category date', document.querySelectorAll('.bot-diary-list li').length === 2 && document.querySelector('.bot-diary-list').textContent.includes('invoice totals'));
    const category = document.querySelector('.bot-inbox-filters select'); category.value = 'discovery'; category.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(() => document.querySelectorAll('.bot-diary-list li').length === 1);
    check('Activity category filter', document.querySelector('.bot-diary-list h3').textContent.includes('encoding'));
    document.getElementById('bot-work-tab-activity').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    await wait(() => document.querySelector('.bot-inbox-detail'));
    check('Keyboard tab navigation', document.getElementById('bot-work-tab-inbox').getAttribute('aria-selected') === 'true');
    button('Inbox',document.querySelector('.bot-inbox-detail')).click();
    await wait(() => document.getElementById('bot-pendency-approval'));
    document.getElementById('bot-pendency-approval').click();
    await wait(() => document.querySelector('.bot-inbox-approval'));
    check('Approval prevents ordinary completion', button('Complete').disabled);
    button('Deny').click();
    await wait(() => !document.querySelector('.bot-inbox-approval'));
    check('Explicit denial preserved', window.__test.decision === false);
    window.__test.setErrors({ inbox: null, activity: 'Invalid activity.title: expected non-empty string' });
    await new Promise(resolve => setTimeout(resolve, 50));
    check('Activity failure does not show in Inbox', !document.querySelector('.bot-work-warning'));
    document.getElementById('bot-work-tab-activity').click();
    await wait(() => document.querySelector('.bot-work-warning'));
    check('Activity failure has technical details', Boolean(document.querySelector('.bot-work-warning details')));
    check('Failed Activity does not claim to be empty', !document.querySelector('.bot-queue-empty'));
    window.__test.setErrors({ inbox: null, activity: null });
    document.getElementById('bot-work-tab-inbox').click();
    await wait(() => document.querySelector('.bot-inbox-detail'));
    return checks;
  })()`, true);
  for (const result of results) { console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`); assert.equal(result.pass, true); }
  await writeFile(join(artifacts, 'inbox.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('.bot-inbox-detail header button').click()`);
  for (const scheme of ['light', 'dark']) {
    for (const width of [320, 720]) {
      window.setContentSize(width, 740);
      await window.webContents.executeJavaScript(`document.documentElement.dataset.colorScheme = '${scheme}'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      const layout = await window.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('.bot-queue');
        const filters = document.querySelector('.bot-inbox-filters');
        return { panelFits: panel.scrollWidth <= panel.clientWidth + 1, filtersFit: filters.scrollWidth <= filters.clientWidth + 1 };
      })()`);
      assert.ok(layout.panelFits && layout.filtersFit, `Inbox layout must fit at ${width}px in ${scheme}`);
      await writeFile(join(artifacts, `inbox-${scheme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  results.push({ name: 'Inbox fits narrow and wide panels in light and dark themes', pass: true });
  await window.webContents.executeJavaScript(`window.__test.setInbox([]); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await writeFile(join(artifacts, 'inbox-empty-dark.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.documentElement.dataset.colorScheme = 'light'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await writeFile(join(artifacts, 'inbox-empty-light.png'), (await window.webContents.capturePage()).toPNG());
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Bot Inbox UI passed. Artifacts: ${artifacts}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  window?.destroy();
  await vite?.close();
  app.exit(process.exitCode || 0);
}
});
