import { randomUUID } from 'node:crypto';
import { traceError } from './trace-log.js';

export const emptyDefaultModels = Object.freeze({
  auxiliary: null,
  supervision: null,
  quickChat: null,
  compactation: null,
  subagents: Object.freeze({
    enabled: false,
    small: null,
    medium: null,
    large: null,
  }),
  intelligence: Object.freeze({
    levels: Object.freeze([]),
  }),
});

export const intelligenceLimits = Object.freeze({ min: 3, max: 10 });

const roleLabels = Object.freeze({
  auxiliary: 'Auxiliary model',
  supervision: 'Supervision model',
  quickChat: 'Quick chat model',
  compactation: 'Compactation model',
  small: 'Small sub-agent model',
  medium: 'Medium sub-agent model',
  large: 'Large sub-agent model',
});

function normalizeIntelligenceLevels(value) {
  const source = value && typeof value === 'object' ? value : {};
  const levels = Array.isArray(source.levels) ? source.levels : [];
  return levels.slice(0, intelligenceLimits.max).map((level) => {
    const entry = level && typeof level === 'object' ? level : {};
    return {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : randomUUID(),
      modelId: typeof entry.modelId === 'string' ? entry.modelId.trim() : '',
      reasoningEffort: typeof entry.reasoningEffort === 'string' && entry.reasoningEffort.trim()
        ? entry.reasoningEffort.trim()
        : null,
    };
  });
}

export function normalizeDefaultModels(value, strict = false) {
  const source = value && typeof value === 'object' ? value : {};
  const subagents = source.subagents && typeof source.subagents === 'object'
    ? source.subagents
    : {};
  const normalized = {
    auxiliary: normalizeSelection(source.auxiliary),
    supervision: normalizeSelection(source.supervision),
    quickChat: normalizeSelection(source.quickChat),
    compactation: normalizeSelection(source.compactation),
    subagents: {
      enabled: subagents.enabled === true,
      small: normalizeSelection(subagents.small),
      medium: normalizeSelection(subagents.medium),
      large: normalizeSelection(subagents.large),
    },
    intelligence: {
      levels: normalizeIntelligenceLevels(source.intelligence),
    },
  };

  if (strict
    && normalized.intelligence.levels.length > 0
    && normalized.intelligence.levels.length < intelligenceLimits.min) {
    throw new Error(
      `Configure between ${intelligenceLimits.min} and ${intelligenceLimits.max} intelligence levels.`,
    );
  }

  if (strict && normalized.subagents.enabled && [
    normalized.subagents.small,
    normalized.subagents.medium,
    normalized.subagents.large,
  ].some((selection) => !selection)) {
    throw new Error('Choose the small, medium, and large models before enabling sub-agent model levels.');
  }
  return normalized;
}

export function validateDefaultModels(settings, models) {
  const normalized = normalizeDefaultModels(settings);
  const modelsById = new Map(models.map((model) => [model.id, model]));
  const configured = [
    ['auxiliary', normalized.auxiliary],
    ['supervision', normalized.supervision],
    ['quickChat', normalized.quickChat],
    ['compactation', normalized.compactation],
    ...(normalized.subagents.enabled ? [
      ['small', normalized.subagents.small],
      ['medium', normalized.subagents.medium],
      ['large', normalized.subagents.large],
    ] : []),
  ];

  const warnings = configured.flatMap(([role, selection]) => {
    const availability = inspectSelection(selection, modelsById);
    if (availability.available || (!selection && ['auxiliary', 'supervision', 'quickChat', 'compactation'].includes(role))) {
      return [];
    }
    const modelId = selection?.modelId ?? 'not selected';
    const unavailableMessage = `${roleLabels[role]} '${modelId}' is unavailable (${availability.reason}).`;
    return [{
      role,
      label: roleLabels[role],
      modelId: selection?.modelId ?? null,
      reason: availability.reason,
      message: role === 'compactation'
        ? `${unavailableMessage} The chat model will be used to compress the context.`
        : ['small', 'medium', 'large'].includes(role)
          ? `${unavailableMessage} The orchestrator model, or the last model used by the system, will be used at runtime.`
          : unavailableMessage,
    }];
  });

  const levels = normalized.intelligence.levels;
  if (levels.length > 0 && levels.length < intelligenceLimits.min) {
    warnings.push({
      role: 'intelligence',
      label: 'Intelligence levels',
      modelId: null,
      reason: 'invalid level count',
      message: `Configure between ${intelligenceLimits.min} and ${intelligenceLimits.max} intelligence levels to use the intelligence slider.`,
    });
  }
  const levelSelections = new Map();
  levels.forEach((level, index) => {
    if (level.modelId) {
      const model = modelsById.get(level.modelId);
      const effectiveEffort = level.reasoningEffort
        ?? (model?.reasoning.includes('medium') ? 'medium' : model?.reasoning[0] ?? null);
      const selectionKey = JSON.stringify([level.modelId, effectiveEffort]);
      const duplicateIndex = levelSelections.get(selectionKey);
      if (duplicateIndex !== undefined) {
        warnings.push({
          role: 'intelligence',
          label: `Intelligence level ${index + 1}`,
          modelId: level.modelId,
          reason: 'duplicate selection',
          message: `Intelligence levels ${duplicateIndex + 1} and ${index + 1} use the same model and reasoning effort. Choose a different combination for each level.`,
        });
      } else {
        levelSelections.set(selectionKey, index);
      }
    }
    if (!level.modelId) {
      warnings.push({
        role: 'intelligence',
        label: `Intelligence level ${index + 1}`,
        modelId: null,
        reason: 'not selected',
        message: `Intelligence level ${index + 1} has no model selected.`,
      });
      return;
    }
    const availability = inspectSelection(level, modelsById);
    if (!availability.available) {
      warnings.push({
        role: 'intelligence',
        label: `Intelligence level ${index + 1}`,
        modelId: level.modelId,
        reason: availability.reason,
        message: `Intelligence level ${index + 1} is unavailable (${availability.reason}).`,
      });
    }
  });

  return warnings;
}

export function applySubagentModelSchema(tool, models, settings) {
  const inputSchema = structuredClone(tool.inputSchema);
  if (!['chat_create_thread', 'chat_spawn_subagent'].includes(tool.name)) return inputSchema;

  const levelMode = normalizeDefaultModels(settings).subagents.enabled;
  if (levelMode) {
    delete inputSchema.properties.model_name;
    delete inputSchema.properties.reasoning_effort;
    inputSchema.properties.model_level.enum = ['small', 'medium', 'large'];
    inputSchema.required = [...new Set([...(inputSchema.required ?? []), 'model_level'])];
  } else {
    delete inputSchema.properties.model_level;
    inputSchema.properties.model_name.enum = models.map((model) => model.id);
    inputSchema.properties.reasoning_effort.enum = [
      ...new Set(models.flatMap((model) => (
        Array.isArray(model.reasoning) ? model.reasoning : []
      ))),
    ];
  }
  return inputSchema;
}

export function resolveSubagentModel(level, settings, models, fallback) {
  const normalized = normalizeDefaultModels(settings);
  if (!normalized.subagents.enabled) return null;
  if (!['small', 'medium', 'large'].includes(level)) {
    throw new Error('model_level must be small, medium, or large.');
  }

  const modelsById = new Map(models.map((model) => [model.id, model]));
  const requested = normalized.subagents[level];
  const availability = inspectSelection(requested, modelsById);
  if (availability.available) return { ...requested, fallbackUsed: false };

  const normalizedFallback = normalizeSelection(fallback);
  const fallbackAvailability = inspectSelection(normalizedFallback, modelsById);
  if (!fallbackAvailability.available) {
    throw new Error(
      `${roleLabels[level]} '${requested?.modelId ?? 'not selected'}' is unavailable (${availability.reason}); the orchestrator or last-used model fallback is unavailable (${fallbackAvailability.reason}).`,
    );
  }

  traceError('model.fallback-used', {
    model_level: level,
    requested_model: requested?.modelId ?? 'not selected',
    fallback_model: normalizedFallback.modelId,
    error: availability.reason,
  });
  return { ...normalizedFallback, fallbackUsed: true };
}

function normalizeSelection(value) {
  if (!value || typeof value !== 'object') return null;
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  if (!modelId) return null;
  const reasoningEffort = typeof value.reasoningEffort === 'string'
    && value.reasoningEffort.trim()
    ? value.reasoningEffort.trim()
    : null;
  return { modelId, reasoningEffort };
}

function inspectSelection(selection, modelsById) {
  if (!selection) return { available: false, reason: 'not selected' };
  const model = modelsById.get(selection.modelId);
  if (!model) return { available: false, reason: 'model or provider is disabled or missing' };
  if (
    selection.reasoningEffort
    && (!Array.isArray(model.reasoning) || !model.reasoning.includes(selection.reasoningEffort))
  ) {
    return {
      available: false,
      reason: `reasoning effort '${selection.reasoningEffort}' is not supported`,
    };
  }
  return { available: true, reason: null };
}
