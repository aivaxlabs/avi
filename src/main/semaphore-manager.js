import {
  getConversation,
  getSemaphoreState,
  setSemaphoreState,
} from './database.js';

const MAX_SEMAPHORE_COUNT = 1_000_000;

function normalizePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEMAPHORE_COUNT) {
    throw new Error(`${field} must be an integer between 1 and ${MAX_SEMAPHORE_COUNT}.`);
  }
  return value;
}

function normalizeName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new Error('name is required.');
  if (name.length > 200) throw new Error('name must not exceed 200 characters.');
  return name;
}

function normalizeState(value) {
  const semaphores = value?.semaphores && typeof value.semaphores === 'object'
    ? value.semaphores
    : {};
  const waiting = value?.waiting && typeof value.waiting === 'object'
    ? value.waiting
    : {};
  return {
    semaphores: Object.assign(Object.create(null), semaphores),
    waiting: Object.assign(Object.create(null), waiting),
  };
}

export class SemaphoreManager {
  constructor({ onChanged = () => {}, onReady = () => {} } = {}) {
    this.onChanged = onChanged;
    this.onReady = onReady;
    this.state = normalizeState(getSemaphoreState());
  }

  snapshot() {
    return Object.values(this.state.waiting)
      .map((waiter) => this.waitSnapshot(waiter.conversationId))
      .filter(Boolean);
  }

  waitSnapshot(conversationId) {
    const waiter = this.state.waiting[conversationId];
    if (!waiter) return null;
    const semaphore = this.state.semaphores[waiter.name];
    const position = semaphore?.queue.indexOf(conversationId) ?? -1;
    if (position < 0) return null;
    return {
      conversationId,
      name: waiter.name,
      count: waiter.count,
      maxCount: waiter.maxCount,
      position: position + 1,
    };
  }

  holdings(conversationId) {
    return Object.entries(this.state.semaphores).flatMap(([name, semaphore]) => {
      const count = semaphore.holders?.[conversationId] ?? 0;
      const blocked = semaphore.blocked?.[conversationId];
      return count > 0 ? [{
        name,
        count,
        maxCount: semaphore.maxCount,
        ...(blocked ? { blocked } : {}),
      }] : [];
    });
  }

  globalSnapshot() {
    return Object.entries(this.state.semaphores).map(([name, semaphore]) => ({
      name,
      maxCount: semaphore.maxCount,
      waitingCount: semaphore.queue?.length ?? 0,
      holders: Object.entries(semaphore.holders ?? {}).map(([conversationId, count]) => {
        const blocked = semaphore.blocked?.[conversationId];
        return {
          conversationId,
          count,
          ...(blocked ? { blocked } : {}),
        };
      }),
      queue: [...(semaphore.queue ?? [])].map((conversationId, index) => ({
        conversationId,
        position: index + 1,
      })),
    }));
  }

  releaseAll(conversationId) {
    const holdings = this.holdings(conversationId);
    if (holdings.length === 0) return [];
    const affected = new Set();
    for (const { name } of holdings) {
      delete this.state.semaphores[name].holders[conversationId];
      delete this.state.semaphores[name].blocked?.[conversationId];
      affected.add(name);
    }
    const ready = [...affected].flatMap((name) => this.drain(name));
    for (const name of affected) this.removeIfEmpty(name);
    this.persist();
    this.notifyReady(ready);
    return holdings;
  }

  reset(name) {
    name = normalizeName(name);
    const semaphore = this.state.semaphores[name];
    if (!semaphore) throw new Error(`Semaphore "${name}" does not exist.`);
    const released = Object.entries(semaphore.holders ?? {}).map(([conversationId, count]) => ({
      conversationId,
      count,
    }));
    semaphore.holders = {};
    semaphore.blocked = {};
    const ready = this.drain(name);
    this.removeIfEmpty(name);
    this.persist();
    this.notifyReady(ready);
    return { name, maxCount: semaphore.maxCount, released, activated: ready.length };
  }

  clear(name) {
    name = normalizeName(name);
    const semaphore = this.state.semaphores[name];
    if (!semaphore) throw new Error(`Semaphore "${name}" does not exist.`);
    const holders = Object.entries(semaphore.holders ?? {}).map(([conversationId, count]) => ({
      conversationId,
      count,
    }));
    const waiting = [...(semaphore.queue ?? [])].map((conversationId, index) => ({
      conversationId,
      count: this.state.waiting[conversationId]?.count ?? 0,
      position: index + 1,
    }));
    for (const { conversationId } of waiting) delete this.state.waiting[conversationId];
    delete this.state.semaphores[name];
    this.persist();
    return { name, maxCount: semaphore.maxCount, holders, waiting };
  }

  acquire({ conversationId, name, count, maxCount, resume = {} }) {
    name = normalizeName(name);
    count = normalizePositiveInteger(count, 'count');
    maxCount = normalizePositiveInteger(maxCount, 'maxCount');
    if (count > maxCount) throw new Error('count must be less than or equal to maxCount.');
    if (this.state.waiting[conversationId]) {
      throw new Error('This thread is already waiting for a semaphore.');
    }

    const semaphore = this.state.semaphores[name] ?? {
      maxCount,
      holders: {},
      queue: [],
    };
    if (semaphore.maxCount !== maxCount) {
      throw new Error(`Semaphore "${name}" already has maxCount ${semaphore.maxCount}.`);
    }
    this.state.semaphores[name] = semaphore;

    const used = Object.values(semaphore.holders).reduce((total, held) => total + held, 0);
    if ((semaphore.holders[conversationId] ?? 0) > 0 && (
      semaphore.queue.length > 0 || used + count > maxCount
    )) {
      throw new Error(`This thread already holds permits from semaphore "${name}" and cannot wait behind itself.`);
    }
    if (semaphore.queue.length === 0 && used + count <= maxCount) {
      semaphore.holders[conversationId] = (semaphore.holders[conversationId] ?? 0) + count;
      this.persist();
      return { acquired: true, name, count, maxCount };
    }

    semaphore.queue.push(conversationId);
    this.state.waiting[conversationId] = {
      conversationId,
      name,
      count,
      maxCount,
      resume,
    };
    this.persist();
    return { acquired: false, ...this.waitSnapshot(conversationId) };
  }

  release({ conversationId, name, count }) {
    name = normalizeName(name);
    count = normalizePositiveInteger(count, 'count');
    const semaphore = this.state.semaphores[name];
    const held = semaphore?.holders?.[conversationId] ?? 0;
    if (held < count) {
      throw new Error(`This thread holds ${held} permit(s) from semaphore "${name}".`);
    }

    if (held === count) {
      delete semaphore.holders[conversationId];
      delete semaphore.blocked?.[conversationId];
    } else {
      semaphore.holders[conversationId] = held - count;
    }
    const ready = this.drain(name);
    this.removeIfEmpty(name);
    this.persist();
    this.notifyReady(ready);
    return { name, released: count, remaining: held - count, activated: ready.length };
  }

  releaseHolder({ conversationId, name }) {
    name = normalizeName(name);
    const semaphore = this.state.semaphores[name];
    if (!semaphore) throw new Error(`Semaphore "${name}" does not exist.`);
    const held = semaphore.holders?.[conversationId] ?? 0;
    if (held < 1) throw new Error(`Thread "${conversationId}" does not hold semaphore "${name}".`);

    delete semaphore.holders[conversationId];
    delete semaphore.blocked?.[conversationId];
    const ready = this.drain(name);
    this.removeIfEmpty(name);
    this.persist();
    this.notifyReady(ready);
    return { name, conversationId, released: held, activated: ready.length };
  }

  setBlocked({ conversationId, name, blocked, summary }) {
    name = normalizeName(name);
    const semaphore = this.state.semaphores[name];
    if ((semaphore?.holders?.[conversationId] ?? 0) < 1) {
      throw new Error(`This thread does not hold permits from semaphore "${name}".`);
    }
    semaphore.blocked ??= {};
    if (blocked) {
      const normalizedSummary = String(summary ?? '').trim();
      if (!normalizedSummary) throw new Error('summary is required when blocking a semaphore.');
      if (normalizedSummary.length > 4000) throw new Error('summary must not exceed 4000 characters.');
      semaphore.blocked[conversationId] = normalizedSummary;
    } else {
      delete semaphore.blocked[conversationId];
    }
    this.persist();
    return this.holdings(conversationId).find((holding) => holding.name === name);
  }

  runNow(conversationId) {
    const waiter = this.removeWaiter(conversationId);
    if (!waiter) throw new Error('This thread is not waiting for a semaphore.');
    const ready = this.drain(waiter.name);
    this.removeIfEmpty(waiter.name);
    this.persist();
    this.notifyReady(ready);
    return waiter;
  }

  cancel(conversationId) {
    const waiter = this.removeWaiter(conversationId);
    if (!waiter) return false;
    const ready = this.drain(waiter.name);
    this.removeIfEmpty(waiter.name);
    this.persist();
    this.notifyReady(ready);
    return true;
  }

  removeConversations(conversationIds) {
    const affected = new Set();
    for (const conversationId of conversationIds) {
      const waiter = this.removeWaiter(conversationId);
      if (waiter) affected.add(waiter.name);
      for (const [name, semaphore] of Object.entries(this.state.semaphores)) {
        if ((semaphore.holders?.[conversationId] ?? 0) > 0) {
          delete semaphore.holders[conversationId];
          delete semaphore.blocked?.[conversationId];
          affected.add(name);
        }
      }
    }
    const ready = [...affected].flatMap((name) => this.drain(name));
    for (const name of affected) this.removeIfEmpty(name);
    if (affected.size > 0) {
      this.persist();
      this.notifyReady(ready);
    }
  }

  cleanMissingConversations() {
    const conversationIds = new Set([
      ...Object.keys(this.state.waiting),
      ...Object.values(this.state.semaphores).flatMap((semaphore) => [
        ...Object.keys(semaphore.holders ?? {}),
        ...(semaphore.queue ?? []),
      ]),
    ]);
    this.removeConversations(
      [...conversationIds].filter((conversationId) => !getConversation(conversationId)),
    );
  }

  removeWaiter(conversationId) {
    const waiter = this.state.waiting[conversationId];
    if (!waiter) return null;
    const semaphore = this.state.semaphores[waiter.name];
    if (semaphore) {
      semaphore.queue = semaphore.queue.filter((id) => id !== conversationId);
    }
    delete this.state.waiting[conversationId];
    return waiter;
  }

  drain(name) {
    const semaphore = this.state.semaphores[name];
    if (!semaphore) return [];
    const ready = [];
    let used = Object.values(semaphore.holders).reduce((total, held) => total + held, 0);
    while (semaphore.queue.length > 0) {
      const conversationId = semaphore.queue[0];
      const waiter = this.state.waiting[conversationId];
      if (!waiter) {
        semaphore.queue.shift();
        continue;
      }
      if (used + waiter.count > semaphore.maxCount) break;
      semaphore.queue.shift();
      delete this.state.waiting[conversationId];
      semaphore.holders[conversationId] = (semaphore.holders[conversationId] ?? 0) + waiter.count;
      used += waiter.count;
      ready.push(waiter);
    }
    return ready;
  }

  removeIfEmpty(name) {
    const semaphore = this.state.semaphores[name];
    if (
      semaphore
      && semaphore.queue.length === 0
      && Object.keys(semaphore.holders).length === 0
    ) delete this.state.semaphores[name];
  }

  persist() {
    setSemaphoreState(this.state);
    this.onChanged(this.snapshot());
  }

  notifyReady(waiters) {
    for (const waiter of waiters) this.onReady(waiter);
  }
}
