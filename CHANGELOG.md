# Avi Changelog

## [Canary]

### Added
- **GPT-6 Astra for OpenAI Subscription** — adds the managed standard and Fast variants with image input and reasoning efforts through Max.

### Docs
- Updated the OpenAI Subscription model catalog documentation for GPT-6 Astra.

### Tests
- Added managed-catalog and Responses request coverage for GPT-6 Astra and its Fast service tier.

---

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

### Changed
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

### Fixed
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

### Docs
- Organized the API reference into separate Core, MCP, and RPC sections with a shared entry point, corrected cross-navigation, and complete field-level request, response, shared-type, error, and notification references for every Remote JSON-RPC method.
- Added renderer design instructions for overlays, chat and inference, configuration forms, the visual system, and Avi's UI/UX philosophy.
- Refreshed the README feature overview with autonomous bots, Rubber Duck reviews, model routers, rich chat content, declarative plugin settings, Teach Skill, and updated usage tracking.
- Improved the `/create-plugin` workflow description to highlight hooks, providers, themes, and advanced customizations.
- Documented `sidebar:status`, `sidebar:mark-seen`, `tags:list`, and `tags:save` with shared `SidebarStatus` and `Tag` types and the per-instance ephemerality of completed-unseen state.
- Documented projected tool-call segments and deferred detail retrieval across conversation RPC methods, shared types, and streaming notifications.

### Chores
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
- **Incomplete response recovery** — **Try again** now depends only on the visible thread, remains available after errors or unexpected app closure even while child threads run, and stays hidden after an explicit user Stop.
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
