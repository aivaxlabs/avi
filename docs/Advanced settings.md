# Advanced settings

Avi distributes advanced controls between **Settings → General** and **Settings → Tuning**.

## General → Chat

| Setting | Default | Effect |
|---|---|---|
| Continuation replies | Enabled | Uses the auxiliary model to suggest up to four likely user replies after a response finishes |
| Chat reasoning traces | Visible | Shows or hides reasoning and tool trace blocks |
| Default permission mode | Approve for me | Initial permission state for a new conversation |
| Message delivery mode | Queue | Enter queues; Ctrl+Enter steers |
| Terminal shell | Auto | Shell used by terminal tools |

Continuation replies are generated only when an auxiliary model is configured, the latest assistant response is complete, and no sub-agent is still working. Sending any message removes the suggestions.

With Message delivery set to Steer, the Enter and Ctrl+Enter behaviors are reversed. Avi detects installed shells with a ten-second UI timeout and checks the selected shell again before each command.

## General → Desktop

All Desktop options are disabled by default:

- **Keep Avi in the background** — closing the window hides it in the tray;
- **Start Avi on logon** — starts Avi hidden with the operating system;
- **Notify when a conversation finishes** — shows a system notification after a user-created main thread finishes and none of its sub-agents are still running;
- **Transparent sidebar**, under **Settings → Personalization → Mode** — uses the supported operating-system window effect and active theme surfaces.

Desktop toggles save immediately. Chat, Tuning, Personality, and Verbosity changes require **Save changes**.

## Tuning → Context management

**Automatic compaction threshold** can be 80%, 90%, or 95%, with 90% as the default. When estimated context use crosses the threshold, Avi creates a detailed checkpoint and compacts earlier history. Use `/compress` to request manual compaction.

Click the context percentage beside the composer to open **Context usage**. Its segmented bar counts serialized characters for Avi and custom instructions, global skills/workflows, Avi and MCP tools, messages, and tool results, then scales those weights to the latest input-token usage reported by the provider. MCP instructions and tools are grouped by server. **Other** is the remaining margin for media, files, provider-specific context, and data that cannot be classified reliably.

The dialog offers two manual modes:

- **Quick compaction** replaces tool results before the latest four user turns with `[output truncated due to context compress - invoke this tool again]`, removes associated tool media/provider continuation data, and does not call a model. Use `/quick-compress` to run it from the composer;
- **Full compaction** runs the same detailed checkpoint flow as `/compress`.

## Tuning → Tool execution

- **Tool output length** — 4,096, 8,192 (default), 32,768 characters, or Disabled/No limit. The UI estimates tokens as characters divided by four. A tool definition can set `forcedTruncationLength` in estimated tokens to override this setting for its own output, including when global truncation is disabled. Disabling truncation can exhaust the model context window.
- **Terminal timeout** — 5–300 seconds, default 30. An individual tool call can supply its own timeout.

## Tuning → Orchestration

**Max concurrent sub-agents per thread** accepts 1–128 and defaults to 128. Despite the UI label, the current runtime counts active sub-agents globally across the Avi process.

**Rubber Duck max turns** accepts 10–500 and bounds each rubber-duck analysis started with `/rubber-duck`. The analysis presents its critique to the conversation and proposes a plan; it does not act on the report by itself.

## Tuning → Diagnostics

- **Trace + Requests** — Verbose trace plus the raw HTTP request and response written on API errors;
- **Verbose** — detailed timings and errors;
- **Minimal** — default; errors only;
- **Disabled** — fatal errors only; operational trace logging is disabled.

Uncaught main-process and renderer errors, unhandled rejections, renderer/preload failures, and abnormal renderer or child-process termination are recorded as `FATAL` at every level. The log is `~/.aivax/trace.log`. Logs do not include prompts, messages, tool inputs, attachments, API keys, or user file paths.

In **Trace + Requests** mode, a failed provider API request (HTTP status `>= 400` or a transport error) writes the raw HTTP request and response to `$TEMP/.avi/debug/request-logs/yyyy-MM-dd-model-randomid.log`. The request body is the full inference payload, so unlike the trace log it does contain prompts and messages; `Authorization`/`Bearer` tokens, API keys, and user file paths are redacted.

For isolated startup diagnostics, launch Avi with these command-line flags:

- `--inactive-bots` keeps the bot scheduler stopped and does not resume interrupted bot runs;
- `--memory-trace` writes `app.memory-trace` samples every 250 ms with main-process CPU, memory, filesystem-operation counts, page faults, and, on Windows, process I/O throughput in bytes per second. This explicit flag records samples even when the saved diagnostic level is Disabled and adds its own small logging overhead.

## Tool approvals

Under **Approve for me**, each tool call includes a model-supplied `__requires_human_approval` classification; approval is not determined solely by MCP annotations. Avi opens a dialog only when the tool is not approval-exempt, approval is requested, the mode is not Full access, and no matching persistent approval exists.

**Always allow this command** stores a pattern based on the workspace and invocation summary and adds global permission guidance. A materially different summary can require approval again.

Full access removes the approval dialog but does not override higher-level runtime restrictions. Plan remains read-only under every permission mode.

## Persistence and validation

Tuning and Desktop settings are stored locally. Values outside accepted ranges are rejected or normalized. **Save changes** is disabled when the selected shell is unavailable or terminal timeout, sub-agent concurrency, or Rubber Duck max turns values are invalid.

See [Themes](Themes.md), [Personalities](Personalities.md), [Archive](Archive.md), and [Remote control](Remote%20control.md).
