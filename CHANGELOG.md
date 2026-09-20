# Avi Changelog

## [Canary]

### Added
- **Bot activation settings and statistics** — optional global days/hours and FIFO admission complement individual schedules without blocking ongoing work or resumptions. Settings → Bots separates Activation settings from Statistics, with 1d/7d/30d descendant consumption, current states, and per-bot UTC consumption timelines. Global RPC exposes settings, saves, and statistics; individual execution modes inherit the global default when unset.
- **Models settings** — the former Default models page is now Models, with Auxiliar models, Sub-agents, Rules, and Model slider tabs. Default-model rules support concrete models and virtual routers, role-specific instructions, strict save validation, and unavailable-model warnings.
- **Bot message attention** — bot messages declare whether a user response is required. Informational messages clear their attention badge when viewed in the focused Inbox; required replies and protected approvals remain pending. Read receipts do not complete conversations or activate bots.
- **Inbox completion options** — a menu beside Complete offers Abandon, Duplicate, and Already worked, recording the selected reason in the conversation history. Completion controls are rounded and borderless.
- Note creation/editing uses the shared app dialog styling and tabs for Details, Sub-tasks, and Attachments, with keyboard navigation, focus containment, and cross-tab validation; compact list headers keep New note and list actions available even when collapsed.
- Empty chats show the latest open bot inbox messages and count, plus unfinished notes due today in the current working folder, with lightweight message rows, labeled shortcuts, and compact empty sections.
- Notes Core API and global RPC note lookup/chunked browser attachment uploads, enabling Avi Workspace Notes without host filesystem access.
- **Notes** — persistent folder-scoped lists with priorities, deadlines, completion/archive states, ordered subtasks and copied file attachments; auxiliary-panel filters and ordering, contextual auxiliary-model `/note`, and `note_lists`, `note_create`, `note_edit`, `note_search` agent/MCP tools plus global Notes RPC methods. See [Notes](docs/Notes.md).
- Built-in/Installed plugin tabs with disabled-by-default Chrome Integration and Computer Use, distinct icons on themed backgrounds, bundled tools and skills, persistent enablement, and a Chrome extension installation guide. Native desktop resources are prepared per target platform during packaging.
- Agent/MCP overview, bot work-log reading and messaging, thread creator/parent filters with type and child counts, and queue IDs for one-time bot activation focus.
- **Relayed MCP** — AIVAX Remote exposes `/mcp/<device-id>` with AIVAX bearer authentication and public `/mcp` discovery with per-tool `instanceKey` authentication. Remote control shows device/instance identifiers and MCP endpoints; API-key menus copy either credential format. New keys use 6 lowercase alphanumeric characters; persistent public instance IDs use 10. Existing keys and device IDs are preserved, and public calls are rate-limited per instance.
- **Keyboard shortcuts** — configurable in-app commands for model/reasoning selection, navigation, chat search, and zoom; global Quick Chat, plugin-provided bindings, conflict detection, persistent overrides, and global RPC `shortcuts:list` / `shortcuts:save`.
- **Find in chat** — navigate visible text occurrences and include older messages from the chat history.
- **ORPC Draft 1 remote transport** — RPC WebSockets now speak binary ORPC (`avi-orpc-draft1`): length-prefixed frames carrying UTF-8 JSON operation envelopes (`operationId`, `expiresAt` now + 180 s, `params`), dotted wire methods over the colon application names, acknowledged server events (`eventId` with an `OK` ack), no batching, and the full specification bundled at `docs/api/rpc/orpc-spec.md`.

### Changed
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
- Tool-group summaries now list invoked tool names, rank the two most frequent names in larger groups, and consolidate calls from the same MCP server under its configured name.
- Worked-block duration labels now include days and hours instead of accumulating long runs entirely in minutes.
- Bot settings now hide inactive tab panels even when section layout styles are applied; consumption metrics and timelines share the Orchestration styles within Statistics, including narrow layouts.
- Bot activation settings use the shared styled switch and weekday selector in a full-width row; all seven days remain accessible without horizontal scrolling and wrap in narrow layouts.
- Sidebar bot notification badges now vertically center their count text instead of rendering it visibly offset inside the pill.
- Local file links and absolute file references open after confirmation; file references and Edited files share Open, Copy path, and Open in explorer context actions. Explorer reveals physical paths behind workspace symlinks, and sidebar terminals launch an interactive shell in a new console without fragile command quoting.
- Bot Inbox reply composer stays at the bottom of the panel while conversation history scrolls independently.
- Bot Inbox messages and Activity descriptions now reuse the chat rich Markdown renderer instead of displaying visualization directives as literal text.

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
