import { spawn } from 'node:child_process';

// macOS and Linux only. Runs between Avi and the managed process. Avi holds the IPC channel;
// when it closes, by a requested stop or because Avi died, the process group is terminated.
const { command, cwd } = JSON.parse(process.argv[2]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(command, { cwd, env, shell: true, stdio: 'inherit', detached: true });

let stopping = false;

const killGroup = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {}
};

child.on('spawn', () => process.send?.({ pid: child.pid }));

child.on('error', (error) => {
  process.stderr.write(`Could not start the process: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (stopping) killGroup('SIGKILL');
  process.exit(code ?? (signal ? 1 : 0));
});

process.on('disconnect', () => {
  stopping = true;
  if (!child.pid) process.exit(0);
  killGroup('SIGTERM');
  setTimeout(() => killGroup('SIGKILL'), 3_000).unref();
});
