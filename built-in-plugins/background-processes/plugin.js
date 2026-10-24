import { fork, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPERVISOR = fileURLToPath(new URL('./supervisor.mjs', import.meta.url));
const LOG_LIMIT = 10 * 1024;
const RETRY_DELAYS = { '2s': 2_000, '5s': 5_000, none: null };
const WINDOWS = process.platform === 'win32';

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const quote = (value) => /\s/.test(value) && !/^".*"$/.test(value) ? `"${value}"` : value;

export default ({ definePlugin }) => {
  let storage;
  let configs = [];
  const states = new Map();

  const stateOf = (id) => {
    if (!states.has(id)) {
      states.set(id, {
        status: 'stopped',
        pid: null,
        startedAt: null,
        exitCode: null,
        error: null,
        retryAt: null,
        retryTimer: null,
        child: null,
        stopping: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      });
    }
    return states.get(id);
  };

  const append = (state, stream, chunk) => {
    const data = Buffer.concat([state[stream], Buffer.from(chunk)]);
    state[stream] = data.length > LOG_LIMIT ? data.subarray(data.length - LOG_LIMIT) : data;
  };

  const save = () => storage.set('processes', configs);

  const findConfig = (id) => {
    const config = configs.find((entry) => entry.id === id);
    if (!config) throw new Error('Process not found.');
    return config;
  };

  const start = (config) => {
    const state = stateOf(config.id);
    if (!config.enabled || state.child) return;

    clearTimeout(state.retryTimer);
    Object.assign(state, { retryTimer: null, retryAt: null, error: null, exitCode: null, pid: null });

    const cwd = config.workingDirectory || homedir();
    if (!isDirectory(cwd)) {
      Object.assign(state, { status: 'exited', error: `Working directory not found: ${cwd}` });
      return;
    }

    const finish = (code, error) => {
      if (state.child !== child) return;
      Object.assign(state, { child: null, pid: null, exitCode: code, error });

      if (state.stopping) {
        state.status = config.enabled ? 'stopped' : 'disabled';
        return;
      }

      const delay = RETRY_DELAYS[config.retry];
      if (delay == null) {
        state.status = 'exited';
        return;
      }

      state.status = 'retrying';
      state.retryAt = Date.now() + delay;
      state.retryTimer = setTimeout(() => start(config), delay);
    };

    // On Windows the executable is a direct, attached child: libuv assigns it to Avi's
    // kill-on-close Job Object, so the kernel terminates it however Avi exits. A supervisor
    // cannot provide this, because it shares the Avi.exe image name and is killed with it.
    // Batch scripts can only run through cmd.exe, so only cmd.exe is in the job for them.
    // On macOS and Linux a supervisor watches the IPC channel and kills the process group.
    const batch = WINDOWS && /\.(cmd|bat)$/i.test(config.executable);
    const child = WINDOWS
      ? spawn(batch ? quote(config.executable) : config.executable, config.arguments ? [config.arguments] : [], {
        argv0: quote(config.executable),
        cwd,
        shell: batch,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
      : fork(SUPERVISOR, [JSON.stringify({
        command: [quote(config.executable), config.arguments].filter(Boolean).join(' '),
        cwd,
      })], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
    Object.assign(state, { child, stopping: null, status: 'running', startedAt: Date.now() });

    child.stdout.on('data', (chunk) => append(state, 'stdout', chunk));
    child.stderr.on('data', (chunk) => append(state, 'stderr', chunk));
    child.on('spawn', () => {
      if (WINDOWS) state.pid = child.pid;
    });
    child.on('message', (message) => {
      if (Number.isInteger(message?.pid)) state.pid = message.pid;
    });
    child.on('error', (error) => finish(null, error.message));
    child.on('exit', (code, signal) => finish(code, signal ? `Terminated by ${signal}.` : null));
  };

  const stop = (id) => {
    const state = stateOf(id);
    clearTimeout(state.retryTimer);
    Object.assign(state, { retryTimer: null, retryAt: null });

    const { child } = state;
    if (!child) {
      const config = configs.find((entry) => entry.id === id);
      state.status = config && !config.enabled ? 'disabled' : 'stopped';
      return Promise.resolve();
    }

    state.stopping ??= new Promise((resolve) => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      if (WINDOWS && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else if (child.connected) child.disconnect();
      else child.kill();
    });
    return state.stopping;
  };

  const normalize = (input) => {
    const executable = String(input?.executable ?? '').trim();
    const args = String(input?.arguments ?? '').trim();
    const workingDirectory = String(input?.workingDirectory ?? '').trim();

    if (!executable) throw new Error('Executable is required.');
    if (workingDirectory && (!isAbsolute(workingDirectory) || !isDirectory(workingDirectory))) {
      throw new Error('Working directory must be an existing absolute path.');
    }
    if (!Object.hasOwn(RETRY_DELAYS, String(input?.retry))) throw new Error('Retry must be 2s, 5s or none.');

    return { executable, arguments: args, workingDirectory, retry: input.retry, enabled: input.enabled !== false };
  };

  const snapshot = () => configs.map((config) => {
    const { status, pid, startedAt, exitCode, error, retryAt } = stateOf(config.id);
    return { ...config, status, pid, startedAt, exitCode, error, retryAt };
  });

  const actions = {
    list: () => snapshot(),

    async save(input) {
      const values = normalize(input);
      const existing = input?.id ? findConfig(input.id) : null;

      if (existing) {
        await stop(existing.id);
        Object.assign(existing, values);
      } else {
        configs.push({ id: randomUUID(), ...values });
      }

      await save();
      const config = existing ?? configs.at(-1);
      if (config.enabled) start(config);
      else stateOf(config.id).status = 'disabled';
      return snapshot();
    },

    async remove({ id }) {
      findConfig(id);
      await stop(id);
      configs = configs.filter((entry) => entry.id !== id);
      states.delete(id);
      await save();
      return snapshot();
    },

    async setEnabled({ id, enabled }) {
      const config = findConfig(id);
      config.enabled = enabled === true;
      await save();
      if (config.enabled) start(config);
      else await stop(id);
      return snapshot();
    },

    start({ id }) {
      start(findConfig(id));
      return snapshot();
    },

    async stop({ id }) {
      findConfig(id);
      await stop(id);
      return snapshot();
    },

    async restart({ id }) {
      const config = findConfig(id);
      await stop(id);
      start(config);
      return snapshot();
    },

    logs({ id }) {
      findConfig(id);
      const state = stateOf(id);
      return { stdout: state.stdout.toString('utf8'), stderr: state.stderr.toString('utf8') };
    },
  };

  return definePlugin({
    apiVersion: 2,
    id: 'background-processes',
    name: 'Background Processes',
    version: '1.0.0',
    description: 'Run executables in the background while Avi is open, with retries, controls and recent stdout/stderr logs.',
    capabilities: ['actionPages.register', 'storage'],
    async activate(avi) {
      storage = avi.storage;
      configs = (await storage.get('processes')) ?? [];

      avi.lifecycle.onDeactivate(() => Promise.all(configs.map((config) => stop(config.id))));
      avi.actionPages.register({
        id: 'processes',
        title: 'Background Processes',
        kind: 'html',
        icon: 'square-terminal',
        load: async () => ({ html: await readFile(new URL('./page.html', import.meta.url), 'utf8') }),
        invokeAction: (action, input) => {
          if (!Object.hasOwn(actions, action)) throw new Error(`Unknown action "${action}".`);
          return actions[action](input ?? {});
        },
      });

      for (const config of configs) {
        if (config.enabled) start(config);
        else stateOf(config.id).status = 'disabled';
      }
    },
  });
};
