import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createServer, transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const artifacts = join(tmpdir(), '.avi', 'visualizations', timestamp, 'bot-settings-ui');
await mkdir(artifacts, { recursive: true });
app.setPath('userData', join(artifacts, 'profile'));

const moduleId = '\0bot-settings-ui-test';
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPage } from '/src/renderer/components/SettingsPage.jsx';
import '/src/renderer/styles.css';

const clone = (value) => JSON.parse(JSON.stringify(value));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const seedSettings = { maxConcurrentBots: 3, executionMode: 'orchestrator', activationWindow: null };
const statsFor = (days) => ({
  totals: {
    tokens: days * 1000,
    inputTokens: days * 300,
    cachedInputTokens: days * 100,
    outputTokens: days * 500,
    reasoningTokens: days * 100,
    responses: days,
    createdThreads: Math.max(1, Math.floor(days / 2)),
    cost: days * 0.0123,
    unpricedResponses: 0,
  },
  bots: [{
    id: 'bot-builder',
    name: 'Builder ' + days + 'd',
    scheduleState: 'active',
    totals: {
      tokens: days * 1000,
      responses: days,
      createdThreads: Math.max(1, Math.floor(days / 2)),
      cost: days * 0.0123,
    },
  }],
  timeline: [{
    date: '2026-09-19',
    usageMessages: days,
    tokens: days * 1000,
    bots: [{ id: 'bot-builder', name: 'Builder', tokens: days * 1000, cost: days * 0.0123 }],
  }],
});

window.__test = {
  mode: 'success',
  settingsDelay: 150,
  settingsCalls: 0,
  statisticsCalls: [],
  saves: [],
  renderKey: 0,
};
window.chatApp = {
  bots: {
    settings: async () => {
      window.__test.settingsCalls += 1;
      await delay(window.__test.settingsDelay);
      if (window.__test.mode === 'settings-error') throw new Error('Settings data unavailable');
      return clone(seedSettings);
    },
    statistics: async (days) => {
      window.__test.statisticsCalls.push(days);
      await delay(25);
      if (window.__test.mode === 'statistics-error') throw new Error('Statistics data unavailable');
      return statsFor(days);
    },
    saveSettings: async (settings) => {
      window.__test.saves.push(clone(settings));
      await delay(25);
      if (window.__test.mode === 'save-error') throw new Error('Save activation settings failed');
      return clone(settings);
    },
  },
  app: { openExternal: () => {} },
};

const settingsProps = {
  providers: [], providerTypes: [], tuning: {}, models: [], defaultModels: {}, initialView: 'bots',
  appearance: { scheme: 'dark' }, backgroundUrl: null, pluginCatalog: {}, desktop: {}, updateState: null,
  onAppearanceChange: () => {}, onBackgroundSelect: async () => {}, onBackgroundRemove: async () => {},
  onDesktopChange: async () => {}, onClose: () => {}, onSave: async () => [], onRemove: async () => [],
  onModelsChange: async () => {}, onRoutersChange: async () => {}, onSaveDefaultModels: async () => {},
  onSaveTuning: async () => {},
};
const rootNode = createRoot(document.getElementById('root'));
window.__test.remount = () => {
  window.__test.renderKey += 1;
  rootNode.render(<SettingsPage key={window.__test.renderKey} {...settingsProps} />);
};
window.__test.remount();
`;

const checks = `(async () => {
  const results = [];
  const wait = async (predicate, label) => {
    for (let index = 0; index < 200; index += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('UI timeout: ' + label);
  };
  const check = (name, value) => results.push({ name, pass: Boolean(value) });
  const button = (text, scope = document) => [...scope.querySelectorAll('button')].find((item) => item.textContent.trim() === text);
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const findPeriod = (period) => [...document.querySelectorAll('[aria-label="Statistics period"] button')]
    .find((item) => item.textContent.trim() === period + 'd');

  await wait(() => document.querySelector('#bots-tab-activation'), 'activation tab');
  check('SettingsPage wrapper renders the bots view', Boolean(document.querySelector('.settings-page .settings-sidebar')));
  check('Activation loading state is visible', document.querySelector('#bots-panel-activation .settings-empty')?.textContent.includes('Loading activation settings'));
  await wait(() => document.querySelector('#bots-panel-activation input[type="number"]'), 'activation settings');
  check('Settings data loaded through the mocked bridge', window.__test.settingsCalls === 1);
  check('Footer portal is mounted by SettingsPage', Boolean(document.querySelector('footer.settings-actions .primary-mini')));
  check('Statistics is not rendered while Activation settings is selected',
    getComputedStyle(document.getElementById('bots-panel-statistics')).display === 'none'
    && document.getElementById('bots-panel-statistics').getClientRects().length === 0);
  check('Save starts disabled for a clean draft', document.querySelector('footer.settings-actions .primary-mini').disabled);

  const concurrent = document.querySelector('#bots-panel-activation input[type="number"]');
  setValue(concurrent, '8');
  setValue(document.querySelector('#bots-panel-activation select'), 'direct');
  document.querySelector('#bots-panel-activation input[type="checkbox"]').click();
  await wait(() => document.querySelector('#bots-panel-activation [role="group"]'));
  button('Mon', document.querySelector('#bots-panel-activation [role="group"]')).click();
  await wait(() => [...document.querySelectorAll('#bots-panel-activation [role="group"] button')]
    .find((item) => item.textContent.trim() === 'Mon').getAttribute('aria-pressed') === 'true', 'active Monday');
  setValue([...document.querySelectorAll('#bots-panel-activation input[type="time"]')][0], '09:00');
  setValue([...document.querySelectorAll('#bots-panel-activation input[type="time"]')][1], '17:00');
  await wait(() => !document.querySelector('footer.settings-actions .primary-mini').disabled, 'dirty activation draft');
  check('Activation draft editing enables save', document.querySelector('footer.settings-actions .primary-mini').disabled === false);
  check('Edited activation values are rendered', concurrent.value === '8' && document.querySelector('#bots-panel-activation select').value === 'direct');
  check('Edited activation window is rendered', document.querySelector('#bots-panel-activation input[type="checkbox"]').checked
    && [...document.querySelectorAll('#bots-panel-activation [role="group"] button')].find((item) => item.textContent.trim() === 'Mon').getAttribute('aria-pressed') === 'true'
    && [...document.querySelectorAll('#bots-panel-activation input[type="time"]')][0].value === '09:00');
  const dayGroup = document.querySelector('#bots-panel-activation [role="group"]');
  const dayStyle = getComputedStyle(dayGroup);
  check('Active days uses the settings row without a native fieldset frame',
    dayStyle.borderLeftWidth === '0px' && dayStyle.borderRightWidth === '0px'
    && dayStyle.borderBottomWidth === '0px' && dayStyle.display === 'grid');
  const daysSelector = dayGroup.querySelector('.bot-settings-days');
  const dayButtons = [...daysSelector.querySelectorAll('button')];
  check('All seven days fit without horizontal scrolling on desktop',
    daysSelector.scrollWidth <= daysSelector.clientWidth + 1 && dayButtons.length === 7
    && dayButtons.every((button) => button.getBoundingClientRect().top === dayButtons[0].getBoundingClientRect().top));
  check('Day choices sit below their label and hint',
    daysSelector.getBoundingClientRect().top >= document.getElementById('bots-active-days-hint').getBoundingClientRect().bottom);
  check('Activation window uses the shared styled switch',
    getComputedStyle(document.querySelector('#bots-panel-activation input[type="checkbox"]')).appearance === 'none');
  check('Unsaved status is rendered in the footer portal', document.querySelector('footer.settings-actions').textContent.includes('Unsaved activation settings'));

  const activationTab = document.getElementById('bots-tab-activation');
  const statisticsTab = document.getElementById('bots-tab-statistics');
  activationTab.focus();
  activationTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await wait(() => statisticsTab.getAttribute('aria-selected') === 'true', 'keyboard tab navigation');
  check('ArrowRight moves to Statistics and focuses its tab', document.activeElement === statisticsTab && statisticsTab.tabIndex === 0);
  statisticsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  await wait(() => activationTab.getAttribute('aria-selected') === 'true', 'keyboard return navigation');
  check('ArrowLeft returns to Activation settings', document.activeElement === activationTab && activationTab.tabIndex === 0);
  statisticsTab.focus();
  statisticsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  await wait(() => statisticsTab.getAttribute('aria-selected') === 'true', 'End key navigation');
  check('End keeps focus on the final tab', document.activeElement === statisticsTab && statisticsTab.getAttribute('aria-selected') === 'true');

  statisticsTab.click();
  await wait(() => document.querySelector('[aria-label="Statistics period"]'), 'statistics panel');
  await wait(() => document.querySelector('.usage-breakdown-list')?.textContent.includes('Builder 7d'), 'seven day statistics');
  check('Draft remains retained while Statistics is active', document.querySelector('#bots-panel-activation input[type="number"]').value === '8'
    && document.querySelector('#bots-panel-activation').hidden);
  check('Activation panel has no layout box in Statistics',
    getComputedStyle(document.getElementById('bots-panel-activation')).display === 'none'
    && document.getElementById('bots-panel-activation').getClientRects().length === 0);
  check('Consumption components receive shared Orchestration layouts',
    getComputedStyle(document.querySelector('.token-overview')).display === 'grid'
    && getComputedStyle(document.querySelector('.token-overview-total')).display === 'grid'
    && getComputedStyle(document.querySelector('.token-overview-metrics')).display === 'grid'
    && getComputedStyle(document.querySelector('.usage-breakdown-content')).display === 'flex'
    && getComputedStyle(document.querySelector('.usage-breakdown-copy')).display === 'grid'
    && document.querySelector('.usage-breakdown-track').getBoundingClientRect().height === 3);
  check('Token label and value occupy separate lines',
    document.querySelector('.token-overview-total > strong').getBoundingClientRect().top
      >= document.querySelector('.token-overview-total > span').getBoundingClientRect().bottom);
  check('Existing statistics rendering shows totals and bot breakdown', document.querySelector('.token-overview')?.textContent.includes('Total tokens')
    && document.querySelector('.usage-breakdown-list')?.textContent.includes('Builder 7d')
    && document.querySelector('.usage-breakdown-track'));
  check('Default statistics period is 7 days', window.__test.statisticsCalls.at(-1) === 7 && findPeriod(7).getAttribute('aria-pressed') === 'true');

  findPeriod(1).click();
  await wait(() => window.__test.statisticsCalls.at(-1) === 1 && document.querySelector('.usage-breakdown-list')?.textContent.includes('Builder 1d'), 'one day statistics');
  check('Statistics period 1d reloads data', window.__test.statisticsCalls.at(-1) === 1 && findPeriod(1).getAttribute('aria-pressed') === 'true');
  findPeriod(30).click();
  await wait(() => window.__test.statisticsCalls.at(-1) === 30 && document.querySelector('.usage-breakdown-list')?.textContent.includes('Builder 30d'), 'thirty day statistics');
  check('Statistics period 30d reloads data', window.__test.statisticsCalls.at(-1) === 30 && findPeriod(30).getAttribute('aria-pressed') === 'true');
  findPeriod(7).click();
  await wait(() => window.__test.statisticsCalls.at(-1) === 7 && document.querySelector('.usage-breakdown-list')?.textContent.includes('Builder 7d'), 'seven day reload');

  window.__test.mode = 'statistics-error';
  findPeriod(1).click();
  await wait(() => document.querySelector('#bots-panel-statistics [role="alert"]')?.textContent.includes('Statistics data unavailable'), 'statistics data error');
  check('Statistics data error is exposed as an alert', document.querySelector('#bots-panel-statistics [role="alert"]')?.textContent === 'Statistics data unavailable');
  window.__test.mode = 'success';
  findPeriod(7).click();
  await wait(() => document.querySelector('.usage-breakdown-list')?.textContent.includes('Builder 7d'), 'statistics recovery');

  activationTab.click();
  await wait(() => getComputedStyle(document.getElementById('bots-panel-statistics')).display === 'none', 'activation after statistics');
  check('Loaded consumption disappears after switching back to Activation settings',
    document.getElementById('bots-panel-statistics').getClientRects().length === 0);
  window.__test.mode = 'success';
  button('Save changes', document.querySelector('footer.settings-actions')).click();
  await wait(() => document.querySelector('footer.settings-actions').textContent.includes('Activation settings saved.'), 'successful save');
  check('Save success persists the edited draft', window.__test.saves.length === 1
    && window.__test.saves[0].maxConcurrentBots === 8
    && window.__test.saves[0].executionMode === 'direct'
    && window.__test.saves[0].activationWindow.startMinute === 540);
  check('Save success notice is rendered', document.querySelector('footer.settings-actions').textContent.includes('Activation settings saved.'));

  setValue(document.querySelector('#bots-panel-activation input[type="number"]'), '9');
  await wait(() => !document.querySelector('footer.settings-actions .primary-mini').disabled, 'dirty draft before failed save');
  window.__test.mode = 'save-error';
  button('Save changes', document.querySelector('footer.settings-actions')).click();
  await wait(() => document.querySelector('footer.settings-actions [role="alert"]')?.textContent.includes('Save activation settings failed'), 'failed save');
  check('Save failure is exposed as an alert', document.querySelector('footer.settings-actions [role="alert"]')?.textContent === 'Save activation settings failed');
  check('Save failure retains the edited draft', document.querySelector('#bots-panel-activation input[type="number"]').value === '9'
    && document.querySelector('#bots-tab-activation').getAttribute('aria-selected') === 'true');

  window.__test.mode = 'settings-error';
  window.__test.settingsDelay = 0;
  window.__test.remount();
  await wait(() => document.querySelector('#bots-panel-activation .settings-empty')?.textContent.includes('Settings data unavailable'), 'settings data error');
  check('Activation settings data error is exposed in the page', document.querySelector('#bots-panel-activation .settings-empty')?.textContent === 'Settings data unavailable');

  return results;
})()`;

let server;
let testWindow;
const timeout = setTimeout(() => app.exit(2), 150000);

app.whenReady().then(async () => {
  try {
    server = await createServer({
      root,
      server: { host: '127.0.0.1', port: 0, strictPort: false },
      plugins: [{
        name: 'bot-settings-ui-test',
        resolveId(id) {
          if (id === '/bot-settings-ui-test.jsx') return moduleId;
        },
        async load(id) {
          if (id === moduleId) return (await transformWithEsbuild(entry, 'bot-settings-ui-test.jsx', { loader: 'jsx', jsx: 'transform' })).code;
        },
        configureServer(vite) {
          vite.middlewares.use('/__bot-settings', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(await vite.transformIndexHtml('/__bot-settings', '<html lang="en" data-theme="axion" data-color-scheme="dark" data-transparency-mode="opaque"><body><div id="root"></div><script type="module" src="/bot-settings-ui-test.jsx"></script></body></html>'));
          });
        },
      }],
    });
    await server.listen();
    testWindow = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { backgroundThrottling: false } });
    testWindow.webContents.on('console-message', (_event, _level, message) => console.log(message));
    await testWindow.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__bot-settings`);
    const results = await testWindow.webContents.executeJavaScript(checks, true);
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`);
      assert.equal(result.pass, true);
    }
    await testWindow.webContents.executeJavaScript(`(async () => {
      window.__test.mode = 'success';
      window.__test.remount();
      for (let index = 0; index < 200; index += 1) {
        if (document.querySelector('#bots-panel-activation input[type="number"]')) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      document.querySelector('#bots-panel-activation input[type="checkbox"]').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    })()`, true);
    await testWindow.webContents.executeJavaScript("document.querySelector('.bot-activation-days').scrollIntoView({ block: 'center', behavior: 'instant' })");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await writeFile(join(artifacts, 'bot-settings-activation.png'), (await testWindow.capturePage()).toPNG());
    await testWindow.webContents.executeJavaScript(`(async () => {
      document.getElementById('bots-tab-statistics').click();
      for (let index = 0; index < 200; index += 1) {
        if (document.querySelector('#bots-panel-statistics .token-overview')) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('UI timeout: narrow statistics setup');
    })()`, true);
    await writeFile(join(artifacts, 'bot-settings-desktop.png'), (await testWindow.capturePage()).toPNG());
    testWindow.setSize(430, 800);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const narrow = await testWindow.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('.settings-page');
      const statistics = document.querySelector('#bots-panel-statistics');
      const rows = [...document.querySelectorAll('.usage-breakdown-row')];
      return {
        viewport: window.innerWidth,
        pageFits: page.scrollWidth <= page.clientWidth + 1,
        statisticsFits: statistics.scrollWidth <= statistics.clientWidth + 1,
        rowsFit: rows.every((row) => row.scrollWidth <= row.clientWidth + 1),
        statsVisible: !statistics.hidden && statistics.querySelector('.token-overview')?.textContent.includes('Total tokens'),
      };
    })()`);
    assert.ok(narrow.pageFits && narrow.statisticsFits && narrow.rowsFit && narrow.statsVisible, `Narrow layout failed: ${JSON.stringify(narrow)}`);
    console.log('PASS Narrow width keeps the existing statistics rendering within the viewport');
    await writeFile(join(artifacts, 'bot-settings-narrow.png'), (await testWindow.capturePage()).toPNG());
    await testWindow.webContents.executeJavaScript("document.getElementById('bots-tab-activation').click()");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const narrowDays = await testWindow.webContents.executeJavaScript(`(() => {
      const selector = document.querySelector('.bot-activation-days .bot-settings-days');
      selector.scrollIntoView({ block: 'center' });
      const rect = selector.getBoundingClientRect();
      return selector.scrollWidth <= selector.clientWidth + 1
        && [...selector.querySelectorAll('button')].every((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.left >= rect.left - 1 && bounds.right <= rect.right + 1;
        });
    })()`);
    assert.ok(narrowDays, 'All seven weekdays must remain accessible without horizontal scrolling at narrow width');
    console.log('PASS Weekday choices wrap without horizontal scrolling at narrow width');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await writeFile(join(artifacts, 'bot-settings-days-narrow.png'), (await testWindow.capturePage()).toPNG());
    await writeFile(join(artifacts, 'results.json'), JSON.stringify({ results, narrow, narrowDays }, null, 2));
    console.log(`Bot Settings UI passed. Artifacts: ${artifacts}`);
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
