# Advanced settings

Avi distributes advanced controls between **Settings → General** and **Settings → Tuning**.

## General → Chat

| Setting | Default | Effect |
|---|---|---|
| Chat reasoning traces | Visible | Shows or hides reasoning and tool trace blocks |
| Default permission mode | Approve for me | Initial permission state for a new conversation |
| Message delivery mode | Queue | Enter queues; Ctrl+Enter steers |
| Terminal shell | Auto | Shell used by terminal tools |

With Message delivery set to Steer, the Enter and Ctrl+Enter behaviors are reversed. Avi detects installed shells with a ten-second UI timeout and checks the selected shell again before each command.

## General → Desktop

All Desktop options are disabled by default:

- **Keep Avi in the background** — closing the window hides it in the tray;
- **Start Avi on logon** — starts Avi hidden with the operating system;
- **Notify when a conversation finishes** — shows a system notification when supported.

Desktop toggles save immediately. Chat, Tuning, and Personality changes require **Save changes**.

## Tuning → Context management

**Automatic compaction threshold** can be 80%, 90%, or 95%, with 90% as the default. When estimated context use crosses the threshold, Avi creates a detailed checkpoint and compacts earlier history. Use `/compress` to request manual compaction.

## Tuning → Tool execution

- **Tool output length** — 4,096, 8,192 (default), 32,768 characters, or Disabled/No limit. The UI estimates tokens as characters divided by four. Disabling truncation can exhaust the model context window.
- **Terminal timeout** — 5–300 seconds, default 30. An individual tool call can supply its own timeout.

## Tuning → Orchestration

**Max concurrent sub-agents per thread** accepts 1–128 and defaults to 128. Despite the UI label, the current runtime counts active sub-agents globally across the Avi process.

## Tuning → Diagnostics

- **Verbose** — detailed timings and errors;
- **Minimal** — default; errors only;
- **Disabled** — no operational trace logging.

The log is `~/.aivax/trace.log`. The Settings description states that logs do not include prompts, messages, tool inputs, attachments, API keys, or user file paths.

## Tool approvals

Under **Approve for me**, each tool call includes a model-supplied `__requires_human_approval` classification; approval is not determined solely by MCP annotations. Avi opens a dialog only when the tool is not approval-exempt, approval is requested, the mode is not Full access, and no matching persistent approval exists.

**Always allow this command** stores a pattern based on the workspace and invocation summary and adds global permission guidance. A materially different summary can require approval again.

Full access removes the approval dialog but does not override higher-level runtime restrictions. Plan remains read-only under every permission mode.

## Persistence and validation

Tuning and Desktop settings are stored locally. Values outside accepted ranges are rejected or normalized. **Save changes** is disabled when the selected shell is unavailable or terminal timeout/concurrency values are invalid.

See [Themes](Themes.md), [Personalities](Personalities.md), [Archive](Archive.md), and [Remote control](Remote%20control.md).
