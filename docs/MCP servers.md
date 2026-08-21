# MCP servers

Model Context Protocol (MCP) connects Avi to live tools and context from local processes, applications, and remote services. Prefer **Settings → MCP servers** for configuration and diagnostics.

## Scopes and precedence

- Global: `$HOME/.agents/mcpconfig.json`, available to every workspace;
- Project: `$PWD/.agents/mcpconfig.json`, available only when that exact folder is the conversation workspace.

Avi does not recursively search for MCP configuration in subdirectories. An enabled project server shadows an enabled global server with the same normalized tool prefix.

## Configuration formats

### Local stdio server

```json
{
  "servers": {
    "local": {
      "type": "stdio",
      "enabled": true,
      "lifecycle": "active",
      "command": "bunx",
      "args": ["-y", "@example/mcp-server"],
      "cwd": "",
      "env": {
        "API_TOKEN": "value"
      }
    }
  }
}
```

An empty `cwd` uses the configuration scope root. A relative `cwd` is resolved from that root.

### Remote server

```json
{
  "servers": {
    "remote": {
      "type": "streamable-http",
      "enabled": true,
      "lifecycle": "active",
      "url": "https://example.com/mcp",
      "headers": {},
      "auth": {
        "type": "auto",
        "token": "",
        "clientId": "",
        "clientSecret": ""
      }
    }
  }
}
```

Supported transports are `stdio`, `streamable-http`, and legacy `sse`. The legacy `http` alias is normalized to `streamable-http`. Remote authentication modes are `auto`, `none`, `bearer`, and `oauth2`.

### Lifecycle

Every server accepts an optional `lifecycle` field:

- `active` (default): the server connects when its scope initializes and its tools stay available for every conversation.
- `passive`: the server stays disconnected and exposes a single activation tool, `mcp_<normalized-server>_enable_mcp`. Calling it connects the server, removes the activation tool, and makes the real tools available. The server then stays connected for 30 minutes of inactivity, renewed by every tool call. When the lease expires, Avi disconnects the server and it returns to the activation-tool state.

Saving or editing a passive server, or running `/restart-mcp`, returns it to the inactive state. Manually restarting a passive server from Settings connects it immediately and starts the lease.

## Configure a server in Settings

1. Open **Settings → MCP servers**.
2. Choose Global or a known project folder.
3. Select **Add server**.
4. For stdio, enter the executable, one argument per line, working directory, and one `NAME=value` environment entry per line.
5. For remote servers, enter the URL, authentication fields, and one header per line.
6. Save and enable the server.
7. Use **Inspect** to review tools, schemas, server instructions, and connection logs.

Possible states include Passive, Not started, Starting, Connected, Authentication required, Failed, Disabled, and Overridden by folder. In a conversation, `/mcp` shows the available runtime and `/restart-mcp` restarts loaded servers.

## Runtime behavior

MCP tools are exposed as `mcp_<normalized-server>_<normalized-tool>`. Avi imports each tool’s description, input schema, read-only and destructive hints, and any instructions returned by the server. Server instructions are injected inside an `<mcp_context from="...">` block. Passive servers contribute no tools or instructions until activated.

Text, structured JSON, resources, and media results are preserved. Media and blobs are materialized in temporary storage. Avi’s local approval metadata fields are removed before forwarding arguments to the MCP server.

Plan mode disables MCP entirely. In other modes, MCP calls follow the active tool permission behavior.

## Security

`mcpconfig.json` can contain bearer tokens, client secrets, headers, and environment variables in plain text. Treat it as sensitive and do not commit project credentials. Review the executable or package, endpoint, exposed tools, and required access before enabling a server.

Remote OAuth uses a temporary loopback callback. OAuth sessions are persisted through Avi secure storage.

## Troubleshooting

Verify the exact scope, enabled state, executable or URL, working directory, authentication state, and Inspect logs. Restart a server after external configuration changes. Check whether a project server is shadowing a global server or whether two names collide after normalization.

For Avi acting as an MCP server, see [Remote control](Remote%20control.md).
