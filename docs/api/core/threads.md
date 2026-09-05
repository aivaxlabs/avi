# Threads

The threads namespace exposes regular conversations through validated handles.

## Namespace

```ts
avi.threads.list(options?): Promise<Page<ThreadSnapshot>>
avi.threads.get(id, options?): Promise<ThreadHandle | null>
avi.threads.create(input?): Promise<ThreadHandle>
```

`list()` requires `threads.read`. Options support `types`, `archived`, `projectPath`, `limit`, and cursor-based pagination. Use `get(id, { archived: true })` to obtain a restorable handle for an archived thread.

`create()` requires `threads.create` and creates a regular thread only:

```js
const thread = await avi.threads.create({
  title: 'Acme investigation',
  model: 'provider:model',
  projectPath: 'C:\\Code\\repos\\acme',
  orchestrationMode: null,
});
```

## ThreadHandle

Value types `ThreadSnapshot`, `MessageSnapshot`, and `RunSnapshot` are defined in [Shared types](./types.md).

```ts
thread.id: string
thread.getSnapshot(): Promise<ThreadSnapshot>
thread.update(patch): Promise<ThreadSnapshot>
thread.send(input, options?): Promise<RunHandle>
thread.retry(options?): Promise<RunHandle>
thread.stop(): Promise<boolean>
thread.compress(options?): Promise<ThreadSnapshot>
thread.fork(options?): Promise<ThreadHandle>
thread.archive(): Promise<void>
thread.restore(): Promise<void>
thread.delete(options?): Promise<void>
thread.tasks.list(): Promise<ThreadTaskSnapshot[]>
thread.tasks.replace(tasks): Promise<ThreadTaskSnapshot[]>
thread.semaphores.list(): Promise<SemaphoreHoldingSnapshot[]>
thread.semaphores.release(name, count): Promise<SemaphoreReleaseSnapshot>
thread.semaphores.setStatus(name, status, summary?): Promise<SemaphoreHoldingSnapshot>
thread.messages.list(options?): Promise<Page<MessageSnapshot>>
thread.messages.get(messageId): Promise<MessageSnapshot | null>
thread.tools.register(tool): Disposable
thread.events.on(type, listener): Disposable
```

Supported update fields are `title`, `model`, `orchestrationMode`, and `projectPath`.

`fork()` returns a handle whose `id` identifies the new conversation. It preserves the source context checkpoint and remaps its boundary to the copied message, including a hidden boundary. Other hidden messages are not copied. Copied streaming messages become completed snapshots of the partial response; the source run is not changed or resumed in the copy. A fork ending before the checkpoint does not inherit that checkpoint or its token counter.

`retry()` restarts from the latest eligible prompt, using its context checkpoint when compaction already covered it. It rejects if no prompt or checkpoint is available, rather than returning an idle handle after a successful no-op. If the thread already has a live run, it returns that run's handle without enqueueing another retry. Track the returned run and its events; persisted message status is not proof that execution is active.

`thread.tasks.replace()` replaces the complete task list and uses the same limits and normalization as Avi's internal task tool. Use `inconclusive` only for a concrete blocker and provide a non-empty `result`.

`thread.semaphores` can inspect or mutate permits owned by that thread only. `release()` releases the requested owned permits. `setStatus()` accepts `active` or `blocked`; a blocked status requires a concrete summary. Global administrative reset is intentionally not exposed to plugins.

`send()` delegates to ChatRunner, preserving queues, steer behavior, cancellation, MCP readiness, approvals, goals, and bot restrictions:

```js
const run = await thread.send({
  content: 'Inspect the current project state.',
  attachments: [],
}, {
  model: 'provider:model',
  reasoningEffort: 'medium',
  permissionMode: 'approve_for_me',
  workMode: null,
  ultraMode: false,
});

const result = await run.wait();
```

## RunHandle

```ts
run.id: string
run.threadId: string
run.getSnapshot(): Promise<RunSnapshot>
run.wait(): Promise<{ thread, messages }>
run.stop(): Promise<boolean>
run.events.on(type, listener): Disposable
```

A run snapshot reports `threadId`, `startedAt`, `phase`, `model`, and `running`. Runs are in-memory entities; after completion, `getSnapshot()` returns `{ threadId, running: false }`.

## Semaphore namespace

```ts
avi.semaphores.list(): Promise<SemaphoreSnapshot[]>
```

Global semaphore reads require `threads.read`. Snapshots include `waitingCount`, holders, optional blocker summaries, and the FIFO queue. Mutations are intentionally scoped through `thread.semaphores` so a plugin cannot release another thread's permits.

## Capabilities

- `threads.read`: list threads, obtain handles, read snapshots, tasks, semaphore state, and run state.
- `threads.readMessages`: read messages.
- `threads.create`: create or fork a regular thread.
- `threads.update`: update supported metadata, replace tasks, release owned semaphore permits, or change an owned semaphore status.
- `threads.run`: send, retry, stop, compress, or wait for runs.
- `threads.delete`: archive, restore, or delete.

Direct creation of side chats and sub-agents is intentionally not exposed because those conversation types have orchestration invariants.
