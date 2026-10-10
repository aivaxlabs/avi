export const capacityMethods = {
  async withThreadCapacity(conversationId, signal, task) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('The run was interrupted.');
    }
    const holder = Symbol(conversationId);
    if (this.capacityQueue.length > 0 || this.capacityHolders.size >= this.threadCapacityLimit()) {
      await new Promise((resolve, reject) => {
        const waiter = { conversationId, holder, signal, resolve };
        waiter.cancel = () => {
          this.capacityQueue = this.capacityQueue.filter((item) => item !== waiter);
          this.emit(conversationId, { type: 'capacity-waiting', waiting: false });
          this.emitCapacityPositions();
          reject(signal.reason instanceof Error ? signal.reason : new Error('The run was interrupted.'));
        };
        signal.addEventListener('abort', waiter.cancel, { once: true });
        this.capacityQueue.push(waiter);
        this.emitCapacityPositions();
      });
    } else {
      this.capacityHolders.add(holder);
    }

    try {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('The run was interrupted.');
      }
      return await task();
    } finally {
      this.capacityHolders.delete(holder);
      this.grantThreadCapacity();
    }
  },

  threadCapacityLimit() {
    return this.getPreferences().tuning?.maxParallelThreads ?? 1;
  },

  grantThreadCapacity() {
    const granted = [];
    while (this.capacityQueue.length > 0 && this.capacityHolders.size < this.threadCapacityLimit()) {
      const waiter = this.capacityQueue.shift();
      waiter.signal.removeEventListener('abort', waiter.cancel);
      this.capacityHolders.add(waiter.holder);
      this.emit(waiter.conversationId, { type: 'capacity-waiting', waiting: false });
      granted.push(waiter);
    }
    if (granted.length === 0) return;
    this.emitCapacityPositions();
    for (const waiter of granted) waiter.resolve();
  },

  emitCapacityPositions() {
    for (const { conversationId, position } of this.capacitySnapshot()) {
      this.emit(conversationId, { type: 'capacity-waiting', waiting: true, position });
    }
  },

  capacitySnapshot() {
    return this.capacityQueue.map((waiter, index) => ({
      conversationId: waiter.conversationId,
      position: index + 1,
    }));
  },
};
