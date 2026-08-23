import { randomUUID } from 'node:crypto';

export class ProviderUsageService {
  constructor({ providerRegistry, pluginRuntime, getApplicationUsageProviders = () => [] }) {
    this.providerRegistry = providerRegistry;
    this.pluginRuntime = pluginRuntime;
    this.getApplicationUsageProviders = getApplicationUsageProviders;
    this.resetActions = new Map();
  }

  list() {
    return [
      ...this.getApplicationUsageProviders().map(({ load: _load, ...descriptor }) => descriptor),
      ...this.providerRegistry.listUsageProviders(),
      ...this.pluginRuntime.listUsageProviders(),
    ];
  }

  async read(usageProviderId) {
    const descriptor = this.list().find((item) => item.id === usageProviderId);
    if (!descriptor) throw new Error('The usage provider is unavailable.');

    const applicationUsageProvider = this.getApplicationUsageProviders().find(
      (item) => item.id === usageProviderId,
    );
    const pluginUsageProvider = this.pluginRuntime.getUsageProvider(usageProviderId);
    const value = applicationUsageProvider
      ? await applicationUsageProvider.load()
      : pluginUsageProvider
        ? await pluginUsageProvider.handlers.load()
        : await this.providerRegistry.readUsageProvider(usageProviderId);
    return this.#normalize(descriptor, value);
  }

  #normalize(descriptor, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Usage provider "${descriptor.title}" returned an invalid snapshot.`);
    }

    for (const [id, action] of this.resetActions) {
      if (action.usageProviderId === descriptor.id) this.resetActions.delete(id);
    }

    const accountDetails = String(value.accountDetails ?? '').trim();
    if (!accountDetails) {
      throw new Error(`Usage provider "${descriptor.title}" requires accountDetails.`);
    }
    if (!Array.isArray(value.limits)) {
      throw new Error(`Usage provider "${descriptor.title}" limits must be an array.`);
    }
    if (!Array.isArray(value.counters)) {
      throw new Error(`Usage provider "${descriptor.title}" counters must be an array.`);
    }

    return {
      id: descriptor.id,
      title: descriptor.title,
      accountDetails,
      limits: value.limits.map((limit, limitIndex) => {
        const label = String(limit?.label ?? '').trim();
        const amountConsumed = Number(limit?.amountConsumed);
        if (!label) throw new Error(`Usage limit ${limitIndex + 1} requires a label.`);
        if (!Number.isFinite(amountConsumed) || amountConsumed < 0 || amountConsumed > 1) {
          throw new Error(`Usage limit "${label}" amountConsumed must be between 0 and 1.`);
        }
        const resetsAt = limit.resetsAt == null ? null : new Date(limit.resetsAt);
        if (resetsAt && Number.isNaN(resetsAt.getTime())) {
          throw new Error(`Usage limit "${label}" resetsAt must be a valid date.`);
        }
        const resetList = limit.resetList ?? [];
        if (!Array.isArray(resetList)) {
          throw new Error(`Usage limit "${label}" resetList must be an array.`);
        }
        return {
          label,
          description: limit.description == null ? null : String(limit.description),
          amountConsumed,
          resetsAt: resetsAt?.toISOString() ?? null,
          resetList: resetList.map((reset, resetIndex) => {
            if (typeof reset?.onReset !== 'function') {
              throw new Error(`Reset ${resetIndex + 1} for "${label}" requires onReset.`);
            }
            const id = randomUUID();
            const expiresAt = reset.resetExpiresAt == null
              ? null
              : new Date(reset.resetExpiresAt);
            if (expiresAt && Number.isNaN(expiresAt.getTime())) {
              throw new Error(`Reset ${resetIndex + 1} for "${label}" has an invalid resetExpiresAt.`);
            }
            this.resetActions.set(id, {
              usageProviderId: descriptor.id,
              onReset: reset.onReset,
            });
            return {
              id,
              title: reset.resetTitle == null ? null : String(reset.resetTitle),
              description: reset.resetDescription == null
                ? null
                : String(reset.resetDescription),
              type: reset.resetType == null ? null : String(reset.resetType),
              expiresAt: expiresAt?.toISOString() ?? null,
            };
          }),
        };
      }),
      counters: value.counters.map((counter, counterIndex) => {
        const label = String(counter?.label ?? '').trim();
        if (!label) throw new Error(`Usage counter ${counterIndex + 1} requires a label.`);
        if (typeof counter.valueString !== 'string') {
          throw new Error(`Usage counter "${label}" requires valueString.`);
        }
        return {
          label,
          description: counter.description == null ? null : String(counter.description),
          valueString: counter.valueString,
        };
      }),
    };
  }

  async reset(usageProviderId, resetId) {
    const action = this.resetActions.get(resetId);
    if (!action || action.usageProviderId !== usageProviderId) {
      throw new Error('This usage reset is unavailable. Refresh provider usage and try again.');
    }
    this.resetActions.delete(resetId);
    const result = await action.onReset();
    const descriptor = this.list().find((item) => item.id === usageProviderId);
    if (!descriptor) throw new Error('The usage provider is unavailable.');
    return {
      usage: result?.usage
        ? this.#normalize(descriptor, result.usage)
        : await this.read(usageProviderId),
      message: typeof result?.message === 'string' ? result.message : null,
    };
  }
}
