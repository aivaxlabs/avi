import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const here = fileURLToPath(new URL('.', import.meta.url));
const harnessDir = join(here, '.tmp-sidebar-tags-harness');
const buildDir = join(tmpdir(), 'avi-sidebar-tags-ui-build');

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

console.log('[harness] bundling entry...');
const bundle = spawnSync('bun', [
  'build',
  join(harnessDir, 'test-entry.jsx'),
  '--target=browser',
  '--outdir', buildDir,
], { encoding: 'utf8', shell: true, cwd: here });
console.log('[harness] bundle done', bundle.status);

if (bundle.status !== 0) {
  console.error('bundle failed:\n' + bundle.stdout + bundle.stderr);
  process.exit(1);
}

writeFileSync(join(buildDir, 'index.html'), [
  '<!doctype html>',
  '<html><head><meta charset="utf-8"></head>',
  '<body><div id="root"></div>',
  '<script src="./test-entry.js"></script>',
  '</body></html>',
].join('\n'));

const driver = `
const results = [];
function check(name, pass, info) { results.push({ name, pass, info: info ?? '' }); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return [...(root || document).querySelectorAll(sel)]; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function wait_for(fn, timeout, label) {
  const start = Date.now();
  while (Date.now() - start < (timeout || 2000)) {
    try { const value = fn(); if (value) return value; } catch {}
    await sleep(50);
  }
  throw new Error('timeout: ' + (label || 'condition'));
}
function options(el) {
  const r = el.getBoundingClientRect();
  return { bubbles: true, cancelable: true, view: window,
    clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + Math.min(r.height / 2, 10)) };
}
function click(el) {
  const o = options(el);
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
}
function rightClick(el) {
  const o = options(el);
  el.dispatchEvent(new PointerEvent('pointerdown', { ...o, button: 2, buttons: 2 }));
  el.dispatchEvent(new MouseEvent('contextmenu', { ...o, button: 2 }));
}
function hover(el) {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window, relatedTarget: document.body }));
}
function menuItemByText(text, menuSel) {
  return qa(menuSel + ' .dropdown-menu-item')
    .find((el) => el.textContent.trim().startsWith(text));
}
(async () => {
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
  const items = await wait_for(() => {
    const found = qa('.conversation-item');
    return found.length >= 2 ? found : null;
  }, 4000, 'sidebar items');
  const item = items[0];

  // --- Toggle tags through the context menu -> Tags popup ---
  rightClick(item);
  await wait_for(() => q('.dropdown-menu.fixed'), 1500, 'context menu');
  const tagsEntry = menuItemByText('Tags', '.dropdown-menu.fixed');
  check('context menu has Tags entry', Boolean(tagsEntry));
  click(tagsEntry);
  let tagsMenu;
  try {
    tagsMenu = await wait_for(() => q('.conversation-tags-menu'), 1500, 'tags menu');
  } catch (error) {
    const menus = qa('.dropdown-menu').map((el) => el.className);
    throw new Error(error.message
      + ' | menus now: ' + JSON.stringify(menus)
      + ' | errors: ' + JSON.stringify(window.__errors));
  }
  const review = menuItemByText('Review', '.conversation-tags-menu');
  const important = menuItemByText('Important', '.conversation-tags-menu');
  check('tags menu lists defaults', Boolean(review) && Boolean(important));

  check('Review starts unchecked', review.getAttribute('aria-checked') === 'false',
    'aria-checked=' + review.getAttribute('aria-checked'));

  click(review);
  await wait_for(() => q('.conversation-tag-dots .tag-dot', item), 2500, 'tag dot on item after marking');
  check('clicking Review marks it', Boolean(q('.conversation-tag-dots .tag-dot', item)));
  const reviewNow = menuItemByText('Review', '.conversation-tags-menu');
  check('menu shows Review checked', reviewNow?.getAttribute('aria-checked') === 'true',
    'aria-checked=' + reviewNow?.getAttribute('aria-checked'));

  click(important);
  await wait_for(() => qa('.conversation-tag-dots .tag-dot', item).length === 2, 2500, 'two dots');
  check('second tag marks and adds second dot', qa('.conversation-tag-dots .tag-dot', item).length === 2);

  click(review);
  await wait_for(() => qa('.conversation-tag-dots .tag-dot', item).length === 1, 2500, 'one dot');
  check('clicking again unmarks', qa('.conversation-tag-dots .tag-dot', item).length === 1);

  // Rapid clicks race the async round-trip; no tag may be lost.
  click(menuItemByText('Review', '.conversation-tags-menu'));
  click(menuItemByText('Blocked', '.conversation-tags-menu'));
  await wait_for(() => qa('.conversation-tag-dots .tag-dot', item).length === 3, 2500, 'three dots after rapid clicks');
  check('rapid clicks do not lose tags', qa('.conversation-tag-dots .tag-dot', item).length === 3);

  check('setConversationTags called 5 times', window.__harness.calls.length === 5,
    JSON.stringify(window.__harness.calls));

  // --- Tooltip must close when the tags menu opens (hover then right-click) ---
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait_for(() => !q('.conversation-tags-menu'), 1500, 'tags menu closes on escape');
  hover(q('.conversation-main', item));
  await wait_for(() => q('.conversation-tooltip'), 1500, 'tooltip on hover');
  check('tooltip appears on hover', Boolean(q('.conversation-tooltip')));

  window.__harness.updateConversation();
  await wait_for(() => q('.conversation-title', item)?.textContent === 'Correção do bug atualizada', 1500,
    'conversation rerender');
  check('tooltip survives conversation rerender', Boolean(q('.conversation-tooltip')));

  q('.chat-scroll').dispatchEvent(new Event('scroll'));
  await sleep(150);
  check('tooltip survives external chat scroll', Boolean(q('.conversation-tooltip')));

  rightClick(item);
  await wait_for(() => q('.dropdown-menu.fixed'), 1500, 'context menu 2');
  await sleep(150);
  check('tooltip closes when context menu opens', !q('.conversation-tooltip'));

  // --- Tooltip must not survive opening Manage tags modal ---
  const tagsEntry2 = menuItemByText('Tags', '.dropdown-menu.fixed');
  click(tagsEntry2);
  await wait_for(() => q('.conversation-tags-menu'), 1500, 'tags menu 2');
  await sleep(150);
  check('tooltip stays closed while tags menu open (no hover)', !q('.conversation-tooltip'));
  hover(q('.conversation-main', item));
  await sleep(100);
  const manage = menuItemByText('Manage tags', '.conversation-tags-menu');
  check('manage tags entry present', Boolean(manage));
  click(manage);
  await wait_for(() => q('.tags-dialog'), 2000, 'manage tags dialog');
  check('manage tags dialog opens', Boolean(q('.tags-dialog')));
  await sleep(150);
  check('tooltip closed while modal open', !q('.conversation-tooltip'));

  // --- Compact dialog: color palette on demand ---
  check('dialog has no inline swatch rows', !q('.tags-dialog-colors'));
  check('dialog has no header subtitle', !q('.tags-dialog .dialog-header p'));
  const colorButton = q('.tags-dialog .tag-dot.clickable');
  check('color dot button present', Boolean(colorButton));
  click(colorButton);
  await wait_for(() => q('.tags-dialog-palette'), 1500, 'palette');
  const swatches = qa('.tags-dialog-palette .color-swatch');
  check('palette opens on demand with preset colors', swatches.length === 10,
    'swatches=' + swatches.length);
  const before = colorButton.style.backgroundColor;
  click(swatches[3]);
  await sleep(100);
  check('picking a color updates the dot', colorButton.style.backgroundColor !== before,
    before + ' -> ' + colorButton.style.backgroundColor);
  check('palette stays open after picking', Boolean(q('.tags-dialog-palette')));

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait_for(() => !q('.tags-dialog'), 1500, 'dialog closes on escape');
  check('dialog closes on escape', !q('.tags-dialog'));

  return results;
})()
`;

if (process.env.CHAT_APP_SIDEBAR_TAGS_TEST !== '1') {
  console.error('Run via: bun x electron --no-sandbox scripts/test-sidebar-tags-ui.mjs');
  process.exit(1);
}

console.log('[harness] starting electron...', 'isReady:', app.isReady());
setTimeout(() => {
  console.log('[harness] FORCE EXIT (overall timeout)');
  app.exit(3);
}, 90_000);

// Top-level await on whenReady() deadlocks Electron's default_app; use .then().
app.whenReady().then(async () => {
  console.log('[harness] electron ready');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    x: -2500,
    y: 100,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
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
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('driver timeout')), 60_000));
    const results = await Promise.race([run, timeout]);
    for (const { name, pass, info } of results) {
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
      if (!pass) failures += 1;
    }
  } catch (error) {
    failures += 1;
    console.error('ERROR', error);
  }

  win.destroy();
  console.log(failures === 0 ? 'sidebar tags UI: all checks passed' : `sidebar tags UI: ${failures} check(s) failed`);
  app.exit(failures === 0 ? 0 : 1);
});
