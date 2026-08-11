# Plugins

Plugins extend Avi with trusted main-process JavaScript. Version 1 supports a single ECMAScript module (`.js`) per plugin. A plugin can contribute context files, MCP server descriptors, chat tools, declarative auxiliary panels, themes, personalities, and model-provider implementations.

> **Security boundary:** a plugin is not sandboxed. Importing it executes code with the same operating-system and Electron main-process privileges as Avi. A plugin can read or change local files, access credentials available to the process, use the network, start processes, and inspect data that Avi can access. Install only code you have reviewed and trust.

Plugins cannot inject arbitrary renderer JavaScript. Auxiliary panels, themes, and other presentation contributions are declarative data interpreted by Avi. Theme CSS is nevertheless trusted CSS and can affect Avi's interface.

## Version 1 at a glance

- Source: one non-hidden, regular `.js` file using ESM syntax.
- Loading: top-level plugin files are discovered and loaded at Avi startup in deterministic filename order. Each asynchronous import/factory has a 10-second timeout.
- Export: a default object or a default async factory receiving `pluginApi`.
- API compatibility: both the host API and definition use `apiVersion: 1`.
- Metadata: `id`, `name`, and `version` are required. `description` is optional and preserved in plugin status.
- Atomicity: import, factory, validation, collision, or context-materialization failure rejects the entire plugin. Avi does not load only the valid contributions.
- Collisions: plugin IDs and contributed tool, provider, auxiliary-panel, theme, and personality IDs are unique case-insensitively across loaded plugins.
- Installation: sideloading copies the source into `$INSTALL_DIR/plugins` and requires an Avi restart. There is no v1 enable, disable, update, remove, settings, disposal, or lifecycle API.
- Diagnostics: startup failures are recorded in Avi's plugin status, written to `trace.log`, and shown as startup warnings.

`$INSTALL_DIR` means Avi's installed application directory. It is not necessarily writable. System-wide installations can require elevated filesystem permission, and an installer or updater can replace files under that directory.

## Minimal plugin

```js
export default {
  apiVersion: 1,
  id: 'hello-avi',
  name: 'Hello Avi',
  version: '1.0.0',
  contributions: {},
};
```

`definePlugin` is a pass-through authoring helper; it does not validate before the loader runs:

```js
export default async function createPlugin(pluginApi) {
  if (pluginApi.apiVersion !== 1) {
    throw new Error('This plugin requires Avi plugin API v1.');
  }

  return pluginApi.definePlugin({
    apiVersion: 1,
    id: 'hello-factory',
    name: 'Hello Factory',
    version: '1.0.0',
  });
}
```

The factory can be asynchronous. Throwing or rejecting rejects the complete plugin.

## Definition contract

```js
export default {
  apiVersion: 1,
  id: 'example-plugin',
  name: 'Example plugin',
  version: '1.0.0',
  contributions: {
    context: [],
    mcps: [],
    tools: [],
    auxiliaryPanels: [],
    themes: [],
    personalities: [],
    providers: [],
  },
};
```

`description` is optional. `contributions` is optional. If present, it must be a plain object and may contain only the seven keys above. Every contribution value must be an array.

A loaded status entry has `{ id, name, description, version, status: 'loaded', directory, fileName, capabilities, contributions }`. `directory` is the plugin directory, `capabilities` lists contribution types with a nonzero count, and `contributions` maps every type to its count. The host's `getProviderTypes()` returns complete registry-ready provider objects by recombining each provider's public descriptor data and handlers.

### IDs and serializable data

IDs use this ASCII pattern:

```text
^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$
```

In practice, use lowercase kebab-case: `acme-search`, not spaces, slashes, or display labels. The validator accepts ASCII letters case-insensitively, digits, `.`, `_`, and `-`, but collisions are compared case-insensitively.

Every contribution type has an exact required shape. Unknown fields and unsupported function keys are rejected. Non-function descriptor data must be JSON-like:

- strings, booleans, `null`, and finite numbers;
- arrays;
- plain objects with a normal or `null` prototype.

Undefined values, `BigInt`, symbols, nested functions, class instances, and circular references are rejected. Executable handlers are allowed only as documented top-level function-valued properties of a contribution object. Keep functions beside descriptor fields, not nested inside schemas or returned panel state.

## Context resources

Context contributions are real UTF-8 files, not virtual prompt strings:

```js
export default {
  apiVersion: 1,
  id: 'acme-context',
  name: 'Acme context',
  version: '1.0.0',
  contributions: {
    context: [
      {
        path: 'skills/acme-api/SKILL.md',
        content: `---
name: acme-api
description: Use when integrating with the Acme API.
---
# Acme API

Read the API reference before changing an integration.
`,
      },
      {
        path: 'workflows/check-acme.md',
        content: `---
name: check-acme
description: Validate an Acme integration.
---
# Check Acme

1. Inspect configuration.
2. Run the narrow validation.
3. Report evidence.
`,
      },
      {
        path: 'AGENTS.md',
        content: '# Acme instructions\n\nNever print Acme credentials.\n',
      },
    ],
  },
};
```

Paths are relative, use `/`, and cannot be absolute, empty, contain `.` segments, or escape with `..`. `content` must be a string.

Avi atomically materializes each accepted plugin under:

```text
$INSTALL_DIR/plugins/.avi/<plugin-id>/context/
```

The whole `plugins/.avi` tree is managed output. **Do not edit it.** Change the `context` contribution in the plugin source and restart Avi instead. Stale materialized roots are cleaned when their plugin is no longer accepted.

Plugin context participates only after the runtime registers its materialized root. The effective duplicate-command priority is:

```text
workspace → global → installation → plugins
```

The first command with a duplicate normalized ID wins. Runtime instruction authority still follows Avi's normal system/runtime, user, project-instruction, and repository-convention order; command precedence is not permission escalation.

## MCP servers

Each `mcps` item is exactly `{ id, name, config }`. `config` uses Avi's existing MCP server configuration shape. All three fields are required, `config` must be a plain object, and unknown transport/auth fields are rejected. Secrets embedded in a plugin are readable source code, so do not hard-code them.

A local stdio server:

```js
{
  id: 'acme-local',
  name: 'Acme local MCP',
  config: {
    type: 'stdio',
    enabled: true,
    command: 'bunx',
    args: ['-y', '@acme/mcp-server'],
    cwd: '',
    env: {},
  },
}
```

A remote server with automatic authentication discovery:

```js
{
  id: 'acme-remote',
  name: 'Acme remote MCP',
  config: {
    type: 'streamable-http',
    enabled: true,
    url: 'https://api.acme.example/mcp',
    headers: {},
    auth: {
      type: 'auto',
      token: '',
      clientId: '',
      clientSecret: '',
    },
  },
}
```

Supported transports are `stdio`, `streamable-http`, and legacy `sse`. Remote authentication modes are `auto`, `none`, `bearer`, and `oauth2`. Use only the documented fields for the selected mode. Plugin MCP servers are managed and read-only in Avi's ordinary MCP settings/API; a global user server with the same generated name is reported as a collision rather than replacing the plugin server. MCP tools and server instructions are obtained from the server after connection; Avi exposes tools with its normalized MCP prefix. Approval remains governed by Avi's permission mode and each model tool call.

Complete MCP contribution:

```js
contributions: {
  mcps: [
    {
      id: 'acme-local',
      name: 'Acme local MCP',
      config: {
        type: 'stdio',
        enabled: true,
        command: 'bunx',
        args: ['-y', '@acme/mcp-server'],
        cwd: '',
        env: { ACME_REGION: 'us-east-1' },
      },
    },
    {
      id: 'acme-remote',
      name: 'Acme remote MCP',
      config: {
        type: 'streamable-http',
        enabled: true,
        url: 'https://api.acme.example/mcp',
        headers: { 'X-Client': 'avi-plugin' },
        auth: { type: 'auto', token: '', clientId: '', clientSecret: '' },
      },
    },
  ],
}
```

## Chat tools

A tool contribution is exactly `{ name, description, inputSchema, execute }`; all four fields are required:

```js
{
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
  async execute({ id }, context) {
    const response = await fetch(`https://api.acme.example/records/${encodeURIComponent(id)}`, {
      signal: context.signal,
    });
    if (!response.ok) throw new Error(`Acme returned ${response.status}.`);
    return JSON.stringify(await response.json(), null, 2);
  },
}
```

`name` is the provider-facing identity, must satisfy the plugin ID pattern, and must be unique case-insensitively. If a selected provider or connected MCP dynamically contributes the same name, Avi keeps the provider/MCP tool and omits only the conflicting plugin tool for that invocation; the chat run continues.

Plugin tools do not define `approval`, `canEditFile`, or `canPerformDestructiveActions` fields in v1. Every tool call instead receives model-supplied `__invocation_goal` and `__requires_human_approval` fields. Avi validates that the goal is present and the approval classification is boolean. The user-selected permission mode, persistent approvals, and Plan restrictions still apply; a plugin must not treat model classification as an authorization boundary.

`execute(input, context)` is called in Avi's main process. The ordinary execution context includes:

- `signal`: abort signal for cancellation;
- `workspacePath`;
- `chatRunner`, `conversationId`;
- selected `model`, available `models`, and `reasoningEffort`;
- `permissionMode`, `workMode`, `ultraMode`, and current `goal`;
- runtime `tuning`, AIVAX state, default models, and model `capabilities`.

Use only the fields needed by the tool. Treat this context as runtime-owned and do not mutate it. Return a string for ordinary textual output. Throw an `Error` for failure.

## Auxiliary panels

A panel is exactly `{ id, title, load, invokeAction? }`. `load` returns the serializable state understood by Avi's existing declarative sections/items/actions renderer. The optional `invokeAction` handles those actions. Panels cannot include static `sections`, React components, HTML scripts, renderer JavaScript, or other fields.

```js
{
  id: 'acme-status',
  title: 'Acme status',
  async load(context) {
    return {
      sections: [
        {
          id: 'account',
          title: 'Account',
          items: [
            { id: 'region', label: 'Region', value: 'us-east-1' },
            { id: 'health', label: 'Health', value: 'Online' },
          ],
          actions: [{ id: 'refresh', label: 'Refresh', kind: 'primary' }],
        },
      ],
    };
  },
  async invokeAction(action, input, context) {
    if (action !== 'refresh') throw new Error(`Unknown action: ${action}`);
    return { refreshed: true };
  },
}
```

Keep all executable behavior in top-level handlers. Panel IDs collide case-insensitively across plugins.

## Themes

A theme is exactly `{ id, name, tagline, css, emptyChatBackground? }`. The first four fields are required; `emptyChatBackground`, when present, must be a boolean:

```js
{
  id: 'acme-midnight',
  name: 'Acme Midnight',
  tagline: 'Quiet contrast for long sessions',
  css: `
    :root {
      --background: #101419;
      --foreground: #e8eef5;
      --accent: #65d1ba;
    }
  `,
}
```

Avi inserts only the currently selected plugin theme's CSS. Selecting another plugin theme replaces it, and selecting a built-in theme clears it. While selected, CSS is trusted, global presentation input: review it for remote URLs, data exposure, overlays, unreadable states, and selectors that unintentionally affect unrelated UI. Set `emptyChatBackground: false` when the theme should disable Avi's decorative empty-chat background. Theme IDs are unique case-insensitively.

## Personalities

A personality is exactly `{ id, name, description, instructions }`; every field is required:

```js
{
  id: 'acme-operator',
  name: 'Acme Operator',
  description: 'Concise, operational guidance for Acme deployments.',
  instructions: `Be concise and evidence-led.
Never claim a deployment succeeded without checking its health endpoint.`,
}
```

Personality instructions become model context when that personality is selected. They do not grant tools, permissions, or higher runtime authority. Personality IDs are unique case-insensitively.

## Model providers

Provider contributions use the existing `defineProvider` shape: `{ descriptor, createBody, request, eventsFrom }`, with optional `getContributions`, `getState`, `invokeAction`, and `remove`. No other function keys are supported. `descriptor` must be a plain serializable object with required `id` and `name`.

```js
{
  descriptor: {
    id: 'acme-responses',
    name: 'Acme Responses',
    endpoint: 'https://api.acme.example/v1/responses',
  },

  async createBody({ provider, model, messages, reasoningEffort, tools, toolHistory, invocationContext }) {
    return {
      model: model.modelId,
      messages,
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
      stream: true,
    };
  },

  async request({ provider, model, body, signal, invocationContext, services }) {
    return fetch('https://api.acme.example/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  },

  eventsFrom(payload) {
    if (payload.type === 'text.delta') {
      return [{ type: 'content', text: payload.text }];
    }
    if (payload.type === 'reasoning.delta') {
      return [{ type: 'reasoning', text: payload.text }];
    }
    if (payload.type === 'tool.start') {
      return [{
        type: 'tool-call',
        key: payload.index,
        callId: payload.callId,
        name: payload.name,
        argumentsText: payload.arguments ?? '',
        replaceArguments: true,
      }];
    }
    if (payload.type === 'tool.arguments.delta') {
      return [{
        type: 'tool-call',
        key: payload.index,
        argumentsDelta: payload.delta ?? '',
      }];
    }
    if (payload.type === 'error') {
      return [{ type: 'error', code: payload.code ?? 'provider_error', message: payload.message }];
    }
    return [];
  },
}
```

`createBody` builds the upstream request. `request` must resolve to a Fetch `Response`; Avi checks status, requires a streaming body, handles cancellation, and reads Server-Sent Events. Each SSE `data` payload is parsed as JSON and passed to `eventsFrom`, which returns zero or more normalized events.

Important normalized events are:

- `{ type: 'content', text }`;
- `{ type: 'reasoning', text }`;
- `{ type: 'tool-call', key, callId?, name?, argumentsText?, argumentsDelta?, replaceArguments? }`;
- `{ type: 'item-complete', itemType? }`;
- `{ type: 'continuation-item', index?, item }` and `{ type: 'continuation', items }`;
- `{ type: 'error', code, message, status? }`.

A stable `key` groups tool-call deltas. Do not change a call ID or tool name after emitting it. Use `argumentsDelta` for append-only chunks or `argumentsText` with `replaceArguments: true` for a complete replacement. Error codes such as `server_error`, `provider_error`, and an early `server_is_overloaded` participate in Avi's retry behavior.

Only `getContributions`, `getState`, `invokeAction`, and `remove` are accepted as optional provider handlers. There is no plugin-specific provider settings schema in v1. `getProviderTypes()` returns each complete registry-ready provider object with descriptor and handlers. Provider descriptor IDs collide case-insensitively across plugins.

## Full example

```js
export default async ({ apiVersion, definePlugin }) => {
  if (apiVersion !== 1) throw new Error('Unsupported Avi plugin API.');

  return definePlugin({
    apiVersion: 1,
    id: 'acme-suite',
    name: 'Acme Suite',
    version: '1.0.0',
    contributions: {
      context: [{
        path: 'skills/acme/SKILL.md',
        content: `---
name: acme
description: Use for Acme records and deployment operations.
---
# Acme

Prefer read-only inspection before mutations.
`,
      }],
      mcps: [{
        id: 'acme-mcp',
        name: 'Acme MCP',
        config: {
          type: 'streamable-http',
          enabled: true,
          url: 'https://api.acme.example/mcp',
          headers: {},
          auth: { type: 'auto', token: '', clientId: '', clientSecret: '' },
        },
      }],
      tools: [{
        name: 'acme_status',
        description: 'Read Acme service status.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        async execute(_input, { signal }) {
          const response = await fetch('https://status.acme.example/api', { signal });
          if (!response.ok) throw new Error(`Status request failed (${response.status}).`);
          return JSON.stringify(await response.json());
        },
      }],
      auxiliaryPanels: [{
        id: 'acme-overview',
        title: 'Acme overview',
        async load() {
          return { sections: [{ id: 'service', title: 'Service', items: [{ id: 'state', label: 'State', value: 'Ready' }], actions: [{ id: 'refresh', label: 'Refresh', kind: 'primary' }] }] };
        },
        async invokeAction(action) {
          if (action !== 'refresh') throw new Error(`Unknown action: ${action}`);
          return { refreshed: true };
        },
      }],
      themes: [{
        id: 'acme-midnight',
        name: 'Acme Midnight',
        tagline: 'Focused and calm',
        css: ':root { --background: #101419; --foreground: #e8eef5; --accent: #65d1ba; }',
      }],
      personalities: [{
        id: 'acme-operator',
        name: 'Acme Operator',
        description: 'Operational and evidence-led.',
        instructions: 'Inspect before changing. Report concrete validation evidence.',
      }],
      providers: [{
        descriptor: {
          id: 'acme-provider',
          name: 'Acme Provider',
          endpoint: 'https://api.acme.example/v1/chat',
        },
        async createBody({ model, messages }) {
          return { model: model.modelId, messages, stream: true };
        },
        async request({ provider, body, signal }) {
          return fetch('https://api.acme.example/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
            body: JSON.stringify(body),
            signal,
          });
        },
        eventsFrom(payload) {
          if (payload.type === 'delta') return [{ type: 'content', text: payload.text }];
          if (payload.type === 'error') return [{ type: 'error', code: 'provider_error', message: payload.message }];
          return [];
        },
      }],
    },
  });
};
```

Replace example endpoints and authentication with a reviewed implementation. Do not put production secrets in the source file.

## Installation and maintenance

Use **Settings → Plugins → Sideload plugin** to select one `.js` file. Avi copies it into `$INSTALL_DIR/plugins`; it does not execute the selected source in place. The copy fails if the destination filename already exists, the source is hidden, not a regular file, a symbolic link, not `.js`, or the destination is unwritable. Restart Avi after a successful sideload.

Version 1 has no in-app update or removal API. When Avi is fully closed, a user with filesystem permission can replace or remove the corresponding top-level `.js` file manually; the next startup reflects file presence. Back up reviewed source before modifying an installation, and remember that installers/updaters can replace installation files.

Never edit `plugins/.avi`: it is regenerated and cleaned by the manager.

## Failure model and troubleshooting

One bad plugin does not prevent independent valid plugin files from loading, but every contribution from the bad plugin is rejected together. Avi rejects an asynchronous import or factory that does not settle within 10 seconds. Because plugins are trusted code running in the Electron main process, synchronous infinite loops and other blocking code cannot be interrupted by this timeout. Common failures include:

- syntax/import error or rejected factory;
- missing or incompatible `apiVersion`;
- invalid/missing metadata;
- unknown contribution key or non-array contribution;
- invalid ID, duplicate ID, or cross-plugin collision;
- nested function, class instance, circular value, or other non-serializable descriptor;
- missing tool `execute`;
- missing provider `createBody`, `request`, or `eventsFrom`;
- invalid/escaping context path or context materialization failure;
- unwritable installation directory.

Check the Plugins settings page and Avi's `trace.log` for the source filename, plugin ID when known, and failure message. Fix the source, close Avi, replace the installed file, and restart. Do not repeatedly execute an unreviewed third-party plugin merely to discover what it does.

## Validation

From an Avi source checkout, run the focused loader suite:

```sh
bun scripts/test-plugins.mjs
```

It exercises successful loading, import/factory/version/timeout failures, invalid MCP prevalidation, atomic rejection, unknown fields, case-insensitive collisions, path traversal rejection, strict required fields, status/capability reporting, handler retrieval, provider registry assembly, context materialization/cleanup, and restart-required sideloading. Also run Avi's syntax checker when changing repository code or bundled context:

```sh
bun scripts/check-syntax.mjs
```

These tests validate the host contract; they do not make third-party code trustworthy and should not be used as permission to install or execute unreviewed code.

## Author checklist

1. Keep the plugin in one reviewed ESM `.js` file.
2. Use `apiVersion: 1` in both host compatibility checks and the definition.
3. Use stable lowercase kebab-case IDs and check collisions.
4. Keep descriptor data plain and serializable; keep handlers top-level.
5. Define an exact JSON Schema for each tool and ensure mutating/destructive behavior is obvious in its name and description.
6. Validate MCP transport/auth fields without embedding secrets.
7. Emit provider events with stable tool-call identities.
8. Keep panel behavior declarative and main-side.
9. Review theme CSS as privileged presentation input.
10. Treat materialized context as generated output.
11. Test loader acceptance and rejection cases before sideloading.
12. Restart Avi and inspect startup warnings and `trace.log`.
