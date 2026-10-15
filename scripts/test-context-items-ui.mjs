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
import { ContextEditorDialog } from '/src/renderer/components/ContextEditorDialog.jsx';
import { monaco } from '/src/renderer/lib/monaco.js';
import '/src/renderer/styles.css';
window.__monaco = monaco;
window.__opened = [];
window.__file = '---\\nname: demo\\ndescription: Old description\\n---\\n# Demo\\n\\n- first';
window.__saved = 0;
window.chatApp = { context: {
  read: async () => ({ content: window.__file }),
  write: async ({ content }) => { window.__file = content; },
  open: async () => true,
} };
const sortItems = [
  { path: '/w/a.md', relativePath: 'workflows/a.md', title: 'Alpha', description: 'first', activationMode: 'on-demand', invocationMode: null, tokenCount: 10, createdAt: '2026-01-01T00:00:00.000Z' },
  { path: '/w/b.md', relativePath: 'workflows/b.md', title: 'Beta', description: 'second', activationMode: 'on-demand', invocationMode: null, tokenCount: 500, createdAt: '2026-03-01T00:00:00.000Z' },
  { path: '/w/nested/c.md', relativePath: 'workflows/nested/c.md', title: 'Gamma', description: 'third', activationMode: 'on-demand', invocationMode: 'assistant-only', tokenCount: 9000, createdAt: '2026-02-01T00:00:00.000Z' },
];
const mount = (id) => createRoot(document.body.appendChild(Object.assign(document.createElement('div'), { id })));
const sortedRoot = mount('sorted');
const editorRoot = mount('editor');
window.__renderSorted = (query, sort) => sortedRoot.render(<main className="settings-page"><ContextItems group={{ id: 'workflow', items: sortItems }} query={query} sort={sort} onOpen={() => {}} /></main>);
window.__mountEditor = () => editorRoot.render(<main className="settings-page"><ContextEditorDialog item={{ path: '/w/demo.md', title: 'Demo', relativePath: 'workflows/demo.md' }} kind="workflow" readOnly={false} onClose={() => {}} onSaved={() => { window.__saved += 1; }} /></main>);
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
    await window.setSize(1100, 760);

    const order = await window.webContents.executeJavaScript(`(async () => {
      const result = {};
      for (const [query, sort] of [['', 'default'], ['', 'tokens'], ['', 'created-desc'], ['', 'created-asc'], ['', 'name-asc'], ['', 'name-desc'], ['GAM', 'default'], ['zzz', 'default']]) {
        window.__renderSorted(query, sort);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const titles = [...document.querySelectorAll('#sorted .settings-context-item strong')].map((node) => node.textContent);
        result[query + ':' + sort] = titles.length ? titles.join(',') : document.querySelector('#sorted .settings-context-group-empty')?.textContent;
      }
      result.badgeTones = [...document.querySelectorAll('#sorted .settings-context-badge')].map((node) => node.dataset.tone).join(',');
      return result;
    })()`);
    assert.deepEqual(order, {
      ':default': 'Beta,Alpha,Gamma',
      ':tokens': 'Gamma,Beta,Alpha',
      ':created-desc': 'Beta,Gamma,Alpha',
      ':created-asc': 'Alpha,Gamma,Beta',
      ':name-asc': 'Alpha,Beta,Gamma',
      ':name-desc': 'Gamma,Beta,Alpha',
      'GAM:default': 'Gamma',
      'zzz:default': 'No items match "zzz".',
      badgeTones: '',
    });

    await window.webContents.executeJavaScript(`(async () => {
      window.__renderSorted('', 'default');
      window.__mountEditor();
      for (let i = 0; i < 250 && !window.__monaco.editor.getEditors().length; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      const editor = window.__monaco.editor.getEditors()[0];
      const model = editor.getModel();
      await new Promise((resolve) => setTimeout(resolve, 300));
      editor.focus();
      editor.setPosition(model.getPositionAt(model.getValueLength()));
      return true;
    })()`);
    window.focus();
    window.webContents.focus();
    await window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    await window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    await window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    await window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    const editor = await window.webContents.executeJavaScript(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const dialog = document.querySelector('.context-editor-dialog');
      const editor = window.__monaco.editor.getEditors()[0];
      const value = editor.getValue();
      const tokens = window.__monaco.editor.tokenize(value, 'avi-markdown').flat().map((token) => token.type);
      const highlighted = tokens.includes('keyword.md') && tokens.includes('type.md');
      const dirty = dialog.querySelector('.context-editor-dirty')?.textContent ?? '';
      const menu = ['bold', 'italic', 'code', 'link'].every((id) => editor.getAction('avi.markdown.' + id)) ? 'markdown actions' : '';
      editor.setSelection(new window.__monaco.Selection(5, 3, 5, 7));
      await editor.getAction('avi.markdown.bold').run();
      const bolded = editor.getModel().getLineContent(5);
      editor.trigger('test', 'undo');
      const mounted = Boolean(dialog.querySelector('.context-editor-monaco .monaco-editor'));
      dialog.querySelector('#context-editor-tab-properties').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const description = dialog.querySelector('.context-editor-properties textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(description, 'New: description');
      description.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      dialog.querySelector('.context-editor-properties input[type="checkbox"]').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { value, highlighted, dirty, menu, bolded, monaco: mounted, saved: window.__saved, file: window.__file };
    })()`);
    assert.ok(editor.monaco, 'Content should be rendered by Monaco');
    assert.equal(editor.value, '---\nname: demo\ndescription: Old description\n---\n# Demo\n\n- first \n- ', 'Tab should advance to the next tab stop and Enter should continue the list');
    assert.ok(editor.highlighted, 'Markdown and frontmatter should be syntax highlighted');
    assert.match(editor.dirty, /Unsaved/);
    assert.equal(editor.menu, 'markdown actions');
    assert.equal(editor.bolded, '# **Demo**', 'Bold action should wrap the selection');
    assert.equal(editor.saved, 1, 'Ctrl+S should save once');
    assert.equal(editor.file, '---\nname: demo\ndescription: "New: description"\nuser-invocable: false\n---\n# Demo\n\n- first \n- ');
    const editorPath = join(artifacts, 'context-editor.png');
    await writeFile(editorPath, (await window.webContents.capturePage()).toPNG());
    console.log(`ContextItems UI tests passed. Screenshots: ${desktopPath} ; ${narrowPath} ; ${editorPath}`);
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
