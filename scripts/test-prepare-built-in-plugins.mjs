import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(new URL('./prepare-built-in-plugins.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../built-in-plugins/computer-use/package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../built-in-plugins/computer-use/bun.lock', import.meta.url), 'utf8').replace(/,\s*([}\]])/g, '$1'));
assert.equal(manifest.dependencies['get-windows'], '9.3.0');
assert.equal(manifest.trustedDependencies.includes('get-windows'), false);
assert.deepEqual(new Set(lock.trustedDependencies), new Set(manifest.trustedDependencies));

const run = new Function('Bun', 'process', 'access', 'fileURLToPath', 'baseUrl', 'console', `return (async () => {
${source.replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', 'baseUrl')}
})()`);

for (const platform of ['win32', 'darwin', 'linux']) {
  for (const arch of ['x64', 'arm64']) {
    for (const failure of [null, 'dependencies', 'addon', 'binding', 'overlay']) {
      const calls = [];
      const checked = [];
      const execution = run({
        spawn: (args, options) => {
          calls.push({ args, cwd: options.cwd });
          const stage = args[1] === 'install' ? 'dependencies' : args[1] === 'run' ? 'addon' : 'overlay';
          return { exited: Promise.resolve(stage === failure ? 1 : 0) };
        },
      }, { platform, arch }, async (path) => {
        checked.push(path);
        if (failure === 'binding' && path.endsWith('.node')) throw new Error('Missing binding');
      }, fileURLToPath, import.meta.url, { log: () => {} });
      const shouldFail = failure && (platform === 'win32' || !['addon', 'binding'].includes(failure));
      if (shouldFail) {
        await assert.rejects(execution);
        continue;
      }
      await execution;
      assert.equal(calls.filter(({ args }) => args[1] === 'install').length, 2);
      assert.equal(calls.filter(({ args }) => args[1] === 'run').length, platform === 'win32' ? 1 : 0);
      assert.equal(checked.some((path) => path.endsWith(`napi-9-win32-unknown-${arch}/node-get-windows.node`)), platform === 'win32');
      const executable = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
      assert.ok(checked.some((path) => path.endsWith(`/electron/dist/${executable}`)));
    }
  }
}
console.log('Built-in plugin preparation platform and failure tests passed.');
