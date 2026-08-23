# Providers

The providers namespace separates provider types, user configurations, models, state, actions, and credentials.

## Namespace

```ts
avi.providers.types.list(): ProviderTypeDescriptor[]
avi.providers.types.register(definition): Disposable
avi.providers.list(options?): Promise<Page<ProviderSnapshot>>
avi.providers.get(id): Promise<ProviderHandle | null>
avi.providers.create(input): Promise<ProviderHandle>
avi.providers.models.list(): ModelSnapshot[]
avi.providers.usages.register(definition): Disposable
```

Capabilities:

- `providers.read`: list types, configurations, models, state, and credential presence.
- `providers.manage`: create, update, invoke actions, or remove configurations.
- `providers.types.register`: register a provider implementation.
- `providers.usages.register`: contribute account usage shown beside context usage in the composer.
- `providers.credentials.write`: set or clear credentials.

## Registering a type

```js
avi.providers.types.register({
  descriptor: {
    id: 'acme-responses',
    name: 'Acme Responses',
    connection: 'custom',
  },
  async createBody(context) {},
  async request(context) {},
  eventsFrom(payload) {},
  getContributions(context) {
    return { models: [], tools: [], auxiliaryPanels: [], usageProviders: [] };
  },
});
```

`descriptor.id`, `createBody`, `request`, and `eventsFrom` are required. Dynamic provider types participate in ModelProviderRegistry immediately and are removed on dispose.

## ProviderHandle

Value types `ProviderSnapshot`, `ModelSnapshot`, and `ProviderTypeDescriptor` are defined in [Shared types](./types.md).

```ts
provider.id: string
provider.getSnapshot(): Promise<ProviderSnapshot | null>
provider.getState(): Promise<object>
provider.update(patch): Promise<ProviderSnapshot>
provider.remove(): Promise<void>
provider.invokeAction(action, input?): Promise<JsonValue>
provider.credentials.has(): Promise<boolean>
provider.credentials.set(credentials): Promise<void>
provider.credentials.clear(): Promise<void>
```

Credentials are write-only and stored through Avi's secure credential service. There is no `credentials.get()` method. Snapshots expose only `hasCredentials`. An `apiKey` supplied during `create()` or `update()` requires `providers.credentials.write`, is moved to secure storage, and is not persisted in the ordinary provider configuration.

Provider creation and updates use ModelProviderRegistry normalization, including interface existence, endpoint rules, model IDs, and descriptor fields. Secure credentials are merged only when Avi instantiates the provider.

## Provider usages

Usage providers are application-managed contributions. Users can view them in the composer but cannot add, edit, or remove them. A plugin can register a standalone usage provider during activation:

```js
avi.providers.usages.register({
  id: 'acme-account',
  title: 'Acme usage',
  async load() {
    return {
      accountDetails: 'Team plan',
      limits: [{
        label: 'Weekly requests',
        description: 'Shared across the account.',
        amountConsumed: 0.42,
        resetsAt: new Date('2030-01-01T00:00:00Z'),
        resetList: [{
          resetTitle: 'Banked reset',
          resetDescription: 'Restore the current request window.',
          resetType: 'Credit',
          resetExpiresAt: new Date('2029-12-31T00:00:00Z'),
          async onReset() {
            await consumeReset();
          },
        }],
      }],
      counters: [{
        label: 'Requests today',
        description: 'Successful requests since midnight.',
        valueString: '1,234',
      }],
    };
  },
});
```

`id`, `title`, and `load` are required. `amountConsumed` is a normalized fraction from `0` to `1`. `valueString` is displayed exactly as supplied, so the provider owns number, currency, unit, and locale formatting. Dates accept `Date` instances or values accepted by the JavaScript `Date` constructor.

A limit's resets are not rendered in the main usage list. Avi shows a dedicated resets dialog for that usage provider and requires confirmation before invoking `onReset`. Reset callbacks stay in the Electron main process; the renderer receives only short-lived opaque reset IDs. Refreshing a usage snapshot invalidates its previous reset IDs.

Provider type implementations can contribute the same shape from `getContributions()`:

```js
getContributions({ provider, services }) {
  return {
    models: [],
    tools: [],
    auxiliaryPanels: [],
    usageProviders: [{
      id: 'account',
      title: `${provider.name} usage`,
      load: () => readAccountUsage(provider, services),
    }],
  };
}
```

The registered resource follows ordinary plugin lifecycle cleanup. Runtime registration requires `providers.usages.register`; a usage provider embedded in a provider type requires `providers.types.register` through that provider type registration.
