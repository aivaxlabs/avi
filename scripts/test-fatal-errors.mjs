import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { registerFatalErrorHandlers } from '../src/main/fatal-errors.js';

const rendererErrorMarker = 'fatal-renderer-window-marker';
const rendererRejectionMarker = 'fatal-renderer-rejection-marker';
const timeout = setTimeout(() => app.exit(1), 10_000);
const fatalEvents = [];
const errorEvents = [];
let window;

const traceFatal = (event, details) => fatalEvents.push({ event, details });
const traceError = (event, details) => errorEvents.push({ event, details });

const fakeApp = new EventEmitter();
const fakeIpc = new EventEmitter();
registerFatalErrorHandlers({ app: fakeApp, ipcMain: fakeIpc, traceError, traceFatal });
const contents = new EventEmitter();
contents.toggleDevTools = () => {};
fakeApp.emit('web-contents-created', {}, contents);
contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1 });
contents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 0 });
fakeIpc.emit('avi:renderer-fatal', {}, {
  type: 'window-error',
  operation: 'window.error',
  error: 'renderer failed',
});
assert.deepEqual(fatalEvents.map(({ event }) => event), [
  'renderer.process-gone',
  'renderer.uncaught-error',
]);
assert.deepEqual(errorEvents.map(({ event }) => event), ['renderer.process-gone']);
fatalEvents.length = 0;
errorEvents.length = 0;

registerFatalErrorHandlers({ app, ipcMain, traceError, traceFatal });
app.whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(process.cwd(), 'src', 'preload', 'preload.cjs'),
        sandbox: true,
      },
    });
    await window.loadURL(`data:text/html,${encodeURIComponent(`
      <!doctype html>
      <script>
        window.addEventListener('error', (event) => {
          window.chatApp.diagnostics.reportWindowError(
            event.error?.stack ?? event.error?.message ?? event.message,
          );
        });
        window.addEventListener('unhandledrejection', (event) => {
          window.chatApp.diagnostics.reportWindowRejection(
            event.reason?.stack ?? event.reason?.message ?? String(event.reason),
          );
        });
        setTimeout(() => { throw new Error('${rendererErrorMarker}'); }, 0);
        setTimeout(() => { Promise.reject(new Error('${rendererRejectionMarker}')); }, 20);
      </script>
    `)}`);

    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline
      && !fatalEvents.some(({ details }) => details.error.includes(rendererErrorMarker))
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    while (
      Date.now() < deadline
      && !fatalEvents.some(({ details }) => details.error.includes(rendererRejectionMarker))
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }

    assert.ok(fatalEvents.some(({ event, details }) => (
      event === 'renderer.uncaught-error' && details.error.includes(rendererErrorMarker)
    )));
    assert.ok(fatalEvents.some(({ event, details }) => (
      event === 'renderer.unhandled-rejection' && details.error.includes(rendererRejectionMarker)
    )));
    console.log('Fatal renderer error tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(timeout);
    window?.destroy();
    ipcMain.removeAllListeners('avi:renderer-fatal');
    app.exit(process.exitCode ?? 0);
  });
