# Avi Remote MCP

Remote Control exposes Avi orchestration as a stateless MCP Streamable HTTP server.

## Endpoints

- `POST /mcp` with `Authorization: Bearer <api-key>`
- `POST /mcp/:key` for clients that cannot set an Authorization header

Both forms use the same multi-key store. Expired or deleted keys receive HTTP `401`.

## Tools

- `bots_list`, `bots_create`, `bots_update`, `bots_delete`, `bots_activate`
- `chat_list_folders`, `chat_list_threads`, `chat_create_thread`
- `chat_send_prompt`, `chat_interrupt_thread`, `chat_inspect_thread`

Schemas are generated from Avi's client-tool definitions and current model catalog. MCP remains a tool-oriented agent interface; use the [JSON-RPC WebSockets](../rpc/overview.md) for Electron application requests and the [conversation WebSocket](../rpc/streaming.md) for bidirectional control and live events.

## Transport and security

The MCP endpoint is stateless and returns JSON responses while accepting the SDK's Streamable HTTP negotiation headers. It binds to loopback, validates Host, enables DNS-rebinding protection, limits bodies to 1 MiB, and uses timing-safe key comparison.

The MCP endpoint is not available through the public RPC WAN bridge: the relay carries only the JSON-RPC WebSockets (`/rpc` and `/rpc/conversations/streams/:thread-id`), so MCP stays reachable on the loopback interface exclusively. The local endpoint keeps requiring Remote API keys; the bridge's AIVAX authentication applies only to the relayed RPC WebSockets and never relaxes local MCP authentication. See [relay security and lifecycle](../../Remote%20control.md#rpc-wan-bridge).

## Related documents

- [All API surfaces](../overview.md)
- [JSON-RPC API](../rpc/overview.md)
- [Remote Control setup](../../Remote%20control.md)
