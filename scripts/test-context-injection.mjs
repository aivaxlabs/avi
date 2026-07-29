import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  listContextItems,
  resolveDynamicContext,
} from '../src/main/context-injection.js';

const root = await mkdtemp(path.join(tmpdir(), 'context-variants-'));

try {
  await Promise.all([
    'AGENTS.md',
    'AGENTS.foobar.md',
    'AGENTS.outracoisa.md',
    'AGENTS.user.md',
    'MEMORY.md',
    'MEMORY.algumacoisa.md',
    'AGENT.invalid.md',
    'NOTES.md',
  ].map((name) => writeFile(path.join(root, name), `# ${name}`)));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'nested', 'MEMORY.child.md'), '# Nested memory');

  const context = await listContextItems(root);
  const names = context.groups
    .find((group) => group.id === 'instruction')
    .items
    .map((item) => path.basename(item.path))
    .sort();
  const expectedNames = [
    'AGENTS.foobar.md',
    'AGENTS.md',
    'AGENTS.outracoisa.md',
    'AGENTS.user.md',
    'MEMORY.algumacoisa.md',
    'MEMORY.md',
  ].sort();

  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`Unexpected context editor items: ${JSON.stringify(names)}`);
  }

  const injected = await resolveDynamicContext({ workspacePath: root });
  if (
    !injected.includes('--- BEGIN AGENTS.foobar.md ---')
    || !injected.includes('nested/MEMORY.child.md')
    || injected.includes('--- BEGIN AGENT.invalid.md ---')
    || injected.includes('--- BEGIN NOTES.md ---')
  ) {
    throw new Error('Context variants did not follow the expected root and nested rules.');
  }

  const planContext = await resolveDynamicContext({
    workspacePath: root,
    workMode: 'plan',
  });
  for (const requirement of [
    '<work_mode mode="plan">',
    'Do not edit files',
    'No permission level overrides these restrictions',
    'exactly one non-empty <execution-plan>...</execution-plan> block',
    'affected files',
    'public contracts',
    'validations',
    'success criteria',
  ]) {
    if (!planContext.includes(requirement)) {
      throw new Error(`Plan context is missing: ${requirement}`);
    }
  }
  if (injected.includes('<work_mode mode="plan">')) {
    throw new Error('Plan context was injected outside Plan mode.');
  }

  console.log('Context variant discovery passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
