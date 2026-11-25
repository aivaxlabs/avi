import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const testHome = await mkdtemp(path.join(tmpdir(), 'agents-home-'));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
const {
  clearContextCaches,
  createContextItem,
  hasSpecializedAgents,
  listContextItems,
  moveContextItem,
  resolveDynamicContext,
  resolveSpecializedAgent,
  writeContextItem,
} = await import('../src/main/context-injection.js');
const installationRoot = await mkdtemp(path.join(tmpdir(), 'agents-install-'));
const installationContextDirectory = path.join(installationRoot, 'Resources', 'app', 'context');
await mkdir(installationContextDirectory, { recursive: true });

try {
  const ctx = (workspacePath) => ({ workspacePath, installationContextPath: installationContextDirectory });
  const agentRoot = path.join(installationRoot, 'agent-fixture');
  await mkdir(agentRoot, { recursive: true });
  assert.equal(await hasSpecializedAgents(ctx(agentRoot)), false);
  const createdAgent = await createContextItem(agentRoot, { kind: 'agent', name: 'Code reviewer' });
  assert.equal(createdAgent.path, path.join(agentRoot, '.agents', 'agents', 'code-reviewer.md'));
  await writeContextItem(createdAgent.path, [
    '---',
    'name: Review Agent',
    'description: Specialized agent for code review',
    'model: claude-opus-5.5',
    'reasoning-effort: xhigh',
    'user-invocable: false',
    '---',
    'You are a review agent.',
  ].join('\n'));
  await mkdir(path.join(agentRoot, '.agents', 'agents', 'nested'), { recursive: true });
  await mkdir(path.join(agentRoot, 'agents'), { recursive: true });
  await mkdir(path.join(testHome, '.agents', 'agents'), { recursive: true });
  await Promise.all([
    writeFile(path.join(agentRoot, '.agents', 'agents', 'auditor.md'), '---\ndescription: Audits\n---\nAudit it.'),
    writeFile(path.join(agentRoot, '.agents', 'agents', 'notes.txt'), 'ignored'),
    writeFile(path.join(agentRoot, '.agents', 'agents', 'nested', 'deep.md'), 'ignored'),
    writeFile(path.join(agentRoot, 'agents', 'root.md'), 'ignored'),
    writeFile(path.join(testHome, '.agents', 'agents', 'auditor.md'), '---\ndescription: Global auditor\n---\nGlobal audit.'),
    writeFile(path.join(testHome, '.agents', 'agents', 'global-only.md'), '---\ndescription: Global only\n---\nGlobal.'),
  ]);
  clearContextCaches();

  const agentContext = await listContextItems(agentRoot);
  const agentItems = agentContext.groups.find((group) => group.id === 'agent').items;
  assert.deepEqual(agentItems.map((item) => path.basename(item.path)).sort(), ['auditor.md', 'code-reviewer.md']);
  const reviewItem = agentItems.find((item) => item.title === 'Review Agent');
  assert.equal(reviewItem.model, 'claude-opus-5.5');
  assert.equal(reviewItem.reasoningEffort, 'xhigh');
  assert.equal(reviewItem.invocationMode, 'assistant-only');
  assert.deepEqual(agentContext.commands.map((command) => command.id), ['agent:auditor']);
  const globalContext = await listContextItems(path.join(testHome, '.agents'), { scope: 'global' });
  assert.equal(globalContext.groups.find((group) => group.id === 'agent').items.length, 2);

  const injected = await resolveDynamicContext(ctx(agentRoot));
  assert.ok(injected.includes('Specialized agents:'));
  assert.ok(injected.includes('- code-reviewer (Review Agent)'));
  assert.ok(injected.includes('- global-only'));
  assert.ok(injected.includes('invoke_specialized_agent'));
  assert.ok(!injected.includes('You are a review agent.'));
  assert.equal(await hasSpecializedAgents(ctx(agentRoot)), true);

  const resolved = await resolveSpecializedAgent('Code-Reviewer', ctx(agentRoot));
  assert.deepEqual(
    { id: resolved.id, name: resolved.name, model: resolved.model, effort: resolved.reasoningEffort, instructions: resolved.instructions },
    { id: 'code-reviewer', name: 'Review Agent', model: 'claude-opus-5.5', effort: 'xhigh', instructions: 'You are a review agent.' },
  );
  assert.equal((await resolveSpecializedAgent('auditor', ctx(agentRoot))).instructions, 'Audit it.');
  assert.equal((await resolveSpecializedAgent('global-only', ctx(agentRoot))).instructions, 'Global.');
  await assert.rejects(resolveSpecializedAgent('missing', ctx(agentRoot)), /Available agents: auditor, code-reviewer, global-only/);
  await assert.rejects(writeContextItem(path.join(agentRoot, 'notes.md'), 'x'), /Only instruction, skill, workflow, and agent/);
  assert.equal(
    (await moveContextItem(createdAgent.path, 'private')).path,
    path.join(agentRoot, '.agents', '.user-private', 'agents', 'code-reviewer.md'),
  );
  clearContextCaches();
  assert.equal((await resolveSpecializedAgent('code-reviewer', ctx(agentRoot))).name, 'Review Agent');
  console.log('Specialized agent discovery passed.');
} finally {
  await rm(testHome, { recursive: true, force: true });
  await rm(installationRoot, { recursive: true, force: true });
}
