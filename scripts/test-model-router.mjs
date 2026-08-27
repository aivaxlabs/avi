import assert from 'node:assert/strict';
import { ModelRouterService } from '../src/main/model-router.js';

const models = new Map();
const calls = [];
const providers = new Map();

function addModel(id, {
  reasoning = [],
  capabilities = {},
  context = { input: null, output: null },
  stream,
} = {}) {
  const model = {
    id,
    modelId: id.split(':').at(-1),
    name: id,
    providerId: id.split(':')[0],
    providerName: id.split(':')[0],
    interface: 'test',
    endpoint: null,
    reasoning,
    capabilities: {
      images: false,
      audio: false,
      pdfFiles: false,
      video: false,
      ...capabilities,
    },
    context,
  };
  const provider = {
    config: { id: model.providerId },
    getContributions: () => ({ models: [], tools: [], auxiliaryPanels: [] }),
    stream: async (options) => {
      calls.push({ id, reasoningEffort: options.reasoningEffort });
      return stream ? stream(options) : { assistantContent: id, continuation: [], toolCalls: [] };
    },
  };
  models.set(id, { provider, model });
  providers.set(id, provider);
}

addModel('one:model', {
  reasoning: ['low', 'high'],
  capabilities: { images: true, audio: true },
  context: { input: 100_000, output: 20_000 },
});
addModel('two:model', {
  reasoning: ['medium', 'high'],
  capabilities: { images: true },
  context: { input: 50_000, output: 10_000 },
});

let persisted = [];
const service = new ModelRouterService({
  getRouters: () => structuredClone(persisted),
  setRouters: (routers) => {
    persisted = structuredClone(routers);
    return structuredClone(persisted);
  },
  resolveModel: (modelId) => models.get(modelId) ?? null,
});

const saved = service.save({
  id: '@reliable',
  name: 'Reliable',
  mode: 'fallback',
  models: [{ modelId: 'one:model', available: false }, { modelId: 'two:model' }],
});
assert.equal(saved[0].id, '@reliable');
assert.deepEqual(persisted[0].models, [
  { modelId: 'one:model' },
  { modelId: 'two:model' },
]);
assert.throws(
  () => service.normalize({ name: 'Nested', mode: 'fallback', models: [{ modelId: '@reliable' }] }),
  /cannot use other routers/i,
);
assert.throws(
  () => service.normalize({ name: 'Duplicate', mode: 'fallback', models: [
    { modelId: 'one:model' },
    { modelId: 'one:model' },
  ] }),
  /duplicated/i,
);

const catalog = service.listModels()[0];
assert.equal(catalog.id, '@reliable');
assert.deepEqual(catalog.capabilities, {
  images: true,
  audio: false,
  pdfFiles: false,
  video: false,
});
assert.deepEqual(catalog.context, { input: 50_000, output: 10_000 });
assert.deepEqual(catalog.reasoning, ['high']);

calls.length = 0;
await service.resolve('@reliable').provider.stream({
  model: catalog,
  messages: [],
  reasoningEffort: 'medium',
  signal: new AbortController().signal,
  onEvent: () => {},
});
assert.deepEqual(calls, [{ id: 'one:model', reasoningEffort: 'low' }]);

providers.get('one:model').stream = async () => {
  calls.push({ id: 'one:model', reasoningEffort: null });
  const error = new Error('retry exhausted');
  error.code = 'provider_retry_exhausted';
  throw error;
};
calls.length = 0;
const fallbackResult = await service.resolve('@reliable').provider.stream({
  model: catalog,
  messages: [],
  reasoningEffort: null,
  signal: new AbortController().signal,
  onEvent: () => {},
});
assert.equal(fallbackResult.assistantContent, 'two:model');
assert.deepEqual(calls.map(({ id }) => id), ['one:model', 'two:model']);
assert.deepEqual(service.list()[0].models.map(({ available }) => available), [false, true]);
assert.equal(typeof service.list()[0].models[0].unavailableUntil, 'number');

calls.length = 0;
await service.resolve('@reliable').provider.stream({
  model: catalog,
  messages: [],
  reasoningEffort: null,
  signal: new AbortController().signal,
  onEvent: () => {},
});
assert.deepEqual(calls.map(({ id }) => id), ['two:model']);

service.save({
  id: '@balanced',
  name: 'Balanced',
  mode: 'round-robin',
  models: [{ modelId: 'one:model' }, { modelId: 'two:model' }],
});
providers.get('one:model').stream = async (options) => {
  calls.push({ id: 'one:model', reasoningEffort: options.reasoningEffort });
  return { assistantContent: 'one:model', continuation: [], toolCalls: [] };
};
calls.length = 0;
for (let index = 0; index < 3; index += 1) {
  const resolved = service.resolve('@balanced');
  await resolved.provider.stream({
    model: resolved.model,
    messages: [],
    reasoningEffort: null,
    signal: new AbortController().signal,
    onEvent: () => {},
  });
}
assert.deepEqual(calls.map(({ id }) => id), ['one:model', 'two:model', 'one:model']);

service.save({
  id: '@errors',
  name: 'Errors',
  mode: 'fallback',
  models: [{ modelId: 'one:model' }, { modelId: 'two:model' }],
});
providers.get('one:model').stream = async () => {
  calls.push({ id: 'one:model', reasoningEffort: null });
  const error = new Error('invalid request');
  error.code = 'BAD_REQUEST';
  error.status = 400;
  throw error;
};
const nonRetryable = service.resolve('@errors');
calls.length = 0;
await assert.rejects(
  nonRetryable.provider.stream({
    model: nonRetryable.model,
    messages: [],
    reasoningEffort: null,
    signal: new AbortController().signal,
    onEvent: () => {},
  }),
  (error) => error.code === 'BAD_REQUEST',
);
assert.deepEqual(calls.map(({ id }) => id), ['one:model']);
assert.deepEqual(
  service.list().find((router) => router.id === '@errors').models.map(({ available }) => available),
  [true, true],
);

for (const [routerId, message] of [
  ['@insufficient-credits', '{"error":{"message":"You have insufficient credits to make this request.","code":"BAD_REQUEST"}}'],
  ['@insufficient-balance', 'Your account has an Insufficient Balance.'],
  ['@insufficient-quota', 'Insufficient quota remaining.'],
]) {
  service.save({
    id: routerId,
    name: routerId,
    mode: 'fallback',
    models: [{ modelId: 'one:model' }, { modelId: 'two:model' }],
  });
  providers.get('one:model').stream = async () => {
    calls.push({ id: 'one:model', reasoningEffort: null });
    const error = new Error(message);
    error.code = 'BAD_REQUEST';
    error.status = 400;
    throw error;
  };
  calls.length = 0;
  const accountLimitResult = await service.resolve(routerId).provider.stream({
    model: catalog,
    messages: [],
    reasoningEffort: null,
    signal: new AbortController().signal,
    onEvent: () => {},
  });
  assert.equal(accountLimitResult.assistantContent, 'two:model');
  assert.deepEqual(calls.map(({ id }) => id), ['one:model', 'two:model']);
  assert.deepEqual(
    service.list().find((router) => router.id === routerId).models.map(({ available }) => available),
    [false, true],
  );
}

service.save({
  id: '@quota',
  name: 'Quota',
  mode: 'fallback',
  models: [{ modelId: 'one:model' }, { modelId: 'two:model' }],
});
providers.get('one:model').stream = async () => {
  calls.push({ id: 'one:model', reasoningEffort: null });
  const error = new Error('weekly inference cap reached');
  error.code = 'INFERENCE_CAP_ERROR';
  throw error;
};
calls.length = 0;
const quotaResult = await service.resolve('@quota').provider.stream({
  model: catalog,
  messages: [],
  reasoningEffort: null,
  signal: new AbortController().signal,
  onEvent: () => {},
});
assert.equal(quotaResult.assistantContent, 'two:model');
assert.deepEqual(calls.map(({ id }) => id), ['one:model', 'two:model']);
assert.deepEqual(
  service.list().find((router) => router.id === '@quota').models.map(({ available }) => available),
  [false, true],
);
assert.equal(typeof service.list().find((router) => router.id === '@quota').models[0].unavailableUntil, 'number');

service.save({
  id: '@rate',
  name: 'Rate',
  mode: 'fallback',
  models: [{ modelId: 'two:model' }, { modelId: 'one:model' }],
});
providers.get('two:model').stream = async () => {
  calls.push({ id: 'two:model', reasoningEffort: null });
  const error = new Error('too many requests');
  error.status = 429;
  throw error;
};
providers.get('one:model').stream = async () => {
  calls.push({ id: 'one:model', reasoningEffort: null });
  return { assistantContent: 'one:model', continuation: [], toolCalls: [] };
};
calls.length = 0;
const rateResult = await service.resolve('@rate').provider.stream({
  model: catalog,
  messages: [],
  reasoningEffort: null,
  signal: new AbortController().signal,
  onEvent: () => {},
});
assert.equal(rateResult.assistantContent, 'one:model');
assert.deepEqual(calls.map(({ id }) => id), ['two:model', 'one:model']);
assert.deepEqual(
  service.list().find((router) => router.id === '@rate').models.map(({ available }) => available),
  [false, true],
);

service.save({
  id: '@exhausted',
  name: 'Exhausted',
  mode: 'fallback',
  models: [{ modelId: 'one:model' }, { modelId: 'two:model' }],
});
providers.get('one:model').stream = async () => {
  calls.push({ id: 'one:model', reasoningEffort: null });
  const error = new Error('weekly inference cap reached');
  error.code = 'INFERENCE_CAP_ERROR';
  throw error;
};
providers.get('two:model').stream = async () => {
  calls.push({ id: 'two:model', reasoningEffort: null });
  const error = new Error('too many requests');
  error.status = 429;
  throw error;
};
calls.length = 0;
await assert.rejects(
  service.resolve('@exhausted').provider.stream({
    model: catalog,
    messages: [],
    reasoningEffort: null,
    signal: new AbortController().signal,
    onEvent: () => {},
  }),
  (error) => error.status === 429,
);
assert.deepEqual(calls.map(({ id }) => id), ['one:model', 'two:model']);
assert.deepEqual(
  service.list().find((router) => router.id === '@exhausted').models.map(({ available }) => available),
  [false, false],
);

console.log('Model router tests passed.');
