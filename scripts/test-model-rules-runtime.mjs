import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const stamp = `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`;
const vizBase = join(tmpdir(), '.avi', 'visualizations', stamp);
mkdirSync(vizBase, { recursive: true });
const testProfile = mkdtempSync(join(vizBase, 'model-rules-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;
process.env.HOME = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ModelProvider } = await import('../src/main/model-provider.js');
  const { ModelRouterService } = await import('../src/main/model-router.js');
  const { chatCompletionsApi } = await import('../src/providers/openai-compatible.js');
  const { setTraceLevel } = await import('../src/main/trace-log.js');
  setTraceLevel('disabled');

  const { getPreferences, setDefaultModels } = database;

  const base = {
    auxiliary: { modelId: 'test:aux', reasoningEffort: null },
    supervision: null,
    quickChat: null,
    compactation: null,
    rules: [
      { modelId: 'test:model-a', role: 'main', instructions: 'CONCRETE_A_MAIN_RULE' },
      { modelId: 'test:model-a', role: 'bot', instructions: 'CONCRETE_A_BOT_RULE' },
      { modelId: 'test:model-a', role: 'subagent', instructions: 'CONCRETE_A_SUBAGENT_RULE' },
      { modelId: 'test:model-a', role: 'all', instructions: 'CONCRETE_A_ALL_RULE' },
      { modelId: 'test:model-b', role: 'main', instructions: 'CONCRETE_B_MAIN_RULE' },
      { modelId: '@router', role: 'main', instructions: 'VIRTUAL_MAIN_RULE' },
      { modelId: '@router', role: 'all', instructions: 'VIRTUAL_ALL_RULE' },
    ],
    subagents: { enabled: false, small: null, medium: null, large: null },
    intelligence: { levels: [] },
  };

  const saved = setDefaultModels(base);
  assert.deepEqual(Object.keys(saved.rules[0]).sort(), ['instructions', 'modelId', 'role']);
  const roundtripped = getPreferences().defaultModels;
  assert.deepEqual(roundtripped.rules, saved.rules);
  assert.equal(roundtripped.rules.length, 7);
  assert.deepEqual(roundtripped.auxiliary, { modelId: 'test:aux', reasoningEffort: null });
  assert.deepEqual(
    roundtripped.rules.filter((rule) => rule.modelId === '@router').map((rule) => rule.role).sort(),
    ['all', 'main'],
  );
  for (const role of ['main', 'bot', 'subagent', 'all']) {
    assert.ok(roundtripped.rules.some((rule) => rule.role === role), `missing role ${role}`);
  }

  const snapshot = structuredClone(getPreferences().defaultModels);
  for (const bad of [
    { ...base, rules: [base.rules[0], { ...base.rules[0] }] },
    { ...base, rules: [{ modelId: 'test:model-a', role: 'supervisor', instructions: 'x' }] },
    { ...base, rules: {} },
  ]) {
    assert.throws(() => setDefaultModels(bad));
  }
  assert.deepEqual(getPreferences().defaultModels, snapshot);

  const systemOf = (body) => {
    const first = body.messages[0];
    assert.equal(first.role, 'system');
    return first.content;
  };
  const modelRules = getPreferences().defaultModels.rules;
  const modelA = {
    id: 'test:model-a',
    modelId: 'model-a',
    name: 'A',
    providerId: 'test',
    providerName: 'Test',
    interface: 'chat-completions',
    endpoint: null,
    reasoning: [],
    capabilities: {},
    context: { input: 100_000, output: 10_000 },
  };
  const baseCtx = {
    traceOperation: 'chat',
    orchestrationRole: 'orchestrator',
    effectiveModelId: modelA.id,
    virtualModelId: '@router',
    modelRules,
  };
  const mainBody = await chatCompletionsApi.createBody({
    provider: { id: 'test' },
    model: modelA,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    toolHistory: [],
    invocationContext: baseCtx,
  });
  const mainSystem = systemOf(mainBody);
  for (const marker of ['CONCRETE_A_MAIN_RULE', 'CONCRETE_A_ALL_RULE', 'VIRTUAL_MAIN_RULE', 'VIRTUAL_ALL_RULE']) {
    assert.ok(mainSystem.includes(marker), `missing ${marker}`);
  }
  for (const marker of ['CONCRETE_A_BOT_RULE', 'CONCRETE_A_SUBAGENT_RULE', 'CONCRETE_B_MAIN_RULE']) {
    assert.ok(!mainSystem.includes(marker), `leaked ${marker}`);
  }

  const subBody = await chatCompletionsApi.createBody({
    provider: { id: 'test' },
    model: modelA,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    toolHistory: [],
    invocationContext: { ...baseCtx, orchestrationRole: 'subagent' },
  });
  const subSystem = systemOf(subBody);
  assert.ok(subSystem.includes('CONCRETE_A_SUBAGENT_RULE'));
  assert.ok(!subSystem.includes('CONCRETE_A_MAIN_RULE'));

  const supervisorBody = await chatCompletionsApi.createBody({
    provider: { id: 'test' },
    model: modelA,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    toolHistory: [],
    invocationContext: { ...baseCtx, orchestrationRole: 'supervisor' },
  });
  assert.ok(!systemOf(supervisorBody).includes('<model_rules>'));

  const modelB = { ...modelA, id: 'test:model-b', modelId: 'model-b', name: 'B' };
  const bodies = [];
  const requests = [];
  const failoverError = new Error('rate limited');
  failoverError.status = 429;
  const sentinelError = new Error('SENTINEL_FALLBACK_REACHED');
  sentinelError.status = 400;
  const wrap = (error) => new ModelProvider(
    { id: 'test', name: 'Test', interface: 'chat-completions', enabled: true, models: [] },
    {
      ...chatCompletionsApi,
      createBody: async (ctx) => {
        bodies.push(ctx);
        return chatCompletionsApi.createBody(ctx);
      },
      request: async (ctx) => {
        requests.push(ctx.invocationContext);
        throw error;
      },
    },
    {},
  );
  const providerA = wrap(failoverError);
  const providerB = wrap(sentinelError);
  const router = {
    id: '@router',
    name: 'Router',
    mode: 'fallback',
    models: [{ modelId: 'test:model-a' }, { modelId: 'test:model-b' }],
  };
  const service = new ModelRouterService({
    getRouters: () => [router],
    setRouters: () => {},
    resolveModel: (id) => (
      id === 'test:model-a' ? { provider: providerA, model: modelA }
        : id === 'test:model-b' ? { provider: providerB, model: modelB }
          : null
    ),
  });
  assert.ok(service.resolve(router.id));
  const events = [];
  await assert.rejects(
    service.resolve(router.id).provider.stream({
      model: service.resolve(router.id).model,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolHistory: [],
      invocationContext: {
        traceOperation: 'chat',
        orchestrationRole: 'orchestrator',
        modelRules,
      },
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    }),
    /SENTINEL_FALLBACK_REACHED/,
  );
  assert.equal(bodies.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(bodies[0].invocationContext.effectiveModelId, 'test:model-a');
  assert.equal(bodies[1].invocationContext.effectiveModelId, 'test:model-b');
  for (const body of bodies) assert.equal(body.invocationContext.virtualModelId, '@router');
  assert.ok(events.some((event) => event.type === 'retry-clear'));
  const systemA = systemOf(await chatCompletionsApi.createBody(bodies[0]));
  const systemB = systemOf(await chatCompletionsApi.createBody(bodies[1]));
  assert.ok(systemA.includes('CONCRETE_A_MAIN_RULE') && systemA.includes('VIRTUAL_MAIN_RULE'));
  assert.ok(!systemA.includes('CONCRETE_B_MAIN_RULE'));
  assert.ok(systemB.includes('CONCRETE_B_MAIN_RULE') && systemB.includes('VIRTUAL_ALL_RULE'));
  assert.ok(!systemB.includes('CONCRETE_A_MAIN_RULE'));

  console.log('Model rules runtime tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
