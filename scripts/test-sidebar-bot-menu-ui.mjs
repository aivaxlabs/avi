import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const here = fileURLToPath(new URL('.', import.meta.url));
const harnessDir = join(here, '.tmp-sidebar-bot-menu-harness');
const buildDir = join(tmpdir(), 'avi-sidebar-bot-menu-ui-build');

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

const bundle = spawnSync('bun', [
  'build',
  join(harnessDir, 'test-entry.jsx'),
  '--target=browser',
  '--outdir', buildDir,
], { encoding: 'utf8', shell: true, cwd: here });

if (bundle.status !== 0) {
  console.error(`Bundle failed:\n${bundle.stdout}${bundle.stderr}`);
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
function q(selector, root) { return (root || document).querySelector(selector); }
function qa(selector, root) { return [...(root || document).querySelectorAll(selector)]; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(fn, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    const value = fn();
    if (value) return value;
    await sleep(25);
  }
  throw new Error('Timed out waiting for ' + label);
}
function click(element) { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
function menuItem(text, root) {
  return qa('.dropdown-menu-item', root).find((item) => item.textContent.trim() === text);
}
(async () => {
  const actionsButton = await waitFor(() => q('.bot-item .icon-button'), 'bot actions button');
  click(actionsButton);
  const parentMenu = await waitFor(() => q('.dropdown-menu.fixed'), 'bot menu');
  const activateTrigger = menuItem('Activate now', parentMenu);
  check('Activate now exposes a submenu', activateTrigger?.getAttribute('aria-haspopup') === 'menu');
  click(activateTrigger);

  const queueMenu = await waitFor(() => q('.bot-work-queue-menu'), 'work queue submenu');
  const labels = qa('.dropdown-menu-item', queueMenu).map((item) => item.textContent.trim());
  check('submenu keeps the requested item order', JSON.stringify(labels) === JSON.stringify([
    'Next work item',
    'Review the next release',
    'Triage failures that need immediate attention across the entire workspace',
    'Update documentation',
  ]), JSON.stringify(labels));
  check('submenu separates the default action from queue items', Boolean(q('.dropdown-menu-divider', queueMenu)));
  check('current queue item is marked active', menuItem(
    'Triage failures that need immediate attention across the entire workspace',
    queueMenu,
  )?.classList.contains('active'));
  check('long queue item retains its full title', menuItem(
    'Triage failures that need immediate attention across the entire workspace',
    queueMenu,
  )?.title === 'Triage failures that need immediate attention across the entire workspace');

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(50);
  check('Escape closes the nested menu first', !q('.bot-work-queue-menu') && Boolean(q('.dropdown-menu.fixed')));

  click(menuItem('Activate now', q('.dropdown-menu.fixed')));
  click(menuItem('Next work item', await waitFor(() => q('.bot-work-queue-menu'), 'reopened submenu')));
  await sleep(50);
  check('Next work item preserves the current order', JSON.stringify(window.__harness.activationCalls[0]) === JSON.stringify({ botId: 'bot-1' }));

  click(actionsButton);
  click(menuItem('Activate now', await waitFor(() => q('.dropdown-menu.fixed'), 'reopened bot menu')));
  const reopenedQueue = await waitFor(() => q('.bot-work-queue-menu'), 'reopened work queue');
  click(menuItem('Update documentation', reopenedQueue));
  await sleep(50);
  check('selected item changes the next execution position', JSON.stringify(window.__harness.activationCalls[1]) === JSON.stringify({
    botId: 'bot-1',
    workQueueIndex: 2,
  }), JSON.stringify(window.__harness.activationCalls));

  return results;
})()
`;

if (process.env.CHAT_APP_SIDEBAR_BOT_MENU_TEST !== '1') {
  console.error('Run via: bun x electron --no-sandbox scripts/test-sidebar-bot-menu-ui.mjs');
  process.exit(1);
}

const botStyles = readFileSync(new URL('../src/styles/components/bots.xcss', import.meta.url), 'utf8');
const dropdownStyles = readFileSync(new URL('../src/styles/components/dropdown-menu.xcss', import.meta.url), 'utf8');
if (!/\.bot-work-queue-menu\s*{[\s\S]*?width:\s*220px;[\s\S]*?overflow-y:\s*auto;/.test(botStyles)) {
  throw new Error('The work queue submenu must have a bounded scrollable width.');
}
if (!/text-overflow:\s*ellipsis;/.test(dropdownStyles)) {
  throw new Error('Dropdown menu items must truncate long work items with ellipsis.');
}

setTimeout(() => app.exit(3), 60_000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let failures = 0;
  try {
    await win.loadFile(join(buildDir, 'index.html'));
    const results = await win.webContents.executeJavaScript(driver, true);
    for (const { name, pass, info } of results) {
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? ` (${info})` : ''}`);
      if (!pass) failures += 1;
    }
  } catch (error) {
    failures += 1;
    console.error(error);
  }

  win.destroy();
  console.log(failures === 0
    ? 'Sidebar bot menu UI: all checks passed'
    : `Sidebar bot menu UI: ${failures} check(s) failed`);
  app.exit(failures === 0 ? 0 : 1);
});
