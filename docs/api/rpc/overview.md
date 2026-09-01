# Avi JSON-RPC API

Remote Control exposes selected Electron application requests through two authenticated JSON-RPC 2.0 WebSockets. Each method reference documents its complete parameter and result contract.

## WebSockets

- `ws://127.0.0.1:<port>/rpc` — global operations for folders, regular threads, child conversations, search, bots, sidebar status, and tags.
- `ws://127.0.0.1:<port>/rpc/conversations/streams/:thread-id` — isolated control and events for one conversation.

Both upgrades support `Authorization: Bearer <api-key>`. Browser clients instead offer `avi-rpc-v1` plus the base64url credential protocol described in [Authentication](authentication.md); the server echoes only `avi-rpc-v1`.

## Request envelope

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "conversations:list",
  "params": {}
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `jsonrpc` | string | yes | Must be exactly `"2.0"`. |
| `id` | string or number | no | Correlates a response. Omit for a notification, which never receives a response. |
| `method` | string | yes | One of the methods documented in this section and allowed by the selected socket. |
| `params` | object | no | Named method parameters. Positional arrays are not supported. |

For handlers whose Electron contract accepts one scalar, place it in `params.payload`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "folders:threads",
  "params": { "payload": "C:\\Code\\project" }
}
```

On the conversation socket, Avi infers the conversation ID from the URL. Do not repeat it. Conflicting `conversationId`, `parentConversationId`, or update `id` values are rejected.

## Discovery and models

`rpc:discover` is available on both sockets. It returns Avi `appVersion`, API versions `{ core: 2, rpc: 1, mcp: { latest, supported } }`, the selected socket `scope`, and exact sorted `methods` and `capabilities` arrays. Clients must use the advertised RPC v1 contract; there is no fallback to an earlier RPC version.

`models:list` is available on the global socket and returns `{ models, lastModel, defaultModels, messageDeliveryMode }`: the provider model catalog used by Avi's model picker and `chat:send`, the last selected model, the current default-model preferences, and the authoritative `"queue"` or `"steer"` Message delivery mode from Avi settings. Remote composers use that mode for Enter and the opposite mode for Ctrl+Enter.

## Response envelope

Success:

```json
{"jsonrpc":"2.0","id":1,"result":[]}
```

Failure:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Application request failed",
    "data": { "name": "Error", "message": "Conversation not found." }
  }
}
```

| Error code | Meaning |
|---:|---|
| `-32700` | The WebSocket text message is not valid JSON. |
| `-32600` | Invalid request envelope, empty batch, unsupported binary message, or invalid `params` container. |
| `-32601` | The method is not available on this socket. |
| `-32603` | The application handler or conversation-scope adapter rejected the request. `error.data` contains `name`, `message`, and optional `code` or `status`. |

## Batch and notifications

A JSON array executes as a batch. Responses are returned as an array and may complete in a different order internally. An empty batch is invalid. Requests without `id` are notifications and are omitted from the response, including when their handler fails. A batch containing only notifications receives no message.

## Reference

- [Shared types](types.md)
- [Authentication and API keys](authentication.md)
- [Working folders](folders.md)
- [Sidebar status and tags](sidebar.md)
- [Threads, messages, composer state, tasks, and recovery](conversations.md)
- [Child conversations](child-threads.md)
- [Bots](bots.md)
- [Chat, queue, semaphores, and Goals](chat.md)
- [Conversation notifications](streaming.md)
- [Remote MCP](../mcp/overview.md)
- [All API surfaces](../overview.md)
