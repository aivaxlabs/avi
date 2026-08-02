import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const rendererUrl = 'http://127.0.0.1:5173';
const scriptArgs = process.argv.slice(2);
const openDevTools = scriptArgs.includes('--devtools');
const electronArgs = scriptArgs.filter((arg) => arg !== '--devtools');
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: rendererUrl,
  ...(openDevTools ? { CHAT_APP_OPEN_DEVTOOLS: '1' } : {}),
};
const processes = [];
const styles = Bun.spawn(['bun', 'run', 'styles:watch'], {
  cwd,
  env,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});
processes.push(styles);

const vite = Bun.spawn(['bun', 'x', 'vite'], {
  cwd,
  env,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});
processes.push(vite);

let stopping = false;
const stopChildren = () => {
  if (stopping) {
    return;
  }

  stopping = true;
  for (const child of processes) {
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(child.pid), '/t', '/f']);
    } else {
      child.kill();
    }
  }
};

process.once('SIGINT', stopChildren);
process.once('SIGTERM', stopChildren);

let result;

try {
  let rendererReady = false;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (vite.exitCode !== null) {
      throw new Error(`Vite exited before serving ${rendererUrl}.`);
    }

    try {
      rendererReady = (await fetch(rendererUrl)).ok;
    } catch {
      rendererReady = false;
    }

    if (rendererReady) {
      break;
    }

    await Bun.sleep(100);
  }

  if (!rendererReady) {
    throw new Error(`Vite did not start at ${rendererUrl}.`);
  }

  const app = Bun.spawn(['bun', 'x', 'electron', '.', ...electronArgs], {
    cwd,
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  processes.push(app);

  result = await Promise.race(processes.map(
    (child) => child.exited.then((exitCode) => ({ exitCode })),
  ));
} finally {
  stopChildren();
  await Promise.allSettled(processes.map((child) => child.exited));
}

process.exitCode = result?.exitCode ?? 1;
