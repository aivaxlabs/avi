import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findComposerInvocation } from '../src/renderer/lib/composer-invocation.js';

const composerSource = readFileSync(
  new URL('../src/renderer/components/Composer.jsx', import.meta.url),
  'utf8',
);

assert.deepEqual(findComposerInvocation('/comando blablabla', 8), {
  prefix: '/',
  query: 'comando',
  start: 0,
});
assert.deepEqual(findComposerInvocation('blabla /comando', 15), {
  prefix: '/',
  query: 'comando',
  start: 7,
});
assert.equal(findComposerInvocation('blablabla/comando', 17), null);
assert.deepEqual(findComposerInvocation('use @thread', 11), {
  prefix: '@',
  query: 'thread',
  start: 4,
});
assert.equal(findComposerInvocation('user@example.com', 16), null);
assert.deepEqual(findComposerInvocation('$skill', 6), {
  prefix: '$',
  query: 'skill',
  start: 0,
});
assert.match(
  composerSource,
  /window\.setTimeout\(\(\) => \{\s*setDebouncedCommand\(\{ mode: commandMode, query: commandQuery \}\);\s*\}, 100\)/,
);
assert.match(
  composerSource,
  /const normalized = debouncedCommandQuery\.trim\(\)\.toLowerCase\(\)/,
);
assert.match(
  composerSource,
  /mentions\.list\(\{ folderPath: project\.path, query: debouncedCommandQuery \}\)/,
);
assert.match(
  composerSource,
  /const commandResultLimit = 30;/,
);
assert.match(
  composerSource,
  /const visibleCommandOptions = commandOptions\.slice\(0, commandResultLimit\);/,
);
assert.match(
  composerSource,
  /const activeCommandOption = commandQueryReady[\s\S]*?visibleCommandOptions\[commandIndex\][\s\S]*?: null;/,
);
assert.match(
  composerSource,
  /visibleCommandOptions\.map\(\(option, index\) =>/,
);
assert.match(
  composerSource,
  /\(current \+ 1\) % visibleCommandOptions\.length/,
);

console.log('Composer invocation, debounce, and result-limit tests passed.');
