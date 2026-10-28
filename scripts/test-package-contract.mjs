import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

assert.ok(!/chisel/i.test(JSON.stringify(pkg)), 'package.json no longer references Chisel');
assert.equal(pkg.build.beforePack, undefined, 'no beforePack hook');
for (const section of ['win', 'mac', 'linux']) {
  const extra = pkg.build[section]?.extraResources;
  assert.ok(
    !Array.isArray(extra) || extra.every((entry) => !/chisel|\.avi-bin/i.test(JSON.stringify(entry))),
    `${section} extraResources has no Chisel entries`,
  );
}
console.log('ok - package.json has no Chisel packaging hooks or resources');

for (const rendererOnly of ['boring-avatars', 'diff', 'dompurify', 'katex', 'mdast-util-to-string', 'mermaid', 'monaco-editor', 'remark-directive']) {
  assert.equal(pkg.dependencies[rendererOnly], undefined, `${rendererOnly} is bundled by Vite and stays out of app.asar`);
  assert.ok(pkg.devDependencies[rendererOnly], `${rendererOnly} remains available to the renderer build`);
}
assert.deepEqual(pkg.build.electronLanguages, ['en-US']);
const pluginFilter = pkg.build.extraResources.find((entry) => entry.from === 'built-in-plugins').filter;
for (const excluded of ['node-gyp', '@types']) {
  assert.ok(pluginFilter.includes(`!**/node_modules/${excluded}/**/*`), `built-in plugins exclude ${excluded}`);
}
console.log('ok - package excludes renderer sources, unused locales and build-only plugin modules');

for (const removed of ['scripts/before-pack.mjs', 'scripts/prepare-chisel.mjs', 'scripts/test-prepare-chisel.mjs']) {
  assert.ok(!existsSync(join(repoRoot, removed)), `${removed} is removed`);
}
console.log('ok - Chisel packaging scripts are removed');

for (const [name, command] of Object.entries(pkg.scripts)) {
  for (const match of command.matchAll(/scripts\/[\w.-]+\.mjs/g)) {
    assert.ok(existsSync(join(repoRoot, match[0])), `${name} target exists: ${match[0]}`);
  }
}
console.log('ok - every package.json script target exists');

for (const file of readdirSync(join(repoRoot, 'scripts'))) {
  if (!file.startsWith('test-') || !file.endsWith('.mjs')) continue;
  // This contract test is the one place allowed to name the removed scripts.
  if (file === 'test-package-contract.mjs') continue;
  const source = readFileSync(join(repoRoot, 'scripts', file), 'utf8');
  assert.ok(!/prepare-chisel|before-pack/i.test(source), `${file} does not reference removed Chisel scripts`);
}
console.log('ok - no test script references the removed Chisel packaging scripts');
