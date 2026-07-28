import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile, readdir, stat } from 'node:fs/promises';
import { EOL } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const MAX_READ_URL_CHARS = 100_000;
const MAX_TERMINAL_OUTPUT_CHARS = 2_000_000;
const MAX_SEARCH_FILE_BYTES = 5_000_000;
const DEFAULT_SEARCH_RESULTS = 200;
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'out', 'release']);
const terminals = new Map();

async function resolveSearchScope(value, substringWhenPlain) {
  const query = String(value ?? '').trim();
  const defaultRoot = process.cwd();
  if (!query) {
    return { root: defaultRoot, pattern: '**/*', exactFile: null };
  }

  const resolved = resolve(query);
  try {
    const details = await stat(resolved);
    if (details.isDirectory()) {
      return { root: resolved, pattern: '**/*', exactFile: null };
    }
    if (details.isFile() && isAbsolute(query)) {
      return { root: defaultRoot, pattern: '', exactFile: resolved };
    }
  } catch {}

  const normalized = query.replaceAll('\\', '/');
  const wildcardIndex = normalized.search(/[*?[]/);
  if (isAbsolute(query) && wildcardIndex >= 0) {
    const separatorIndex = normalized.lastIndexOf('/', wildcardIndex);
    return {
      root: resolve(normalized.slice(0, separatorIndex)),
      pattern: normalized.slice(separatorIndex + 1),
      exactFile: null,
    };
  }

  const hasWildcard = wildcardIndex >= 0;
  return {
    root: defaultRoot,
    pattern: !hasWildcard && substringWhenPlain
      ? normalized.includes('/') ? `**/${normalized}*` : `**/*${normalized}*`
      : normalized,
    exactFile: null,
  };
}

async function collectFiles({ root, pattern, exactFile, includeIgnoredFiles, limit = Infinity }) {
  if (exactFile) return [exactFile];

  const normalizedPattern = String(pattern || '**/*').replaceAll('\\', '/');
  let expression = '^';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    if (char === '*' && normalizedPattern[index + 1] === '*') {
      const followedBySlash = normalizedPattern[index + 2] === '/';
      expression += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
    } else if (char === '*') {
      expression += '[^/]*';
    } else if (char === '?') {
      expression += '[^/]';
    } else {
      expression += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
    }
  }
  const matcher = new RegExp(`${expression}$`, 'i');

  if (!includeIgnoredFiles) {
    const gitFiles = await new Promise((resolveFiles) => {
      const child = spawn(
        'git',
        ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { shell: false, windowsHide: true },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      child.once('error', () => resolveFiles(null));
      child.once('close', (exitCode) => {
        resolveFiles(exitCode === 0 ? output.split('\0').filter(Boolean) : null);
      });
    });

    if (gitFiles) {
      const matchedFiles = [];
      for (const path of gitFiles) {
        const normalizedPath = path.replaceAll('\\', '/');
        if (!matcher.test(normalizedPath) && !matcher.test(normalizedPath.split('/').at(-1))) {
          continue;
        }
        const absolutePath = resolve(root, path);
        try {
          if ((await stat(absolutePath)).isFile()) {
            matchedFiles.push(absolutePath);
          }
        } catch {}
        if (matchedFiles.length >= limit) break;
      }
      return matchedFiles;
    }
  }

  const files = [];

  async function visit(directory) {
    if (files.length >= limit) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (includeIgnoredFiles || !ignoredDirectories.has(entry.name)) {
          await visit(path);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = path.slice(root.length).replace(/^[/\\]+/, '').replaceAll('\\', '/');
      if (matcher.test(relativePath) || matcher.test(entry.name)) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return files;
}

function appendTerminalOutput(terminal, chunk) {
  terminal.output += String(chunk);
  if (terminal.output.length > MAX_TERMINAL_OUTPUT_CHARS) {
    terminal.output = terminal.output.slice(-MAX_TERMINAL_OUTPUT_CHARS);
    terminal.truncated = true;
  }
  terminal.events.emit('activity');
}

function terminalSnapshot(terminal) {
  return {
    id: terminal.id,
    command: terminal.command,
    status: terminal.running ? 'running' : 'completed',
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    output: terminal.output,
    truncated: terminal.truncated,
  };
}

async function waitForTerminal(terminal, { untilExit, timeout }) {
  if (!terminal.running) return;

  await new Promise((resolveWait) => {
    let idleTimer;
    let timeoutTimer;

    const finish = () => {
      clearTimeout(idleTimer);
      clearTimeout(timeoutTimer);
      terminal.events.removeListener('activity', onActivity);
      terminal.events.removeListener('close', finish);
      resolveWait();
    };
    const onActivity = () => {
      if (untilExit) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, 300);
    };

    terminal.events.on('activity', onActivity);
    terminal.events.once('close', finish);
    if (!untilExit) {
      idleTimer = setTimeout(finish, 300);
    }
    if (timeout > 0) {
      timeoutTimer = setTimeout(finish, timeout);
    }
  });
}

export const CLIENT_TOOLS = Object.freeze([
  {
    name: 'read_url',
    description: 'Read a public HTTP or HTTPS URL as LLM-friendly Markdown using the Jina Reader API.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The public HTTP or HTTPS URL to read.',
        },
      },
      required: ['url'],
    },
    execute: async ({ url }, { signal }) => {
      let target;
      try {
        target = new URL(String(url));
      } catch {
        throw new Error('url must be a valid HTTP or HTTPS URL.');
      }
      if (!['http:', 'https:'].includes(target.protocol)) {
        throw new Error('url must use HTTP or HTTPS.');
      }

      const response = await fetch(`https://r.jina.ai/${target.href}`, {
        headers: { Accept: 'text/plain' },
        signal,
      });
      const content = await response.text();
      if (!response.ok) {
        throw new Error(content || `Jina Reader returned ${response.status} ${response.statusText}.`);
      }

      return {
        url: target.href,
        content: content.slice(0, MAX_READ_URL_CHARS),
        truncated: content.length > MAX_READ_URL_CHARS,
      };
    },
  },
  {
    name: 'run_in_terminal',
    description: 'Run a command in a local terminal.',
    canEditFile: true,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to run in the terminal.',
        },
        explanation: {
          type: 'string',
          description: 'A one-sentence description of what the command does. This will be shown to the user before the command is run.',
        },
        goal: {
          type: 'string',
          description: 'A short description of the goal or purpose of the command (e.g., "Install dependencies", "Start development server").',
        },
        mode: {
          type: 'string',
          enum: ['sync', 'async'],
          enumDescriptions: [
            'Wait for command completion and return full output inline. Strongly preferred for all one-shot commands (builds, tests, installs, scripts).',
            'Wait for an initial idle/output signal, then return a terminal ID and output snapshot while the process continues running. Timeout caps how long to wait for the initial signal. Use ONLY for processes that must keep running indefinitely (servers, watchers, daemons).',
          ],
          description: 'Execution mode for this command. Use sync (default) for nearly all commands.',
        },
        isBackground: {
          type: 'boolean',
          description: 'Legacy execution mode flag. Deprecated in favor of "mode". If true, equivalent to mode=async. If false, equivalent to mode=sync.',
        },
        timeout: {
          type: 'number',
          description: 'Optional. Usually omit entirely for sync commands - the tool waits for completion automatically. Only set a timeout (in milliseconds) as a safety net if you suspect the command might hang. If the timeout elapses, the command continues in the background and you get a terminal ID to check output later. Use 0 to explicitly indicate no timeout.',
        },
      },
      required: ['command', 'explanation', 'goal', 'mode'],
    },
    execute: async ({ command, mode, isBackground, timeout }, { signal, workspacePath }) => {
      const normalizedCommand = String(command ?? '').trim();
      if (!normalizedCommand) throw new Error('command is required.');

      const executionMode = isBackground === true ? 'async' : isBackground === false ? 'sync' : mode;
      if (!['sync', 'async'].includes(executionMode)) {
        throw new Error('mode must be sync or async.');
      }
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0)) {
        throw new Error('timeout must be a non-negative number.');
      }

      const id = crypto.randomUUID();
      const child = spawn(normalizedCommand, {
        cwd: workspacePath ? resolve(workspacePath) : process.cwd(),
        env: process.env,
        shell: true,
        windowsHide: true,
      });
      const terminal = {
        id,
        child,
        command: normalizedCommand,
        events: new EventEmitter(),
        output: '',
        truncated: false,
        running: true,
        exitCode: null,
        signal: null,
      };
      terminals.set(id, terminal);

      child.stdout.on('data', (chunk) => appendTerminalOutput(terminal, chunk));
      child.stderr.on('data', (chunk) => appendTerminalOutput(terminal, chunk));
      child.once('error', (error) => appendTerminalOutput(terminal, `${error.message}${EOL}`));
      child.once('close', (exitCode, exitSignal) => {
        terminal.running = false;
        terminal.exitCode = exitCode;
        terminal.signal = exitSignal;
        terminal.events.emit('close');
      });

      if (executionMode === 'sync') {
        const abort = () => child.kill();
        signal?.addEventListener('abort', abort, { once: true });
        await waitForTerminal(terminal, { untilExit: true, timeout: timeout ?? 0 });
        signal?.removeEventListener('abort', abort);
      } else {
        await waitForTerminal(terminal, { untilExit: false, timeout: timeout ?? 10_000 });
      }

      const snapshot = terminalSnapshot(terminal);
      return executionMode === 'sync' && !terminal.running
        ? { ...snapshot, id: undefined }
        : snapshot;
    },
  },
  {
    name: 'send_to_terminal',
    description: 'Send input followed by Enter to an active terminal execution.',
    canEditFile: true,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of an active terminal execution to send a command to (returned by run_in_terminal for async executions, or for sync executions that timed out and were moved to the background).',
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
        },
        command: {
          type: 'string',
          description: 'The input text to send to the terminal. The text is sent followed by Enter. Provide an empty or whitespace string to send just Enter (for interactive prompts).',
        },
        waitForOutput: {
          type: 'boolean',
          description: 'When true, waits for the terminal to become idle (no new output for a short period) before returning, instead of returning immediately. Use this for interactive programs where you need to see the full response to your input. Defaults to false.',
        },
      },
      required: ['id', 'command'],
    },
    execute: async ({ id, command, waitForOutput }) => {
      const terminal = terminals.get(String(id));
      if (!terminal) throw new Error('The terminal execution was not found.');
      if (!terminal.running || !terminal.child.stdin.writable) {
        throw new Error('The terminal execution is no longer active.');
      }

      terminal.child.stdin.write(`${String(command ?? '')}${EOL}`);
      if (waitForOutput) {
        await waitForTerminal(terminal, { untilExit: false, timeout: 10_000 });
      }
      return terminalSnapshot(terminal);
    },
  },
  {
    name: 'read_terminal_output',
    description: 'Read the current output and status of a terminal execution.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of an active terminal execution to check (returned by run_in_terminal for async executions, or for sync executions that timed out and were moved to the background). This must be the exact opaque UUID returned by that tool; terminal names, labels, or integers are invalid.',
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
        },
      },
      required: ['id'],
    },
    execute: async ({ id }) => {
      const terminal = terminals.get(String(id));
      if (!terminal) throw new Error('The terminal execution was not found.');
      return terminalSnapshot(terminal);
    },
  },
  {
    name: 'read_file',
    description: 'Read an inclusive range of lines from a local file.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The absolute path of the file to read.',
        },
        startLine: {
          type: 'number',
          description: 'The line number to start reading from, 1-based.',
        },
        endLine: {
          type: 'number',
          description: 'The inclusive line number to end reading at, 1-based.',
        },
      },
      required: ['filePath', 'startLine', 'endLine'],
    },
    execute: async ({ filePath, startLine, endLine }) => {
      if (!isAbsolute(String(filePath ?? ''))) throw new Error('filePath must be absolute.');
      if (!Number.isInteger(startLine) || startLine < 1) {
        throw new Error('startLine must be a positive integer.');
      }
      if (!Number.isInteger(endLine) || endLine < startLine) {
        throw new Error('endLine must be an integer greater than or equal to startLine.');
      }

      const content = await readFile(filePath, 'utf8');
      const lines = content.replaceAll('\r\n', '\n').split('\n');
      return {
        filePath,
        startLine,
        endLine: Math.min(endLine, lines.length),
        totalLines: lines.length,
        content: lines.slice(startLine - 1, endLine).join('\n'),
      };
    },
  },
  {
    name: 'file_search',
    description: 'Search for local files whose names or paths match a glob pattern.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search for files with names or paths matching this glob pattern. Can also be an absolute path to a workspace folder to scope the search in a multi-root workspace.',
        },
        maxResults: {
          type: 'number',
          description: 'The maximum number of results to return. Do not use this unless necessary, it can slow things down. By default, only some matches are returned. If you use this and do not see what you are looking for, try again with a more specific query or a larger maxResults.',
        },
      },
      required: ['query'],
    },
    execute: async ({ query, maxResults }) => {
      const limit = maxResults === undefined ? DEFAULT_SEARCH_RESULTS : Number(maxResults);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('maxResults must be a positive integer.');
      }

      const scope = await resolveSearchScope(query, true);
      const files = await collectFiles({ ...scope, includeIgnoredFiles: false, limit });
      return {
        query,
        results: files,
        truncated: files.length >= limit,
      };
    },
  },
  {
    name: 'grep_search',
    description: 'Search local text files for a case-insensitive plain-text or regular-expression pattern.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The pattern to search for in files in the workspace. Use regex with alternation (e.g., "word1|word2|word3") or character classes to find multiple potential words in a single search. Be sure to set isRegexp correctly. Search is case-insensitive.',
        },
        isRegexp: {
          type: 'boolean',
          description: 'Whether the pattern is a regular expression.',
        },
        includePattern: {
          type: 'string',
          description: 'Search files matching this glob pattern. To search recursively inside a folder, use a pattern like "src/folder/**". Can also be an absolute path to a workspace folder to scope the search in a multi-root workspace.',
        },
        maxResults: {
          type: 'number',
          description: 'The maximum number of results to return. Do not use this unless necessary, it can slow things down. By default, only some matches are returned.',
        },
        includeIgnoredFiles: {
          type: 'boolean',
          description: 'Whether to include files that would normally be ignored according to ignore settings. Warning: this may be slower for folders such as node_modules or build outputs.',
        },
      },
      required: ['query', 'isRegexp'],
    },
    execute: async ({ query, isRegexp, includePattern, maxResults, includeIgnoredFiles }) => {
      const limit = maxResults === undefined ? DEFAULT_SEARCH_RESULTS : Number(maxResults);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('maxResults must be a positive integer.');
      }

      let matcher;
      try {
        matcher = new RegExp(isRegexp ? String(query) : String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      } catch (error) {
        throw new Error(`query is not a valid regular expression: ${error.message}`);
      }

      const scope = await resolveSearchScope(includePattern || '**/*', false);
      const files = await collectFiles({
        ...scope,
        includeIgnoredFiles: Boolean(includeIgnoredFiles),
      });
      const matches = [];

      for (const filePath of files) {
        if (matches.length >= limit) break;

        let details;
        try {
          details = await stat(filePath);
        } catch {
          continue;
        }
        if (details.size > MAX_SEARCH_FILE_BYTES) continue;

        let content;
        try {
          content = await readFile(filePath, 'utf8');
        } catch {
          continue;
        }
        if (content.includes('\0')) continue;

        const lines = content.replaceAll('\r\n', '\n').split('\n');
        for (let index = 0; index < lines.length; index += 1) {
          if (!matcher.test(lines[index])) continue;
          matches.push({
            filePath,
            line: index + 1,
            text: lines[index],
          });
          if (matches.length >= limit) break;
        }
      }

      return {
        query,
        matches,
        truncated: matches.length >= limit,
      };
    },
  },
]);

export function interceptToolSchemas(tools) {
  return tools.map((tool) => {
    const canMutate = tool.canEditFile || tool.canPerformDestructiveActions;
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        ...tool.inputSchema,
        properties: {
          ...tool.inputSchema.properties,
          __requires_human_approval: {
            type: 'boolean',
            enum: [canMutate],
            description: canMutate
              ? 'This tool can edit files or perform destructive actions, so this value must be true.'
              : 'This read-only tool does not require human approval, so this value must be false.',
          },
          __invocation_goal: {
            type: 'string',
            description: 'A short description of the goal of this specific tool invocation.',
          },
        },
        required: [
          ...(tool.inputSchema.required ?? []),
          '__requires_human_approval',
          '__invocation_goal',
        ],
        additionalProperties: false,
      },
    };
  });
}
