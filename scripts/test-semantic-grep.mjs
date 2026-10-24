import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  formatFileSearchResults,
  gitWorktreeRoot,
  scanDirectories,
  semanticPathFilter,
  splitChunks,
} from '../src/main/semantic-grep-scan.js';

const root = mkdtempSync(join(tmpdir(), 'avi-semantic-grep-'));
const outside = mkdtempSync(join(tmpdir(), 'avi-semantic-grep-link-'));

try {
  const oversized = splitChunks('a'.repeat(6001));
  assert.equal(oversized.length, 2);
  assert.equal(oversized[0].text, 'a'.repeat(6000));
  assert.equal(oversized[1].text, 'a');
  assert.deepEqual([oversized[0].sourceLineStart, oversized[0].sourceLineEnd], [1, 1]);
  assert.deepEqual([oversized[1].sourceLineStart, oversized[1].sourceLineEnd], [1, 1]);
  const spanned = splitChunks(`${'a'.repeat(3000)}\n${'b'.repeat(3000)}\n${'c'.repeat(10)}\n`);
  assert.equal(spanned[0].text, 'a'.repeat(3000));
  assert.deepEqual([spanned[0].sourceLineStart, spanned[0].sourceLineEnd], [1, 1]);
  assert.equal(spanned[1].text, `${'b'.repeat(3000)}\n${'c'.repeat(10)}\n`);
  assert.deepEqual([spanned[1].sourceLineStart, spanned[1].sourceLineEnd], [2, 3]);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'linked-worktree'));
  writeFileSync(join(root, 'src', 'app.js'), 'export const answer = 42;\n');
  writeFileSync(join(outside, 'via-link.js'), 'export const linked = true;\n');
  symlinkSync(outside, join(root, 'src', 'linked'), 'junction');
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'skip me\n');
  writeFileSync(join(root, 'linked-worktree', '.git'), 'gitdir: /main/.git/worktrees/linked\n');

  const files = [];
  const lines = [];
  const scanned = await scanDirectories([root], {
    onFile(file) {
      files.push(file.relativePath.replaceAll('\\', '/'));
      lines.push(...file.lines);
    },
  });
  assert.deepEqual(files.sort(), ['src/app.js', 'src/linked/via-link.js']);
  assert.equal(scanned.files, 2);
  assert.equal(scanned.documents, 2);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line.__meta.source_line_start, 1);
    assert.equal(line.__meta.source_line_end, 1);
    assert.equal(line.text.endsWith('\n'), true);
  }

  assert.equal(await gitWorktreeRoot(join(root, 'linked-worktree')), join(root, 'linked-worktree'));
  assert.equal(await gitWorktreeRoot(root), null);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  assert.equal(semanticPathFilter(root), `metadata.real_path startswith ${JSON.stringify(prefix)}`);

  assert.match(formatFileSearchResults(root, []), /Use rg/);
  const listed = formatFileSearchResults(root, [{
    score: 0.5,
    relativePath: 'src/app.js',
    ranges: [{ start: 20, end: 22 }, { start: 4, end: 9 }, { start: 4, end: 9 }],
  }]);
  assert.equal(listed, '0.500  src/app.js:4-9,20-22');
  assert.equal(formatFileSearchResults(root, [{
    score: 0.5,
    relativePath: 'src/app.js',
    ranges: [],
  }]), '0.500  src/app.js');
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}

console.log('semantic grep scan and search formatting passed');
