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

The OpenAI Subscription catalog exposed by `avi.providers.models.list()` includes `gpt-6-astra` with `context: { input: 272000, output: 128000 }` and `gpt-6-astra-1m` (GPT-6 Astra (1M)) with `context: { input: 872000, output: 128000 }`. Their IDs are qualified by the provider ID. Both use the remote `modelId: 'gpt-6-astra'`; their `-fast` variants retain the same context limits and use `serviceTier: 'priority'`.

## Registering a type

```js
avi.providers.types.register({
  descriptor: {
    id: 'acme-responses',
    name: 'Acme Responses',
    connection: 'custom',
    harness: { session: 'stateless', retries: 'avi' },
  },
  async createBody(context) {},
  async request(context) {},
  eventsFrom(payload, state) {},
  getContributions(context) {
    return { models: [], tools: [], auxiliaryPanels: [], usageProviders: [] };
  },
  async refresh(context) {},
  async releaseSession(context) {},
});
```

## Model listing

Set `descriptor.supportsModelListing: true` and implement `listAvailableModels({ provider, services })` to let users scan the provider's remote catalog from Settings. The handler returns `Array<{ id: string }>`; Avi trims IDs, drops empty values and duplicates, and sorts the result. Registration fails with `VALIDATION_FAILED` when `supportsModelListing` is true but the handler is missing. `types.list()` always returns `supportsModelListing` as a boolean. Built-in OpenAI Compatible types request `GET /v1/models` with the configured API key.

Scanning only discovers IDs; it never changes the saved configuration. Read the list through `provider.listAvailableModels()`, which requires `providers.read` and rejects when the type does not support listing.

`eventsFrom(payload, state)` receives an optional mutable state object isolated to one streaming attempt; it is reset for retries and never shared across concurrent streams. Existing one-argument handlers remain supported. Managed connection state may expose `connection.input` (`id`, `label`, `description`, opaque `sessionId`) for a masked secret field, such as an authorization code or API key, submitted to the primary action, and `connection.secondaryAction` (`id`, `label`) for cancellation. Never return PKCE verifiers, tokens, or keys in renderer-facing state.

`descriptor.id`, `createBody`, `request`, and `eventsFrom` are required. Dynamic provider types participate in ModelProviderRegistry immediately and are removed on dispose.

`refresh({ provider, services })` is optional. Avi awaits it after tentatively persisting a provider configuration and before returning from save. Use it to perform asynchronous model discovery or connection setup, then expose the resulting synchronous catalog from `getContributions()`. If refresh fails, Avi restores the previous provider list and reports the error.

## Harness capabilities

`descriptor.harness` declares which parts of a run the provider covers. Avi keeps every responsibility the provider does not claim.

| Capability | Values | Default | Effect |
| --- | --- | --- | --- |
| `session` | `stateless`, `stateful` | `stateless` | A stateful provider may keep a live model session between rounds and runs. |
| `retries` | `avi`, `provider` | `avi` | With `provider`, normal chats make one attempt and do not replay failures; Goal mode keeps its own recovery retries. |
| `compaction` | `avi` | `avi` | Avi always compacts. Providers must not summarize or drop history on their own and should report context overflow as `context_length_exceeded`. |
| `instructions` | `system`, `context` | `system` | Describes where the provider places Avi's instructions. It is shown to users; Avi's request contract is unchanged. |
| `toolExecution` | `avi` | `avi` | Avi always executes tools, approvals, permissions, and interceptors. Providers return tool calls and never run them. |

Unknown capabilities or values fail registration with `VALIDATION_FAILED`. `types.list()` returns the normalized `harness`, and Settings shows it for the selected provider type.

A stateful provider still receives Avi's complete messages and tool history in every `createBody()` call. Avi remains the source of truth: the provider must compare that history with its session, append only new input, and recreate the session from Avi's history whenever they differ. Avi never restores a provider session from provider-side storage. `invocationContext.conversationId` and `traceOperation` identify which conversation turn a request belongs to; auxiliary requests set `auxiliary: true`.

`releaseSession({ provider, conversationId, reason, services })` is optional and is called only for stateful providers. Avi calls it after compacting a conversation (`reason: 'compaction'`) so the next turn starts from the compaction checkpoint. Providers should also end idle sessions on their own.

## ProviderHandle

Value types `ProviderSnapshot`, `ModelSnapshot`, and `ProviderTypeDescriptor` are defined in [Shared types](./types.md).

```ts
provider.id: string
provider.getSnapshot(): Promise<ProviderSnapshot | null>
provider.getState(): Promise<object>
provider.listAvailableModels(): Promise<Array<{ id: string }>>
provider.update(patch): Promise<ProviderSnapshot>
provider.remove(): Promise<void>
provider.invokeAction(action, input?): Promise<JsonValue>
provider.credentials.has(): Promise<boolean>
provider.credentials.set(credentials): Promise<void>
provider.credentials.clear(): Promise<void>
```

Credentials are write-only and stored through Avi's secure credential service. There is no `credentials.get()` method. Snapshots expose only `hasCredentials`. An `apiKey` supplied during `create()` or `update()` requires `providers.credentials.write`, is moved to secure storage, and is not persisted in the ordinary provider configuration.

Provider creation and updates use ModelProviderRegistry normalization, including interface existence, endpoint rules, model IDs, persistent model instance IDs, and descriptor fields. Multiple model configurations can share the same `id`; Avi generates and preserves each model’s opaque `instanceId`. Secure credentials are merged only when Avi instantiates the provider.

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

Provider type implementations can contribute the same shape from `getContributions()`. Tool entries use the [tool descriptor](tools.md), including optional `forcedTruncationLength` for a per-tool estimated-token output limit.

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
