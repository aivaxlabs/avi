# Avi API reference

Avi exposes three distinct integration surfaces. Choose the section that matches how your integration runs and communicates with Avi.

## Core API

The [Core API](core/overview.md) is the trusted Plugin API available to ECMAScript modules running in Avi's Electron main process. It provides typed namespaces for threads, bots, tools, events, providers, context, storage, panels, settings, and lifecycle management.

Use Core when building an installed Avi plugin that needs direct, in-process access to application capabilities.

## MCP API

The [Remote MCP API](mcp/overview.md) is a stateless Streamable HTTP interface for agent-oriented orchestration tools. It exposes selected bot and chat operations through `/mcp` and `/mcp/:key`.

Use MCP when an external agent or MCP client needs Avi orchestration tools rather than the complete application request surface.

## RPC API

The [Remote JSON-RPC API](rpc/overview.md) exposes selected Electron-equivalent application requests over authenticated WebSockets:

- `/rpc` for global and administrative operations;
- `/rpc/conversations/streams/:thread-id` for isolated bidirectional conversation control and events.

Use RPC when an external application needs structured request/response access, live conversation events, or complete control of a specific thread. Call `rpc:discover` after connecting to verify the exact RPC v1 methods, capabilities, Avi version, and Core/MCP protocol versions advertised by that socket.

## Related guide

See [Remote Control](../Remote%20control.md) for server setup, API key management, endpoints, and the local security boundary shared by MCP and RPC.
