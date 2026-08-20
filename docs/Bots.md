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
- **Working folder** — where the bot lives. Leave empty to use a dedicated folder in `~/.aivax/bots/<bot id>`. The bot shares the MCP servers, general instructions, and context discovery of this folder, plus global context. It also receives root and nested `BOTS.md` instructions discovered there and in `$HOME/.agents`; those bot-only instructions are never exposed to normal threads.

**Model — the AI resources it uses**

- **Model** and **Reasoning** used by every activation.
- **Context size** — optionally overrides the model context window for compaction and the context ring. Most bots should use the model default.

**Schedule — when it runs and pauses**

- **Frequency** — the interval between activations, set in minutes, hours, or days.
- **Pause behavior**:
  - **Always on schedule** — runs at every interval while allowed.
  - **Pause when idle** — can sleep for four periods when there is no relevant work (empty backlog, too much waiting in `user-review.md`, or too much waiting for your approval).
- **Stop after repeated activations** — after N activations the bot sleeps until you talk to it again. This limit can be disabled. Any message you send resets the counter and wakes the bot.
- **Schedule window** — optionally restricts activation by days and time range. Overnight ranges (e.g. 22:00–06:00) are supported.

**Data — storage and conversation maintenance**

- Shows the managed work data folder.
- **Clear conversation** — removes conversation messages without touching memory or work files.

## Work data

Each bot keeps its data in `.avi-bots/<bot id>` inside the working folder (initialized with a `.gitignore` so nothing is committed by accident):

- `MEMORY.md` — durable memory across activations.
- `backlog.md`, `ongoing.md`, `blocked.md`, `user-review.md`, `discarded.md`, `done.md` — task organization. The bot keeps them current so every activation starts from reality.
- `waiting-user-approval.json` — the runtime-owned approval queue.

At the beginning of every activation, the bot reads these files and handles everything you have specified, preferring work already recorded in `ongoing.md`. When nothing is specified, the bot decides itself what needs to be done — continuing ongoing work, starting backlog items, reviewing delegated output, and checking your review queue. It records each item's current step, works through as many items as are meaningful, and keeps statuses updated as it goes.

Bots do not get the memory tools; `MEMORY.md` is their memory. Bots have no sub-agents and cannot ask you questions mid-run; they orchestrate regular threads with `chat_create_thread`, `chat_list_threads`, `chat_send_prompt`, `chat_interrupt_thread`, and `chat_inspect_thread`. Threads created by agents get a robot icon in the sidebar.

## Approvals and the Bot queue

Bot permission handling is a special "approve for me" mode:

- Tool calls the bot marks as not needing a human run immediately.
- Actions the bot marks as needing a human — implementations, behavior changes, destructive actions — are queued instead of pausing for a response. It records the item as awaiting approval and continues with the remaining work; the queued item resumes once you approve it.
- The bot can also queue work proposals with `queue_user_approval`, including a short context of why it needs you.

Review pending items in the **Bot queue** tab of the auxiliary panel:

- **Approve** — sends the approved prompt back to the bot so it proceeds (usually delegating to a worker thread).
- **Deny** — tells the bot you declined; it asks you for the reason or discards the task.

## Bot chats

In a bot conversation there is no model picker (the bot's model is used), no permission selector, and no Plan/Goal/Ultra modes. Expand prompt, attachments, and the auxiliary panel remain available, including the **Bot queue** tab.

If Avi closes or restarts while a bot is working, its current activation resumes from the interrupted response when Avi starts again. Clicking **Stop** explicitly cancels that activation, so it is not resumed after a restart.

## Sidebar

- The bot's context menu offers **Bot settings**, **Activate now**, and **Delete bot...** (removes the conversation and pending approvals; work files stay on disk).
- The status dot reflects the bot state: working, active, idle (smart sleep), or sleeping (activation limit reached).
