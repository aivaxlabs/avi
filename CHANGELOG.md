# Avi Changelog

## [Canary]

### Added
- **Archive all** — the actions menu (... or right-click) of every Sidebar group header (date, model, or folder) has Archive all, which archives the chats listed in that group after a confirmation. `conversations:archive` accepts an array of IDs.
- **AIVAX Enhancements** — Settings → AIVAX Features → Enhancements adds **Fast Compress** (context compression through the AIVAX summarize endpoint), **Fast Name** (thread titles from the AIVAX summarization model), and **Smart Approve for Me** (in Approve for me, the `@perplexity/pplx-decider-flash` decision model checks tool calls the agent marked as not needing approval). All are off by default and fall back to the usual behavior on failure.
- **Scheduled jobs** — a new Activity Bar page below Folders lists one-off tasks and recurring jobs. Each stores its folder (default `$HOME`), model, reasoning effort, instruction, and permission (Approve for me or Full access); recurring jobs add a cron schedule edited through presets or an Advanced cron field with a preview of the next runs, and an optional inclusive end date (`endsAt`) after which no occurrence is scheduled. A 10-second job starts due tasks in new agent-created threads with a `<scheduled-task>` envelope, and a 1-minute job turns due recurring occurrences into tasks, skipping an occurrence while the previous one is still active. Tasks record the final output or error and stats (duration, input/output/total tokens, tool calls). Agents get `task_scheduler_schedule_task`, `task_scheduler_cancel_task`, `task_scheduler_list_tasks`, `task_scheduler_view_task`, `task_scheduler_create_recurring_job`, `task_scheduler_delete_recurring_job` (requires approval), `task_scheduler_list_recurring_jobs`, and `task_scheduler_view_recurring_job`, also exposed through Remote MCP and `/commands`. RPC adds `task-scheduler:*` global methods, and plugins get `avi.scheduler` with `scheduler.read` and `scheduler.manage`. Bundled context adds `/create-task` and the agent-customization `task-scheduler.md` reference, which tells agents not to drive bots with recurring jobs.
- **Background Processes built-in plugin** — enable it in Settings → Plugins to run executables while Avi is open. Its Activity Bar page lists processes (executable, optional arguments and working directory, retry after 2 s, 5 s or never, enabled state) and adds, edits, removes, starts, stops, restarts, enables, and disables them. Saving starts the process. The newest 10 KiB of stdout and stderr per process is kept in memory and shown in a logs dialog. On Windows each executable is a direct child in Avi's kill-on-close job, so it ends whenever Avi exits, crashes, or is killed; on macOS and Linux a supervisor tied to Avi terminates the process group.
- **Semantic Grep** — Settings → AIVAX Features → Semantic Grep indexes chosen directories into a dedicated AIVAX collection and adds `file_search` for the current chat directory. It is the first semantic search, not a replacement for `rg`. The session has a collection, an `rrf` reranker by default, a directory list, recommendations from frequent chat folders (Git worktree roots when the folder is a worktree), and indexing status with embedding cost. Indexing runs on startup, on changes, and every 15 minutes in `sync` mode.
- **Quick Chat window** — the window now runs a temporary thread with the same chat, composer, tools, compaction, retry, and permission mode as a normal conversation, plus the Quick Chat prompt. It can be maximized. The composer directory picker and the Quick Chat-only `set_directory` tool change the directory; the next step loads that directory's instructions, skills, workflows, and MCP servers. Right-click a folder in the Sidebar and choose **Quick chat** to open the window there. After the first message, **Fork in thread** converts the conversation into an ordinary thread and opens it in the main window. Closing an unforked window permanently deletes it.
- **Goal progress** — the Goal strip shows the tokens transacted so far before the elapsed time, and a gauge button asks a tool-free Quick question about progress: estimated percentage, time to completion, current work, done, remaining, and difficulties. The question receives the thread history through its latest message plus active time, tokens, tasks, and sub-agents. `quick-question:open` accepts `source: "goal"`.
- **Read-only permission mode** — the composer (main window, side chats, and Quick Chat), **Bot settings → Tool permissions**, and **Settings → Default permission mode** offer **Read-only**. The agent is instructed to only read, search, and query, and to mark any state-changing call with `__requires_human_approval: true`; the runtime fails those calls, plus forced-approval and interceptor-flagged calls, instead of asking. Threads created or messaged from a Read-only conversation or bot stay in Read-only. `PermissionMode` and bot `permissionMode` accept `read_only` in the Core, RPC, and MCP surfaces.

### Changed
- **Agent-created threads in the Sidebar** — an agent-created thread that is not running and has a pending tool approval, a pending question, a blocked state, or a last run that ended in error or was interrupted now appears in the Sidebar even while **Show agent-created threads** is off. Healthy agent-created threads stay hidden.
- **Goal tokens** — `Goal.tokensTransacted` in conversation snapshots is computed live while the Goal is active or paused instead of staying `null` until it ends.
- **Question notifications** — with **Settings → General → Desktop → Notify when a conversation finishes or asks a question** enabled, Avi shows a system notification whenever an agent asks a question in the chat (`ask_question`). The notification uses the thread title and the first question.
- **Semantic Grep search** — `file_search` returns one line per file, `score  relative/path:start-end`, and no longer includes content excerpts. Indexing stores `source_line_start` and `source_line_end` on each chunk. Documents indexed before that list the path only until the next sync.
- **Semantic Grep indexing** — symbolic links and directory junctions inside an indexed tree are followed. Changing the directory list or collection while an index is running aborts that run and starts another.
- **Semantic Grep search** — `file_search` filters by `metadata.real_path startswith` the current chat directory, so a parent folder finds indexed children such as worktrees. It no longer refuses the search when that folder is not itself an indexed root.
- **AIVAX sync** — thread search and Semantic Grep now stream documents through the v2 WebSocket import (`/api/v2/collections/<id>/documents/index-jsonl`) instead of the v1 JSONL upload. `insert-mode=sync` still removes documents that are not in the current corpus. The WebSocket completion counts replace the old per-request credit header in the thread-search trace.
- **AIVAX Features page** — sessions are tabs (Account, Memory, Web, Media, Search, Semantic Grep), and the loading indicator is a centered spinner.
- **Headless Quick Chat** — `quick_chat_invoke` remains a discarded `$HOME` turn with reduced instructions and full access. It does not follow the window's directory, `set_directory`, or approval flow.
- **Smaller installer** — renderer-only packages (Monaco, Mermaid, KaTeX, DOMPurify, diff, boring-avatars, remark-directive, mdast-util-to-string) are now dev dependencies, so `app.asar` only carries their Vite bundles in `dist`. Removed from the package: Chromium locales other than `en-US` (`electronLanguages`), and `node-gyp`, `@types`, `.d.ts` and source maps inside built-in plugin `node_modules`.
- **Computer Use overlay runs in Avi** — the overlay, Escape shortcut, screenshots and image resizing now use the host Electron instead of a separate overlay process. Removed: the plugin's own Electron 42 copy (about 358 MB), `overlayProcess.cjs` and the `sharp` image dependency; the plugin's dependencies drop from about 437 MB to 47 MB.

### Fixed
- **MCP startup stuck on "Starting N MCP servers"** — each MCP server now has 30 seconds to connect, finish the handshake, and list its tools. A server that exceeds the limit is marked Failed with the phase where it stopped, instead of staying in Starting and blocking messages. The startup banner also no longer reverts to a stale MCP state loaded while the window opened.

### Docs
- AIVAX Features documents the Enhancements tab; Archive and the conversations RPC reference describe Archive all and array payloads.
- Added Scheduled jobs, the task scheduler RPC and Core API references, and scheduled-job sections in Avi commands, Remote MCP, UI basics, and Bots.
- UI basics, Side and quick chats, and the chat RPC reference describe the Goal token counter and progress question.
- Advanced settings describes question notifications.
- MCP servers documents the 30-second connection limit.
- The Core API overview and Plugins document how plugins use Electron main-process modules and release them on deactivation.
- Updated Side and quick chats, Context management, Advanced settings, Personalities, Fusion, the Remote API, and the chat RPC reference for the temporary Quick Chat window.

### Tests
- `test:archive` covers the Enhancements settings defaults and validation; `test:aivax` covers the summarize helper request and empty-summary error.
- `test-thread-input-approval` covers Read-only blocking a write without an approval card while a read runs; `test:bots` and the bot settings UI test cover persisting and selecting `read_only`; `test:mcp` covers the Read-only approval contract.
- `test:package` checks that renderer-only packages stay out of `dependencies`, the kept Electron locales, and the built-in plugin exclusions; `test-prepare-built-in-plugins` checks that Computer Use no longer installs Electron.
- `test:task-scheduler` covers cron parsing, the eight tools, defaults, permission escalation, dispatch, output and stats capture, recurring materialization and overlap skipping, end dates, deletion, and restart recovery. `test:remote` lists the new MCP tools and RPC methods.
- `test:quick-question` covers the Goal progress question: live Goal tokens, tool-free session, in-progress history without unanswered tool calls, and the progress context.
- `test-background-processes.mjs` (in `test:built-ins`) covers validation, persistence, 10 KiB log trimming, restart, enable/disable, retries, deactivation, and process-tree cleanup when the host dies.
- `test:mcp` covers a stdio server that never answers the handshake and is marked Failed by the connection limit.
- Context injection covers a directory-backed Quick Chat window, and an Electron test covers `set_directory`, promotion to a thread, and startup deletion of leftover Quick Chats.

## [0.10.0] — 2026-10-22

### Added
- **X Subscription provider** — sign in with a SuperGrok or X Premium subscription through xAI OAuth device authorization and use Grok 4.7, 4.6, 4.5, 4.3, and Grok Build 0.1 through the xAI Responses API. Credentials are encrypted locally and refreshed automatically. The provider reports subscription usage (included usage with reset date, on-demand credits, included credits, and prepaid balance) in the usage indicator and `/usage`.
- **Reasoning reuse** — OpenAI-compatible providers have a new **Reasoning reuse** setting, separate from the reasoning effort format: **Forward as metadata** (default), **Forward as `<think>` block**, or **Do not forward reasoning**. In metadata mode, Chat completions now preserves streamed `reasoning_details`, including signed and encrypted entries, and replays them on later requests from the same model.
- **Fusion model routers** — a new **Fusion** routing mode pairs a lead model with a sidekick model, each with its own reasoning effort chosen with the Models page pickers. The conversation runs on the lead, which receives the new `dispatch_sidekick` tool instead of `chat_spawn_subagent` and `chat_create_thread` and delegates by verifiable milestones, inspecting each one before sending the next to the same sidekick thread; sidekicks run the sidekick model, cannot ask the user or create threads, escalate permissions to the lead, and report concisely. With Ultra, the lead uses smaller milestones with stricter inspection, without delegating to an Ultra team. Bots cannot use Fusion routers. Catalog entries expose `routerMode: "fusion"`.
- **Thread and bot mentions** — any thread or bot can write `::mention{bot-id="..."}` or `::mention{thread-id="..."}` in a response or a bot Inbox message to deliver it to that bot or thread inside a `<cross-message mention="true">` envelope ("The bot ... mentioned you in this message:"). Mentions render like file reference links showing the bot or thread title and open the target in the chat and Inbox, and received mentions appear as a highlighted **Mentioned you** card.
- **Thread statistics** — the Context usage dialog now has **Context** and **Stats** tabs. Stats shows p50/p95/p99 time to first token, time to connection, and tokens per second; cumulative input, cached, output, and total tokens with cached and reasoning shares; request and request-error counts; and tool calls with invocation and other errors. Assistant `usage` records per-request `requests` metrics and errored tool-call segments record `errorKind`. Desktop bridge: `window.chatApp.chat.statistics({ conversationId })` (`chat:statistics`, also available over RPC).
- **Inbox questionnaires** — bots can attach a questionnaire (`questions`, same format as `ask_question`) to `bot_pendency_create` and `bot_pendency_message`. The Inbox shows it below the message with the chat question form. Submitting it saves a user reply with `questionMessageId` and `answers` and delivers `<answers>` inside `<bot-pendency-update>`. A questionnaire is answered once and has no timeout. Desktop bridge and RPC: `bots:reply-pendency` accepts `questionMessageId` and `answers`.
- **Bot priority queue** — each bot now has a persisted, system-generated priority queue next to its Work queue, holding Inbox replies, approval decisions, mentions, prompts from other threads, and explicit activations. Bot settings list it under **Priority queue**, where items can be reordered or removed (not added), and the new **Continue with priority items** option (on by default) starts the next item as soon as a run finishes. Messages from the same work log or thread merge into one item. Desktop bridge and RPC: `bots:remove-priority-item` and `bots:reorder-priority-queue`; bot snapshots expose `priorityQueue`, `priorityAutoContinue`, `lastActivationKind`, and `lastActivationAt`.
- **Command endpoint** — Remote Control serves `/commands/:tool` locally, invoking the Remote MCP tools as plain HTTP calls: `GET` takes arguments from the query string and `POST` from a JSON body, for example `curl -H "Authorization: Bearer <key>" http://127.0.0.1:18992/commands/bots_activate -d '{"id":"<bot-id>"}'`. It uses the Remote API keys and returns the tool result as JSON.
- **`quick_chat_invoke`** — new Remote MCP tool and command that runs one Quick chat turn with the Quick chat tools and returns its answer, tool calls, attachments, and usage. The session is discarded when the turn ends; `ask_question` is unavailable in it.
- **Quick Chat instructions** — **Settings → Tuning → Quick Chat** has a new **Quick Chat instructions** field (up to 20,000 characters) added after the built-in prompt of every Quick Chat and `quick_chat_invoke` call. Quick Chat does not load `AGENTS.md` files, so this is where its standing rules go. Saved as the `quickChatInstructions` tuning setting.

### Changed
- **Quick Chat delegation** — Quick Chat no longer forbids steering, interrupting, or queueing work on other threads on its own initiative. It can create and direct threads when the request or the Quick Chat instructions call for it.
- **Add provider page** — provider types are grouped into **Subscriptions** (managed sign-in) and **API** (endpoint and API key) sections.
- **Reasoning effort format** — the provider setting was renamed from **Reasoning format**, and **Default** now follows the interface: `reasoning_effort` for Chat completions and `reasoning.effort` for Responses (it previously sent `reasoning_effort` on Responses). Responses no longer prefixes earlier reasoning as `<think>` text by default; choose **Forward as `<think>` block** to keep that behavior.
- **Delegation instructions by role** — the default sub-agent delegation guidance moved from the base instructions to runtime injection for the main role. Ultra, Fusion lead, Ultra + Fusion lead, and Fusion sidekick receive their own contracts; sub-agents, side chats, and Quick Chat receive none.
- **Bot activation scheduling** — activations alternate between the Work queue and the priority queue. Manual pause, smart idle, and the activation limit now stop only the Work queue; waiting priority items still activate the bot on its period. Priority activations receive a `<priority-item>` instead of `<focus-task>` and do not advance the Work queue or the activation count.
- **Replies to completed pendencies** — the Inbox reply composer and selection actions stay available after a pendency is completed, so you can keep sending replies after answering the bot. A user reply reopens the pendency and joins any waiting priority item of the same work log, so all pending replies from one pendency reach the bot in a single activation. Replies from other bots still cannot reopen completed pendencies.
- **Queued bot deliveries** — Inbox replies, approval decisions, bot mentions, and `chat_send_prompt` messages to a bot's main thread no longer interrupt or start the bot directly; they enter its priority queue. `bots:reply-pendency` and `bots:resolve-approval` return `queued` and `queueItemId` instead of `delivered`; `bots_send_work_log_message` follows the same result. Replies to a work log waiting for approval are saved without being queued.
- **Explicit activations** — **Activate now**, `bots_activate`, RPC, and plugin activations of a working bot become the next item and start right after the current run; `bots:activate` returns `{ queued: true, reason: "working" }` and `bots_activate` reports `queued_next`. An explicit activation that fails to start is discarded.
- **Windows updates** — the updater now starts the NSIS installer directly with `/S --force-run --updated`, letting the installer close and reopen Avi instead of a PowerShell helper waiting for shutdown. The downloaded installer is no longer deleted after installation.
- `ask_question` choice limits raised: `single_choice` accepts up to 10 options (was 3) and `multiple_choice` up to 30 (was 6).
- Chat, Quick Chat, and the Inbox now share one question form (`QuestionForm`) and one validation module (`src/shared/questions.js`). Quick Chat questions now use the same paged card as the main chat.
- **Inbox conversation layout** — opening a conversation from the Inbox page now gives it all the window width except a 500px Inbox list, replacing the shared draggable width. The conversation, its reply box, and feedback are centered in a column of at most 950px.
- **Bot Inbox writing** — bot instructions and the `content`/`message` descriptions of `bot_pendency_create`, `bot_pendency_message`, and `bots_send_work_log_message` ask bots to write Inbox messages like a short work email: a lead sentence, short paragraphs, lists for parallel items, and the requested action at the end.

### Fixed
- **Next work item** — **Activate now → Next work item**, and unfocused `bots_activate` / plugin `activate()`, run the next waiting priority item instead of skipping it for the Work queue after a priority activation. A listed Work queue task still runs that task. With no priority item waiting, the next Work queue task runs.
- **Bot activations stuck on an Inbox work log** — an open work log whose latest message was not from the bot replaced the Work queue focus on every activation, repeating the same work and freezing the queue cursor. Work logs no longer set the activation focus.

### Docs
- Added `docs/Fusion.md` and referenced Fusion in model routers, Sub-agents, Default models, Bots, the bots RPC reference, and `ModelSnapshot`.
- Documented Inbox questionnaires and the new option limits in Bots, RPC, and Core API references.
- Documented the bot priority queue, its scheduling rules, and the queued delivery results in Bots, RPC, Core, and MCP references.
- Documented the `/commands/:tool` endpoint in Remote Control, the API overview, and the Remote MCP reference.
- Added `docs/api.md`, a reference of every Avi command with arguments, result shapes, statuses, and errors.

### Tests
- Added Fusion coverage to the model router, context injection, sub-agent tool, and bot management tests.
- Added `scripts/test-thread-statistics.mjs` for percentile, token, request, and tool-error aggregation.
- Added questionnaire and option-limit cases to `scripts/test-bot-work-state.mjs`; updated `scripts/test-question-activity.mjs` for the shared question form.
- Added `scripts/test-bot-priority-queue.mjs` for queue ordering, merging, auto-continuation, pause and idle bypass, explicit activations, and concurrent claims; updated bot admission, management-tool, and Core API tests for queued deliveries.
- Added `/commands/:tool` authentication, method, argument-parsing, and error cases to `scripts/test-remote-mcp.mjs`.
- Added `quick_chat_invoke` cases to `scripts/test-remote-mcp.mjs` and one-shot `QuickChatRunner.invoke` cases to `scripts/test-quick-chat.mjs`.

## [0.9.0] — 2026-10-16

### Added
- **Tabs visualization** — assistant messages can group Markdown into tabs with an `avi-tabs` container holding one `avi-tab` container per tab. Each tab renders full Markdown, including other visualizations and nested tabs. The panel matches the tallest tab by default; `height="<px>"` fixes it and scrolls each tab internally. Tabs support arrow, Home, and End keys. Markdown APIs are unchanged.
- **Chat search filters and recent chats** — **Search chats** (Control+K) has a refreshed layout. Before typing it lists the most recent chats with folder, age, and status (Working, Awaiting approval, Blocked, Completed, and others). Filter by folder, last update, and Archive (Do not include by default, or Include; opening an archived result restores it), sort by best match or most recently updated, and see matching terms highlighted. Results are resolved by thread ID, so deleted threads never appear and dates reflect the thread's last update. `conversations:search` now also accepts `{ query, folderPath, updatedAfter, includeArchived, sort }`, an empty query lists recent threads, and results include `archivedAt`.
- **AIVAX media generation** — Settings → AIVAX Features has a **Media generation** section with a model dropdown and toggle for images and for audio. Enabling them adds `generate_image` (prompt, 1–4 images, up to four reference images as local paths or HTTP(S) URLs; fails when the selected model does not support references) and `generate_audio` (text-to-speech in MP3, WAV, or OGG). Results are saved under `<workspace>/.aivax/generated-images` and `generated-audio`; images appear in the chat. The renderer reads the catalogs through `aivax:media-models`.
- **Message markers** — from the second sent message, ticks float on the left edge of the chat, one per message you sent. Hovering highlights the tick and previews the message; clicking jumps to it, loading older history if needed. With more than 15 messages, the first 5 and last 10 are shown.
- **Plugin action pages** — plugins can add full pages to the Activity Bar, shown after a separator below Folders with a Lucide or SVG icon. HTML pages render plugin HTML/CSS/JS in a sandboxed iframe with theme variables and a `window.avi.invoke()` bridge; native pages reuse the auxiliary panel components. Desktop bridge: `window.chatApp.actionPages.list/load/invokeAction/onEvent` (`action-pages:*`).
- **New themes** — GitHub (Light/Dark Default), Catppuccin (Latte/Mocha), Solarized (Light/Dark), Nord, Tokyo Night (Light/Night), and Darcula (IntelliJ Light/Darcula), each built from its official palette for both color schemes. Their ids are reserved for plugin themes.
- **Context page tabs, search, sorting, and creation** — Context shows Instructions, Skills, and Workflows as tabs with a search field and a sort menu (Default, Token size, Created at desc/asc, A-Z, Z-A). A **+** button beside **...** creates a templated instruction, skill, or workflow in the scope's `.agents` folder. Desktop bridge: `window.chatApp.context.create/read/write`; `context:folder` results include `readOnly`, and items include `createdAt`.
- **Private context visibility** — the context editor's Properties tab has a **Visibility** dropdown (**Default** or **Private**). Private moves an instruction, skill, or workflow to `.agents/.user-private` with the same base path (`AGENTS.<Name>.md`, `skills/<name>/SKILL.md`, `workflows/<name>.md`), creating the folder with a `.gitignore` that ignores everything in it. Private items are discovered like default ones. Desktop bridge: `window.chatApp.context.setVisibility({ path, visibility })` (`context:set-visibility`); context items include `visibility`.
- **Context editor** — selecting a context item opens a modal with a Markdown editor powered by Monaco, the editor used by VS Code (syntax-highlighted frontmatter, list continuation, Ctrl+B/Ctrl+I and right-click Markdown formatting, find, multi-cursor, Ctrl+S) and a Properties tab for supported frontmatter fields. Installation and plugin context opens read-only.
- **Per-bot tool permissions** — choose **Approve for me** (the default for new and existing bots) or **Full access** in Bot settings → Schedule. The persisted `permissionMode` is writable through Core/RPC and read-only through agent tools (MCP) and used for activations, restart resumptions, Inbox continuations, and bot-composer messages.

### Changed
- **Plugin API compatibility range.** Avi accepts plugins whose `apiVersion`/`minApiVersion` range overlaps the API versions it supports. Plugins built for a newer API load in compatibility mode, ignoring unknown fields, capabilities, and contribution types; Settings → Plugins lists what was ignored.
- **`/restart-mcp` is now `/reset-context`.** Besides restarting MCP servers, it rereads every loaded `mcpconfig.json` (manual edits were previously ignored until restart), clears the instruction, skill, and workflow discovery caches, and refreshes the composer's `/` and `$` commands. Removed the desktop bridge `window.chatApp.mcp.restartAll` (`mcp:restart-all`); use `window.chatApp.context.reset(folderPath)` (`context:reset`).
- Context activation and invocation badges now use colored dot indicators with tooltips.
- **Unified controls outside the chat.** Settings, dialogs, and panels now share one set of buttons, split buttons, dropdowns, toggle switches, and fields, defined in `src/styles/controls.xcss`. One dark primary button marks the main action, dropdowns size to their value, every on/off option is a toggle, and fields show the theme accent while editing. The chat transcript and composer keep their own controls. Themes can retune every control through the new `--control-*` tokens.
- **Long configuration text opens in an editor.** Model rule and bot instructions, provider, model, and plugin custom JSON, provider JSON import, and MCP arguments, environment variables, and headers show a line count button that opens a Monaco editor with **Apply** and **Ctrl+S**. Quick compose fields, such as commit messages and annotations, remain inline.

### Fixed
- Code syntax colors now always follow the active theme. Prism's default token colors could override a theme's syntax palette depending on stylesheet order, while Appearance previews still showed the theme's colors.
- **Stop** now ends the run immediately while a tool is executing, even when the tool ignores the abort signal (for example, `chat_create_thread` with `wait_for_response`). The pending call is recorded as interrupted. Previously, Stop only took effect after the tool returned, which could take minutes.
- Agent bot-management tools reject writes to `permissionMode`, preventing bots from granting Full access to themselves or other bots. The field remains readable; permission changes stay in Bot settings and trusted application APIs.
- Threads whose last model belonged to a removed or disabled provider can send again. The composer restored that model from the last message even though it was no longer configured, so every send in the thread and in its forks failed while the model chip showed the fallback model. The composer and message editing now fall back to an available model.
- Importing a provider no longer turns the window blank when the review dialog closes.
- A failed send now shows its error and restores the draft text and attachments instead of failing silently.
- Installed plugins and their stored data are no longer deleted by Avi updates. They moved from the installation folder to `~/.aivax/plugins`; on the first start after updating, Avi moves existing plugins and `.avi-storage` there. The Windows installer also copies the old folder to `~/.aivax/plugins-migration` before removing the previous version. Plugins lost in an earlier update must be installed again.
- Removing a provider clears its auxiliary, supervision, Quick Chat, compactation, sub-agent, and Model slider assignments. Sub-agent levels turn off when one of their models is cleared, and the slider is cleared when fewer than three levels remain. Model rules are kept.

### Docs
- Documented the new plugin location, legacy migration, and API version compatibility in Plugins, Context management, and the Core and RPC API references.
- Documented how removing a provider clears default model assignments in Default models and Adding providers.
- Added `DESIGN.md`, the visual source of truth for control primitives and tokens, and linked it from the agent instructions. Documented unified controls in UI basics and the control tokens in Themes and Plugins.

## [0.8.0] — 2026-10-05

### Added
- **Quick questions** — select text in a chat, side chat, or bot Inbox work log, code in a Files preview or Git Review diff, or use the Files and Git Review tree context menus, then choose **Quick question** to ask about it in a small popover answered by the Quick chat model. The question receives the selection and its source context (folder, thread, bot work log, file text, folder listing, or Git diff); for chat text it also receives the source thread history through the selected message, quick-compressed in memory near the compaction threshold, and **Fork to thread** forks the source thread from that message. It supports follow-ups, and can use only read-only tools. **Fork to thread** continues the conversation as an ordinary thread; **Close** discards it. The main window uses `window.chatApp.quickQuestion` (`quick-question:open`, `ask`, `fork`, `close`, and `quick-question:event`).
- **Scan provider models** — the provider editor's **Add model** is now a split button that matches **Add provider**. For providers that support model listing, its dropdown includes **Scan models**, which reads the provider's `/v1/models` and opens a filterable dialog. Each listed model has an **Add model** action that opens a new model editor with the ID filled in. OpenAI Compatible (Responses and Chat completions) supports scanning. The renderer reads the list through `providers:available-models`.
- **Cross-bot Inbox access** — a global Settings → Bots option (off by default) gives bots `bots_list`, `bots_read_work_log`, and `bots_send_work_log_message`, so they can read every bot's Inbox and reply in other bots' pendencies. Bot replies are stored as role `agent` with a `sender`, shown with the sender's Orb and **Sent by another bot**, and delivered as `<bot-pendency-update from="bot" from-bot-id="..." from-bot-name="...">`; user replies now carry `from="user"`. `bots:settings` returns `crossBotInbox`.
- **OpenAI Subscription models** — added GPT-6.1 Sol in standard and 1M-context versions, including Fast variants for both context sizes.
- **Annotate selections** — the chat selection toolbar has **Annotate** next to **Mention on Chat**, which adds the selected text with a note to the composer, like Git Review annotations. The annotation box previews the selection, adds with **Ctrl+Enter**, opens with the dropdown animation (disabled under reduced motion), and stays inside the window; Git Review annotations share the new look.
- **Inbox selection actions** — selecting text in a bot Inbox work log offers **Mention on Chat** and **Annotate**, which add the selection, with an optional note, to the work log reply.
- **Generate commits + push** — Git Review's AI dropdown runs the same multi-commit workflow as **Generate commits** and then pushes the current branch to its configured remote, without force-pushing.
- **Detailed memory search and memory filter skill.** `memory_search` accepts `detailed: true` to return a JSON array with each result's `id`, `name`, `createdAt`, `updatedAt`, `score`, `metadata`, and `content`. The new bundled `memory-filters` skill documents the AIVAX filter syntax, date and metadata rules, limits, and examples for the metadata Avi records.
- **Memory metadata.** Every `memory_write` records `directory`, `model_name`, `task_title`, `thread_id`, `thread_role`, `parent_thread_id`, `device_name`, and `device_id` as document metadata, so memories can be filtered by folder, model, thread, or computer.
- **Custom JSON for providers and models.** OpenAI Compatible providers (Responses and Chat completions) and individual models have an optional **Custom JSON** object that is recursively merged into every request body: nested objects merge key by key, arrays and scalars replace, and model values override provider values. The Messages request format applies the same merge. Invalid JSON or non-object values are rejected when saving.
- **Resource limits** — Settings → Tuning has **Maximum parallel threads** (1–1024, defaults to four times the logical processor count). Model turns and context compactions beyond the limit wait in a global FIFO queue (short background calls such as titles are not counted); threads waiting for approvals, questions, `sleep`, sub-agents, or semaphores do not hold a slot. Queued threads emit `capacity-waiting` events with their position, `chat:state` and `plugins:complete-reload` return `capacityWaits`, and the MCP status overlay shows how many threads are waiting.
- **Stalled thread watchdog** — Settings → Tuning → Resource limits can stop the thread that is freezing Avi. Avi measures how late its event loop responds and how much blocking time each thread spends handling stream events and saving messages. After three stalls longer than the configured limit (0.5 s, 1 s by default, 3 s, or Disabled), the thread with the most blocking time is stopped with a `watchdog_stopped` error in the message and a `chat.watchdog-stopped` entry in `trace.log`. Other threads keep running.

### Changed
- Chats stopped manually no longer show the attention indicator, and viewing a failed chat — in the Desktop window or through `sidebar:mark-seen` — is now persisted, so the indicator stays cleared after restarting Avi until the chat changes again. `conversations:list` and remote clients such as Avi Workspace report the same `needsAttention` state.
- Explicit bot activations — **Activate now**, `bots_activate`, `bots:activate`, and plugin `activate()` — now start immediately for disabled bots and ignore individual and global activation hours, Snoozes, and FIFO capacity. These rules now gate only automatic scheduled activations, and a deferred automatic request no longer blocks explicit ones.
- Side chats no longer display the forked parent history; it remains available to the model, and `conversations:messages` pages for side chats start after the fork.
- Side chats run quick compaction automatically before a response when context is within 10 percentage points of the automatic compaction threshold.
- Sending or editing a message never changes the Goal state: it does not start, resume, restart, pause, or cancel the Goal. Plan mode no longer cancels an active Goal, and editing keeps its specification and revision; a new Goal is created only when the edit is sent in Goal mode and the conversation has none.
- Git Review works without an open conversation, using the selected project folder; Git Review IPC accepts `projectPath` when no `conversationId` is given. Without a project, the panel asks to choose a project folder. **Generate commits** and **Generate commits + push** run in a side chat when a conversation is open and in a new conversation otherwise.
- Built-in tool schemas no longer use `null` for optional values: `bots_create` and `bots_update` take an empty string for `personality`, `workingFolder`, and `reasoningEffort`, `0` for `contextSize`, and `inherit` for `executionMode`, and omit activation window bounds; `chat_list_threads` takes an empty `parentThreadId` for root threads; `invoke_rubber_duck` takes an empty `context`; `update_tasks` takes an empty `result`; and `ask_question` options are `{ label, description? }` objects only. `bots_update` rejects empty `changes`.
- Bot instructions now state that Inbox messages and Activity descriptions render rich Markdown Directives.
- The agent interviewed by a Rubber Duck now answers in its own inspectable interview thread (`rubber_duck_subject`, listed by `rubber-ducks:list`) as a normal chat, with its full instructions, skills, MCP servers, model rules, tools, and the subject history after any context checkpoint. Previously it answered from an isolated, tool-less model call with only the copied messages. Its context identifies the Rubber Duck interview and forbids any change; tool approvals follow the invoking conversation's permission mode. Questions from one Rubber Duck reuse the same thread and are answered one at a time.
- **Narrow window layout.** In windows 700 px wide or narrower, the Activity Bar and Sidebar move behind a menu button and open as an opaque drawer over the chat without pushing it; `Control+B` toggles the drawer. The auxiliary and Inbox panels cover the whole window. Sidebar and panel resizing, panel expansion, and sidebar transparency are disabled in this mode.
- `memory_write` takes a `title` instead of `name`. Avi sanitizes the title into the stored identifier (accents removed, lowercase, non-alphanumeric runs replaced by `-`, up to 120 characters), so the same title always updates the same memory. `memory_search` lists results as `name:` instead of `title:` because the value is that stored identifier.
- **Code theme follows VS Code 2026.** Light and dark palettes use the VS Code 2026 Light/Dark colors. The chat, auxiliary panel, and settings content sit on rounded surfaces inset in the window chrome. Menus highlight the hovered item with a blue border, and the composer, user messages, inline code, and code blocks follow VS Code's chat styling. Code blocks now follow the color scheme instead of always being dark.
- **Lighter chat persistence.** Inline base64 media in tool results is now stored once per thread under `~/.aivax/media/<thread ID>/<sha256>.<ext>` and referenced by path, instead of being re-serialized into the message on every write. When a thread is archived, manually or by the retention policy, its media moves to `$TEMP/.avi/archived-media/<thread ID>`; restoring moves it back, and deleting the thread removes it. Forks get their own copy (hard-linked when possible). Streaming checkpoints run at most once per second (or when a new segment appears) without re-reading the message, while tool boundaries and terminal states are still written immediately. Previously, a thread with many screenshots could rewrite tens of megabytes several times per second and stall the whole app. Existing messages are not migrated.
- The `memory_search` tool's `filter` argument description now lists the filter fields, how to combine conditions, practical examples, and common pitfalls, and links to the [AIVAX document filter documentation](https://docs.aivax.net/docs/filters/document-filters).
- The built-in instructions and the `rich-chat-visualization` skill now ask for callout labels of a few words (such as `Not tested` or `Assumption`), with the explanation in the following paragraph, instead of whole sentences inside the callout.
- Bot conversations now receive `bots_create`, `bots_update`, `bots_delete`, and `bots_activate`, so bots can create, configure, and activate other bots. `bots_delete` still always requires approval.

### Fixed
- Nested dropdown submenus — Model and Effort in the composer, and bot **Activate now** and **Snooze** — now open to the left, shift up, or scroll instead of extending beyond the window.
- Prepare the Computer Use `get-windows` native addon only on Windows, avoiding unnecessary native downloads/builds on macOS and Linux while preserving their existing backends and Windows source-build fallback.
- Preserve agent authorship in model history and retries using the persisted `fromAgent` flag; automatic sub-agent final/error reports now retain that flag and explicitly identify themselves as coordination, not user instructions.
- **Context compaction markers appear where the compaction happened.** Automatic compaction during a long response removed everything the response had shown before it, so several compactions piled up at the top of the response. The earlier text, reasoning, and tool calls now stay in the response, with each marker between the work before and after it. That earlier work is still excluded from the model context.
- **Computer Use clicks land where the agent aims on scaled displays.** At display scaling other than 100%, clicks, moves, drags, and scrolls landed elsewhere (at 150%, about two-thirds of the way to the target), and the cursor crosshair and window bounds were reported in a different unit than the screenshot. Screenshot coordinates now map to each monitor's physical pixels, so monitors with different scales also work. Window bounds in `computer_get_context` and session monitors now use the same logical units as monitor bounds.
- An Escape `key` action in Computer Use now reaches the focused application instead of being captured by the stop shortcut. The user's own Escape still ends the session.
- **Chrome Integration can interact with iframes.** Clicks, hover, drag, and scroll were synthetic DOM events on the top document, so content inside iframes (embedded courses, quizzes, editors) never received them, and pages that ignore untrusted events did not react. Actions now use real browser input through the debugger and reach same-origin and cross-origin frames. `browser.type` inserts text into the focused field even inside a frame. New helpers: `browser.press(key)`, `browser.doubleClick(x,y)`, `browser.rect(element)` (top-level viewport coordinates for elements inside frames), and `browser.frames()`. Snapshots list same-origin iframe content with top-level coordinates and mark cross-origin frames.
- Chrome Integration actions no longer time out in background tabs that Chrome froze. Any `await` on a timer (`browser.sleep`, `setTimeout`) never resumed in a frozen page, so clicks followed by a wait lost their result. The tab is now resumed before each action.
- Chrome Integration screenshots now use CSS pixels, matching action coordinates. On scaled displays they were device-pixel sized (for example, 2256 pixels wide for a 1504-pixel viewport).
- When Chrome refuses debugger access because of a restricted frame (for example, another extension's), Avi retries once and, if it still fails, reports Chrome's message and the blocking frame URLs instead of saying the tab is another extension's page. A frame that was only present for a moment no longer blames an extension. Reload the Avi Chrome extension (now 0.2.0, which adds the `webNavigation` permission) after updating.
- **Remote relay reconnects after every failure.** The AIVAX Remote bridge no longer stops permanently, which previously left Avi disconnected until Remote was toggled or Avi restarted. Relay closes `1008`, `1009`, and `4003`, ticket rejections (including HTTP 401/403, shown as unauthorized), unexpected tickets or subprotocols, and malformed relay frames now retry with a longer backoff.
- The relay publisher no longer causes the `1008` traffic closes it was meant to prevent. Outbound envelopes are queued and paced to 100 messages / 3 MiB per sliding second across all channels, instead of ending the session at a fixed-window budget that could exceed the relay's own window under network jitter.
- The relay connection is no longer dropped every 30 seconds when its send buffer is momentarily non-empty. Dead connections are detected by the 60-second pong deadline, and consumer channels are no longer terminated when their local buffer is busy.
- Waking the computer or unlocking the screen reconnects the relay immediately when it was waiting to retry, and replaces an open connection that does not answer a ping within 5 seconds.
- Relay connections, closes (with close code and duration), and retries are written to the diagnostic log as `remote.relay-connected`, `remote.relay-closed`, and `remote.relay-retry`.
- New-thread composer drafts now keep attachments, model, reasoning effort, permission mode, and Plan/Goal/Ultra selection when you switch threads or tabs, not only the text. Drafts are stored per working folder under the key `<folder>/00000000-0000-0000-0000-000000000000`, so each folder keeps its own draft before a thread exists. Attachments are kept as references, not copies; when a draft or thread composer is reopened, attachments whose local file no longer exists are removed. The renderer uses `window.chatApp.composerDraft` (`composer-draft:get` and `composer-draft:save`), also available on the global RPC socket. Side Chat and sub-agent composers no longer keep separate localStorage text drafts.
- Callouts and findings with labels longer than 240 characters now render instead of showing the raw `::callout[...]` directive text.
- `rpc:discover` now reports the installed Avi version as `appVersion` instead of a hard-coded `0.7.0`.
- The chat no longer goes blank when a sub-agent report, cross-thread message, or other agent message arrives while the assistant is working. Earlier work in the turn stays visible while the assistant responds and is collapsed into **Worked for** only after the final response completes.
- Automatic context compaction at the end of a run no longer fails with `availableTools is not defined` when the final response pushes context usage above the compaction threshold.

### Docs
- Document an isolated Electron smoke check and distinguish application startup failures from test-script assertions that exit with code 3.

### Tests
- `test:goal` covers Goal state preservation across Plan mode and message edits.
- `test:rubber-duck` covers the interview thread's tools, context, history, reuse, and Rubber Duck numbering.
- `test:quick-question` covers Quick question context expansion, the read-only tool set, follow-ups, and forking into an isolated database; `test:context` covers the Quick question prompt.
- Run child-thread database tests under Electron and align tuning snapshots, personality IDs, semaphore mocks, and on-demand thread discovery with current contracts. Update bot Inbox/command tests and the bot Core API fixture to the required ORPC handshake and binary transport; production behavior is unchanged.
- `test:aivax` covers detailed `memory_search` JSON, `memory_write` title normalization, and the recorded memory metadata.
- `test-computer-use-coordinates.mjs` (in `test:built-ins`) covers screenshot-to-input mapping at 100%, 150%, and mixed 150%/200% scaling.
- `test-composer-state.mjs` covers per-folder drafts and removal of missing attachments; `test:remote` lists the new global RPC methods and checks `appVersion` against `package.json`; its dispatched-operation list no longer expects the `conversations:list` calls removed with persisted attention.
- `test-rich-content.mjs` covers callouts with long labels.
- `test-media-externalization.mjs` covers media extraction to the per-thread media store, deduplication, hydration, forks, and moving media on archive, restore, and delete; `test-context-compaction-failure-limit.mjs` covers compaction at the end of a run; `test-thread-capacity.mjs` covers FIFO order, positions, cancellation, release, and raising the limit; `test-side-chat-database.mjs` covers the new tuning fields; `test-event-loop-watchdog.mjs` covers stopping the blocking thread while another keeps running.

### Chores
- `chat-runner.js` and `client-tools.js` are split into responsibility modules under `src/main/chat/` and `src/main/tools/`, with the same public exports and behavior.


## [0.7.0] — 2026-10-01

### Added
- **Media size limit** — Tuning → Tool execution caps images, videos, audio, and PDFs sent inline from chat attachments and `read_media_file` at 5 MB, 10 MB (default), 20 MB, 100 MB, or No limit, avoiding provider rejections such as "image exceeds 10 MB maximum". Each custom model can override the global value. Oversized attachments are sent as file paths; `read_media_file` falls back to AIVAX Media Descriptions, which keeps a fixed 20 MB limit, or reports an error.
- `chat_export_thread` writes a full thread to a temporary folder — `metadata.json`, a BEGIN/END-delimited `transcript.md`, a structured `transcript.json`, and an `attachments/` folder — capturing reasoning, content, tool calls with complete arguments and results, errors, and media without truncation. `chat_inspect_thread` remains the fast in-context peek; its description now points to the export tool when deeper detail is needed.
- `sleep` accepts optional `releaseTriggers` that end the wait early: `after_thread_stop:<thread_id>`, `after_thread_input_required:<thread_id>`, `after_subagents_stop`, `after_process_killed:<terminal_id|pid>`, `after_process_output:<terminal_id|pid>`, and `after_process_input_required:<terminal_id|pid>`. Results report which trigger released the sleep or `timeout`.
- Provider types can declare **harness capabilities** — stateful sessions, provider-side retries, and where Avi instructions are placed — while tool execution and compaction always stay with Avi. Settings shows the split for the selected provider, providers that retry on their own are not replayed in normal chats, and stateful sessions are released after Avi compacts a conversation.
- Trace + Requests now captures HTTP, transport, response parsing, incomplete tool-call and local application-operation failures, including errors after HTTP 200. The operational trace links to each redacted temporary diagnostic file; successful operations do not write captures.
- Git Review's AI dropdown generates a message from staged changes or forks a side chat to execute multi-commit in the selected repository without pushing.
- Git Review separates Unstaged and Staged changes roots, with independent collapse state and matching diff scopes; partially staged files appear in both and manual commits remain staged-only.
- Git Review now has a repository/sub-repository picker, virtualized changed-file tree with file status markers and no directory count badges, on-demand diffs with expandable context and a change map, stable annotations, contextual stage/unstage/discard/ignore/file actions, staged commits, AI commit plans, and commit + push. Repository-scoped caches avoid eager workspace diff loading.
- Auxiliary panels expand toward 80% of the window, temporarily compacting the sidebar without hiding chat; restoring preserves normal layout preferences.
- Context rows show subdued relative directories to the right of the title, without repeating the filename, plus activation badges and collapsible nested sub-skills. Context directory scans and bot Inbox reads use processor-count-bounded asynchronous concurrency; Inbox refreshes coalesce overlapping event notifications.
- Activity Bar badges count chats needing attention or review on Home and unread bot messages on Inbox, hiding zero and capping the visible number at 99+ while preserving full accessible counts.
- Activity Bar with Home, Inbox, Folders, and bottom-pinned Settings in a shared page composer. Folders pins Global and reuses scoped MCP, context, thread, and archive views; the current chat stays mounted when navigating. Transparent mode keeps the rail clear and tints the chat sidebar, with a shared composer shadow; opaque mode uses theme borders.
- **OpenAI Subscription models** — added GPT-6 Sol and GPT-6 Luna in standard and 1M-context versions, including Fast variants for both context sizes.
- **Bot activation settings and statistics** — optional global days/hours and FIFO admission complement individual schedules without blocking ongoing work or resumptions. Settings → Bots separates Activation settings from Statistics, with 1d/7d/30d descendant consumption, current states, and per-bot UTC consumption timelines. Global RPC exposes settings, saves, and statistics; individual execution modes inherit the global default when unset.
- **Models settings** — the former Default models page is now Models, with Auxiliar models, Sub-agents, Rules, and Model slider tabs. Default-model rules support concrete models and virtual routers, role-specific instructions, strict save validation, and unavailable-model warnings.
- **Bot message attention** — bot messages declare whether a user response is required. Informational messages clear their attention badge when viewed in the focused Inbox; required replies and protected approvals remain pending. Read receipts do not complete conversations or activate bots.
- **Inbox completion options** — a menu beside Complete offers Abandon, Duplicate, and Already worked, recording the selected reason in the conversation history. Completion controls are rounded and borderless.
- Empty chats show the latest open bot inbox messages and count, with lightweight message rows, labeled shortcuts, and compact empty sections.
- Built-in/Installed plugin tabs with disabled-by-default Chrome Integration and Computer Use, distinct icons on themed backgrounds, bundled tools and skills, persistent enablement, and a Chrome extension installation guide. Native desktop resources are prepared per target platform during packaging.
- Agent/MCP overview, bot work-log reading and messaging, thread creator/parent filters with type and child counts, and queue IDs for one-time bot activation focus.
- **Relayed MCP** — AIVAX Remote exposes `/mcp/<device-id>` with AIVAX bearer authentication and public `/mcp` discovery with per-tool `instanceKey` authentication. Remote control shows device/instance identifiers and MCP endpoints; API-key menus copy either credential format. New keys use 6 lowercase alphanumeric characters; persistent public instance IDs use 10. Existing keys and device IDs are preserved, and public calls are rate-limited per instance.
- **Keyboard shortcuts** — configurable in-app commands for model/reasoning selection, navigation, chat search, and zoom; global Quick Chat, plugin-provided bindings, conflict detection, persistent overrides, and global RPC `shortcuts:list` / `shortcuts:save`.
- **Find in chat** — navigate visible text occurrences and include older messages from the chat history.
- **ORPC Draft 1 remote transport** — RPC WebSockets now speak binary ORPC (`avi-orpc-draft1`): length-prefixed frames carrying UTF-8 JSON operation envelopes (`operationId`, `expiresAt` now + 180 s, `params`), dotted wire methods over the colon application names, acknowledged server events (`eventId` with an `OK` ack), no batching, and the full specification bundled at `docs/api/rpc/orpc-spec.md`.

### Changed
- **Question card redesign** — `ask_question` options accept `{ label, description }` objects besides plain strings; descriptions render as Markdown under the label in chats and Quick Chat and reach RPC clients as an index-aligned `optionDescriptions` array while `options` and answers stay label strings. `multiple_choice` is described to models as checkboxes and accepts up to six options. The card shows an answer-mode hint (**Select one**, **Select all that apply**, **Write your answer**) and hides pagination for single questions. Quick Chat now validates questions with the same rules as chats.
- The intelligence slider's highest level now shows a vivid orange-to-violet gradient with a periodic light sweep, a thumb halo with an entry flare, and two subtle twinkles, replacing the drifting dot shimmer. Reduced motion keeps the static gradient and halo.
- **Inline tool approvals** — the modal permission dialog is replaced by an approval card rendered at the end of the conversation, matching the inline question card. It shows the stated goal, tool, folder, and each argument in full, with **Allow**, **Always allow**, and **Deny** actions; `Escape` inside the card denies. Multiple pending approvals are shown one at a time with a remaining counter, and side chats and sub-agents resolve their approvals inside the auxiliary panel instead of a window-level dialog.
- Remote Control instance keys now have a reserved section, collapsed and masked by default, with explicit Show/Hide and confirmed rotation. Rotation invalidates the corresponding local API key and public MCP credential for new authentication; secret reveal and rotation are Desktop-only operations.
- Remote RPC attachment uploads in `chat:send`, `goals:start` and `composer-state:save` validate a 10 MiB decoded per-file limit independently of metadata. Native ORPC multipart requests support files larger than a single WebSocket frame; the 32 MiB operation limit is unchanged.
- **ORPC Draft 2 (breaking)** — remote RPC now requires `avi-orpc-draft2`, multipart requests/responses without execution IDs, reserved controls for cancellation, integrity, recovery, heartbeat and graceful shutdown, and SHA-256 `CHECKSEND` verification before dispatch or result delivery. Desktop and Workspace must be upgraded together. The physical `avi-relay-v1` transport and stable application `operationId` remain unchanged; RPC documentation and bundled specification now describe Draft 2.
- Removed desktop interceptor commands (including `/side`, `/quick-compress`, and `/optimize-prompt`) from the RPC command catalog sent to Avi Workspace. The desktop composer and context discovery now share their classification; ordinary workflows and skills remain available remotely.
- Bot avatars now use AIVAX Orbs keyed by bot ID in the sidebar, Inbox list and work-log message headers, and settings; removed the random icon control while retaining `iconSeed` API compatibility.
- The composer project picker now lists up to 30 recent projects instead of 8.
- **Overview Inbox** — opens conversations in a resizable side panel without leaving the Overview, sharing chat-panel styles and width controls but showing a close button instead of tabs.
- **Remote control** — AIVAX Remote now has a dedicated card, separate from local server settings and API keys, with its own toggle/status and a separate, always-visible How to connect guide. Local Remote Control is enabled by default with automatic Default key creation; saved disabled preferences and opt-in WAN publication are preserved.
- **Avi Relay** — the default relay endpoint is now `https://avi-relay.aivax.net`.
- **Shortcut batch editing** — one Save changes action in the standard settings footer, outside the scrolling list, persists all bindings atomically; live conflicts highlight every affected row and prevent saving until resolved. Global RPC `shortcuts:save` now also accepts a `changes` array.
- **Shortcut settings layout** — compact aligned rows, key-combination capture instead of free-text pattern editing, scope selection and accessible reset/disable actions; navigation now follows Personalization.
- **Remote RPC breaking migration** — JSON-RPC 2.0 is replaced by ORPC Draft 1: one operation per frame, at-least-once delivery deduplicated by a durable `remote_operations` journal (SQLite, 4096 entries / 64 MiB) keyed by identity, scope, resource, and `operationId`, one automatic retry with a fresh wire request id and identical body (60 s attempt / 150 s overall), delivery-only cancellation (handlers may still complete after a client timeout; reserved-but-unrecorded operations answer `OUTCOME_UNKNOWN` instead of re-executing), per-peer and global in-flight concurrency capped at 64, and `error.code` as number or string (`LIMIT`). The relay application handshake moves to v3 — `avi-remote-open`/`avi-remote-ready` v3 carry `protocol: "avi-orpc-draft1"`, heartbeat is `avi-remote-ping`/`avi-remote-pong` v3 — and bridged frames travel as opaque base64 binary over the unchanged `avi-relay-v1` transport. RPC docs, the public relay protocol, and the remote-control guide were rewritten accordingly.

### Fixed
- Desktop and remote clients now synchronize conversation Review acknowledgements in both directions; viewed threads, including runs that finish while the thread is open on Desktop, also stop reporting attention through RPC until their next run, and clients rejecting expired events no longer trigger a channel reconnect. The shared ORPC peer accepts an explicit timeout for `ping()` and `waitControl()`, and an abandoned control send no longer terminates a peer whose socket has already been replaced.
- Chat Completions requests with parallel tool calls that return media, such as several `read_media_file` calls, now send every tool result before the media messages, fixing Claude `tool_use ids were found without tool_result blocks immediately after` errors.
- Unknown tool calls now return a tool error instead of crashing error handling with an undefined `tool.name` and displaying a misleading streaming `provider_error`.
- Provider streaming failures after visible output now stop instead of automatically replaying partial text or tool calls.
- Provider connection status in Settings now reloads after saving provider fields such as the authentication mode and after a failed provider action, and a status request started earlier no longer replaces a sign-in in progress.
- Side Chats no longer restore the parent thread's Goal, Plan, or Ultra selection from copied user messages; their own subsequent messages still determine the restored composer mode.
- Goal follow-up messages now reuse the existing objective, including after blocking or completion, without invoking the auxiliary model or automatically rewriting the specification. Explicit Goal edits remain available. Goal instructions require executing unmet criteria with scoped standing authorization, avoiding redundant permission requests, and treating blockers as a last resort after investigating alternatives and completing independent work; runtime approvals and user interruptions remain authoritative.
- Git Review now shows the shared spinner and action-specific status during Git operations, refreshes, AI requests, and file loading instead of only disabling controls.
- Git Review context menus use action icons and shared separators to group Git, annotation, file, and repository operations.
- Git Review syntax tokens now use the shared light/dark Prism palette in the redesigned diff viewer.
- Git Review commit controls stay inside the navigation column at narrow panel widths instead of overlapping the diff.
- Compacted conversation checkpoints now enter subsequent model requests as user messages, including automatic continuation and retry, instead of system messages that some providers reject without a user or tool message.
- Inbox and the shared Tasks/Models overview load independently in parallel. Overview database reads and aggregation run in a background worker instead of blocking Electron's main process. Inbox renders 50 entries at a time with bounded previews and memoized sorting/filtering; Show more reveals further entries.
- Inbox badge counts unread bot messages represented by open Inbox entries, instead of accumulating unread historical messages or already-read attention requests.
- Inbox condenses spacing, message rows, and overview metrics according to its available pane width when an auxiliary panel opens.
- Settings navigation separators share one semantic component and a single border/spacing definition, including the dividers around AIVAX Features.
- Folder navigation constrains long names and vertical scrolling to its sidebar, with a name/path filter and Global kept visible.
- Cross-thread prompts now carry a persisted origin envelope with sender thread ID, role, and available name, explicitly distinguishing agent coordination from user instructions in live delivery and model history.
- Forced archive cleanup now waits for the refreshed archive state before returning, preventing the Maintenance page from crashing on missing settings, pagination, and statistics.
- Built-in plugin enablement now persists in the user SQLite database instead of the installation directory, preventing preference resets when the installation is replaced. Existing JSON preferences migrate once, preserving disabled choices; database write failures leave the displayed state unchanged.
- Reopening a thread restores model, reasoning effort, Plan/Goal, and Ultra from the latest user message, including confirmed edits, instead of stale composer selections. Unsent text and attachments are preserved, and cancelling an inline model edit no longer changes the thread model.
- Quick Chat and Side Chat instructions now allow explicitly requested actions, scripts, operations, and implementations. Side Chat prefers delegation to the parent by default rather than enforcing read-only behavior; concise answers no longer limit completion of requested work.
- ORPC ignores byte-identical parts duplicated after dispatch, acknowledges repeated integrity checks without redispatch, and lets `EXIT`/`BYE` finish when a new event is refused during shutdown.
- Tool-group summaries now list invoked tool names, rank the two most frequent names in larger groups, and consolidate calls from the same MCP server under its configured name.
- Worked-block duration labels now include days and hours instead of accumulating long runs entirely in minutes.
- Bot settings now hide inactive tab panels even when section layout styles are applied; consumption metrics and timelines share the Orchestration styles within Statistics, including narrow layouts.
- Bot activation settings use the shared styled switch and weekday selector in a full-width row; all seven days remain accessible without horizontal scrolling and wrap in narrow layouts.
- Sidebar bot notification badges now vertically center their count text instead of rendering it visibly offset inside the pill.
- Local file links and absolute file references open after confirmation; file references and Edited files share Open, Copy path, and Open in explorer context actions. Explorer reveals physical paths behind workspace symlinks, and sidebar terminals launch an interactive shell in a new console without fragile command quoting.
- Bot Inbox reply composer stays at the bottom of the panel while conversation history scrolls independently.
- Bot Inbox messages and Activity descriptions now reuse the chat rich Markdown renderer instead of displaying visualization directives as literal text.

### Docs

### Tests


### Chores
- Version bumped to 0.7.0.

## [0.6.0] — 2026-09-03

### Added
- **Remote JSON-RPC API** — exposes administrative Electron-equivalent handlers over a global WebSocket and complete bidirectional, sequenced, isolated conversation control and events over per-thread WebSockets.
- **Browser RPC clients** — authenticate without URL secrets by offering `avi-rpc-v1` and a base64url API-key subprotocol; RPC discovery now reports exact v1 methods, capabilities, Avi/Core/MCP versions, and the global model catalog with last-used/default model preferences and the authoritative Queue/Steer message delivery mode.
- **Bounded remote conversation data** — pages newest and older history with scoped cursors, exposes project-scoped mentions, commands, and file diffs, and reads owned attachments in capped base64 chunks.
- **Conversation context composer snapshot** — `conversations:context` returns the persisted composer state (with Desktop-equivalent defaults when none is saved) and a `contextUsage` estimate resolved from the selected model.
- **Multiple Remote Control API keys** — create labelled keys with optional expiration and copy or delete each credential independently.
- **Chat mentions** — type `@` to fuzzy-find project files and directories, enabled global/project MCP servers, or optional `@thread` and `@memory` context from the composer.
- **Sidebar transparency** — optionally use Tabbed Mica on Windows 11, Acrylic on Windows 10 where available, native Sidebar vibrancy on macOS, and theme-provided transparent surface tokens; Linux remains opaque.
- **Child Processes plugin** — starts supervised command lines with Avi, provides per-process start, stop, and restart controls, applies configuration changes on save, terminates process trees when Avi exits, retries failed runs according to configurable limits, and exposes a 1 MiB rotating stdout/stderr log per process.
- **Context usage details** — clicking the composer context indicator opens a segmented estimate for Avi and custom instructions, global context, Avi and MCP tools, messages, tool results, and unclassified provider/media overhead, with MCP entries grouped by server.
- **Quick context compaction** — remove tool results older than the latest four turns without an inference from Context usage or `/quick-compress`, alongside the existing `/compress` full checkpoint flow.
- **Per-bot Snooze** — each bot's context menu can pause only that bot's scheduled activations for 1h, 6h, 24h, or until Avi restarts.
- **Declarative plugin settings** — backward-compatible Plugin API v2 definitions can add Avi-rendered settings sections backed by JSON Schema and main-process read, validation, and write handlers.
- **Startup diagnostics** — `--inactive-bots` prevents automatic bot initialization, while `--memory-trace` records process CPU, memory, and I/O samples every 250 ms.
- **Sidebar status and tags over RPC** — `sidebar:status` returns the authoritative Working/Review grouping snapshot (running, approval, input, semaphore, and completed-unseen conversation IDs), `sidebar:mark-seen` acknowledges completed conversations with an explicit ephemeral per-instance state, and `tags:list`/`tags:save` expose the persisted tag catalog.
- **OpenAI-compatible hyperparameters** — Responses and Chat Completions providers can optionally send Temperature and Top K with each inference request.
- **Lazy tool-call details** — Desktop and conversation RPC clients now receive lightweight tool-call segments and hydrate arguments, results, and media on demand through the conversation-scoped `conversations:tool-call-details` method.
- **Trace + Requests log mode** — a new Diagnostics level that writes the raw HTTP request and response of failed provider API calls (status `>= 400` or transport errors) to `$TEMP/.avi/debug/request-logs/yyyy-MM-dd-model-randomid.log`, with credentials and file paths redacted.
- **Linked-folder workspaces** — create workspaces under `~/.aivax/workspaces` from the folder picker, edit links from the sidebar, and identify them by a different icon. Adds global RPC `workspaces:get` / `workspaces:save`; file search, mentions, and Git diffs now follow directory symlinks outside the selected folder.
- **Overview Inbox** — the renamed Orchestration page opens on Inbox by default and aggregates all bot conversations in a searchable, status-filtered email-style list with date groups, bot avatars, message previews, attention indicators, and direct navigation to the existing conversation controls.
- **RPC WAN bridge** — opt-in public relay for the JSON-RPC WebSockets through `https://avi-relay.projpw.workers.dev` with AIVAX-authenticated, role-bound ticket issuance, a stable per-install device id, automatic reconnection with fresh tickets, bridge status in Settings, and read-only global RPC `remote:state`. Only `/rpc` and `/rpc/conversations/streams/:thread-id` are relayed; handshake v2 opens carry only the target route, and the connected AIVAX account substitutes the Remote API key on the WAN — local keys stay local-only and MCP HTTP is never relayed. The bridge is off by default (`relayEnabled`), runs independently of the local server toggle and keys, requires a connected AIVAX account, and the public client protocol is documented for external clients. The bridge is locally verified across the real Workspace client, Desktop relay stack, and deployed Worker implementation with AIVAX mocked; live end-to-end verification against the deployed service is still pending.
- **Automatic update checks** — checks stable GitHub releases at startup and every six hours, marks Settings when an update is available, and adds a green General banner with platform-specific download, installation, and relaunch. Authenticated global RPC clients can inspect, check, and install updates.
- **Bot Inbox conversations** — bots send pendencies that users answer in place with text, images, and files; dated replies are forwarded to the bot's main thread with `<bot-pendency-update>` while work and delegation continue there.
- **Bot work-queue activation menu** — expands **Activate now** into a nested queue picker that can keep the current item or select which recurring task runs next, with long labels truncated.
- **GPT-6 Astra for OpenAI Subscription** — adds the managed standard and Fast variants with image input and reasoning efforts through Max.

### Changed
- Moved persistent update status and manual checks to About; General shows the compact update card only when a newer version is available.
- Base agent instructions now explicitly require `__invocation_goal` and `__requires_human_approval` in every tool call.
- Tool definitions can set `forcedTruncationLength` as an estimated-token output limit that overrides global truncation; `memory_search` now uses a 5,000-token limit.
- Project instructions can be centralized under `.agents/AGENTS.<subject>.md`, with direct children of `.agents` preserving root embedding and `embeddable: false` catalog behavior.
- Removed the Remote Control Endpoint settings section; stable MCP and RPC routes are now documented separately, and secret keys are no longer included in renderer state.
- Composer command, skill, and mention filtering now waits for 100 ms of input inactivity before updating results and caps every popup mode at 30 visible options.
- The sidebar now keeps New chat and Quick chat fixed above a unified scroll area while Settings remains fixed at the bottom.
- **Personalization Mode controls** now use the standard Color mode dropdown alongside native Sidebar transparency.
- Refined dropdown, dialog, auxiliary panel, chat message, and toast motion with consistent timing, easing, and reduced-motion behavior.
- Removed the built-in CLIProxyAPI provider plugin.
- `tags:save` now returns only the normalized `tags` catalog; the previous `conversations` array was removed from the response and the renderer refreshes threads through `conversations:list`.
- Standardized desktop typography around the 14px root size, using rem-based component sizes and readable secondary text instead of sub-12px labels.
- **Workspace editor layout** — compact folder rows, inline link names, visible storage path, and a right-aligned primary save action replace oversized tag-style cards. Long lists scroll inside a viewport-constrained body while the header and actions stay visible.
- **Overview task scope** — task lists now include only user-created threads, excluding agent-created work before loading task histories. Model usage totals still include all agents.
- **Bot Inbox message order** — shows the newest message at the top of each pendency conversation and the oldest at the bottom.
- **Simpler Bots panel** — replaces Overview, All work, and work-item detail dialogs with filterable **Inbox | Activity**. The sidebar counts open pendencies awaiting the user, while Activity is a first-person diary of important, self-contained results. Each view has its own JSON file (`inbox.json` and `diary.json`); legacy `work-items.json` and `activity.json` are no longer read and remain untouched.
- **Bot API contract** — replaces `bot_work_*`, Core `bot.workState.get()`, and RPC `bots:update-work-item` with pendency/message/completion operations and the new Inbox/Activity types. Protected approvals remain explicit and now reject missing or non-boolean decisions.
- Restored `<think>...</think>` reasoning-block parsing anywhere in assistant output instead of requiring the block at the absolute message start.
- Set the GPT-6 Astra managed input context to 272,000 tokens and added GPT-6 Astra (1M) with 872,000 input tokens, including Fast variants; output remains 128,000 tokens.
- Refined full-chat agent instructions for autonomous follow-through, transparent instruction conflicts, direct execution outside Ultra, proportionate validation, and concise writing. The mode-independent base prompt retains the main implementation with the agent while encouraging parallel sub-agents for independent exploration, research, analysis, and tests, with distinct assignments, no duplicated work, and active guidance. The Ultra-specific context retains the main and most demanding implementation with the orchestrator, using sub-agents for bounded, less demanding supporting tasks and independent critique.
- Bot activations now mark a checkpoint in the bot conversation, so each activation starts its model context from the previous boundary instead of replaying the full history.

### Fixed
- Desktop release builds now use native ARM64 runners on Windows and Linux and separate Intel and ARM64 macOS jobs, so native Computer Use dependencies can be packaged for each architecture.
- Chat find (Ctrl+F) now floats in a compact, centered panel above the composer, highlights matches without changing native text selection or input focus, and debounces matching by 50 ms.
- Dropdowns now size to their labels instead of shrinking to the minimum width inside narrow action anchors or nested menus.
- Missing local images and videos in conversation context now become an explicit unavailability notice instead of aborting OpenAI-compatible and OpenAI Subscription requests.
- Remote RPC history and message events now send attachment metadata instead of embedded content, preventing media-heavy conversations from exceeding the relay frame limit. Attachment bytes remain available through `attachments:read`.
- Kept inline `<think>...</think>` tags visible as response text, interpreting only a block at the absolute message start after optional whitespace as reasoning.
- Treated a generation that ends mid-reasoning or with an incomplete tool call as an error, surfacing a clear message instead of completing the turn silently.
- Kept Fast-model lightning icons inline in the advanced picker and flipped nested model or effort menus inward when they would overflow the viewport.
- Corrected the documented `conversations:fork` result to match the runtime `{ conversation }` envelope; copied history is loaded through `conversations:messages`.
- Restored the immediate assistant Thinking placeholder when sending a message into an empty or brand-new chat; the send result now carries the created streaming assistant message so it renders before the first token arrives.
- Completed tool calls no longer retain the animated running state after their details are moved to lazy hydration.
- Preserved valid function-call pairs during aggressive context compaction while removing orphaned calls and outputs that Responses providers reject.
- Command and mention selectors now open only at the start of a message or after whitespace, avoiding false positives in inline paths and similar text.
- Stopped an active chat after three consecutive automatic context compaction failures, resetting the guard after a successful compaction.
- Allowed multiple configured variants of the same provider model ID by assigning each variant a persistent internal identity while sending the configured Model ID unchanged to inference.
- Retried inference requests that fail with internet connection errors, including DNS failures (`ENOTFOUND`) and mid-stream connection resets, instead of surfacing them immediately.
- Made rich Markdown directives tolerant of common, unambiguous LLM syntax mistakes while preserving strict payload validation and literal code blocks.
- Clarified the exact `finding` syntax in the base agent instructions.
- Rendered valid `fileref` directives inside inline code while preserving literal references in code blocks.
- Rejected prematurely closed Responses API streams before partial tool calls can execute.
- Reduced startup I/O and memory pressure by storing and streaming local media as file references, querying only lightweight thread status and model-selection fields, failing interrupted bot tools instead of replaying uncertain side effects, deferring thread-search synchronization, sequencing automatic resumptions, and honoring bot context limits during compaction.
- Keep the workspace icon and **Edit workspace** menu available after live conversation updates by including workspace classification in conversation events.
- Question dialogs now restart their 60-second AFK timer on pointer, click, keyboard, input, or scroll activity inside the card, including Quick Chat; Plan mode remains timeout-free. Added the scoped `chat:question-activity` RPC operation.
- Cleared stale compaction summaries and token counters when bot activations advance their context boundary. Regular and Core API forks now finalize copied streaming messages as partial-response snapshots rather than leaving them permanently streaming.
- Fixed Core `ThreadHandle.fork()` returning a handle without the copied conversation ID.
- Preserved hidden context-checkpoint boundaries in regular copies, side chats, and Rubber Duck forks, preventing replay of already compacted history and unexpected context-overflow compaction. Forks ending before a checkpoint no longer inherit its summary or token counter.
- Aligned collapsed-sidebar navigation icons with the expand and Settings controls by removing the reserved scrollbar gutter in the icon rail.
- Context compaction now sends structured history without provider-specific reasoning/continuation metadata or the in-flight JSON transcript, preserving semantic content and tool pairs. Context-window retries cut the oldest 30% and 60% of in-flight tool rounds before the existing aggressive and chat-model fallbacks.
- Bot Inbox and Activity now use a responsive panel layout with readable filters, conversation rows, and empty states. File-loading failures are isolated by tab and expose technical details separately instead of presenting raw validation errors as the main message.
- Sidebar conversation tooltips now show only the folder name instead of its full path.
- Restored **Try again** after an explicit user Stop, matching other failed or abruptly interrupted inferences.
- Kept the interrupted user prompt when retrying after Stop, shutdown, or a crash during MCP initialization, instead of skipping it or replaying an older prompt.
- Made retry execution indicators follow live runtime snapshots and events, not persisted message status, so active tools and finalization keep **Try again** hidden without leaving completed runs stuck as running.
- Fixed recovery at the exact context-checkpoint boundary and reused canonical history serialization to preserve confirmed tool results, media, and compatible provider continuation. Invalid recovery targets and missing prompts now report an error instead of silently succeeding.

### Docs
- Organized the API reference into separate Core, MCP, and RPC sections with a shared entry point, corrected cross-navigation, and complete field-level request, response, shared-type, error, and notification references for every Remote JSON-RPC method.
- Added renderer design instructions for overlays, chat and inference, configuration forms, the visual system, and Avi's UI/UX philosophy.
- Refined the project design guide around existing components and surface ownership, with explicit dropdown/dialog/popover contracts, auxiliary-tab and settings integration, chat reuse, and documented implementation limitations. Settings guidance now defines user orientation, a consistent page/section/field hierarchy, shared save placement and lifecycle, and internal-tab behavior.
- Refreshed the README feature overview with autonomous bots, Rubber Duck reviews, model routers, rich chat content, declarative plugin settings, Teach Skill, and updated usage tracking.
- Improved the `/create-plugin` workflow description to highlight hooks, providers, themes, and advanced customizations.
- Documented `sidebar:status`, `sidebar:mark-seen`, `tags:list`, and `tags:save` with shared `SidebarStatus` and `Tag` types and the per-instance ephemerality of completed-unseen state.
- Documented projected tool-call segments and deferred detail retrieval across conversation RPC methods, shared types, and streaming notifications.
- Documented Inbox replies, attachments, notification counts, diary guidelines, delivery failures, and updated bot Core/RPC contracts; corrected the bundled bot reference for empty Work queue activation.
- Updated the OpenAI Subscription model catalog documentation for GPT-6 Astra.
- Documented **Try again** recovery after failed and abruptly interrupted inferences.
- Documented how full-chat agents handle clear action requests and instruction-caused blockers.

### Chores
- Consolidated desktop release builds into one flat `avi-release.zip` artifact with stable, versionless installer names for every platform and architecture.
- Version bumped to 0.6.0.

### Tests
- Added regression coverage for start-only `<think>` reasoning blocks, literal inline tags, and context-compression boundaries.
- Added regression coverage for forwarding configured OpenAI-compatible Temperature and Top K values while omitting empty values from both inference APIs.
- Added regression coverage for the mandatory tool-call metaparameter instruction in assembled context.
- Added regression coverage for stable sub-agent and side-chat operational summaries across text-only streaming chunks and status transitions.
- Added regression coverage for per-tool forced truncation, including `memory_search` and Plugin API descriptors.
- Added regression coverage for embedded and catalog-only project instructions centralized directly under `.agents`.
- Expanded Remote Control coverage for multiple and expired API keys, browser WebSocket subprotocol authentication, RPC discovery and model listing, bounded conversation history, project-scoped helpers, JSON-RPC batches and errors, thread-ID enforcement, and per-thread event filtering.
- Added focused coverage for Child Processes spawn, individual start/stop/restart controls, settings validation, retries, non-zero exits, rotating logs, reconfiguration, and shutdown cleanup.
- Added regression coverage for duplicate provider model IDs, persistent model instance identities, and forwarding configured model IDs to inference.
- Added regression coverage for generated-image and tool-media persistence, interrupted bot messages and tools, Goal resumption, and lightweight thread-search projection.
- Expanded Remote Control coverage for sidebar status, ephemeral completed-unseen tracking and acknowledgment, tags catalog methods, and per-socket method availability.
- Added focused coverage for lightweight tool-call projection, conversation ownership, deferred detail retrieval, RPC discovery and validation, and Desktop lazy hydration states.
- Added regression coverage for **Try again** after an explicit user Stop.
- Added isolated Electron recovery regressions for inference failures, interrupted MCP initialization, shutdown/startup recovery, prompt boundaries, and retry renderer state.
- Added Sidebar interaction and bot-management regressions for selecting the next Work queue item.
- Added managed-catalog and Responses request coverage for GPT-6 Astra and its Fast service tier.
- Added a bot activation checkpoint regression covering the boundary advance and model-context exclusion.

---

## [0.5.0] — 2026-08-26

### Added
- **Persistent bot work state** — bots track planned, ongoing, blocked, user-review, discarded, and completed work in their working folder instead of daily log files. The state includes typed evidence and an explicit next step for reliable handoffs between activations.
- **Bot management tools** — agents can create, update, organize, and review their own task lists, including blocked and inconclusive work statuses.
- **Bot control surface** — added an overview panel, a bot-mode composer, persistent ordered work queues, scheduler snoozing, full reset, clearer activation cleanup, and visible task state in the sidebar.
- **Bot attention notifications** — the sidebar surfaces pending bot notifications while retaining a distinct indicator for working, sleeping, active, or disabled bots.
- **Semaphore management** — semaphore permits can be cleared through the bot/runtime API; blocked semaphore state is visible and can record the concrete reason user intervention is required.
- **Plugin thread snapshot and semaphore APIs** — trusted plugins can inspect thread snapshots and coordinate work through Avi-managed semaphores.
- **Cliproxyapi provider plugin** for compatible model access.
- **AIVAX Teach Skill client tool and workflow** — turn an attached tutorial video into reusable Avi skill instructions.
- **Configurable response verbosity** — choose low, medium, or high verbosity for injected assistant instructions.

### Changed
- **Bot runtime and storage** now use durable work-state files and management operations rather than daily JSON logs; bot instructions and runtime context were updated to match.
- **Bot settings** now expose reset, scheduling, work-queue, activation, and working-folder management more clearly.
- **AIVAX account settings** have been redesigned, with related bot configuration and orchestration controls refined for a clearer configuration experience.
- **Task and semaphore lifecycle** now distinguish active, completed, blocked, and inconclusive work so agents can pause safely when human intervention is necessary.
- **Bot sidebar presentation** improves status/notification visibility and scrollbar behavior.

### Fixed
- **Incomplete response recovery** — **Try again** now depends only on the visible thread, remains available after errors or unexpected app closure even while child threads run, and stays hidden while that thread is actively running or after an explicit user Stop.
- **Long orchestration threads** — opening a parent no longer runs synchronous Git inspection or eagerly loads every child history; side chats, sub-agents, and Rubber Ducks load paginated messages only when opened and omit workspace and branch controls.
- **Background auxiliary threads** — text-only streaming updates from sub-agents and side chats no longer invalidate the main ChatView while operational status transitions remain live.
- **Large attachments** over 20 MB are referenced rather than embedded in chat payloads.
- **Provider connection timeout** now allows up to two minutes before aborting a stalled server connection.

### Docs
- Added bot work-state, task-management, scheduling, reset, and semaphore documentation across the bot guide, API reference, type definitions, events, and overview pages.
- Added the bot customization reference and the `/create-bot` workflow to the bundled agent context.
- Documented the Cliproxyapi provider plugin and provider API additions.
- Updated AIVAX features, advanced settings, context management, personalities, sub-agent, UI basics, thread, event, and API overview guidance.

### Chores
- Version bumped to 0.5.0.

### Tests
- Added focused coverage for bot work state, management tools, scheduler controls, enabled-state persistence, folders, reset, overview, composer behavior, activation interruption, and sidebar task/notification rendering.
- Added Cliproxyapi provider coverage and expanded plugin runtime v2 tests for thread snapshots and semaphores.
- Expanded MCP manager, semaphore, goal-mode, side-chat database, context-injection, AIVAX client, file-panel, and provider retry coverage.

---

## [0.4.0] — 2026-08-23

### Added
- **Bots** — create scheduled or manually activated bot conversations with dedicated queues, settings, tool approvals, daily JSON logs, isolated memory/data folders, enable/disable controls, and bot-scoped passive MCP servers.
- **Plugin API v2** — trusted plugins can integrate lifecycle hooks, domain APIs, storage, tools, events, interceptors, MCP servers, provider panels, and bot capabilities.
- **Provider usage tracking** — inspect AIVAX and OpenAI subscription usage from the composer with `/usage`, including reset periods and provider-contributed usage sources.
- **Rich chat visualizations** — assistant messages can render restricted bar, line, and pie charts, workspace file excerpts, and copyable text blocks through a documented built-in skill.
- **Configurable context compactation model** with automatic fallback to the conversation model.
- **Chat history windowing** — long conversations load older messages incrementally as the user scrolls.
- **Fatal error instrumentation** across main, preload, renderer, and process boundaries, with trace logging and troubleshooting guidance.
- **Thread completion notifications** for user-created background conversations.
- **Media extraction guidance** is forwarded through `read_media_file`.

### Changed
- **Bot runtime and scheduling** now use daily logs, clearer status handling, isolated context, and safer startup/resume behavior.
- **Provider streaming** preserves reasoning content and continuation state while improving retry behavior.
- **Renderer performance** improved through memoized chat/list components and bounded message rendering.
- **Workspace scanning** moved to the chat runner to avoid repeated context-injection work.
- **File previews** are limited to 2,000 lines.
- **Inspected thread tool calls** now use compact tokens that omit tool arguments and results.
- Refined empty-chat, message, MCP, auxiliary panel, file panel, project picker, and maintenance settings presentation.

### Fixed
- **Streaming scroll anchoring** remains stable when older messages are prepended or focus changes.
- **Stored provider credentials** are propagated when models are registered.
- **Bot settings** display the correct isolated data-folder path.

### Docs
- Added the complete Plugin API v2 reference for lifecycle, providers, panels, tools, storage, events, interceptors, threads, context, bots, errors, and shared types.
- Expanded bot, MCP, context management, default model, setup, sub-agent, provider usage, and troubleshooting guidance.

### Chores
- Version bumped to 0.4.0.

### Tests
- Expanded coverage for bots, plugin runtime v2, provider usage, context injection, retries, scrolling, message grouping, file previews, fatal errors, and rich chat content.

---

## [0.3.1] — 2026-08-19

### Added
- **Conversation tags and folder colors** — tag conversations and color-code folders, with persistence, IPC, preload exposure, and renderer picker.
- **Model routers** — configure fallback and round-robin routing across providers; surfaced in a new router settings panel with model availability indicators.
- **Search results show conversation age**.
- **Unanswered question timeout** — questions that go unanswered for too long are automatically timed out.
- **Markdown link favicons** — cached favicons are shown next to external links in rendered markdown.
- **Semaphores** — auto-release idle permits and expose global state.
- **Terminal shell reporting** — runtime reports the active shell and preserves command run start times.

### Changed
- **Streaming auto-scroll** — reworked around `ScrollFollow`, with a shared auto-scroll hook extracted across the chat components.
- **Muted reasoning and tool entries** are flattened for a cleaner timeline.
- **Composer action buttons** stack on a second row when the composer is narrow.
- **Folder discovery** no longer limits context to the installation scope.
- **Optimized prompts** translated to English.

### Fixed
- **Media** — `read_media_file` now returns the full description object; AIVAX media descriptions return the response envelope correctly.
- **Video input** — media input now supports video attachments with corrected description extraction.
- **Uncaught exceptions and startup failures** are now logged instead of silently crashing.
- **Unclosed fileref tags** are tolerated in markdown output.
- **Edit composer model picker** is now properly wired.
- **Provider registry** tolerates unloaded provider interfaces.
- **Draft model, streaming resume, and reasoning effort** persist correctly across edit sessions.
- **Context injection** keeps volatile thread listings out of injected context (perf improvement).
- **Memory instructions** expanded with storage guidance.
- **Editing and usage visibility** improved in the chat UI.
- **Batched reasoning status updates** are collapsed instead of flooding the timeline.
- **Adjacent file references** render correctly in markdown.
- **Streaming output** stays in view during generation.
- **External workspace symlinks** are followed by the file tooling.
- **Sub-agent permission mode** is preserved across orchestration boundaries.

### Docs
- Documented conversation tags and folder colors.

### Chores
- Bumped Cascadium to 1.2.0.
- Version bumped to 0.3.1.

### Tests
- Added IPC and UI coverage for conversation tags.

---

## [0.2.0] — 2026-08-16

- Desktop appearance switch styling.
- Improved git review diff rendering.
- Better retry and resume behavior.
- Media descriptions and attachment support.
- Updated file references and workspace file handling.
- Provider continuations and semaphore coordination documented.
- Improved git review diff planning.
- Polished renderer navigation and settings.
- Conversation status and controls in the renderer.
- Continuation replies and semaphore coordination.
- Semantic thread search documented and tested.
- Dedicated thread search collection settings.
- Semantic thread indexing and search.
- Repository architecture and contribution guidance documented.
- Customizable chat background images.
- Extended auxiliary model operation timeout.
- Hardened Git repository discovery and coverage.
- React Doctor guidance added.
- Product roadmap documented.
- Desktop packages built for additional architectures.
- Improved chat editing and streaming experience.
- Archived conversation pagination.
- Git review and provider integration workflows.
