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
  if (id === 'computer-use') {
    // Upstream runs node-pre-gyp on every OS, but only Windows loads its addon.
    if (process.platform === 'win32') {
      const nativeInstall = Bun.spawn(['bun', 'run', 'install'], {
        cwd: `${cwd}/node_modules/get-windows`, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
      });
      if (await nativeInstall.exited !== 0) throw new Error('Could not prepare the Windows window-enumeration addon.');
      await access(`${cwd}/node_modules/get-windows/lib/binding/napi-9-win32-unknown-${process.arch}/node-get-windows.node`);
    }
    const install = Bun.spawn(['bun', 'node_modules/electron/install.js'], { cwd, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
    if (await install.exited !== 0) throw new Error('Could not prepare the Computer Use overlay executable.');
    const executable = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
    await access(`${cwd}/node_modules/electron/dist/${executable}`);
  }
}
console.log(`Built-in plugins prepared for ${process.platform}/${process.arch}. Package on the target platform and architecture.`);
