---
name: troubleshoot-avi
description: Use when Avi, an MCP server, a tool call, model execution, context discovery, or another app behavior is slow, failing, missing, inconsistent, or otherwise not working as expected. Investigate the Avi diagnostic logs before proposing a cause or fix.
user-invocable: false
---
# Troubleshoot Avi from logs

Diagnose unexpected Avi behavior from runtime evidence. This workflow is **read-only by default**: investigate and report the root cause or the narrowest next diagnostic step. Do not change code, configuration, credentials, or external systems unless the user separately asks for a fix.

## Evidence sources

Start with the smallest relevant time window around the failure:

- `~/.aivax/trace.log` — Avi's persistent diagnostic trace. In Avi, `~` is the current user's home directory.
- Settings → Tuning → Diagnostics — controls the operational trace level. `Verbose` records timings and operational events; `Minimal` records errors only; `Disabled` records only `FATAL` events. Uncaught errors, unhandled rejections, preload failures, and abnormal renderer or child-process termination are always recorded as `FATAL`.
- Settings → MCP servers → select the correct global or project scope → select the server → Error log — connection lifecycle messages and, for `stdio`, server stderr.
- The affected conversation or UI state — exact visible error, tool name, approximate timestamp, duration, workspace, and whether retrying changes the result.
- Relevant source, configuration, process, or service logs only after Avi's logs identify the failing boundary or leave a specific gap.

Avi's persistent trace intentionally excludes prompts, messages, tool inputs, attachments, API keys, and user file paths. Never print or disclose credentials from MCP configuration, environment variables, headers, URLs, or external logs. Redact secrets and personal data in the report.

## Procedure

### 1. Define the incident precisely

Establish what was expected and what happened. Record:

- the operation, MCP server, exposed tool name, and workspace or scope;
- the exact visible error or symptom;
- the approximate timestamp and elapsed time;
- whether the issue is reproducible, intermittent, or historical;
- the last known successful attempt, if discoverable.

Do not start by guessing at network, model, MCP, or application causes.

### 2. Preserve and collect evidence

1. Check the current diagnostic level before interpreting missing entries.
2. Read the tail of `~/.aivax/trace.log` and filter around the incident timestamp, thread, tool, MCP server, event, error, and duration. Avoid dumping the entire log when a narrow query is enough.
3. For MCP incidents, inspect the server in Settings → MCP servers under the scope used by the affected conversation. Capture its status, exposed tools, server instructions, and Error log.
4. If the incident cannot be located and it is safe to reproduce, set Diagnostics to `Verbose`, reproduce the smallest failing action once, note the exact time, and reread only the new entries. Restore the previous diagnostic level afterward if you changed it.
5. If reproduction is destructive, costly, privacy-sensitive, or could duplicate an external side effect, do not retry without explicit authorization. Diagnose from existing evidence.
6. Preserve the original evidence before restarting Avi or the MCP server because the MCP inspection log is an in-memory bounded buffer.

Treat absent logs as inconclusive when logging was `Minimal` or `Disabled`, the relevant buffer rolled over, the app terminated before writing, or the failure occurred outside Avi.

### 3. Correlate the timeline

Build a compact ordered timeline from timestamps and durations. Useful trace events include:

- `app.started` and `logging.configuration-changed`;
- `context.discovery-*` and `context.injection-*`;
- `mcp.scope-*` and `mcp.server-connection-*`;
- `mcp.server-phase-completed` with phase `transport`, `handshake`, or `list-tools`;
- `tool.completed` and `tool.error`, including `tool`, `tool_type`, and `duration_ms`;
- `application.request-*`, `api.retry`, `api.stream-error`, and `chat.*`;
- model fallback, auxiliary task, sub-agent, secure storage, or shutdown events when relevant.

Correlate by timestamp first, then by `thread_id`, `mcp_server`, `tool`, `scope`, `phase`, `round`, and duration. Distinguish direct evidence from inference. Do not claim causation from one nearby error unless the sequence and boundary support it.

#### Practical filtering tips

On Windows, start with a bounded tail and combine terms with `Select-String`. Avi writes one text event per line, so do not parse `trace.log` as JSON:

```powershell
$trace = Join-Path $HOME '.aivax\trace.log'
Get-Content $trace -Tail 1000 | Select-String -Pattern 'term-one|term-two'
```

Prefer the incident's UTC minute plus one stable identifier over a broad error search. Replace the examples with the actual minute, server, tool, or thread; keep enough surrounding events to reconstruct the sequence:

```powershell
Get-Content $trace -Tail 3000 |
  Select-String -Pattern '2026-08-04T04:15|mcp_server="server-name"|tool="exposed_tool_name"|thread_id="thread-id"'
```

Useful filters for common situations:

| Situation | Filter `trace.log` for | Then inspect |
| --- | --- | --- |
| MCP takes long to become ready | `mcp.server-connection-|mcp.server-phase-completed` plus `mcp_server="..."` | Compare `duration_ms` for `phase="transport"`, `phase="handshake"`, and `phase="list-tools"`. The largest phase is the first boundary to investigate. |
| A tool call itself is slow | `tool.completed|tool.error` plus `tool="..."` and, when known, `thread_id="..."` | Compare the tool's `duration_ms` with surrounding `application.request-*`, `api.*`, and `chat.*` events to separate time inside the tool from time before or after it. |
| Tool is missing or was never offered | `mcp.scope-|mcp.server-connection-|phase="list-tools"|context.discovery-|context.injection-` | Check `scope`, `server_count`, `tool_count`, discovery counts, active workspace, and global/project shadowing. A successful `list-tools` with the wrong count points to discovery or naming, not execution. |
| Tool was offered but did not run | The exact `tool="..."`, then `tool.completed|tool.error`; also inspect `application.request-|api.stream-error|chat.` around the same minute | If there is no tool event under known `Verbose` logging, investigate model selection, approval, interruption, or provider flow. Do not search for arguments in Avi's trace because inputs are intentionally omitted. |
| Tool returned an error | `tool.error` plus the tool, thread, and minute | Read `error`, `tool_type`, and `duration_ms`; correlate the same time with the MCP Error log or service log to distinguish Avi validation/cancellation from an error returned by the server. |
| MCP will not connect | `mcp.server-connection-started|mcp.server-connection-error|mcp.server-connection-completed` plus the server | Use `phase` to separate transport, handshake/authentication, and tool discovery. In the MCP Error log, look near `Starting MCP server.`, `OAuth authentication is required.`, or the first stderr/error line. |
| Authentication keeps failing | `status="auth-required"|Unauthorized|OAuth|mcp.server-connection-` | Confirm the active scope and authentication mode without printing token or header values. Determine whether the failure precedes or follows the handshake. |
| Requests retry, stall, or fail before/after a tool | `application.request-|api.retry|api.stream-error` plus `thread_id`, `provider`, or `model` | Use `attempt`, `retry_after_ms`, `status`, `time_to_first_response_ms`, and request `duration_ms` to distinguish provider latency from MCP latency. |
| Workflow, skill, or instruction is absent | `context.discovery-|context.injection-` plus the incident minute | Compare `workflow_count`, `skill_count`, `instruction_count`, `item_count`, `scope`, and `duration_ms`; verify the item exists in the catalog and whether it is intentionally non-invocable. |
| Result succeeded but UI looks stale or wrong | `tool.completed` followed by `chat.*` and `application.request-*` for the same thread | Establish that backend execution completed first, then inspect renderer/conversation state. Do not attribute a display problem to the MCP merely because it is nearby. |
| Shutdown, interruption, or cancellation | `shutdown|interrupt|cancel|abort|tool.error|chat.` plus the thread and minute | Determine the last completed boundary and whether the error appeared before or after the interruption request. |
| Only unusually slow events matter | `duration_ms=` first, then narrow by event/server/tool | PowerShell can highlight obvious five-second-or-longer lines with `Select-String -Pattern 'duration_ms=([5-9]\d{3}|\d{5,})'`; inspect other durations normally instead of treating this threshold as a product limit. |

For the MCP Error log in Settings, use the UI's visible server status and scan only the incident window. Common anchors are `Starting MCP server.`, `Connected with N tool(s).`, `Tool list refreshed`, `Could not refresh tools`, `OAuth authentication is required.`, and the first server stderr line. Stderr content is server-defined, so terms such as `timeout`, `unauthorized`, `forbidden`, `ENOENT`, `ECONNREFUSED`, `429`, or `5xx` are clues, not guaranteed Avi messages or proof of root cause.

If a filter returns nothing, first verify the diagnostic level, time zone, log path, spelling of the exposed tool/server name, and whether the relevant bounded buffer may have rolled over. Broaden one dimension at a time: exact identifier → event family → UTC minute → slightly larger tail. Never interpret an empty result as proof that the operation did not occur unless `Verbose` logging and the relevant retention window are confirmed.

### 4. Isolate the failing boundary

Classify the incident before recommending action:

- **Context/discovery:** the MCP, workflow, skill, instruction, or workspace scope was not discovered, was shadowed, or was loaded from a different scope.
- **Transport/startup:** executable launch, URL, network, working directory, environment, or transport creation failed.
- **Handshake/authentication:** protocol negotiation, OAuth, bearer credentials, or authorization did not complete.
- **Tool discovery:** `list-tools` was slow or failed, the server reported no tool, names conflicted, or the expected exposed name differs after normalization.
- **Selection/schema:** the model chose the wrong tool, generated invalid arguments, or used a schema different from what the server currently exposes.
- **Server execution:** the call reached the MCP server and its implementation failed, timed out downstream, blocked, or returned `isError`.
- **Avi execution:** cancellation, interruption, approval, timeout, output handling, media persistence, or another Avi boundary failed around the call.
- **Presentation/state:** execution succeeded but the renderer, conversation state, or displayed output is stale, truncated, or inconsistent.
- **Provider/model:** the delay or failure occurred before tool selection or after tool output while waiting for the model/provider.

For MCP configuration, compare the active scope and runtime inspection with configuration without exposing secret values. Check whether a project server shadows a global server with the same normalized prefix.

### 5. Diagnose common symptoms

#### Slow MCP or slow tool

1. Compare connection phase durations to determine whether startup, handshake, or `list-tools` is slow.
2. Compare the MCP `tool.completed` or `tool.error` `duration_ms` with surrounding model and application events.
3. Decide whether the delay is before the call, inside the MCP call, after the response, or only during initial connection.
4. Inspect the server's own logs only when Avi evidence places the delay inside the server or its downstream dependency.
5. Repeat only when safe and useful; compare at least two samples before calling an intermittent delay systemic.

#### Tool did not work

1. Confirm the exact exposed tool existed in the affected scope at that time.
2. Determine whether it was never called, rejected before execution, returned an MCP error, was interrupted, or succeeded with an unexpected result.
3. Compare the runtime tool schema with the attempted arguments when those arguments are safely available from the user or server-side logs; Avi's trace does not record tool inputs.
4. If the tool was never called, investigate context, selection, approval, and model flow rather than blaming the MCP implementation.
5. If Avi reports `tool.error`, use its duration and error plus MCP/server logs to locate which side produced the failure.

#### Something is missing, stale, or inconsistent

1. Check workspace, global/project scope, discovery counts, shadowing, and normalized names.
2. Correlate reload or restart events with the configuration change.
3. Verify actual runtime state instead of assuming saved configuration was loaded.
4. Separate a successful backend operation from a renderer or persisted-state problem.

### 6. Verify the diagnosis

Prefer the narrowest non-destructive verification that crosses the suspected boundary. A valid conclusion should have:

- a matching timestamped event or explicit absence under known verbose logging;
- the layer where the operation last succeeded;
- the first observed failure or unexplained delay;
- supporting duration, status, phase, or error evidence;
- a safe reproduction or independent corroborating source when practical.

If evidence is insufficient, say so and name the exact next observation needed. Do not present a hypothesis as a confirmed root cause and do not use a restart as a substitute for diagnosis.

## Output

Report concisely:

1. **Symptom and scope** — affected operation, server/tool, workspace, and time window.
2. **Evidence** — relevant events and durations without secrets or irrelevant raw-log dumps.
3. **Diagnosis** — confirmed root cause, strongest hypothesis, or unresolved boundary, clearly labeled.
4. **Recommended action** — smallest fix or next diagnostic step; do not implement it unless requested.
5. **Validation and limitations** — what was reproduced or checked, diagnostic level used, and evidence that was unavailable.
