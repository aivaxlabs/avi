# Bots in Avi

Use bots for persistent, proactive responsibilities that should survive across activations. Use a regular thread or `chat_spawn_subagent` for one-off work.

## Agent tools

Normal threads and Quick Chat can manage bots with:

- `bots_list`: lists every bot, its main thread, directly associated work threads, full configuration, folders, and runtime state.
- `bots_create`: creates a persistent bot and main conversation.
- `bots_update`: changes selected configuration fields without replacing the full configuration.
- `bots_delete`: removes the bot, its main conversation, and pending approvals. Persistent files and work threads remain available. This is destructive and requires approval outside Full access.
- `bots_activate`: starts an immediate activation while ignoring automatic enabled, period, idle, window, and activation-limit rules. An empty Work queue reviews the bot's full scope without a recurring focus task. It never starts a duplicate run for a bot that is already running.

These tools are intentionally unavailable inside autonomous bot conversations. A bot may coordinate its worker threads, but it must not create or control other bots.

## Configuration

`bots_create` requires `name` and a configured `model`. Other fields are optional:

- `workingFolder`: absolute project folder. If omitted, Avi creates a dedicated folder under `~/.aivax/bots/`.
- `instructions`: recurring responsibilities, priorities, boundaries, and completion signals.
- `workQueue`: ordered recurring tasks distributed round-robin across successful activations. The current item is supplied as the activation's focus. An empty list activates without a recurring focus task.
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

Runtime-owned data lives under `<working folder>/.avi-bots/<bot id>/`: `MEMORY.md`, `inbox.json`, and `diary.json`. The Inbox stores open/completed pendencies with dated bot/user messages and attachments. The Activity file stores a first-person diary of important results, with a title, description, category, and date. Neither file is a general task board or a log of routine calls; old bot work state is not migrated.

The bot uses `bot_pendencies_list`, `bot_pendency_create`, `bot_pendency_message`, and `bot_pendency_complete` for Inbox conversations, and `bot_activity_append` for material diary entries. A user's Inbox reply arrives in the main thread as `<bot-pendency-update>` with its pendency ID and attachments. The bot may investigate or delegate there, but answers in the same pendency. Open pendencies awaiting the user count toward the sidebar badge; replied or completed pendencies do not, unless an explicit protected approval still awaits a decision.

Approvals are protected fields inside pendencies. A user's request or recurring bot instruction already authorizes that outcome and its ordinary local completion steps; bots ask only for a materially new, unapproved sensitive action. Normal replies and completion cannot substitute for Approve/Deny. Deleting a bot does not delete its data folder. **Full reset** keeps configuration but removes conversation history, work threads, tasks, Goals, memory, Inbox, Activity, approvals, and bot-owned files. Custom project files and MCP settings are preserved.

Bots execute bounded exploration, research, data gathering, audits, status checks, and short diagnostics directly. They reserve `chat_create_thread` for genuinely long or context-heavy deliverables such as feature implementation, substantial migrations, full articles, extensive validation, or independent long workstreams. Worker threads are associated with the bot's main conversation and appear under `workThreads` in `bots_list`.

## Creation sequence

1. Call `bots_list` and avoid duplicate responsibilities.
2. Confirm the recurring purpose, working folder, configured model, and schedule.
3. Call `bots_create`.
4. Call `bots_list` to verify persisted configuration and resolved folders.
5. Call `bots_activate` only when an immediate first activation is wanted.

Use `/create-bot` for this guided sequence.
