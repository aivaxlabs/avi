import {
  getMessage,
  updateQueuedMessageOrder,
} from '../database.js';

export function partitionPendingItems(items) {
  const steer = [];
  const queue = [];
  for (const item of items) {
    (getMessage(item.userMessageId)?.status === 'steered' ? steer : queue).push(item);
  }
  return { steer, queue };
}

export function orderPendingItems(items) {
  const { steer, queue } = partitionPendingItems(items);
  return [...steer, ...queue];
}

export function pendingOrder(items) {
  const { steer, queue } = partitionPendingItems(items);
  return {
    steerMessageIds: steer.map((item) => item.userMessageId),
    queuedMessageIds: queue.map((item) => item.userMessageId),
    messageIds: [...steer, ...queue].map((item) => item.userMessageId),
  };
}

export function persistPendingOrder(conversationId, items) {
  const order = pendingOrder(items);
  updateQueuedMessageOrder(conversationId, order);
  return order;
}

export function queueOrderEvent(order) {
  return { type: 'queue-order', ...order };
}

export function compatibleSteeredItems(items) {
  const steeredItems = partitionPendingItems(items).steer;
  const first = steeredItems[0];
  if (!first) return [];
  const compatible = [];
  for (const item of steeredItems) {
    if (
      item.model !== first.model
      || item.reasoningEffort !== first.reasoningEffort
      || item.permissionMode !== first.permissionMode
      || item.workMode !== first.workMode
      || item.ultraMode !== first.ultraMode
      || item.goalId !== first.goalId
    ) break;
    compatible.push(item);
  }
  return compatible;
}
