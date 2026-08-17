import assert from 'node:assert/strict';
import { rankAivaxPricingModels } from '../src/main/model-pricing.js';

const catalog = [
  { name: '@openai/gpt-5.6-sol' },
  { name: '@openai/gpt-5.6-sol:pro' },
  { name: '@openai/gpt-5.6-terra' },
  { name: '@openai/gpt-5' },
  { name: '@anthropic/gpt-5.6' },
];

for (const modelId of [
  'gpt-5.6-sol',
  'openai/gpt-5.6-sol',
  '@openai/gpt-5-6-sol',
]) {
  assert.equal(
    rankAivaxPricingModels(modelId, catalog, 'openai')[0]?.name,
    '@openai/gpt-5.6-sol',
    modelId,
  );
}

assert.equal(
  rankAivaxPricingModels('gpt-5.6', catalog, 'openai')[0]?.name,
  '@openai/gpt-5.6-sol',
  'provider affinity must win over a textually exact model from another provider',
);
assert.deepEqual(
  rankAivaxPricingModels('gpt-5.6-sol', catalog, 'openai').map(({ name }) => name),
  [
    '@openai/gpt-5.6-sol',
    '@openai/gpt-5.6-sol:pro',
    '@openai/gpt-5',
    '@openai/gpt-5.6-terra',
    '@anthropic/gpt-5.6',
  ],
  'all catalog models remain available and are ordered by proximity',
);

console.log('Model pricing matching tests passed.');
