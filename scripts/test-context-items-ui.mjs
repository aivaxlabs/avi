import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'context-items');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ContextItems } from '/src/renderer/components/ContextItems.jsx';
import '/src/renderer/styles.css';
window.__opened = [];
const items = [
  { path: '/skills/parent/SKILL.md', relativePath: 'skills/parent/SKILL.md', title: 'Parent skill', description: 'Top level', activationMode: 'always-visible', invocationMode: null, tokenCount: 1532 },
  { path: '/skills/parent/child/SKILL.md', parentSkillPath: '/skills/parent/SKILL.md', relativePath: 'child/SKILL.md', title: 'Child skill', description: 'Nested once', activationMode: 'on-demand', invocationMode: 'user-only', tokenCount: 2345 },
  { path: '/skills/parent/child/deep/SKILL.md', parentSkillPath: '/skills/parent/child/SKILL.md', relativePath: 'deep/SKILL.md', title: 'Deep skill', description: 'Nested twice', activationMode: 'always-visible', invocationMode: 'assistant-only', tokenCount: 98765 },
  { path: '/skills/missing-parent/SKILL.md', parentSkillPath: '/skills/not-present/SKILL.md', relativePath: 'missing-parent/SKILL.md', title: 'Orphan skill', description: 'Must remain visible', activationMode: 'on-demand', invocationMode: null, tokenCount: 0 },
];
createRoot(document.getElementById('root')).render(<main className="settings-page" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}><ContextItems group={{ id: 'skill', items }} onOpen={(path) => window.__opened.push(path)} /></main>);
`;
let server;
let window;
const timeout = setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  try {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{
      name: 'context-items-test',
      resolveId(id) { if (id === '/context-items-test.jsx') return '\0context-items-test'; },
      async load(id) { if (id === '\0context-items-test') return (await transformWithEsbuild(entry, 'context-items-test.jsx', { loader: 'jsx', jsx: 'transform' })).code; },
      configureServer(vite) { vite.middlewares.use('/__context-items', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await vite.transformIndexHtml('/__context-items', '<html lang="en" data-theme="code" data-color-scheme="dark"><body><div id="root"></div><script type="module" src="/context-items-test.jsx"></script></body></html>'));
      }); },
    }] });
    await server.listen();
    window = new BrowserWindow({ show: true, width: 1100, height: 760, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, _level, message) => console.log(message));
    await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__context-items`);
    await window.webContents.executeJavaScript(`(async () => {
      const wait = async (predicate, label) => { for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error('UI timeout: ' + label); };
      const entries = () => [...document.querySelectorAll('.settings-context-item')];
      const byTitle = (title) => entries().find((button) => button.querySelector('strong')?.textContent === title);
      await wait(() => byTitle('Parent skill') && byTitle('Deep skill') && byTitle('Orphan skill'), 'all context items rendered');
      const parent = byTitle('Parent skill');
      const child = byTitle('Child skill');
      const deep = byTitle('Deep skill');
      const orphan = byTitle('Orphan skill');
      if (parent.querySelector('.settings-context-relative-path').textContent !== 'skills/parent/') throw new Error('Relative path missing');
      const heading = parent.querySelector('.settings-context-item-heading');
      const pathRect = parent.querySelector('.settings-context-relative-path').getBoundingClientRect();
      const titleRect = parent.querySelector('strong').getBoundingClientRect();
      if (!(heading.firstElementChild === parent.querySelector('strong') && heading.lastElementChild === parent.querySelector('.settings-context-relative-path') && (pathRect.left > titleRect.left || pathRect.top > titleRect.top))) throw new Error('Relative directory must render after title');
      for (const [button, badge] of [[parent, 'Always visible'], [child, 'On demand'], [deep, 'Always visible'], [orphan, 'On demand']]) if (!button.textContent.includes(badge)) throw new Error('Missing activation badge: ' + badge);
      for (const [button, badge] of [[child, 'User only'], [deep, 'Assistant only']]) if (!button.textContent.includes(badge)) throw new Error('Missing invocation badge: ' + badge);
      if (parent.textContent.includes('User only') || parent.textContent.includes('Assistant only') || orphan.textContent.includes('User only')) throw new Error('Null invocation mode should have no badge');
      if (parent.querySelector('.settings-context-token-count').textContent !== '~1.5K tokens') throw new Error('Compact token count missing');
      if (!document.body.textContent.includes('Orphan skill')) throw new Error('Item with missing parent was dropped');
      const nestedDeep = deep.closest('.settings-context-subskills');
      const nestedChild = child.closest('.settings-context-subskills');
      if (!nestedDeep || !nestedChild || nestedDeep === nestedChild || nestedDeep.parentElement.closest('.settings-context-subskills') !== nestedChild) throw new Error('Expected three nested skill levels');
      const groups = [...document.querySelectorAll('.settings-context-subskills')];
      if (groups.length !== 2 || !groups.every((details) => details.open && details.querySelector('summary')?.textContent.includes('Sub-skills'))) throw new Error('Native collapsible sections missing');
      const summary = groups[0].querySelector('summary');
      if (summary.tabIndex < 0 || summary.getAttribute('role') === 'button') throw new Error('Native summary keyboard semantics missing');
      summary.focus();
      if (document.activeElement !== summary || summary.tabIndex < 0) throw new Error('Summary is not keyboard focusable');
      child.click();
      if (JSON.stringify(window.__opened) !== JSON.stringify(['/skills/parent/child/SKILL.md'])) throw new Error('Open callback did not receive clicked path');
      const itemWidth = parent.getBoundingClientRect().width;
      if (itemWidth <= 0 || !heading) throw new Error('Context item layout missing');
      return true;
    })()`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.settings-context-subskills summary').tagName`), 'SUMMARY', 'Collapsible control should use native summary keyboard semantics');
    await window.webContents.executeJavaScript(`document.querySelector('.settings-context-subskills summary').focus()`);
    await window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'SPACE' });
    await window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'SPACE' });
    await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(resolve))`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.settings-context-subskills').open`), false, 'Space should collapse native details');
    await window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'SPACE' });
    await window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'SPACE' });
    await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(resolve))`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.settings-context-subskills').open`), true, 'Space should expand native details');
    const desktopPath = join(artifacts, 'context-items-desktop.png');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(desktopPath, (await window.webContents.capturePage()).toPNG());
    await window.setSize(390, 760);
    await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const narrow = await window.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('.settings-context-item-list').getBoundingClientRect();
      const item = document.querySelector('.settings-context-item').getBoundingClientRect();
      return { viewport: document.documentElement.clientWidth, listRight: list.right, itemRight: item.right, itemLeft: item.left, pathVisible: document.querySelector('.settings-context-relative-path').getBoundingClientRect().width > 0, titleVisible: document.querySelector('.settings-context-item strong').getBoundingClientRect().width > 0 };
    })()`);
    assert.ok(narrow.listRight <= narrow.viewport + 1 && narrow.itemRight <= narrow.viewport + 1, `Narrow layout overflows viewport: ${JSON.stringify(narrow)}`);
    assert.ok(narrow.pathVisible && narrow.titleVisible, `Path or title collapsed at narrow width: ${JSON.stringify(narrow)}`);
    const narrowPath = join(artifacts, 'context-items-narrow.png');
    await writeFile(narrowPath, (await window.webContents.capturePage()).toPNG());
    console.log(`ContextItems UI tests passed. Screenshots: ${desktopPath} ; ${narrowPath}`);
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
