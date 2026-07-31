import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import baseInstructions from '../prompts/base-instructions.md' with { type: 'text' };
import candidPersonality from '../prompts/personality/candid.md' with { type: 'text' };
import cynicalPersonality from '../prompts/personality/cynical.md' with { type: 'text' };
import friendlyPersonality from '../prompts/personality/friendly.md' with { type: 'text' };
import pragmaticPersonality from '../prompts/personality/pragmatic.md' with { type: 'text' };
import quirkyPersonality from '../prompts/personality/quirky.md' with { type: 'text' };
import { resolveTerminalShell } from './terminal-shell.js';

const IGNORED_WORKSPACE_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.venv',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'target',
  'vendor',
  'venv',
]);
const MAX_ENTRIES_PER_DIRECTORY = 20;
const MAX_WORKSPACE_DIRECTORIES = 50;
const MAX_CONTEXT_DIRECTORY_DEPTH = 4;
const CONTEXT_FILE_PATTERN = /^(?:AGENTS|MEMORY)(?:\.[^.]+)*\.md$/i;
const POST_INSTRUCTION_CONTEXT_ORDER = [
  'mcp',
  'work-mode',
  'ultra',
  'goal',
  'subagents',
  'environment',
  'workspace',
];

export const dynamicContextInjectors = new Map([
  ['personality', ({ tuning } = {}) => ({
    candid: candidPersonality,
    cynical: cynicalPersonality,
    friendly: friendlyPersonality,
    pragmatic: pragmaticPersonality,
    quirky: quirkyPersonality,
  }[tuning?.personality] ?? '')],
  ['mcp', ({ mcpInstructions = [] } = {}) => (
    mcpInstructions
      .filter((instruction) => instruction?.text)
      .map((instruction) => [
        `<mcp_context from="${escapeXml(instruction.from || 'MCP server')}">`,
        instruction.text,
        '</mcp_context>',
      ].join('\n'))
      .join('\n\n')
  )],
  ['work-mode', ({ workMode } = {}) => (
    workMode === 'plan'
      ? [
          '<work_mode mode="plan">',
          'You are in Plan mode. This run is exclusively for investigation, clarification, and creation of an execution plan.',
          'Do not edit files, run commands, mutate data, create or interrupt conversations, use subagents, call provider tools, call MCP tools, or take destructive actions. No permission level overrides these restrictions.',
          'Investigate the repository and available read-only context before asking questions. Ask as many focused questions as necessary to eliminate every material ambiguity, but do not repeat questions or ask for facts that can be discovered from the repository.',
          'Do not present alternatives, unresolved decisions, or implementation work. Refine the plan until no material detail is left open to interpretation.',
          'When and only when the plan is complete, emit exactly one non-empty <execution-plan>...</execution-plan> block. The block must detail the objective, affected files, specific changes, public contracts, execution sequence, risks, validations, how each validation will be performed, and measurable success criteria.',
          'Do not emit an <execution-plan> block while questions remain unanswered. Outside the final block, keep any necessary communication concise.',
          '</work_mode>',
        ].join('\n')
      : ''
  )],
  ['ultra', ({ ultraMode, orchestrationRole } = {}) => (
    ultraMode && orchestrationRole === 'orchestrator'
      ? [
          '<work_mode mode="ultra" role="orchestrator">',
          'You are the orchestrator in Ultra mode. Lead the work proactively and take responsibility for the integrated result.',
          'First establish the real objective, constraints, acceptance criteria, unknowns, and likely failure boundaries. Investigate available context before committing to an approach.',
          'For substantial work, assemble a focused team early with chat_spawn_subagent. Decompose the objective into independent investigation, implementation, testing, review, and discovery assignments when those directions add confidence or speed.',
          'Give every sub-agent a self-contained prompt with its objective, acceptance criteria, relevant context, file or system scope, available tools and permissions, dependencies, expected evidence, and reporting format.',
          'Do not create agents merely to appear busy. Avoid duplicate assignments unless you explicitly want independent verification, comparison, or judgment.',
          'Maintain active coordination. Track the listed sub-agents, inspect their threads when needed, send follow-up instructions with chat_send_prompt, respond to blockers, share relevant discoveries across the team, and integrate interim reports instead of waiting passively.',
          'When useful, explore multiple viable solutions before or during execution and compare them against the objective, constraints, risk, maintainability, and validation evidence.',
          'After convergence on consequential work, commission independent judges or reviewers to challenge the current result. Interpret their findings skeptically: separate material defects from preferences, low-value concerns, and findings unsupported by evidence.',
          'Use additional investigators, implementers, testers, or reviewers to resolve material findings. The orchestrator owns final synthesis and verification; never forward reports as a substitute for judgment.',
          'Ultra mode may operate together with an active Goal. When it does, the Goal specification and completion rules remain authoritative.',
          'Ultra mode is incompatible with Plan mode. Do not attempt to enter or simulate Plan mode while Ultra is active.',
          'Stop expanding the team when further delegation has diminishing value. Finish when the user objective and acceptance criteria are genuinely satisfied with proportionate evidence, or report a concrete blocker after exhausting safe in-scope paths.',
          'Communicate concise decisions, evidence, uncertainties, and next actions. Do not expose private chain-of-thought from yourself or the team.',
          '</work_mode>',
        ].join('\n')
      : ''
  )],
  ['goal', ({ goal } = {}) => (
    goal && ['active', 'paused'].includes(goal.status)
      ? [
          `<goal_mode id="${escapeXml(goal.id)}" revision="${goal.revision}" status="${goal.status}">`,
          'You are working in Goal mode. Pursue the objective persistently and authentically, without shortcuts, false claims, fabricated evidence, or misleading the user.',
          'The goal specification is authoritative:',
          '<goal_specification>',
          goal.specification,
          '</goal_specification>',
          'Keep working until every acceptance term in the specification is genuinely satisfied or a real blocker makes further progress impossible.',
          'Call update_goal_status with status "completed" only after verifying that the full specification is satisfied. Include concrete completion evidence in the summary.',
          'Call update_goal_status with status "blocked" only when a specific condition actually prevents further progress. Include the blocker and the work already attempted in the summary.',
          'Do not classify ordinary difficulty, uncertainty, a long task, or the end of an iteration as blocked. If the goal is still achievable and incomplete, do not classify it; the system will continue the goal in another iteration.',
          goal.status === 'paused'
            ? 'The user paused automatic Goal iterations. Finish the current iteration responsibly, but do not assume the pause cancels the goal.'
            : 'Automatic Goal iterations are active.',
          '</goal_mode>',
        ].join('\n')
      : ''
  )],
  ['subagents', ({ subagents = [] } = {}) => (
    Array.isArray(subagents) && subagents.length > 0
      ? [
          '<subagents>',
          ...subagents.flatMap((subagent) => [
            `<subagent thread_id="${escapeXml(subagent.threadId)}" status="${escapeXml(subagent.status)}">`,
            `<initial_prompt>${escapeXml(
              String(subagent.initialPrompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 256),
            )}</initial_prompt>`,
            '</subagent>',
          ]),
          '</subagents>',
        ].join('\n')
      : ''
  )],
  ['environment', ({ tuning } = {}) => {
    const operatingSystem = {
      win32: 'Windows',
      darwin: 'macOS',
      linux: 'Linux',
    }[process.platform] ?? process.platform;
    const terminalShell = resolveTerminalShell(
      process.env,
      process.platform,
      tuning?.terminalShell,
    );

    return [
      '<environment_info>',
      `User current OS: ${operatingSystem}`,
      `Command execution shell: ${terminalShell.label}`,
      '</environment_info>',
    ].join('\n');
  }],
  ['workspace', async ({ workspacePath } = {}) => {
    const currentDirectory = path.resolve(workspacePath || process.cwd());
    const structure = [];
    let directoryCount = 0;

    async function appendDirectory(directoryPath, depth) {
      let entries;
      try {
        entries = await readdir(directoryPath, { withFileTypes: true });
      } catch {
        structure.push(`${'\t'.repeat(depth)}...`);
        return;
      }

      const filteredEntries = entries
        .filter((entry) => !IGNORED_WORKSPACE_DIRECTORIES.has(entry.name.toLowerCase()))
        .sort((left, right) => (
          Number(left.isDirectory()) - Number(right.isDirectory())
          || left.name.localeCompare(right.name, undefined, { numeric: true })
        ));
      const visibleEntries = filteredEntries.slice(0, MAX_ENTRIES_PER_DIRECTORY);
      let truncated = filteredEntries.length > visibleEntries.length;

      for (const entry of visibleEntries) {
        const indentation = '\t'.repeat(depth);
        const name = escapeXml(entry.name);
        if (!entry.isDirectory()) {
          structure.push(`${indentation}${name}`);
          continue;
        }
        if (directoryCount >= MAX_WORKSPACE_DIRECTORIES) {
          truncated = true;
          continue;
        }

        directoryCount += 1;
        structure.push(`${indentation}${name}/`);
        await appendDirectory(path.join(directoryPath, entry.name), depth + 1);
      }

      if (truncated) {
        structure.push(`${'\t'.repeat(depth)}...`);
      }
    }

    await appendDirectory(currentDirectory, 0);

    return [
      '<current_workspace>',
      `Current directory: ${escapeXml(currentDirectory)}`,
      'When mentioning an existing workspace file, use #file:./path, #file:./path:12, or #file:./path:12-52 so the user can open it from the chat. Do not wrap the reference in backticks or a Markdown code block. Wrap paths containing whitespace in angle brackets before the optional line suffix, for example #file:<./path with spaces.js>:12.',
      'Directory structure:',
      ...structure,
      '</current_workspace>',
    ].join('\n');
  }],
  ['instructions', async ({ workspacePath } = {}) => {
    const roots = [
      { id: 'global', label: '$HOME/.agents', path: path.join(homedir(), '.agents') },
      {
        id: 'workspace',
        label: 'workspace',
        path: path.resolve(workspacePath || process.cwd()),
      },
    ].filter((root, index, items) => (
      items.findIndex((item) => item.path.toLowerCase() === root.path.toLowerCase()) === index
    ));
    const instructionContexts = {
      global: '',
      workspace: '',
    };
    const contextSections = [];

    for (const root of roots) {
      const rootContextFiles = await collectFiles(
        root.path,
        0,
        (fileName) => CONTEXT_FILE_PATTERN.test(fileName),
      );
      const rootFiles = (await Promise.all(rootContextFiles.map(async (filePath) => {
        try {
          return {
            name: path.basename(filePath),
            content: await readFile(filePath, 'utf8'),
          };
        } catch {
          return null;
        }
      }))).filter(Boolean);
      const skillFiles = await collectFiles(
        path.join(root.path, 'skills'),
        MAX_CONTEXT_DIRECTORY_DEPTH,
        (fileName) => fileName.toLowerCase() === 'skill.md',
      );
      const workflowFiles = await collectFiles(
        path.join(root.path, 'workflows'),
        MAX_CONTEXT_DIRECTORY_DEPTH,
        () => true,
      );
      const nestedContextFiles = await collectFiles(
        root.path,
        MAX_CONTEXT_DIRECTORY_DEPTH,
        (fileName, depth) => (
          depth > 0 && CONTEXT_FILE_PATTERN.test(fileName)
        ),
      );
      const displayPath = (filePath) => {
        const relativePath = path.relative(root.path, filePath).replaceAll('\\', '/');
        return root.label === 'workspace'
          ? relativePath
          : `${root.label}/${relativePath}`;
      };
      const skillLines = await Promise.all(skillFiles.map(async (filePath) => (
        `- ${escapeXml(displayPath(filePath))}`
        + ` — ${escapeXml(await readDescription(filePath))}`
      )));
      const workflowLines = await Promise.all(workflowFiles.map(async (filePath) => (
        `- ${escapeXml(displayPath(filePath))}`
        + ` — ${escapeXml(await readDescription(filePath))}`
      )));
      const nestedContextLines = await Promise.all(nestedContextFiles.map(async (filePath) => (
        `- ${escapeXml(displayPath(filePath))}`
        + ` — ${escapeXml(await readDescription(filePath))}`
      )));

      const instructionSections = [];
      for (const file of rootFiles) {
        instructionSections.push(
          `--- BEGIN ${file.name} ---`,
          file.content,
          `--- END ${file.name} ---`,
        );
      }
      if (nestedContextLines.length > 0) {
        instructionSections.push(
          'Nested AGENTS and MEMORY files:',
          ...nestedContextLines,
        );
      }
      if (instructionSections.length > 0) {
        instructionContexts[root.id] = [
          `<${root.id}_instructions>`,
          `Source: ${root.label}`,
          `Root: ${escapeXml(root.path)}`,
          ...instructionSections,
          `</${root.id}_instructions>`,
        ].join('\n');
      }

      const catalogSections = [];
      if (skillLines.length > 0) {
        catalogSections.push('Skills:', ...skillLines);
      }
      if (workflowLines.length > 0) {
        catalogSections.push('Workflows:', ...workflowLines);
      }
      if (catalogSections.length > 0) {
        contextSections.push(
          `Source: ${root.label}`,
          `Root: ${escapeXml(root.path)}`,
          ...catalogSections,
          '',
        );
      }
    }

    return [
      instructionContexts.global,
      instructionContexts.workspace,
      contextSections.length > 0
        ? [
            '<available_context>',
            ...contextSections,
            '</available_context>',
          ].join('\n')
        : '',
    ];
  }],
]);

export async function resolveDynamicContext(invocationContext = {}) {
  const personalityInjector = dynamicContextInjectors.get('personality');
  const instructionsInjector = dynamicContextInjectors.get('instructions');
  const [
    personalityContext,
    instructionContexts,
    ...environmentContexts
  ] = await Promise.all([
    personalityInjector?.(invocationContext),
    instructionsInjector?.(invocationContext),
    ...POST_INSTRUCTION_CONTEXT_ORDER.map((name) => (
      dynamicContextInjectors.get(name)?.(invocationContext)
    )),
  ]);
  const contexts = [
    baseInstructions,
    personalityContext,
    ...instructionContexts,
    ...environmentContexts,
  ];

  return contexts
    .map((context) => String(context ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export async function listContextItems(rootPath) {
  const root = path.resolve(rootPath);
  const instructionFiles = await collectFiles(
    root,
    0,
    (fileName) => CONTEXT_FILE_PATTERN.test(fileName),
  );
  const skillFiles = await collectFiles(
    path.join(root, 'skills'),
    MAX_CONTEXT_DIRECTORY_DEPTH,
    (fileName) => fileName.toLowerCase() === 'skill.md',
  );
  const workflowFiles = await collectFiles(
    path.join(root, 'workflows'),
    MAX_CONTEXT_DIRECTORY_DEPTH,
    () => true,
  );
  const groups = await Promise.all([
    {
      id: 'instruction',
      title: 'Instructions',
      folderPath: root,
      files: instructionFiles,
    },
    {
      id: 'skill',
      title: 'Skills',
      folderPath: path.join(root, 'skills'),
      files: skillFiles,
    },
    {
      id: 'workflow',
      title: 'Workflows',
      folderPath: path.join(root, 'workflows'),
      files: workflowFiles,
    },
  ].map(async ({ files, ...group }) => ({
    ...group,
    items: await Promise.all(files.map((filePath) => readContextItem(filePath))),
  })));
  const items = groups.flatMap((group) => group.items);
  const commands = [];
  const commandKeys = new Set();

  for (const group of groups.filter(({ id }) => id === 'skill' || id === 'workflow')) {
    for (const item of group.items) {
      const fileName = path.basename(item.path);
      const sourceName = group.id === 'skill' && item.title.toLowerCase() === 'skill.md'
        ? path.basename(path.dirname(item.path))
        : group.id === 'workflow' && item.title === fileName
          ? path.basename(fileName, path.extname(fileName))
          : item.title;
      const name = sourceName
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
      const key = `${group.id}:${name}`;

      if (!name || commandKeys.has(key)) continue;
      commandKeys.add(key);
      commands.push({
        id: key,
        type: group.id,
        name,
        description: item.description,
      });
    }
  }

  return {
    itemCount: items.length,
    tokenCount: items.reduce((total, item) => total + item.tokenCount, 0),
    groups,
    commands,
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function collectFiles(rootPath, maxDepth, predicate) {
  const files = [];

  async function visit(directoryPath, depth) {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    for (const entry of entries) {
      if (IGNORED_WORKSPACE_DIRECTORIES.has(entry.name.toLowerCase())) continue;

      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await visit(entryPath, depth + 1);
      } else if (entry.isFile() && predicate(entry.name, depth)) {
        files.push(entryPath);
      }
    }
  }

  await visit(rootPath, 0);
  return files;
}

async function readDescription(filePath) {
  return (await readContextItem(filePath)).description;
}

async function readContextItem(filePath) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return {
      path: filePath,
      title: path.basename(filePath),
      description: 'Unable to read file.',
      tokenCount: 0,
    };
  }

  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontmatterLines = frontmatter?.[1].split(/\r?\n/) ?? [];
  const name = frontmatterLines
    .find((line) => /^(?:name|title)\s*:/i.test(line))
    ?.replace(/^(?:name|title)\s*:\s*/i, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  const descriptionIndex = frontmatterLines.findIndex((line) => /^description\s*:/i.test(line));
  let description = '';

  if (descriptionIndex >= 0) {
    const value = frontmatterLines[descriptionIndex].replace(/^description\s*:\s*/i, '').trim();
    if (/^[>|][+-]?$/.test(value)) {
      const descriptionLines = [];
      for (const line of frontmatterLines.slice(descriptionIndex + 1)) {
        if (line.trim() && !/^\s/.test(line)) break;
        descriptionLines.push(line.trim());
      }
      description = descriptionLines.join(' ');
    } else {
      description = value.replace(/^(['"])(.*)\1$/, '$2');
    }
  }

  if (!description) {
    const body = frontmatter ? content.slice(frontmatter[0].length) : content;
    description = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'No description.';
  }

  return {
    path: filePath,
    title: name || path.basename(filePath),
    description: description.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim(),
    tokenCount: Math.ceil(content.length / 4),
  };
}
