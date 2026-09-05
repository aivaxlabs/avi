import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppUpdater } from '../src/main/app-updater.js';

const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const root = join(tmpdir(), '.avi', 'visualizations', timestamp, 'updater-tests');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'run-'));
const bytes = Buffer.from('installer test payload');
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
let assertions = 0;
try {
  for (const [platform, arch, name] of [
    ['win32', 'x64', 'Avi-windows-x64.exe'], ['win32', 'arm64', 'Avi-windows-arm64.exe'],
    ['darwin', 'x64', 'Avi-macos-x64.dmg'], ['darwin', 'arm64', 'Avi-0.7.0-mac-arm64.dmg'],
    ['linux', 'x64', 'Avi-linux-x86_64.AppImage'], ['linux', 'arm64', 'Avi-linux-arm64.AppImage'],
    ['win32', 'x64', 'Avi-0.7.0-win-x64.exe'], ['linux', 'x64', 'Avi-0.7.0-linux-x86_64.AppImage'],
  ]) {
    const release = { tag_name: 'v0.7.0', assets: [{ name, size: bytes.length, digest,
      browser_download_url: `https://github.com/aivaxlabs/avi/releases/download/v0.7.0/${name}` }] };
    let mode = 'success';
    let quits = 0;
    let requests = 0;
    const spawned = [];
    const target = join(directory, platform === 'darwin' ? 'Avi.app' : 'Avi.AppImage');
    if (platform === 'darwin') {
      await mkdir(join(target, 'Contents', 'Resources'), { recursive: true });
      await writeFile(join(target, 'Contents', 'Resources', 'app.asar'), 'old app');
    } else if (platform === 'linux') await writeFile(target, 'old app');
    const options = {
      app: { isPackaged: true, getVersion: () => '0.6.0', getPath: () => directory,
        getAppPath: () => join(target, 'Contents', 'Resources', 'app.asar') },
      platform, arch, env: { ...process.env, APPIMAGE: target },
      onChange: () => {}, requestQuit: () => { quits += 1; },
      fetchImpl: async (url) => {
        requests += 1;
        if (url.includes('api.github.com')) return mode === 'http' ? new Response(null, { status: 429 }) : Response.json(release);
        if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.example/installer' } });
        return new Response(mode === 'truncated' ? bytes.subarray(1) : mode === 'corrupt' ? Buffer.alloc(bytes.length) : bytes);
      },
      spawnImpl: (command, args, config) => {
        spawned.push({ command, args, config });
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit(mode === 'spawn-error' ? 'error' : 'spawn', new Error('Test spawn error')));
        return child;
      },
    };
    const updater = new AppUpdater(options);
    const check = updater.check();
    assert.equal(check, updater.check());
    assert.equal((await check).status, 'available');
    assert.equal(requests, 1);
    if (platform === 'win32') {
      for (const failure of ['truncated', 'corrupt', 'redirect', 'spawn-error']) {
        mode = failure;
        assert.equal((await updater.install()).status, 'error');
        assert.equal(quits, 0);
      }
      mode = 'success';
      const install = updater.install();
      assert.equal(install, updater.install());
      assert.equal((await install).status, 'installing');
      assert.equal(quits, 1);
      assert.ok(spawned.at(-1).args.includes('-Command'));
      assert.ok(spawned.at(-1).args.at(-1).includes('--force-run'));
      await updater.install();
      assert.equal(quits, 1);
    }
    if (platform !== 'win32') {
      assert.equal((await updater.install()).status, 'installing');
      assert.equal(quits, 1);
      assert.equal(spawned[0].command, '/bin/sh');
      assert.equal(spawned[0].args[3], target);
      const helper = await readFile(spawned[0].args[0], 'utf8');
      assert.ok(helper.includes('kill -0'));
      const syntax = spawnSync('bash', ['-n'], { input: helper, encoding: 'utf8' });
      assert.equal(syntax.status, 0, syntax.stderr);
    }
    release.tag_name = 'v0.5.0';
    const older = new AppUpdater(options);
    assert.equal((await older.check()).available, false);
    release.tag_name = 'v0.7.0';
    release.assets = [];
    assert.equal((await older.check()).status, 'error');
    mode = 'http';
    assert.match((await older.check()).error, /429/);
    const unsupported = new AppUpdater({ ...options, app: { ...options.app, isPackaged: false } });
    assert.equal((await unsupported.check()).supported, false);
    assertions += 1;
  }
  console.log(`Updater tests passed: ${assertions} platform/filename fixtures, download failures, integrity, dispatch and concurrency.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
