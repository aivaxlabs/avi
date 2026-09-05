import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, open, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import semver from 'semver';

const repository = 'https://github.com/aivaxlabs/avi';
const downloadHosts = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const maximumDownloadSize = 2 * 1024 ** 3;
const windowsHelper = `$ParentId = [int]$env:AVI_UPDATE_PARENT
$Installer = $env:AVI_UPDATE_INSTALLER
$LogPath = $env:AVI_UPDATE_LOG
$ErrorActionPreference = 'Stop'
try {
  $parent = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
  if ($parent -and !$parent.WaitForExit(120000)) { throw 'Avi did not finish shutting down.' }
  $process = Start-Process -FilePath $Installer -ArgumentList '/S','--force-run','--updated' -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)." }
  Remove-Item -LiteralPath $Installer
} catch {
  $_ | Out-File -LiteralPath $LogPath -Append
  exit 1
}
`;
const unixHelper = `#!/bin/sh
set -eu
old_pid="$1"
source="$2"
target="$3"
platform="$4"
work="$5"
exec >>"$work/debug.log" 2>&1
count=0
while kill -0 "$old_pid" 2>/dev/null; do
  count=$((count + 1))
  if [ "$count" -ge 120 ]; then echo 'Avi did not finish shutting down.'; exit 1; fi
  sleep 1
done
suffix="$(basename "$work")"
backup="$target.$suffix-backup"
staging="$target.$suffix-new"
mounted=false
replaced=false
cleanup() {
  result=$?
  trap - EXIT
  if [ "$mounted" = true ]; then hdiutil detach "$work/mount" || true; fi
  if [ "$result" -ne 0 ]; then
    echo "Update failed with exit code $result."
    if [ "$replaced" = true ] && [ -e "$backup" ]; then
      rm -rf "$target"
      mv "$backup" "$target"
    fi
  else
    rm -rf "$backup"
    rm -f "$source"
  fi
  rm -rf "$staging"
  exit "$result"
}
trap cleanup EXIT
[ ! -e "$backup" ] && [ ! -e "$staging" ]
if [ "$platform" = darwin ]; then
  mkdir "$work/mount"
  hdiutil attach "$source" -nobrowse -readonly -mountpoint "$work/mount"
  mounted=true
  set -- "$work/mount/"*.app
  [ "$#" = 1 ] && [ -d "$1/Contents/MacOS" ]
  ditto "$1" "$staging"
  hdiutil detach "$work/mount"
  mounted=false
else
  cp "$source" "$staging"
  chmod 755 "$staging"
fi
mv "$target" "$backup"
replaced=true
mv "$staging" "$target"
if [ "$platform" = darwin ]; then
  open "$target"
else
  unset APPIMAGE APPDIR OWD
  "$target" >/dev/null 2>&1 &
fi
`;

export class AppUpdater {
  constructor({ app, onChange, requestQuit, fetchImpl = globalThis.fetch, spawnImpl = spawn,
    platform = process.platform, arch = process.arch, env = process.env }) {
    this.app = app;
    this.onChange = onChange;
    this.requestQuit = requestQuit;
    this.fetch = fetchImpl;
    this.spawn = spawnImpl;
    this.platform = platform;
    this.arch = arch;
    this.env = env;
    this.checkPromise = null;
    this.installPromise = null;
    this.asset = null;
    const unsupportedReason = !app.isPackaged ? 'Updates are available in installed Avi builds only.'
      : !['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)
        ? 'In-app updates are not supported on this platform or architecture.'
        : platform === 'linux' && !env.APPIMAGE ? 'Linux updates require running Avi as an AppImage.'
          : null;
    this.state = {
      status: 'idle', currentVersion: app.getVersion(), latestVersion: null,
      available: false, supported: !unsupportedReason, unsupportedReason,
      progress: null, error: null, releaseUrl: null,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  publish(changes) {
    Object.assign(this.state, changes);
    try { this.onChange(this.snapshot()); } catch {}
    return this.snapshot();
  }

  check() {
    if (!this.state.supported || this.installPromise || this.state.status === 'installing') {
      return Promise.resolve(this.snapshot());
    }
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = (async () => {
      this.publish({ status: 'checking', error: null });
      try {
        const response = await this.fetch('https://api.github.com/repos/aivaxlabs/avi/releases/latest', {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Avi/${this.state.currentVersion}` },
          signal: AbortSignal.timeout(15_000), redirect: 'error',
        });
        if (response.status === 404) {
          this.asset = null;
          return this.publish({ status: 'idle', available: false, latestVersion: null, releaseUrl: null });
        }
        if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}).`);
        const release = await response.json();
        const version = semver.valid(release.tag_name);
        if (!version || release.draft || release.prerelease || semver.prerelease(version)) {
          throw new Error('GitHub did not return a valid stable release version.');
        }
        const currentVersion = semver.valid(this.state.currentVersion);
        if (!currentVersion) throw new Error('The installed Avi version is not a valid semantic version.');
        const releaseUrl = `${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`;
        this.asset = null;
        this.publish({ latestVersion: version, releaseUrl, available: false });
        if (!semver.gt(version, currentVersion)) return this.publish({ status: 'idle' });
        const os = { win32: ['windows', 'win', 'exe'], darwin: ['macos', 'mac', 'dmg'], linux: ['linux', 'linux', 'AppImage'] }[this.platform];
        const architectures = this.platform === 'linux' && this.arch === 'x64' ? ['x64', 'x86_64'] : [this.arch];
        const names = architectures.flatMap((arch) => [
          `Avi-${os[0]}-${arch}.${os[2]}`,
          `Avi-${version}-${os[1]}-${arch}.${os[2]}`,
        ]);
        const asset = names.map((name) => release.assets?.find((entry) => entry.name === name)).find(Boolean);
        if (!asset) throw new Error(`Release ${version} has no installer for ${this.platform}/${this.arch}.`);
        const url = new URL(asset.browser_download_url);
        if (url.origin !== 'https://github.com' || url.username || url.password
          || url.pathname !== `/aivaxlabs/avi/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`
          || url.search || url.hash) throw new Error('The release installer URL is not trusted.');
        if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maximumDownloadSize) {
          throw new Error('The release installer size is invalid.');
        }
        if (asset.digest && !/^sha256:[a-f\d]{64}$/i.test(asset.digest)) throw new Error('The release installer digest is invalid.');
        this.asset = { name: asset.name, url: url.href, size: asset.size, digest: asset.digest ?? null };
        return this.publish({ status: 'available', available: true });
      } catch (error) {
        return this.publish({ status: 'error', error: error.message });
      }
    })().finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  install() {
    if (!this.state.supported || this.state.status === 'installing') return Promise.resolve(this.snapshot());
    if (this.installPromise) return this.installPromise;
    this.installPromise = (async () => {
      let directory;
      let handedOff = false;
      try {
        if (this.checkPromise) await this.checkPromise;
        const asset = this.asset;
        if (!asset || !this.state.available) throw new Error('No update is available to install.');
        let target = null;
        if (this.platform === 'darwin') {
          const appPath = await realpath(this.app.getAppPath());
          target = resolve(appPath, '../../..');
          if (!target.endsWith('.app') || appPath !== join(target, 'Contents', 'Resources', 'app.asar')
            || target.startsWith('/Volumes/')) throw new Error('Move Avi to a writable Applications folder before updating.');
        } else if (this.platform === 'linux') {
          if (!isAbsolute(this.env.APPIMAGE)) throw new Error('The running AppImage path is invalid.');
          target = await realpath(this.env.APPIMAGE);
          if (!(await stat(target)).isFile()) throw new Error('The running AppImage is not a file.');
        }
        if (target) {
          await access(target, constants.W_OK);
          await access(dirname(target), constants.W_OK);
        }
        const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
        const root = join(this.app.getPath('temp'), '.avi', 'visualizations', timestamp);
        await mkdir(root, { recursive: true });
        directory = await mkdtemp(join(root, 'app-update-'));
        const installer = join(directory, asset.name);
        this.publish({ status: 'downloading', progress: 0, error: null });
        const controller = new AbortController();
        let timer = setTimeout(() => controller.abort(new Error('Update download timed out.')), 30_000);
        let file;
        try {
          let url = asset.url;
          let response;
          for (let hop = 0; hop <= 5; hop += 1) {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' || !downloadHosts.has(parsed.hostname)
              || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
              throw new Error('The installer download redirected to an untrusted URL.');
            }
            response = await this.fetch(url, { redirect: 'manual', signal: controller.signal });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            await response.body?.cancel();
            const location = response.headers.get('location');
            if (!location || hop === 5) throw new Error('The installer download has too many or invalid redirects.');
            url = new URL(location, url).href;
          }
          if (!response.ok || !response.body) throw new Error(`Installer download failed (HTTP ${response.status}).`);
          const length = response.headers.get('content-length');
          if (length !== null && Number(length) !== asset.size) throw new Error('Installer download size does not match the release.');
          file = await open(installer, 'wx', 0o600);
          const hash = createHash('sha256');
          let received = 0;
          for await (const chunk of response.body) {
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(new Error('Update download stalled.')), 30_000);
            received += chunk.length;
            if (received > asset.size) throw new Error('Installer download exceeds the release size.');
            hash.update(chunk);
            await file.writeFile(chunk);
            const progress = Math.floor(received / asset.size * 100);
            if (progress !== this.state.progress) this.publish({ progress });
          }
          if (received !== asset.size) throw new Error('Installer download is incomplete.');
          const digest = `sha256:${hash.digest('hex')}`;
          if (asset.digest && digest !== asset.digest.toLowerCase()) throw new Error('Installer SHA-256 verification failed.');
        } finally {
          clearTimeout(timer);
          controller.abort();
          await file?.close();
        }
        let command;
        let args;
        if (this.platform === 'win32') {
          command = join(this.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
          args = ['-NoProfile', '-NonInteractive', '-Command', windowsHelper];
        } else {
          const helper = join(directory, 'install.sh');
          await writeFile(helper, unixHelper, { flag: 'wx', mode: 0o700 });
          command = '/bin/sh';
          args = [helper, String(process.pid), installer, target, this.platform, directory];
        }
        await new Promise((resolveSpawn, rejectSpawn) => {
          const child = this.spawn(command, args, {
            detached: true, stdio: 'ignore', windowsHide: true,
            env: { ...this.env, AVI_UPDATE_PARENT: String(process.pid), AVI_UPDATE_INSTALLER: installer, AVI_UPDATE_LOG: join(directory, 'debug.log') },
          });
          child.once('error', rejectSpawn);
          child.once('spawn', () => { child.unref(); resolveSpawn(); });
        });
        handedOff = true;
        this.publish({ status: 'installing', progress: null });
        this.requestQuit();
        return this.snapshot();
      } catch (error) {
        return this.publish({ status: 'error', progress: null, error: error.message });
      } finally {
        if (directory && !handedOff) await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    })().finally(() => { this.installPromise = null; });
    return this.installPromise;
  }
}
