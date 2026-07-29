import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';

const stylesDirectory = path.resolve('src/styles');
const write = process.argv.includes('--write');
const hierarchy = process.argv.includes('--hierarchy');
const files = [];
const directories = [stylesDirectory];

while (directories.length > 0) {
  const directory = directories.pop();
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      directories.push(entryPath);
    } else if (entry.name.endsWith('.xcss')) {
      files.push(entryPath);
    }
  }
}

function getRelativeSelector(anchor, selector) {
  if (!selector.startsWith(anchor) || selector === anchor) return null;
  const suffix = selector.slice(anchor.length);

  if (/^\s/.test(suffix)) return suffix.trimStart();
  if (/^[.:[>+~]/.test(suffix)) return `&${suffix}`;
  return null;
}

function nestContainer(container, stats) {
  for (let index = 0; index < (container.nodes?.length ?? 0); index += 1) {
    const anchor = container.nodes[index];

    if (anchor.type === 'atrule') {
      nestContainer(anchor, stats);
      continue;
    }

    if (anchor.type !== 'rule' || anchor.selector.includes(',')) continue;

    for (
      let candidateIndex = index + 1;
      candidateIndex < container.nodes.length;
    ) {
      const candidate = container.nodes[candidateIndex];
      if (candidate.type !== 'rule') break;

      const relativeSelectors = candidate.selectors.map(
        (selector) => getRelativeSelector(anchor.selector, selector),
      );
      if (relativeSelectors.some((selector) => selector === null)) break;

      candidate.selector = relativeSelectors.join(', ');
      candidate.remove();
      anchor.append(candidate);
      stats.movedRules += 1;
    }

    nestContainer(anchor, stats);
  }
}

function wrapHierarchy(root, filename, stats) {
  const configurations = {
    'chat.xcss': {
      anchor: '.chat-area',
      include: (selector) => !selector.includes('.dialog-header')
        && !selector.startsWith('.platform-'),
    },
    'code-block.xcss': {
      anchor: '.code-block',
      include: (selector) => !selector.includes('.markdown-body'),
    },
    'command-picker.xcss': {
      anchor: '.command-picker',
      include: () => true,
    },
    'composer.xcss': {
      anchor: '.composer-wrap',
      include: (selector) => !selector.startsWith('.chat-empty')
        && !selector.includes('.queued-message-actions-menu'),
    },
    'markdown.xcss': {
      anchor: '.markdown-body',
      include: () => true,
    },
    'model-picker.xcss': {
      anchor: '.model-dialog',
      include: () => true,
    },
    'project-picker.xcss': {
      anchor: '.project-picker-row',
      include: () => true,
    },
    'recording.xcss': {
      anchor: '.recording-bar',
      include: () => true,
    },
    'settings.xcss': {
      anchor: '.settings-page',
      include: (selector) => !selector.includes('.settings-action-menu')
        && !selector.includes('.settings-row-menu'),
    },
    'sidebar.xcss': {
      anchor: '.sidebar',
      include: (selector) => !selector.startsWith('.sidebar-collapsed'),
    },
  };
  const configuration = configurations[filename];
  if (!configuration) return;

  let anchor = root.nodes.find(
    (node) => node.type === 'rule' && node.selector === configuration.anchor,
  );

  if (!anchor) {
    anchor = postcss.rule({ selector: configuration.anchor });
    root.prepend(anchor);
  }

  for (const node of [...root.nodes]) {
    if (node === anchor || node.type !== 'rule') continue;
    if (!node.selectors.every(configuration.include)) continue;

    node.selector = node.selectors
      .map((selector) => getRelativeSelector(configuration.anchor, selector) ?? selector)
      .join(', ');
    node.remove();
    anchor.append(node);
    stats.hierarchyRules += 1;
  }
}

function serializeDeclaration(declaration, level) {
  const indentation = '  '.repeat(level);
  const valueLines = declaration.value.split(/\r?\n/);
  const important = declaration.important ? ' !important' : '';

  if (valueLines.length === 1) {
    return `${indentation}${declaration.prop}: ${valueLines[0].trim()}${important};`;
  }

  return [
    `${indentation}${declaration.prop}: ${valueLines[0].trim()}`,
    ...valueLines.slice(1).map((line) => `${indentation}  ${line.trim()}`),
  ].join('\n') + `${important};`;
}

function serializeNode(node, level) {
  const indentation = '  '.repeat(level);

  if (node.type === 'decl') return serializeDeclaration(node, level);
  if (node.type === 'comment') return `${indentation}/*${node.text}*/`;

  if (node.type === 'rule') {
    return `${indentation}${node.selector} {\n`
      + `${serializeContainer(node, level + 1)}\n${indentation}}`;
  }

  if (node.type === 'atrule') {
    const suffix = node.params ? ` ${node.params}` : '';
    if (!node.nodes) return `${indentation}@${node.name}${suffix};`;
    return `${indentation}@${node.name}${suffix} {\n`
      + `${serializeContainer(node, level + 1)}\n${indentation}}`;
  }

  return `${indentation}${node.toString()}`;
}

function serializeContainer(container, level) {
  const output = [];

  for (const node of container.nodes ?? []) {
    const serialized = serializeNode(node, level);
    const block = node.type === 'rule' || (node.type === 'atrule' && node.nodes);
    const previous = container.nodes[container.nodes.indexOf(node) - 1];
    const previousBlock = previous
      && (previous.type === 'rule' || (previous.type === 'atrule' && previous.nodes));

    if (output.length > 0 && (block || previousBlock)) output.push('');
    output.push(serialized);
  }

  return output.join('\n');
}

const results = [];

for (const file of files.sort()) {
  const source = await readFile(file, 'utf8');
  const root = postcss.parse(source, { from: file });
  const stats = { movedRules: 0, hierarchyRules: 0 };
  nestContainer(root, stats);
  if (hierarchy) {
    wrapHierarchy(root, path.basename(file), stats);
    nestContainer(root, stats);
  }
  const output = `${serializeContainer(root, 0)}\n`;

  if (write) await writeFile(file, output);
  results.push({
    file: path.relative(stylesDirectory, file),
    movedRules: stats.movedRules,
    hierarchyRules: stats.hierarchyRules,
    beforeLines: source.split(/\r?\n/).length,
    afterLines: output.split(/\r?\n/).length,
  });

  if (path.basename(file) === 'dropdown-menu.xcss' && !write) {
    console.log(output);
  }
}

console.table(results);
