import assert from 'node:assert/strict';
import { CLIENT_TOOLS } from '../src/main/client-tools.js';
import {
  applySubagentModelSchema,
  intelligenceLimits,
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
  compactation: null,
  subagents: {
    enabled: true,
    small: { modelId: 'test:small', reasoningEffort: 'low' },
    medium: { modelId: 'test:medium', reasoningEffort: 'medium' },
    large: { modelId: 'test:large', reasoningEffort: 'high' },
  },
  intelligence: { levels: [] },
};

assert.deepEqual(normalizeDefaultModels(null), {
  auxiliary: null,
  supervision: null,
  quickChat: null,
  compactation: null,
  subagents: {
    enabled: false,
    small: null,
    medium: null,
    large: null,
  },
  intelligence: { levels: [] },
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
assert.deepEqual(normalizeDefaultModels({
  ...settings,
  compactation: { modelId: ' test:orchestrator ', reasoningEffort: ' high ' },
}).compactation, { modelId: 'test:orchestrator', reasoningEffort: 'high' });

const intelligenceLevels = [
  { id: 'level-fast', modelId: ' test:small ', reasoningEffort: ' low ' },
  { id: 'level-balanced', modelId: 'test:medium', reasoningEffort: null },
  { id: 'level-max', modelId: 'test:orchestrator', reasoningEffort: 'high' },
  { id: 'level-broken', reasoningEffort: 'high' },
  'invalid',
];
const normalizedIntelligence = normalizeDefaultModels({
  ...settings,
  intelligence: { levels: intelligenceLevels },
}).intelligence.levels;
assert.deepEqual(normalizedIntelligence, [
  { id: 'level-fast', modelId: 'test:small', reasoningEffort: 'low' },
  { id: 'level-balanced', modelId: 'test:medium', reasoningEffort: null },
  { id: 'level-max', modelId: 'test:orchestrator', reasoningEffort: 'high' },
  { id: 'level-broken', modelId: '', reasoningEffort: 'high' },
  { id: normalizedIntelligence[4].id, modelId: '', reasoningEffort: null },
]);
assert.match(normalizedIntelligence[4].id, /^[0-9a-f-]{36}$/);
assert.equal(
  normalizeDefaultModels({
    ...settings,
    intelligence: {
      levels: Array.from({ length: intelligenceLimits.max + 4 }, () => (
        { modelId: 'test:small', reasoningEffort: null }
      )),
    },
  }).intelligence.levels.length,
  intelligenceLimits.max,
);
assert.throws(
  () => normalizeDefaultModels({
    ...settings,
    intelligence: { levels: intelligenceLevels.slice(0, 2) },
  }, true),
  /Configure between 3 and 10 intelligence levels/,
);
const insufficientLevelWarnings = validateDefaultModels({
  ...settings,
  intelligence: { levels: intelligenceLevels.slice(0, 2) },
}, models);
assert.equal(insufficientLevelWarnings.length, 1);
assert.equal(insufficientLevelWarnings[0].reason, 'invalid level count');
assert.match(insufficientLevelWarnings[0].message, /between 3 and 10 intelligence levels/i);
const intelligenceWarnings = validateDefaultModels({
  ...settings,
  intelligence: { levels: intelligenceLevels.slice(0, 4) },
}, models);
assert.equal(intelligenceWarnings.length, 1);
assert.equal(intelligenceWarnings[0].role, 'intelligence');
assert.match(intelligenceWarnings[0].message, /level 4 has no model selected/i);
const unavailableLevelWarnings = validateDefaultModels({
  ...settings,
  intelligence: {
    levels: [
      { modelId: 'test:missing', reasoningEffort: null },
      { modelId: 'test:medium', reasoningEffort: 'xhigh' },
      { modelId: 'test:orchestrator', reasoningEffort: 'high' },
    ],
  },
}, models);
assert.equal(unavailableLevelWarnings.length, 2);
assert.match(unavailableLevelWarnings[0].message, /level 1 is unavailable/i);
assert.match(unavailableLevelWarnings[1].message, /reasoning effort 'xhigh' is not supported/);
const duplicateLevelWarnings = validateDefaultModels({
  ...settings,
  intelligence: {
    levels: [
      { modelId: 'test:orchestrator', reasoningEffort: null },
      { modelId: 'test:orchestrator', reasoningEffort: 'medium' },
      { modelId: 'test:orchestrator', reasoningEffort: 'high' },
    ],
  },
}, models);
assert.equal(duplicateLevelWarnings.length, 1);
assert.equal(duplicateLevelWarnings[0].reason, 'duplicate selection');
assert.match(duplicateLevelWarnings[0].message, /levels 1 and 2 use the same model and reasoning effort/i);

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
const compactationWarnings = validateDefaultModels({
  ...settings,
  compactation: { modelId: 'test:missing', reasoningEffort: null },
}, models);
assert.equal(compactationWarnings.length, 1);
assert.equal(compactationWarnings[0].role, 'compactation');
assert.equal(compactationWarnings[0].label, 'Compactation model');
assert.match(compactationWarnings[0].message, /The chat model will be used to compress the context/);

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
