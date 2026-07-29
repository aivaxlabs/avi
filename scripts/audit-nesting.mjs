import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

const [baselinePath, currentPath] = process.argv.slice(2);
if (!baselinePath || !currentPath) {
  throw new Error('Usage: bun scripts/audit-nesting.mjs <baseline.css> <current.css>');
}

function collect(css) {
  const sequence = [];

  const visit = (container, context = []) => {
    for (const node of container.nodes ?? []) {
      if (node.type === 'atrule') {
        const atRule = `@${node.name}${node.params ? ` ${node.params}` : ''}`;
        if (node.nodes) visit(node, [...context, atRule]);
        continue;
      }

      if (node.type !== 'rule') continue;
      const selectors = node.selector
        .split(',')
        .map((selector) => selector.trim().replace(/\s+/g, ' '));

      for (const declaration of node.nodes ?? []) {
        if (declaration.type !== 'decl') continue;
        const value = declaration.value.replace(/\s+/g, ' ');

        for (const selector of selectors) {
          sequence.push(
            `${context.join(' > ')}|${selector}|${declaration.prop}:${value}`
            + `${declaration.important ? '!important' : ''}`,
          );
        }
      }
    }
  };

  visit(postcss.parse(css));
  return sequence;
}

function count(sequence) {
  const counts = new Map();
  for (const entry of sequence) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return counts;
}

const baseline = collect(await readFile(baselinePath, 'utf8'));
const current = collect(await readFile(currentPath, 'utf8'));
const baselineCounts = count(baseline);
const currentCounts = count(current);
const missing = [];
const added = [];

for (const [entry, total] of baselineCounts) {
  const difference = total - (currentCounts.get(entry) ?? 0);
  if (difference > 0) missing.push({ entry, count: difference });
}

for (const [entry, total] of currentCounts) {
  const difference = total - (baselineCounts.get(entry) ?? 0);
  if (difference > 0) added.push({ entry, count: difference });
}

const sequenceDifferences = [];
for (let index = 0; index < Math.max(baseline.length, current.length); index += 1) {
  if (baseline[index] === current[index]) continue;
  sequenceDifferences.push({
    index,
    baseline: baseline[index],
    current: current[index],
  });
  if (sequenceDifferences.length === 20) break;
}

console.log(JSON.stringify({
  baselineEntries: baseline.length,
  currentEntries: current.length,
  missing,
  added,
  sequenceDifferences,
}, null, 2));
