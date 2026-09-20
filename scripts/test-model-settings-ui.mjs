import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

if (process.env.CHAT_APP_MODEL_SETTINGS_UI_TEST !== '1') {
  console.error('Run via: CHAT_APP_MODEL_SETTINGS_UI_TEST=1 bun x electron --no-sandbox scripts/test-model-settings-ui.mjs');
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'model-settings-ui');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));

// Renders the ACTUAL SettingsPage on the Models view with mocked data only.
// No database, no providers, no paid AI calls.
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPage } from '/src/renderer/components/SettingsPage.jsx';
import '/src/renderer/styles.css';
window.__calls = [];
const models = [
  { id: 'openai:gpt-5', name: 'GPT-5', providerId: 'openai', providerName: 'OpenAI', reasoning: ['low', 'medium', 'high'] },
  { id: 'anthropic:claude', name: 'Claude', providerId: 'anthropic', providerName: 'Anthropic', reasoning: [] },
  { id: '@fast-fallback', name: 'Fast fallback', providerId: '', providerName: 'Routers', reasoning: ['low', 'medium'] },
];
const seedSettings = {
  auxiliary: null,
  supervision: null,
  quickChat: null,
  compactation: null,
  rules: [
    { modelId: 'openai:gpt-5', role: 'main', instructions: 'Behave' },
    { modelId: 'ghost:model', role: 'bot', instructions: 'Hidden' },
  ],
  subagents: { enabled: false, small: null, medium: null, large: null },
  intelligence: { levels: [
    { id: 'l1', modelId: 'openai:gpt-5', reasoningEffort: null },
    { id: 'l2', modelId: 'anthropic:claude', reasoningEffort: null },
    { id: 'l3', modelId: 'openai:gpt-5', reasoningEffort: 'high' },
  ] },
};
const tuning = {
  personality: null, verbosity: 'medium', chatReasoningTraces: 'visible',
  continuationRepliesEnabled: true, automaticCompactionThreshold: 0.9,
  toolOutputLimit: 8192, defaultPermissionMode: 'approve_for_me',
  messageDeliveryMode: 'queue', terminalShell: 'auto', terminalTimeoutSeconds: 30,
  maxConcurrentSubagents: 128, rubberDuckMaxTurns: 20, logLevel: 'minimal',
};
window.chatApp = {
  routers: { list: async () => [] },
  app: { openExternal: () => {} },
  context: { folders: async () => [] },
  tuning: { shells: async () => [] },
  providers: { state: async () => ({}) },
};
const root = createRoot(document.getElementById('root'));
root.render(<SettingsPage
  providers={[]} providerTypes={[]} tuning={tuning} models={models}
  defaultModels={seedSettings} initialView="default-models"
  appearance={{ scheme: 'dark' }} backgroundUrl={null} pluginCatalog={{}} desktop={{}}
  updateState={null} onAppearanceChange={() => {}} onBackgroundSelect={async () => {}}
  onBackgroundRemove={async () => {}} onDesktopChange={async () => {}} onClose={() => {}}
  onSave={async () => []} onRemove={async () => []} onModelsChange={async () => {}}
  onRoutersChange={async () => {}}
  onSaveDefaultModels={async (settings) => {
    window.__calls.push(['saveDefaultModels', JSON.parse(JSON.stringify(settings))]);
    return { settings, warnings: [] };
  }}
  onSaveTuning={async (value) => value}
/>);
`;

const desktopChecks = `(async () => {
  const wait = async (predicate, label) => { for (let i = 0; i < 200; i++) { try { if (predicate()) return; } catch (e) {} await new Promise((r) => setTimeout(r, 20)); } throw new Error('UI timeout: ' + label); };
  const qa = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));
  const fails = [];
  const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + extra : '')); };
  const tab = (id) => document.getElementById('models-tab-' + id);
  const panel = (id) => document.getElementById('models-panel-' + id);
  const tablist = () => document.querySelector('[role="tablist"][aria-label="Model settings"]');
  const saveBtn = () => document.querySelector('.settings-actions .primary-mini');
  const setSelect = (el, value) => { const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const setText = (el, value) => { const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const fieldSelect = (panelEl, label) => {
    const field = qa('.default-model-field', panelEl).filter((f) => { const s = f.querySelector(':scope > span'); return s && s.textContent === label; })[0];
    if (!field) throw new Error('missing field: ' + label);
    return field.querySelector('.default-model-row select');
  };
  const ruleCard = (index) => qa('#models-panel-rules .model-rule')[index];
  const ruleModel = (index) => ruleCard(index).querySelectorAll('.model-rule-selection select')[0];
  const ruleRole = (index) => ruleCard(index).querySelectorAll('.model-rule-selection select')[1];
  const ruleText = (index) => ruleCard(index).querySelector('textarea');
  const key = (el, name) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  const controlsInsideCards = (scope) => {
    qa('#models-panel-rules .model-rule').forEach((card, cardIndex) => {
      const cardRect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      const innerLeft = cardRect.left + parseFloat(style.paddingLeft);
      const innerRight = cardRect.right - parseFloat(style.paddingRight);
      qa('select, textarea, input', card).forEach((el) => {
        const r = el.getBoundingClientRect();
        check(scope + ': rule ' + (cardIndex + 1) + ' ' + el.tagName + ' right edge inside card', r.right <= innerRight + 2, 'right=' + r.right.toFixed(1) + ' inner=' + innerRight.toFixed(1));
        check(scope + ': rule ' + (cardIndex + 1) + ' ' + el.tagName + ' left edge inside card', r.left >= innerLeft - 2, 'left=' + r.left.toFixed(1) + ' inner=' + innerLeft.toFixed(1));
      });
    });
  };

  await wait(() => tab('auxiliary') && tab('slider'), 'models tabs render');
  const labels = qa('[role="tab"]', tablist()).map((el) => el.textContent);
  check('four tabs with screenshot labels', JSON.stringify(labels) === JSON.stringify(['Auxiliar models', 'Sub-agents', 'Rules', 'Model slider']), labels.join(' | '));
  check('tabs reference their panels', qa('[role="tab"]', tablist()).every((el) => document.getElementById(el.getAttribute('aria-controls'))), 'aria-controls');
  check('auxiliary selected by default', tab('auxiliary').getAttribute('aria-selected') === 'true' && tab('rules').getAttribute('aria-selected') === 'false');
  check('roving tabIndex', tab('auxiliary').tabIndex === 0 && tab('rules').tabIndex === -1);
  check('only auxiliary panel visible', !panel('auxiliary').hidden && panel('subagents').hidden && panel('rules').hidden && panel('slider').hidden);
  check('real generated CSS applied (tablist flex)', getComputedStyle(tablist()).display === 'flex', getComputedStyle(tablist()).display);
  check('tablist wraps', getComputedStyle(tablist()).flexWrap === 'wrap', getComputedStyle(tablist()).flexWrap);
  check('hidden panels display none', getComputedStyle(panel('rules')).display === 'none', getComputedStyle(panel('rules')).display);

  tab('rules').focus();
  key(tab('rules'), 'ArrowRight');
  await wait(() => tab('slider').getAttribute('aria-selected') === 'true', 'arrowright selection');
  check('ArrowRight moves to slider with focus', document.activeElement === tab('slider'));
  key(tab('slider'), 'ArrowLeft');
  await wait(() => tab('rules').getAttribute('aria-selected') === 'true', 'arrowleft selection');
  check('ArrowLeft moves back to rules', document.activeElement === tab('rules'));
  key(tab('rules'), 'End');
  await wait(() => tab('slider').getAttribute('aria-selected') === 'true', 'end selection');
  check('End jumps to slider', document.activeElement === tab('slider'));
  key(tab('slider'), 'Home');
  await wait(() => tab('auxiliary').getAttribute('aria-selected') === 'true' && !panel('auxiliary').hidden, 'home selection');
  check('Home jumps to auxiliary', document.activeElement === tab('auxiliary'));

  const auxSelect = fieldSelect(panel('auxiliary'), 'Auxiliary model');
  const auxOptions = Array.from(auxSelect.options).map((o) => o.value);
  check('virtual @router selectable in auxiliary field', auxOptions.includes('@fast-fallback'), auxOptions.join(','));
  setSelect(auxSelect, '@fast-fallback');
  check('auxiliary draft takes @router', auxSelect.value === '@fast-fallback', auxSelect.value);
  tab('rules').click();
  await wait(() => !panel('rules').hidden, 'rules panel opens');
  tab('auxiliary').click();
  await wait(() => !panel('auxiliary').hidden, 'auxiliary panel reopens');
  check('auxiliary draft persists across tabs', fieldSelect(panel('auxiliary'), 'Auxiliary model').value === '@fast-fallback');

  tab('subagents').click();
  await wait(() => !panel('subagents').hidden, 'subagents panel opens');
  const toggle = panel('subagents').querySelector('input[type="checkbox"]');
  check('subagent levels off by default', toggle.checked === false);
  check('save enabled with valid seed rules', saveBtn().disabled === false, 'disabled=' + saveBtn().disabled);
  toggle.click();
  await wait(() => qa('.default-model-field', panel('subagents')).length === 3, 'level fields appear');
  check('save disabled until small/medium/large set', saveBtn().disabled === true);
  setSelect(fieldSelect(panel('subagents'), 'Small model'), 'openai:gpt-5');
  setSelect(fieldSelect(panel('subagents'), 'Medium model'), 'anthropic:claude');
  setSelect(fieldSelect(panel('subagents'), 'Large model'), 'openai:gpt-5');
  check('save re-enabled after levels set', saveBtn().disabled === false);

  tab('slider').click();
  await wait(() => !panel('slider').hidden, 'slider panel opens');
  check('three intelligence levels render', qa('#models-panel-slider .settings-row-card', panel('slider')).length >= 3, String(qa('#models-panel-slider .settings-row-card').length));
  const addLevel = qa('button', panel('slider')).filter((b) => b.textContent.includes('Add level'))[0];
  addLevel.click();
  await wait(() => qa('#models-panel-slider .settings-row-card').length >= 4, 'level added');
  qa('button[aria-label="Remove level 4"]', panel('slider'))[0].click();
  await wait(() => qa('#models-panel-slider .settings-row-card').length <= 4, 'level removed');

  tab('rules').click();
  await wait(() => !panel('rules').hidden, 'rules panel reopens');
  check('two seeded rules render', qa('#models-panel-rules .model-rule').length === 2);
  const ghostOptions = Array.from(ruleModel(1).options).map((o) => o.value + '=' + o.textContent);
  check('unavailable rule preserved with marker', ghostOptions.some((o) => o.indexOf('ghost:model (unavailable)') >= 0), ghostOptions.join(' | '));
  check('unavailable rule counts as filled', ruleModel(1).getAttribute('aria-invalid') === 'false');

  const roles = ['bot', 'subagent', 'all', 'main'];
  for (const role of roles) { setSelect(ruleRole(0), role); check('role selectable: ' + role, ruleRole(0).value === role, ruleRole(0).value); }
  setText(ruleText(0), 'Behave well');
  check('rule instructions editable', ruleText(0).value === 'Behave well');

  qa('button', panel('rules')).filter((b) => b.textContent.includes('Add rule'))[0].click();
  await wait(() => qa('#models-panel-rules .model-rule').length === 3, 'rule added');
  check('blank rule disables save', saveBtn().disabled === true);
  setSelect(ruleModel(2), 'openai:gpt-5');
  setSelect(ruleRole(2), 'main');
  setText(ruleText(2), 'Dup check');
  check('duplicate model+role disables save', saveBtn().disabled === true, 'model=' + ruleModel(2).value + ' role=' + ruleRole(2).value);
  setSelect(ruleRole(2), 'all');
  check('unique role re-enables save', saveBtn().disabled === false);

  qa('button[aria-label="Remove rule 3"]', panel('rules'))[0].click();
  await wait(() => qa('#models-panel-rules .model-rule').length === 2, 'rule removed');
  check('save enabled after removing invalid rule', saveBtn().disabled === false);
  qa('button', panel('rules')).filter((b) => b.textContent.includes('Add rule'))[0].click();
  await wait(() => qa('#models-panel-rules .model-rule').length === 3, 'rule re-added');
  setSelect(ruleModel(2), 'openai:gpt-5');
  setSelect(ruleRole(2), 'all');
  setText(ruleText(2), 'Dup check');
  check('drafts persist across tabs (aux + rule text)', fieldSelect(panel('auxiliary'), 'Auxiliary model') && ruleText(0).value === 'Behave well');
  tab('auxiliary').click();
  await wait(() => !panel('auxiliary').hidden, 'auxiliary check');
  check('auxiliary still @router before save', fieldSelect(panel('auxiliary'), 'Auxiliary model').value === '@fast-fallback');
  tab('rules').click();
  await wait(() => !panel('rules').hidden, 'rules check before save');
  controlsInsideCards('desktop rules');

  saveBtn().click();
  await wait(() => window.__calls.length === 1, 'save callback fired');
  await wait(() => saveBtn().textContent.includes('Saved'), 'saved label');
  const payload = window.__calls[0][1];
  check('save receives full settings object', payload && payload.auxiliary && payload.subagents && Array.isArray(payload.rules) && payload.intelligence, Object.keys(payload || {}).join(','));
  check('save carries @router auxiliary', payload.auxiliary.modelId === '@fast-fallback', JSON.stringify(payload.auxiliary));
  check('save carries subagent levels', payload.subagents.enabled === true && payload.subagents.small.modelId === 'openai:gpt-5' && payload.subagents.medium.modelId === 'anthropic:claude' && payload.subagents.large.modelId === 'openai:gpt-5', JSON.stringify(payload.subagents));
  check('save carries all three rules', payload.rules.length === 3, JSON.stringify(payload.rules.length));
  check('save carries edited rule', payload.rules[0].modelId === 'openai:gpt-5' && payload.rules[0].role === 'main' && payload.rules[0].instructions === 'Behave well', JSON.stringify(payload.rules[0]));
  check('save preserves unavailable rule', payload.rules[1].modelId === 'ghost:model' && payload.rules[1].role === 'bot' && payload.rules[1].instructions === 'Hidden', JSON.stringify(payload.rules[1]));
  check('save carries new rule', payload.rules[2].modelId === 'openai:gpt-5' && payload.rules[2].role === 'all' && payload.rules[2].instructions === 'Dup check', JSON.stringify(payload.rules[2]));
  check('save carries slider levels', payload.intelligence.levels.length === 3, String(payload.intelligence.levels.length));
  check('save button shows Saved', saveBtn().textContent.includes('Saved'), saveBtn().textContent.trim());
  if (fails.length) throw new Error('Model settings defects:\\n- ' + fails.join('\\n- '));
  return true;
})()`;

const narrowChecks = `(async () => {
  const wait = async (predicate, label) => { for (let i = 0; i < 200; i++) { try { if (predicate()) return; } catch (e) {} await new Promise((r) => setTimeout(r, 20)); } throw new Error('UI timeout: ' + label); };
  const fails = [];
  const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + extra : '')); };
  await wait(() => document.getElementById('models-tab-rules'), 'tabs present');
  const tablist = document.querySelector('[role="tablist"][aria-label="Model settings"]');
  const rect = tablist.getBoundingClientRect();
  check('narrow: tablist visible', rect.width > 0 && rect.height > 0, rect.width + 'x' + rect.height);
  check('narrow: tabs wrap without horizontal overflow', tablist.scrollWidth <= tablist.clientWidth + 1, 'scroll=' + tablist.scrollWidth + ' client=' + tablist.clientWidth);
  document.getElementById('models-tab-rules').click();
  await wait(() => !document.getElementById('models-panel-rules').hidden, 'rules visible narrow');
  const visible = ['auxiliary', 'subagents', 'rules', 'slider'].filter((id) => !document.getElementById('models-panel-' + id).hidden);
  check('narrow: exactly one panel visible', JSON.stringify(visible) === JSON.stringify(['rules']), visible.join(','));
  check('narrow: rule selection grid renders', Boolean(document.querySelector('#models-panel-rules .model-rule-selection')), 'missing');
  (() => {
    const failsNarrow = [];
    document.querySelectorAll('#models-panel-rules .model-rule').forEach((card, cardIndex) => {
      const cardRect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      const innerLeft = cardRect.left + parseFloat(style.paddingLeft);
      const innerRight = cardRect.right - parseFloat(style.paddingRight);
      card.querySelectorAll('select, textarea, input').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > innerRight + 2) failsNarrow.push('narrow: rule ' + (cardIndex + 1) + ' ' + el.tagName + ' overflows right :: right=' + r.right.toFixed(1) + ' inner=' + innerRight.toFixed(1));
        if (r.left < innerLeft - 2) failsNarrow.push('narrow: rule ' + (cardIndex + 1) + ' ' + el.tagName + ' overflows left :: left=' + r.left.toFixed(1) + ' inner=' + innerLeft.toFixed(1));
      });
    });
    failsNarrow.forEach((f) => fails.push(f));
  })();
  const saveRect = document.querySelector('.settings-actions .primary-mini').getBoundingClientRect();
  check('narrow: save action visible', saveRect.width > 0 && saveRect.height > 0);
  if (fails.length) throw new Error('Narrow layout defects:\\n- ' + fails.join('\\n- '));
  return true;
})()`;

const captureGate = `(async () => {
  const wait = async (predicate, label) => { for (let i = 0; i < 200; i++) { try { if (predicate()) return; } catch (e) {} await new Promise((r) => setTimeout(r, 20)); } throw new Error('Capture gate timeout: ' + label); };
  await wait(() => document.documentElement.getAttribute('data-theme') === 'axion', 'axion theme');
  await wait(() => document.getElementById('models-tab-rules'), 'rules tab exists');
  document.getElementById('models-tab-rules').click();
  await wait(() => document.getElementById('models-tab-rules').getAttribute('aria-selected') === 'true', 'rules tab selected');
  await wait(() => !document.getElementById('models-panel-rules').hidden, 'rules panel unhidden');
  await wait(() => getComputedStyle(document.getElementById('models-panel-rules')).display !== 'none', 'rules panel painted');
  const visible = ['auxiliary', 'subagents', 'rules', 'slider'].filter((id) => getComputedStyle(document.getElementById('models-panel-' + id)).display !== 'none');
  if (JSON.stringify(visible) !== JSON.stringify(['rules'])) throw new Error('Capture gate: unexpected visible panels: ' + visible.join(','));
  const active = Array.from(document.querySelectorAll('[role="tab"]')).filter((el) => el.getAttribute('aria-selected') === 'true').map((el) => el.id);
  if (JSON.stringify(active) !== JSON.stringify(['models-tab-rules'])) throw new Error('Capture gate: unexpected active tab: ' + active.join(','));
  const state = {
    theme: document.documentElement.getAttribute('data-theme'),
    scheme: document.documentElement.getAttribute('data-color-scheme'),
    active,
    visible,
    displays: Object.fromEntries(['auxiliary', 'subagents', 'rules', 'slider'].map((id) => [id, getComputedStyle(document.getElementById('models-panel-' + id)).display])),
  };
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return state;
})()`;

let server;
let testWindow;
const timeout = setTimeout(() => app.exit(2), 150000);
app.whenReady().then(async () => {
  try {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{
      name: 'model-settings-test',
      resolveId(id) { if (id === '/model-settings-test.jsx') return '\0model-settings-test'; },
      async load(id) { if (id === '\0model-settings-test') return (await transformWithEsbuild(entry, 'model-settings-test.jsx', { loader: 'jsx', jsx: 'transform' })).code; },
      configureServer(vite) { vite.middlewares.use('/__model-settings', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await vite.transformIndexHtml('/__model-settings', '<html lang="en" data-theme="axion" data-color-scheme="light" data-transparency-mode="opaque"><body><div id="root"></div><script type="module" src="/model-settings-test.jsx"></script></body></html>'));
      }); },
    }] });
    await server.listen();
    testWindow = new BrowserWindow({ show: true, width: 1280, height: 900, webPreferences: { backgroundThrottling: false } });
    testWindow.webContents.on('console-message', (_event, _level, message) => console.log(message));
    await testWindow.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__model-settings`);
    await testWindow.webContents.executeJavaScript('(async () => { for (let i = 0; i < 200; i++) { if (document.getElementById("models-tab-auxiliary")) return true; await new Promise((r) => setTimeout(r, 20)); } throw new Error("UI timeout: initial render"); })()');
    assert.equal(await testWindow.webContents.executeJavaScript(desktopChecks), true);
    console.log('Desktop model settings UI tests passed.');
    const desktopGate = await testWindow.webContents.executeJavaScript(captureGate);
    assert.deepEqual(desktopGate.active, ['models-tab-rules']);
    assert.deepEqual(desktopGate.visible, ['rules']);
    console.log('Desktop capture gate:', JSON.stringify(desktopGate));
    await new Promise((resolve) => setTimeout(resolve, 600));
    writeFileSync(join(artifacts, 'settings-models-rules-desktop.png'), (await testWindow.capturePage()).toPNG());
    testWindow.setSize(430, 800);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await testWindow.webContents.executeJavaScript(narrowChecks), true);
    console.log('Narrow model settings UI tests passed.');
    const narrowGate = await testWindow.webContents.executeJavaScript(captureGate);
    assert.deepEqual(narrowGate.active, ['models-tab-rules']);
    assert.deepEqual(narrowGate.visible, ['rules']);
    console.log('Narrow capture gate:', JSON.stringify(narrowGate));
    await new Promise((resolve) => setTimeout(resolve, 600));
    writeFileSync(join(artifacts, 'settings-models-rules-narrow.png'), (await testWindow.capturePage()).toPNG());
    console.log(`Screenshots: ${artifacts}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    testWindow?.destroy();
    await server?.close();
    app.exit(process.exitCode || 0);
  }
});
