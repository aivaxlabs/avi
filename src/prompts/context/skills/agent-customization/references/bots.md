# Bots in Avi

Use bots for persistent, proactive responsibilities that should survive across activations. Use a regular thread or `chat_spawn_subagent` for one-off work.

## Agent tools

Normal threads and Quick Chat can manage bots with:

- `bots_list`: lists every bot, its main thread, directly associated work threads, full configuration, folders, and runtime state.
- `bots_create`: creates a persistent bot and main conversation.
- `bots_update`: changes selected configuration fields without replacing the full configuration.
- `bots_delete`: removes the bot, its main conversation, and pending approvals. Persistent files and work threads remain available. This is destructive and requires approval outside Full access.
- `bots_activate`: starts an immediate activation while ignoring automatic enabled, period, idle, window, and activation-limit rules. It requires a non-empty Work queue and never starts a duplicate run for a bot that is already running.

These tools are intentionally unavailable inside autonomous bot conversations. A bot may coordinate its worker threads, but it must not create or control other bots.

## Configuration

`bots_create` requires `name` and a configured `model`. Other fields are optional:

- `workingFolder`: absolute project folder. If omitted, Avi creates a dedicated folder under `~/.aivax/bots/`.
- `instructions`: recurring responsibilities, priorities, boundaries, and completion signals.
- `workQueue`: ordered recurring tasks distributed round-robin across successful activations. The current item is supplied as the activation's focus. An empty list prevents all activations, including `bots_activate`.
- `reasoningEffort` and `contextSize`: model-specific overrides.
- `personality`: optional personality ID, or `null` to inherit the global setting.
- `activationMode`: `static` runs every due period; `smart` can request idle time when no meaningful work remains.
- `activationPeriodMinutes`: positive interval between automatic activations.
- `maxActivations`: consecutive activation limit before cooldown; `0` means unlimited.
- `activationWindow`: local-time `{ days, startMinute, endMinute }`, with weekdays `0` through `6` representing Sunday through Saturday. An empty `days` array means every day. Overnight windows are supported.
- `enabled`: controls automatic activation. An explicit `bots_activate` call can still run a disabled bot once.

`bots_update` accepts the same fields inside `changes`. Send only fields that should change.

## Context and storage

A bot inherits global and working-folder context. `BOTS.md` follows instruction discovery rules but is exposed only to bot threads. Use it for durable bot-only workspace rules; keep one bot's specific purpose in its `instructions` field.

Runtime-owned data lives under `<working folder>/.avi-bots/<bot id>/`: `MEMORY.md`, `work-items.json`, and `activity.json`. Approvals are protected fields embedded in their work items. A user's explicit request or recurring bot instruction already authorizes that outcome and its ordinary local completion steps; bots request approval only for a materially new, unapproved sensitive action and never ask for the same decision twice. Deleting a bot does not delete this folder. The settings UI also provides **Full reset**, which keeps the bot's complete configuration and removes only its operational state: conversation history, work threads, tasks, Goals, memory, activity, work items, approvals, and bot-owned files. Custom project files and MCP settings are preserved.

Bots execute bounded exploration, research, data gathering, audits, status checks, and short diagnostics directly. They reserve `chat_create_thread` for genuinely long or context-heavy deliverables such as feature implementation, substantial migrations, full articles, extensive validation, or independent long workstreams. Worker threads are associated with the bot's main conversation and appear under `workThreads` in `bots_list`.

## Creation sequence

1. Call `bots_list` and avoid duplicate responsibilities.
2. Confirm the recurring purpose, working folder, configured model, and schedule.
3. Call `bots_create`.
4. Call `bots_list` to verify persisted configuration and resolved folders.
5. Call `bots_activate` only when an immediate first activation is wanted.

Use `/create-bot` for this guided sequence.
