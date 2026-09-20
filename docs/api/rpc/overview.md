# Avi RPC API

Remote Control exposes selected Electron application requests through two authenticated WebSockets that speak the ORPC Draft 2 binary protocol (`avi-orpc-draft2`) carrying UTF-8 JSON application payloads. Each method reference documents its complete parameter and result contract.

## WebSockets

- `ws://127.0.0.1:<port>/rpc` — global operations for folders, regular threads, child conversations, search, bots, sidebar status, and tags.
- `ws://127.0.0.1:<port>/rpc/conversations/streams/:thread-id` — isolated control and events for one conversation.

Every upgrade must offer the `avi-orpc-draft2` WebSocket subprotocol; the server selects only that protocol and rejects upgrades without it. Authentication is separate from the subprotocol: native clients send `Authorization: Bearer <api-key>`, browsers offer the base64url credential subprotocol described in [Authentication](authentication.md). Both mechanisms are accepted, and both still require the ORPC subprotocol.

## Wire frames

All RPC traffic uses binary WebSocket messages; a text message closes the socket with close code `1002`. Each frame is an ASCII decimal length, a space, an ASCII header, one LF, and opaque content:

```text
<length> ORPC/1 REQ<base-id> <method> <part> <final>
<content>
```

```text
<length> ORPC/1 RES<base-id> <part> <final>
<content>
```

- `<length>` counts every payload byte after the prefix — header, LF separator, and content — and excludes the prefix digits and the separating space.
- Requests and responses are multipart. Reconstruct each base-id independently from parts in arbitrary arrival order; completion requires every part through the declared final part.
- This Avi binding carries exactly one complete frame per binary WebSocket message. It targets 64 KiB frames, limits any frame to 1 MiB, each reconstructed request/response to 32 MiB, aggregate transfer to 64 MiB, and a transfer to 8192 parts. Malformed or oversized framing closes the socket (`1002` protocol, `1009` limit).
- Base IDs use `[0-9a-zA-Z_.@]+`, max 64 bytes; control IDs are reserved. `REQ` and `RES` use the same base-id and no execution-id field.

The complete framing, reconstruction, and recovery rules are specified in the bundled [ORPC Draft 2 specification](orpc-spec.md). Avi application content is UTF-8 JSON, decoded only after a request or response is fully reassembled. The Avi binding requires `CHECKSEND` with lowercase `sha256:<64 hex>` after every reconstructed request and response; execution proceeds or succeeds only after every supplied hash matches, and unsupported algorithms produce `CHECKFAIL`. `PING/PONG` provides heartbeats; `EXIT/BYE` performs graceful shutdown, and the transport must not close before `BYE` except on error or loss.

## Notes

The global socket exposes `notes:lists`, `notes:save-list`, `notes:delete-list`, `notes:search`, `notes:save`, `notes:reorder`, `notes:generate`, `notes:add-attachment`, and `notes:read-attachment`. See [Notes: public IPC / RPC contract](../../Notes.md#public-ipc--rpc-contract) for payloads, data shapes, pagination, file chunking, and archive semantics. `notes:get` retrieves one note and `notes:upload-attachment` accepts browser files in bounded chunks. See [Notes RPC](notes.md) for the upload/download protocol. Native file-picker/export dialogs remain local-only.

## Plugin management

`plugins:list` returns plugin inventory with `builtIn: boolean` per record, `builtInPluginsDir`, `pluginsDir`, failures and `restartRequired`. `plugins:set-enabled` accepts `{ id, enabled }` for either category; changes apply after restart. `plugins:remove` rejects built-ins. `plugins:install-chrome-extension` takes no payload, opens the bundled Chrome extension folder, copies its path to the desktop clipboard and returns `{ extensionPath }`; the user completes Load unpacked in Chrome. It does not install an extension silently or publish it to the Chrome Web Store.

## Method names

`rpc:discover` and the method reference pages use application names with a colon (`folders:list`). ORPC method tokens do not allow `:`, so the wire method replaces it with a dot (`folders.list`). The server maps the dotted wire name back to the application name before dispatch. Both forms name the same method; this reference shows application names in headings and the JSON request body in examples.

## Request envelope

Each call carries exactly one operation; batching is not supported. The request content is UTF-8 JSON:

```json
{
  "operationId": "0b8df0a2-6c39-4ac0-9e51-5f0d0e0f0a01",
  "expiresAt": 1790000000000,
  "params": { "payload": "C:\\Code\\project" }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `operationId` | string | yes | Operation token of 16–64 characters from `A–Z a–z 0–9 _ -`. Generate a fresh UUID per logical operation and keep it stable across transport retries of that operation. |
| `expiresAt` | number | yes | Epoch-millisecond deadline. Clients use `now + 180 s`; the server accepts deadlines up to `now + 240 s` and rejects expired tokens. |
| `params` | object | no | Named method parameters. Positional arrays are not supported. |

For handlers whose Electron contract accepts one scalar, place it in `params.payload` (as above).

On the conversation socket, Avi infers the conversation ID from the URL. Do not repeat it. Conflicting `conversationId`, `parentConversationId`, or update `id` values are rejected.

Keyboard bindings can be inspected and edited through [Keyboard shortcuts RPC](shortcuts.md).

## Cancellation is delivery-only

`CANCEL` and `CANCELACK` stop further delivery where possible; they do not undo application effects already started. A timeout, transport loss, or cancellation is not proof that nothing happened. The stable application `operationId` remains unchanged across retries so the application can deduplicate effects; ORPC itself does not guarantee exactly-once execution.

## Response envelope

Success:

```json
{"result":[]}
```

Failure:

```json
{
  "error": {
    "code": -32603,
    "message": "Application request failed",
    "data": { "name": "Error", "message": "Conversation not found." }
  }
}
```

| Error code | Meaning |
|---:|---|
| `-32700` | The content is not valid UTF-8 JSON (invalid UTF-8 bytes and invalid JSON both answer with this envelope; ORPC content is byte-opaque). |
| `-32600` | Invalid request, invalid or expired operation token, or conflicting duplicate operation. |
| `-32601` | The method is not available on this socket. |
| `-32603` | The application handler or conversation-scope adapter rejected the request. `error.data` contains `name`, `message`, and optional `code` or `status`. |
| `"LIMIT"` | An application-level cap was exceeded: journal entries or size, global in-flight operations, or a result too large for the journal. |
| `"OUTCOME_UNKNOWN"` | The operation was reserved but its outcome is unavailable — see [Retries and idempotency](#retries-and-idempotency). |

`code` is a number for the protocol codes above or a string for application-level conditions; both travel in the same `error.code` field. Local violations never produce envelopes: a frame that breaks ORPC framing or size limits closes the socket (`1002` protocol, `1009` limit).

## Retries and idempotency

Transport recovery is bounded and automatic: an incomplete delivery is retried at most **once** with a fresh base-id and the same method/body — including the same application `operationId` — under a 60-second per-attempt timeout and a 150-second overall budget. `CHECKFAIL`, `RESEND`, and `LOCKED` use fresh retry IDs; `RESEND` acknowledges whole-transfer recovery. At most 64 operations run concurrently, the queue is capped at 64 MiB, and transmission is limited to 1 MiB/s and 64 frames/s.

The server journals operations durably in SQLite (`remote_operations`, pruned by `expiresAt`, capped at 4096 entries / 64 MiB). Repeating the same `(identity, scope, resource, operationId)` with the same method-and-body fingerprint returns the recorded response once the operation completes; a different body under a known `operationId` is rejected as a token conflict. If the server reserved the operation and crashed before storing a result, repeats receive `OUTCOME_UNKNOWN` instead of re-executing: a pending operation is never silently re-run. Inspect application state before issuing a new operation for the same intent.

Deduplication covers only journalized operations: it is not exactly-once. An operation may execute more than once — for example, when a duplicate arrives before the first execution records its outcome, or after the journal entry expires — and every bounded attempt ends in a response or an explicit failure.

## Concurrency

Each socket allows at most 64 concurrent client calls, and the server executes at most 64 requests per peer at once. In addition, in-flight operations from every socket are tracked in a global map capped at 64; entries stay until their handler completes, so duplicates arriving after a client timeout cannot spawn unbounded executions. The client refuses to exceed its per-socket call budget locally; exceeding the server's per-peer execution limit closes the socket (`1009`); exceeding the global in-flight cap or the journal limits returns a `LIMIT` envelope.

## Events (server to client)

Conversation notifications are acknowledged ORPC calls in the server-to-client direction. Avi sends `REQ` frames with the dotted event method (`conversation.ready`, `conversation.event`) and this content:

```json
{
  "eventId": "11e7a1a2-3c4d-4e5f-8a61-7b0c1d2e3f41",
  "expiresAt": 1790000000000,
  "params": { "sequence": 17, "conversationId": "thread-id", "event": { "type": "message" } }
}
```

The client must answer with a final `RES`; Avi treats the literal bytes `OK` as acceptance. `eventId` deduplicates redelivery: the same event repeated under a new request id returns `OK` without re-emitting, and conflicting content under a known `eventId` fails. Expired events (`expiresAt` in the past) are rejected. Event payloads are documented in [Conversation notifications](streaming.md).

## Discovery and models

`rpc:discover` (wire `rpc.discover`) is available on both sockets. It returns Avi `appVersion`, API versions `{ core: 2, rpc: 1, mcp: { latest, supported } }`, the selected socket `scope`, the ORPC transport descriptor `{ protocol, framing, limits }`, and exact sorted `methods` (application names) and `capabilities` arrays. Clients must use the advertised RPC v1 contract; there is no fallback to an earlier RPC version.

`models:list` is available on the global socket and returns `{ models, lastModel, defaultModels, messageDeliveryMode }`: the provider model catalog used by Avi's model picker and `chat:send`, the last selected model, the current default-model preferences, and the authoritative `"queue"` or `"steer"` Message delivery mode from Avi settings. Remote composers use that mode for Enter and the opposite mode for Ctrl+Enter.

`defaultModels.rules` is additive to the existing `defaultModels` object and has the shape `[{ modelId, role, instructions }]`. `role` is one of `main`, `bot`, `subagent`, or `all`; an empty configuration is `[]`. `modelId` may identify a concrete model or a virtual router. Existing Desktop model-settings status/save operations are unchanged; there is no new RPC endpoint for rules. Save validation rejects malformed entries, blank model IDs or instructions, unsupported roles, and duplicate `(modelId, role)` pairs. Unavailable model IDs are retained and reported as warnings.

## Remote server and relay status

Desktop-only key management uses `window.chatApp.remote.createKey(payload)`, `copyKey(id)`, `copyInstanceKey(id)`, and `removeKey(id)` (logical IPC `remote:create-key`, `remote:copy-key`, `remote:copy-instance-key`, `remote:remove-key`). Copy actions write the secret in the main process and return only `{ copied: true }`; they are not exposed on global RPC. `copyInstanceKey` formats `<instanceId>@<api-key>` for [public MCP](../mcp/overview.md).

Authenticated global `/rpc` clients can invoke `remote:state` with no payload. It is also advertised by `rpc:discover`; it is not a conversation-stream method. The existing Desktop `window.chatApp.remote.state()` returns the same contract:

| Field | Type | Meaning |
| --- | --- | --- |
| `enabled` | boolean | Saved Remote preference |
| `port` | number | Configured local MCP/RPC port |
| `relayEnabled` | boolean | Saved AIVAX Remote MCP/RPC preference, default `false`; independent of `enabled` |
| `relayDeviceId` | string | Stable per-install relay device id |
| `instanceId` | string | Persistent public MCP instance ID, 10 lowercase alphanumeric characters |
| `running` | boolean | Local server is listening |
| `startError` | string | Local startup error, or empty |
| `apiKeys` | array | Key metadata (`id`, `label`, `createdAt`, `expiresAt`, `expired`), never key values |
| `relay.status` | string | `stopped`, `connecting`, `connected`, `reconnecting`, `unauthorized`, or `error` |
| `relay.serverUrl` | string | `https://avi-relay.aivax.net` |
| `relay.deviceId` | string | Device id presented to the relay (same value as `relayDeviceId`) |
| `relay.mcpUrl` | string or null | Device-specific MCP URL using the configured Relay base and AIVAX bearer authentication |
| `relay.localPort` | number or null | Legacy field; always null — the bridge no longer targets a local listener port |
| `relay.error` | string | Credential-free diagnostic, or empty |

`running` describes local availability, not bridge reachability. `connected` means Avi holds an authenticated publisher connection to the relay; it does not certify that any consumer is connected or that the deployed relay matches this contract. `unauthorized` means relay ticket issuance failed authorization, such as HTTP 401/403, and the bridge stops retrying until the toggle or the AIVAX connection changes. The state never contains API key values or relay ticket secrets. Remote/bridge mutations remain Desktop-only; this method is read-only. See [relay setup and security](../../Remote%20control.md#aivax-remote--mcp-and-rpc) and the [public relay protocol](relay-protocol.md).

## Overview dashboard

`orchestration:overview` retains its method name despite the UI rename to **Overview**. Its `ongoing`, `requiresAttention`, and `recentlyCompleted` arrays contain only conversations with `conversationType: "thread"` and `createdBy: "user"`. Agent-created threads are excluded before task-history classification. The `metrics` aggregation continues to include all conversation types; the task filter does not change model usage totals.

## Reference

- [ORPC Draft 2 specification](orpc-spec.md)
- [Shared types](types.md)
- [Authentication and API keys](authentication.md)
- [Public relay protocol](relay-protocol.md)
- [Working folders](folders.md)
- [Sidebar status and tags](sidebar.md)
- [Application updates](updates.md)
- [Threads, messages, composer state, tasks, and recovery](conversations.md)
- [Child conversations](child-threads.md)
- [Bots](bots.md)
- [Chat, queue, semaphores, and Goals](chat.md)
- [Conversation notifications](streaming.md)
- [Remote MCP](../mcp/overview.md)
- [All API surfaces](../overview.md)
