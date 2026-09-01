# Lifecycle

Plugins are imported and validated before activation. Avi then activates accepted plugins in deterministic plugin-directory order.

```js
export default ({ definePlugin }) => definePlugin({
  apiVersion: 2,
  id: 'acme-live',
  name: 'Acme Live',
  version: '1.0.0',
  capabilities: ['events.subscribe'],
  async activate(avi) {
    const subscription = avi.events.on('thread.created', onThreadCreated);
    avi.lifecycle.track(subscription);
  },
  async deactivate(reason) {
    await flushPendingWrites(reason);
  },
});
```

## Activation

`activate(avi)` runs after ChatRunner, BotManager, providers, and the main runtime services exist. Activation has a 10-second timeout. Failure marks the plugin as errored, removes resources registered during partial activation, and prevents its static contributions from remaining published.

## Deactivation

On application shutdown, Avi:

1. aborts `avi.lifecycle.signal`;
2. runs handlers registered with `onDeactivate()` in reverse order;
3. calls definition-level `deactivate(reason)`;
4. disposes tracked resources in reverse registration order.

Deactivation handlers and `deactivate()` each have a five-second timeout. Failures are logged and do not stop the remaining cleanup.

## API

```ts
avi.lifecycle.signal: AbortSignal
avi.lifecycle.onDeactivate(handler): Disposable
avi.lifecycle.track(disposable): Disposable
```

All Avi registrations return a `Disposable`:

```ts
interface Disposable {
  readonly disposed: boolean;
  dispose(): void;
}
```

Avi tracks resources returned by its registration APIs automatically. Use `track()` for an external resource that already exposes `dispose()`.

```js
async activate(avi) {
  const interval = setInterval(refresh, 60_000);
  avi.lifecycle.onDeactivate(() => clearInterval(interval));
}
```

After deactivation, API operations throw `DISPOSED` or `PLUGIN_DEACTIVATING` errors.
