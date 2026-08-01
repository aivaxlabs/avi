import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  listContextItems,
  resolveDynamicContext,
  resolveInstallationContextPath,
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
const testHome = await mkdtemp(path.join(tmpdir(), 'context-home-'));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const installationRoot = await mkdtemp(path.join(tmpdir(), 'installed-Avi-'));
const installationContextDirectory = path.join(installationRoot, 'Resources', 'app', 'context');

try {
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  const deepInstructionDirectory = path.join(root, 'nested', 'a', 'b', 'c', 'd', 'e');
  const tooDeepInstructionDirectory = path.join(deepInstructionDirectory, 'f');
  const globalAgentsDirectory = path.join(testHome, '.agents');
  await Promise.all([
    mkdir(deepInstructionDirectory, { recursive: true }),
    mkdir(tooDeepInstructionDirectory, { recursive: true }),
    mkdir(path.join(installationContextDirectory, 'skills', 'avi-skill'), { recursive: true }),
    mkdir(path.join(installationContextDirectory, 'workflows'), { recursive: true }),
    mkdir(path.join(installationContextDirectory, 'rules'), { recursive: true }),
    mkdir(path.join(root, '.git'), { recursive: true }),
    mkdir(path.join(root, '.vs'), { recursive: true }),
    mkdir(path.join(globalAgentsDirectory, 'skills', 'global-skill'), { recursive: true }),
    mkdir(path.join(globalAgentsDirectory, 'workflows'), { recursive: true }),
    mkdir(path.join(globalAgentsDirectory, 'rules'), { recursive: true }),
    mkdir(path.join(testHome, '.claude', 'skills', 'ignored-global-skill'), { recursive: true }),
    mkdir(path.join(root, '.agents', 'skills', 'workspace-skill'), { recursive: true }),
    mkdir(path.join(root, '.agents', 'workflows'), { recursive: true }),
    mkdir(path.join(root, 'frontend', '.agents', 'skills', 'frontend-skill'), { recursive: true }),
    mkdir(path.join(root, 'frontend', '.agents', 'workflows'), { recursive: true }),
    mkdir(path.join(root, 'skills', 'ignored-root-skill'), { recursive: true }),
    mkdir(path.join(root, 'workflows'), { recursive: true }),
    mkdir(path.join(root, 'frontend', 'skills', 'ignored-frontend-skill'), { recursive: true }),
    mkdir(path.join(root, 'frontend', 'workflows'), { recursive: true }),
    mkdir(path.join(root, '.claude', 'skills', 'ignored-claude-skill'), { recursive: true }),
  ]);
  await Promise.all([
    ...[
      'AGENTS.md',
      'AGENTS.foobar.md',
      'AGENTS.outracoisa.md',
      'AGENTS.user.md',
      'MEMORY.md',
      'MEMORY.algumacoisa.md',
      'CLAUDE.md',
      'gemini.md',
      'project.instructions.md',
      'agents.project.md',
      'project.agents.md',
      'AGENT.invalid.md',
      'NOTES.md',
    ].map((name) => writeFile(path.join(root, name), `# ${name}`)),
    writeFile(path.join(root, 'frontend', 'agents.md'), '# Frontend instructions'),
    writeFile(path.join(root, 'nested', 'MEMORY.child.md'), '# Nested memory'),
    writeFile(path.join(tooDeepInstructionDirectory, 'ignored-depth.instructions.md'), '# Beyond maximum recursion'),
    writeFile(path.join(deepInstructionDirectory, 'deep.instructions.md'), [
      '---',
      'description: Deep recursive instructions',
      '---',
      '# Deep instructions',
    ].join('\n')),
    writeFile(path.join(installationContextDirectory, 'AGENTS.md'), '# Avi installation instructions'),
    writeFile(
      path.join(installationContextDirectory, 'rules', 'avi.instructions.md'),
      '# Avi recursive installation instructions',
    ),
    writeFile(path.join(installationContextDirectory, 'skills', 'avi-skill', 'SKILL.md'), [
      '---',
      'description: Avi installation skill',
      '---',
    ].join('\n')),
    writeFile(
      path.join(installationContextDirectory, 'workflows', 'avi-workflow.md'),
      '# Avi installation workflow',
    ),
    writeFile(path.join(root, '.git', 'AGENTS.md'), '# Ignored Git instructions'),
    writeFile(path.join(root, '.vs', 'GEMINI.md'), '# Ignored Visual Studio instructions'),
    writeFile(path.join(testHome, 'AGENTS.md'), '# Ignored home root instructions'),
    writeFile(path.join(globalAgentsDirectory, 'AGENTS.md'), '# Global test instructions'),
    writeFile(path.join(globalAgentsDirectory, 'rules', 'global.instructions.md'), [
      '---',
      'description: Global recursive instructions',
      '---',
    ].join('\n')),
    writeFile(path.join(globalAgentsDirectory, 'skills', 'global-skill', 'SKILL.md'), [
      '---',
      'description: Global skill from frontmatter',
      '---',
      '# Global test skill',
    ].join('\n')),
    writeFile(
      path.join(globalAgentsDirectory, 'workflows', 'global-workflow.md'),
      '# Global test workflow',
    ),
    writeFile(
      path.join(testHome, '.claude', 'skills', 'ignored-global-skill', 'SKILL.md'),
      '# Ignored global Claude skill',
    ),
    writeFile(path.join(root, '.agents', 'skills', 'workspace-skill', 'SKILL.md'), [
      '---',
      'description: Workspace skill from frontmatter',
      'user-invocable: false # Do not expose as a $ command',
      '---',
      '# Workspace test skill',
    ].join('\n')),
    writeFile(
      path.join(root, '.agents', 'workflows', 'workspace-workflow.md'),
      '# Workspace workflow',
    ),
    writeFile(path.join(root, 'frontend', '.agents', 'skills', 'frontend-skill', 'SKILL.md'), [
      '---',
      'description: Frontend skill from frontmatter',
      'user-invocable: true',
      '---',
      '# Frontend test skill',
    ].join('\n')),
    writeFile(
      path.join(root, 'frontend', '.agents', 'workflows', 'frontend-workflow.md'),
      [
        '---',
        'description: Frontend workflow',
        'user-invocable: false',
        '---',
        '# Frontend workflow',
      ].join('\n'),
    ),
    writeFile(
      path.join(root, 'skills', 'ignored-root-skill', 'SKILL.md'),
      '# Ignored root skill',
    ),
    writeFile(path.join(root, 'workflows', 'ignored-root-workflow.md'), '# Ignored root workflow'),
    writeFile(
      path.join(root, 'frontend', 'skills', 'ignored-frontend-skill', 'SKILL.md'),
      '# Ignored frontend skill',
    ),
    writeFile(
      path.join(root, 'frontend', 'workflows', 'ignored-frontend-workflow.md'),
      '# Ignored frontend workflow',
    ),
    writeFile(
      path.join(root, '.claude', 'skills', 'ignored-claude-skill', 'SKILL.md'),
      '# Ignored workspace Claude skill',
    ),
  ]);

  const context = await listContextItems(root);
  const instructionItems = context.groups.find((group) => group.id === 'instruction').items;
  const instructionPaths = instructionItems
    .map((item) => path.relative(root, item.path).replaceAll('\\', '/'))
    .sort();
  const expectedInstructionPaths = [
    'AGENTS.foobar.md',
    'AGENTS.md',
    'AGENTS.outracoisa.md',
    'AGENTS.user.md',
    'agents.project.md',
    'CLAUDE.md',
    'frontend/agents.md',
    'gemini.md',
    'MEMORY.algumacoisa.md',
    'MEMORY.md',
    'nested/a/b/c/d/e/deep.instructions.md',
    'nested/MEMORY.child.md',
    'project.agents.md',
    'project.instructions.md',
  ].sort();
  assert.deepEqual(instructionPaths, expectedInstructionPaths);
  assert.equal(
    instructionItems.find((item) => item.title === 'deep.instructions.md').description,
    'Deep recursive instructions',
  );
  assert.equal(
    instructionItems.find((item) => item.description === 'Frontend instructions')?.description,
    'Frontend instructions',
  );
  assert.ok(!instructionItems.some((item) => item.description.includes('Ignored')));
  assert.ok(!instructionItems.some((item) => item.title === 'ignored-depth.instructions.md'));

  const skillItems = context.groups.find((group) => group.id === 'skill').items;
  assert.deepEqual(
    skillItems.map((item) => item.description).sort(),
    ['Frontend skill from frontmatter', 'Workspace skill from frontmatter'],
  );
  assert.equal(
    skillItems.find((item) => item.description === 'Workspace skill from frontmatter').userInvocable,
    false,
  );
  assert.equal(
    skillItems.find((item) => item.description === 'Frontend skill from frontmatter').userInvocable,
    true,
  );
  const workflowItems = context.groups.find((group) => group.id === 'workflow').items;
  assert.deepEqual(
    workflowItems.map((item) => item.description).sort(),
    ['Frontend workflow', 'Workspace workflow'],
  );
  assert.equal(
    workflowItems.find((item) => item.description === 'Frontend workflow').userInvocable,
    false,
  );
  assert.equal(
    workflowItems.find((item) => item.description === 'Workspace workflow').userInvocable,
    true,
  );
  assert.deepEqual(
    context.commands.map((command) => command.id).sort(),
    ['skill:frontend-skill', 'workflow:workspace-workflow'],
  );

  const installationContext = await listContextItems(installationContextDirectory, {
    includeRootCatalog: true,
  });
  assert.deepEqual(
    installationContext.groups.find((group) => group.id === 'instruction').items
      .map((item) => item.description).sort(),
    ['Avi installation instructions', 'Avi recursive installation instructions'].sort(),
  );
  assert.deepEqual(
    installationContext.groups.find((group) => group.id === 'skill').items
      .map((item) => item.description),
    ['Avi installation skill'],
  );
  assert.deepEqual(
    installationContext.groups.find((group) => group.id === 'workflow').items
      .map((item) => item.description),
    ['Avi installation workflow'],
  );
  assert.equal(
    (await listContextItems(path.join(installationRoot, 'missing-context'), {
      includeRootCatalog: true,
    })).itemCount,
    0,
  );
  assert.ok(!(await resolveDynamicContext({
    workspacePath: root,
    installationContextPath: path.join(installationRoot, 'missing-context'),
  })).includes('<installation_instructions>'));
  assert.equal(
    resolveInstallationContextPath(path.join(installationRoot, 'bin', 'bun.exe'), 'win32'),
    installationContextDirectory,
  );
  assert.equal(
    resolveInstallationContextPath(
      path.join(installationRoot, 'Avi.app', 'Contents', 'MacOS', 'bun'),
      'darwin',
    ),
    path.join(installationRoot, 'Avi.app', 'Contents', 'Resources', 'app', 'context'),
  );

  const globalContext = await listContextItems(globalAgentsDirectory);
  assert.deepEqual(
    globalContext.groups.find((group) => group.id === 'skill').items.map((item) => item.description),
    ['Global skill from frontmatter'],
  );
  assert.deepEqual(
    globalContext.groups.find((group) => group.id === 'workflow').items.map((item) => item.description),
    ['Global test workflow'],
  );
  assert.ok(globalContext.groups
    .find((group) => group.id === 'instruction')
    .items
    .some((item) => item.description === 'Global recursive instructions'));
  const homeContext = await listContextItems(testHome);
  assert.equal(homeContext.itemCount, 0);
  assert.ok(homeContext.groups.every((group) => group.items.length === 0));
  const homeInjected = await resolveDynamicContext({
    workspacePath: testHome,
    installationContextPath: installationContextDirectory,
  });
  assert.ok(homeInjected.includes('# Global test instructions'));
  assert.ok(!homeInjected.includes('# Ignored home root instructions'));
  assert.ok(!homeInjected.includes('<workspace_instructions>'));
  assert.ok(homeInjected.includes('The home directory is not scanned as a workspace.'));
  const injected = await resolveDynamicContext({
    workspacePath: root,
    installationContextPath: installationContextDirectory,
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
    || !injected.includes('<installation_instructions>')
    || !injected.includes('# Avi installation instructions')
    || !injected.includes('Avi installation skill')
    || !injected.includes('Avi installation workflow')
    || !injected.includes('<global_instructions>')
    || !injected.includes('# Global test instructions')
    || !injected.includes('<workspace_instructions>')
    || !injected.includes('--- BEGIN AGENTS.foobar.md ---')
    || !injected.includes('nested/MEMORY.child.md')
    || !injected.includes('Global skill from frontmatter')
    || !injected.includes('Workspace skill from frontmatter')
    || !injected.includes('Frontend skill from frontmatter')
    || !injected.includes('Workspace workflow')
    || !injected.includes('Frontend workflow')
    || !injected.includes('deep.instructions.md — Deep recursive instructions')
    || !injected.includes('global.instructions.md — Global recursive instructions')
    || !injected.includes('MCP ordering test instructions')
    || injected.includes('--- BEGIN AGENT.invalid.md ---')
    || injected.includes('--- BEGIN NOTES.md ---')
    || injected.includes('Ignored home root instructions')
    || injected.includes('Ignored global Claude skill')
    || injected.includes('Ignored root skill')
    || injected.includes('Ignored frontend skill')
    || injected.includes('Ignored workspace Claude skill')
    || injected.includes('Ignored Git instructions')
    || injected.includes('Ignored Visual Studio instructions')
    || !injected.includes(`Command execution shell: ${terminalShell.label}`)
    || !injected.includes('#file:./path:12-52')
    || !injected.includes('#file:<./path with spaces.js>:12')
    || !injected.includes('Do not wrap the reference in backticks')
  ) {
    throw new Error('Context variants did not follow the expected root and nested rules.');
  }

  const orderedContext = await resolveDynamicContext({
    workspacePath: root,
    installationContextPath: installationContextDirectory,
    tuning: { personality: 'friendly' },
    mcpInstructions: [{
      from: 'ordering-test',
      text: 'MCP ordering test instructions',
    }],
  });
  const orderedMarkers = [
    baseInstructions.trim(),
    friendlyPersonality.trim(),
    '# Avi installation instructions',
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
    'chat_spawn_subagent',
    'chat_send_prompt',
    'exploration, consolidation, research, and analysis',
    'Sub-agents may use chat_send_prompt',
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

  const workspaceTreeRoot = await mkdtemp(path.join(tmpdir(), 'context-workspace-tree-'));
  try {
    await Promise.all([
      mkdir(path.join(workspaceTreeRoot, 'a-empty')),
      mkdir(path.join(workspaceTreeRoot, 'b-visible')),
      mkdir(path.join(workspaceTreeRoot, 'c-visible')),
      mkdir(path.join(workspaceTreeRoot, 'd-truncated')),
      mkdir(path.join(workspaceTreeRoot, 'node_modules')),
    ]);
    await Promise.all([
      writeFile(path.join(workspaceTreeRoot, 'b-visible', '1.txt'), ''),
      writeFile(path.join(workspaceTreeRoot, 'b-visible', '2.txt'), ''),
      writeFile(path.join(workspaceTreeRoot, 'b-visible', '3.txt'), ''),
      writeFile(path.join(workspaceTreeRoot, 'b-visible', '4.txt'), ''),
      writeFile(path.join(workspaceTreeRoot, 'node_modules', 'ignored.txt'), ''),
    ]);

    let chainDirectory = workspaceTreeRoot;
    for (let index = 0; index <= 101; index += 1) {
      chainDirectory = path.join(chainDirectory, `chain-${String(index).padStart(3, '0')}`);
      await mkdir(chainDirectory);
    }
    await writeFile(path.join(chainDirectory, 'beyond-limit.txt'), '');

    const workspaceTreeContext = await resolveDynamicContext({
      workspacePath: workspaceTreeRoot,
      installationContextPath: path.join(installationRoot, 'missing-context'),
    });
    const workspaceTree = workspaceTreeContext.match(/<current_workspace>[\s\S]*?<\/current_workspace>/)?.[0] ?? '';
    assert.ok(workspaceTree.includes('a-empty/'));
    assert.ok(workspaceTree.includes('b-visible/'));
    assert.ok(workspaceTree.includes('\t1.txt\n\t2.txt\n\t3.txt\n\t...'));
    assert.ok(!workspaceTree.includes('4.txt'));
    assert.ok(!workspaceTree.includes('node_modules/'));
    assert.ok(!workspaceTree.includes('ignored.txt'));
    const directoryLimitContext = await resolveDynamicContext({
      workspacePath: path.join(workspaceTreeRoot, 'chain-000'),
      installationContextPath: path.join(installationRoot, 'missing-context'),
    });
    const directoryLimitTree = directoryLimitContext.match(/<current_workspace>[\s\S]*?<\/current_workspace>/)?.[0] ?? '';
    assert.ok(directoryLimitTree.includes('chain-100/'));
    assert.ok(!directoryLimitTree.includes('chain-101/'));
    assert.ok(!directoryLimitTree.includes('beyond-limit.txt'));
  } finally {
    await rm(workspaceTreeRoot, { recursive: true, force: true });
  }
  const symlinkWorkspace = await mkdtemp(path.join(tmpdir(), 'context-symlink-workspace-'));
  const symlinkTarget = await mkdtemp(path.join(tmpdir(), 'context-symlink-target-'));
  try {
    await Promise.all([
      mkdir(path.join(symlinkTarget, '.agents', 'skills', 'linked-skill', 'a', 'b'), { recursive: true }),
      mkdir(path.join(symlinkTarget, '.agents', 'skills', 'too-deep', 'a', 'b', 'c'), { recursive: true }),
      mkdir(path.join(symlinkTarget, '.agents', 'workflows'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(symlinkTarget, 'AGENTS.linked.md'), '# Linked instructions'),
      writeFile(
        path.join(symlinkTarget, '.agents', 'skills', 'linked-skill', 'a', 'b', 'SKILL.md'),
        '---\ndescription: Linked skill at maximum depth\n---',
      ),
      writeFile(
        path.join(symlinkTarget, '.agents', 'skills', 'too-deep', 'a', 'b', 'c', 'SKILL.md'),
        '---\ndescription: Linked skill beyond maximum depth\n---',
      ),
      writeFile(path.join(symlinkTarget, '.agents', 'workflows', 'linked.md'), '# Linked workflow'),
    ]);
    await symlink(symlinkTarget, path.join(symlinkWorkspace, 'linked-context'), 'junction');
    await symlink(symlinkWorkspace, path.join(symlinkTarget, 'workspace-cycle'), 'junction');

    const symlinkItems = await listContextItems(symlinkWorkspace);
    assert.ok(symlinkItems.groups.find(({ id }) => id === 'instruction').items
      .some(({ description }) => description === 'Linked instructions'));
    assert.ok(symlinkItems.groups.find(({ id }) => id === 'skill').items
      .some(({ description }) => description === 'Linked skill at maximum depth'));
    assert.ok(!symlinkItems.groups.find(({ id }) => id === 'skill').items
      .some(({ description }) => description === 'Linked skill beyond maximum depth'));
    assert.ok(symlinkItems.groups.find(({ id }) => id === 'workflow').items
      .some(({ description }) => description === 'Linked workflow'));

    const symlinkContext = await resolveDynamicContext({
      workspacePath: symlinkWorkspace,
      installationContextPath: path.join(installationRoot, 'missing-context'),
    });
    assert.ok(symlinkContext.includes('linked-context/AGENTS.linked.md'));
    assert.ok(symlinkContext.includes('linked-context/'));
  } finally {
    await Promise.all([
      rm(symlinkWorkspace, { recursive: true, force: true }),
      rm(symlinkTarget, { recursive: true, force: true }),
    ]);
  }

  const threadDirectory = await resolveDynamicContext({
    workspacePath: root,
    currentThread: {
      threadId: 'subagent-id',
      role: 'subagent',
      parentThreadId: 'orchestrator-id',
    },
    threads: [
      {
        threadId: 'orchestrator-id',
        role: 'orchestrator',
        initialPrompt: 'Coordinate the work.',
        status: 'in_progress',
      },
      {
        threadId: 'subagent-id',
        role: 'subagent',
        parentThreadId: 'orchestrator-id',
        initialPrompt: 'Analyze the implementation.',
        status: 'idle',
      },
      {
        threadId: 'side-chat-id',
        role: 'side_chat',
        parentThreadId: 'orchestrator-id',
        initialPrompt: 'Explore an alternative.',
        status: 'completed',
      },
    ],
  });
  assert.ok(threadDirectory.includes('<current_thread id="subagent-id" role="subagent" parent_thread_id="orchestrator-id">'));
  assert.ok(threadDirectory.includes('Side chats are private and are intentionally absent'));
  assert.ok(threadDirectory.includes('<thread_directory>'));
  assert.ok(threadDirectory.includes('<thread id="orchestrator-id" role="orchestrator" status="in_progress">'));
  assert.ok(threadDirectory.includes('<thread id="subagent-id" role="subagent" status="idle" parent_thread_id="orchestrator-id">'));
  assert.ok(threadDirectory.includes('<thread id="side-chat-id" role="side_chat" status="completed" parent_thread_id="orchestrator-id">'));
  assert.ok(threadDirectory.includes('<initial_prompt>Analyze the implementation.</initial_prompt>'));

  console.log('Context variant discovery passed.');
} finally {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(testHome, { recursive: true, force: true }),
    rm(installationRoot, { recursive: true, force: true }),
  ]);
}
