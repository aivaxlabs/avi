import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'search-dialog');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));

const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SearchDialog } from '/src/renderer/components/SearchDialog.jsx';
import '/src/renderer/styles.css';

const hour = 3600000;
const now = Date.now();
const folders = [
  ['/home/user', '~/', '~/'],
  ['/home/user/projects/sisk', 'sisk', '~/projects/sisk'],
  ['/home/user/projects/avi-desktop', 'avi-desktop', '~/projects/avi-desktop'],
];
const conversations = Array.from({ length: 16 }, (_, index) => {
  const [projectPath, projectName, projectDisplayPath] = folders[index % 3];
  return {
    id: 'c' + index,
    title: index === 0 ? 'Sisk routing and middleware review with a deliberately long title to test truncation' : 'Thread ' + index,
    firstPrompt: 'Prompt for thread ' + index,
    projectPath,
    projectName,
    projectDisplayPath,
    createdAt: new Date(now - (index * 3 + 1) * 24 * hour).toISOString(),
    updatedAt: new Date(now - index * 5 * hour).toISOString(),
    createdBy: index === 4 ? 'agent' : 'user',
    workStatus: index === 3 ? 'blocked' : null,
    needsAttention: false,
  };
});
window.searchCalls = [];
window.chatApp = {
  conversations: {
    search: async (payload) => {
      window.searchCalls.push(payload);
      return conversations
        .filter((conversation) => !payload.folderPath || conversation.projectPath === payload.folderPath)
        .slice(0, 3)
        .map((conversation) => ({
          score: 1,
          conversationId: conversation.id,
          title: conversation.title,
          role: 'user',
          content: 'We configured the Sisk router and then compared middleware ordering in detail.',
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          folderPath: conversation.projectPath,
          folderName: conversation.projectName,
          folderDisplayPath: conversation.projectDisplayPath,
        }));
    },
  },
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <main style={{ height: '100vh' }}>
      <button id="opener" type="button" onClick={() => setOpen(true)}>Open</button>
      {open && (
        <SearchDialog
          conversations={conversations}
          folderColors={{ '/home/user/projects/sisk': '#3b82f6' }}
          running={{ c1: true }}
          approvalPending={{ c2: true }}
          completedUnseen={{ c5: true }}
          onClose={() => setOpen(false)}
          onSelect={(id) => { window.selected = id; }}
        />
      )}
    </main>
  );
}
window.openSearch = () => {
  const opener = document.getElementById('opener');
  opener.focus();
  opener.click();
};
createRoot(document.getElementById('root')).render(<React.StrictMode><Harness /></React.StrictMode>);
`;

const themes = [
  ['axion', 'light'],
  ['axion', 'dark'],
  ['code', 'dark'],
  ['code', 'light'],
];
let server;
let win;
const timeout = setTimeout(() => app.exit(2), 90000);

app.whenReady().then(async () => {
  try {
    server = await createServer({
      root,
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 5191, strictPort: false },
      plugins: [{
        name: 'search-dialog-test',
        resolveId(id) {
          if (id === '/search-test.jsx') return '\0search-test';
        },
        async load(id) {
          if (id !== '\0search-test') return undefined;
          return (await transformWithEsbuild(entry, 'search-test.jsx', { loader: 'jsx', jsx: 'automatic' })).code;
        },
        configureServer(vite) {
          vite.middlewares.use('/__search-test', async (req, res) => {
            const url = new URL(req.url, 'http://localhost');
            const theme = url.searchParams.get('theme');
            const scheme = url.searchParams.get('scheme');
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/__search-test', `<!doctype html><html data-theme="${theme}" data-color-scheme="${scheme}" class="${scheme}"><body><div id="root"></div><script type="module" src="/search-test.jsx"></script></body></html>`));
          });
        },
      }],
    });
    await server.listen();
    const port = server.httpServer.address().port;
    win = new BrowserWindow({
      show: false,
      width: 960,
      height: 720,
      webPreferences: { backgroundThrottling: false },
    });
    win.webContents.on('console-message', (_event, _level, message) => console.log(message));

    for (const [theme, scheme] of themes) {
      await win.loadURL(`http://127.0.0.1:${port}/__search-test?theme=${theme}&scheme=${scheme}`);
      const first = theme === themes[0][0] && scheme === themes[0][1];
      const result = await win.webContents.executeJavaScript(`(async () => {
        const wait = async (fn, label) => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error('UI timeout: ' + label); };
        const rows = () => [...document.querySelectorAll('#chat-search-results [role="option"]')];
        await wait(() => document.getElementById('opener'), 'harness');
        window.openSearch();
        await wait(() => rows().length === 12, 'recent list');
        await new Promise((r) => setTimeout(r, 100));
        const input = document.querySelector('.search-dialog input');
        if (document.activeElement !== input) throw new Error('Initial focus is not on the input');
        const text = document.querySelector('.search-results').textContent;
        for (const label of ['Recent chats', 'Working', 'Awaiting approval', 'Blocked', 'Completed']) {
          if (!text.includes(label)) throw new Error('Missing ' + label);
        }
        const dialog = document.querySelector('.search-dialog');
        if (dialog.scrollWidth > dialog.clientWidth + 1) throw new Error('Horizontal overflow');
        if (!${first}) return 'screenshot';

        const key = (target, key, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
        key(input, 'ArrowDown');
        await wait(() => rows()[1].getAttribute('aria-selected') === 'true', 'arrow down');
        if (input.getAttribute('aria-activedescendant') !== 'chat-search-result-1') throw new Error('activedescendant not updated');

        const folder = document.querySelector('select[aria-label="Folder"]');
        const setSelect = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
        setSelect(folder, '/home/user/projects/sisk');
        await wait(() => rows().length === 5, 'folder filter on recent');
        if (!document.querySelector('.search-filters .button')) throw new Error('Reset not shown');

        const setInput = (value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
        setInput('sisk router');
        await wait(() => window.searchCalls.length === 1 && rows().length === 3, 'search results');
        const call = window.searchCalls[0];
        if (call.query !== 'sisk router' || call.folderPath !== '/home/user/projects/sisk' || call.sort !== 'relevance' || call.createdAfter !== null) {
          throw new Error('Unexpected payload ' + JSON.stringify(call));
        }
        if (!document.querySelector('.search-results mark')) throw new Error('Missing highlight');

        setSelect(document.querySelector('select[aria-label="Created"]'), 'week');
        setSelect(document.querySelector('select[aria-label="Sort by"]'), 'created');
        await wait(() => window.searchCalls.length === 2, 'filtered search');
        const filtered = window.searchCalls[1];
        if (filtered.sort !== 'created' || !(Date.now() - new Date(filtered.createdAfter).getTime() > 6.9 * 24 * 3600000)) {
          throw new Error('Unexpected filtered payload ' + JSON.stringify(filtered));
        }

        const focusable = [...dialog.querySelectorAll('input, select, button:not(:disabled)')].filter((el) => el.getClientRects().length && el.tabIndex >= 0);
        focusable.at(-1).focus();
        key(focusable.at(-1), 'Tab');
        if (document.activeElement !== focusable[0]) throw new Error('Tab is not contained');
        key(focusable[0], 'Tab', { shiftKey: true });
        if (document.activeElement !== focusable.at(-1)) throw new Error('Shift+Tab is not contained');

        input.focus();
        key(input, 'Enter');
        await wait(() => window.selected === 'c1' && !document.querySelector('.search-dialog'), 'enter selects');
        document.getElementById('opener').focus();
        document.getElementById('opener').click();
        await wait(() => document.querySelector('.search-dialog'), 'reopen');
        key(document.querySelector('.search-dialog input'), 'Escape');
        await wait(() => !document.querySelector('.search-dialog') && document.activeElement?.id === 'opener', 'escape restores focus');
        document.getElementById('opener').click();
        await wait(() => rows().length === 12, 'reopened list');
        return 'interactions';
      })()`);
      if (first) assert.equal(result, 'interactions');
      await win.webContents.executeJavaScript(`(async () => {
        const input = document.querySelector('.search-dialog input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'sisk');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        for (let i = 0; i < 200 && !document.querySelector('.search-results mark'); i++) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 300));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      })()`);
      await writeFile(join(artifacts, `${theme}-${scheme}-results.png`), (await win.webContents.capturePage()).toPNG());
      await win.loadURL(`http://127.0.0.1:${port}/__search-test?theme=${theme}&scheme=${scheme}`);
      await win.webContents.executeJavaScript(`(async () => { for (let i = 0; i < 200 && !document.getElementById('opener'); i++) await new Promise((r) => setTimeout(r, 20)); window.openSearch(); for (let i = 0; i < 200 && document.querySelectorAll('[role="option"]').length < 12; i++) await new Promise((r) => setTimeout(r, 20)); await new Promise((r) => setTimeout(r, 300)); })()`);
      await writeFile(join(artifacts, `${theme}-${scheme}-recent.png`), (await win.webContents.capturePage()).toPNG());
    }

    await win.setSize(520, 640);
    await win.webContents.executeJavaScript(`new Promise((r) => setTimeout(r, 300))`);
    const fits = await win.webContents.executeJavaScript(`(() => { const d = document.querySelector('.search-dialog'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1; })()`);
    assert.ok(fits, 'Narrow search dialog must fit its bounds');
    await writeFile(join(artifacts, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
    console.log('Search dialog UI tests passed. Artifacts: ' + artifacts);
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
