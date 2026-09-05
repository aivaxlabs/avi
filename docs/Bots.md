# Bots

Bots are autonomous AI teammates. Each bot lives in a persistent thread, is activated periodically by Avi, and works proactively: it finds work, organizes it, executes bounded work directly, and follows outcomes across activations. Worker threads are reserved for genuinely long or context-heavy deliverables, not routine exploration, research, listings, status checks, or short diagnostics.

## Creating a bot

Use the **+** button in the sidebar's **Bots** section. Avi creates the bot with a random identity icon and opens its settings. Every bot needs a configured model before creation.

Use the moon button beside **+** to snooze scheduled bot activations for 1 hour, 6 hours, 24 hours, or until Avi restarts. Repeated timed Snoozes add to the active deadline instead of replacing it. While Snooze is active, the menu shows the remaining time and a **Reset** action that removes it. Snooze does not stop bots that are already working, change the Work queue order, or block **Activate now**. Timed Snoozes keep their deadline if Avi restarts; **Snooze until restart** ends when Avi restarts.

Agents in normal threads and Quick Chat can also manage bots with `bots_list`, `bots_create`, `bots_update`, `bots_delete`, and `bots_activate`. Select `/create-bot` in the composer for a guided setup that checks existing bots, defines the purpose and schedule, creates the bot, verifies its configuration, and optionally starts its first activation. Autonomous bot conversations do not receive these management tools and cannot create or control other bots.

`bots_activate` is an explicit one-time call: it ignores automatic enabled, period, idle, activation-window, and activation-limit rules, while refusing to start a duplicate run when the bot is already active. The sidebar's **Activate now** action keeps the normal enabled-state behavior. Both paths can activate a bot with an empty Work queue; that activation reviews the bot's full scope without a specific recurring focus.

## Bot settings

Settings are organized by the decisions they control:

**Profile — who the bot is**

- **Name** shown in the sidebar and used as the thread title.
- **Icon** — the same avatar style used by sub-agents. **New icon** rolls a random replacement.
- **Personality** overriding the global personality for this bot.

**Work — what it does and where**

- **Instructions** — free-form guidance injected into every activation describing responsibilities, priorities, and boundaries.
- **Work queue** — an optional ordered list of recurring tasks configured by the user. Each successful activation receives the next task as its primary focus, then advances to the following task and wraps to the beginning after the last one. Editing or reordering the list restarts the cycle from the first task; selecting a specific task under **Activate now** moves the cycle to that task before activation. With an empty queue, scheduled, sidebar, tool, and plugin activations still run and review the bot's full instructions, Inbox, memory, and available scope without a specific recurring focus.
- **Working folder** — where the bot lives. Leave empty to use a dedicated folder in `~/.aivax/bots/<bot id>`. The bot shares the general instructions, context discovery, and workspace MCP servers of this folder, plus global context and MCP servers. It also receives root and nested `BOTS.md` instructions discovered there and in `$HOME/.agents`; those bot-only instructions are never exposed to normal threads.

**MCP servers — external tools**

- **Workspace servers** are inherited from global settings and `<working folder>/.agents/mcpconfig.json`. They remain managed by the application or workspace settings.
- **Bot servers** are exclusive to one bot and stored in `<working folder>/.agents/bots/<bot id>/mcpconfig.json`. They load on every activation after inherited servers, so a bot server with the same normalized name overrides the inherited server only for that bot.

**Model — the AI resources it uses**

- **Model** and **Reasoning** used by every activation.
- **Context size** — optionally overrides the model context window for compaction and the context ring. Most bots should use the model default.

**Schedule — when it runs and pauses**

- **Enable bot** — controls whether the bot may be activated. Disabled bots remain available in the sidebar but do not run automatically or through **Activate now**.
- **Frequency** — the interval between activations, set in minutes, hours, or days.
- **Pause behavior**:
  - **Always on schedule** — runs at every interval while allowed.
  - **Pause when idle** — can sleep for four periods when there is no relevant work, too much waits for review, or too much waits for your approval.
- **Pause after repeated activations** — after N activations the bot pauses for four activation periods, then resumes automatically. This limit can be disabled. Any message you send ends the pause early and resets the counter.
- **Schedule window** — optionally restricts activation by days and time range. Overnight ranges (e.g. 22:00–06:00) are supported.

**Data — storage and conversation maintenance**

- Shows the isolated `<working folder>/.avi-bots/<bot id>/` folder where the bot's memory, Inbox, and Activity live.
- **Clear conversation** — removes main-thread messages without touching memory, Inbox conversations, Activity, or pending approvals.
- **Full reset** — keeps the bot and all of its configuration, including its identity, instructions, model, schedule, working folder, and MCP settings. It permanently removes the bot's conversation history, work threads, tasks, Goals, memory, Activity, Inbox, pending approvals, and bot-owned files. For a custom working folder, only the isolated `.avi-bots/<bot id>/` data folder is removed; other project files are never deleted. For Avi's dedicated default working folder, operational files are removed while MCP configuration is preserved.

## Inbox and Activity

Open **Bots** in the auxiliary panel and select a bot in the header. The compact search and filter controls adapt to the panel width. The panel has two tabs:

- **Inbox** — conversations where the bot asks for your input. Open a pendency to read its messages and reply there, with text, images, or files. Messages appear from newest at the top to oldest at the bottom, and every message shows its date and time. Filter the list by status to find open or completed conversations.
- **Activity** — the bot's first-person diary of important work. Each entry has a title, description, category, and date; category filtering narrows the timeline. Entries explain the subject and result without requiring previous entries or the main chat.

A pendency has only two states: `open` or `completed`. Open items awaiting your response contribute to the sidebar notification count. Reading a pendency does not clear it. Replying transfers attention to the bot and removes it from the count, unless a protected approval still needs an explicit decision. The bot can continue the conversation or mark it completed. A new bot message reopens a completed pendency; a final response should be followed by completion when no user action remains.

The bot continues all work in its main thread. When you reply, Avi saves your message and sends a `<bot-pendency-update>` with the pendency ID, reply, and attachments to that thread. An active bot receives it in its priority queue; an idle bot starts a continuation. It can use tools and worker threads to prepare a response, but is instructed to answer inside the same pendency. If delivery fails, the Inbox keeps your message and reports the failure; do not send it again just to retry delivery and duplicate the conversation.

Inbox and Activity load independently. If one file is invalid, only that tab shows a loading error; the other remains usable. Expand **Technical details** to inspect the cause. Invalid legacy files are preserved, not silently migrated or replaced.

Activity is deliberately quiet: no routine reads, tool calls, repeated waiting, or checks with no change. It records meaningful progress, discoveries, decisions, completed outcomes, and failures. Creating or replying to a pendency does not automatically produce a diary entry.

### Storage and bot tools

Each view has its own JSON file under `<working folder>/.avi-bots/<bot id>/`:

- `MEMORY.md` — durable knowledge and unfinished-work context across activations.
- `inbox.json` — pendencies, messages, attachments, and protected approvals.
- `diary.json` — self-contained Activity diary entries.

The bot manages JSON data only through its bot-only tools:

- `bot_pendencies_list` — reads existing pendencies and their message history.
- `bot_pendency_create` — opens a conversation with a title and a self-contained message asking for a concrete action.
- `bot_pendency_message` — sends another message to an existing pendency.
- `bot_pendency_complete` — closes a pendency when no action remains.
- `bot_activity_append` — writes one important diary entry.

Legacy `work-items.json` and `activity.json` are never read or imported. They remain untouched on disk; the new Activity starts in `diary.json`. An incompatible or corrupt JSON file is reported as a load error, not silently discarded. **Full reset** starts clean but permanently removes the bot's operational data, so preserve anything you still need before using it.

Avi creates a `.gitignore` inside the isolated bot folder so internal state is not committed accidentally. If `MEMORY.md` exists at the working-folder root when a bot folder is first created, Avi copies it without overwriting later isolated changes.

At each activation the bot reads its Inbox and reconciles replies with its instructions, memory, and recurring `<focus-task>`, when one exists. A successful recurring activation advances the Work queue. With an empty queue, Avi omits `<focus-task>` and the bot reviews its full scope. Each activation marks a checkpoint in the main conversation: earlier messages remain stored but are excluded from that activation's model context. Starting a new activation clears the previous compaction summary and token counter when advancing that boundary. Compaction within an activation still carries its condensed summary. The Inbox and memory keep the context needed to continue across these boundaries.

Bots do not get the memory tools; `MEMORY.md` is their memory. Bots perform bounded work directly with their available tools, including exploration, research, data gathering, read-only audits, status checks, and short diagnostics. They cannot ask you questions mid-run. For genuinely long work such as feature implementation, substantial migrations, full articles, or extensive validation, they have advanced delegation tools to create, steer, inspect, interrupt, and reconcile regular worker threads. Threads created by a bot are linked to its main conversation, appear under that bot's `workThreads` in `bots_list`, and get a robot icon in the sidebar.

The root bot acts as a central orchestrator and can supervise shared capacity across the entire app. It can inspect every semaphore and its full FIFO queue, including holders and waiters from unrelated threads. `bot_semaphore_release_thread` releases one holder and resumes that thread; `bot_semaphore_release_all` stops every holder and waiter on the named semaphore and removes it without resuming them. These administrative tools are available only to the root bot conversation, not to normal conversations or worker threads. Bots cannot acquire semaphore permits for themselves: `sleep_semaphore` is excluded from root bot activations.

## Approvals and the Bots panel

Bot permission handling is a special "approve for me" mode based on the authority already granted, not merely the category of work:

- The user's current request and the bot's recurring owner instructions authorize the stated outcome and its ordinary local completion steps. Editing, rewriting, implementing, building, testing, regenerating, and validating within that scope do not require another approval.
- The bot queues approval only for a materially new decision or action outside that authority with meaningful external, irreversible, financial, credential, privacy, production, or destructive impact, such as an unrequested publish, deploy, push, merge, external message, secret access, purchase, production mutation, or broad deletion.
- If the user explicitly requested the sensitive action itself, that is the approval. The bot must not ask the user to repeat the same decision.
- The bot may create a protected Inbox pendency with `queue_user_approval` for a genuinely new decision and continue independent work while it is pending.

Threads the bot creates or messages always run in **Full access**: unattended threads have no one to answer a permission prompt, so only the bot's own conversation uses the approval queue above.

Protected approvals appear inside Inbox conversations. Tool approvals show the exact tool name, workspace path, and formatted input before **Approve** or **Deny**. The decision is recorded as a user message and sent to the main thread; denial tells the bot not to retry the denied action. Replying with ordinary text does not grant permission, and completion is unavailable until that explicit decision is resolved.

## Bot chats

In a bot conversation there is no model picker (the bot's model is used), no permission selector, and no Plan/Goal/Ultra modes. Expand prompt, attachments, and the auxiliary panel remain available, including the **Bots** panel. Use the **Show in bots panel** chip above the composer to open that panel with the current bot selected.

If Avi closes or restarts while a bot is working, its current activation resumes from the interrupted response when Avi starts again. Clicking **Stop** explicitly cancels that activation, so it is not resumed after a restart.

## Sidebar

- The moon beside **+** opens the global Snooze menu for scheduled activations. The button remains highlighted while Snooze is active; open the menu to see the remaining time or reset it.
- The bot's context menu offers **Bot settings**, **Activate now**, **Snooze**, and **Delete bot...**. When the bot has a Work queue, **Activate now** opens a submenu: **Next work item** keeps the current round-robin position, while selecting a listed item makes it the next task and then activates the bot. Long task names are truncated in the menu. Per-bot Snooze uses the same 1h, 6h, 24h, until-restart, and Reset options as global Snooze, but blocks scheduled activations only for that bot. Manual activation remains available. Delete removes the conversation and pending approvals; memory, Inbox, and Activity files stay on disk.
- The sidebar indicator reflects the bot state: a spinner while working, a green dot while active and waiting for its next activation, or a gray moon while sleeping because of Snooze, smart idle, a repeated-activation pause, a manual pause, or the schedule window. Disabled bots use a gray dot and appear dimmed.
