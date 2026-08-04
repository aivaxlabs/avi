# MCP in Avi

Use Model Context Protocol (MCP) when Avi needs tools or live context from another process, local application, service, or API. MCP is a runtime integration, not a Markdown instruction or workflow.

## Where MCP is configured

Prefer Settings → MCP servers. Avi supports two scopes:

| Scope | Configuration file | Applies to |
|---|---|---|
| Global | `$HOME/.agents/mcpconfig.json` | Every project |
| Project folder | `$PWD/.agents/mcpconfig.json` | Conversations using that folder |

MCP servers are configured globally or per project.

A project server with the same normalized tool prefix as a ready global server shadows the global server for that workspace.

## Supported transports

- `stdio` for a local executable;
- `streamable-http` for current remote HTTP MCP servers;
- `sse` for legacy remote servers.

Remote authentication modes are `auto`, `none`, `bearer`, and `oauth2`. Configure them through the UI when possible so validation, connection state, authentication, tools, server instructions, and logs are visible together.

## Configuration shape

A local server:

```json
{
  "servers": {
    "example": {
      "type": "stdio",
      "enabled": true,
      "command": "bunx",
      "args": ["-y", "@example/mcp-server"],
      "cwd": "",
      "env": {}
    }
  }
}
```

A remote server:

```json
{
  "servers": {
    "example-remote": {
      "type": "streamable-http",
      "enabled": true,
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

For `stdio`, a relative working directory is resolved from the configuration scope: the user's home for global servers and the project root for project servers.

## Runtime behavior

- Enabled servers connect when Avi initializes the relevant scope.
- Server-provided instructions are injected into runtime context.
- Server tools are exposed as `mcp_<normalized-server>_<normalized-tool>`.
- Tool descriptions and schemas come from the server.
- Approval behavior is controlled by Avi's current permission mode and the tool call, not by skill or workflow frontmatter.
- `/mcp` shows servers available to the conversation; `/restart-mcp` restarts loaded servers.

## Security

- Treat `mcpconfig.json` as potentially sensitive: headers, bearer tokens, client secrets, and environment values may be stored in it.
- Do not commit credentials to a project repository.
- Prefer the global scope for personal integrations and project scope only when the integration is genuinely project-specific.
- Review the server's executable, package, endpoint, permissions, and exposed tools before enabling it.
- Use the narrowest credentials and filesystem/network access the server needs.

## Troubleshooting

1. Open Settings → MCP servers and select the correct global or project scope.
2. Confirm the server is enabled and inspect its status.
3. Review connection logs, exposed tools, and server instructions.
4. For `stdio`, verify the executable, one-argument-per-line arguments, working directory, and environment.
5. For remote servers, verify the URL, transport, headers, and authentication state.
6. Restart the server after changing external configuration.
7. Check for a project server shadowing a global server with the same normalized name.
