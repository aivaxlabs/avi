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
  projectName: string;
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
  firstPrompt: string;
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  isArchived: boolean;
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

`activationWindow.days` uses `0` (Sunday) through `6` (Saturday); minutes are counted from midnight.

### BotApproval

Returned by `bot.approvals.list()` while a bot run waits for a human decision.

```ts
interface BotApproval {
  id: string;
  botId: string;
  kind: 'tool';
  title: string;
  content: string;
  context: string;
  prompt: string;
  toolName: string;
  workspacePath: string | null;
  input: JsonValue | null;
  status: 'waiting-user-approval';
  date: string;
  createdAt: string;
  updatedAt: string;
}
```

### BotDailyLogEntry

`bot.logs.list()` returns `BotDailyLogEntry[]` for the bot.

```ts
interface BotDailyLogEntry {
  id: string;
  title: string;
  content: string;
  status: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}
```

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

Returned by `avi.providers.models.list()`. Each model is globally qualified as `providerId:modelId`.

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
    default?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
}
```

`connection: 'custom'` marks endpoint-driven types that require an HTTP/HTTPS `baseUrl` and accept credentials.

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
