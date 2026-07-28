import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

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
const ROOT_CONTEXT_FILES = ['AGENTS.md', 'MEMORY.md'];

export const dynamicContextInjectors = new Map([
  ['environment', () => {
    const operatingSystem = {
      win32: 'Windows',
      darwin: 'macOS',
      linux: 'Linux',
    }[process.platform] ?? process.platform;
    const shellPath = process.env.SHELL ?? process.env.ComSpec ?? process.env.COMSPEC;
    const shell = process.env.MSYSTEM && shellPath?.toLowerCase().includes('bash')
      ? 'Git Bash'
      : shellPath
        ? path.basename(shellPath)
        : 'Unknown';

    return [
      '<environment_info>',
      `User current OS: ${operatingSystem}`,
      `User current shell: ${shell}`,
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
      'Directory structure:',
      ...structure,
      '</current_workspace>',
    ].join('\n');
  }],
  ['instructions', async ({ workspacePath } = {}) => {
    const roots = [
      { label: 'workspace', path: path.resolve(workspacePath || process.cwd()) },
      { label: '$HOME/.agents', path: path.join(homedir(), '.agents') },
    ].filter((root, index, items) => (
      items.findIndex((item) => item.path.toLowerCase() === root.path.toLowerCase()) === index
    ));
    const sections = [];

    for (const root of roots) {
      const rootFiles = (
        await Promise.all(ROOT_CONTEXT_FILES.map(async (fileName) => {
          try {
            return {
              name: fileName,
              content: await readFile(path.join(root.path, fileName), 'utf8'),
            };
          } catch {
            return null;
          }
        }))
      ).filter(Boolean);
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
          depth > 0 && ROOT_CONTEXT_FILES.some(
            (contextFile) => contextFile.toLowerCase() === fileName.toLowerCase(),
          )
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

      if (
        rootFiles.length === 0
        && skillLines.length === 0
        && workflowLines.length === 0
        && nestedContextLines.length === 0
      ) {
        continue;
      }

      sections.push(
        `Source: ${root.label}`,
        `Root: ${escapeXml(root.path)}`,
      );
      for (const file of rootFiles) {
        sections.push(
          `--- BEGIN ${file.name} ---`,
          file.content,
          `--- END ${file.name} ---`,
        );
      }
      if (skillLines.length > 0) {
        sections.push('Skills:', ...skillLines);
      }
      if (workflowLines.length > 0) {
        sections.push('Workflows:', ...workflowLines);
      }
      if (nestedContextLines.length > 0) {
        sections.push('Nested AGENTS.md and MEMORY.md:', ...nestedContextLines);
      }
      sections.push('');
    }

    if (sections.length === 0) return '';
    return [
      '<available_context>',
      ...sections,
      '</available_context>',
    ].join('\n');
  }],
]);

export async function resolveDynamicContext(invocationContext = {}) {
  const instructionsInjector = dynamicContextInjectors.get('instructions');
  const contexts = await Promise.all([
    instructionsInjector?.(invocationContext),
    ...[...dynamicContextInjectors.entries()]
      .filter(([name]) => name !== 'instructions')
      .map(([, injector]) => injector(invocationContext)),
  ]);

  return contexts
    .map((context) => String(context ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
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
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return 'Unable to read file.';
  }

  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontmatterLines = frontmatter?.[1].split(/\r?\n/) ?? [];
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

  return description.replace(/\s+/g, ' ').trim();
}
