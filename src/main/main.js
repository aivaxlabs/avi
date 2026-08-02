import { app } from 'electron';

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
      runtime = await import('./runtime.js');
      if (secondInstanceRequested) runtime.showMainWindow();
    })
    .catch((error) => {
      console.error('Avi failed to start.', error);
      app.quit();
    });
}
