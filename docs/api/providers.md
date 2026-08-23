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
```

Capabilities:

- `providers.read`: list types, configurations, models, state, and credential presence.
- `providers.manage`: create, update, invoke actions, or remove configurations.
- `providers.types.register`: register a provider implementation.
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
    return { models: [], tools: [], auxiliaryPanels: [] };
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
