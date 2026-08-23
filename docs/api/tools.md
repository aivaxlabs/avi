# Tools

Plugins can register tools globally or scope them to one thread or bot thread.

## Registration

```ts
avi.tools.register(tool): Disposable
thread.tools.register(tool): Disposable
bot.tools.register(tool): Disposable
```

All registrations require `tools.register`.

```js
const registration = avi.tools.register({
  name: 'acme_lookup',
  description: 'Look up a public Acme record by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    required: ['id'],
    additionalProperties: false,
  },
  annotations: {
    readOnly: true,
    destructive: false,
    externalAccess: true,
  },
  async execute({ id }, context) {
    const response = await fetch(`https://api.acme.example/records/${encodeURIComponent(id)}`, {
      signal: context.signal,
    });
    if (!response.ok) throw new Error(`Acme returned ${response.status}.`);
    return JSON.stringify(await response.json(), null, 2);
  },
});
```

Dispose the registration to remove it immediately. Avi also removes it on plugin deactivation.

## Scope and precedence

Global tools participate in every ordinary non-Plan inference. Thread tools participate only in their thread. A thread registration with the same name replaces the plugin runtime's global registration in that thread.

Core, provider, and MCP tools keep the existing composition precedence. Plugins cannot register a name reserved by Avi or a static plugin contribution.

## Execution context

```ts
interface PluginToolContext {
  signal: AbortSignal;
  pluginId: string;
  invocationId: string;
  runId: string | null;
  threadId: string;
  botId: string | null;
  workspacePath: string | null;
  model: ModelSnapshot | null;
  reasoningEffort: string | null;
  permissionMode: string;
  workMode: string | null;
  ultraMode: boolean;
  thread: ThreadHandle;
  storage: PluginStorage;
}
```

Internal `ChatRunner`, database, Electron, and renderer objects are not part of this context.

## Approval

`annotations.destructive: true` always forces Avi's approval path unless the thread is already running in Full access. A plugin or interceptor may increase approval requirements but cannot lower host requirements.

The model still supplies `__invocation_goal` and `__requires_human_approval`; Avi validates and removes these internal fields before calling the plugin handler.
