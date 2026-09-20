import { rankAivaxPricingModels } from './model-pricing.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function messageTokens(message) {
  const usage = message.usage ?? {};
  const inputTokens = finiteNumber(usage.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, finiteNumber(usage.cachedInputTokens));
  const outputTokens = finiteNumber(usage.outputTokens);
  const reasoningTokens = finiteNumber(usage.reasoningTokens);
  const totalTokens = Number.isFinite(Number(usage.totalTokens))
    ? Number(usage.totalTokens)
    : inputTokens + outputTokens;
  return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens };
}

function costForMessage(message, model, models) {
  const pricing = model?.pricing && typeof model.pricing === 'object'
    ? model
    : rankAivaxPricingModels(model?.modelId ?? model?.id ?? model, models, model?.providerId)[0] ?? null;
  const tiers = Array.isArray(pricing?.pricing)
    ? [...pricing.pricing].sort(
      (left, right) => finiteNumber(right.tokenThreshold) - finiteNumber(left.tokenThreshold),
    )
    : pricing?.pricing && typeof pricing.pricing === 'object'
      ? [pricing.pricing]
      : [];
  const tokens = messageTokens(message);
  const tier = tiers.find((item) => tokens.inputTokens >= finiteNumber(item.tokenThreshold));
  const inputRate = tier?.inputPerMillionTokens;
  const cachedRate = tier?.cachedInputPerMillionTokens;
  const outputRate = tier?.outputPerMillionTokens;
  const priced = [inputRate, cachedRate, outputRate].every(
    (rate) => rate !== null && rate !== undefined && rate !== '' && Number.isFinite(Number(rate)),
  );
  return {
    cost: priced
      ? (Math.max(0, tokens.inputTokens - tokens.cachedInputTokens) * Number(inputRate)
        + tokens.cachedInputTokens * Number(cachedRate)
        + tokens.outputTokens * Number(outputRate)) / 1_000_000
      : null,
    priced,
  };
}

function descendantsByBot(bots, conversations) {
  const children = new Map();
  const parentById = new Map(conversations.map((conversation) => [conversation.id, conversation.parentConversationId]));
  for (const conversation of conversations) {
    const parentId = conversation.parentConversationId;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(conversation.id);
  }

  const allDescendants = new Map(bots.map((bot) => {
    const rootId = bot.conversationId ?? bot.id;
    const ids = new Set([rootId]);
    const pending = [rootId];
    while (pending.length > 0) {
      for (const childId of children.get(pending.pop()) ?? []) {
        if (ids.has(childId)) continue;
        ids.add(childId);
        pending.push(childId);
      }
    }
    return [bot.id, ids];
  }));
  const depthOf = (rootId) => {
    let depth = 0;
    const seen = new Set();
    for (let current = rootId; parentById.has(current) && !seen.has(current); current = parentById.get(current)) {
      seen.add(current);
      depth += 1;
    }
    return depth;
  };
  const claimed = new Set();
  return new Map([...bots]
    .sort((left, right) => depthOf(right.conversationId ?? right.id) - depthOf(left.conversationId ?? left.id))
    .map((bot) => {
      const ids = new Set([...allDescendants.get(bot.id)].filter((id) => !claimed.has(id)));
      for (const id of ids) claimed.add(id);
      return [bot.id, ids];
    }));
}

function emptyTotals() {
  return {
    createdThreads: 0,
    responses: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    tokens: 0,
    cost: null,
    pricedResponses: 0,
    unpricedResponses: 0,
  };
}

function addMessage(totals, message, model, models) {
  const tokens = messageTokens(message);
  const pricing = costForMessage(message, model, models);
  totals.responses += 1;
  totals.inputTokens += tokens.inputTokens;
  totals.cachedInputTokens += tokens.cachedInputTokens;
  totals.outputTokens += tokens.outputTokens;
  totals.reasoningTokens += tokens.reasoningTokens;
  totals.tokens += tokens.totalTokens;
  if (pricing.priced) {
    totals.cost = (totals.cost ?? 0) + pricing.cost;
    totals.pricedResponses += 1;
  } else {
    totals.unpricedResponses += 1;
  }
}

function normalizeTime(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildBotStatistics({
  bots = [],
  conversations = [],
  messages = [],
  models = [],
  days = 7,
  now = Date.now(),
} = {}) {
  if (![1, 7, 30].includes(days)) {
    throw new RangeError('days must be one of 1, 7, or 30.');
  }
  const safeDays = days;
  const end = normalizeTime(now) ?? Date.now();
  const from = end - safeDays * DAY_MS;
  const to = end;
  const inRange = (value) => {
    const timestamp = normalizeTime(value);
    return timestamp !== null && timestamp >= from && timestamp <= to;
  };
  const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const botDescendants = descendantsByBot(bots, conversations);
  const uniqueMessages = new Map();
  for (const message of messages) {
    const key = message.id ?? `${message.conversationId}:${message.createdAt}:${message.model}`;
    if (!uniqueMessages.has(key)) uniqueMessages.set(key, message);
  }
  const messagesByConversation = new Map();
  for (const message of uniqueMessages.values()) {
    if (!messagesByConversation.has(message.conversationId)) messagesByConversation.set(message.conversationId, []);
    messagesByConversation.get(message.conversationId).push(message);
  }

  const firstUtcDate = Date.UTC(
    new Date(from).getUTCFullYear(),
    new Date(from).getUTCMonth(),
    new Date(from).getUTCDate(),
  );
  const lastUtcDate = Date.UTC(
    new Date(to).getUTCFullYear(),
    new Date(to).getUTCMonth(),
    new Date(to).getUTCDate(),
  );
  const timeline = Array.from({ length: Math.floor((lastUtcDate - firstUtcDate) / DAY_MS) + 1 }, (_, index) => ({
    date: new Date(firstUtcDate + index * DAY_MS).toISOString().slice(0, 10),
    usageMessages: 0,
    tokens: 0,
    cost: null,
    pricedResponses: 0,
    unpricedResponses: 0,
    bots: [],
  }));
  const timelineByDate = new Map(timeline.map((bucket) => [bucket.date, bucket]));
  const countedConversationIds = new Set();
  const countedMessageKeys = new Set();
  const rows = bots.map((bot) => {
    const totals = emptyTotals();
    const ids = botDescendants.get(bot.id) ?? new Set([bot.conversationId ?? bot.id]);
    totals.createdThreads = conversations.filter((conversation) => {
      if (!ids.has(conversation.id) || conversation.id === (bot.conversationId ?? bot.id)
        || !inRange(conversation.createdAt) || countedConversationIds.has(conversation.id)) return false;
      countedConversationIds.add(conversation.id);
      return true;
    }).length;
    for (const conversationId of ids) {
      for (const message of messagesByConversation.get(conversationId) ?? []) {
        const messageKey = message.id ?? `${message.conversationId}:${message.createdAt}:${message.model}`;
        if (countedMessageKeys.has(messageKey)
          || !inRange(message.createdAt) || message.role === 'user' || message.role === 'system' || message.hidden) continue;
        countedMessageKeys.add(messageKey);
        const conversation = conversationById.get(conversationId);
        const model = models.find((item) => item?.id === (message.model ?? conversation?.model))
          ?? message.model ?? conversation?.model;
        addMessage(totals, message, model, models);
        const bucket = timelineByDate.get(new Date(normalizeTime(message.createdAt)).toISOString().slice(0, 10));
        if (bucket) {
          bucket.usageMessages += 1;
          bucket.tokens += messageTokens(message).totalTokens;
          const cost = costForMessage(message, model, models);
          if (cost.priced) bucket.cost = (bucket.cost ?? 0) + cost.cost;
          bucket.pricedResponses += cost.priced ? 1 : 0;
          bucket.unpricedResponses += cost.priced ? 0 : 1;
          const botUsage = bucket.bots.find((item) => item.id === bot.id) ?? {
            id: bot.id,
            name: bot.name,
            tokens: 0,
            responses: 0,
            cost: null,
            pricedResponses: 0,
            unpricedResponses: 0,
          };
          botUsage.tokens += messageTokens(message).totalTokens;
          botUsage.responses += 1;
          if (cost.priced) botUsage.cost = (botUsage.cost ?? 0) + cost.cost;
          botUsage.pricedResponses += cost.priced ? 1 : 0;
          botUsage.unpricedResponses += cost.priced ? 0 : 1;
          if (!bucket.bots.includes(botUsage)) bucket.bots.push(botUsage);
        }
      }
    }
    if (totals.unpricedResponses > 0) totals.cost = null;
    return {
      id: bot.id,
      name: bot.name,
      conversationId: bot.conversationId ?? bot.id,
      descendants: ids.size,
      scheduleState: bot.scheduleState ?? null,
      running: Boolean(bot.running),
      totals,
    };
  });

  for (const bucket of timeline) {
    if (bucket.unpricedResponses > 0) bucket.cost = null;
    for (const bot of bucket.bots) {
      if (bot.unpricedResponses > 0) bot.cost = null;
    }
  }
  const totals = rows.reduce((result, row) => {
    for (const key of Object.keys(result)) {
      if (key !== 'cost') result[key] += row.totals[key];
    }
    return result;
  }, emptyTotals());
  totals.cost = totals.unpricedResponses === 0
    ? rows.reduce((total, row) => total + (row.totals.cost ?? 0), 0)
    : null;
  return { days: safeDays, from: new Date(from).toISOString(), to: new Date(to).toISOString(), totals, bots: rows, timeline };
}
