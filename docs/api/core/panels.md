# Auxiliary panels

Runtime panels remain declarative. Plugins cannot inject React components, HTML scripts, or renderer JavaScript.

## Built-in desktop Files actions

The desktop preload bridge exposes `files.read`, `files.open`, `files.reveal`, and `files.copyPath` through the existing logical `files:*` handlers. Their payload contains `folderPath`, `filePath`, and optional `allowExternalReference`. Absolute paths and `file://` URLs require `allowExternalReference: true`; relative traversal remains rejected without that opt-in. The desktop requests confirmation before enabling it. `files.reveal` resolves the physical path before selecting the item in the OS file manager. `shell.openTerminal(targetPath)` starts the configured interactive shell with that working directory, not a one-shot command.

These desktop operations are not new plugin capabilities or remotely exposed RPC methods; the public plugin panel registration contract below is unchanged.

## API

```ts
avi.panels.register(descriptor): PanelRegistration
avi.panels.list(): PanelSummary[]
```

Registration requires `panels.register`. Listing all runtime panels requires `panels.manage`.

```js
const panel = avi.panels.register({
  id: 'acme-status',
  title: 'Acme status',
  async load(context) {
    return {
      sections: [{
        id: 'service',
        title: 'Service',
        items: [{ id: 'health', label: 'Health', value: 'Online' }],
        actions: [{ id: 'refresh', label: 'Refresh', kind: 'primary' }],
      }],
    };
  },
  async invokeAction(action, input, context) {
    if (action !== 'refresh') throw new Error(`Unknown action: ${action}`);
    panel.refresh();
    return { refreshed: true };
  },
});
```

Panel IDs are exposed to the renderer as `plugin:<plugin-id>:<panel-id>`.

## Registration handle

```ts
panel.id: string
panel.disposed: boolean
panel.refresh(): AviEvent
panel.dispose(): void
```

`refresh()` emits `panel.refresh.requested` for observers. The renderer also reloads a panel through its existing declarative panel flow when opened or an action completes.

The `load` and `invokeAction` contexts contain the current conversation snapshot and `workspacePath`.
