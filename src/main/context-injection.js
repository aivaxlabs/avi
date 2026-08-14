import { readFileSync } from 'node:fs';
import { opendir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveTerminalShell } from './terminal-shell.js';
import {
  traceError,
  traceVerbose,
} from './trace-log.js';

const IGNORED_WORKSPACE_DIRECTORIES = new Set([
  '.git',
  '.vs',
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
const MAX_WORKSPACE_DIRECTORIES_PER_LEVEL = 15;
const MAX_WORKSPACE_FILES_PER_DIRECTORY = 5;
const MAX_WORKSPACE_DIRECTORIES = 60;
const TEXTUAL_WORKSPACE_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.conf', '.cpp', '.cs', '.csproj', '.css', '.csv', '.fs', '.fsproj',
  '.go', '.graphql', '.h', '.hpp', '.htm', '.html', '.ini', '.java', '.js', '.json',
  '.jsx', '.kt', '.kts', '.less', '.log', '.lua', '.md', '.mjs', '.php', '.props',
  '.ps1', '.py', '.rb', '.rs', '.sass', '.scss', '.sh', '.sln', '.sql', '.svg', '.swift',
  '.targets', '.toml', '.ts', '.tsx', '.txt', '.vb', '.vbproj', '.xml', '.xcss', '.yaml',
  '.yml',
]);
const MAX_CONTEXT_RECURSION_DEPTH = 6;
const CONTEXT_SCAN_TIMEOUT_MS = 5_000;
const CONTEXT_SCAN_CONCURRENCY = 32;
const CONTEXT_DIRECTORY_NAME = '.agents';
const baseInstructions = readFileSync(new URL('../prompts/base-instructions.md', import.meta.url), 'utf8');
const quickChatInstructions = readFileSync(new URL('../prompts/quick-chat-instructions.md', import.meta.url), 'utf8');
const candidPersonality = readFileSync(new URL('../prompts/personality/candid.md', import.meta.url), 'utf8');
const cynicalPersonality = readFileSync(new URL('../prompts/personality/cynical.md', import.meta.url), 'utf8');
const friendlyPersonality = readFileSync(new URL('../prompts/personality/friendly.md', import.meta.url), 'utf8');
const pragmaticPersonality = readFileSync(new URL('../prompts/personality/pragmatic.md', import.meta.url), 'utf8');
const quirkyPersonality = readFileSync(new URL('../prompts/personality/quirky.md', import.meta.url), 'utf8');

const INSTALLATION_CONTEXT_DIRECTORY_NAME = 'context';
const INSTRUCTION_FILE_PATTERN = /^(?:(?:AGENTS|MEMORY)(?:\.[^.]+)*|CLAUDE|GEMINI|.+\.INSTRUCTIONS|.+\.AGENTS)\.md$/i;
const POST_INSTRUCTION_CONTEXT_ORDER = [
  'memory',
  'mcp',
  'work-mode',
  'ultra',
  'goal',
  'tasks',
  'semaphores',
  'subagents',
  'current-thread',
  'environment',
];
const USER_CONTEXT_ORDER = [
  'threads',
  'workspace',
];

export const dynamicContextInjectors = new Map([
  ['memory', ({ aivax } = {}) => (
    aivax?.connected && aivax.memoryEnabled && aivax.memoryCollectionId
      ? [
          '## Memory',
          'Use the available memory tools to retrieve persistent user context, save durable knowledge, and delete obsolete memory files when useful.',
          'Always search memory before starting substantive work. Write only information that will remain useful beyond the current conversation.',
        ].join('\n')
      : ''
  )],
  ['personality', ({ tuning, pluginPersonalities = [] } = {}) => ({
    candid: candidPersonality,
    cynical: cynicalPersonality,
    friendly: friendlyPersonality,
    pragmatic: pragmaticPersonality,
    quirky: quirkyPersonality,
    ...Object.fromEntries(pluginPersonalities.map((personality) => [
      personality.id,
      personality.instructions,
    ])),
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
          'Do not edit files, mutate workspace data, create or interrupt ordinary conversations, call provider tools, call MCP tools, or take destructive actions. No permission level overrides these restrictions.',
          'You may run terminal commands strictly for read-only investigation (searching, listing, reading, git status/log/diff/show). Never run commands that install, build, write, delete, move, stage, commit, push, start servers, or otherwise change any state; the configured permission mode still applies to every command.',
          'You may orchestrate read-only Plan work: as the orchestrator, use chat_spawn_subagent for focused exploration, consolidation, research, and analysis when delegation improves coverage or speed. Give each sub-agent a self-contained task and expected evidence.',
          'Maintain active collaboration rather than waiting passively: inspect sub-agent threads, send useful follow-ups with chat_send_prompt, share relevant discoveries, and synthesize their evidence. Sub-agents may use chat_send_prompt to discuss findings directly with their parent and sibling sub-agents.',
          'Plan-mode conversation tools are limited to the current orchestration team and keep every prompted sub-agent in Plan mode. Prefer queue for normal coordination; use steer only for an urgent correction. Sub-agents cannot spawn nested sub-agents.',
          'Do not create agents merely to appear busy. Use them when their investigation, comparison, research, analysis, or consolidation has clear value to the plan.',
          'Investigate the repository and available read-only context before asking questions. Ask as many focused questions as necessary to eliminate every material ambiguity, but do not repeat questions or ask for facts that can be discovered from the repository.',
          'Do not present alternatives, unresolved decisions, or implementation work. Refine the plan until no material detail is left open to interpretation.',
          'When and only when the plan is complete, emit exactly one non-empty <execution-plan>...</execution-plan> block. The block must detail the objective, affected files, specific changes, public contracts, confirmed decisions and their rationale, accepted trade-offs, execution sequence, risks, validations, how each validation will be performed, and measurable success criteria. The completed block is automatically written to .agents/plannings/<timestamp>/<conversation-title>.md in the current workspace.',
          'Do not emit an <execution-plan> block while questions remain unanswered. Outside the final block, keep any necessary communication concise.',
          '</work_mode>',
        ].join('\n')
      : ''
  )],
  ['ultra', ({ ultraMode, orchestrationRole } = {}) => (
    ultraMode && orchestrationRole === 'orchestrator'
      ? [
          '<work_mode mode="ultra" role="orchestrator">',
          'You are the orchestrator in Ultra mode. The user deliberately selected Ultra for complex work that warrants exceptional rigor. You must run a model-driven production, independent critique, correction, and fresh validation loop, and take responsibility for the integrated result.',
          'Before acting, establish the real objective, material constraints, explicit and indispensable acceptance criteria, unknowns, likely failure boundaries, immediate consequences of the delivery, and the evidence that would demonstrate completion. Investigate available context before committing to an approach or asking the user.',
          'Do not limit the result to the literal wording of the request when directly affected dependencies or consequences are necessary for a complete working delivery, but do not expand speculatively.',
          'Perform adjacent work only when evidence shows that it is necessary to satisfy an acceptance criterion, necessary for the requested result to function in its established environment, required to correct a material defect or regression introduced by the current work or directly blocking its acceptance criteria, the smallest direct protection against a concrete, reproducible failure introduced by the current work, or required to resolve an immediate, observable consequence that would otherwise leave the delivery incomplete, broken, or in need of obvious corrective work.',
          'For every expansion, identify the criterion, dependency, failure, or observed consequence that justifies it, and choose the smallest coherent change within the authority already granted. Do not invent requirements, integrations, users, risks, infrastructure, or future needs to justify more work.',
          'If additional work requires a product decision, new public contract, dependency, deployment, external mutation, destructive action, or broader authority, ask the user. If it is useful but not necessary for completion, report it as an optional recommendation instead of implementing it.',
          'Assemble a focused team early with chat_spawn_subagent. Assign distinct investigation, production, testing, and review responsibilities when they improve coverage, independence, or speed; use parallel or competing approaches when material uncertainty justifies them.',
          'Give every sub-agent a self-contained prompt with its role, objective, acceptance criteria, relevant context, file or system scope, available tools and permissions, dependencies, expected evidence, and concise reporting format.',
          'Maintain active coordination. Track the listed sub-agents, inspect their threads when needed, send follow-up instructions with chat_send_prompt, respond to blockers, and share discoveries that materially affect other assignments.',
          'Avoid orchestration thrashing. When multiple delegated results are expected, gather relevant completed reports when practical, do not repeatedly revise the solution or announce completion after each individual report, and reconcile conflicts before choosing the next action. Do not finalize while relevant delegated work is still expected.',
          'Produce a candidate that addresses the acceptance criteria and direct consequences, then record what changed, which evidence supports it, what was actually validated, and what remains uncertain.',
          'Commission independent critics or reviewers to challenge the current candidate. A sub-agent that produced or corrected a candidate must not be the independent final reviewer of that same candidate.',
          'Give reviewers the original objective and criteria, the latest candidate or diff, relevant context, and actual validation evidence. Ask them to seek counterexamples, regressions, unsupported claims, missing coverage, and scope violations rather than confirm the preferred answer.',
          'Require material findings to identify the affected criterion or concrete risk, reproducible evidence, impact, and a proportionate correction. Distinguish material defects from preferences, stylistic opinions, speculative concerns, duplicate findings, and claims unsupported by evidence.',
          'Treat sub-agent reports as evidence, not authority. Check that conclusions apply to the latest candidate and actual criteria, resolve contradictions explicitly, and remember that absence of reported findings is not proof of correctness.',
          'When critique identifies a material defect, correct it and validate the corrected candidate after the last relevant change. Do not rely on review or validation performed before that correction.',
          'Do not conclude before independent critique has challenged the latest relevant candidate, material findings have been judged and addressed, and fresh validation covers the result after the last relevant correction.',
          'Continue the loop while new evidence reveals a material defect, a relevant criterion lacks adequate evidence, specialists expose a material contradiction, or a concrete in-scope action has a clear chance of changing the outcome. Do not reopen resolved findings or repeat equivalent reviews without new evidence.',
          'There is no predetermined number of agents or rounds. Agent count, repeated activity, and elapsed effort are not evidence of quality. Stop only when the criteria and direct consequences are supported by proportionate evidence, material findings are resolved or honestly reported as blockers, the latest candidate has been validated, and further work would only repeat existing evidence without a concrete path to improve the outcome.',
          'Report a blocker only for a concrete condition that prevents safe in-scope progress after available paths have been investigated. Difficulty, duration, disagreement of preference, or an unsuccessful first attempt are not blockers.',
          'Ultra mode may operate together with an active Goal. When it does, the Goal specification and completion rules remain authoritative.',
          'Ultra mode is incompatible with Plan mode. Do not attempt to enter or simulate Plan mode while Ultra is active.',
          'Conclude with a concise account of what was completed, which necessary direct consequences were handled and why, the evidence and validation actually obtained, and every remaining blocker or unverified limitation. Never claim that a review, test, command, build, or validation succeeded unless it actually did. Do not expose private chain-of-thought from yourself or the team.',
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
  ['semaphores', ({ semaphoreHoldings = [] } = {}) => (
    Array.isArray(semaphoreHoldings) && semaphoreHoldings.length > 0
      ? [
          '<semaphore_locks>',
          'This thread currently owns the following Avi semaphore permits. Treat each permit as an active coordination lock: perform only the protected work authorized by the semaphore, do not assume another thread can enter the protected section, and call release_semaphore with the exact name and count as soon as that work is complete. Release permits before waiting on unrelated work, reporting a blocker, or ending the task. Never release permits owned by another thread.',
          ...semaphoreHoldings.map((holding) => (
            `<semaphore name="${escapeXml(holding.name)}" count="${holding.count}" max_count="${holding.maxCount}" />`
          )),
          '</semaphore_locks>',
        ].join('\n')
      : ''
  )],
  ['tasks', ({ tasks = [] } = {}) => (
    Array.isArray(tasks) && tasks.length > 0
      ? [
          '<thread_tasks>',
          'This is the persistent task list for the current thread. Keep it accurate with update_tasks when progress changes. Tasks do not replace Goal status or its acceptance criteria.',
          ...tasks.flatMap((task, index) => [
            `<task index="${index + 1}" done="${Boolean(task.done)}">`,
            `<title>${escapeXml(task.title)}</title>`,
            task.description ? `<description>${escapeXml(task.description)}</description>` : '',
            task.result ? `<result>${escapeXml(task.result)}</result>` : '',
            '</task>',
          ]).filter(Boolean),
          '</thread_tasks>',
        ].join('\n')
      : ''
  )],
  ['subagents', ({ subagents = [] } = {}) => (
    Array.isArray(subagents) && subagents.length > 0
      ? [
          '<subagents>',
          'Sub-agent names are display labels only. Always target and correlate orchestration actions by thread_id; use names only when referring to agents conversationally.',
          ...subagents.flatMap((subagent) => [
            `<subagent thread_id="${escapeXml(subagent.threadId)}" name="${escapeXml(subagent.name)}" status="${escapeXml(subagent.status)}">`,
            `<initial_prompt>${escapeXml(
              String(subagent.initialPrompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 256),
            )}</initial_prompt>`,
            '</subagent>',
          ]),
          '</subagents>',
        ].join('\n')
      : ''
  )],
  ['current-thread', ({ currentThread } = {}) => (
    currentThread?.threadId && currentThread?.role
      ? [
          `<current_thread id="${escapeXml(currentThread.threadId)}" role="${escapeXml(currentThread.role)}"${currentThread.parentThreadId ? ` parent_thread_id="${escapeXml(currentThread.parentThreadId)}"` : ''}>`,
          'This identifies the current conversation. The thread directory lists visible conversations, including their roles, relationships, and initial prompts.',
          currentThread.role === 'side_chat'
            ? 'As a side chat, you can see your orchestrator and its sub-agents. Other conversation types cannot discover side chats.'
            : 'Side chats are private and are intentionally absent from your thread directory.',
          '</current_thread>',
        ].join('\n')
      : ''
  )],
  ['threads', ({ threads = [] } = {}) => (
    Array.isArray(threads) && threads.length > 0
      ? [
          '<thread_directory>',
          ...threads.flatMap((thread) => {
            const initialPrompt = String(thread.initialPrompt ?? '').replace(/\s+/g, ' ').trim();
            return [
              `<thread id="${escapeXml(thread.threadId)}" role="${escapeXml(thread.role)}"${thread.parentThreadId ? ` parent_thread_id="${escapeXml(thread.parentThreadId)}"` : ''}>`,
              `<initial_prompt>${escapeXml(
                initialPrompt.length > 256
                  ? `${initialPrompt.slice(0, 256)}...`
                  : initialPrompt,
              )}</initial_prompt>`,
              '</thread>',
            ];
          }),
          '</thread_directory>',
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
    if (isHomeDirectory(currentDirectory)) {
      return [
        '<current_workspace>',
        `Current directory: ${escapeXml(currentDirectory)}`,
        'The home directory is not scanned as a workspace. Global context is loaded only from $HOME/.agents.',
        '</current_workspace>',
      ].join('\n');
    }
    const structure = [];
    let directoryCount = 0;

    async function appendDirectory(directoryPath, depth, ancestorDirectories) {
      let entries;
      let directoryKey;
      try {
        directoryKey = normalizePathKey(await realpath(directoryPath));
        if (ancestorDirectories.has(directoryKey)) {
          structure.push(`${'\t'.repeat(depth)}...`);
          return;
        }
        entries = await readdir(directoryPath, { withFileTypes: true });
      } catch {
        structure.push(`${'\t'.repeat(depth)}...`);
        return;
      }

      const nextAncestorDirectories = new Set(ancestorDirectories).add(directoryKey);
      const filteredEntries = await Promise.all(entries
        .filter((entry) => !IGNORED_WORKSPACE_DIRECTORIES.has(entry.name.toLowerCase()))
        .map(async (entry) => {
          if (!entry.isSymbolicLink()) return { entry, isDirectory: entry.isDirectory() };
          try {
            return { entry, isDirectory: (await stat(path.join(directoryPath, entry.name))).isDirectory() };
          } catch {
            return { entry, isDirectory: false };
          }
        }));
      const files = filteredEntries
        .filter(({ isDirectory }) => !isDirectory)
        .sort((left, right) => {
          const leftExtension = path.extname(left.entry.name).toLowerCase();
          const rightExtension = path.extname(right.entry.name).toLowerCase();
          const leftIsTextual = !leftExtension || TEXTUAL_WORKSPACE_FILE_EXTENSIONS.has(leftExtension);
          const rightIsTextual = !rightExtension || TEXTUAL_WORKSPACE_FILE_EXTENSIONS.has(rightExtension);
          return Number(!leftIsTextual) - Number(!rightIsTextual)
            || left.entry.name.localeCompare(right.entry.name, undefined, { numeric: true });
        });
      const directories = filteredEntries
        .filter(({ isDirectory }) => isDirectory)
        .sort((left, right) => left.entry.name.localeCompare(
          right.entry.name,
          undefined,
          { numeric: true },
        ));
      const visibleFiles = files.slice(0, MAX_WORKSPACE_FILES_PER_DIRECTORY);
      const visibleDirectories = directories.slice(0, MAX_WORKSPACE_DIRECTORIES_PER_LEVEL);
      let truncated = files.length > visibleFiles.length
        || directories.length > visibleDirectories.length;

      for (const { entry } of visibleFiles) {
        structure.push(`${'\t'.repeat(depth)}${escapeXml(entry.name)}`);
      }

      for (const { entry } of visibleDirectories) {
        if (directoryCount >= MAX_WORKSPACE_DIRECTORIES) {
          truncated = true;
          continue;
        }

        directoryCount += 1;
        structure.push(`${'\t'.repeat(depth)}${escapeXml(entry.name)}/`);
        await appendDirectory(
          path.join(directoryPath, entry.name),
          depth + 1,
          nextAncestorDirectories,
        );
      }

      if (truncated) {
        structure.push(`${'\t'.repeat(depth)}...`);
      }
    }

    await appendDirectory(currentDirectory, 0, new Set());

    return [
      '<current_workspace>',
      `Current directory: ${escapeXml(currentDirectory)}`,
      'When mentioning an existing workspace file, use <fileref path="./path" />, <fileref path="./path" line-from="12" />, or <fileref path="./path" line-from="12" line-to="52" /> so the user can open it from the chat. Paths may contain spaces. Keep file references outside backticks and Markdown code blocks.',
      'Directory structure:',
      ...structure,
      '</current_workspace>',
    ].join('\n');
  }],
  ['instructions', async ({ workspacePath, installationContextPath, pluginContextRoots = [] } = {}) => {
    const startedAt = Date.now();
    traceVerbose('context.injection-discovery-started', {
      operation: 'resolve-instructions',
    });
    const roots = [
      {
        id: 'installation',
        label: '$AVI/context',
        path: path.resolve(installationContextPath || resolveInstallationContextPath()),
        includeRootCatalog: true,
      },
      ...pluginContextRoots.map((plugin) => ({
        id: `plugin:${plugin.id}`,
        label: `$INSTALL_DIR/plugins/${plugin.id}`,
        path: path.resolve(plugin.path),
        includeRootCatalog: true,
      })),
      {
        id: 'global',
        label: '$HOME/.agents',
        path: path.join(homedir(), CONTEXT_DIRECTORY_NAME),
      },
      {
        id: 'workspace',
        label: '$PWD',
        path: path.resolve(workspacePath || process.cwd()),
      },
    ].filter((root, index, items) => (
      !(root.id === 'workspace' && isHomeDirectory(root.path))
      && items.findIndex((item) => normalizePathKey(item.path) === normalizePathKey(root.path)) === index
    ));
    const instructionContexts = new Map();
    const contextSections = [];

    for (const root of roots) {
      const rootStartedAt = Date.now();
      const scan = await scanContextFiles(root.path, {
        includeRootCatalog: root.includeRootCatalog,
      });
      const { instructionFiles, skillFiles, workflowFiles } = scan;
      const rootInstructionDirectories = new Set([root.path.toLowerCase()]);
      const rootContextFiles = instructionFiles.filter((filePath) => (
        rootInstructionDirectories.has(path.dirname(filePath).toLowerCase())
      ));
      const nestedContextFiles = instructionFiles.filter((filePath) => (
        !rootInstructionDirectories.has(path.dirname(filePath).toLowerCase())
      ));
      const rootFiles = (await Promise.all(rootContextFiles.map(async (filePath) => {
        try {
          return {
            name: path.relative(root.path, filePath).replaceAll('\\', '/'),
            content: await readFile(filePath, 'utf8'),
            metadata: await readContextItem(filePath),
          };
        } catch {
          return null;
        }
      }))).filter(Boolean);
      const displayPath = (filePath) => {
        const relativePath = path.relative(root.path, filePath).replaceAll('\\', '/');
        return root.id === 'workspace'
          ? relativePath
          : `${root.label}/${relativePath}`;
      };
      const skillLines = await Promise.all(skillFiles.map(async (filePath) => (
        `- ${escapeXml(displayPath(filePath))}`
        + ` ${'\u2014'} ${escapeXml(await readDescription(filePath))}`
      )));
      const workflowLines = await Promise.all(workflowFiles.map(async (filePath) => (
        `- ${escapeXml(displayPath(filePath))}`
        + ` ${'\u2014'} ${escapeXml(await readDescription(filePath))}`
      )));
      const nestedContextLines = await Promise.all(nestedContextFiles.map(async (filePath) => (
        `- ${escapeXml(displayPath(filePath))}`
        + ` ${'\u2014'} ${escapeXml(await readDescription(filePath))}`
      )));
      const availableInstructionLines = rootFiles
        .filter((file) => !file.metadata.embeddable)
        .map((file) => (
          `- ${escapeXml(displayPath(file.metadata.path))}`
          + ` ${'\u2014'} ${escapeXml(file.metadata.description)}`
        ));

      const instructionSections = [];
      for (const file of rootFiles.filter((item) => item.metadata.embeddable)) {
        instructionSections.push(
          `--- BEGIN ${file.name} ---`,
          file.content,
          `--- END ${file.name} ---`,
        );
      }
      if (nestedContextLines.length > 0) {
        instructionSections.push(
          'Recursive instruction files:',
          ...nestedContextLines,
        );
      }
      if (instructionSections.length > 0) {
        const instructionTag = root.id.startsWith('plugin:')
          ? 'plugin_instructions'
          : `${root.id}_instructions`;
        instructionContexts.set(root.id, [
          `<${instructionTag}>`,
          `Source: ${root.label}`,
          `Root: ${escapeXml(root.path)}`,
          ...instructionSections,
          `</${instructionTag}>`,
        ].join('\n'));
      }

      const catalogSections = [];
      if (availableInstructionLines.length > 0) {
        catalogSections.push('Instructions:', ...availableInstructionLines);
      }
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
      traceVerbose('context.injection-source-completed', {
        operation: 'resolve-instructions',
        scope: root.id,
        duration_ms: Date.now() - rootStartedAt,
        instruction_count: instructionFiles.length,
        skill_count: skillFiles.length,
        workflow_count: workflowFiles.length,
        directory_count: scan.directoryCount,
        timed_out: scan.timedOut,
      });
    }

    traceVerbose('context.injection-discovery-completed', {
      operation: 'resolve-instructions',
      duration_ms: Date.now() - startedAt,
    });
    return [
      ...roots.map((root) => instructionContexts.get(root.id) ?? ''),
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

export async function resolveDynamicUserContext(invocationContext = {}) {
  if (invocationContext.quickChat || invocationContext.auxiliary) return '';

  const contexts = await Promise.all(USER_CONTEXT_ORDER.map((name) => (
    dynamicContextInjectors.get(name)?.(invocationContext)
  )));
  return contexts
    .map((context) => String(context ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export async function resolveDynamicContext(invocationContext = {}) {
  if (invocationContext.auxiliary) return '';
  if (invocationContext.quickChat) {
    return [
      quickChatInstructions,
      dynamicContextInjectors.get('memory')?.(invocationContext),
      dynamicContextInjectors.get('mcp')?.(invocationContext),
      dynamicContextInjectors.get('environment')?.(invocationContext),
    ]
      .map((context) => String(context ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
  }

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

export function resolveInstallationContextPath(
  executablePath = process.execPath,
  platform = process.platform,
) {
  if (executablePath === process.execPath && process.resourcesPath) {
    return path.join(process.resourcesPath, INSTALLATION_CONTEXT_DIRECTORY_NAME);
  }
  const executableDirectory = path.dirname(path.resolve(executablePath));
  return path.join(
    path.resolve(executableDirectory, '..', 'Resources'),
    'app',
    INSTALLATION_CONTEXT_DIRECTORY_NAME,
  );
}

export async function listContextItems(
  rootPath,
  { includeRootCatalog = false, scope: requestedScope = null } = {},
) {
  const startedAt = Date.now();
  const scope = requestedScope || (includeRootCatalog ? 'installation' : 'folder');
  traceVerbose('context.discovery-started', {
    operation: 'list-context-items',
    scope,
  });

  try {
    const root = path.resolve(rootPath);
    const scan = !includeRootCatalog && isHomeDirectory(root)
      ? {
          instructionFiles: [],
          skillFiles: [],
          workflowFiles: [],
          directoryCount: 0,
          timedOut: false,
        }
      : await scanContextFiles(root, { includeRootCatalog });
    const { instructionFiles, skillFiles, workflowFiles } = scan;
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
        folderPath: root,
        files: skillFiles,
      },
      {
        id: 'workflow',
        title: 'Workflows',
        folderPath: root,
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
        if (item.userInvocable === false) continue;

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

    const result = {
      itemCount: items.length,
      tokenCount: items.reduce((total, item) => total + item.tokenCount, 0),
      groups,
      commands,
    };
    traceVerbose('context.discovery-completed', {
      operation: 'list-context-items',
      scope,
      duration_ms: Date.now() - startedAt,
      item_count: result.itemCount,
      instruction_count: instructionFiles.length,
      skill_count: skillFiles.length,
      workflow_count: workflowFiles.length,
      directory_count: scan.directoryCount,
      timed_out: scan.timedOut,
    });
    return result;

  } catch (error) {
    traceError('context.discovery-error', {
      operation: 'list-context-items',
      scope,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function scanContextFiles(rootPath, { includeRootCatalog = false } = {}) {
  const root = path.resolve(rootPath);
  const instructionFiles = [];
  const skillFiles = [];
  const workflowFiles = [];
  const seenDirectories = new Set();
  const waitingTasks = [];
  const deadline = Date.now() + CONTEXT_SCAN_TIMEOUT_MS;
  let activeTasks = 0;
  let timedOut = false;
  let directoryCount = 0;

  const visit = async (directoryPath, contextRoot = null, depth = 0) => {
    if (Date.now() >= deadline) {
      timedOut = true;
      return;
    }

    const effectiveContextRoot = contextRoot
      ?? (path.basename(directoryPath).toLowerCase() === CONTEXT_DIRECTORY_NAME
        ? directoryPath
        : null);
    let directoryKey;
    try {
      directoryKey = [
        normalizePathKey(await realpath(directoryPath)),
        effectiveContextRoot ? normalizePathKey(effectiveContextRoot) : '',
      ].join('|');
    } catch {
      return;
    }
    if (seenDirectories.has(directoryKey)) return;
    seenDirectories.add(directoryKey);
    directoryCount += 1;
    if (activeTasks >= CONTEXT_SCAN_CONCURRENCY) {
      await new Promise((resolve) => waitingTasks.push(resolve));
    }

    activeTasks += 1;
    const childDirectories = [];

    try {
      if (Date.now() >= deadline) {
        timedOut = true;
        return;
      }

      const handle = await opendir(directoryPath);
      for await (const entry of handle) {
        if (Date.now() >= deadline) {
          timedOut = true;
          break;
        }

        const normalizedName = entry.name.toLowerCase();
        if (IGNORED_WORKSPACE_DIRECTORIES.has(normalizedName)) continue;

        const entryPath = path.join(directoryPath, entry.name);
        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            const target = await stat(entryPath);
            isDirectory = target.isDirectory();
            isFile = target.isFile();
          } catch {
            continue;
          }
        }
        if (isDirectory) {
          childDirectories.push({
            path: entryPath,
            contextRoot: effectiveContextRoot
              ?? (normalizedName === CONTEXT_DIRECTORY_NAME ? entryPath : null),
          });
          continue;
        }
        if (!isFile) continue;

        if (INSTRUCTION_FILE_PATTERN.test(entry.name)) instructionFiles.push(entryPath);
        if (!effectiveContextRoot) continue;

        const relativeParts = path.relative(effectiveContextRoot, entryPath).split(path.sep);
        const catalogName = relativeParts[0]?.toLowerCase();
        const catalogDepth = relativeParts.length - 2;
        if (catalogDepth < 0 || catalogDepth > MAX_CONTEXT_RECURSION_DEPTH) continue;
        if (catalogName === 'skills' && normalizedName === 'skill.md') skillFiles.push(entryPath);
        if (catalogName === 'workflows') workflowFiles.push(entryPath);
      }
    } catch {
      return;
    } finally {
      activeTasks -= 1;
      waitingTasks.shift()?.();
    }

    if (depth >= MAX_CONTEXT_RECURSION_DEPTH) return;
    await Promise.all(childDirectories.map((child) => visit(child.path, child.contextRoot, depth + 1)));
  };

  await visit(root, includeRootCatalog ? root : null);

  const sortPaths = (paths) => uniqueFiles(paths).sort((left, right) => (
    left.localeCompare(right, undefined, { numeric: true })
  ));
  return {
    instructionFiles: sortPaths(instructionFiles),
    skillFiles: sortPaths(skillFiles),
    workflowFiles: sortPaths(workflowFiles),
    directoryCount,
    timedOut,
  };
}

function normalizePathKey(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function isHomeDirectory(directoryPath) {
  return normalizePathKey(directoryPath) === normalizePathKey(homedir());
}

function uniqueFiles(files) {
  const paths = new Set();
  return files.filter((filePath) => {
    const key = filePath.toLowerCase();
    if (paths.has(key)) return false;
    paths.add(key);
    return true;
  });
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
      embeddable: true,
      userInvocable: true,
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
  const embeddable = !frontmatterLines.some((line) => (
    /^embeddable\s*:\s*false(?:\s+#.*)?\s*$/i.test(line)
  ));
  const userInvocable = !frontmatterLines.some((line) => (
    /^user-invocable\s*:\s*false(?:\s+#.*)?\s*$/i.test(line)
  ));
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
    embeddable,
    userInvocable,
    tokenCount: Math.ceil(content.length / 4),
  };
}
