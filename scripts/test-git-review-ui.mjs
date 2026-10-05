import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { buildGitDiff, buildGitTree, expandGitDiff, flattenGitTree } from '../src/renderer/lib/git-review.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const pad = (value) => String(value).padStart(2, '0');
const stampNow = new Date();
const offsetMinutes = -stampNow.getTimezoneOffset();
const timezone = `utc${offsetMinutes >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}${pad(Math.abs(offsetMinutes) % 60)}`;
const stamp = `${stampNow.getFullYear()}-${pad(stampNow.getMonth() + 1)}-${pad(stampNow.getDate())}-${pad(stampNow.getHours())}-${pad(stampNow.getMinutes())}-${timezone}`;
const shotDir = join(tmpdir(), '.avi', 'visualizations', stamp, 'git-review-ui');
const buildDir = join(shotDir, 'build');
const harnessDir = join(shotDir, 'harness');
assert.ok(shotDir.startsWith(tmpdir()));

if (process.env.CHAT_APP_GIT_REVIEW_UI_TEST !== '1') {
  console.error('Run via: CHAT_APP_GIT_REVIEW_UI_TEST=1 bun x electron --no-sandbox scripts/test-git-review-ui.mjs');
  process.exit(1);
}

app.setPath('userData', join(shotDir, 'electron-profile'));

rmSync(buildDir, { recursive: true, force: true });
rmSync(harnessDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(harnessDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

let failures = 0;
const pure = (name, fn) => {
  try {
    fn();
    console.log(`PASS  pure ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  pure ${name} (${error.message})`);
  }
};

const pureDiff = [
  'diff --git a/f.txt b/f.txt',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  '@@ -90,3 +90,4 @@',
  ' ninety',
  ' ninety-one',
  ' ninety-two',
  '+ninety-three',
  '',
].join('\n');
const pureContent = [...Array.from({ length: 93 }, (_, i) => `line ${i + 1}`), 'line 94'].join('\n');

pure('buildGitTree counts nested files', () => {
  const files = [...Array.from({ length: 150 }, (_, i) => ({ path: `d/file-${i}.js`, status: 'modified' })), { path: 'root.js', status: 'added' }];
  const tree = buildGitTree(files);
  assert.equal(tree.count, 151);
  assert.equal(tree.children.get('d').count, 150);
});

pure('flattenGitTree collapses folders with >100 files by default', () => {
  const files = [...Array.from({ length: 150 }, (_, i) => ({ path: `d/file-${i}.js`, status: 'modified' })), { path: 'root.js', status: 'added' }];
  const rows = flattenGitTree(buildGitTree(files), new Map());
  assert.equal(rows.length, 3);
  assert.ok(rows.some(({ node }) => node.path === 'd'));
  assert.ok(!rows.some(({ node }) => node.path === 'd/file-0.js'));
});

pure('buildGitDiff emits a hidden-lines gap between distant hunks', () => {
  const model = buildGitDiff({ content: pureContent, diff: pureDiff });
  const gap = model.rows.find((row) => row.type === 'gap');
  assert.ok(gap);
  assert.ok(gap.count > 50);
});

pure('expandGitDiff reveals hidden lines from top and bottom', () => {
  const model = buildGitDiff({ content: pureContent, diff: pureDiff });
  const gap = model.rows.find((row) => row.type === 'gap');
  const top = expandGitDiff(model, { [gap.key]: { top: 5, bottom: 0 } });
  assert.equal(top.length, model.rows.length + 5 - 1 + 1);
  assert.ok(!top.some((row) => row.type === 'gap' && row.count === gap.count));
  const both = expandGitDiff(model, { [gap.key]: { top: 5, bottom: 7 } });
  assert.equal(both.filter((row) => row.type === 'context').length, model.rows.filter((row) => row.type === 'context').length + 12);
});

const appSource = readFileSync(join(root, 'src', 'renderer', 'App.jsx'), 'utf8');
const panelSource = readFileSync(join(root, 'src', 'renderer', 'components', 'GitReviewPanel.jsx'), 'utf8');
const auxSource = readFileSync(join(root, 'src', 'renderer', 'components', 'AuxiliaryPanel.jsx'), 'utf8');
const srcCheck = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  source ${name}`);
  if (!cond) failures += 1;
};
srcCheck('App gates expansion on auxiliaryExpansionActive = auxiliaryExpanded && !orchestrationOpen && auxiliaryPanelVisible', appSource.includes('const auxiliaryExpansionActive = auxiliaryExpanded && !orchestrationOpen && auxiliaryPanelVisible;'));
srcCheck('App expanded width is 80% of window', appSource.includes('auxiliaryExpansionActive ? windowWidth * .8 : auxiliaryPanelWidth'));
srcCheck('App hides the resizer while expansion is active', appSource.includes('sidePanelVisible && !auxiliaryExpansionActive'));
srcCheck('App collapses the sidebar while expansion is active', appSource.includes('narrowWindow || sidebarCollapsed || auxiliaryExpansionActive'));
srcCheck('App preserves a 320px minimum for main content', appSource.includes('const minimumMainContentWidth = 320;'));
srcCheck('mutation actions are guarded by busy+loading', (panelSource.match(/disabled=\{busy \|\| loading\}/g) ?? []).length >= 4);
srcCheck('dialog stays guarded while busy', panelSource.includes('disabled={busy} onClick={onClose}'));
srcCheck('AuxiliaryPanel tabbed header exposes the expand/restore toggle with aria-pressed', auxSource.includes("aria-label={expanded ? 'Restore panel width' : 'Expand auxiliary panel'}") && auxSource.includes('aria-pressed={expanded}') && auxSource.includes('onToggleExpanded'));
srcCheck('AuxiliaryPanel empty header keeps the same expand/restore toggle', (auxSource.match(/Restore panel width/g) ?? []).length >= 2);
srcCheck('AuxiliaryPanel only renders the toggle when onToggleExpanded is provided', (auxSource.match(/\{onToggleExpanded &&/g) ?? []).length >= 2);

const calcWidths = (windowWidth, auxiliaryPanelWidth, sidebarWidth, { expanded, orchestrationOpen, auxiliaryPanelVisible, sidebarCollapsed }) => {
  const minimumAuxiliaryPanelWidth = 280;
  const minimumMainContentWidth = 320;
  const active = expanded && !orchestrationOpen && auxiliaryPanelVisible;
  const narrowWindow = windowWidth <= 700;
  const collapsed = narrowWindow || sidebarCollapsed || active;
  const sidebarMax = Math.max(180, Math.min(420, windowWidth - 52 - (auxiliaryPanelVisible ? auxiliaryPanelWidth : 0) - minimumMainContentWidth));
  const effectiveSidebar = Math.min(sidebarWidth, sidebarMax);
  const auxiliaryMax = Math.max(minimumAuxiliaryPanelWidth, windowWidth - 52 - (orchestrationOpen ? 0 : collapsed ? 58 : effectiveSidebar) - minimumMainContentWidth);
  return { active, collapsed, effectiveSidebar, effectiveAuxiliary: Math.min(active ? windowWidth * .8 : auxiliaryPanelWidth, auxiliaryMax) };
};

pure('App formula: expanded 1280px collapses sidebar to rail and caps panel preserving 320px main', () => {
  const result = calcWidths(1280, 400, 222, { expanded: true, orchestrationOpen: false, auxiliaryPanelVisible: true, sidebarCollapsed: false });
  assert.equal(result.active, true);
  assert.equal(result.collapsed, true);
  assert.equal(result.effectiveAuxiliary, 850);
  assert.ok(1280 - 52 - result.effectiveAuxiliary >= 320);
});

pure('App formula: collapsed 1280px preserves the 222px sidebar', () => {
  const result = calcWidths(1280, 400, 222, { expanded: false, orchestrationOpen: false, auxiliaryPanelVisible: true, sidebarCollapsed: false });
  assert.equal(result.active, false);
  assert.equal(result.effectiveSidebar, 222);
  assert.equal(result.effectiveAuxiliary, 400);
  assert.ok(1280 - 52 - 222 - 400 >= 320);
});

pure('App formula: Inbox (orchestrationOpen) never inherits the 80% expansion', () => {
  const result = calcWidths(1280, 400, 222, { expanded: true, orchestrationOpen: true, auxiliaryPanelVisible: true, sidebarCollapsed: false });
  assert.equal(result.active, false);
  assert.equal(result.effectiveAuxiliary, 400);
});

const slash = (value) => value.replaceAll('\\', '/');
const reactPath = slash(join(root, 'node_modules/react/index.js'));
const reactDomPath = slash(join(root, 'node_modules/react-dom/client.js'));
const panelPath = slash(join(root, 'src/renderer/components/GitReviewPanel.jsx'));

writeFileSync(join(harnessDir, 'test-entry.jsx'), [
  `import React from ${JSON.stringify(reactPath)};`,
  `import { createRoot } from ${JSON.stringify(reactDomPath)};`,
  `import { GitReviewPanel } from ${JSON.stringify(panelPath)};`,
  ``,
  `window.__calls = { index: [], file: [], mutate: [], push: [], plan: [], commit: [], files: [] };`,
  `window.__events = { chat: [], side: [] };`,
  ``,
  `const LINES = 220;`,
  `const contentLines = Array.from({ length: LINES }, (_, i) => 'line ' + String(i + 1).padStart(3, '0') + ' :: const value_' + (i + 1) + ' = ' + (i + 1) + ';');`,
  `for (const n of [20, 21, 22]) contentLines[n - 1] = 'const repeated = 42; // repeated-token';`,
  `const bigContent = contentLines.join('\\n') + '\\n';`,
  `const line = (n) => contentLines[n - 1];`,
  `const bigDiff = [`,
  `  'diff --git a/src/app.js b/src/app.js',`,
  `  '--- a/src/app.js',`,
  `  '+++ b/src/app.js',`,
  `  '@@ -1,6 +1,6 @@',`,
  `  ' ' + line(1),`,
  `  '-' + line(2),`,
  `  '+line 002 :: const value_2 = 2002; // changed',`,
  `  ' ' + line(3),`,
  `  ' ' + line(4),`,
  `  ' ' + line(5),`,
  `  ' ' + line(6),`,
  `  '@@ -215,6 +215,7 @@',`,
  `  ' ' + line(215),`,
  `  ' ' + line(216),`,
  `  ' ' + line(217),`,
  `  ' ' + line(218),`,
  `  ' ' + line(219),`,
  `  ' ' + line(220),`,
  `  '+// appended review marker',`,
  `  '',`,
  `].join('\\n');`,
  `const fileA = { path: 'src/app.js', content: bigContent, diff: bigDiff, binary: false };`,
  `const bigFiles = [{ path: 'src/app.js', status: 'modified', staged: true, unstaged: true },`,
  `  { path: 'src/util.js', status: 'untracked', staged: false, unstaged: true },`,
  `  ...Array.from({ length: 2500 }, (_, i) => ({ path: 'bigdir/file-' + String(i + 1).padStart(4, '0') + '.js', status: 'modified', staged: false, unstaged: true })),`,
  `  { path: 'README.md', status: 'added', staged: false, unstaged: true },`,
  `  { path: 'docs/a.md', status: 'modified', staged: false, unstaged: true },`,
  `  { path: 'docs/b.md', status: 'deleted', staged: false, unstaged: true }];`,
  `const indexA = { path: 'repo-a', name: 'Repo A', branch: 'main', version: 7, files: bigFiles };`,
  `const indexB = { path: 'repo-b', name: 'Repo B', branch: 'main', version: 3, files: [{ path: 'only.txt', status: 'added', staged: false, unstaged: true }] };`,
  `const fileB = { path: 'only.txt', content: 'hello\\nworld\\n', diff: 'diff --git a/only.txt b/only.txt\\n--- /dev/null\\n+++ b/only.txt\\n@@ -0,0 +1,2 @@\\n+hello\\n+world\\n', binary: false };`,
  `const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));`,
  `window.chatApp = {`,
  `  gitReview: {`,
  `    repositories: () => { window.__calls.index.push({ scope: 'repositories' }); return delay(30, { root: '/ws', repositories: [{ path: 'repo-a', name: 'Repo A' }, { path: 'repo-b', name: 'Repo B' }] }); },`,
  `    index: ({ repositoryPath }) => { window.__calls.index.push({ repositoryPath }); return delay(repositoryPath === 'repo-a' ? 350 : 20, repositoryPath === 'repo-a' ? indexA : indexB); },`,
  `    file: ({ repositoryPath, filePath, staged, unstaged }) => { window.__calls.file.push({ repositoryPath, filePath, staged, unstaged });`,
  `      if (repositoryPath === 'repo-a' && filePath === 'src/app.js') return delay(30, fileA);`,
  `      if (repositoryPath === 'repo-b') return delay(30, fileB);`,
  `      return delay(30, { path: filePath, content: 'x\\n', diff: 'diff --git\\n--- a\\n+++ b\\n@@ -1,1 +1,1 @@\\n-x\\n+x\\n', binary: false }); },`,
  `    mutate: (payload) => { window.__calls.mutate.push(payload); return delay(250, {}); },`,
  `    push: (payload) => { window.__calls.push.push(payload); return delay(20, { pushed: true }); },`,
  `    plan: (payload) => { window.__calls.plan.push(payload); return Promise.resolve({ commits: [{ message: 'feat: staged message', files: ['src/app.js'] }] }); },`,
  `    commit: (payload) => { window.__calls.commit.push(payload); return Promise.reject(new Error('AI disabled in harness')); },`,
  `  },`,
  `  files: {`,
  `    open: (payload) => { window.__calls.files.push({ action: 'open', ...payload }); return Promise.resolve({}); },`,
  `    reveal: (payload) => { window.__calls.files.push({ action: 'reveal', ...payload }); return Promise.resolve({}); },`,
  `    copyPath: (payload) => { window.__calls.files.push({ action: 'copyPath', ...payload }); return Promise.resolve({}); },`,
  `  },`,
  `};`,
  ``,
  `function Harness() {`,
  `  return <div style={{ height: '100vh' }}><GitReviewPanel conversationId="conv-1" project={{ path: '/ws' }}`,
  `    onAddToChat={(attachment) => window.__events.chat.push(attachment)}`,
  `    onAskInSideChat={(attachment) => window.__events.side.push(attachment)}`,
  `    onRunAgent={() => {}} /></div>;`,
  `}`,
  `createRoot(document.getElementById('root')).render(<Harness />);`,
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
  while (Date.now() - start < (timeout || 5000)) {
    try { const value = fn(); if (value) return value; } catch {}
    await sleep(50);
  }
  throw new Error('timeout: ' + (label || 'condition'));
}
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
function treeRow(path) { return document.querySelector('[data-git-path="' + CSS.escape(path) + '"]'); }
function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
async function idle() { await wait_for(() => q('.git-review-panel') && q('.git-review-panel').getAttribute('aria-busy') === 'false', 8000, 'idle'); }
(async () => {
  console.log('[driver] start');
  await wait_for(() => qa('select[aria-label="Git repository"] option').length === 2, 5000, 'repo options');
  const sel = q('select[aria-label="Git repository"]');
  check('repo picker lists both repositories', sel.textContent.includes('repo-a') && sel.textContent.includes('repo-b'), sel.textContent);
  check('real generated CSS applied (panel flex column)', getComputedStyle(q('.git-review-panel')).display === 'flex');

  await wait_for(() => window.__calls.index.some((c) => c.repositoryPath === 'repo-a'), 5000, 'repo-a index requested');
  setNativeValue(sel, 'repo-b');
  const fileCallsAtSwitch = window.__calls.file.length;
  await wait_for(() => (q('.git-review-file-header strong') || {}).title === 'only.txt', 5000, 'repo-b file');
  await sleep(700);
  check('repo switch race: stale slow repo-a index ignored', sel.value === 'repo-b' && q('.git-review-file-header strong').title === 'only.txt', sel.value + ' / ' + q('.git-review-file-header strong').title);
  check('repo switch race: every file fetched after the switch targets the active repo', window.__calls.file.length > fileCallsAtSwitch && window.__calls.file.slice(fileCallsAtSwitch).every((c) => c.repositoryPath === 'repo-b'), JSON.stringify(window.__calls.file));

  setNativeValue(sel, 'repo-a');
  await wait_for(() => (q('.git-review-file-header strong') || {}).title === 'src/app.js' && qa('.git-diff-line').length > 10, 8000, 'repo-a file');
  check('switching back loads the active repo file', q('.git-review-file-header strong').title === 'src/app.js', q('.git-review-file-header strong').title);

  check('tree exposes Unstaged and Staged changes roots', qa('[data-git-path="."]').map((row) => row.querySelector('.git-review-tree-name').textContent).join('|') === 'Unstaged|Staged changes');
  check('partially staged file appears in both groups', qa('[data-git-path="src/app.js"]').length === 2);
  q('[data-git-key="staged:src/app.js"]').click();
  await wait_for(() => window.__calls.file.at(-1).staged === true, 3000, 'staged scope');
  check('staged entry opens staged preview', q('[data-git-key="staged:src/app.js"]').getAttribute('aria-selected') === 'true');
  q('[data-git-key="unstaged:src/app.js"]').click();
  await wait_for(() => window.__calls.file.at(-1).unstaged === true && qa('.git-diff-line').length > 10, 3000, 'unstaged scope');

  const big = treeRow('bigdir');
  check('folder with >100 files starts collapsed', big && big.getAttribute('aria-expanded') === 'false' && !treeRow('bigdir/file-0001.js'), big ? big.getAttribute('aria-expanded') : 'missing');
  big.click();
  await wait_for(() => Boolean(treeRow('bigdir/file-0001.js')), 3000, 'expand bigdir');
  check('collapsed folder expands on click', Boolean(treeRow('bigdir/file-0001.js')) && treeRow('bigdir').getAttribute('aria-expanded') === 'true');
  treeRow('bigdir').click();
  await wait_for(() => !treeRow('bigdir/file-0001.js'), 3000, 'collapse bigdir');
  check('folder collapses again on click', treeRow('bigdir').getAttribute('aria-expanded') === 'false');

  treeRow('bigdir').click();
  await wait_for(() => Boolean(treeRow('bigdir/file-0001.js')), 3000, 'expand bigdir for virtualization');
  const rendered = qa('.git-review-tree-row').length;
  const spacerH = parseFloat(q('.git-review-tree > div').style.height);
  check('tree virtualizes thousands of rows', rendered < 200 && spacerH > 50000, 'rendered=' + rendered + ' spacer=' + spacerH);
  const tree = q('.git-review-tree');
  const firstBefore = qa('.git-review-tree-row')[0].dataset.gitPath;
  tree.scrollTop = tree.scrollHeight;
  await wait_for(() => { const rows = qa('.git-review-tree-row'); return rows.length && rows[0].dataset.gitPath !== firstBefore; }, 3000, 'scroll bottom');
  const firstAfter = qa('.git-review-tree-row')[0].dataset.gitPath;
  check('scrolling renders a different window of rows', Boolean(firstAfter) && firstAfter !== firstBefore, String(firstAfter));
  tree.scrollTop = 0;
  await wait_for(() => Boolean(treeRow('bigdir')), 3000, 'scroll top restore');
  treeRow('bigdir').click();
  await wait_for(() => !treeRow('bigdir/file-0001.js'), 3000, 'collapse bigdir after virtualization');

  for (const scheme of ['light', 'dark']) {
    document.documentElement.dataset.colorScheme = scheme;
    const keyword = q('.git-diff-line .token.keyword');
    const number = q('.git-diff-line .token.number');
    check('syntax tokens have distinct colors in ' + scheme, Boolean(keyword && number)
      && getComputedStyle(keyword).color !== getComputedStyle(keyword.closest('code')).color
      && getComputedStyle(keyword).color !== getComputedStyle(number).color);
  }
  document.documentElement.dataset.colorScheme = 'light';

  const gapBtn = q('.git-diff-gap button:nth-child(2)');
  const gapText = gapBtn ? gapBtn.textContent : '';
  check('diff hides distant lines behind a gap row', Boolean(gapBtn) && gapText.includes('208 hidden lines'), gapText);
  const linesBefore = qa('.git-diff-line').length;
  q('.git-diff-gap button[aria-label="Expand hidden lines from top"]').click();
  await wait_for(() => qa('.git-diff-line').length === linesBefore + 20, 3000, 'expand top');
  check('gap expands 20 hidden lines from top', qa('.git-diff-line').length === linesBefore + 20, 'lines=' + qa('.git-diff-line').length);
  q('.git-diff-gap button[aria-label="Expand hidden lines from bottom"]').click();
  await wait_for(() => qa('.git-diff-line').length === linesBefore + 40, 3000, 'expand bottom');
  check('gap expands 20 hidden lines from bottom', qa('.git-diff-line').length === linesBefore + 40 && q('.git-diff-gap button:nth-child(2)').textContent.includes('168 hidden lines'), 'lines=' + qa('.git-diff-line').length);

  const codes = qa('.git-diff-line code');
  const code120 = codes.find((c) => c.dataset.newLine === '20');
  const code121 = codes.find((c) => c.dataset.newLine === '21');
  check('repeated-text fixture exposes identical adjacent lines', Boolean(code120) && Boolean(code121) && code120.textContent === code121.textContent, code120 ? code120.textContent : 'missing');
  const range = document.createRange();
  range.setStart(code120, 0);
  range.setEnd(code121, code121.childNodes.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const selectedText = selection.toString();
  q('.git-diff-lines').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await wait_for(() => Boolean(q('.selection-action-group')), 3000, 'toolbar');
  check('selecting diff text opens the selection toolbar', Boolean(q('.selection-action-group')), (q('.selection-action-group') || {}).textContent);
  const htmlBefore = q('.git-diff-lines').innerHTML;
  const toolbar = q('.selection-action-group');
  toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  toolbar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(150);
  check('mousedown on toolbar keeps the toolbar open', Boolean(document.body.contains(toolbar) && q('.selection-action-group')));
  check('toolbar interaction preserves the diff DOM', q('.git-diff-lines').innerHTML === htmlBefore);
  check('toolbar interaction preserves the selection range', window.getSelection().rangeCount > 0 && window.getSelection().toString() === selectedText, JSON.stringify(window.getSelection().toString().slice(0, 80)));

  [...q('.selection-action-group').querySelectorAll('button')].find((b) => b.textContent.includes('Annotate')).click();
  await wait_for(() => Boolean(q('.git-review-annotation textarea')), 3000, 'annotation form');
  check('annotation form focuses its textarea', document.activeElement === q('.git-review-annotation textarea'), (document.activeElement || {}).tagName);
  check('focused annotation keeps the visual highlight on the selected lines', Boolean(window.CSS?.highlights?.has?.('git-review-selection')), 'highlights=' + (window.CSS?.highlights ? [...window.CSS.highlights.keys()].join(',') : 'unsupported'));
  setNativeValue(q('.git-review-annotation textarea'), 'needs null guard');
  await wait_for(() => !q('.git-review-annotation button[type="submit"]').disabled, 3000, 'annotation submit enabled');
  q('.git-review-annotation button[type="submit"]').click();
  await wait_for(() => window.__events.chat.length === 1, 3000, 'annotation payload');
  const attachment = window.__events.chat[0];
  check('annotation payload cites the exact repeated lines', attachment.text.includes('range="L20-L21"') && attachment.text.includes('<comment>needs null guard</comment>') && attachment.filepath.endsWith('src/app.js'), attachment.text.slice(0, 200));
  check('annotation payload carries the selected diff content', attachment.text.includes('const repeated = 42; // repeated-token'), attachment.text.slice(0, 200));

  treeRow('src/app.js').querySelector('button[aria-label^="Actions for"]').click();
  await wait_for(() => Boolean(q('.git-review-menu [role="menuitem"]')), 3000, 'menu open');
  const items = qa('.git-review-menu [role="menuitem"], .git-review-menu button');
  check('context menu opens with actions and initial focus', items.length >= 5 && q('.git-review-menu').contains(document.activeElement), 'items=' + items.length + ' focus=' + (document.activeElement || {}).textContent);
  const focusedBefore = document.activeElement;
  q('.git-review-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await sleep(150);
  check('menu supports ArrowDown keyboard navigation', document.activeElement !== focusedBefore && q('.git-review-menu').contains(document.activeElement), (document.activeElement || {}).textContent);
  const openerLabel = 'Actions for src/app.js';
  q('.git-review-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait_for(() => !q('.git-review-menu'), 3000, 'menu escape');
  check('menu Escape closes and refocuses the opener', !q('.git-review-menu') && (document.activeElement || {}).getAttribute?.('aria-label') === openerLabel, (document.activeElement || {}).tagName + ' ' + ((document.activeElement || {}).getAttribute?.('aria-label') || ''));

  const stageBtn = treeRow('src/util.js').querySelector('button[aria-label^="Stage"]');
  check('unstaged file offers a Stage row action', Boolean(stageBtn), stageBtn ? stageBtn.getAttribute('aria-label') : 'missing');
  const mut0 = window.__calls.mutate.length;
  stageBtn.click();
  await wait_for(() => q('.git-review-notice[role="status"]')?.textContent.includes('Staging changes...'), 3000, 'stage progress');
  check('stage shows spinner and busy state before completion', Boolean(q('.git-review-notice .spin')) && q('.git-review-panel').getAttribute('aria-busy') === 'true' && stageBtn.disabled);
  await wait_for(() => window.__calls.mutate.length === mut0 + 1, 3000, 'stage call');
  check('stage sends action+path+version', JSON.stringify(window.__calls.mutate.at(-1)) === JSON.stringify({ conversationId: 'conv-1', repositoryPath: 'repo-a', action: 'stage', path: 'src/util.js', version: 7 }), JSON.stringify(window.__calls.mutate.at(-1)));
  await wait_for(() => document.body.textContent.includes('Git changes updated.'), 5000, 'stage notice');
  check('stage shows a success notice', document.body.textContent.includes('Git changes updated.'));
  check('stage progress clears after completion', !q('.git-review-notice .spin'));
  await idle();

  treeRow('src/app.js').querySelector('button[aria-label^="Actions for"]').click();
  await wait_for(() => Boolean(q('.git-review-menu [role="menuitem"]')), 3000, 'menu reopen');
  [...qa('.git-review-menu [role="menuitem"], .git-review-menu button')].find((b) => b.textContent.includes('Unstage')).click();
  await wait_for(() => window.__calls.mutate.length === mut0 + 2, 3000, 'unstage call');
  check('unstage sends action+path+version', window.__calls.mutate.at(-1).action === 'unstage' && window.__calls.mutate.at(-1).path === 'src/app.js' && window.__calls.mutate.at(-1).version === 7, JSON.stringify(window.__calls.mutate.at(-1)));
  await wait_for(() => q('.git-review-panel').getAttribute('aria-busy') === 'false', 5000, 'operation and refresh complete');

  treeRow('src/util.js').querySelector('button[aria-label^="Actions for"]').click();
  await wait_for(() => Boolean(q('.git-review-menu [role="menuitem"]')), 3000, 'menu ignore');
  [...qa('.git-review-menu [role="menuitem"], .git-review-menu button')].find((b) => b.textContent.includes('.gitignore')).click();
  await wait_for(() => window.__calls.mutate.length === mut0 + 3, 3000, 'ignore call');
  check('ignore sends action+path+version', window.__calls.mutate.at(-1).action === 'ignore' && window.__calls.mutate.at(-1).path === 'src/util.js' && window.__calls.mutate.at(-1).version === 7, JSON.stringify(window.__calls.mutate.at(-1)));
  await wait_for(() => q('.git-review-panel').getAttribute('aria-busy') === 'false', 5000, 'operation and refresh complete');

  treeRow('src/util.js').querySelector('button[aria-label^="Actions for"]').click();
  await wait_for(() => Boolean(q('.git-review-menu [role="menuitem"]')), 3000, 'menu discard');
  [...qa('.git-review-menu [role="menuitem"], .git-review-menu button')].find((b) => b.textContent.includes('Discard')).click();
  await wait_for(() => Boolean(q('.git-review-dialog')), 3000, 'discard dialog');
  check('discard opens a confirmation dialog naming the path', q('.git-review-dialog').textContent.includes('Discard changes?') && q('.git-review-dialog').textContent.includes('src/util.js'), q('.git-review-dialog').textContent.slice(0, 160));
  [...q('.git-review-dialog').querySelectorAll('button')].find((b) => b.textContent.includes('Discard permanently')).click();
  await wait_for(() => window.__calls.mutate.length === mut0 + 4, 3000, 'discard call');
  const discard = window.__calls.mutate.at(-1);
  check('discard confirmation sends confirmed payload', discard.action === 'discard' && discard.path === 'src/util.js' && discard.confirmed === true && discard.version === 7, JSON.stringify(discard));
  await wait_for(() => !q('.git-review-dialog'), 5000, 'dialog closed');
  await sleep(400);

  const commitBtn = q('.git-review-commit-actions .primary-mini');
  check('commit is disabled without a message', commitBtn.disabled === true);
  setNativeValue(q('#git-commit-message'), 'Review fix');
  await wait_for(() => commitBtn.disabled === false, 3000, 'commit enabled');
  check('commit enables with message and staged changes', commitBtn.disabled === false);
  commitBtn.click();
  await wait_for(() => window.__calls.mutate.length === mut0 + 5, 5000, 'commit call');
  const commit = window.__calls.mutate.at(-1);
  check('commit sends message payload', commit.action === 'commit' && commit.message === 'Review fix' && commit.version === 7, JSON.stringify(commit));
  const idxCalls = window.__calls.index.length;
  await wait_for(() => window.__calls.index.length === idxCalls + 1, 5000, 'post-commit refresh requested');
  await idle();
  setNativeValue(q('#git-commit-message'), 'Review fix part 2');
  await wait_for(() => q('#git-commit-message').value === 'Review fix part 2', 3000, 'message retyped');
  await wait_for(() => !([...qa('.git-review-commit-actions button')].find((b) => b.textContent.includes('Commit + push')) || {}).disabled, 8000, 'commit+push enabled');
  [...qa('.git-review-commit-actions button')].find((b) => b.textContent.includes('Commit + push')).click();
  await wait_for(() => window.__calls.mutate.length === mut0 + 6 && window.__calls.push.length === 1, 5000, 'commit+push calls');
  const commitPush = window.__calls.mutate.at(-1);
  check('commit+push sends commit then pushes', commitPush.action === 'commit' && commitPush.push === true && window.__calls.push[0].repositoryPath === 'repo-a', JSON.stringify(commitPush) + ' ' + JSON.stringify(window.__calls.push[0]));
  check('no AI/rede path was used (plan/commit mocks untouched)', window.__calls.plan.length === 0 && window.__calls.commit.length === 0, 'plan=' + window.__calls.plan.length + ' commit=' + window.__calls.commit.length);
  await wait_for(() => !q('[aria-label="Generate commit with AI"]').disabled, 5000, 'AI menu ready');
  q('[aria-label="Generate commit with AI"]').click();
  await wait_for(() => qa('.git-review-menu [role="menuitem"]').length === 3, 3000, 'AI dropdown');
  check('AI dropdown offers message and commits', qa('.git-review-menu [role="menuitem"]').map((item) => item.textContent).join('|') === 'Generate commit message|Generate commits|Generate commits + push');
  qa('.git-review-menu [role="menuitem"]')[0].click();
  await wait_for(() => q('#git-commit-message').value === 'feat: staged message', 3000, 'generated message');
  check('message generation is staged-only and does not commit', window.__calls.plan.at(-1).messageOnly === true && window.__calls.commit.length === 0);
  await idle();
  q('[aria-label="Generate commit with AI"]').click();
  await wait_for(() => qa('.git-review-menu [role="menuitem"]').length === 3, 3000, 'AI dropdown reopened');
  qa('.git-review-menu [role="menuitem"]')[1].click();
  await wait_for(() => window.__events.side.some((event) => event.initialPrompt), 3000, 'multi-commit side chat');
  const request = window.__events.side.find((event) => event.initialPrompt);
  check('Generate commits scopes multi-commit fork to selected repo', request.initialPrompt.includes('repo-a') && request.initialPrompt.includes('Do not push') && request.attachments[0].commandName === 'multi-commit');
  check('no renderer errors during run', window.__errors.length === 0, JSON.stringify(window.__errors));
  return results;
})()
`;

console.log('[harness] starting electron...', 'isReady:', app.isReady());
setTimeout(() => {
  console.log('[harness] FORCE EXIT (overall timeout)');
  app.exit(3);
}, 150_000);

app.whenReady().then(async () => {
  console.log('[harness] electron ready');
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('console-message', (event) => {
    if (String(event.message).includes('Download the React DevTools')) return;
    console.log('[page]', event.message);
  });

  try {
    await win.loadFile(join(buildDir, 'index.html'));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const run = win.webContents.executeJavaScript(driver, true);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('driver timeout')), 110_000));
    const results = await Promise.race([run, timeout]);

    for (const { name, pass, info } of results) {
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
      if (!pass) failures += 1;
    }

    for (const width of [280, 390, 480, 550, 700, 828, 1280]) {
      win.setContentSize(width, 780);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const overflow = await win.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('.git-review-commit');
        const bounds = form.getBoundingClientRect();
        return [...form.querySelectorAll('textarea, button')].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
        }).map((element) => element.getAttribute('aria-label') || element.textContent);
      })()`);
      console.log(`${overflow.length ? 'FAIL' : 'PASS'}  commit controls contained at ${width}px`, overflow);
      if (overflow.length) failures += 1;
    }

    for (const [width, height, scheme, name] of [[1280, 860, 'light', 'git-review-wide-light'], [390, 780, 'light', 'git-review-narrow-light'], [1280, 860, 'dark', 'git-review-wide-dark'], [390, 780, 'dark', 'git-review-narrow-dark']]) {
      try {
        await win.webContents.executeJavaScript(`document.documentElement.dataset.colorScheme = '${scheme}'`, true);
        win.setContentSize(width, height);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const shotPath = join(shotDir, `${name}.png`);
        writeFileSync(shotPath, await win.capturePage().then((image) => image.toPNG()));
        console.log('[harness] screenshot:', shotPath);
      } catch (shotError) {
        console.log('[harness] screenshot skipped:', name, shotError.message);
      }
    }
  } catch (error) {
    failures += 1;
    console.error('ERROR', error);
  }

  try { win.destroy(); } catch {}
  try {
    const css = readFileSync(join(root, 'src', 'renderer', 'styles.css'), 'utf8');
    if (!css.includes('.git-review-panel')) {
      failures += 1;
      console.error('FAIL  generated styles bundle lacks .git-review-panel');
    }
  } catch {}
  console.log(failures === 0 ? 'git review UI: all checks passed' : `git review UI: ${failures} check(s) failed`);
  app.exit(failures === 0 ? 0 : 1);
});
