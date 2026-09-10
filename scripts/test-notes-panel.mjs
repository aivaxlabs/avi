import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));


const pad = (value) => String(value).padStart(2, '0');
const stampNow = new Date();
const offsetMinutes = -stampNow.getTimezoneOffset();
const timezone = `utc${offsetMinutes >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}${pad(Math.abs(offsetMinutes) % 60)}`;
const stamp = `${stampNow.getFullYear()}-${pad(stampNow.getMonth() + 1)}-${pad(stampNow.getDate())}-${pad(stampNow.getHours())}-${pad(stampNow.getMinutes())}-${timezone}`;
const shotDir = join(tmpdir(), '.avi', 'visualizations', stamp, 'notes-panel', randomUUID());
const buildDir = join(shotDir, 'build');
const harnessDir = join(shotDir, 'harness');
assert.ok(shotDir.startsWith(tmpdir()));

if (process.env.CHAT_APP_NOTES_PANEL_TEST !== '1') {
  console.error('Run via: CHAT_APP_NOTES_PANEL_TEST=1 bun x electron --no-sandbox scripts/test-notes-panel.mjs');
  process.exit(1);
}

rmSync(buildDir, { recursive: true, force: true });
rmSync(harnessDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(harnessDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

writeFileSync(join(harnessDir, 'test-entry.jsx'), [
  `import React from ${JSON.stringify(join(root, 'node_modules/react/index.js').replaceAll('\\', '/'))};`,
  `import { createRoot } from ${JSON.stringify(join(root, 'node_modules/react-dom/client.js').replaceAll('\\', '/'))};`,
  `import { NotesPanel } from ${JSON.stringify(join(root, 'src/renderer/components/NotesPanel.jsx').replaceAll('\\', '/'))};`,
  ``,
  `let seq = 0;`,
  `const uid = (prefix) => prefix + '-' + Date.now() + '-' + (seq += 1);`,
  `const now = () => new Date().toISOString();`,
  `const listeners = new Set();`,
  `const emit = () => { listeners.forEach((fn) => { fn(); }); };`,
  `const clone = (value) => JSON.parse(JSON.stringify(value));`,
  `const state = {`,
  `  lists: [{ id: 'list-work', name: 'Work', folderPath: null, archived: false, orderBy: 'manual', position: 0, createdAt: now(), updatedAt: now() }],`,
  `  notes: [`,
  `    { id: 'note-open', listId: 'list-work', title: 'Seed open note', description: 'seed description', priority: 'none', dueAt: null, done: false, archived: false, position: 0,`,
  `      subtasks: [{ id: 'st-1', text: 'first subtask', done: false }, { id: 'st-2', text: 'second subtask', done: false }], attachments: [], createdAt: now(), updatedAt: now() },`,
  `    { id: 'note-done', listId: 'list-work', title: 'Seed done note', description: '', priority: 'none', dueAt: null, done: true, archived: false, position: 1,`,
  `      subtasks: [], attachments: [], createdAt: now(), updatedAt: now() },`,
  `  ],`,
  `};`,
  `window.__notes = { state, calls: [] };`,
  `window.chatApp = { notes: {`,
  `  onChanged: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },`,
  `  lists: async () => clone(state.lists),`,
  `  search: async () => ({ notes: clone(state.notes), total: state.notes.length }),`,
  `  saveList: async (input) => {`,
  `    window.__notes.calls.push(['saveList', clone(input ?? {})]);`,
  `    const data = { ...(input ?? {}) };`,
  `    let list = data.id ? state.lists.find((item) => item.id === data.id) : null;`,
  `    if (data.id && !list) throw new Error('Note list not found');`,
  `    if (list) list = Object.assign(list, data, { updatedAt: now() });`,
  `    else { delete data.id; list = { id: uid('list'), name: '', folderPath: null, archived: false, orderBy: 'manual', position: state.lists.length, createdAt: now(), updatedAt: now(), ...data }; state.lists.push(list); }`,
  `    emit();`,
  `    return clone(list);`,
  `  },`,
  `  save: async (input) => {`,
  `    window.__notes.calls.push(['save', clone(input ?? {})]);`,
  `    const data = { ...(input ?? {}) };`,
  `    let note = data.id ? state.notes.find((item) => item.id === data.id) : null;`,
  `    if (data.id && !note) throw new Error('Note not found');`,
  `    if (note) note = Object.assign(note, data, { updatedAt: now() });`,
  `    else { delete data.id; note = { id: uid('note'), description: '', priority: 'none', dueAt: null, done: false, archived: false, position: state.notes.length, subtasks: [], attachments: [], createdAt: now(), updatedAt: now(), ...data }; state.notes.push(note); }`,
  `    emit();`,
  `    return clone(note);`,
  `  },`,
  `  reorder: async ({ ids, listId }) => {`,
  `    window.__notes.calls.push(['reorder', { ids: [...ids], listId: listId ?? null }]);`,
  `    ids.forEach((id, index) => {`,
  `      const target = listId ? state.notes.find((item) => item.id === id) : state.lists.find((item) => item.id === id);`,
  `      if (target) target.position = index;`,
  `    });`,
  `    emit();`,
  `    return true;`,
  `  },`,
  `  deleteList: async (input) => { window.__notes.calls.push(['deleteList', clone(input)]); emit(); return true; },`,
  `  exportAttachment: async () => null,`,
  `  pickAttachments: async () => null,`,
  `}};`,
  ``,
  `function Harness() { return <div style={{ height: '100vh', width: 'min(420px, 100vw)' }}><NotesPanel folderPath={null} /></div>; }`,
  `createRoot(document.getElementById('root')).render(<Harness />);`,
  ``,
].join('\n'));

console.log('[harness] bundling entry...');
const bundle = spawnSync('bun', ['build', join(harnessDir, 'test-entry.jsx'), '--target=browser', '--outdir', buildDir],
  { encoding: 'utf8', shell: true, cwd: here });
console.log('[harness] bundle done', bundle.status);
rmSync(harnessDir, { recursive: true, force: true });
if (bundle.status !== 0) {
  console.error('bundle failed:\n' + bundle.stdout + bundle.stderr);
  process.exit(1);
}

copyFileSync(join(root, 'src', 'renderer', 'styles.css'), join(buildDir, 'styles.css'));
writeFileSync(join(buildDir, 'index.html'), [
  '<!doctype html>',
  '<html data-theme="goblin"><head><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"></head>',
  '<body><div id="root"></div>',
  '<script src="./test-entry.js"></script>',
  '</body></html>',
].join('\n'));

const driver = `
const results = [];
function check(name, pass, info) { console.log('[check] ' + (pass ? 'PASS' : 'FAIL') + ' ' + name + (info ? ' (' + info + ')' : '')); results.push({ name, pass, info: info ?? '' }); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return [...(root || document).querySelectorAll(sel)]; }
function qAll(sel) { return [...document.querySelectorAll(sel)]; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function wait_for(fn, timeout, label) {
  const start = Date.now();
  while (Date.now() - start < (timeout || 3000)) {
    try { const value = fn(); if (value) return value; } catch {}
    await sleep(50);
  }
  throw new Error('timeout: ' + (label || 'condition'));
}
function setInput(el, value, evt) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(evt || (el.tagName === 'SELECT' ? 'change' : 'input'), { bubbles: true }));
}
function titles() { return qa('.notes-item .notes-copy strong').map((el) => el.textContent); }
function listByName(name) {
  return qa('.notes-list').find((el) => (q('.notes-list-heading strong', el)?.textContent || '').startsWith(name));
}
function dialog() { return q('.notes-dialog'); }
(async () => {
  console.log('[driver] start');
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
  await wait_for(() => titles().length >= 2, 4000, 'seed notes');
  check('renders seeded lists and notes',
    q('.notes-list-heading strong')?.textContent === 'Work' && titles().includes('Seed open note'));

  const display = getComputedStyle(q('.notes-panel')).display;
  check('actual notes CSS applied (flex layout)', display === 'flex', 'display=' + display);

  q('button[aria-label="New list"]').click();
  await wait_for(() => dialog()?.isConnected, 2000, 'new list dialog');
  check('modal dialog opens for new list', q('#notes-dialog-title')?.textContent === 'New list');
  check('Notes uses shared backdrop and header/footer', Boolean(q('.dialog-backdrop > .notes-dialog[role="dialog"][aria-modal="true"]')) && Boolean(q('.notes-dialog .dialog-header')) && Boolean(q('.notes-dialog .dialog-footer')));
  check('background is inert while modal is open', q('#root').inert);
  const lastControl = q('.notes-dialog button[type="submit"]');
  lastControl.focus();
  lastControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  check('Tab wraps within modal', document.activeElement === q('.notes-dialog button[aria-label="Close"]'));
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  check('Shift Tab wraps within modal', document.activeElement === lastControl);
  setInput(q('.notes-dialog input[maxlength="200"]'), 'Side quests');
  q('.notes-dialog button[type="submit"]').click();
  await wait_for(() => qa('.notes-list').length === 2, 3000, 'second list');
  check('creates a list via modal', Boolean(listByName('Side quests')));

  const work = listByName('Work');
  const heading = q('.notes-list-heading', work);
  check('list actions live in summary instead of a separate row', Boolean(q('.notes-list-actions', heading)) && !q('.notes-list-heading > small', work));
  q('.notes-menu > summary', heading).click();
  await wait_for(() => q('.notes-menu', heading).open, 2000, 'list menu open');
  check('opening list menu does not collapse list', work.open);
  q('.notes-menu > summary', heading).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes menu without collapsing list', !q('.notes-menu', heading).open && work.open);
  heading.click();
  await wait_for(() => !work.open, 2000, 'list collapsed');
  qa('button', heading).find((el) => el.textContent.includes('New note')).click();
  await wait_for(() => dialog()?.isConnected && q('#notes-dialog-title')?.textContent === 'New note', 2000, 'new note dialog');
  check('New note works on collapsed list without toggling it', !work.open);
  heading.click();
  check('new note starts on Details with three tabs', qa('.notes-dialog [role="tab"]').length === 3 && q('#notes-tab-details').getAttribute('aria-selected') === 'true');
  q('#notes-tab-attachments').click();
  await wait_for(() => !q('#notes-panel-attachments').hidden, 2000, 'attachments tab');
  check('new note attachments require saving first', qa('#notes-panel-attachments button').find((el) => el.textContent === 'Add files').disabled);
  q('.notes-dialog button[type="submit"]').click();
  await wait_for(() => !q('#notes-panel-details').hidden && document.activeElement === q('.notes-dialog input[maxlength="500"]'), 2000, 'invalid title focus');
  check('saving from another tab reveals required title', dialog().isConnected && q('#notes-tab-details').getAttribute('aria-selected') === 'true');
  setInput(q('.notes-dialog input[maxlength="500"]'), 'Driver note');
  q('#notes-tab-details').focus();
  q('#notes-tab-details').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await wait_for(() => !q('#notes-panel-subtasks').hidden, 2000, 'subtasks tab');
  check('arrow keys activate and focus next tab', document.activeElement === q('#notes-tab-subtasks'));
  [...document.querySelectorAll('.notes-dialog button')].find((el) => el.textContent === 'Add sub-task').click();
  await wait_for(() => q('.notes-dialog input[aria-label="Subtask 1"]'), 2000, 'subtask row');
  q('#notes-tab-details').click();
  await wait_for(() => !q('#notes-panel-details').hidden, 2000, 'return to details');
  check('switching tabs preserves title draft', q('.notes-dialog input[maxlength="500"]').value === 'Driver note');
  q('.notes-dialog button[type="submit"]').click();
  await wait_for(() => !q('#notes-panel-subtasks').hidden && document.activeElement === q('.notes-dialog input[aria-label="Subtask 1"]'), 2000, 'invalid subtask focus');
  check('saving reveals invalid subtask in hidden tab', dialog().isConnected);
  setInput(q('.notes-dialog input[aria-label="Subtask 1"]'), 'only subtask');
  q('.notes-dialog button[type="submit"]').click();
  await wait_for(() => titles().includes('Driver note'), 3000, 'driver note visible');
  check('creates a note with subtask via modal', titles().includes('Driver note'));

  qa('.notes-item .notes-copy').find((el) => q('strong', el).textContent === 'Driver note').click();
  await wait_for(() => dialog()?.isConnected && q('#notes-dialog-title')?.textContent === 'Edit note', 2000, 'edit dialog');
  setInput(q('.notes-dialog input[maxlength="500"]'), 'Driver note edited');
  q('.notes-dialog button[type="submit"]').click();
  await wait_for(() => titles().includes('Driver note edited'), 3000, 'edited title');
  check('edits a note and saves', titles().includes('Driver note edited'));

  q('input[aria-label="Mark Driver note edited done"]').click();
  await wait_for(() => {
    const item = qa('.notes-item').find((el) => q('.notes-copy strong', el)?.textContent === 'Driver note edited');
    return item?.classList.contains('is-done') ? item : null;
  }, 3000, 'note done');
  check('toggles note completion', true);

  const filter = q('input[aria-label="Filter notes"]');
  setInput(filter, 'Seed done');
  await wait_for(() => titles().length === 1 && titles()[0] === 'Seed done note', 3000, 'query filter');
  check('filters notes by query', titles().length === 1);
  setInput(filter, '');
  await wait_for(() => titles().length >= 3, 3000, 'filter cleared');
  const statusSelect = q('.notes-filters select');
  setInput(statusSelect, 'done', 'change');
  await wait_for(() => titles().length === 2 && titles().includes('Seed done note') && titles().includes('Driver note edited'), 3000, 'done filter');
  check('filters notes by done status', titles().length === 2);
  setInput(statusSelect, 'active', 'change');
  await wait_for(() => titles().includes('Seed open note'), 3000, 'active filter');

  q('button[aria-label="New list"]').click();
  await wait_for(() => dialog()?.isConnected, 2000, 'cancel-target dialog');
  [...document.querySelectorAll('.notes-dialog footer button')].find((el) => el.textContent === 'Cancel').click();
  await wait_for(() => !q('.notes-dialog'), 2000, '.notes-dialog closed');
  check('modal dialog opens and cancels', !q('.notes-dialog'));
  check('background restored after close', !q('#root').inert);
  const opener = q('button[aria-label="New list"]');
  opener.focus();
  opener.click();
  await wait_for(() => dialog()?.isConnected, 2000, 'escape dialog');
  dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait_for(() => !dialog(), 2000, 'escape closes');
  check('Escape closes and restores focus', document.activeElement === opener && !q('#root').inert);
  opener.click();
  await wait_for(() => dialog()?.isConnected, 2000, 'backdrop dialog');
  q('.dialog-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await wait_for(() => !dialog(), 2000, 'backdrop closes');
  check('backdrop click closes modal', !q('#root').inert);

  qa('.notes-item .notes-copy').find((el) => q('strong', el).textContent === 'Seed open note').click();
  await wait_for(() => dialog()?.isConnected, 2000, 'subtask dialog');
  q('#notes-tab-subtasks').click();
  await wait_for(() => !q('#notes-panel-subtasks').hidden, 2000, 'visible subtask controls');
  const moveUp = q('.notes-dialog button[aria-label="Move subtask 2 up"]');
  check('subtask reorder control is keyboard-focusable', Boolean(moveUp) && !moveUp.disabled);
  moveUp.focus();
  check('subtask reorder control receives keyboard focus', document.activeElement === moveUp);
  moveUp.click();
  await wait_for(() => q('.notes-dialog input[aria-label="Subtask 1"]')?.value === 'second subtask', 2000, 'subtasks swapped');
  const first = q('.notes-dialog input[aria-label="Subtask 1"]')?.value;
  const second = q('.notes-dialog input[aria-label="Subtask 2"]')?.value;
  check('subtask keyboard reorder swaps order', first === 'second subtask' && second === 'first subtask', first + ' / ' + second);
  q('.notes-dialog button[type="submit"]').click();
  await wait_for(() => !q('.notes-dialog'), 3000, 'subtask dialog saved');
  const persisted = window.__notes.state.notes.find((n) => n.id === 'note-open').subtasks.map((t) => t.text);
  check('subtask reorder persists on save', persisted[0] === 'second subtask' && persisted[1] === 'first subtask', persisted.join(' / '));

  const transfer = new DataTransfer();
  q('[draggable]', listByName('Side quests')).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
  q('.notes-item', listByName('Work')).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  await wait_for(() => window.__notes.calls.some(([method]) => method === 'reorder'), 2000, 'list drop');
  check('list drop onto a note row reorders lists', window.__notes.calls.findLast(([method]) => method === 'reorder')[1].ids[0] !== 'list-work');
  for (const width of [320, 420]) {
    q('.notes-panel').parentElement.style.width = width + 'px';
    check('no panel overflow at ' + width, q('.notes-panel').scrollWidth <= q('.notes-panel').clientWidth);
  }
  qa('.notes-item button').find((el) => el.textContent === 'Manage attachments').click();
  await wait_for(() => dialog()?.isConnected && !q('#notes-panel-attachments').hidden, 2000, 'direct attachments tab');
  check('attachment menu opens Attachments directly', q('#notes-tab-attachments').getAttribute('aria-selected') === 'true');
  q('#notes-tab-attachments').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  await wait_for(() => !q('#notes-panel-details').hidden, 2000, 'home activates details');
  check('Home key activates Details', document.activeElement === q('#notes-tab-details'));
  check('no renderer errors', window.__errors.length === 0, JSON.stringify(window.__errors));
  return results;
})()
`;

console.log('[harness] starting electron...', 'isReady:', app.isReady());
setTimeout(() => {
  console.log('[harness] FORCE EXIT (overall timeout)');
  app.exit(3);
}, 120_000);

// Top-level await on whenReady() deadlocks Electron's default_app; use .then().
app.whenReady().then(async () => {
  console.log('[harness] electron ready');
  const win = new BrowserWindow({
    width: 440,
    height: 800,
    x: -2500,
    y: 100,
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('console-message', (event) => {
    if (String(event.message).includes('Download the React DevTools')) return;
    console.log('[page]', event.message);
  });

  let failures = 0;
  console.log('[harness] loading page...');
  try {
    await win.loadFile(join(buildDir, 'index.html'));
    console.log('[harness] page loaded');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const run = win.webContents.executeJavaScript(driver, true);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('driver timeout')), 90_000));
    const results = await Promise.race([run, timeout]);
    for (const { name, pass, info } of results) {
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
      if (!pass) failures += 1;
    }
    for (const [width, height] of [[320, 480], [420, 640], [640, 700]]) {
      win.setContentSize(width, height);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const layout = await win.webContents.executeJavaScript(`(() => {
        const modal = document.querySelector('.notes-dialog');
        const footer = modal.querySelector('footer').getBoundingClientRect();
        const tabs = modal.querySelector('[role="tablist"]');
        return modal.scrollWidth <= modal.clientWidth && tabs.scrollWidth <= tabs.clientWidth
          && footer.bottom <= innerHeight && footer.top >= 0;
      })()`);
      console.log((layout ? 'PASS' : 'FAIL') + '  modal tabs fit and footer visible at ' + width + 'x' + height);
      if (!layout) failures += 1;
    }
    await win.webContents.executeJavaScript("document.documentElement.dataset.colorScheme = 'dark'");
    const shotPath = join(shotDir, 'notes-panel.png');
    writeFileSync(shotPath, await win.capturePage().then((image) => image.toPNG()));
    console.log('[harness] screenshot:', shotPath);
  } catch (error) {
    failures += 1;
    console.error('ERROR', error);
  }

  win.destroy();
  console.log(failures === 0 ? 'notes panel UI: all checks passed' : `notes panel UI: ${failures} check(s) failed`);
  app.exit(failures === 0 ? 0 : 1);
});
