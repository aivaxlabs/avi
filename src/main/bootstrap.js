import { app, ipcMain } from 'electron';
import { registerFatalErrorHandlers } from './fatal-errors.js';
import {
  rotateTraceLog,
  traceError,
  traceFatal,
} from './trace-log.js';

export function reportFatal(event, error, details = {}) {
  console.error(`${event}:`, error);
  traceFatal(event, {
    ...details,
    error: error instanceof Error ? (error.stack || error.message) : String(error),
  });
}

registerFatalErrorHandlers({ app, ipcMain, traceError, traceFatal });

rotateTraceLog()
  .then(() => {
    const skipSingleInstance = !app.isPackaged && process.argv.includes('--skip-single-instance');
    const hasSingleInstanceLock = skipSingleInstance || app.requestSingleInstanceLock();

    if (!hasSingleInstanceLock) {
      app.quit();
      return;
    }

    let runtime;
    let secondInstanceRequested = false;
    app.on('second-instance', () => {
      secondInstanceRequested = true;
      runtime?.showMainWindow();
    });
    app.whenReady()
      .then(async () => {
        runtime = await import('./runtime.js');
        if (secondInstanceRequested) runtime.showMainWindow();
      })
      .catch((error) => {
        reportFatal('app.failed-to-start', error, { operation: 'startup' });
        app.quit();
      });
  })
  .catch((error) => {
    reportFatal('app.failed-to-start', error, { operation: 'startup' });
    app.quit();
  });
