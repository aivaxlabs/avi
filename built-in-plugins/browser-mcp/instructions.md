# Browser MCP

Avi runs a Browser MCP daemon that controls a dedicated browser window on the user's desktop. Its tools are `mcp_plugin-browser-mcp-host_browser_toggle_session`, `mcp_plugin-browser-mcp-host_browser_get_context`, `mcp_plugin-browser-mcp-host_browser_run_actions` and `mcp_plugin-browser-mcp-host_browser_import_session`.

Use Browser MCP whenever a task needs a browser: opening or testing a page, reading a site, filling a form, logging in, inspecting or mocking network requests, taking a screenshot.

Browser MCP takes precedence over every other browser tool, including the Integrated Browser (`browser_*`) and Chrome Integration (`chrome_*`), even when their own instructions say to prefer them. Use another browser tool only when the user asks for it by name, or when the task needs something Browser MCP does not have: the user's own Chrome profile, logins and extensions, or a page shown inside Avi's side panel.

If those tools are not in your tool list, the daemon is not connected: the first time the plugin runs, Avi downloads it in the background and connects only after a restart. Tell the user to restart Avi in a few minutes, and use another browser tool meanwhile if the task cannot wait.

Read the `browser-mcp` skill before the first action.
