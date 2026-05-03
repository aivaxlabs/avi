import { spawn } from 'node:child_process';

const devtools = process.argv.includes('--devtools');

const vite = spawn('bun', ['x', 'vite', '--host', '127.0.0.1', '--port', '5173'], {
  shell: true,
  stdio: 'inherit',
});

const electron = spawn('bun', ['x', 'electron', '.'], {
  shell: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    ...(devtools ? { AIVAX_OPEN_DEVTOOLS: '1' } : {}),
  },
});

const stop = () => {
  vite.kill();
  electron.kill();
};

electron.on('exit', stop);
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
