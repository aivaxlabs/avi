# RPC authentication and API keys

Create and manage keys in **Settings → Remote control**. Each key has a label, creation time, and optional expiration. The UI can copy or delete individual keys; secret values are never displayed or returned by `remote:state`.

HTTP and native WebSocket clients can send a Bearer token during the handshake:

```http
Authorization: Bearer <api-key>
```

Browser WebSocket clients authenticate with two offered subprotocols: `avi-rpc-v1` and `avi-api-key.<credential>`, where `<credential>` is the unpadded base64url encoding of the UTF-8 API key.

```js
const credential = btoa(unescape(encodeURIComponent(apiKey)))
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replace(/=+$/, '');
const socket = new WebSocket(url, [
  'avi-rpc-v1',
  `avi-api-key.${credential}`,
]);
```

The server authenticates the credential protocol but selects and echoes only `avi-rpc-v1`. It rejects a credential protocol offered without `avi-rpc-v1`. Never put an API key in the RPC URL, query string, logs, or persisted browser history.

Expired and deleted keys are rejected with HTTP `401`. Deleting the last key turns Remote Control off. Enabling Remote Control without a key creates a non-expiring key labelled `Default`.

Keys are encrypted through Electron secure storage. Existing installations migrate the former single `remote-api-key` into a `Default` entry without changing its secret value.

Remote Control binds only to `127.0.0.1`, applies DNS-rebinding protection to MCP, compares secrets with timing-safe equality, and limits request bodies to 1 MiB. Host validation accepts only localhost/127.0.0.1 authorities, and the local listener never accepts an authentication bypass: local MCP and RPC clients always present a Remote API key.

The opt-in RPC WAN bridge is independent of the local server toggle and its keys. Avi publishes the JSON-RPC WebSockets through `https://avi-relay.projpw.workers.dev`, and bridged connections carry no Remote API key: the connected AIVAX account substitutes it, with handshake v2 opens carrying only the target route. Both relay legs use TLS, but Cloudflare and the relay operator terminate and observe the traffic, including the AIVAX token, tickets, and everything relayed. Only use credentials acceptable under that trust model. See [bridge lifecycle, distribution, and limitations](../../Remote%20control.md#rpc-wan-bridge) and the [public relay protocol](relay-protocol.md).
