import assert from 'node:assert/strict';
import { ModelProviderRegistry } from '../src/main/model-provider.js';
import {
  chatCompletionsApi,
  openAiCompatibleProviderTypes,
  responsesApi,
} from '../src/providers/openai-compatible.js';

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
