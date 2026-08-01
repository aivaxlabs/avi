import { traceError } from './trace-log.js';

export const emptyDefaultModels = Object.freeze({
  auxiliary: null,
  supervision: null,
  quickChat: null,
  subagents: Object.freeze({
    enabled: false,
    small: null,
    medium: null,
    large: null,
  }),
});

const roleLabels = Object.freeze({
  auxiliary: 'Auxiliary model',
  supervision: 'Supervision model',
  quickChat: 'Quick chat model',
  small: 'Small sub-agent model',
  medium: 'Medium sub-agent model',
  large: 'Large sub-agent model',
});

export function normalizeDefaultModels(value, strict = false) {
  const source = value && typeof value === 'object' ? value : {};
  const subagents = source.subagents && typeof source.subagents === 'object'
    ? source.subagents
    : {};
  const normalized = {
    auxiliary: normalizeSelection(source.auxiliary),
    supervision: normalizeSelection(source.supervision),
    quickChat: normalizeSelection(source.quickChat),
    subagents: {
      enabled: subagents.enabled === true,
      small: normalizeSelection(subagents.small),
      medium: normalizeSelection(subagents.medium),
      large: normalizeSelection(subagents.large),
    },
  };

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
    ...(normalized.subagents.enabled ? [
      ['small', normalized.subagents.small],
      ['medium', normalized.subagents.medium],
      ['large', normalized.subagents.large],
    ] : []),
  ];

  return configured.flatMap(([role, selection]) => {
    const availability = inspectSelection(selection, modelsById);
    if (availability.available || (!selection && ['auxiliary', 'supervision', 'quickChat'].includes(role))) {
      return [];
    }
    const modelId = selection?.modelId ?? 'not selected';
    const unavailableMessage = `${roleLabels[role]} '${modelId}' is unavailable (${availability.reason}).`;
    return [{
      role,
      label: roleLabels[role],
      modelId: selection?.modelId ?? null,
      reason: availability.reason,
      message: ['small', 'medium', 'large'].includes(role)
        ? `${unavailableMessage} The orchestrator model, or the last model used by the system, will be used at runtime.`
        : unavailableMessage,
    }];
  });
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
