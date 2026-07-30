import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  listContextItems,
  resolveDynamicContext,
} from '../src/main/context-injection.js';
import {
  listInstalledTerminalShells,
  resolveTerminalShell,
} from '../src/main/terminal-shell.js';

const root = await mkdtemp(path.join(tmpdir(), 'context-variants-'));

try {
  await Promise.all([
    'AGENTS.md',
    'AGENTS.foobar.md',
    'AGENTS.outracoisa.md',
    'AGENTS.user.md',
    'MEMORY.md',
    'MEMORY.algumacoisa.md',
    'AGENT.invalid.md',
    'NOTES.md',
  ].map((name) => writeFile(path.join(root, name), `# ${name}`)));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'MEMORY.child.md'), '# Nested memory');

  const context = await listContextItems(root);
  const names = context.groups
    .find((group) => group.id === 'instruction')
    .items
    .map((item) => path.basename(item.path))
    .sort();
  const expectedNames = [
    'AGENTS.foobar.md',
    'AGENTS.md',
    'AGENTS.outracoisa.md',
    'AGENTS.user.md',
    'MEMORY.algumacoisa.md',
    'MEMORY.md',
  ].sort();

  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`Unexpected context editor items: ${JSON.stringify(names)}`);
  }

  const injected = await resolveDynamicContext({ workspacePath: root });
  const terminalShell = resolveTerminalShell();
  if (
    !injected.includes('--- BEGIN AGENTS.foobar.md ---')
    || !injected.includes('nested/MEMORY.child.md')
    || injected.includes('--- BEGIN AGENT.invalid.md ---')
    || injected.includes('--- BEGIN NOTES.md ---')
    || !injected.includes(`Command execution shell: ${terminalShell.label}`)
  ) {
    throw new Error('Context variants did not follow the expected root and nested rules.');
  }

  await mkdir(path.join(root, 'git', 'bin'), { recursive: true });
  await writeFile(path.join(root, 'git', 'bin', 'bash.exe'), '');
  await mkdir(path.join(root, 'windows', 'System32'), { recursive: true });
  await writeFile(path.join(root, 'windows', 'System32', 'cmd.exe'), '');
  const windowsEnvironment = {
    SHELL: '/usr/bin/bash',
    MSYSTEM: 'MINGW64',
    EXEPATH: path.join(root, 'git'),
    SystemRoot: path.join(root, 'windows'),
    ComSpec: path.join(root, 'windows', 'System32', 'cmd.exe'),
  };
  assert.deepEqual(
    resolveTerminalShell(windowsEnvironment, 'win32'),
    {
      executable: path.join(root, 'git', 'bin', 'bash.exe'),
      commandArguments: ['-c'],
      label: 'Git Bash',
    },
  );
  assert.deepEqual(
    resolveTerminalShell({
      SystemRoot: path.join(root, 'windows'),
      ComSpec: path.join(root, 'windows', 'System32', 'cmd.exe'),
    }, 'win32'),
    {
      executable: path.join(root, 'windows', 'System32', 'cmd.exe'),
      commandArguments: ['/d', '/s', '/c'],
      label: 'Command Prompt',
    },
  );
  assert.deepEqual(
    resolveTerminalShell(windowsEnvironment, 'win32', 'cmd'),
    {
      executable: path.join(root, 'windows', 'System32', 'cmd.exe'),
      commandArguments: ['/d', '/s', '/c'],
      label: 'Command Prompt',
    },
  );
  assert.deepEqual(
    listInstalledTerminalShells(windowsEnvironment, 'win32').map(({ id }) => id),
    ['cmd', 'git-bash'],
  );
  assert.throws(
    () => resolveTerminalShell(windowsEnvironment, 'win32', 'pwsh'),
    /is not installed/,
  );

  const planContext = await resolveDynamicContext({
    workspacePath: root,
    workMode: 'plan',
  });
  for (const requirement of [
    '<work_mode mode="plan">',
    'Do not edit files',
    'No permission level overrides these restrictions',
    'exactly one non-empty <execution-plan>...</execution-plan> block',
    'affected files',
    'public contracts',
    'validations',
    'success criteria',
  ]) {
    if (!planContext.includes(requirement)) {
      throw new Error(`Plan context is missing: ${requirement}`);
    }
  }
  if (injected.includes('<work_mode mode="plan">')) {
    throw new Error('Plan context was injected outside Plan mode.');
  }

  const longSubagentPrompt = 'x'.repeat(300);
  const subagentContext = await resolveDynamicContext({
    workspacePath: root,
    subagents: [
      {
        threadId: 'thread-running',
        initialPrompt: longSubagentPrompt,
        status: 'in_progress',
      },
      {
        threadId: 'thread-completed',
        initialPrompt: 'Completed task',
        status: 'completed',
      },
      {
        threadId: 'thread-failed',
        initialPrompt: 'Failed task',
        status: 'failed',
      },
    ],
  });
  assert.ok(subagentContext.includes(
    '<subagent thread_id="thread-running" status="in_progress">',
  ));
  assert.ok(subagentContext.includes(
    `<initial_prompt>${longSubagentPrompt.slice(0, 256)}</initial_prompt>`,
  ));
  assert.ok(!subagentContext.includes(longSubagentPrompt));
  assert.ok(subagentContext.includes(
    '<subagent thread_id="thread-completed" status="completed">',
  ));
  assert.ok(subagentContext.includes(
    '<subagent thread_id="thread-failed" status="failed">',
  ));

  console.log('Context variant discovery passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
