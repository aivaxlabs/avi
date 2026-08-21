# Bots

Bots are autonomous AI teammates. Each bot lives in a persistent thread, is activated periodically by Avi, and works proactively: it finds work, organizes it, delegates it to worker threads, and follows up on results. Execution stays user-coordinated — bots never implement or test anything themselves.

## Creating a bot

Use the **+** button in the sidebar's **Bots** section. Avi creates the bot with a random identity icon and opens its settings. Every bot needs a configured model before creation.

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

- **Frequency** — the interval between activations, set in minutes, hours, or days.
- **Pause behavior**:
  - **Always on schedule** — runs at every interval while allowed.
  - **Pause when idle** — can sleep for four periods when there is no relevant work, too much waits for review, or too much waits for your approval.
- **Stop after repeated activations** — after N activations the bot sleeps until you talk to it again. This limit can be disabled. Any message you send resets the counter and wakes the bot.
- **Schedule window** — optionally restricts activation by days and time range. Overnight ranges (e.g. 22:00–06:00) are supported.

**Data — storage and conversation maintenance**

- Shows where the bot's memory and daily logs live: directly in its working folder.
- **Clear conversation** — removes conversation messages without touching memory or daily logs.

## Daily logs

Each bot keeps its persistent state directly in its working folder:

- `MEMORY.md` — durable memory across activations.
- `backlog.json` — relevant work not yet started.
- `ongoing.json` — work in progress.
- `blocked.json` — work waiting on something.
- `waiting-user-approval.json` — runtime-owned approval requests.
- `user-review.json` — finished work waiting for your review.
- `done.json` — completed work and its outcome.
- `discarded.json` — intentionally abandoned work and its reason.

Every log file contains a JSON array. Regular entries use `id`, `title`, `content`, `status`, `date`, `createdAt`, and `updatedAt`. Approval entries use the same base fields and may include runtime data needed to resume an approved action.

The bot never edits these JSON files directly. It manages them with three bot-only tools:

- `bot_daily_write_log` — records relevant work with a title, content, and status; Avi infers the date.
- `bot_daily_update_log` — edits, moves, or removes an entry by id.
- `bot_daily_read` — reads entries, optionally filtered by status and/or `YYYY-MM-DD` date.

The approval file is protected: `queue_user_approval` and tool approval handling create its entries, and the runtime removes them after you decide. The daily update tool cannot move, edit, or remove these entries.

In the default dedicated folder (`~/.aivax/bots/<bot id>`), Avi adds a `.gitignore` so nothing is committed by accident. In a folder you configure, these files are part of your project — add them to your own `.gitignore` if you do not want to commit them.

At the beginning of every activation, the bot reads the logs and handles everything you have specified, preferring ongoing work. When nothing is specified, it decides what needs attention — continuing ongoing work, starting backlog items, reviewing delegated output, and checking your review queue. It writes only relevant changes so later activations start from an accurate state instead of a stream of trivial activity.

Bots do not get the memory tools; `MEMORY.md` is their memory. Bots have no sub-agents and cannot ask you questions mid-run; they orchestrate regular threads with `chat_create_thread`, `chat_list_threads`, `chat_send_prompt`, `chat_interrupt_thread`, and `chat_inspect_thread`. Threads created by agents get a robot icon in the sidebar.

## Approvals and the Bots panel

Bot permission handling is a special "approve for me" mode:

- Tool calls the bot marks as not needing a human run immediately.
- Actions the bot marks as needing a human — implementations, behavior changes, destructive actions — are queued instead of pausing for a response. The queued item resumes once you approve it.
- The bot can also queue work proposals with `queue_user_approval`, including a short context of why it needs you.

Threads the bot creates or messages always run in **Full access**: unattended threads have no one to answer a permission prompt, so only the bot's own conversation uses the approval queue above.

Open **Bots** from the auxiliary panel. Select a bot, then switch between the seven stage tabs. Each tab shows its entry count. **Waiting approval** also provides:

- **Approve** — sends the approved prompt back to the bot so it proceeds, usually by delegating to a worker thread.
- **Deny** — tells the bot you declined; it asks you for the reason or discards the related work.

## Bot chats

In a bot conversation there is no model picker (the bot's model is used), no permission selector, and no Plan/Goal/Ultra modes. Expand prompt, attachments, and the auxiliary panel remain available, including the **Bots** panel. Use the **Show in bots panel** chip above the composer to open that panel with the current bot selected.

If Avi closes or restarts while a bot is working, its current activation resumes from the interrupted response when Avi starts again. Clicking **Stop** explicitly cancels that activation, so it is not resumed after a restart.

## Sidebar

- The bot's context menu offers **Bot settings**, **Activate now**, and **Delete bot...** (removes the conversation and pending approvals; memory and daily log files stay on disk).
- The status dot reflects the bot state: working, active, idle (smart sleep), or sleeping (activation limit reached).
