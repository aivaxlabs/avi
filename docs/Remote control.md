# Remote control

Remote Control exposes Avi orchestration through authenticated MCP and JSON-RPC APIs on a loopback-only local server. An opt-in RPC WAN bridge can publish the JSON-RPC WebSockets through a public relay; MCP always stays local. This is an experimental integration surface, not remote desktop control.

## Enable the server

1. Open **Settings → Remote control**.
2. Choose a port. The default is `18992`; a change is applied when the field loses focus.
3. Create at least one API key. Give it a label and, optionally, an expiration.
4. Turn the server on.
5. Copy a key into your MCP or RPC client.

The UI shows **Listening** or **Not listening** and startup errors such as a port already being in use. There is no Endpoint settings section; the stable routes are listed below.

## Endpoints

- HTTP MCP: `/mcp`
- HTTP MCP with path credential: `/mcp/:key`
- global JSON-RPC WebSocket: `/rpc`
- isolated conversation JSON-RPC WebSocket: `/rpc/conversations/streams/:thread-id`

Use `Authorization: Bearer <api-key>` with `/mcp` and native WebSocket clients. Browser RPC clients offer `avi-rpc-v1` and `avi-api-key.<base64url UTF-8 key>` as WebSocket subprotocols; Avi authenticates the credential but echoes only `avi-rpc-v1`. Never place an RPC key in a URL or query string. `/mcp/:key` remains available only for MCP clients that cannot set an Authorization header.

## API keys

Remote Control supports multiple keys. Each key has a label, creation time, optional expiration, and Copy/Delete actions. Expired keys remain visible for diagnosis but cannot authenticate. Deleting the last key turns Remote Control off.

Secret values are encrypted through Electron secure storage and copied by the main process; they are not displayed or returned to the renderer. Existing single-key installations migrate to a non-expiring key labelled `Default` without changing the secret.

## RPC WAN bridge

The RPC WAN bridge publishes the two JSON-RPC WebSockets through a public relay so external clients such as Workspace can reach Avi without VPN or port forwarding. It is off by default and independent of the local server: the bridge runs while the **RPC WAN bridge** toggle in Settings is on and an AIVAX account is connected, regardless of the Remote server toggle, its port, and its API keys. MCP HTTP is never relayed.

Avi identifies itself to the relay with a stable per-install device id shown as **Device** in Settings, plus the machine name. Publication uses ticket-based registration: Avi authenticates to the relay with the connected AIVAX account token — the bridge stays stopped without a connected account — obtains a role-bound ticket, and holds a WebSocket connection to the relay using the `avi-relay-v1` and `avi-relay-ticket.<secret>` subprotocols. Each reconnect obtains a fresh ticket. The relay only bridges devices and consumers under the same authenticated account, and on the WAN that account substitutes the Remote API key: bridged connections authorize through the account's ticket, never through a local key.

The Remote screen shows the bridge status: stopped, connecting, connected, reconnecting, unauthorized, or error. Avi retries transient failures automatically with increasing delays (1 s to 30 s, resetting after a stable period) and stops retrying after an authorization failure, such as ticket HTTP 401/403 or a relay policy close, until the toggle or the AIVAX connection changes. The relay closes active connections after at most 1 hour (close code `4001`); Avi republishes with a fresh ticket automatically. Disabling the bridge toggle, disconnecting AIVAX, or quitting Avi stops the bridge; turning the local Remote server off or deleting its API keys does not. Local access remains available regardless of relay state.

The relay carries only `/rpc` and `/rpc/conversations/streams/:thread-id`. Consumers complete the documented per-connection open/ready handshake (version 2) that carries only the target route — authorization is the connected AIVAX account, and the relay passes frames opaquely afterwards. See the [public relay protocol](api/rpc/relay-protocol.md) for the exact wire contract.

### Distribution

The bridge is part of the application and needs no extra binary, download, or PATH lookup. Installers and source checkouts behave identically.

### Limitations and trust

- The relay runs on Cloudflare Workers (`avi-relay.projpw.workers.dev`). Cloudflare terminates TLS for both legs, and the relay operator can observe every relayed frame and relay API call, including the AIVAX token used for ticket issuance and the Remote API key presented in each open handshake. Use this bridge only with credentials and conversations acceptable under that trust model.
- The bridge does not persist or replay frames. A dropped connection leaves in-flight JSON-RPC requests with unknown outcome; clients must never resend commands automatically — after reconnecting, state is recovered through discovery, stream subscriptions, and conversation context only.
- Bridged connections carry no Remote API key: the AIVAX account substitutes it, and no local key checks run on the WAN. Revoking the AIVAX credential affects only new tickets; existing sessions continue until the relay's 1-hour cap (close code `4001`) or until Avi stops them.
- Relay throughput is best-effort: Cloudflare Workers cap the publisher leg at roughly 128 messages and 4 MiB per second in aggregate, the bridge fails closed at those limits, and there is no end-to-end flow guarantee between consumer and Desktop.
- Avi verifies the bridge locally across real components: the Workspace client stack against Avi's relay stack through the deployed Worker implementation, with AIVAX mocked (discovery, state, stream handshake and events, account isolation, no local listener or keys). **A live run against the deployed relay service is not verified**; protocol mismatches surface as connection failures reported in Settings.

## Security boundary

The server binds only to `127.0.0.1` and Host validation accepts only localhost/127.0.0.1 authorities; arbitrary forwarded hosts are rejected. The bridge adds no listener: it makes an outbound connection to the relay, and nothing is externally reachable while the bridge is off. MCP DNS-rebinding protection remains enabled.

The AIVAX token authenticates relay ticket issuance and discovery and substitutes the Remote API key on the WAN; it is never sent to consumers. Local MCP and RPC clients must still supply a Remote API key, and the local listener never accepts an authentication bypass. Avi compares local credentials with timing-safe equality, rejects expired keys, and limits HTTP and WebSocket messages to 1 MiB.

## MCP

The stateless Streamable HTTP MCP server exposes bot and chat orchestration tools. See [Remote MCP API](api/mcp/overview.md).

## JSON-RPC WebSockets

`WS /rpc` handles administrative/global folder, thread, search, and bot operations. It does not receive detailed conversation events.

`WS /rpc/conversations/streams/:thread-id` is bidirectional and isolated to one conversation. It accepts prompt, attachment, Goal/Plan/Ultra, queue/steer, interruption, retry/edit, question, and approval operations and emits sequenced JSON-RPC notifications for that conversation's chat events.

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
