import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

for (const id of ['chrome-integration', 'computer-use']) {
  const cwd = fileURLToPath(new URL(`../built-in-plugins/${id}/`, import.meta.url));
  const child = Bun.spawn(['bun', 'install', '--frozen-lockfile', '--production'], {
    cwd, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
  });
  if (await child.exited !== 0) throw new Error(`Could not prepare built-in plugin ${id}.`);
  await access(`${cwd}/.avi-plugin.json`);
  await access(`${cwd}/plugin.js`);
  // Upstream runs node-pre-gyp on every OS, but only Windows loads its addon.
  if (id === 'computer-use' && process.platform === 'win32') {
    const nativeInstall = Bun.spawn(['bun', 'run', 'install'], {
      cwd: `${cwd}/node_modules/get-windows`, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    });
    if (await nativeInstall.exited !== 0) throw new Error('Could not prepare the Windows window-enumeration addon.');
    await access(`${cwd}/node_modules/get-windows/lib/binding/napi-9-win32-unknown-${process.arch}/node-get-windows.node`);
  }
}
console.log(`Built-in plugins prepared for ${process.platform}/${process.arch}. Package on the target platform and architecture.`);
