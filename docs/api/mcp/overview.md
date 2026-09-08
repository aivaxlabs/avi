# Avi Remote MCP

Remote Control exposes Avi orchestration as a stateless MCP Streamable HTTP server.

## Local endpoints

- `POST /mcp` with `Authorization: Bearer <Desktop-api-key>`
- `POST /mcp/:key` for clients that cannot set an Authorization header

Both forms use the same multi-key store. Expired or deleted keys receive HTTP `401`. The local server binds to loopback, validates Host and enables DNS-rebinding protection. Local access is independent of AIVAX Remote.

## Relay endpoints

AIVAX Remote must be enabled and the Desktop connected to AIVAX. No local listener or forwarded port is required. The existing persistent `relayDeviceId` is unchanged; the separate public `instanceId` contains 10 lowercase alphanumeric characters. Both appear in Settings → Remote control.

### AIVAX bearer authentication

`https://avi-relay.projpw.workers.dev/mcp/<device-id>` accepts the AIVAX account token in `Authorization: Bearer <token>`. The Relay validates it on every request and routes only within the authenticated account. The token is not forwarded to the Desktop, and no Desktop API key is needed.

### Public discovery, per-tool instance key

Connect an MCP client to `https://avi-relay.projpw.workers.dev/mcp` without HTTP authentication. `initialize`, `ping`, and `tools/list` are public; initialization notifications return `202`. The catalog is device-independent and reveals no published instances or account data.

Every tool requires `arguments.instanceKey`, formatted as `<instance-id>@<api-key>`. Use **Copy MCP instance key** in Remote control. New API keys have 6 cryptographically random lowercase letters/digits. Existing longer keys are retained and supported.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "bots_list",
    "arguments": {
      "instanceKey": "abc123def4@a1b2c3",
      "__invocation_goal": "List bots on the selected device",
      "__requires_human_approval": false
    }
  }
}
```

The example credential is fictitious. The Relay strips `instanceKey` from arguments before forwarding. The Desktop verifies the instance prefix and compares against current unexpired keys with timing-safe equality before invoking MCP. Invalid or revoked credentials return an MCP tool error; no tool runs. Treat instance keys as secrets, including in agent histories and logs.

A public instance is registered by an authenticated publisher and permanently bound to that account/device pair. A different pair cannot claim it (`409`, `X-Avi-Error: instance_conflict`); Desktop stops retrying and asks to reconnect the original account. Reconnecting or disabling Remote does not erase the binding. Each account can reserve at most 32 instance IDs; these registrations are persistent. Public calls are limited across IPs to 300 attempts per instance per 10 minutes, with at most 10 failed or outstanding attempts in the window; further calls return `429`. This deliberately trades availability for short-key protection during attacks. The bearer endpoint has separate access and existing Relay transport limits.

The configured custom Relay domain serves the same paths; availability requires deploying the updated Worker and running the updated Desktop.

## Tools

- `bots_list`, `bots_create`, `bots_update`, `bots_delete`, `bots_activate`
- `bots_read_work_log`, `bots_send_work_log_message`
- `chat_overview`, `chat_list_folders`, `chat_list_threads`, `chat_create_thread`
- `chat_send_prompt`, `chat_interrupt_thread`, `chat_inspect_thread`

`chat_overview({ recentMinutes: 60, limit: 20 })` returns `running` (including waiting/sleeping), `recentlyFinished` (latest visible assistant turn completed, errored, or aborted within the window), and open `botInbox` entries. The window accepts 1–10080 minutes; the recent-thread limit accepts 1–100. Completion means the latest turn ended, not that its Goal is permanently finished. Inbox read errors are explicit.

`chat_list_threads` accepts `type: all | user | agent` (persisted creator), `parentThreadId` (exact ID; null selects roots), and `folderPath`. Text output includes creator, concrete thread type, parent ID for children, and direct visible sub-thread count for roots. Side-chat visibility is unchanged.

`bots_read_work_log({ id, workLogId?, status?: all | open | completed })` returns inbox messages, activity diary, and read errors. Message content and diary descriptions remain Markdown strings in the API; the Desktop Inbox and Activity render them with the same restricted visualization directives as chat. No API payload changes are required. `bots_send_work_log_message({ id, workLogId, message })` appends a reply to an existing inbox entry and delivers it to the main bot thread; inspect `delivered` and `error` before retrying because persistence may succeed even if delivery fails. It does not approve pending actions.

`bots_list` preserves `workQueue` and adds `workQueueItems: [{ id, task }]`. IDs are zero-based positions for the current queue snapshot, not persistent identities across edits. `bots_activate({ id, workQueueId? })` overrides the focus for one activation, ahead of actionable inbox work, without advancing the recurring cursor. Invalid IDs fail before activation.

Local and account-specific schemas use the current Desktop model catalog. Public schemas are a checked-in device-independent snapshot of the same definitions plus `instanceKey`. Regenerate the Relay catalog after schema changes from the Desktop repository:

```sh
bun x electron --no-sandbox scripts/export-relay-mcp-tools.mjs /absolute/path/to/avi-relay/src/mcp-tools.js
```

MCP remains tool-oriented. Use [RPC WebSockets](../rpc/overview.md) for application requests and [conversation streams](../rpc/streaming.md) for live events.

## Transport and security

Relayed MCP returns JSON, not SSE. Requests are limited to 512 KiB raw bodies and 1 MiB serialized channel frames; responses to 1 MiB frames. The deadline is 60 seconds. Public `/mcp` accepts POST/OPTIONS; device-specific MCP forwards GET/POST/DELETE to the stateless Desktop transport, which controls method support. Batching and persistent MCP sessions are not supported.

Only Content-Type, Accept, and MCP-Protocol-Version request headers are forwarded. Response headers are restricted to Content-Type, Allow, and MCP-Protocol-Version. Caller Host, Authorization, cookies, and arbitrary headers are never forwarded. Desktop synthesizes `Host: localhost` for its internal MCP request, retaining SDK DNS-rebinding checks.

Offline publishers return `503`; malformed, oversized, or failed responses return `502`; deadline expiry returns `504`. Cancellation is best-effort: runtime disconnect signals may not arrive immediately, so abandoned channels can remain until the 60-second deadline. Cancellation never undoes tool side effects. Never retry a mutation blindly after a timeout. Cloudflare terminates TLS and can observe content and public instance credentials. Local MCP continues to require a Desktop key.

## Related documents

- [All API surfaces](../overview.md)
- [RPC API](../rpc/overview.md)
- [Remote Control setup](../../Remote%20control.md)
