# Errors

Public API failures use `AviError` where the runtime can classify the condition.

```ts
interface AviError extends Error {
  code: string;
  details?: JsonValue;
  retryable: boolean;
}
```

Implemented codes include:

```text
NOT_FOUND
CAPABILITY_REQUIRED
VALIDATION_FAILED
CONFLICT
PERMISSION_DENIED
DISPOSED
TIMEOUT
PLUGIN_DEACTIVATING
```

Examples:

```js
try {
  await thread.send('Do work');
} catch (error) {
  if (error?.code === 'CAPABILITY_REQUIRED') {
    console.error(error.details.capability);
  }
}
```

Validation errors cover invalid IDs, descriptors, JSON-like values, storage limits, tool schemas after interception, unsupported update fields, and invalid scopes.

Entity operations may also propagate errors from the underlying Avi service, such as an unavailable provider interface or an invalid ChatRunner transition. Plugins should handle expected failures but must not infer success from a missing exception in another asynchronous listener.

Listener errors are logged and isolated. Tool and interceptor errors become tool execution errors visible to the model. Activation errors reject the plugin and dispose resources registered during partial activation.
