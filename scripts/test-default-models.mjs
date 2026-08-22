import assert from 'node:assert/strict';
import { CLIENT_TOOLS } from '../src/main/client-tools.js';
import {
  applySubagentModelSchema,
  normalizeDefaultModels,
  resolveSubagentModel,
  validateDefaultModels,
} from '../src/main/default-models.js';
import { setTraceLevel } from '../src/main/trace-log.js';

setTraceLevel('disabled');

const models = [
  { id: 'test:small', reasoning: ['low'] },
  { id: 'test:medium', reasoning: ['medium'] },
  { id: 'test:large', reasoning: ['high'] },
  { id: 'test:orchestrator', reasoning: ['medium', 'high'] },
];
const settings = {
  auxiliary: null,
  supervision: null,
  quickChat: null,
  subagents: {
    enabled: true,
    small: { modelId: 'test:small', reasoningEffort: 'low' },
    medium: { modelId: 'test:medium', reasoningEffort: 'medium' },
    large: { modelId: 'test:large', reasoningEffort: 'high' },
  },
};

assert.deepEqual(normalizeDefaultModels(null), {
  auxiliary: null,
  supervision: null,
  quickChat: null,
  subagents: {
    enabled: false,
    small: null,
    medium: null,
    large: null,
  },
});
assert.deepEqual(normalizeDefaultModels({
  subagents: {
    ...settings.subagents,
    fallback: { modelId: 'test:orchestrator', reasoningEffort: 'medium' },
  },
}), settings);
assert.throws(
  () => normalizeDefaultModels({ subagents: { enabled: true } }, true),
  /Choose the small, medium, and large models/,
);
assert.deepEqual(validateDefaultModels(settings, models), []);

const incompleteWarnings = validateDefaultModels({
  ...settings,
  subagents: { ...settings.subagents, small: null },
}, models);
assert.equal(incompleteWarnings.length, 1);
assert.equal(incompleteWarnings[0].role, 'small');
assert.equal(incompleteWarnings[0].reason, 'not selected');
assert.match(incompleteWarnings[0].message, /orchestrator model, or the last model used/);

const auxiliaryWarnings = validateDefaultModels({
  ...settings,
  auxiliary: { modelId: 'test:missing', reasoningEffort: null },
}, models);
assert.equal(auxiliaryWarnings.length, 1);
assert.equal(auxiliaryWarnings[0].role, 'auxiliary');
assert.doesNotMatch(auxiliaryWarnings[0].message, /will be used/);
const quickChatWarnings = validateDefaultModels({
  ...settings,
  quickChat: { modelId: 'test:missing', reasoningEffort: null },
}, models);
assert.equal(quickChatWarnings.length, 1);
assert.equal(quickChatWarnings[0].role, 'quickChat');
assert.equal(quickChatWarnings[0].label, 'Quick chat model');
assert.doesNotMatch(quickChatWarnings[0].message, /will be used/);

assert.deepEqual(resolveSubagentModel('small', settings, models, {
  modelId: 'test:orchestrator',
  reasoningEffort: 'medium',
}), {
  modelId: 'test:small',
  reasoningEffort: 'low',
  fallbackUsed: false,
});
assert.deepEqual(resolveSubagentModel('small', {
  ...settings,
  subagents: {
    ...settings.subagents,
    small: { modelId: 'test:missing', reasoningEffort: null },
  },
}, models, {
  modelId: 'test:orchestrator',
  reasoningEffort: 'medium',
}), {
  modelId: 'test:orchestrator',
  reasoningEffort: 'medium',
  fallbackUsed: true,
});
assert.throws(
  () => resolveSubagentModel('small', {
    ...settings,
    subagents: {
      ...settings.subagents,
      small: { modelId: 'test:missing', reasoningEffort: null },
    },
  }, models, {
    modelId: 'test:missing-orchestrator',
    reasoningEffort: null,
  }),
  /orchestrator or last-used model fallback is unavailable/,
);

for (const name of ['chat_create_thread', 'chat_spawn_subagent']) {
  const tool = CLIENT_TOOLS.find((item) => item.name === name);
  const levelSchema = applySubagentModelSchema(tool, models, settings);
  assert.deepEqual(levelSchema.properties.model_level.enum, ['small', 'medium', 'large']);
  assert.match(
    levelSchema.properties.model_level.description,
    /Select the smallest model level[\s\S]*large only[\s\S]*choose the lower one/,
  );
  assert.ok(levelSchema.required.includes('model_level'));
  assert.equal(levelSchema.properties.model_name, undefined);
  assert.equal(levelSchema.properties.reasoning_effort, undefined);

  const legacySchema = applySubagentModelSchema(tool, models, {
    ...settings,
    subagents: { ...settings.subagents, enabled: false },
  });
  assert.equal(legacySchema.properties.model_level, undefined);
  assert.deepEqual(legacySchema.properties.model_name.enum, models.map((model) => model.id));
  assert.deepEqual(legacySchema.properties.reasoning_effort.enum, ['low', 'medium', 'high']);
}

console.log('Default model tests passed.');
