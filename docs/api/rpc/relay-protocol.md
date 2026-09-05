# Avi public relay protocol

Wire contract for external clients ("consumers") that reach a published Avi instance through the RPC WAN bridge — for example, a Workspace build connecting to a user's desktop Avi. It covers only relay access; ordinary RPC behavior is documented in the [RPC overview](overview.md) and [authentication](authentication.md).

The relay documented here runs at `https://avi-relay.projpw.workers.dev` on Cloudflare Workers. Avi and the Workspace client stack are verified locally across real components — Workspace RpcClient/RelaySocket against Avi's RemoteRelay/RemoteMcpServer through the deployed Worker implementation, with AIVAX authentication mocked. A live run against the deployed relay service is **not verified**.

## Roles and credentials

Three credentials appear in this protocol, each authorizing a different thing:

| Credential | Presented to | Authorizes |
|---|---|---|
| AIVAX account token | relay HTTP API | Ticket issuance and relay discovery. Required for both the publisher and consumer roles, and it substitutes the Remote API key for all relayed (WAN) access. |
| Relay ticket | relay WebSocket upgrade | Reaching the handshake stage for one bound role on one Avi device until `expiresAt`. Authorizes no RPC operation. |
| Remote API key | Avi local listener (loopback only) | Local MCP and RPC access. It never travels the WAN and never authorizes bridged connections. |

The relay validates the AIVAX token server-side before issuing tickets; the `relayEnabled` desktop toggle only controls whether the local Avi instance participates and is not relay authentication. The `accountId` segment of relay URLs is derived from the authenticated AIVAX account, never from client input.

## Relay HTTP API

Every request requires `Authorization: Bearer <AIVAX token>`; unauthenticated requests fail.

### Discover published Avi instances

```
GET /v1/relays
```

```json
{
  "avis": [
    {
      "deviceId": "<stable per-install device id>",
      "name": "<machine name>",
      "connectedAt": 1790000000000,
      "expiresAt": 1790003600000,
      "consumers": 1
    }
  ]
}
```

`connectedAt` and `expiresAt` are epoch milliseconds for the publisher's current ticket; `consumers` counts currently bridged consumer connections. Only devices currently published under the authenticated account are listed.

### Issue a ticket

```
POST /v1/relays/<device-id>/tickets
```

The body selects the role: `{"role":"publisher"}` for the Avi desktop app, `{"role":"consumer"}` for external clients. Publisher requests carry the machine name shown in discovery.

`201` response:

```json
{
  "ticket": "<64 hexadecimal characters>",
  "expiresAt": 1790003600000,
  "websocketUrl": "wss://avi-relay.projpw.workers.dev/v1/relays/<accountId>/<deviceId>/connect",
  "protocol": "avi-relay-v1"
}
```

The ticket is bound to the requested role and device, is single-use, and expires at `expiresAt` (epoch milliseconds, issued for 60 seconds); an account can hold at most 64 pending tickets. Request a ticket immediately before each connection and re-request one for every (re)connection.

## WebSocket connection

Both roles connect to the returned `websocketUrl` offering subprotocols:

- `avi-relay-v1`
- `avi-relay-ticket.<ticket>` — the ticket appended to the literal `avi-relay-ticket.` prefix.

A ticket works only with its bound role on the publisher side of the bridge. The relay bridges publishers and consumers only under the same authenticated AIVAX account. The publisher keeps its connection alive to stay published. Each consumer connection is independent: after the upgrade, exactly one opening handshake authenticates that connection, regardless of any other consumer connections.

## Consumer handshake

No RPC frame is processed before the handshake completes. Within the 10-second handshake window, send exactly one opening frame as a TEXT message:

```json
{
  "type": "avi-remote-open",
  "version": 2,
  "path": "/rpc"
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `type` | string | yes | Must be exactly `avi-remote-open`. |
| `version` | number | yes | Must be exactly `2`. |
| `path` | string | yes | Exactly `/rpc` or `/rpc/conversations/streams/<thread-id>` with the target conversation id. No other route is bridged. |

Authorization is the AIVAX account identity carried by your ticket; there is no credential field. Handshake version 1 and any frame containing an `apiKey` property are rejected.

On success the publisher sends:

```json
{"type":"avi-remote-ready","version":2}
```

`avi-remote-ready` is sent only after the Desktop establishes an in-process RPC session for the requested route — it does not dial its own loopback listener and never injects a key. It is the consumer's signal that RPC frames will now flow.

On failure the publisher sends an error frame and the channel closes:

```json
{"type":"avi-remote-error","version":2,"code":"unauthorized"}
```

| Code | Meaning |
|---|---|
| `unauthorized` | Reserved for authorization failures; the current Desktop publisher never emits it for an open. Relay and account rejections happen earlier, at the HTTP ticket request or the WebSocket upgrade, and surface as connection failures — never as an error frame. |
| `invalid_open` | The opening frame is malformed, the version is unsupported (including v1), an unexpected `apiKey` property is present, the path is not an allowed route, or data arrived before or instead of the open. |
| `unavailable` | The Desktop could not establish the in-process RPC session for the requested route: session creation failed or the handshake timed out. Route shape is validated at this stage; conversation existence is not. |

Error frames never contain secrets or credentials. Any consumer message other than the single opening frame before `avi-remote-ready` closes the channel as `invalid_open`.

## Heartbeat

After `avi-remote-ready`, the consumer may probe liveness with a TEXT frame:

```json
{"type":"avi-remote-ping","version":2,"id":"<opaque string>"}
```

The Desktop publisher answers:

```json
{"type":"avi-remote-pong","version":2,"id":"<same id>"}
```

Only the consumer initiates application-level heartbeats; the publisher answers them and relies on transport-level WebSocket ping/pong on its own leg. Heartbeats are independent of JSON-RPC traffic. Keep `id` short and opaque (at most 128 characters); it is echoed verbatim.

## After ready

Frames are passed through opaquely to the local JSON-RPC server:

- Use the documented [RPC envelope](overview.md) and per-socket methods; the relay and publisher do not interpret RPC frames.
- Payloads are bounded: a single payload must stay within 1 MiB (the local server's message limit) and the relay envelope cap is 2 MiB plus 1024 bytes of framing. Oversized frames fail closed and close the channel.
- Binary frames are bridged like text, but the local RPC server rejects binary with JSON-RPC error `-32600`; send TEXT only.
- Responses are correlated by JSON-RPC `id` as usual; the relay imposes no ordering or correlation of its own.

## Limits, reconnects, and lost results

- **No replay or recovery.** Nothing is persisted and nothing is ever resent automatically. If the WebSocket drops, treat every pending request as unknown: it may or may not have executed, and clients must never automatically resend commands. After reconnecting and repeating the handshake, recover state through read-only means only — `rpc:discover`, stream subscriptions, and `conversations:context` — and issue further commands only as new, user-driven work.
- **Handshake window.** The open/ready exchange must complete within 10 seconds or the channel is closed.
- **Channel budget.** A publisher serves a bounded number of concurrent consumer channels (32); excess opens may be refused until a channel frees.
- **Ticket single-use; connections are time-boxed.** Tickets work for exactly one connection and expire 60 seconds after issuance; an expired ticket only fails the next upgrade and never terminates an established connection. The relay closes active connections after at most 1 hour with close code `4001`; request a fresh ticket and reconnect. The publisher does this automatically on every (re)connection attempt.
- **Best-effort throughput.** The relay runs on Cloudflare Workers, which cap the publisher leg at roughly 128 messages and 4 MiB per second in aggregate. The bridge fails closed at those limits, and there is no end-to-end flow control between consumer and Desktop: delivery is best-effort, and clients must back off rather than stream at full rate.
- **WAN authorization and revocation.** Bridged connections carry no Remote API key: the AIVAX account substitutes it, and no local key checks run on the WAN. Revoking the AIVAX credential affects only new ticket issuance; existing sessions continue until the relay's 1-hour cap (close code `4001`) or until the Desktop stops them. Local key expiry or revocation never affects bridged connections.
- **Publisher retries are automatic** and invisible to consumers; a transient relay outage appears to consumers as a dropped connection.

## Trust model

- Both legs (consumer→relay, relay→publisher) are TLS, terminated at Cloudflare. Cloudflare and the relay operator can observe all relayed frames and relay API calls, including the AIVAX token, tickets, and all relayed conversation content; no Remote API key travels the WAN.
- The relay is a separate deployed service. Availability, versions, and behavior are outside Avi's control; clients must treat connection failures as transient or configuration errors.
- Verification status: a local cross-component suite drives the real Workspace client stack and Avi's real relay stack through the deployed Worker implementation with AIVAX mocked, covering global `rpc:discover`/`remote:state`, stream ready/events/context, account isolation, and the zero-listener/no-keys WAN model. **Live end-to-end against the deployed relay service is not verified**; protocol mismatches surface as `unavailable` or connection failures in Avi and errors on the consumer side.

## Example session

```text
Workspace (consumer)                              Relay                     Avi (publisher)
   |--- GET /v1/relays, Bearer <AIVAX token> ------------------->|                          |
   |<-- { avis: [{ deviceId, name, ... }] } ----------------------|                          |
   |--- POST /v1/relays/<deviceId>/tickets {role:"consumer"} --->|                           |
   |<-- 201 { ticket, expiresAt, websocketUrl, protocol } --------|                          |
   |--- WSS websocketUrl, [avi-relay-v1, avi-relay-ticket.<ticket>] --->|                    |
   |--- {"type":"avi-remote-open","version":2,                    |                          |
   |     "path":"/rpc"} ----------------------------------------->|--- in-process session -->|
   |<-- {"type":"avi-remote-ready","version":2} ------------------|<--- ok ------------------|
   |--- {"type":"avi-remote-ping","version":2,"id":"a"} --------->|                          |
   |<-- {"type":"avi-remote-pong","version":2,"id":"a"} ----------|                          |
   |--- {"jsonrpc":"2.0","id":1,"method":"rpc:discover"} -------->|--- bridged ------------->|
   |<-- {"jsonrpc":"2.0","id":1,"result":{...}} ------------------|<--- bridged -------------|
```
