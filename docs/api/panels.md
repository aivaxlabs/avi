# Auxiliary panels

Runtime panels remain declarative. Plugins cannot inject React components, HTML scripts, or renderer JavaScript.

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
