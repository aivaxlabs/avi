# Tool interceptors

Tool interceptors are separate from observational events. Registration requires `tools.intercept`.

```js
const registration = avi.interceptors.tools.register({
  id: 'acme-redaction',
  priority: 100,
  async beforeExecute(invocation) {
    if (invocation.tool.name !== 'send_to_acme') return { action: 'continue' };
    return {
      action: 'replaceInput',
      input: redactSecrets(invocation.input),
    };
  },
  async afterExecute(invocation) {
    return {
      action: 'replaceOutput',
      output: redactSecrets(invocation.output),
    };
  },
});
```

## Before results

```ts
type BeforeResult =
  | { action: 'continue' }
  | { action: 'deny'; reason: string }
  | { action: 'replaceInput'; input: JsonValue }
  | { action: 'requireApproval'; reason?: string };
```

Replacing input automatically requires a fresh approval and revalidates the new value against the tool's JSON Schema. `requireApproval` can increase protection but cannot reduce an existing requirement.

## After results

```ts
type AfterResult =
  | { action: 'continue' }
  | { action: 'replaceOutput'; output: JsonValue };
```

The transformed output is still processed by Avi's output normalization and size limits.

## Ordering and timeout

Interceptors execute sequentially by:

1. ascending `priority`;
2. plugin ID;
3. interceptor ID.

Default priority is `1000`. Each handler has a three-second timeout. An interceptor error becomes a tool error; it does not crash Avi.

The pipeline is:

1. resolve tool;
2. parse model arguments;
3. run `beforeExecute` interceptors;
4. validate transformed input;
5. recalculate approval;
6. execute the tool;
7. run `afterExecute` interceptors;
8. normalize and limit output;
9. return the result to the model.
