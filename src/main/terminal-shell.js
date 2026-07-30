import { existsSync } from 'node:fs';
import {
  delimiter,
  isAbsolute,
  join,
} from 'node:path';

export function listInstalledTerminalShells(
  environment = process.env,
  platform = process.platform,
) {
  const configuredShell = String(environment.SHELL ?? '').trim();
  const searchDirectories = String(environment.PATH ?? environment.Path ?? '')
    .split(platform === 'win32' ? ';' : delimiter)
    .map((directory) => directory.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const shells = [];

  const addShell = (id, label, commandArguments, candidates) => {
    const executable = candidates
      .filter(Boolean)
      .find((candidate) => existsSync(candidate));
    if (
      !executable
      || shells.some((shell) => shell.executable.toLowerCase() === executable.toLowerCase())
    ) {
      return;
    }
    shells.push({
      id,
      label,
      executable,
      commandArguments,
    });
  };

  if (platform === 'win32') {
    const windowsDirectory = String(
      environment.SystemRoot ?? environment.WINDIR ?? 'C:\\Windows',
    ).trim();
    const programFiles = String(environment.ProgramFiles ?? 'C:\\Program Files').trim();
    const localAppData = String(environment.LOCALAPPDATA ?? '').trim();
    const pathCandidates = (executableName) => (
      searchDirectories.map((directory) => join(directory, executableName))
    );

    addShell('cmd', 'Command Prompt', ['/d', '/s', '/c'], [
      String(environment.ComSpec ?? environment.COMSPEC ?? '').trim(),
      join(windowsDirectory, 'System32', 'cmd.exe'),
      ...pathCandidates('cmd.exe'),
    ]);
    addShell('powershell', 'Windows PowerShell', ['-NoLogo', '-NoProfile', '-Command'], [
      join(windowsDirectory, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ...pathCandidates('powershell.exe'),
    ]);
    addShell('pwsh', 'PowerShell 7', ['-NoLogo', '-NoProfile', '-Command'], [
      join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      ...pathCandidates('pwsh.exe'),
    ]);
    addShell('git-bash', 'Git Bash', ['-c'], [
      isAbsolute(configuredShell) && !configuredShell.startsWith('/')
        && /(?:^|[/\\])bash(?:\.exe)?$/i.test(configuredShell)
        ? configuredShell
        : null,
      environment.EXEPATH ? join(environment.EXEPATH, 'bin', 'bash.exe') : null,
      join(programFiles, 'Git', 'bin', 'bash.exe'),
      localAppData ? join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : null,
      ...searchDirectories
        .filter((directory) => /(?:^|[/\\])git(?:[/\\]|$)/i.test(directory))
        .flatMap((directory) => [
          join(directory, 'bash.exe'),
          /[/\\]cmd$/i.test(directory)
            ? join(directory, '..', 'bin', 'bash.exe')
            : null,
        ]),
    ]);
    return shells;
  }

  const unixCandidates = [
    {
      id: configuredShell
        ? configuredShell.replaceAll('\\', '/').split('/').at(-1).toLowerCase()
        : 'shell',
      label: configuredShell
        ? configuredShell.replaceAll('\\', '/').split('/').at(-1)
        : 'System shell',
      candidates: [configuredShell],
    },
    { id: 'zsh', label: 'Z shell', candidates: ['/bin/zsh', '/usr/bin/zsh'] },
    { id: 'bash', label: 'Bash', candidates: ['/bin/bash', '/usr/bin/bash'] },
    { id: 'fish', label: 'fish', candidates: ['/bin/fish', '/usr/bin/fish'] },
    { id: 'sh', label: 'POSIX shell', candidates: ['/bin/sh', '/usr/bin/sh'] },
  ];
  for (const shell of unixCandidates) {
    addShell(shell.id, shell.label, ['-c'], [
      ...shell.candidates,
      ...searchDirectories.map((directory) => join(directory, shell.id)),
    ]);
  }
  return shells;
}

export function resolveTerminalShell(
  environment = process.env,
  platform = process.platform,
  requestedShell = 'auto',
) {
  const shells = listInstalledTerminalShells(environment, platform);
  let shell;

  if (requestedShell !== 'auto') {
    shell = shells.find(({ id }) => id === requestedShell);
    if (!shell) {
      throw new Error(
        `The selected terminal shell "${requestedShell}" is not installed. Choose another shell in Settings > Tuning.`,
      );
    }
  } else if (platform === 'win32') {
    const configuredShell = String(environment.SHELL ?? '').trim();
    shell = Boolean(environment.MSYSTEM) && /(?:^|[/\\])bash(?:\.exe)?$/i.test(configuredShell)
      ? shells.find(({ id }) => id === 'git-bash')
      : shells.find(({ id }) => id === 'cmd');
    shell ??= shells[0];
  } else {
    const configuredShell = String(environment.SHELL ?? '').trim();
    shell = shells.find(({ executable }) => executable === configuredShell) ?? shells.at(-1);
  }

  if (!shell) {
    throw new Error('No supported terminal shell is installed on this system.');
  }
  return {
    executable: shell.executable,
    commandArguments: shell.commandArguments,
    label: shell.label,
  };
}
