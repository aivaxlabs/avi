# Remote control

Remote Control exposes Avi orchestration through authenticated local MCP and JSON-RPC APIs. It is an experimental integration surface, not remote desktop control.

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

## Security boundary

The server binds only to `127.0.0.1`, accepts only localhost and 127.0.0.1 Host values, compares credentials with timing-safe equality, rejects expired keys, limits HTTP and WebSocket messages to 1 MiB, and enables DNS-rebinding protection for MCP.

Despite its name, Remote Control is not directly exposed to the LAN or Internet. Any external tunnel or proxy is a separate system and security responsibility.

## MCP

The stateless Streamable HTTP MCP server exposes bot and chat orchestration tools. See [Remote MCP API](api/mcp/overview.md).

## JSON-RPC WebSockets

`WS /rpc` handles administrative/global folder, thread, search, and bot operations. It does not receive detailed conversation events.

`WS /rpc/conversations/streams/:thread-id` is bidirectional and isolated to one conversation. It accepts prompt, attachment, Goal/Plan/Ultra, queue/steer, interruption, retry/edit, question, and approval operations and emits sequenced JSON-RPC notifications for that conversation's chat events.

See:

- [API reference](api/overview.md)
- [RPC overview](api/rpc/overview.md)
- [Shared RPC types](api/rpc/types.md)
- [Authentication](api/rpc/authentication.md)
- [Working folders](api/rpc/folders.md)
- [Threads, messages, composer state, and tasks](api/rpc/conversations.md)
- [Child conversations](api/rpc/child-threads.md)
- [Bots](api/rpc/bots.md)
- [Chat, queue, semaphores, and Goals](api/rpc/chat.md)
- [Conversation notifications](api/rpc/streaming.md)
