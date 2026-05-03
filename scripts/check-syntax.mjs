import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['scripts', 'src/main'];
const files = [];

for (const root of roots) {
  collect(root);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function collect(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collect(path);
      continue;
    }
    if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) {
      files.push(path);
    }
  }
}
