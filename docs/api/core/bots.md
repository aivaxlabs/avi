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

Value types `BotSnapshot`, `BotApproval`, `BotPendency`, `BotPendencyMessage`, and `BotActivityEntry` are defined in [Shared types](./types.md). `ThreadHandle` and `ThreadSnapshot` are defined in [Threads](./threads.md) and [Shared types](./types.md).

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
bot.inbox.list(): Promise<BotPendency[]>
bot.inbox.reply(pendencyId, { content, attachments? }): Promise<BotPendencyReply>
bot.inbox.complete(pendencyId): Promise<BotPendency>
bot.activity.list(): Promise<BotActivityEntry[]>
bot.approvals.list(): BotApproval[]
bot.approvals.resolve(approvalId, decision): Promise<object>
bot.tools.register(tool): Disposable
```

`activate()` uses BotManager's normal activation path. When it advances the conversation's history boundary, it clears the previous compaction summary and token counter; Inbox and memory provide cross-activation continuity. It does not execute a custom plugin callback in place of the bot runtime. An empty `workQueue` activates without a recurring focus task. `update({ workQueueIndex })` selects the zero-based queue item for the next activation and rejects an index outside the effective queue.

## Inbox and Activity

`inbox.list()` and `activity.list()` return detached persisted snapshots. A pendency is a conversation with the user, not a task board. A reply is recorded as a `user` message and delivered to the bot's main thread inside `<bot-pendency-update>` with the pendency ID and attachments. It uses the priority queue when a run is active and starts a continuation otherwise. The bot answers through its pendency tools, even when it uses workers to prepare that answer.

`reply()` returns `{ item, delivered, error? }`. `delivered: false` means the reply was saved but could not be submitted to the main thread; do not blindly resend it and create a duplicate. `complete()` closes the pendency unless a protected approval is pending. Reading an item does not acknowledge it. An open pendency counts as requiring user action when its last message is from the bot or an explicit approval still waits for a decision.

Activity entries are first-person, self-contained accounts of important work, not automatic logs of routine calls. The two views persist in `inbox.json` and `diary.json` in the isolated bot data folder. Legacy `work-items.json` and `activity.json` are never read or migrated and remain untouched on disk.

Core `inbox.list()` and `activity.list()` retain fail-fast behavior: either file failing validation raises `CONFLICT` with the aggregated load error. The RPC `bots:list` snapshot instead exposes per-section errors and preserves the healthy section for the Bots panel.

The former `bot.workState.get()` method and work-item types have been removed. Plugin API v2 remains the accepted runtime version, but plugins using the old bot-work contract must adopt this Inbox/Activity contract.

## Capabilities

- `bots.read`: list and inspect bots and obtain their thread handles.
- `bots.manage`: create, update, pause, enable, clear, or delete bots; send Inbox replies on the user's behalf and complete pendencies.
- `bots.run`: activate bots.
- `bots.readState`: read Inbox conversations, Activity, and pending approvals.
- `bots.approvals.resolve`: approve or deny a pending bot approval.

Resolving approvals is deliberately separate from bot management because it acts on behalf of the user.
