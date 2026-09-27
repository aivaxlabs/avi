import { basename } from 'node:path';
import { rankAivaxPricingModels } from './model-pricing.js';

export function resolveOverviewRange(range = {}, now = Date.now()) {
  const defaultFrom = new Date(now);
  defaultFrom.setDate(1);
  defaultFrom.setHours(0, 0, 0, 0);
  const requestedFrom = range?.from == null ? NaN : new Date(range.from).getTime();
  const requestedTo = range?.to == null ? NaN : new Date(range.to).getTime();
  return {
    from: Number.isFinite(requestedFrom) ? requestedFrom : defaultFrom.getTime(),
    to: Number.isFinite(requestedTo) ? requestedTo : now,
  };
}

export function buildOrchestrationOverview({
  allConversations = [],
  messagesByConversation = {},
  extraInferenceUsage = [],
  configuredModels = {},
  modelCatalog = [],
  range = {},
  now = Date.now(),
} = {}) {
  const configuredById = new Map(
    Object.entries(configuredModels).map(([id, model]) => [id, model]),
  );
  const conversations = allConversations
    .filter((conversation) => conversation.conversationType === 'thread' && conversation.createdBy === 'user');
  const { from, to } = resolveOverviewRange(range, now);
  const isInRange = (value) => {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp >= from && timestamp <= to;
  };
  const tasks = conversations.map((conversation) => {
    const messages = (messagesByConversation[conversation.id] ?? []).filter((message) => !message.hidden);
    const latestMessage = messages.at(-1) ?? null;
    const latestAssistant = messages.findLast((message) => message.role === 'assistant') ?? null;
    const goalStatus = conversation.goal?.status ?? null;
    const ongoing = ['active', 'paused'].includes(goalStatus)
      || latestAssistant?.status === 'streaming'
      || latestMessage?.status === 'queued';
    const requiresAttention = !ongoing && (
      goalStatus === 'blocked'
      || ['error', 'aborted'].includes(latestAssistant?.status)
      || ['error', 'aborted'].includes(latestMessage?.status)
    );

    return {
      ...conversation,
      messages,
      latestMessage,
      latestAssistant,
      ongoing,
      requiresAttention,
    };
  });
  const projectDetails = new Map(allConversations.map((conversation) => [
    conversation.projectPath,
    {
      path: conversation.projectPath,
      name: conversation.projectName,
      displayPath: conversation.projectDisplayPath,
    },
  ]));
  const inferenceRecords = [];
  for (const conversation of allConversations) {
    for (const message of messagesByConversation[conversation.id] ?? []) {
      if (message.hidden || message.role !== 'assistant' || !isInRange(message.createdAt)) {
        continue;
      }
      inferenceRecords.push({
        type: conversation.isSubagent
          ? 'subagent'
          : conversation.isRubberDuck
            ? 'supervision'
            : conversation.isBot
              ? 'bot'
              : 'inference',
        model: message.model || conversation.model || 'Unknown model',
        projectPath: conversation.projectPath,
        project: projectDetails.get(conversation.projectPath),
        usage: message.usage,
        createdAt: message.createdAt,
      });
    }
  }
  for (const inference of extraInferenceUsage) {
    const project = projectDetails.get(inference.projectPath) ?? {
      path: inference.projectPath,
      name: inference.projectPath ? basename(inference.projectPath) : 'Unknown project',
      displayPath: inference.projectPath ?? 'Unknown project',
    };
    inferenceRecords.push({ ...inference, project });
  }

  const modelUsage = new Map();
  const pricingModels = new Map();
  const dailyModelUsage = new Map();
  const usageByType = new Map([
    ['subagent', { id: 'subagent', responses: 0, tokens: 0 }],
    ['bot', { id: 'bot', responses: 0, tokens: 0 }],
    ['inference', { id: 'inference', responses: 0, tokens: 0 }],
    ['auxiliary', { id: 'auxiliary', responses: 0, tokens: 0 }],
    ['supervision', { id: 'supervision', responses: 0, tokens: 0 }],
  ]);
  const usageByProject = new Map();

  for (const record of inferenceRecords) {
    const model = record.model;
    const inputTokens = Number(record.usage?.inputTokens) || 0;
    const cachedInputTokens = Number(record.usage?.cachedInputTokens) || 0;
    const outputTokens = Number(record.usage?.outputTokens) || 0;
    const reasoningTokens = Number(record.usage?.reasoningTokens) || 0;
    const totalTokens = Number(record.usage?.totalTokens) || inputTokens + outputTokens;
    const configuredModel = configuredById.get(model);
    const catalogModelId = configuredModel?.modelId ?? model;
    if (!pricingModels.has(model)) {
      pricingModels.set(model, rankAivaxPricingModels(
        catalogModelId,
        modelCatalog,
        configuredModel?.providerId,
      )[0] ?? null);
    }
    const pricedModel = pricingModels.get(model);
    const pricingTiers = Array.isArray(pricedModel?.pricing)
      ? [...pricedModel.pricing].sort(
        (left, right) => Number(right.tokenThreshold || 0) - Number(left.tokenThreshold || 0),
      )
      : [];
    const appliedPricing = pricingTiers.find(
      (pricing) => inputTokens >= Number(pricing.tokenThreshold || 0),
    ) ?? null;
    const inputRate = Number(appliedPricing?.inputPerMillionTokens);
    const cachedInputRate = Number(appliedPricing?.cachedInputPerMillionTokens);
    const outputRate = Number(appliedPricing?.outputPerMillionTokens);
    const hasPricing = Number.isFinite(inputRate)
      && Number.isFinite(cachedInputRate)
      && Number.isFinite(outputRate);
    const recordCost = hasPricing
      ? (
        Math.max(0, inputTokens - cachedInputTokens) * inputRate
        + cachedInputTokens * cachedInputRate
        + outputTokens * outputRate
      ) / 1_000_000
      : 0;
    const displayPricing = pricingTiers.at(-1) ?? null;
    const usage = modelUsage.get(model) ?? {
      id: model,
      messages: 0,
      pricedMessages: 0,
      cost: 0,
      pricing: displayPricing && {
        inputPerMillionTokens: Number(displayPricing.inputPerMillionTokens),
        cachedInputPerMillionTokens: Number(displayPricing.cachedInputPerMillionTokens),
        outputPerMillionTokens: Number(displayPricing.outputPerMillionTokens),
      },
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      durationMs: 0,
      timedMessages: 0,
      tokens: 0,
    };
    usage.messages += 1;
    usage.pricedMessages += hasPricing ? 1 : 0;
    usage.cost += recordCost;
    usage.inputTokens += inputTokens;
    usage.cachedInputTokens += cachedInputTokens;
    usage.outputTokens += outputTokens;
    usage.reasoningTokens += reasoningTokens;
    if (Number.isFinite(record.usage?.durationMs)) {
      usage.durationMs += record.usage.durationMs;
      usage.timedMessages += 1;
    }
    usage.tokens += totalTokens;
    modelUsage.set(model, usage);

    const typeUsage = usageByType.get(record.type);
    if (typeUsage) {
      typeUsage.responses += 1;
      typeUsage.tokens += totalTokens;
    }

    if (record.projectPath) {
      const projectUsage = usageByProject.get(record.projectPath) ?? {
        ...record.project,
        responses: 0,
        tokens: 0,
        latestAt: 0,
      };
      projectUsage.responses += 1;
      projectUsage.tokens += totalTokens;
      projectUsage.latestAt = Math.max(
        projectUsage.latestAt,
        new Date(record.createdAt).getTime() || 0,
      );
      usageByProject.set(record.projectPath, projectUsage);
    }

    const createdAt = new Date(record.createdAt);
    const day = new Date(
      createdAt.getFullYear(),
      createdAt.getMonth(),
      createdAt.getDate(),
    ).getTime();
    const modelsForDay = dailyModelUsage.get(day) ?? new Map();
    const usageForDay = modelsForDay.get(model) ?? { id: model, tokens: 0 };
    usageForDay.tokens += totalTokens;
    modelsForDay.set(model, usageForDay);
    dailyModelUsage.set(day, modelsForDay);
  }

  return {
    metrics: {
      responses: inferenceRecords.length,
      modelsUsed: modelUsage.size,
      tokens: [...modelUsage.values()].reduce((total, usage) => total + usage.tokens, 0),
      inputTokens: [...modelUsage.values()].reduce((total, usage) => total + usage.inputTokens, 0),
      cachedInputTokens: [...modelUsage.values()]
        .reduce((total, usage) => total + usage.cachedInputTokens, 0),
      outputTokens: [...modelUsage.values()].reduce((total, usage) => total + usage.outputTokens, 0),
      reasoningTokens: [...modelUsage.values()]
        .reduce((total, usage) => total + usage.reasoningTokens, 0),
      cost: [...modelUsage.values()].reduce((total, usage) => total + usage.cost, 0),
      pricedResponses: [...modelUsage.values()]
        .reduce((total, usage) => total + usage.pricedMessages, 0),
      topModels: [...modelUsage.values()]
        .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages),
      dailyTokens: [...dailyModelUsage.entries()]
        .sort(([left], [right]) => left - right)
        .map(([date, modelsForDay]) => ({
          date,
          models: [...modelsForDay.values()].sort((a, b) => b.tokens - a.tokens),
        })),
      usageByType: [...usageByType.values()],
      usageByProject: [...usageByProject.values()]
        .sort((a, b) => b.latestAt - a.latestAt)
        .slice(0, 5),
    },
    ongoing: tasks
      .filter((task) => task.ongoing)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map(({ messages, latestMessage, latestAssistant, ongoing, requiresAttention, ...task }) => task),
    requiresAttention: tasks
      .filter((task) => task.requiresAttention)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map(({ messages, latestMessage, latestAssistant, ongoing, requiresAttention, ...task }) => task),
    recentlyCompleted: tasks
      .filter((task) => (
        !task.ongoing
        && !task.requiresAttention
        && (
          task.goal?.status === 'completed'
          || task.latestAssistant?.status === 'completed'
        )
      ))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map(({ messages, latestMessage, latestAssistant, ongoing, requiresAttention, ...task }) => task)
      .slice(0, 8),
  };
}
