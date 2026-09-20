# Remote control

Remote Control exposes Avi orchestration through authenticated MCP and RPC APIs on a loopback-only local server. Opt-in AIVAX Remote publishes MCP and RPC through the public relay. This is an experimental integration surface, not remote desktop control.

## Enable the server

Local Remote Control is enabled by default. On startup, Avi creates a `Default` API key if enabled without any keys. Saved disabled preferences are respected; AIVAX Remote publication remains opt-in.

1. Open **Settings → Remote control**.
2. Choose a port. The default is `18992`; a change is applied when the field loses focus.
3. Create at least one API key. Give it a label and, optionally, an expiration.
4. Turn the server on.
5. Copy a key into your MCP or RPC client.

The UI shows **Listening** or **Not listening** and startup errors such as a port already being in use. There is no Endpoint settings section; the stable routes are listed below.

## Endpoints

- HTTP MCP: `/mcp`
- HTTP MCP with path credential: `/mcp/:key`
- global RPC WebSocket (ORPC Draft 2): `/rpc`
- isolated conversation RPC WebSocket: `/rpc/conversations/streams/:thread-id`

Use `Authorization: Bearer <api-key>` with `/mcp` and native WebSocket clients. Browser RPC clients offer `avi-orpc-draft2` and `avi-api-key.<base64url UTF-8 key>` as WebSocket subprotocols; native clients may authenticate with the Authorization header but every client must still offer `avi-orpc-draft2`, which is the only protocol the server selects. Never place an RPC key in a URL or query string. `/mcp/:key` remains available only for MCP clients that cannot set an Authorization header.

## API keys

Remote Control supports multiple keys. New keys contain 6 cryptographically random lowercase letters/digits; existing keys remain valid. Each key has a label, creation time, optional expiration, and a **...** menu: **Copy API Key**, **Copy MCP instance key**, and **Delete**. The latter copy format is `<instance-id>@<api-key>`, using the installation's persistent 10-character lowercase alphanumeric public instance ID. Expired keys remain visible for diagnosis but cannot authenticate. Deleting the last key turns Remote Control off.

Secret values are encrypted through Electron secure storage and copied by the main process; they are not displayed or returned to the renderer. Existing single-key installations migrate to a non-expiring key labelled `Default` without changing the secret.

## AIVAX Remote — MCP and RPC

The bridge publishes MCP and both RPC WebSockets over an outbound-only connection. It runs while **AIVAX Remote** is on and an AIVAX account is connected, regardless of the local server toggle or port. A dedicated **AIVAX Remote** card separates remote access from the local server and API keys. Its header contains the toggle, followed by connection status and **Device ID**. A separate, always-visible **How to connect** area contains the separate **Instance ID**, both MCP URLs, authentication instructions, and any diagnostic message.

- `https://avi-relay.projpw.workers.dev/mcp/<device-id>`: configure `Authorization: Bearer <AIVAX-token>`. Each HTTP request validates the AIVAX credential; only devices published by that account are accessible. No Desktop key is required.
- `https://avi-relay.projpw.workers.dev/mcp`: no HTTP authentication for initialization and tool discovery. Every tool call requires `arguments.instanceKey`, copied with **Copy MCP instance key**. The Desktop checks the instance ID and a live, unexpired API key before running the tool. The key is removed from the tool arguments before execution.

The custom Relay domain serves the same routes when deployed. Public discovery is a device-independent catalog; it never lists instances, accounts, or keys. Short keys are credentials: share only with trusted agents, prefer expiration, and revoke them when no longer needed. The public endpoint limits each instance to 300 attempts per 10 minutes and blocks after 10 failed/in-flight requests in that window, across IP addresses. This protection can temporarily deny legitimate calls during an attack; the AIVAX-bearer method remains independent.

Avi identifies itself to the relay with a stable per-install device id shown as **Device ID** in Settings, plus the machine name. Publication uses ticket-based registration: Avi authenticates to the relay with the connected AIVAX account token — the bridge stays stopped without a connected account — obtains a role-bound ticket, and holds a WebSocket connection to the relay using the `avi-relay-v1` and `avi-relay-ticket.<secret>` subprotocols. Each reconnect obtains a fresh ticket. The relay only bridges devices and consumers under the same authenticated account, and on the WAN that account substitutes the Remote API key: bridged connections authorize through the account's ticket, never through a local key.

The Remote screen shows the bridge status: stopped, connecting, connected, reconnecting, unauthorized, or error. Avi retries transient failures automatically with increasing delays (1 s to 30 s, resetting after a stable period) and stops retrying after an authorization failure, such as ticket HTTP 401/403 or a relay policy close, until the toggle or the AIVAX connection changes. The relay closes active connections after at most 1 hour (close code `4001`); Avi republishes with a fresh ticket automatically. Disabling the bridge toggle, disconnecting AIVAX, or quitting Avi stops the bridge; turning the local Remote server off or deleting its API keys does not. Local access remains available regardless of relay state.

For RPC, the relay carries `/rpc` and `/rpc/conversations/streams/:thread-id`. Consumers complete the documented per-connection open/ready handshake (version 3, advertising the `avi-orpc-draft2` application protocol) that carries only the target route — authorization is the connected AIVAX account, and the relay passes frames opaquely afterwards. See the [public relay protocol](api/rpc/relay-protocol.md) for the exact wire contract.

### Distribution

The bridge is part of the application and needs no extra binary, download, or PATH lookup. Installers and source checkouts behave identically.

### Limitations and trust

- The relay runs on Cloudflare Workers (`avi-relay.aivax.net`). Cloudflare terminates TLS for both legs, and the relay operator can observe every relayed frame and relay API call, including the AIVAX token used for ticket issuance and every relayed conversation frame. Use this bridge only with credentials and conversations acceptable under that trust model.
- The bridge does not persist or replay frames. A dropped connection leaves in-flight ORPC calls with unknown delivery outcome; the ORPC client recovers with at most one retry that keeps the same operation token under a fresh request id, and the Desktop's durable operation journal deduplicates it. Cancellation is delivery-only — a timed-out operation may still execute — so clients check application state through discovery, stream subscriptions, and conversation context before issuing new work.
- AIVAX-authenticated RPC and device-specific MCP need no Desktop key. Revoking AIVAX credentials affects new tickets and new device-specific MCP requests; existing RPC sessions retain their existing lifecycle. Public MCP calls send an instance key through Cloudflare to the Desktop, which checks expiry and deletion on every call.
- Relayed MCP is stateless JSON, not SSE: 512 KiB request bodies, 1 MiB serialized response frames, and a 60-second deadline. Timeout/disconnect aborts delivery but cannot undo an action already started. Do not automatically retry mutations. Oversized/invalid responses return `502`; an offline publisher returns `503`; deadline expiry returns `504`.
- Relay throughput is best-effort: Cloudflare Workers cap the publisher leg at roughly 128 messages and 4 MiB per second in aggregate, the bridge fails closed at those limits, and there is no end-to-end flow guarantee between consumer and Desktop. The Desktop publisher additionally applies an aggregated per-second backpressure budget of 96 messages / 2 MiB across consumer channels, which paces ORPC senders instead of silently dropping frames.
- Avi verifies the bridge locally across real components: the Workspace client stack against Avi's relay stack through the deployed Worker implementation, with AIVAX mocked (discovery, state, stream handshake and events, account isolation, no local listener or keys). **A live run against the deployed relay service is not verified**; protocol mismatches surface as connection failures reported in Settings.

## Security boundary

The server binds only to `127.0.0.1` and Host validation accepts only localhost/127.0.0.1 authorities; arbitrary forwarded hosts are rejected. The bridge adds no listener: it makes an outbound connection to the relay, and nothing is externally reachable while the bridge is off. MCP DNS-rebinding protection remains enabled.

The AIVAX token authenticates relay ticket issuance, account discovery, and device-specific MCP; it is never sent to consumers or forwarded to the Desktop MCP handler. Public MCP instead forwards the instance key, which must be treated as a secret by agents and Relay operators. Local MCP and RPC clients must still supply a Remote API key, and the local listener never accepts an authentication bypass. Avi compares local credentials with timing-safe equality, rejects expired keys, and limits HTTP and WebSocket messages to 1 MiB.

## MCP

The stateless Streamable HTTP MCP server exposes bot and chat orchestration tools. See [Remote MCP API](api/mcp/overview.md).

## RPC WebSockets

Both RPC WebSockets speak ORPC Draft 2 (`avi-orpc-draft2`): binary length-prefixed frames carrying UTF-8 JSON operation envelopes (`operationId`, `expiresAt`, `params`) with dotted wire methods over the colon application names, and acknowledged server events. See the [RPC overview](api/rpc/overview.md) and the bundled [ORPC Draft 2 specification](api/rpc/orpc-spec.md).

`WS /rpc` handles administrative/global folder, thread, search, and bot operations. It does not receive detailed conversation events.

`WS /rpc/conversations/streams/:thread-id` is bidirectional and isolated to one conversation. It accepts prompt, attachment, Goal/Plan/Ultra, queue/steer, interruption, retry/edit, question, and approval operations and emits sequenced, acknowledged ORPC events for that conversation's chat events.

See:

- [API reference](api/overview.md)
- [RPC overview](api/rpc/overview.md)
- [Public relay protocol](api/rpc/relay-protocol.md)
- [Shared RPC types](api/rpc/types.md)
- [Authentication](api/rpc/authentication.md)
- [Working folders](api/rpc/folders.md)
- [Threads, messages, composer state, and tasks](api/rpc/conversations.md)
- [Child conversations](api/rpc/child-threads.md)
- [Bots](api/rpc/bots.md)
- [Chat, queue, semaphores, and Goals](api/rpc/chat.md)
- [Conversation notifications](api/rpc/streaming.md)
