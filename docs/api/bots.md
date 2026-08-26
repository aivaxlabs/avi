# Bots

The bots namespace delegates all state changes to BotManager, preserving scheduling, runtime markers, folders, approvals, and thread ownership.

## Namespace

```ts
avi.bots.list(options?): Promise<Page<BotSnapshot>>
avi.bots.get(id): Promise<BotHandle | null>
avi.bots.create(input): Promise<BotHandle>
```

Example:

```js
const bot = await avi.bots.create({
  name: 'Acme Monitor',
  workingFolder: 'C:\\Code\\repos\\acme',
  model: 'provider:model',
  reasoningEffort: 'medium',
  instructions: 'Monitor the Acme integration and organize investigations.',
  workQueue: ['Review integration health', 'Triage open failures'],
  activationPeriodMinutes: 30,
  activationMode: 'static',
  maxActivations: 10,
  enabled: true,
});
```

## BotHandle

Value types `BotSnapshot`, `BotApproval`, `BotWorkItem`, `BotActivityEntry`, and `BotWorkState` are defined in [Shared types](./types.md). `ThreadHandle` and `ThreadSnapshot` are defined in [Threads](./threads.md) and [Shared types](./types.md).

```ts
bot.id: string
bot.getSnapshot(): Promise<BotSnapshot>
bot.update(patch): Promise<BotSnapshot>
bot.activate(options?): Promise<ThreadHandle>
bot.pause(): Promise<BotSnapshot>
bot.resume(): Promise<BotSnapshot>
bot.enable(): Promise<BotSnapshot>
bot.disable(): Promise<BotSnapshot>
bot.getThread(): Promise<ThreadHandle>
bot.clearThread(): Promise<ThreadSnapshot>
bot.delete(): Promise<boolean>
bot.workState.get(): Promise<BotWorkState>
bot.approvals.list(): BotApproval[]
bot.approvals.resolve(approvalId, decision): Promise<object>
bot.tools.register(tool): Disposable
```

`activate()` uses BotManager's normal activation path. It does not execute a custom plugin callback in place of the bot runtime. A bot with an empty `workQueue` is not activated.

## Capabilities

- `bots.read`: list and inspect bots and obtain their thread handles.
- `bots.manage`: create, update, pause, enable, clear, or delete bots.
- `bots.run`: activate bots.
- `bots.readState`: read durable work items, activity, worker state, and pending approvals.
- `bots.approvals.resolve`: approve or deny a pending bot approval.

Resolving approvals is deliberately separate from bot management because it acts on behalf of the user.
