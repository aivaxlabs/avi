# Bots

Bots are autonomous AI teammates. Each bot lives in a persistent thread, is activated periodically by Avi, and works proactively: it finds work, organizes it, executes bounded work directly, and follows outcomes across activations. Worker threads are reserved for genuinely long or context-heavy deliverables, not routine exploration, research, listings, status checks, or short diagnostics.

## Creating a bot

Use the **+** button in the sidebar's **Bots** section. Avi creates the bot with a random identity icon and opens its settings. Every bot needs a configured model before creation.

Agents in normal threads and Quick Chat can also manage bots with `bots_list`, `bots_create`, `bots_update`, `bots_delete`, and `bots_activate`. Select `/create-bot` in the composer for a guided setup that checks existing bots, defines the purpose and schedule, creates the bot, verifies its configuration, and optionally starts its first activation. Autonomous bot conversations do not receive these management tools and cannot create or control other bots.

`bots_activate` is an explicit one-time call: it ignores automatic enabled, period, idle, activation-window, and activation-limit rules, while refusing to start a duplicate run when the bot is already active. The sidebar's **Activate now** action keeps the normal enabled-state behavior.

## Bot settings

Settings are organized by the decisions they control:

**Profile — who the bot is**

- **Name** shown in the sidebar and used as the thread title.
- **Icon** — the same avatar style used by sub-agents. **New icon** rolls a random replacement.
- **Personality** overriding the global personality for this bot.

**Work — what it does and where**

- **Instructions** — free-form guidance injected into every activation describing responsibilities, priorities, and boundaries.
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

- Shows the isolated `<working folder>/.avi-bots/<bot id>/` folder where the bot's memory and work state live.
- **Clear conversation** — removes conversation messages without touching memory, work items, activity, or pending approvals.
- **Full reset** — keeps the bot and all of its configuration, including its identity, instructions, model, schedule, working folder, and MCP settings. It permanently removes the bot's conversation history, work threads, tasks, Goals, memory, activity, work items, pending approvals, and bot-owned files. For a custom working folder, only the isolated `.avi-bots/<bot id>/` data folder is removed; other project files are never deleted. For Avi's dedicated default working folder, operational files are removed while MCP configuration is preserved.

## Work state

Each bot keeps its durable state in `<working folder>/.avi-bots/<bot id>/`:

- `MEMORY.md` — durable knowledge across activations.
- `work-items.json` — the current, user-visible work inventory.
- `activity.json` — an append-only timeline of material events.

A work item records its objective, current summary, latest material progress, next step, priority, linked worker thread IDs, evidence, blocker, and any user attention it needs. Evidence entries are typed as `file_reference` for project-relative file links, `external_reference` for HTTP(S) links, or `text` for arbitrary non-link text. Its state is `planned`, `active`, `waiting`, `completed`, or `cancelled`. Attention is separate from execution state and can request an `approval`, `review`, or `answer`. A waiting item must identify either the attention needed or a concrete blocker and who it is waiting on. When work is completed, its summary becomes a concise final report explaining what the bot did, why, and how; Avi clears the next step.

The bot never edits these JSON files directly. It uses bot-only tools:

- `bot_work_create` — creates a durable item with a clear title and objective.
- `bot_work_update` — keeps status, progress, next step, blockers, attention, workers, and evidence accurate.
- `bot_activity_append` — records only material discoveries, decisions, delegations, blockers, failures, approvals, and outcomes.
- `bot_work_read` — reads all durable work and activity at activation start and whenever reconciliation is needed.

Routine reads and tool calls do not belong in the timeline. A delegated thread is referenced by its real thread ID; Avi reconciles that reference with runtime state and shows whether the worker is running, idle, missing, or needs attention. Workers created by the bot but not attached to a work item are shown as untracked.

Approvals are runtime-owned fields embedded in their work item. While an approval is pending, regular work updates cannot replace it or change the protected state, attention, or blocker fields. Approval returns the item to active work; denial leaves a visible waiting item so the bot can choose a safe alternative or cancel it.

Avi always creates a `.gitignore` inside the isolated bot folder so internal state is not committed accidentally. If `MEMORY.md` exists at the working-folder root when a bot folder is first created, Avi copies it without overwriting later isolated changes. The work-state files are not imported from any previous report format.

At the beginning of every activation, the bot reads the work state, reconciles linked workers, and advances actionable items. It keeps the report oriented to outcomes instead of execution mechanics so the user can understand current work, recent results, next steps, and required decisions without reading the chat history.

Bots do not get the memory tools; `MEMORY.md` is their memory. Bots perform bounded work directly with their available tools, including exploration, research, data gathering, read-only audits, status checks, and short diagnostics. They cannot ask you questions mid-run. For genuinely long work such as feature implementation, substantial migrations, full articles, or extensive validation, they can coordinate regular threads with `chat_create_thread`, `chat_list_threads`, `chat_send_prompt`, `chat_interrupt_thread`, and `chat_inspect_thread`. Threads created by a bot are linked to its main conversation, appear under that bot's `workThreads` in `bots_list`, and get a robot icon in the sidebar.

## Approvals and the Bots panel

Bot permission handling is a special "approve for me" mode based on the authority already granted, not merely the category of work:

- The user's current request and the bot's recurring owner instructions authorize the stated outcome and its ordinary local completion steps. Editing, rewriting, implementing, building, testing, regenerating, and validating within that scope do not require another approval.
- The bot queues approval only for a materially new decision or action outside that authority with meaningful external, irreversible, financial, credential, privacy, production, or destructive impact, such as an unrequested publish, deploy, push, merge, external message, secret access, purchase, production mutation, or broad deletion.
- If the user explicitly requested the sensitive action itself, that is the approval. The bot must not ask the user to repeat the same decision.
- The bot may attach a genuinely new work approval to an existing item with `queue_user_approval` and continue other independent work while it is pending.

Threads the bot creates or messages always run in **Full access**: unattended threads have no one to answer a permission prompt, so only the bot's own conversation uses the approval queue above.

Open **Bots** from the auxiliary panel. The default **Overview** shows current work, items needing your attention, recently completed items, work up next, and recent activity. **Recently completed** keeps each result concise: its title and a plain-language account of what the bot did, why, and how. **Up next** collects the next actions from planned and active work instead of repeating them inside every card. **All work** provides the complete state-filterable inventory, while **Activity** shows the material timeline.

Tool approvals show the exact tool name, workspace path, and formatted input before **Approve** or **Deny**. Approve sends the resume prompt back to the bot; deny keeps the outcome visible and tells the bot to choose a safe alternative or cancel the item.

## Bot chats

In a bot conversation there is no model picker (the bot's model is used), no permission selector, and no Plan/Goal/Ultra modes. Expand prompt, attachments, and the auxiliary panel remain available, including the **Bots** panel. Use the **Show in bots panel** chip above the composer to open that panel with the current bot selected.

If Avi closes or restarts while a bot is working, its current activation resumes from the interrupted response when Avi starts again. Clicking **Stop** explicitly cancels that activation, so it is not resumed after a restart.

## Sidebar

- The bot's context menu offers **Bot settings**, **Activate now**, and **Delete bot...** (removes the conversation and pending approvals; memory and work-state files stay on disk).
- The sidebar indicator reflects the bot state: a spinner while working, a green dot while active and waiting for its next activation, or a gray moon while sleeping because of smart idle, a repeated-activation pause, a manual pause, or the schedule window. Disabled bots use a gray dot and appear dimmed.
