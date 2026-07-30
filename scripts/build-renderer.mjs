import { fileURLToPath } from 'node:url';

const child = Bun.spawn(['bun', 'run', 'renderer:build'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exitCode = await child.exited;
