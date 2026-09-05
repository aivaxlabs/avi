# UI basics

The Avi window is divided into the Sidebar, conversation area, composer, and auxiliary panel.

## Workspaces

Choose **Create workspace** below **Select a folder** in the composer picker. Enter a name, add folders, and save. Avi creates `~/.aivax/workspaces/<name>` with directory symlinks (junctions on Windows, without administrator privileges). Edit link names to distinguish folders with the same basename.

Workspaces behave like ordinary folders, with their own context, skills, workflows, and MCP configuration. The sidebar changes only the folder icon and adds **Edit workspace** to its menu. Both remain available as conversations update during a run. Removing a linked folder removes only the link, never its target or workspace context files. Broken links remain visible and removable. The workspace name is fixed after creation. Like ordinary folders, workspaces appear in recent folders/sidebar after they have a conversation; unused workspaces can be reopened with **Select a folder**.

Context and file search follow symlinks everywhere, retaining existing exclusions, depth limits, and cycle protection. MCP keeps its normal scope: global configuration plus the selected folder's `.agents/mcpconfig.json`, including symlinked configuration paths. Linked child folders do not automatically contribute MCP servers.

## Sidebar

The Sidebar provides **New chat**, **Quick chat**, conversation search, **Overview**, chronological/model/folder grouping, and **Settings**. Collapsing it leaves a narrow rail with the main action icons centered beneath the expand button and Settings at the bottom.

Folder menus can open the project or terminal, copy the path, open context management, and pick a color from a predefined palette that tints the folder icon. Thread menus can fork a conversation, copy its thread ID, attach colored tags, or archive it. Tags are managed from **Tags → Manage tags**, where you can create, rename, recolor, and delete them; Avi ships with the Review, Important, and Blocked tags. The sidebar filter menu can show agent-created threads, which are hidden by default, and filter conversations by one or more tags (chats matching any selected tag are kept), regardless of the active grouping. Status indicators identify running work, unseen completions, pending approvals, and questions waiting for input.

Hovering over a conversation shows its details. The **Folder** field displays only the folder name, not its full path.

## Conversation area

The center area displays messages, reasoning, and tool traces when **Chat reasoning traces** is set to **Visible**. File, image, audio, and PDF support depends on the capabilities declared by the selected model. Avi loads recent history first and fetches older pages as you scroll upward, including in an opened auxiliary thread.

The built-in `get_chat_attachments` tool returns local paths and stable `attachmentIndex` values for images, audio, and videos attached by the user in the current chat. When an attachment exists only in the model inference payload, Avi first materializes it under managed temporary storage. The returned `temporary` and `materialized` fields identify temporary files and copies created by the current call. Temporary copies can be removed from **Settings → Maintenance → Archive → Delete temporary storage**.

Message actions may retry or resume a response, fork from a point in history, undo recorded file edits, open `:fileref{path="./path"}` references, or implement a completed Plan. **Try again** remains hidden while the current thread is actively running, then becomes available if generation fails, Avi closes, or the app crashes, regardless of side chats or sub-agents. After **Stop** finishes, the interrupted response can also be resumed. Recovery uses the interrupted prompt even if MCP initialization had not finished, or its checkpoint if context compaction already covered it. Confirmed tool results and media are preserved; tools with no recorded result may execute again. Live runtime state—not persisted message status—controls execution indicators. If recovery cannot start, Avi displays the error instead of silently ignoring the click. A provider may still reject the retried request; **Try again** does not bypass provider restrictions.

Structured questions in chats and Quick Chat expire after 60 seconds of inactivity. Moving the pointer, clicking, typing, or scrolling inside the question card restarts that period without submitting or clearing your answers. Activity elsewhere does not extend it. Plan-mode questions do not expire.

## Auxiliary panel

The resizable right panel can show:

- **Files** — workspace tree, search, file contents, and diffs;
- **Sub-agents** — delegated threads and their status;
- **Tasks** — the current thread checklist;
- panels contributed by enabled providers.

Side chats open as separate private conversation panels.

## Composer

The model picker has two modes. When **Settings → Default models → Intelligence levels** defines at least three levels, the picker opens as an intelligence slider: each level applies a configured model and reasoning effort, and **Advanced** switches to direct selection. In advanced mode, **Model** lists favorite models plus **Explore models**, and **Effort** lists the reasoning levels supported by the selected model. Changing models clears an incompatible reasoning effort. Model names containing `(Fast)` or `- Fast` show that text as a lightning icon after the name instead; long labels truncate without separating the icon, and nested menus flip inward when the viewport edge is too close. The project folder can be changed only before the thread is created.

### Sending while work is running

- **Queue** keeps the message for a later turn.
- **Steer** prioritizes the message at the next safe execution boundary.

Choose the default behavior in **Settings → General → Message delivery mode**. `Enter` uses the configured behavior and `Ctrl+Enter` uses the opposite. Pending messages can be reordered or canceled.

### Commands and mentions

Type `/` to open Avi actions and workflows, or `$` to open skills. These selectors open only at the start of the message or after whitespace, so paths and other inline `/` characters do not interrupt writing. Selecting a skill or workflow attaches a context marker to the next message; the accompanying message supplies the actual task.

Type `@` at the start of the message or after whitespace to mention an enabled global or project MCP server, a file or directory under the current project, or optional `@thread` and `@memory` context. Workspace paths are fuzzy-matched from an asynchronous in-memory index that refreshes after five minutes; selecting a result adds a removable context chip without changing the surrounding message text.

## Work and orchestration modes

### Normal

Normal mode executes the request under the active instructions and permission mode.

### Plan

Plan is strictly read-only, including under Full access. It disables MCP and provider tools, restricts terminal commands to investigation, and permits only read-only Plan orchestration. A completed plan is written to `.agents/plannings/<timestamp>/<title>.md`.

Plan persists on the conversation, is incompatible with Ultra, and cancels an active or paused Goal when enabled.

### Goal

Goal creates a persistent objective with a specification, revision, elapsed time, and status. You can pause, resume, edit, or stop it. Avi continues until the Goal is `completed`, `blocked`, or `cancelled`, and resumes continuing Goals after application startup. Interrupting active inference normally pauses rather than cancels the Goal. A finished Goal can be discarded from its strip; discarding clears the strip and the thread's blocked warning, and a new Goal can be started afterwards.

Agents can also keep an internal task list for substantial work. If a turn ends with pending tasks, Avi sends one invisible continuation asking the agent to finish them; it does not repeat the same hook until new user input arrives. A task can be marked `inconclusive` only for a concrete blocker that requires the user. Threads with a blocked Goal, an inconclusive task, or a blocked owned semaphore show a warning icon and `Blocked` status in the sidebar; blocked state suppresses other automatic completion hooks until it is resolved.

### Ultra

Ultra persists on the conversation and requires a model-driven production, independent critique, correction, and fresh-validation loop. The orchestrator implements the main, most important, and most demanding work directly; sub-agents handle bounded, less demanding supporting tasks and independent critique, not the core implementation. It can be combined with Goal, but not Plan. Ultra does not grant authority beyond the user request, permissions, and runtime rules.

The base instructions keep the main implementation with the agent and encourage sub-agents for exploration, research, analysis, and tests that can proceed independently in parallel. When several independent tasks exist, the agent prefers separate, bounded assignments across multiple sub-agents rather than concentrating them in one. It avoids duplicating delegated work, inspects progress and results, guides sub-agents when needed, and integrates their evidence. The base prompt does not reference specific mode names; session-specific instructions define any different division of work or scope restrictions, including read-only Plan delegation.

### Overview dashboard

**Overview** opens on the **Inbox** tab by default. The **Inbox** tab brings together conversations from every bot in an email-style list, grouped by the local date of the latest message, newest first. Each row shows the bot, subject, latest-message preview, attachments indicator, and time. Search bot names and message text, or filter by **Needs you**, **Open**, and **Completed**. The dot and tab count indicate conversations needing your input, not unread messages. Select a row to open that exact conversation in the Bots panel, where replies, attachments, completion, and approvals remain available. Inbox is independent of the model usage date range.

**Tasks overview** shows only user-created threads in **Recently completed**, **Tasks requiring attention**, and **Ongoing tasks**. Threads created by agents, bots, sub-agents, and side chats are excluded from these lists. **Models summary** still includes usage from all conversation types.

The **Overview** page is an observability surface, not an execution mode. It summarizes Tasks and Goals, recent activity, work requiring attention, model responses, token use, and model rankings over a selected time range.

## Settings

Settings contains General, Tuning, Personalization, Providers, Default models, Context, MCP servers, AIVAX Features, Maintenance, Remote control, and About Avi. Maintenance groups archived-conversation management and temporary-storage cleanup with the Semaphores inspector.

Packaged installations check GitHub for updates at startup and every six hours. A Settings badge and a green banner in **General** announce a newer release. Choose **Install update** to download the matching installer; finish active work first because Avi closes and reopens during installation. General also provides a manual update check, download progress, and failure details. See [Automatic updates](Automatic%20updates.md) for platform requirements.

See [Sub-agents](Sub-agents.md), [Side and quick chats](Side%20and%20quick%20chats.md), and [Advanced settings](Advanced%20settings.md).
