# Plugin settings

A plugin can add an application-rendered settings page to its card under **Settings → Plugins**. The plugin supplies declarative sections, JSON Schemas, and main-process handlers; it cannot supply HTML, React components, CSS, or renderer JavaScript.

`settings` is an optional top-level field of a Plugin API v2 definition. It is backward compatible and requires no capability.

```js
let personality = 'Peaceful';

export default ({ definePlugin }) => definePlugin({
  apiVersion: 2,
  id: 'acme-agent',
  name: 'Acme agent',
  version: '1.0.0',
  capabilities: [],
  settings: [{
    label: 'Personality',
    options: [{
      title: 'Agent personality',
      description: 'Choose the agent personality level.',
      valueSchema: {
        type: 'string',
        enum: ['Aggressive', 'Peaceful'],
      },
      getValue() {
        return personality;
      },
      validate(value) {
        if (value === 'Aggressive') return 'Aggressive mode is unavailable.';
        return true;
      },
      setValue(oldValue, newValue) {
        personality = newValue;
      },
    }],
  }],
});
```

## Contract

```ts
interface PluginSettingSection {
  label: string;
  options: PluginSettingOption[];
}

interface PluginSettingOption {
  title: string;
  description?: string;
  valueSchema: PluginSettingSchema;
  getValue(): JsonValue | Promise<JsonValue>;
  validate?(value: JsonValue): boolean | string | void | Promise<boolean | string | void>;
  setValue(oldValue: JsonValue, newValue: JsonValue): void | Promise<void>;
}
```

Sections and options preserve their declared order. `label`, `title`, `valueSchema`, `getValue`, and `setValue` are required. Empty option arrays and unknown fields reject the plugin.

Handlers execute in the Electron main process with the plugin's existing trust level. Avi calls `getValue()` when the page loads or refreshes. Saving follows this order:

1. validate the proposed value against `valueSchema`;
2. call `validate(newValue)` when provided;
3. call `getValue()` for the current value;
4. call `setValue(oldValue, newValue)`;
5. call `getValue()` again and return the resulting value to the UI.

`validate()` can throw, return `false`, or return a non-empty error string to reject a value. Values passed to and returned from handlers are detached JSON-like data. Non-serializable values, schema mismatches, callback failures, and callback timeouts are reported in the settings page.

The plugin owns persistence. Use `avi.storage` when settings should survive restarts; that API requires the `storage` capability. Do not store credentials in ordinary settings or plugin storage. Provider credentials belong in Avi's write-only credential service.

## Supported schemas

The settings renderer accepts these JSON Schema types:

- `string`, including `enum`, `minLength`, `maxLength`, and `pattern`;
- `number` and `integer`, including `minimum` and `maximum`;
- `boolean`;
- `array`, including `items`, `minItems`, `maxItems`, and `uniqueItems`;
- `object`, including `properties`, `required`, and `additionalProperties: false`.

Schemas can be nested. Arrays and objects use recursive Avi-controlled editors. An object without `properties` uses a JSON object editor.

For compatibility with early authoring examples, Avi normalizes `enums` to the standard JSON Schema keyword `enum`, and `itemsSchema` to `items`. Prefer the standard keywords in new plugins.

The renderer also recognizes these optional presentation annotations at any schema level:

```ts
interface PluginSettingPresentation {
  $label?: string;
  $description?: string;
  $displayMode?: 'inline';
}
```

`$label` and `$description` describe nested values. `$displayMode: 'inline'` lays out object properties in a responsive row when space allows. Presentation annotations do not affect value validation.

## Array example

```js
{
  label: 'Models',
  options: [{
    title: 'Model list',
    valueSchema: {
      type: 'array',
      items: {
        type: 'object',
        $displayMode: 'inline',
        $label: 'Model',
        $description: 'A model available to this plugin.',
        properties: {
          id: { type: 'string', $label: 'Model ID' },
          enabled: { type: 'boolean', $label: 'Enabled' },
        },
        required: ['id', 'enabled'],
        additionalProperties: false,
      },
    },
    async getValue() {
      return (await avi.storage.get('models')) ?? [];
    },
    async setValue(_oldValue, newValue) {
      await avi.storage.set('models', newValue);
    },
  }],
}
```
