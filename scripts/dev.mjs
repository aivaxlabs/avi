import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createRequire } from 'node:module';

const devtools = process.argv.includes('--devtools');
const electronPath = createRequire(import.meta.url)('electron');

const vite = spawn('bun', ['x', 'vite', '--host', '127.0.0.1', '--port', '5173'], {
  shell: true,
  stdio: 'inherit',
});

let electron;
let restartTimer;
let restarting = false;
let stopping = false;

const startElectron = () => {
  electron = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
      ...(devtools ? { CHAT_APP_OPEN_DEVTOOLS: '1' } : {}),
    },
  });
  electron.on('exit', () => {
    if (restarting && !stopping) {
      restarting = false;
      startElectron();
      return;
    }
    stop();
  });
};

const stop = () => {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  mainWatcher.close();
  vite.kill();
  electron?.kill();
};

const mainWatcher = watch(new URL('../src/main', import.meta.url), { recursive: true }, () => {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!electron || electron.killed || stopping) return;
    restarting = true;
    electron.kill();
  }, 150);
});

startElectron();
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
