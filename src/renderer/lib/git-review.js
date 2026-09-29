export function buildGitTree(files) {
  const root = { path: '.', name: 'Changes', directory: true, count: files.length, children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    let parent = root;
    for (let index = 0; index < parts.length; index += 1) {
      const path = parts.slice(0, index + 1).join('/');
      if (!parent.children.has(parts[index])) parent.children.set(parts[index], index === parts.length - 1
        ? { ...file, name: parts[index], directory: false }
        : { path, name: parts[index], directory: true, count: 0, children: new Map() });
      parent = parent.children.get(parts[index]);
      if (parent.directory) parent.count += 1;
    }
  }
  return root;
}

export function flattenGitTree(node, collapsed, depth = 0, rows = []) {
  rows.push({ node, depth });
  if (node.directory && !(collapsed.get(node.path) ?? (node.path !== '.' && node.count > 100))) {
    for (const child of [...node.children.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      flattenGitTree(child, collapsed, depth + 1, rows);
    }
  }
  return rows;
}

export function buildGitDiff(file) {
  const content = file.content.split('\n');
  if (content.at(-1) === '') content.pop();
  const rows = [];
  const lines = file.diff.split('\n');
  let oldLine = 1;
  let newLine = 1;
  let inHunk = false;
  let remainingOld = 0;
  let remainingNew = 0;
  for (const line of lines) {
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      const start = Math.max(1, Number(hunk[3]));
      if (start > newLine) rows.push({ type: 'gap', oldLine, newLine, count: start - newLine, key: `gap-${newLine}` });
      oldLine = Math.max(1, Number(hunk[1]));
      newLine = start;
      remainingOld = hunk[2] === undefined ? 1 : Number(hunk[2]);
      remainingNew = hunk[4] === undefined ? 1 : Number(hunk[4]);
      inHunk = true;
      continue;
    }
    if (!inHunk || (!remainingOld && !remainingNew) || line.startsWith('\\')) continue;
    const type = line[0] === '+' ? 'added' : line[0] === '-' ? 'deleted' : 'context';
    if (!['+', '-', ' '].includes(line[0])) continue;
    rows.push({ type, text: line.slice(1), oldLine: type === 'added' ? null : oldLine, newLine: type === 'deleted' ? null : newLine, key: `${oldLine}-${newLine}-${type}` });
    if (type !== 'added') { oldLine += 1; remainingOld -= 1; }
    if (type !== 'deleted') { newLine += 1; remainingNew -= 1; }
  }
  if (newLine <= content.length) rows.push({ type: 'gap', oldLine, newLine, count: content.length - newLine + 1, key: `gap-${newLine}` });
  return { rows, content };
}

export function expandGitDiff(model, expanded) {
  return model.rows.flatMap((row) => {
    if (row.type !== 'gap') return [row];
    const amount = expanded[row.key] ?? { top: 0, bottom: 0 };
    const top = Math.min(row.count, amount.top);
    const bottom = Math.min(row.count - top, amount.bottom);
    const context = (offset) => ({ type: 'context', text: model.content[row.newLine + offset - 1] ?? '', oldLine: row.oldLine + offset, newLine: row.newLine + offset, key: `${row.key}-${offset}` });
    return [
      ...Array.from({ length: top }, (_, offset) => context(offset)),
      ...(top + bottom < row.count ? [{ ...row, count: row.count - top - bottom }] : []),
      ...Array.from({ length: bottom }, (_, offset) => context(row.count - bottom + offset)),
    ];
  });
}
