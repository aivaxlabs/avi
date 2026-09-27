import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { app, BrowserWindow } from 'electron';

let win;
const timeout = setTimeout(() => app.exit(2), 30000);
app.whenReady().then(async () => {
  try {
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const source = await readFile(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
    assert.match(source, /className="orchestration-container">\s*<OrchestrationPage/);
    win = new BrowserWindow({ show: false, width: 1300, height: 800 });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
      <html data-theme="code" data-color-scheme="dark"><style>${css}</style>
      <body><div class="chat-workspace" style="width:1200px;height:700px">
        <div class="orchestration-container"><main class="orchestration-page">
          <header class="orchestration-header"><h1>Inbox</h1><button>Refresh</button></header>
          <div class="orchestration-inbox"><button class="orchestration-inbox-row">
            <span class="orchestration-inbox-sender">Bot</span>
            <span class="orchestration-inbox-copy"><strong>Subject</strong><span>Message preview</span></span><time>12:00</time>
          </button></div>
          <div class="token-overview"><div class="token-overview-total">Total</div>
            <div class="token-overview-metrics"><div>One</div><div>Two</div><div>Three</div><div>Four</div></div>
          </div>
        </main></div><div id="resizer" hidden></div><aside hidden>Side panel</aside>
      </div></body></html>`));
    assert.equal(await win.webContents.executeJavaScript(`(async () => {
      const page = document.querySelector('.orchestration-page');
      const row = document.querySelector('.orchestration-inbox-row');
      const workspace = document.querySelector('.chat-workspace');
      const widePadding = parseFloat(getComputedStyle(page).paddingLeft);
      if(getComputedStyle(row).flexWrap !== 'nowrap') throw new Error('Wide row condensed prematurely');
      workspace.classList.add('with-auxiliary-panel');
      workspace.style.setProperty('--auxiliary-panel-width', '55%');
      document.querySelector('aside').hidden = false;
      document.querySelector('#resizer').hidden = false;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      if(innerWidth <= 900) throw new Error('Must test a wide viewport');
      if(page.getBoundingClientRect().width > 620) throw new Error('Fixture failed to narrow page');
      if(getComputedStyle(page).paddingLeft !== '10px' || widePadding <= 10) throw new Error('Page padding did not condense: ' + JSON.stringify({ widePadding, padding: getComputedStyle(page).paddingLeft, width: page.getBoundingClientRect().width, container: getComputedStyle(page.parentElement).container, viewport: innerWidth }));
      if(getComputedStyle(row).flexWrap !== 'wrap') throw new Error('Inbox row did not wrap');
      if(getComputedStyle(document.querySelector('.token-overview-metrics')).gridTemplateColumns.split(' ').length !== 2) throw new Error('Metrics did not condense');
      if(page.scrollWidth > page.clientWidth) throw new Error('Page overflow');
      workspace.classList.remove('with-auxiliary-panel');
      document.querySelector('aside').hidden = true;
      document.querySelector('#resizer').hidden = true;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      if(parseFloat(getComputedStyle(page).paddingLeft) !== widePadding) throw new Error('Wide spacing not restored');
      return true;
    })()`), true);
    console.log('Orchestration container responds to side panel opening/closing without viewport resize.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    win?.destroy();
    app.exit(process.exitCode || 0);
  }
});
