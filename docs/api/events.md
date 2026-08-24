# Events

`avi.events` is an observational event bus. Listeners cannot cancel or modify application behavior.

```js
const subscription = avi.events.on(
  'inference.turn.started',
  (event) => console.log(event.threadId, event.data.round),
  { filter: { threadId: 'thread-id' } },
);
```

Registration requires `events.subscribe` and returns a `Disposable`.

## Envelope

```ts
interface AviEvent<T> {
  id: string;
  type: string;
  version: 1;
  timestamp: string;
  pluginId?: string;
  threadId?: string;
  runId?: string;
  botId?: string;
  providerId?: string;
  data: T;
}
```

Payloads are detached JSON-like snapshots. Listener errors are logged and do not affect the host operation.

## Implemented event families

```text
thread.created
thread.updated
thread.queue.changed
thread.tasks.changed
thread.work-status.changed
message.updated
message.deleted
run.started
run.state.changed
run.completed
run.error
inference.request.started
inference.request.completed
inference.request.failed
inference.turn.started
inference.turn.completed
inference.turn.failed
inference.delta
tool.approval.requested
tool.approval.resolved
tool.approval.cancelled
question.requested
question.cancelled
mcp.waiting.changed
semaphore.state.changed
plugin.activated
plugin.deactivated
bot.updated
bot.work-state
```

Unknown internal chat event types are exposed under `chat.<normalized-type>` so observers can log them without changing execution.

### Conceptual work events

`thread.tasks.changed` uses this payload:

```ts
{
  type: 'tasks';
  conversationId: string;
  tasks: ThreadTaskSnapshot[];
}
```

`thread.work-status.changed` uses this payload:

```ts
{
  type: 'block-state';
  conversationId: string;
  blocked: boolean;
}
```

`semaphore.state.changed` includes both the current waits and global semaphore snapshots:

```ts
{
  type: 'semaphore-state';
  waits: Array<{
    conversationId: string;
    name: string;
    count: number;
    maxCount: number;
    position: number;
  }>;
  semaphores: SemaphoreSnapshot[];
}
```

## Content access

`events.subscribe` exposes lifecycle metadata. Message content, attachments, edits, and segments require `events.readContent`. Reasoning segments and reasoning deltas require `events.readReasoning`.

Without those capabilities, sensitive fields or inference deltas are replaced with redacted metadata. Task events retain only `{ done, status }`, and semaphore holder blocker summaries become `blocked: true`.

## Scoped subscriptions

`thread.events.on(type, listener)` and `run.events.on(type, listener)` register the same event listener with a fixed `threadId` filter.

Use [tool interceptors](./interceptors.md) when behavior must be modified.
