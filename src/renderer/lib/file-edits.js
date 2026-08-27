import { createTwoFilesPatch } from 'diff';

export function consolidateFileEdits(messages) {
  const editsByPath = new Map();
  for (const message of messages) {
    for (const edit of message.edits ?? []) {
      if (typeof edit?.filePath !== 'string' || typeof edit.after !== 'string') continue;
      if (edit.before !== null && typeof edit.before !== 'string') continue;
      const existing = editsByPath.get(edit.filePath);
      editsByPath.set(edit.filePath, existing
        ? { ...existing, after: edit.after }
        : { filePath: edit.filePath, before: edit.before, after: edit.after });
    }
  }
  return [...editsByPath.values()]
    .filter((edit) => edit.before !== edit.after)
    .map((edit) => ({ ...edit, ...changedLineRange(edit.before, edit.after) }));
}

export function createFileEditDiff({ filePath, before, after }) {
  const normalizedPath = filePath.replaceAll('\\', '/');
  return createTwoFilesPatch(
    before === null ? '/dev/null' : `a/${normalizedPath}`,
    `b/${normalizedPath}`,
    before ?? '',
    after,
    '',
    '',
    { context: 3 },
  );
}

export function changedLineRange(before, after) {
  const beforeLines = before === null || before === '' ? [] : before.split(/\r?\n/);
  const afterLines = after === '' ? [] : after.split(/\r?\n/);
  let start = 0;
  while (
    start < beforeLines.length
    && start < afterLines.length
    && beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (
    beforeEnd > start
    && afterEnd > start
    && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    beforeLines,
    afterLines,
    beforeStartLine: start + 1,
    beforeEndLine: beforeEnd,
    afterStartLine: start + 1,
    afterEndLine: afterEnd,
    additions: afterEnd - start,
    deletions: beforeEnd - start,
  };
}

export function createUndoPrompt(edits) {
  const files = edits.map((edit) => {
    const beforeRange = edit.before === null
      ? 'file did not exist before this iteration'
      : edit.deletions > 0
        ? `original lines ${edit.beforeStartLine}-${edit.beforeEndLine}`
        : `original insertion point at line ${edit.beforeStartLine}`;
    const afterRange = edit.additions > 0
      ? `current lines ${edit.afterStartLine}-${edit.afterEndLine}`
      : `current insertion point at line ${edit.afterStartLine}`;
    return `- ${edit.filePath} (${beforeRange}; ${afterRange})`;
  });
  return `Undo the changes you made this last iteration in the following files and line numbers:\n${files.join('\n')}`;
}
