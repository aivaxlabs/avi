# Action pages

Action pages are full-size pages contributed by plugins. Each page gets its own entry in the Activity Bar, below Home, Inbox, and Folders and after a separator, so plugin pages stay visually apart from Avi's own destinations. Selecting it replaces the page composer, the same way Inbox and Folders do. A page stays mounted after its first visit, so switching away and back preserves its state.

## API

```ts
avi.actionPages.register(descriptor): ActionPageRegistration
```

Registration requires the `actionPages.register` capability. Pages are runtime-only: register them in `activate(avi)`; they are removed when the registration is disposed or the plugin is deactivated.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Plugin-local ID matching the plugin ID pattern. Exposed as `plugin:<plugin-id>:<id>`. |
| `title` | `string` | Accessible label and tooltip. Avi appends the plugin name. |
| `kind` | `'html' \| 'native'` | Rendering mode. |
| `icon` | `string \| { svg: string }` | Optional. A Lucide icon name in kebab-case (for example `chart-pie`), or SVG markup up to 64 KiB. Unknown names fall back to a puzzle icon. |
| `load(context)` | `function` | Returns the page content. Called when the page opens, on refresh, and after `registration.refresh()`. |
| `invokeAction(action, input, context)` | `function` | Optional handler for actions sent by the page. |

`context` is currently an empty object, reserved for future fields.

SVG icons are rendered as a mask filled with the current Activity Bar text color, so they follow the theme and selected state. Only the shape is used; colors, scripts, and external references inside the SVG are ignored.

## HTML pages

`load()` returns `{ html: string }`, a complete HTML document or fragment with its own CSS and JavaScript.

```js
let count = 0;
avi.actionPages.register({
  id: 'counter',
  title: 'Counter',
  kind: 'html',
  icon: 'mouse-pointer-click',
  load: () => ({
    html: `<!doctype html><html><head><style>
      body { padding: 24px; }
      button { color: var(--text-1); background: var(--background-3); border: 1px solid var(--border-color); }
    </style></head><body>
      <h1 id="count">0</h1>
      <button onclick="avi.invoke('increment').then((r) => count.textContent = r.count)">Increment</button>
    </body></html>`,
  }),
  invokeAction: (action) => ({ count: action === 'increment' ? ++count : count }),
});
```

The document runs in an iframe with `sandbox="allow-scripts allow-forms allow-popups allow-modals"` and an opaque origin. It cannot access the Avi window, `window.chatApp`, cookies, storage, or Node.js. Everything privileged must go through the bridge:

```ts
window.avi.invoke(action: string, input?: unknown): Promise<unknown>
```

Each call runs `invokeAction(action, input, context)` in the main process. It resolves with the handler's JSON-like return value and rejects with the error message if the handler throws. Pass only structured-cloneable values.

Avi injects a `<style id="avi-theme">` before the page content. It defines the current theme tokens on `:root`: `--background-0`–`--background-5`, `--text-1`–`--text-5`, `--border-color`, `--item-hover`, `--item-active`, `--primary-color`, `--success-color`, `--warn-color`, `--danger-color`, `--link-color`, `--font-ui`, `--font-code`, and `--font-xs`–`--font-xxl`. It also sets `color-scheme` and default page colors and font with zero specificity, so page CSS overrides them. Tokens update when the user changes theme or color scheme.

## Native pages

`load()` returns the same declarative data as [auxiliary panels](./panels.md): `{ sections: [...] }` or `{ state: { title, description? } }`. Avi renders it with its own components, including progress items and item actions. Item actions call `invokeAction(action.id, action.input, context)`; a returned `{ panel }` replaces the page data and `{ message }` is shown above the sections.

```js
avi.actionPages.register({
  id: 'status',
  title: 'Service status',
  kind: 'native',
  icon: { svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>' },
  load: async () => ({
    sections: [{
      id: 'service',
      title: 'Service',
      items: [{ id: 'health', title: 'Online', action: { id: 'ping', label: 'Ping' } }],
    }],
  }),
  invokeAction: async (action) => ({ message: action === 'ping' ? 'Pong' : 'Unknown action' }),
});
```

## Registration handle

```ts
page.id: string
page.disposed: boolean
page.refresh(): void
page.dispose(): void
```

`refresh()` asks the open window to reload the page by calling `load()` again. For HTML pages this reloads the iframe and resets its in-page state.

## Desktop bridge

The renderer uses these logical channels through `window.chatApp.actionPages`. They are desktop-only and not exposed as remote RPC methods.

| Method / logical channel | Payload | Result |
| --- | --- | --- |
| `list` / `action-pages:list` | none | `[{ id, pluginId, pluginName, title, kind, icon }]` |
| `load` / `action-pages:load` | `{ pageId }` | Result of `load()` |
| `invokeAction` / `action-pages:action` | `{ pageId, action, input }` | Result of `invokeAction()` |
| `onEvent` / `action-pages:event` | callback | `{ type: 'changed' }` when pages are added or removed, `{ type: 'refresh', pageId }` after `refresh()` |
