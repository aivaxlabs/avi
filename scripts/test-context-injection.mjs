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
import baseInstructions from '../src/prompts/base-instructions.md' with { type: 'text' };
import candidPersonality from '../src/prompts/personality/candid.md' with { type: 'text' };
import cynicalPersonality from '../src/prompts/personality/cynical.md' with { type: 'text' };
import friendlyPersonality from '../src/prompts/personality/friendly.md' with { type: 'text' };
import pragmaticPersonality from '../src/prompts/personality/pragmatic.md' with { type: 'text' };
import quirkyPersonality from '../src/prompts/personality/quirky.md' with { type: 'text' };

const root = await mkdtemp(path.join(tmpdir(), 'context-variants-'));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

try {
  const testHome = path.join(root, 'home');
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
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

  await mkdir(path.join(testHome, '.agents', 'skills', 'global-skill'), { recursive: true });
  await mkdir(path.join(testHome, '.agents', 'workflows'), { recursive: true });
  await mkdir(path.join(root, 'skills', 'workspace-skill'), { recursive: true });
  await mkdir(path.join(root, 'workflows'), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(testHome, '.agents', 'AGENTS.md'),
      '# Global test instructions',
    ),
    writeFile(
      path.join(testHome, '.agents', 'skills', 'global-skill', 'SKILL.md'),
      '# Global test skill',
    ),
    writeFile(
      path.join(testHome, '.agents', 'workflows', 'global-workflow.md'),
      '# Global test workflow',
    ),
    writeFile(
      path.join(root, 'skills', 'workspace-skill', 'SKILL.md'),
      '# Workspace test skill',
    ),
    writeFile(
      path.join(root, 'workflows', 'workspace-workflow.md'),
      '# Workspace test workflow',
    ),
  ]);

  const injected = await resolveDynamicContext({
    workspacePath: root,
    mcpInstructions: [{
      from: 'ordering-test',
      text: 'MCP ordering test instructions',
    }],
  });
  const terminalShell = resolveTerminalShell();
  if (
    !injected.startsWith(baseInstructions.trim())
    || injected.split(baseInstructions.trim()).length !== 2
    || injected.includes(candidPersonality.trim())
    || injected.includes(cynicalPersonality.trim())
    || injected.includes(friendlyPersonality.trim())
    || injected.includes(pragmaticPersonality.trim())
    || injected.includes(quirkyPersonality.trim())
    || !injected.includes('<global_instructions>')
    || !injected.includes('# Global test instructions')
    || !injected.includes('<workspace_instructions>')
    || !injected.includes('--- BEGIN AGENTS.foobar.md ---')
    || !injected.includes('nested/MEMORY.child.md')
    || !injected.includes('Global test skill')
    || !injected.includes('Workspace test workflow')
    || !injected.includes('MCP ordering test instructions')
    || injected.includes('--- BEGIN AGENT.invalid.md ---')
    || injected.includes('--- BEGIN NOTES.md ---')
    || !injected.includes(`Command execution shell: ${terminalShell.label}`)
    || !injected.includes('#file:./path:12-52')
    || !injected.includes('#file:<./path with spaces.js>:12')
    || !injected.includes('Do not wrap the reference in backticks')
  ) {
    throw new Error('Context variants did not follow the expected root and nested rules.');
  }

  const orderedContext = await resolveDynamicContext({
    workspacePath: root,
    tuning: { personality: 'friendly' },
    mcpInstructions: [{
      from: 'ordering-test',
      text: 'MCP ordering test instructions',
    }],
  });
  const orderedMarkers = [
    baseInstructions.trim(),
    friendlyPersonality.trim(),
    '# Global test instructions',
    '# AGENTS.md',
    '<available_context>',
    'MCP ordering test instructions',
    '<environment_info>',
    '<current_workspace>',
  ];
  for (let index = 1; index < orderedMarkers.length; index += 1) {
    assert.ok(
      orderedContext.indexOf(orderedMarkers[index - 1])
      < orderedContext.indexOf(orderedMarkers[index]),
      `${orderedMarkers[index - 1]} must precede ${orderedMarkers[index]}`,
    );
  }

  const friendlyContext = await resolveDynamicContext({
    workspacePath: root,
    tuning: { personality: 'friendly' },
  });
  assert.ok(friendlyContext.includes(friendlyPersonality.trim()));
  assert.ok(!friendlyContext.includes(pragmaticPersonality.trim()));
  assert.ok(
    friendlyContext.indexOf(friendlyPersonality.trim())
    < friendlyContext.indexOf('<available_context>'),
  );

  const pragmaticContext = await resolveDynamicContext({
    workspacePath: root,
    tuning: { personality: 'pragmatic' },
  });
  assert.ok(pragmaticContext.includes(pragmaticPersonality.trim()));
  assert.ok(!pragmaticContext.includes(friendlyPersonality.trim()));

  for (const [personality, prompt] of Object.entries({
    candid: candidPersonality,
    cynical: cynicalPersonality,
    quirky: quirkyPersonality,
  })) {
    const personalityContext = await resolveDynamicContext({
      workspacePath: root,
      tuning: { personality },
    });
    assert.ok(personalityContext.includes(prompt.trim()));
    assert.ok(
      personalityContext.indexOf(prompt.trim())
      < personalityContext.indexOf('<available_context>'),
    );
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
  assert.ok(planContext.startsWith(baseInstructions.trim()));
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

  const ultraContext = await resolveDynamicContext({
    workspacePath: root,
    ultraMode: true,
    orchestrationRole: 'orchestrator',
  });
  assert.ok(ultraContext.startsWith(baseInstructions.trim()));
  for (const requirement of [
    '<work_mode mode="ultra" role="orchestrator">',
    'chat_spawn_subagent',
    'chat_send_prompt',
    'independent judges or reviewers',
    'Ultra mode may operate together with an active Goal',
    'incompatible with Plan mode',
    'diminishing value',
  ]) {
    if (!ultraContext.includes(requirement)) {
      throw new Error(`Ultra context is missing: ${requirement}`);
    }
  }
  assert.ok(!injected.includes('<work_mode mode="ultra"'));
  assert.ok(!(await resolveDynamicContext({
    workspacePath: root,
    ultraMode: true,
    orchestrationRole: 'subagent',
  })).includes('role="orchestrator"'));

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
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(root, { recursive: true, force: true });
}
