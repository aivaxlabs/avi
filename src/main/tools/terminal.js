import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { EOL } from 'node:os';
import { resolve } from 'node:path';
import { resolveTerminalShell } from '../terminal-shell.js';

const MAX_TERMINAL_OUTPUT_CHARS = 2_000_000;

const MIN_TERMINAL_TIMEOUT_SECONDS = 1;

const MAX_TERMINAL_TIMEOUT_SECONDS = 300;

const DEFAULT_TERMINAL_TIMEOUT_SECONDS = 30;

export const TERMINAL_INPUT_IDLE_MS = 1_500;

const ANSI_ESCAPE_SEQUENCE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export const terminals = new Map();

function appendTerminalOutput(terminal, chunk) {
  terminal.output = `${terminal.output}${String(chunk)}`.replace(ANSI_ESCAPE_SEQUENCE, '');
  if (terminal.output.length > MAX_TERMINAL_OUTPUT_CHARS) {
    terminal.output = terminal.output.slice(-MAX_TERMINAL_OUTPUT_CHARS);
    terminal.truncated = true;
  }
  terminal.lastActivityAt = Date.now();
  terminal.events.emit('activity');
}

export function terminalStatus(terminal) {
  if (terminal.running) return 'running';
  if (terminal.stopping) return 'stopped';
  return terminal.exitCode === 0 ? 'completed' : 'failed';
}

function terminalSnapshot(terminal, { includeId = true } = {}) {
  const parts = [];
  if (includeId) parts.push(`Terminal ID: ${terminal.id}`);
  const status = terminalStatus(terminal);
  if (status === 'running') {
    parts.push('Status: running');
  } else if (status === 'stopped') {
    parts.push('Status: stopped');
  } else if (status === 'failed') {
    parts.push(`Exit code: ${terminal.exitCode}${terminal.signal ? ` (signal: ${terminal.signal})` : ''}`);
  }
  if (terminal.output) parts.push(terminal.output);
  if (terminal.truncated) parts.push('[output truncated]');
  return parts.join('\n');
}

function stopTerminal(terminal) {
  if (!terminal.running || terminal.stopping) return;
  terminal.stopping = true;
  if (process.platform === 'win32' && terminal.child.pid) {
    spawn('taskkill', ['/PID', String(terminal.child.pid), '/T', '/F'], {
      windowsHide: true,
    }).unref();
    return;
  }
  terminal.child.kill();
}

export function stopConversationTerminals(conversationId) {
  for (const terminal of terminals.values()) {
    if (terminal.conversationId === conversationId) stopTerminal(terminal);
  }
}

async function waitForTerminal(terminal, { untilExit, timeout }) {
  if (!terminal.running) return 'completed';

  return new Promise((resolveWait) => {
    let idleTimer;
    let timeoutTimer;

    const finish = (reason) => {
      clearTimeout(idleTimer);
      clearTimeout(timeoutTimer);
      terminal.events.removeListener('activity', onActivity);
      terminal.events.removeListener('close', onClose);
      resolveWait(reason);
    };
    const onClose = () => finish('completed');
    const onActivity = () => {
      if (untilExit) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish('idle'), 300);
    };

    terminal.events.on('activity', onActivity);
    terminal.events.once('close', onClose);
    if (!untilExit) {
      idleTimer = setTimeout(() => finish('idle'), 300);
    }
    timeoutTimer = setTimeout(() => finish('timeout'), timeout);
  });
}

export const terminalTools = [
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
          minimum: MIN_TERMINAL_TIMEOUT_SECONDS,
          maximum: MAX_TERMINAL_TIMEOUT_SECONDS,
          default: DEFAULT_TERMINAL_TIMEOUT_SECONDS,
          description: 'Maximum time to wait, in seconds. Defaults to 30 seconds and accepts values from 1 to 300. If the timeout elapses, the command keeps running and the response includes its terminal ID and partial output.',
        },
      },
      required: ['command', 'explanation', 'goal', 'mode'],
    },
    execute: async (
      { command, mode, isBackground, timeout },
      {
        signal,
        workspacePath,
        conversationId,
        tuning,
      },
    ) => {
      const normalizedCommand = String(command ?? '').trim();
      if (!normalizedCommand) throw new Error('command is required.');

      const executionMode = isBackground === true ? 'async' : isBackground === false ? 'sync' : mode;
      if (!['sync', 'async'].includes(executionMode)) {
        throw new Error('mode must be sync or async.');
      }
      const timeoutSeconds = timeout
        ?? tuning?.terminalTimeoutSeconds
        ?? DEFAULT_TERMINAL_TIMEOUT_SECONDS;
      if (
        !Number.isFinite(timeoutSeconds)
        || timeoutSeconds < MIN_TERMINAL_TIMEOUT_SECONDS
        || timeoutSeconds > MAX_TERMINAL_TIMEOUT_SECONDS
      ) {
        throw new Error('timeout must be a number from 1 to 300 seconds.');
      }

      const id = crypto.randomUUID();
      const shell = resolveTerminalShell(
        process.env,
        process.platform,
        tuning?.terminalShell,
      );
      const child = spawn(shell.executable, [...shell.commandArguments, normalizedCommand], {
        cwd: workspacePath ? resolve(workspacePath) : process.cwd(),
        env: process.env,
        shell: false,
        windowsHide: true,
      });
      const terminal = {
        id,
        child,
        command: normalizedCommand,
        shell,
        events: new EventEmitter(),
        output: '',
        truncated: false,
        lastActivityAt: Date.now(),
        running: true,
        exitCode: null,
        signal: null,
        conversationId,
        stopping: false,
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

      let waitResult;
      if (executionMode === 'sync') {
        const abort = () => stopTerminal(terminal);
        signal?.addEventListener('abort', abort, { once: true });
        waitResult = await waitForTerminal(terminal, {
          untilExit: true,
          timeout: timeoutSeconds * 1_000,
        });
        signal?.removeEventListener('abort', abort);
      } else {
        waitResult = await waitForTerminal(terminal, {
          untilExit: false,
          timeout: timeoutSeconds * 1_000,
        });
      }

      if (waitResult === 'timeout' && terminal.running) {
        return `The command reached the ${timeoutSeconds}-second timeout and is still running. Use terminal ID "${terminal.id}" to read its partial output or interact with it.\n${terminalSnapshot(terminal)}`;
      }
      return terminalSnapshot(terminal, { includeId: executionMode === 'async' || terminal.running });
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
];
