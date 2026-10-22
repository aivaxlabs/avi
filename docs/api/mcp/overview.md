# Avi Remote MCP

Remote Control exposes Avi orchestration as a stateless MCP Streamable HTTP server.

## Local endpoints

- `POST /mcp` with `Authorization: Bearer <Desktop-api-key>`
- `POST /mcp/:key` for clients that cannot set an Authorization header

Both forms use the same multi-key store. Expired or deleted keys receive HTTP `401`. The local server binds to loopback, validates Host and enables DNS-rebinding protection. Local access is independent of AIVAX Remote.

## Command endpoint

The same tools can be invoked without MCP framing through `/commands/:tool`, authenticated with `Authorization: Bearer <Desktop-api-key>` (no path credential):

```sh
curl -H "Authorization: Bearer $AVI_KEY" http://127.0.0.1:18992/commands/bots_list
curl -H "Authorization: Bearer $AVI_KEY" http://127.0.0.1:18992/commands/bots_activate -d '{"id":"<bot-id>"}'
curl -H "Authorization: Bearer $AVI_KEY" "http://127.0.0.1:18992/commands/bots_activate?id=<bot-id>&workQueueId=0"
```

- `POST` reads the arguments from a JSON object body; an empty body means `{}`.
- `GET` reads the arguments from the query string. Values of parameters declared as integer, number, boolean, object, or array are parsed as JSON (invalid values return `400`); others stay strings.
- Success returns HTTP `200` with the tool's structured result, or `{ "text": "..." }` for text results. Tool errors return `400` with `{ "error": "..." }`; unknown tools `404`; other methods `405`; missing or invalid keys `401`.

The endpoint is local only; the Relay does not publish it. See [Avi commands](../../api.md) for every command's arguments and results.

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
- `quick_chat_invoke`: runs one Quick chat turn with the Quick chat tools and returns `{ text, model, toolCalls, attachments, usage }`; no session is kept. See [Avi commands](../../api.md#quick_chat_invoke).

`chat_overview({ recentMinutes: 60, limit: 20 })` returns `running` (including waiting/sleeping), `recentlyFinished` (latest visible assistant turn completed, errored, or aborted within the window), and open `botInbox` entries. The window accepts 1–10080 minutes; the recent-thread limit accepts 1–100. Completion means the latest turn ended, not that its Goal is permanently finished. Inbox read errors are explicit.

`chat_send_prompt` keeps its existing arguments and queue/steer behavior. Delivered text is wrapped in `<cross-message from_thread_id="..." from_role="..." from_name="...">`, with escaped runtime-derived origin attributes and an explicit agent-to-agent/not-user-instruction notice. `from_role` is the source conversation type; `from_name` is omitted when unavailable. Global MCP calls without a source conversation use `external` / `external_agent`. The persisted envelope is also included in model history. All persisted `fromAgent` user-role messages receive an additional model-only `<agent_message>` notice during normal/retry history reconstruction, including automatic sub-agent final/error reports, which now retain `fromAgent: true`. Old database rows are not migrated. See [Sub-agents](../../Sub-agents.md#coordination-tools).

`chat_list_threads` accepts `type: all | user | agent` (persisted creator), `parentThreadId` (exact ID; an empty string selects roots), and `folderPath`. Text output includes creator, concrete thread type, parent ID for children, and direct visible sub-thread count for roots. Side-chat visibility is unchanged.

`bots_read_work_log({ id, workLogId?, status?: all | open | completed })` returns inbox messages, activity diary, and read errors. Message content and diary descriptions remain Markdown strings in the API; the Desktop Inbox and Activity render them with the same restricted visualization directives as chat. No API payload changes are required. `bots_send_work_log_message({ id, workLogId, message })` (`message` is Markdown; its schema description asks for short paragraphs and lists rather than one dense paragraph) appends a reply to an existing inbox entry and adds it to the bot's priority queue, returning `queued` and `queueItemId`; replies to an entry waiting for approval are saved without being queued. It does not approve pending actions. Bot conversations receive `bots_list`, `bots_read_work_log`, and `bots_send_work_log_message` only when the global `crossBotInbox` bot setting is enabled; a bot's reply is stored as role `agent` with its `sender` and delivered with `from="bot"`.

Global bot activation hours, Snoozes, and FIFO capacity apply only to automatic scheduled activations. `bots_activate` is explicit and ignores them, returning `status: "started"`, `"queued_next"` when it will start right after the current run, or `"start_failed"`. `chat_send_prompt` to a bot's main thread from another thread adds the prompt to that bot's priority queue and returns `Status: queued_for_bot` with the queue item ID. Bot listings also include `priorityQueue`, `priorityAutoContinue`, and `lastActivationKind`; `bots_create` and `bots_update` accept `priorityAutoContinue`. Bot listings expose the scheduling states `queued`, `outside-window`, and `sleep` and `effectiveExecutionMode`; create/update accepts `executionMode` (`direct`, `orchestrator`, or `inherit` for the global mode). Tool schemas use one JSON type per field for provider compatibility: empty strings and `0` clear optional overrides instead of `null`. See [Bots RPC](../rpc/bots.md) for global settings and 1d/7d/30d descendant statistics.

`permissionMode: "approve_for_me" | "full_access"` is read-only through agent tools: `bots_list` and create/update results expose the stored mode, but `bots_create` and `bots_update` reject attempts to set it, even when called directly without schema validation. Bots created through tools default to `approve_for_me`. Choose the mode in Bot settings; agent tools cannot grant themselves or other bots Full access. `full_access` skips automatic tool approvals, including destructive tools, for new bot activations, restart resumptions, Inbox continuations, and bot-composer messages; it does not change active turns or resolve existing approvals.

`bots_list` preserves `workQueue` and adds `workQueueItems: [{ id, task }]`. IDs are zero-based positions for the current queue snapshot, not persistent identities across edits. `bots_activate({ id, workQueueId? })` overrides the focus for one explicit activation without advancing the recurring cursor. Invalid IDs fail before activation.

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
