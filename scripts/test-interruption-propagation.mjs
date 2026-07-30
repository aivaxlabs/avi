import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-interruption-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;
const composerSource = readFileSync(
  new URL('../src/renderer/components/Composer.jsx', import.meta.url),
  'utf8',
);
assert.match(
  composerSource,
  /onClick=\{\(\) => onStop\(\)\}\s+aria-label="Stop"/,
);

let database;
let stopTerminalOwner;
let stopTerminals;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const clientTools = await import('../src/main/client-tools.js');
  const { resolveTerminalShell } = await import('../src/main/terminal-shell.js');
  stopTerminals = clientTools.stopConversationTerminals;
  const {
    closeDatabase,
    createConversation,
    forkConversation,
    getMessages,
  } = database;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };

  function buildRunner(provider, stoppedBackgroundTasks = []) {
    return new ChatRunner({
      registry: {
        resolve: () => ({ model, provider }),
        listModels: () => [model],
      },
      mcpManager: null,
      sendEvent: () => {},
      stopBackgroundTasks: (conversationId) => stoppedBackgroundTasks.push(conversationId),
    });
  }

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  let finishInference;
  const inferenceCalls = [];
  const inferenceProvider = {
    getContributions: () => ({ tools: [] }),
    stream: ({ signal }) => {
      inferenceCalls.push(signal);
      if (inferenceCalls.length > 1) {
        return Promise.resolve({ assistantContent: 'Steered response', toolCalls: [] });
      }
      return new Promise((resolveStream) => {
        finishInference = () => resolveStream({
          assistantContent: 'Original response',
          toolCalls: [],
        });
      });
    },
  };
  const inferenceRunner = buildRunner(inferenceProvider);
  const inferenceConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await inferenceRunner.send({
    conversationId: inferenceConversation.id,
    model: model.id,
    text: 'Original prompt',
  });
  await waitFor(() => inferenceCalls.length === 1);
  await inferenceRunner.send({
    conversationId: inferenceConversation.id,
    model: model.id,
    text: 'Steer prompt',
    steer: true,
  });
  assert.equal(inferenceCalls[0].aborted, false);
  finishInference();
  await waitFor(() => !inferenceRunner.runs.has(inferenceConversation.id));
  assert.equal(inferenceCalls[0].reason, 'steer');
  assert.deepEqual(
    getMessages(inferenceConversation.id)
      .filter((message) => message.role === 'assistant')
      .map((message) => message.status),
    ['aborted', 'completed'],
  );

  let finishTool;
  let toolSignal;
  let toolCallCount = 0;
  const toolProvider = {
    getContributions: () => ({
      tools: [{
        name: 'wait_for_test_tool',
        description: 'Wait for a controlled test result.',
        inputSchema: { type: 'object', properties: {} },
        execute: (_input, { signal }) => {
          toolSignal = signal;
          return new Promise((resolveTool) => {
            finishTool = () => resolveTool({ completed: true });
          });
        },
      }],
    }),
    stream: () => {
      toolCallCount += 1;
      return Promise.resolve(toolCallCount === 1
        ? {
            assistantContent: '',
            toolCalls: [{
              callId: 'tool-call-1',
              key: 'tool-call-1',
              name: 'wait_for_test_tool',
              argumentsText: JSON.stringify({
                __invocation_goal: 'Exercise the cooperative tool boundary.',
                __requires_human_approval: false,
              }),
            }],
          }
        : { assistantContent: 'Steered after tool', toolCalls: [] });
    },
  };
  const toolRunner = buildRunner(toolProvider);
  const toolConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await toolRunner.send({
    conversationId: toolConversation.id,
    model: model.id,
    text: 'Run the tool',
  });
  await waitFor(() => Boolean(finishTool));
  await toolRunner.send({
    conversationId: toolConversation.id,
    model: model.id,
    text: 'Steer after the tool',
    steer: true,
  });
  assert.equal(toolSignal.aborted, false);
  finishTool();
  await waitFor(() => !toolRunner.runs.has(toolConversation.id));
  assert.equal(toolSignal.reason, 'steer');
  assert.deepEqual(
    getMessages(toolConversation.id)
      .filter((message) => message.role === 'assistant')
      .map((message) => message.status),
    ['aborted', 'completed'],
  );

  const fullStopSignals = [];
  const fullStopProvider = {
    getContributions: () => ({ tools: [] }),
    stream: ({ signal }) => new Promise((_resolveStream, rejectStream) => {
      fullStopSignals.push(signal);
      signal.addEventListener('abort', () => rejectStream(new Error('Stopped')), { once: true });
    }),
  };
  const stoppedBackgroundTasks = [];
  const fullStopRunner = buildRunner(fullStopProvider, stoppedBackgroundTasks);
  const parent = createConversation({ model: model.id, projectPath: process.cwd() });
  const subagent = forkConversation(parent.id, { subagent: true }).conversation;
  await fullStopRunner.send({
    conversationId: parent.id,
    model: model.id,
    text: 'Parent work',
  });
  await fullStopRunner.send({
    conversationId: subagent.id,
    model: model.id,
    text: 'Sub-agent work',
  });
  await waitFor(() => fullStopSignals.length === 2);
  fullStopRunner.stop(parent.id, { includeSubagents: true });
  assert.equal(fullStopSignals.every((signal) => signal.aborted), true);
  assert.deepEqual(new Set(stoppedBackgroundTasks), new Set([parent.id, subagent.id]));
  await waitFor(() => fullStopRunner.runs.size === 0);

  const runInTerminal = clientTools.CLIENT_TOOLS.find((tool) => tool.name === 'run_in_terminal');
  const readTerminalOutput = clientTools.CLIENT_TOOLS.find(
    (tool) => tool.name === 'read_terminal_output',
  );
  const writeFileTool = clientTools.CLIENT_TOOLS.find((tool) => tool.name === 'write_file');
  const writtenFile = join(testProfile, 'written-by-tool.md');
  const writtenContent = '# Native write\n\nUTF-8: configuração\nCódigo: `$value` & "texto"!\n';
  const writeResult = await writeFileTool.execute({
    filePath: writtenFile,
    content: writtenContent,
  });
  assert.equal(readFileSync(writtenFile, 'utf8'), writtenContent);
  assert.equal(writeResult.bytesWritten, Buffer.byteLength(writtenContent, 'utf8'));
  await assert.rejects(
    writeFileTool.execute({ filePath: 'relative.md', content: '' }),
    /filePath must be absolute/,
  );

  const terminalShell = resolveTerminalShell();
  const failedTerminal = await runInTerminal.execute(
    {
      command: terminalShell.label === 'cmd.exe' ? 'exit /b 7' : 'exit 7',
      explanation: 'Run a command with a controlled non-zero exit.',
      goal: 'Verify failed terminal status.',
      mode: 'sync',
      timeout: 5,
    },
    {
      signal: new AbortController().signal,
      workspacePath: process.cwd(),
      conversationId: 'failed-terminal-owner',
    },
  );
  assert.equal(failedTerminal.status, 'failed');
  assert.equal(failedTerminal.exitCode, 7, JSON.stringify(failedTerminal));
  assert.equal(failedTerminal.shell, terminalShell.label);

  if (process.platform === 'win32') {
    const originalShell = process.env.SHELL;
    const originalMsystem = process.env.MSYSTEM;
    process.env.SHELL = '/usr/bin/bash';
    process.env.MSYSTEM = 'MINGW64';
    try {
      const gitBashShell = resolveTerminalShell();
      if (gitBashShell.label === 'Git Bash') {
        const gitBashTerminal = await runInTerminal.execute(
          {
            command: 'printf git-bash-ok',
            explanation: 'Run a command using the resolved Git Bash executable.',
            goal: 'Verify Git Bash command execution.',
            mode: 'sync',
            timeout: 5,
          },
          {
            signal: new AbortController().signal,
            workspacePath: process.cwd(),
            conversationId: 'git-bash-terminal-owner',
          },
        );
        assert.equal(gitBashTerminal.status, 'completed');
        assert.equal(gitBashTerminal.shell, 'Git Bash');
        assert.equal(gitBashTerminal.output, 'git-bash-ok');
      }
    } finally {
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
      if (originalMsystem === undefined) delete process.env.MSYSTEM;
      else process.env.MSYSTEM = originalMsystem;
    }
  }

  const terminalCommand = ['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh']
    .includes(terminalShell.label.toLowerCase())
    ? 'Start-Sleep -Seconds 300'
    : terminalShell.label === 'cmd.exe'
      ? 'ping -t 127.0.0.1 >NUL'
      : 'sleep 300';
  const awaitedController = new AbortController();
  const awaitedTerminal = runInTerminal.execute(
    {
      command: terminalCommand,
      explanation: 'Run a controlled long-lived command.',
      goal: 'Verify direct stop while awaiting command output.',
      mode: 'sync',
      timeout: 5,
    },
    {
      signal: awaitedController.signal,
      workspacePath: process.cwd(),
      conversationId: 'awaited-terminal-owner',
    },
  );
  setTimeout(() => awaitedController.abort('stop'), 100);
  assert.equal((await awaitedTerminal).status, 'stopped');

  stopTerminalOwner = 'background-terminal-owner';
  const backgroundTerminal = await runInTerminal.execute(
    {
      command: terminalCommand,
      explanation: 'Run a controlled background command.',
      goal: 'Verify total stop propagation to background processes.',
      mode: 'async',
      timeout: 1,
    },
    {
      signal: new AbortController().signal,
      workspacePath: process.cwd(),
      conversationId: stopTerminalOwner,
    },
  );
  assert.equal(backgroundTerminal.status, 'running');
  stopTerminals(stopTerminalOwner);
  const terminalDeadline = Date.now() + 5_000;
  let stoppedTerminal = backgroundTerminal;
  while (stoppedTerminal.status === 'running' && Date.now() < terminalDeadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    stoppedTerminal = await readTerminalOutput.execute({ id: backgroundTerminal.id });
  }
  assert.equal(stoppedTerminal.status, 'stopped');

  closeDatabase();
  database = null;
  console.log('Interruption propagation tests passed.');
} finally {
  if (stopTerminalOwner && stopTerminals) stopTerminals(stopTerminalOwner);
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
