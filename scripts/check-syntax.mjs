import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['scripts', 'src/main'];
const files = [];

for (const root of roots) {
  collect(root);
}

for (const file of files) {
  new Bun.Transpiler({ loader: 'js' }).scan(readFileSync(file, 'utf8'));
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
