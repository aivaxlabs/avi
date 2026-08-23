# Plugin storage

`avi.storage` is a persistent JSON key-value store isolated by plugin ID. Access requires the `storage` capability.

```ts
avi.storage.get(key): Promise<JsonValue | null>
avi.storage.set(key, value): Promise<void>
avi.storage.delete(key): Promise<boolean>
avi.storage.list(options?): Promise<string[]>
avi.storage.clear(): Promise<void>
```

Example:

```js
await avi.storage.set('last-sync', {
  at: new Date().toISOString(),
  cursor: 'abc',
});

const state = await avi.storage.get('last-sync');
const cacheKeys = await avi.storage.list({ prefix: 'cache:' });
```

Values must be JSON-like: strings, booleans, `null`, finite numbers, arrays, and plain objects. Functions, class instances, symbols, `BigInt`, undefined values, and circular references are rejected.

Writes are serialized per plugin and use atomic temporary-file replacement. The complete serialized store is limited to 1 MiB.

Storage lives under Avi's managed `.avi-storage/<plugin-id>/storage.json` area. It is separate from materialized context so a plugin update or context refresh does not erase state. Plugins must not edit another plugin's store directly.
