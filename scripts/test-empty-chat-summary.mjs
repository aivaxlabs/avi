import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));

const pad = (value) => String(value).padStart(2, '0');
const stampNow = new Date();
const offsetMinutes = -stampNow.getTimezoneOffset();
const timezone = `utc${offsetMinutes >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}${pad(Math.abs(offsetMinutes) % 60)}`;
const stamp = `${stampNow.getFullYear()}-${pad(stampNow.getMonth() + 1)}-${pad(stampNow.getDate())}-${pad(stampNow.getHours())}-${pad(stampNow.getMinutes())}-${timezone}`;
const shotDir = join(tmpdir(), '.avi', 'visualizations', stamp, 'empty-chat', randomUUID());
const buildDir = join(shotDir, 'build');
const harnessDir = join(shotDir, 'harness');
assert.ok(shotDir.startsWith(tmpdir()));

if (process.env.CHAT_APP_EMPTY_CHAT_SUMMARY_TEST !== '1') {
  console.error('Run via: CHAT_APP_EMPTY_CHAT_SUMMARY_TEST=1 bun x electron --no-sandbox scripts/test-empty-chat-summary.mjs');
  process.exit(1);
}

// Keep the harness off any production profile or database.
app.setPath('userData', join(shotDir, 'electron-profile'));

rmSync(buildDir, { recursive: true, force: true });
rmSync(harnessDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(harnessDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

// Integration contract: ChatView renders the inbox-only EmptyChatSummary.
const chatViewSource = readFileSync(join(root, 'src', 'renderer', 'components', 'ChatView.jsx'), 'utf8');
const contractPass = chatViewSource.includes('<EmptyChatSummary')
  && chatViewSource.includes('onOpenInbox={onOpenInbox}')
  && !chatViewSource.includes('onOpenNotes');
console.log(`${contractPass ? 'PASS' : 'FAIL'}  ChatView integration: EmptyChatSummary is inbox-only`);
let failures = contractPass ? 0 : 1;

writeFileSync(join(harnessDir, 'test-entry.jsx'), [
  `import React, { useState } from ${JSON.stringify(join(root, 'node_modules/react/index.js').replaceAll('\\', '/'))};`,
  `import { createRoot } from ${JSON.stringify(join(root, 'node_modules/react-dom/client.js').replaceAll('\\', '/'))};`,
  `import { EmptyChatSummary } from ${JSON.stringify(join(root, 'src/renderer/components/EmptyChatSummary.jsx').replaceAll('\\', '/'))};`,
  ``,
  `const mins = (n) => new Date(Date.now() + n * 60000).toISOString();`,
  `window.__events = { inbox: [] };`,
  `const bots = [{ id: 'bot-1', name: 'Release Bot' }, { id: 'bot-2', name: 'Support Bot' }];`,
  `window.__bots = bots;`,
  `window.__fullInbox = {`,
  `  'bot-1': { inbox: [`,
  `    { id: 'inbox-i1', status: 'open', title: 'Approve production deploy', approval: true, updatedAt: mins(40), messages: [{ role: 'user', content: 'Please approve the production deploy.' }] },`,
  `    { id: 'inbox-i2', status: 'resolved', title: 'Newest resolved item', updatedAt: mins(60), messages: [{ role: 'bot', content: 'Done earlier.' }] },`,
  `  ] },`,
  `  'bot-2': { inbox: [`,
  `    { id: 'inbox-i3', status: 'open', title: 'Retry failed sync', updatedAt: mins(50), messages: [{ role: 'bot', content: 'Sync failed.' }, { role: 'user', content: 'Can you retry the sync?' }] },`,
  `    { id: 'inbox-i4', status: 'open', title: 'Escalate ticket 8841', updatedAt: mins(30), messages: [] },`,
  `    { id: 'inbox-i5', status: 'open', title: 'Summarize daily report', updatedAt: mins(20), messages: [{ role: 'bot', content: 'Compiling.' }] },`,
  `    { id: 'inbox-i6', status: 'open', title: 'Archive old logs', updatedAt: mins(10), messages: [{ role: 'bot', content: 'Working on it.' }] },`,
  `  ] },`,
  `};`,
  ``,
  `function ChatHarness() {`,
  `  const [props, setProps] = useState({`,
  `    bots,`,
  `    botDataByBot: window.__fullInbox,`,
  `    botsLoading: true,`,
  `    botsError: null,`,
  `    onOpenInbox: (...args) => window.__events.inbox.push(args),`,
  `  });`,
  `  window.__setProps = (patch) => setProps((prev) => ({ ...prev, ...patch }));`,
  `  return <div className="chat-area chat-empty chat-empty-home" style={{ height: '100vh' }}>`,
  `    <div className="chat-scroll" role="region" aria-label="Conversation messages" tabIndex={0}>`,
  `      <div className="empty-chat">`,
  `        <h1>How can I help you today?</h1>`,
  `        <EmptyChatSummary {...props} />`,
  `      </div>`,
  `    </div>`,
  `    <div className="composer-wrap"><div className="composer" aria-hidden="true"></div></div>`,
  `  </div>;`,
  `}`,
  `createRoot(document.getElementById('root')).render(<ChatHarness />);`,
  ``,
].join('\n'));

console.log('[harness] bundling entry...');
const bundle = spawnSync('bun', ['build', join(harnessDir, 'test-entry.jsx'), '--target=browser', '--outdir', buildDir],
  { encoding: 'utf8', shell: true, cwd: root });
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function wait_for(fn, timeout, label) {
  const start = Date.now();
  while (Date.now() - start < (timeout || 3000)) {
    try { const value = fn(); if (value) return value; } catch {}
    await sleep(50);
  }
  throw new Error('timeout: ' + (label || 'condition'));
}
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
window.__layoutCheck = () => {
  const scroll = q('.chat-scroll');
  const summary = q('.empty-chat-summary');
  const tracks = getComputedStyle(summary).gridTemplateColumns.split(' ').filter(Boolean);
  return {
    scrollOverflow: scroll.scrollWidth > scroll.clientWidth,
    summaryOverflow: summary.scrollWidth > summary.clientWidth + 1,
    tracks: tracks.length,
    scrollPadLeft: getComputedStyle(scroll).paddingLeft,
    emptyWidth: Math.round(q('.empty-chat').getBoundingClientRect().width),
    composerPosition: getComputedStyle(q('.composer-wrap')).position,
    structure: Boolean(q('.chat-area.chat-empty.chat-empty-home > .chat-scroll > .empty-chat > .empty-chat-summary')),
  };
};
const inboxSec = () => q('section[aria-label="Bot inbox"]');
const badge = (sec) => q('.summary-count', sec)?.textContent;
(async () => {
  console.log('[driver] start');

  check('renders only the bot inbox section', Boolean(inboxSec()) && qa('.empty-chat-summary > section').length === 1);
  check('real generated CSS applied (summary grid)', getComputedStyle(q('.empty-chat-summary')).display === 'grid');
  check('dom structure .chat-area.chat-empty.chat-empty-home > .chat-scroll > .empty-chat > .empty-chat-summary', Boolean(q('.chat-area.chat-empty.chat-empty-home > .chat-scroll > .empty-chat > .empty-chat-summary')));

  await wait_for(() => inboxSec().textContent.includes('Loading inbox'), 3000, 'inbox loading');
  check('inbox shows loading state with aria-busy and no count', inboxSec().getAttribute('aria-busy') === 'true' && !q('.summary-count', inboxSec()));

  window.__setProps({ botsLoading: false });
  await wait_for(() => qa('.summary-item', inboxSec()).length === 3, 3000, 'inbox rows');
  check('inbox caption present', q('.summary-caption', inboxSec()).textContent.includes('Latest open messages'));
  check('inbox counts only open pendencies (5 open of 6 seeded)', badge(inboxSec()) === '5', 'badge=' + badge(inboxSec()));
  const inboxTitles = qa('.summary-item strong', inboxSec()).map((el) => el.textContent);
  check('inbox shows latest 3 by updatedAt desc', JSON.stringify(inboxTitles) === JSON.stringify(['Retry failed sync', 'Approve production deploy', 'Escalate ticket 8841']), inboxTitles.join(' | '));
  const metaTexts = qa('.summary-item .summary-meta', inboxSec()).map((el) => el.textContent);
  check('inbox flags Needs you vs Waiting for bot', metaTexts[0].includes('Waiting for bot') && metaTexts[1].includes('Needs you') && metaTexts[2].includes('Waiting for bot'), metaTexts.join(' | '));
  check('inbox meta shows bot names', metaTexts[0].includes('Support Bot') && metaTexts[1].includes('Release Bot'));
  const previews = qa('.summary-item .summary-preview', inboxSec()).map((el) => el.textContent);
  check('inbox previews last message with You: prefix and Attachment fallback', previews[0] === 'You: Can you retry the sync?' && previews[1] === 'You: Please approve the production deploy.' && previews[2] === 'Attachment', previews.join(' | '));

  q('.summary-item', inboxSec()).click();
  await wait_for(() => window.__events.inbox.length === 1, 2000, 'inbox item nav');
  check('inbox item navigates with bot and pendency ids', window.__events.inbox[0][0] === 'bot-2' && window.__events.inbox[0][1] === 'inbox-i3', JSON.stringify(window.__events.inbox[0]));
  q('.summary-open', inboxSec()).click();
  check('inbox header opens full inbox without args', window.__events.inbox[1] && window.__events.inbox[1].length === 0, JSON.stringify(window.__events.inbox[1]));

  window.__setProps({ botsError: 'gateway offline' });
  await wait_for(() => inboxSec().textContent.includes('Some inbox messages could not be loaded.'), 3000, 'botsError');
  check('botsError marks inbox unavailable', inboxSec().textContent.includes('Some inbox messages could not be loaded.'));
  window.__setProps({ botsError: null, botDataByBot: { 'bot-1': { errors: { inbox: 'denied' } }, 'bot-2': window.__fullInbox['bot-2'] } });
  await wait_for(() => inboxSec().textContent.includes('Some inbox messages could not be loaded.'), 3000, 'bot data error');
  check('per-bot inbox error marks unavailable too', inboxSec().textContent.includes('Some inbox messages could not be loaded.'));
  window.__setProps({ botDataByBot: window.__fullInbox });
  await wait_for(() => badge(inboxSec()) === '5', 3000, 'inbox restored');

  window.__setProps({ bots: [], botDataByBot: {} });
  await wait_for(() => inboxSec().textContent.includes('caught up'), 3000, 'inbox empty');
  check('inbox without open messages shows caught-up state', inboxSec().textContent.includes('No open messages'));
  window.__setProps({ bots: window.__bots, botDataByBot: window.__fullInbox });
  await wait_for(() => badge(inboxSec()) === '5', 3000, 'inbox reopen');

  check('no renderer errors during run', window.__errors.length === 0, JSON.stringify(window.__errors));
  return results;
})()
`;

console.log('[harness] starting electron...', 'isReady:', app.isReady());
setTimeout(() => {
  console.log('[harness] FORCE EXIT (overall timeout)');
  app.exit(3);
}, 120_000);

app.whenReady().then(async () => {
  console.log('[harness] electron ready');
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    x: -2600,
    y: 100,
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('console-message', (event) => {
    if (String(event.message).includes('Download the React DevTools')) return;
    console.log('[page]', event.message);
  });

  console.log('[harness] loading page...');
  try {
    await win.loadFile(join(buildDir, 'index.html'));
    console.log('[harness] page loaded');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const run = win.webContents.executeJavaScript(driver, true);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('driver timeout')), 90_000));
    const results = await Promise.race([run, timeout]);

    const layoutResults = [];
    for (const width of [320, 420, 1000]) {
      win.setContentSize(width, 760);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const layout = await win.webContents.executeJavaScript('window.__layoutCheck()', true);
      const narrow = width <= 420;
      const expectedTracks = narrow ? 1 : 2;
      layoutResults.push({ name: `layout ${width}px: no horizontal overflow`, pass: !layout.scrollOverflow && !layout.summaryOverflow, info: JSON.stringify(layout) });
      layoutResults.push({ name: `layout ${width}px: summary column count`, pass: layout.tracks === expectedTracks, info: 'tracks=' + layout.tracks });
      layoutResults.push({ name: `layout ${width}px: responsive chat-scroll padding`, pass: layout.scrollPadLeft === (narrow ? '16px' : '28px'), info: layout.scrollPadLeft });
      layoutResults.push({ name: `layout ${width}px: structure + composer in flow`, pass: layout.structure && layout.composerPosition === 'relative', info: layout.composerPosition });
      if (width === 1000) {
        layoutResults.push({ name: 'layout 1000px: empty-chat capped at 760px', pass: layout.emptyWidth === 760, info: String(layout.emptyWidth) });
      }
      const shotPath = join(shotDir, `empty-chat-${width}.png`);
      writeFileSync(shotPath, await win.capturePage().then((image) => image.toPNG()));
      console.log('[harness] screenshot:', shotPath);
    }

    await win.webContents.executeJavaScript("window.__setProps({ bots: [], botDataByBot: {} })");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const emptyState = await win.webContents.executeJavaScript(`(() => {
      const section = document.querySelector('section[aria-label="Bot inbox"]');
      return section.classList.contains('summary-empty') && section.getBoundingClientRect().height < 100
        && getComputedStyle(document.querySelector('.empty-chat-summary')).gridTemplateColumns.split(' ').length === 1;
    })()`);
    layoutResults.push({ name: 'empty inbox collapses to compact row', pass: emptyState });
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(join(shotDir, 'empty-chat-no-inbox.png'), await win.capturePage().then((image) => image.toPNG()));
    await win.webContents.executeJavaScript("document.documentElement.dataset.colorScheme = 'dark'");
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(join(shotDir, 'empty-chat-no-inbox-dark.png'), await win.capturePage().then((image) => image.toPNG()));

    for (const { name, pass, info } of [...results, ...layoutResults]) {
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
      if (!pass) failures += 1;
    }
  } catch (error) {
    failures += 1;
    console.error('ERROR', error);
  }

  win.destroy();
  console.log(failures === 0 ? 'empty chat summary UI: all checks passed' : `empty chat summary UI: ${failures} check(s) failed`);
  app.exit(failures === 0 ? 0 : 1);
});
