# Context

The context namespace reads discovered context and registers plugin-owned runtime resources. It does not edit user instruction, skill, or workflow files.

## Reading

```ts
avi.context.roots.list(options?): ContextRoot[]
avi.context.items.list({ path }): Promise<ContextItem[]>
avi.context.items.read(id): Promise<ContextDocument | null>
```

`context.read` is required to list roots and items. `context.readContents` is required to read full contents when a host reader is available. `ContextRoot`, `ContextItem`, and `ContextDocument` are defined in [Shared types](./types.md).

Roots include global, installation, static plugin contribution, and active runtime plugin roots.

Directory discovery and item reads are asynchronous and bounded by the host's available processor count. Results preserve deterministic path ordering and existing cache, depth, timeout, and symlink-cycle rules.

Items expose `relativePath` relative to the requested root with `/` separators, `activationMode` (`always-visible` for automatically embedded ordinary-chat root instructions, otherwise `on-demand`), `invocationMode` (`assistant-only` for skills/workflows with `user-invocable: false`, otherwise null), and `parentSkillPath` (the nearest discovered ancestor skill's absolute path, otherwise null). There is no supported user-only metadata flag. `BOTS.md` remains bot-only regardless of the ordinary-chat activation badge.

## Registration

```js
const resource = await avi.context.register({
  id: 'acme-guidance',
  title: 'Acme guidance',
  kind: 'instructions',
  scope: { type: 'thread', threadId },
  content: 'Use the Acme tools. Never expose Acme credentials.',
});
```

Registration requires `context.register` and returns a `Disposable` resource with an `id`.

Kinds:

```text
instructions
skill
workflow
```

Scopes:

```ts
{ type: 'global' }
{ type: 'thread', threadId: string }
{ type: 'bot', botId: string }
{ type: 'workspace', path: string }
```

Resources are materialized below the plugin's managed runtime-context root and participate in ordinary context discovery only when their scope matches the invocation. Disposal removes the managed resource.

Static `contributions.context` remains appropriate for installation-wide files known at load time. Use runtime registration for per-thread, per-bot, or per-workspace resources.
