import assert from 'node:assert/strict';
import { ModelProviderRegistry } from '../src/main/model-provider.js';
import {
  chatCompletionsApi,
  openAiCompatibleProviderTypes,
  responsesApi,
} from '../src/providers/openai-compatible.js';
import { openAiSubscriptionProviderType } from '../src/providers/openai-subscription.js';

const providerType = openAiCompatibleProviderTypes.find(
  (type) => type.descriptor.id === 'chat-completions',
);
const registry = new ModelProviderRegistry({
  getProviders: () => [],
  providerTypes: [providerType],
  services: {},
});
const providerInput = {
  id: 'openai-compatible',
  name: 'OpenAI Compatible',
  baseUrl: 'https://example.com',
  interface: 'chat-completions',
  temperature: '0.7',
  topK: '40',
  enabled: true,
  models: [
    {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol — 400K',
      context: { input: 400_000, output: 128_000 },
    },
    {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol — 1M',
      context: { input: 1_000_000, output: 128_000 },
    },
  ],
};

const normalized = registry.normalizeConfig(providerInput);
assert.equal(normalized.models[0].instanceId, 'gpt-5.6-sol');
assert.notEqual(normalized.models[1].instanceId, 'gpt-5.6-sol');
assert.notEqual(normalized.models[0].instanceId, normalized.models[1].instanceId);

const normalizedAgain = registry.normalizeConfig(normalized);
assert.deepEqual(
  normalizedAgain.models.map((model) => model.instanceId),
  normalized.models.map((model) => model.instanceId),
);
const renamed = registry.normalizeConfig({
  ...normalized,
  models: normalized.models.map((model, index) => (
    index === 0 ? { ...model, id: 'gpt-5.6-sol-renamed' } : model
  )),
});
assert.equal(renamed.models[0].instanceId, normalized.models[0].instanceId);
assert.equal(renamed.models[0].id, 'gpt-5.6-sol-renamed');

const provider = registry.createProvider(normalizedAgain);
const models = provider.listModels();
assert.deepEqual(
  models.map((model) => model.modelId),
  ['gpt-5.6-sol', 'gpt-5.6-sol'],
);
assert.equal(models[0].id, 'openai-compatible:gpt-5.6-sol');
assert.equal(models[1].id, `openai-compatible:${normalized.models[1].instanceId}`);
assert.notEqual(models[0].id, models[1].id);

const body = await provider.implementation.createBody({
  provider: provider.config,
  model: models[1],
  messages: [{ role: 'user', content: 'Hello' }],
  reasoningEffort: null,
  tools: [],
  toolHistory: [],
  invocationContext: { auxiliary: true },
});
assert.equal(body.model, 'gpt-5.6-sol');
assert.equal(body.temperature, 0.7);
assert.equal(body.top_k, 40);

const subscriptionRegistry = new ModelProviderRegistry({
  getProviders: () => [],
  providerTypes: [openAiSubscriptionProviderType],
  services: {},
});
const subscriptionProvider = subscriptionRegistry.createProvider(
  subscriptionRegistry.normalizeConfig({
    id: 'subscription',
    name: 'OpenAI Subscription',
    interface: 'openai-subscription',
  }),
);
const [astra, astraFast, astra1m, astra1mFast] = subscriptionProvider.listModels();
assert.deepEqual(
  {
    id: astra.id,
    modelId: astra.modelId,
    name: astra.name,
    context: astra.context,
    reasoning: astra.reasoning,
    capabilities: astra.capabilities,
    serviceTier: astra.serviceTier,
  },
  {
    id: 'subscription:gpt-6-astra',
    modelId: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    context: { input: 272_000, output: 128_000 },
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max'],
    capabilities: { images: true, audio: false, pdfFiles: true },
    serviceTier: undefined,
  },
);
assert.deepEqual(
  {
    id: astraFast.id,
    modelId: astraFast.modelId,
    name: astraFast.name,
    serviceTier: astraFast.serviceTier,
  },
  {
    id: 'subscription:gpt-6-astra-fast',
    modelId: 'gpt-6-astra',
    name: 'GPT-6 Astra (Fast)',
    serviceTier: 'priority',
  },
);

assert.deepEqual(astraFast.context, astra.context);
for (const [model, id, name, serviceTier] of [
  [astra1m, 'gpt-6-astra-1m', 'GPT-6 Astra (1M)', undefined],
  [astra1mFast, 'gpt-6-astra-1m-fast', 'GPT-6 Astra (1M) (Fast)', 'priority'],
]) {
  assert.equal(model.id, `subscription:${id}`);
  assert.equal(model.modelId, 'gpt-6-astra');
  assert.equal(model.name, name);
  assert.equal(model.serviceTier, serviceTier);
  assert.deepEqual(model.context, { input: 872_000, output: 128_000 });
  assert.deepEqual(model.reasoning, astra.reasoning);
  assert.deepEqual(model.capabilities, astra.capabilities);
  const variantBody = await responsesApi.createBody({
    provider: subscriptionProvider.config,
    model,
    messages: [{ role: 'user', content: 'Hello' }],
    reasoningEffort: 'max',
    tools: [],
    toolHistory: [],
    invocationContext: { auxiliary: true },
  });
  assert.equal(variantBody.model, 'gpt-6-astra');
  assert.equal(variantBody.service_tier, serviceTier);
}

const astraFastBody = await responsesApi.createBody({
  provider: subscriptionProvider.config,
  model: astraFast,
  messages: [{ role: 'user', content: 'Hello' }],
  reasoningEffort: 'max',
  tools: [],
  toolHistory: [],
  invocationContext: { auxiliary: true },
});
assert.equal(astraFastBody.model, 'gpt-6-astra');
assert.equal(astraFastBody.reasoning.effort, 'max');
assert.equal(astraFastBody.service_tier, 'priority');

for (const api of [chatCompletionsApi, responsesApi]) {
  const emptyBody = await api.createBody({
    provider: {
      ...provider.config,
      temperature: '',
      topK: '',
    },
    model: models[0],
    messages: [{ role: 'user', content: 'Hello' }],
    reasoningEffort: null,
    tools: [],
    toolHistory: [],
    invocationContext: { auxiliary: true },
  });
  assert.equal(Object.hasOwn(emptyBody, 'temperature'), false);
  assert.equal(Object.hasOwn(emptyBody, 'top_k'), false);

  const configuredBody = await api.createBody({
    provider: provider.config,
    model: models[0],
    messages: [{ role: 'user', content: 'Hello' }],
    reasoningEffort: null,
    tools: [],
    toolHistory: [],
    invocationContext: { auxiliary: true },
  });
  assert.equal(configuredBody.temperature, 0.7);
  assert.equal(configuredBody.top_k, 40);
}

assert.throws(
  () => registry.normalizeConfig({
    ...normalized,
    models: normalized.models.map((model) => ({
      ...model,
      instanceId: 'duplicated-instance',
    })),
  }),
  /Model instance ID "duplicated-instance" is duplicated/,
);

console.log('model provider config tests passed');
