# Avi Changelog

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