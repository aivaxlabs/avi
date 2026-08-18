import { app } from 'electron';
import { rotateTraceLog, traceError } from './trace-log.js';

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  traceError('app.uncaught-exception', {
    error: error instanceof Error ? (error.stack || error.message) : String(error),
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  traceError('app.unhandled-rejection', {
    error: reason instanceof Error ? (reason.stack || reason.message) : String(reason),
  });
});

const skipSingleInstance = !app.isPackaged && process.argv.includes('--skip-single-instance');
const hasSingleInstanceLock = skipSingleInstance || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  let runtime;
  let secondInstanceRequested = false;
  app.on('second-instance', () => {
    secondInstanceRequested = true;
    runtime?.showMainWindow();
  });
  app.whenReady()
    .then(async () => {
      await rotateTraceLog();
      runtime = await import('./runtime.js');
      if (secondInstanceRequested) runtime.showMainWindow();
    })
    .catch((error) => {
      console.error('Avi failed to start.', error);
      traceError('app.failed-to-start', {
        operation: 'startup',
        error: error instanceof Error ? (error.stack || error.message) : String(error),
      });
      app.quit();
    });
}

