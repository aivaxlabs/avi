const fatalProcessReasons = new Set([
  'abnormal-exit',
  'crashed',
  'integrity-failure',
  'launch-failed',
  'oom',
]);
const rendererFatalEvents = Object.freeze({
  'preload-uncaught-exception': 'renderer.preload-uncaught-exception',
  'preload-unhandled-rejection': 'renderer.preload-unhandled-rejection',
  'react-uncaught-error': 'renderer.react-uncaught-error',
  'window-error': 'renderer.uncaught-error',
  'window-unhandled-rejection': 'renderer.unhandled-rejection',
});

export function registerFatalErrorHandlers({ app, ipcMain, traceError, traceFatal }) {
  ipcMain.on('avi:renderer-fatal', (_event, payload) => {
    traceFatal(rendererFatalEvents[payload?.type] ?? 'renderer.uncaught-error', {
      operation: typeof payload?.operation === 'string' ? payload.operation : 'renderer',
      error: typeof payload?.error === 'string' ? payload.error : 'Unknown renderer error.',
    });
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', (_goneEvent, details) => {
      const writeProcessGone = fatalProcessReasons.has(details.reason) ? traceFatal : traceError;
      writeProcessGone('renderer.process-gone', {
        status: details.reason,
        code: details.exitCode,
      });
    });
    contents.on('preload-error', (_preloadEvent, _preloadPath, error) => {
      traceFatal('renderer.preload-error', {
        operation: 'preload',
        error: error instanceof Error ? (error.stack || error.message) : String(error),
      });
    });
    contents.on('unresponsive', () => traceError('renderer.unresponsive'));
    contents.on('did-fail-load', (_loadEvent, code, description) => {
      traceError('renderer.load-failed', { code, error: description });
    });
    if (process.env.CHAT_APP_OPEN_DEVTOOLS === '1') {
      contents.on('before-input-event', (_inputEvent, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') contents.toggleDevTools();
      });
    }
  });

  app.on('child-process-gone', (_event, details) => {
    const writeProcessGone = fatalProcessReasons.has(details.reason) ? traceFatal : traceError;
    writeProcessGone('app.child-process-gone', {
      operation: details.type,
      status: details.reason,
      code: details.exitCode,
    });
  });
}
