# Shared types

Every read API returns detached JSON-like snapshots: plain data with no database rows, service objects, or live references. Timestamps are ISO 8601 strings.

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

## Threads

### ThreadSnapshot

Returned by `avi.threads.list`, `thread.getSnapshot()`, `thread.update()`, and `thread.compress()`.

```ts
interface ThreadSnapshot {
  id: string;
  title: string;
  model: string;
  titleStatus: string;
  projectPath: string;
  projectName: string; // Folder name (or ~/ for home); used in Sidebar conversation tooltips.
  projectDisplayPath: string;
  gitBranch: string | null;
  conversationType: 'thread' | 'side' | 'subagent' | 'bot';
  isSideChat: boolean;
  isSubagent: boolean;
  isBot: boolean;
  createdBy: 'user' | 'agent';
  parentConversationId: string | null;
  initialPrompt: string | null;
  orchestrationMode: 'plan' | 'ultra' | null;
  autoForwardToParent: boolean;
  nextSubagentNameIndex: number;
  contextCheckpoint: string;
  checkpointMessageId: string | null;
  contextTokens: number;
  tags: string[];
  goal: GoalSnapshot | null;
  tasks: ThreadTaskSnapshot[];
  semaphoreHoldings: SemaphoreHoldingSnapshot[];
  workStatus: 'blocked' | null;
  firstPrompt: string;
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  isArchived: boolean;
}
```

`workStatus` is `blocked` when the Goal is blocked, an internal task is inconclusive, or an owned semaphore is blocked. It is otherwise `null`.

### ThreadTaskSnapshot

Returned in `ThreadSnapshot.tasks` and by `thread.tasks.list()` / `thread.tasks.replace()`.

```ts
interface ThreadTaskSnapshot {
  title: string;
  description: string;
  done: boolean;
  status: 'pending' | 'completed' | 'inconclusive';
  result: string | null;
}
```

`done` is retained for compatibility and is always equivalent to `status === 'completed'`. An `inconclusive` task requires a non-empty `result` explaining the concrete blocker.

### SemaphoreHoldingSnapshot

Returned in `ThreadSnapshot.semaphoreHoldings` and by `thread.semaphores.list()`.

```ts
interface SemaphoreHoldingSnapshot {
  name: string;
  count: number;
  maxCount: number;
  blocked?: string;
}
```

`blocked` contains the blocker summary only when the holder is blocked.

### SemaphoreReleaseSnapshot

Returned by `thread.semaphores.release()`.

```ts
interface SemaphoreReleaseSnapshot {
  name: string;
  released: number;
  remaining: number;
  activated: number;
}
```

### SemaphoreSnapshot

Returned by `avi.semaphores.list()`.

```ts
interface SemaphoreSnapshot {
  name: string;
  maxCount: number;
  waitingCount: number;
  holders: Array<{
    conversationId: string;
    count: number;
    blocked?: string;
  }>;
  queue: Array<{
    conversationId: string;
    position: number;
  }>;
}
```

### GoalSnapshot

Attached to `ThreadSnapshot.goal` when the thread runs under a Goal.

```ts
interface GoalSnapshot {
  id: string;
  conversationId: string;
  specification: string;
  status: string;
  revision: number;
  model: string;
  reasoningEffort: string | null;
  permissionMode: string;
  activeElapsedMs: number;
  resumedAt: string | null;
  resultSummary: string | null;
  tokensTransacted: number | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}
```

### MessageSnapshot

Returned by `thread.messages.list()` and `thread.messages.get()`.

```ts
interface MessageSnapshot {
  id: string;
  conversationId: string;
  role: string;
  model: string | null;
  reasoningEffort: string | null;
  permissionMode: 'ask_for_approval' | 'approve_for_me' | 'full_access' | null;
  workMode: 'plan' | 'goal' | null;
  ultraMode: boolean;
  goalId: string | null;
  hidden: boolean;
  fromAgent: boolean;
  queuePriority: boolean;
  queuePosition: number | null;
  stoppedByUser: boolean;
  status: string;
  content: string;
  segments: JsonValue[];
  edits: JsonValue[];
  attachments: JsonValue[];
  continuations: JsonValue[];
  usage: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}
```

### RunSnapshot

Returned by `run.getSnapshot()`. Runs are in-memory; after completion only the stopped shape is available.

```ts
type RunSnapshot =
  | { threadId: string; running: true; startedAt: string; phase: string; model: string | null }
  | { threadId: string; running: false };
```

## Bots

### BotSnapshot

Returned by `avi.bots.list`, `bot.getSnapshot()`, and every bot state mutation.

```ts
interface BotSnapshot {
  id: string;
  conversationId: string;
  name: string;
  iconSeed: string;
  personality: string | null;
  workingFolder: string | null;
  model: string;
  reasoningEffort: string | null;
  contextSize: number | null;
  activationPeriodMinutes: number;
  activationMode: 'static' | 'smart';
  maxActivations: number;
  activationWindow: {
    days: number[];
    startMinute?: number;
    endMinute?: number;
  };
  instructions: string;
  workQueue: string[];
  /** Zero-based index of the task selected by the next activation. */
  workQueueIndex: number;
  enabled: boolean;
  status: 'active' | 'sleeping' | 'paused';
  nextActivationAt: string | null;
  idleUntil: string | null;
  activationCount: number;
  activeAssistantMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`activationWindow.days` uses `0` (Sunday) through `6` (Saturday); minutes are counted from midnight. `workQueue` is processed round-robin in array order. Empty queues activate without a recurring focus task. Updating the queue resets `workQueueIndex` to `0`, while updating `workQueueIndex` selects the item used by the next activation.

### BotApproval

Returned by `bot.approvals.list()` and embedded in its protected Inbox pendency while a bot waits for an explicit human decision.

```ts
interface BotApproval {
  id: string;
  botId: string;
  pendencyId: string;
  kind: 'work' | 'tool';
  context: string;
  prompt: string;
  status: 'pending';
  toolName?: string;
  workspacePath?: string;
  input?: JsonValue;
  createdAt: string;
  updatedAt: string;
}
```

### BotPendencyMessage

```ts
interface BotPendencyMessage {
  id: string;
  role: 'bot' | 'user';
  content: string;
  attachments: Attachment[];
  createdAt: string;
}
```

`createdAt` is an ISO 8601 timestamp including the date and time. Attachments use the existing [Attachment](../rpc/types.md#attachment) descriptor. A message requires non-empty content or an attachment.

### BotPendency

```ts
interface BotPendency {
  id: string;
  title: string;
  status: 'open' | 'completed';
  messages: BotPendencyMessage[];
  approval: BotApproval | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface BotPendencyReply {
  item: BotPendency;
  delivered: boolean;
  error?: string;
}
```

A new bot message reopens the pendency. A user reply leaves it open, waiting for the bot, except that protected approvals still need an explicit decision. Completion sets `completedAt`; it cannot bypass a pending approval.

### BotActivityEntry

```ts
interface BotActivityEntry {
  id: string;
  title: string;
  description: string;
  category: 'progress' | 'discovery' | 'decision' | 'completed' | 'failure';
  createdAt: string;
}
```

Activity is an explicitly written, self-contained diary. Creating, replying to, or completing a pendency does not automatically add an activity entry.

## Providers

### ProviderSnapshot

Returned by `avi.providers.list`, `provider.getSnapshot()`, and `provider.update()`. API keys are never included; `hasCredentials` reports whether one is stored. Descriptor-specific fields appear as extra string properties.

```ts
interface ProviderSnapshot {
  id: string;
  name: string;
  baseUrl: string;
  interface: string;
  enabled: boolean;
  models: ModelConfig[];
  hasCredentials: boolean;
  [fieldId: string]: JsonValue;
}

interface ModelConfig {
  id: string;
  instanceId: string;
  name: string;
  enabled: boolean;
  capabilities: {
    images: boolean;
    audio: boolean;
    pdfFiles: boolean;
    video: boolean;
  };
  context: { input: number; output: number };
  reasoning: string[];
}
```

### ModelSnapshot

Returned by `avi.providers.models.list()`. Each model is globally qualified as `providerId:instanceId`; `modelId` is the configured value sent to inference. Avi generates and preserves `instanceId`, and callers should treat it as opaque.

```ts
interface ModelSnapshot extends ModelConfig {
  id: `${string}:${string}`;
  modelId: string;
  providerId: string;
  providerName: string;
  interface: string;
  endpoint?: string;
}
```

### ProviderTypeDescriptor

Returned by `avi.providers.types.list()` and required by `types.register()`.

```ts
interface ProviderTypeDescriptor {
  id: string;
  name: string;
  connection: string;
  models?: 'managed' | unknown;
  fields?: Array<{
    id: string;
    label: string;
    type?: 'text' | 'password' | 'select';
    description?: string;
    placeholder?: string;
    default?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
}
```

`connection: 'custom'` marks endpoint-driven types that require an HTTP/HTTPS `baseUrl` and accept credentials. Fields are available to both custom and managed provider types; omitted `type` values render as text inputs.

### ProviderUsageSnapshot

`avi.providers.usages.register().load()` supplies the callback-bearing source shape documented in [Providers](./providers.md). Avi normalizes it to this detached snapshot before exposing it to the renderer:

```ts
interface ProviderUsageSnapshot {
  id: string;
  title: string;
  accountDetails: string;
  limits: Array<{
    label: string;
    description: string | null;
    amountConsumed: number;
    resetsAt: string | null;
    resetList: Array<{
      id: string;
      title: string | null;
      description: string | null;
      type: string | null;
      expiresAt: string | null;
    }>;
  }>;
  counters: Array<{
    label: string;
    description: string | null;
    valueString: string;
  }>;
}
```

`amountConsumed` is between `0` and `1`. Reset `id` values are opaque and short-lived; callback functions never cross the preload boundary.

## Context

```ts
interface ContextRoot {
  id: string;
  name: string;
  path: string;
}

interface ContextItem {
  path: string;
  title: string;
  description: string;
  embeddable: boolean;
  userInvocable: boolean;
  tokenCount: number;
}

interface ContextDocument {
  path: string;
  content: string;
}
```

## Handles and infrastructure

- `ThreadHandle`, `RunHandle` — see [Threads](./threads.md).
- `BotHandle` — see [Bots](./bots.md).
- `ProviderHandle` — see [Providers](./providers.md).
- `Disposable` — see [Lifecycle](./lifecycle.md).
- `AviEvent<T>` — see [Events](./events.md).
- `AviError` — see [Errors](./errors.md).
