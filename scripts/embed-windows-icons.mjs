import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

// Electrobun 1.18.1 resolves rcedit from its build-machine path in the compiled
// Windows CLI. Remove this hook when Electrobun resolves rcedit from the app's
// dependency tree and can embed icons without warnings.

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildDir = process.env.ELECTROBUN_BUILD_DIR
  ? resolve(process.env.ELECTROBUN_BUILD_DIR)
  : null;
const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR
  ? resolve(process.env.ELECTROBUN_ARTIFACT_DIR)
  : null;
const iconPath = join(projectRoot, 'assets', 'icon', 'avi.ico');
const rceditPath = join(projectRoot, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
const appName = process.env.ELECTROBUN_APP_NAME;
const appVersion = process.env.ELECTROBUN_APP_VERSION;

const embedAppIdentity = (targetPath) => {
  execFileSync(rceditPath, [
    targetPath,
    '--set-icon',
    iconPath,
    '--set-version-string',
    'CompanyName',
    'AIVAX Labs',
    '--set-version-string',
    'FileDescription',
    appName,
    '--set-version-string',
    'ProductName',
    appName,
    '--set-version-string',
    'ProductVersion',
    appVersion,
  ], {
    stdio: 'inherit',
    windowsHide: true,
  });
};

if (process.env.ELECTROBUN_OS === 'win') {
  if (
    !buildDir
    || !artifactDir
    || !appName
    || !appVersion
    || !existsSync(iconPath)
    || !existsSync(rceditPath)
  ) {
    throw new Error('Windows build paths, icon assets, or rcedit are unavailable.');
  }

  const setupFiles = existsSync(buildDir)
    ? readdirSync(buildDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('-Setup.exe'))
      .map((entry) => join(buildDir, entry.name))
    : [];

  if (setupFiles.length === 0) {
    const pendingDirectories = [buildDir];
    const executableTargets = [];

    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop();
      if (!directory || !existsSync(directory)) continue;

      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
        } else if (
          ['bun', 'bun.exe', 'launcher', 'launcher.exe'].includes(entry.name.toLowerCase())
        ) {
          executableTargets.push(entryPath);
        }
      }
    }

    for (const targetPath of executableTargets) embedAppIdentity(targetPath);
    console.log(`Embedded the Avi identity into ${executableTargets.length} application executable(s).`);
  } else {
    for (const setupPath of setupFiles) embedAppIdentity(setupPath);

    const releaseZip = existsSync(artifactDir)
      ? readdirSync(artifactDir)
        .map((name) => join(artifactDir, name))
        .find((path) => basename(path).endsWith(`-${appName}-Setup.zip`))
      : null;

    if (!releaseZip) throw new Error('The packaged Windows installer archive was not found.');

    const setupPath = setupFiles[0];
    const setupStem = setupPath.slice(0, -4);
    const metadataPath = `${setupStem}.metadata.json`;
    const archivePath = `${setupStem}.tar.zst`;
    const tempRoot = resolve(tmpdir());
    const stagingDir = mkdtempSync(join(tempRoot, 'avi-installer-icon-'));

    try {
      const installerDir = join(stagingDir, '.installer');
      mkdirSync(installerDir, { recursive: true });
      cpSync(setupPath, join(stagingDir, basename(setupPath)));
      cpSync(metadataPath, join(installerDir, basename(metadataPath)));
      cpSync(archivePath, join(installerDir, basename(archivePath)));
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Compress-Archive -Path (Join-Path $env:AVI_ICON_STAGE "*") -DestinationPath $env:AVI_ICON_ZIP -Force',
        ],
        {
          env: {
            ...process.env,
            AVI_ICON_STAGE: stagingDir,
            AVI_ICON_ZIP: releaseZip,
          },
          stdio: 'inherit',
          windowsHide: true,
        },
      );
    } finally {
      const resolvedStagingDir = resolve(stagingDir);
      if (
        dirname(resolvedStagingDir) !== tempRoot
        || !basename(resolvedStagingDir).startsWith('avi-installer-icon-')
      ) {
        throw new Error('Refusing to remove an unexpected installer staging directory.');
      }
      rmSync(resolvedStagingDir, { recursive: true, force: true });
    }

    console.log(`Embedded the Avi icon into ${setupFiles.length} installer executable(s).`);
  }
}
