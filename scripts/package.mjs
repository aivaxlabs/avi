import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--all') || args.some((arg) =>
  ['--win', '--mac', '--linux'].includes(arg) && arg !== { win32: '--win', darwin: '--mac', linux: '--linux' }[process.platform]
) || args.some((arg) => ['--x64', '--arm64', '--ia32'].includes(arg) && arg !== `--${process.arch}`)) {
  throw new Error('Computer Use includes native dependencies. Package on the target operating system and architecture.');
}
await import('./prepare-built-in-plugins.mjs');
const allIndex = args.indexOf('--all');
const buildTargets = allIndex === -1
  ? { win32: '--win', darwin: '--mac', linux: '--linux' }[process.platform]
  : '--win --mac --linux';

if (!buildTargets) {
  throw new Error(`Unsupported packaging platform: ${process.platform}`);
}

if (allIndex !== -1) {
  args.splice(allIndex, 1);
}

const stagingDirectory = await mkdtemp(join(tmpdir(), 'avi-electron-builder-'));
const outputDirectory = join(cwd, 'artifacts');
let exitCode = 1;
try {
  const child = Bun.spawn(
    [
      'bun',
      'x',
      'electron-builder',
      ...buildTargets.split(' '),
      `--config.directories.output=${stagingDirectory}`,
      ...args,
    ],
    {
      cwd,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  exitCode = await child.exited;
  if (exitCode === 0) {
    await mkdir(outputDirectory, { recursive: true });
    for (const entry of await readdir(stagingDirectory, { withFileTypes: true })) {
      if (entry.isFile()) {
        await copyFile(join(stagingDirectory, entry.name), join(outputDirectory, entry.name));
      }
    }
  }
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
