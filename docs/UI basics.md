# UI basics

The Avi window has an Activity Bar and a shared page composer. Home contains the chat Sidebar, conversation area, message composer, and auxiliary panel; Inbox, Folders, and Settings reuse the same page surface.

## Workspaces

Choose **Create workspace** below **Select a folder** in the composer picker. Enter a name, add folders, and save. Avi creates `~/.aivax/workspaces/<name>` with directory symlinks (junctions on Windows, without administrator privileges). Edit link names to distinguish folders with the same basename.

Workspaces behave like ordinary folders, with their own context, skills, workflows, and MCP configuration. The sidebar changes only the folder icon and adds **Edit workspace** to its menu. Both remain available as conversations update during a run. Removing a linked folder removes only the link, never its target or workspace context files. Broken links remain visible and removable. The workspace name is fixed after creation. Like ordinary folders, workspaces appear in recent folders/sidebar after they have a conversation; unused workspaces can be reopened with **Select a folder**.

Context and file search follow symlinks everywhere, retaining existing exclusions, depth limits, and cycle protection. MCP keeps its normal scope: global configuration plus the selected folder's `.agents/mcpconfig.json`, including symlinked configuration paths. Linked child folders do not automatically contribute MCP servers.

## Sidebar

The Activity Bar provides **Home**, **Inbox**, and **Folders**, with **Settings** fixed at the bottom. Home is the default and keeps **New chat**, **Quick chat**, conversation search, bots, and chronological/model/folder grouping in the existing Sidebar. Collapsing the chat Sidebar leaves its main action icons beneath the expand button. In windows 700 px wide or narrower, the Activity Bar and Sidebar are hidden behind a menu button at the top left. The button opens them as an opaque drawer over the chat without moving it; select a destination or conversation, click outside the drawer, press Escape, or press `Control+B` to close it. The Sidebar cannot be resized in this mode. Switching Activity Bar destinations keeps the current chat mounted, including its unsent message.

**Folders** lists known working folders, with **Global** pinned above the scrolling list. **Filter folders** searches names and paths without hiding Global; long names truncate, and only the folder list scrolls. Open a folder to access **MCP Servers**, **Context**, **Threads**, and **Archive**. Global uses the home folder for threads and MCP servers and `~/.agents` for context. Threads and Archive show only the selected folder; global retention and cleanup remain in Settings → Maintenance. Use **All folders** to return to the list.

The **Home** badge counts chats awaiting approval or input, blocked chats, chats marked as needing attention, and unseen completions awaiting review, counting each chat once. Running or semaphore-waiting chats alone do not increase it. The **Inbox** badge counts open Inbox entries whose latest message is an unread bot message, including informational messages. Historical messages, completed entries, and already-read requests for replies or approvals do not increase it. Both badges hide at zero and display `99+` above 99; their tooltips expose the full counts.

With transparency enabled, the Activity Bar remains transparent, the chat Sidebar has a light tint, and the shared composer carries the subtle edge shadow on every page. Opaque mode uses theme-aware borders.

Folder menus can open the project or terminal, copy the path, open context management, and pick a color from a predefined palette that tints the folder icon. Thread menus can fork a conversation, copy its thread ID, attach colored tags, or archive it. Tags are managed from **Tags → Manage tags**, where you can create, rename, recolor, and delete them; Avi ships with the Review, Important, and Blocked tags. The sidebar filter menu can show agent-created threads, which are hidden by default, and filter conversations by one or more tags (chats matching any selected tag are kept), regardless of the active grouping. Status indicators identify running work, unseen completions, pending approvals, and questions waiting for input.

Hovering over a conversation shows its details. The **Folder** field displays only the folder name, not its full path.

## Conversation area

The center area displays messages, reasoning, and tool traces when **Chat reasoning traces** is set to **Visible**. File, image, audio, and PDF support depends on the capabilities declared by the selected model. Avi loads recent history first and fetches older pages as you scroll upward, including in an opened auxiliary thread.

The built-in `get_chat_attachments` tool returns local paths and stable `attachmentIndex` values for images, audio, and videos attached by the user in the current chat. When an attachment exists only in the model inference payload, Avi first materializes it under managed temporary storage. The returned `temporary` and `materialized` fields identify temporary files and copies created by the current call. Temporary copies can be removed from **Settings → Maintenance → Archive → Delete temporary storage**.

Message actions may retry or resume a response, fork from a point in history, undo recorded file edits, open `:fileref{path="./path"}` references, or implement a completed Plan. **Try again** remains hidden while the current thread is actively running, then becomes available if generation fails, Avi closes, or the app crashes, regardless of side chats or sub-agents. After **Stop** finishes, the interrupted response can also be resumed. Recovery uses the interrupted prompt even if MCP initialization had not finished, or its checkpoint if context compaction already covered it. Confirmed tool results and media are preserved; tools with no recorded result may execute again. Live runtime state—not persisted message status—controls execution indicators. If recovery cannot start, Avi displays the error instead of silently ignoring the click. A provider may still reject the retried request; **Try again** does not bypass provider restrictions.

Tool approvals appear inline at the end of the conversation, like structured questions, instead of a modal dialog. The card shows the model's stated goal, the tool name, the folder, and each argument in full. **Allow** runs the call once, **Always allow** runs it and remembers this command for the folder, and **Deny** (or `Escape` while the card has focus) rejects it. When several tool calls wait at once, the card shows how many more are pending and moves to the next one after each decision. Approvals for side chats and sub-agents appear inside their auxiliary panel; the sidebar marks the conversation while an approval is waiting.

Structured questions show a hint for the answer mode: **Select one** uses radio buttons, **Select all that apply** uses checkboxes for marking several options, and **Write your answer** uses a text box. Choice questions can include a short description under each option, rendered as Markdown, and always offer **Other** for a typed answer. Structured questions in chats and Quick Chat expire after 60 seconds of inactivity. Moving the pointer, clicking, typing, or scrolling inside the question card restarts that period without submitting or clearing your answers. Activity elsewhere does not extend it. Plan-mode questions do not expire.

## Auxiliary panel

The resizable right panel can show:

- **Files** — workspace tree, search, file contents, and diffs;
- **Sub-agents** — delegated threads and their status;
- **Tasks** — the current thread checklist;
- panels contributed by enabled providers.

Side chats open as separate private conversation panels. The forked parent history remains in the side chat's model context but is not displayed; the panel shows only messages sent after the fork. When a side chat's context is within 10 percentage points of the automatic compaction threshold, Avi runs quick compaction before the next response.

Use **Expand auxiliary panel**, between **+** and close, to widen it toward 80% of the window and temporarily compact the sidebar. The chat stays visible; the expansion reserves 320 px for it where the window permits. **Restore panel width** restores your normal layout without overwriting saved widths.

In windows 700 px wide or narrower, the auxiliary panel and the Inbox panel open over the whole window. Resizing and **Expand auxiliary panel** are unavailable there; close the panel to return to the chat.

### Git Review

Choose **Git Review** from **+**, then select one repository above the changed-file tree. Discovery includes nested repositories and linked workspace folders, up to three directory levels and 20 repositories, excluding dependency/generated folders. Only the active repository's index and selected file's diff are loaded. Refresh rescans the catalog and active index. A spinner and action-specific status appear while Git operations run, then change to the result after the index refresh. File previews also show a loading spinner.

The tree marks added, modified, deleted, renamed, untracked, and conflicted files; a dot marks staged changes. Folders do not display change counts; those with more than 100 changed files still start collapsed. Context menus group actions with icons and separators. Right-click a file/folder for stage, unstage, confirmed discard, add to `.gitignore`, mention in chat, open, show in explorer, and copy path. Root menus also offer stage/unstage, confirmed discard, push, and agent code review. Discard explicitly confirms removal of both staged and unstaged changes for the selected path. Ignore rules do not stop tracking already tracked files.

The tree has **Unstaged** and **Staged changes** roots. Partially staged files appear in both; selecting an entry opens its corresponding diff. Commits use staged changes only. The diff offers **Unstaged** against the index and **Staged changes** against HEAD, with syntax highlighting for recognized languages using Avi's shared light/dark code palette. Arrows reveal 20 unchanged lines from either edge of a **hidden lines** block; clicking its count reveals the entire block. The right-hand map jumps to changed blocks. Select code to add a comment, mention it in chat, send it to a side chat, or ask a [Quick question](Side%20and%20quick%20chats.md#quick-questions); annotations preserve the highlighted selection.

Commit controls adapt to the navigation column width; the action buttons wrap into separate rows in narrow panels. **Commit** and **Commit + push** commit staged changes only. A failed push does not undo a successful local commit. The sparkle dropdown offers **Generate commit message**, which fills the message from staged changes without committing, and **Generate commits**, which forks a side chat and immediately asks the model to execute the multi-commit workflow only in the selected repository. The latter authorizes staging and creating local commits, not pushing. AI generation may incur model costs.

Discard removes the selected staged, unstaged, and untracked changes after confirmation. Nested repositories are independent. Symbolic links/submodules and sensitive configuration (`.env`, `.env.*`, `appservice.ini`) require separate handling; back up sensitive configuration first. Binary files, working files larger than 2 MiB, and previews exceeding 10,000 combined content/diff lines show an explicit notice instead of rendering a potentially blocking text view.

## Composer

Before a thread exists, the composer keeps one draft per working folder: text, attachments, model, reasoning effort, permission mode, and Plan/Goal/Ultra selection survive switching threads, tabs, or restarting Avi, and selecting that folder again restores them. Attachments are references to the original files, not copies; an attachment whose file was moved or deleted is removed when the draft is reopened. The same rule applies to unsent thread attachments.

Opening a thread restores the model, reasoning effort, Plan/Goal mode, and Ultra selection from its latest user message, including a confirmed edit or a queued message. Unsent text and attachments remain saved separately; changing a selection without sending does not override the last message when reopening the thread. Rubber Duck is a separate thread type and remains unchanged. In a Side Chat, the parent's copied messages do not restore its Goal, Plan, or Ultra selection; only the Side Chat's own later messages can do so. Bot threads retain their configured model and mode restrictions.

Editing a message keeps model changes local until you send the replacement. Cancelling the edit does not change the thread's model. Sending the edit saves the selected parameters on the replacement message.

The model picker has two modes. When **Settings → Models → Model slider** defines at least three levels, the picker opens as an intelligence slider: each level applies a configured model and reasoning effort, and **Advanced** switches to direct selection. In advanced mode, **Model** lists favorite models plus **Explore models**, and **Effort** lists the reasoning levels supported by the selected model. Changing models clears an incompatible reasoning effort. Model names containing `(Fast)` or `- Fast` show that text as a lightning icon after the name instead; long labels truncate without separating the icon, and nested menus flip inward when the viewport edge is too close. The project folder can be changed only before the thread is created.

### Sending while work is running

- **Queue** keeps the message for a later turn.
- **Steer** prioritizes the message at the next safe execution boundary.

Choose the default behavior in **Settings → General → Message delivery mode**. `Enter` uses the configured behavior and `Ctrl+Enter` uses the opposite. Pending messages can be reordered or canceled.

### Commands and mentions

Type `/` to open Avi actions and workflows, or `$` to open skills. These selectors open only at the start of the message or after whitespace, so paths and other inline `/` characters do not interrupt writing. Selecting a skill or workflow attaches a context marker to the next message; the accompanying message supplies the actual task.

Type `@` at the start of the message or after whitespace to mention an enabled global or project MCP server, a file or directory under the current project, or optional `@thread` and `@memory` context. Workspace paths are fuzzy-matched from an asynchronous in-memory index that refreshes after five minutes; selecting a result adds a removable context chip without changing the surrounding message text.

## Local files and terminals

Click a `file:///` link or a file reference to preview it in Files. Absolute paths and file URLs require confirmation before access. Right-click a file reference or an item in **Edited files** for **Open**, **Copy path**, and **Open in explorer**; Open retains the file preview or edit diff. The menus support arrow keys and Escape. Explorer reveals the physical target when the workspace uses symbolic links.

Use **Open in terminal** on a sidebar folder to start the configured interactive shell in that folder. The terminal stays open for commands.

## Work and orchestration modes

### Normal

Normal mode executes the request under the active instructions and permission mode.

### Plan

Plan is strictly read-only, including under Full access. It disables MCP and provider tools, restricts terminal commands to investigation, and permits only read-only Plan orchestration. A completed plan is written to `.agents/plannings/<timestamp>/<title>.md`.

Plan persists on the conversation and is incompatible with Ultra. Enabling Plan or sending Plan messages does not change an existing Goal; Plan turns run without the Goal contract, and the Goal keeps its state.

### Goal

Goal creates a persistent objective with a specification, revision, elapsed time, and status. You can pause, resume, edit, or stop it. Avi continues until the Goal is `completed`, `blocked`, or `cancelled`, and resumes continuing Goals after application startup. Interrupting active inference normally pauses rather than cancels the Goal. A finished Goal can be discarded from its strip; discarding clears the strip and the thread's blocked warning, and a new Goal can be started afterwards.

Goal authorizes the work necessary to achieve and verify the objective within its scope, without redundant permission requests or handing executable work back to you. Runtime approvals, safety rules, explicit restrictions, pauses, cancellations, and revoked authorization still apply. The auxiliary model prepares the specification only when creating a Goal. Subsequent Goal messages reuse the existing objective, without auxiliary preparation or automatic changes to its specification or revision. Follow-up criteria remain in conversation history and guide execution. Sending in Goal mode after completion, blocking, or cancellation reactivates the same Goal; discard it first to create a different objective. Asking whether a criterion is met also directs the agent to close unmet gaps and continue, unless you explicitly ask only for a status report. Editing the Goal specification remains an explicit replacement.

Blocking is a last resort: the agent must investigate the cause, try materially different permitted alternatives, and finish independent work first. A blocker report must explain what was tried, why remaining alternatives cannot work, and the minimum input or external change needed to resume. Difficulty, missing verification, and a failed attempt alone are not blockers. These are execution instructions, not a guarantee that a model will always follow them.

Agents can also keep an internal task list for substantial work. If a turn ends with pending tasks, Avi sends one invisible continuation asking the agent to finish them; it does not repeat the same hook until new user input arrives. A task can be marked `inconclusive` only for a concrete blocker that requires the user. Threads with a blocked Goal, an inconclusive task, or a blocked owned semaphore show a warning icon and `Blocked` status in the sidebar; blocked state suppresses other automatic completion hooks until it is resolved.

### Ultra

Ultra persists on the conversation and requires a model-driven production, independent critique, correction, and fresh-validation loop. The orchestrator implements the main, most important, and most demanding work directly; sub-agents handle bounded, less demanding supporting tasks and independent critique, not the core implementation. It can be combined with Goal, but not Plan. Ultra does not grant authority beyond the user request, permissions, and runtime rules.

The base instructions keep the main implementation with the agent and encourage sub-agents for exploration, research, analysis, and tests that can proceed independently in parallel. When several independent tasks exist, the agent prefers separate, bounded assignments across multiple sub-agents rather than concentrating them in one. It avoids duplicating delegated work, inspects progress and results, guides sub-agents when needed, and integrates their evidence. The base prompt does not reference specific mode names; session-specific instructions define any different division of work or scope restrictions, including read-only Plan delegation.

### Inbox dashboard

**Inbox** in the Activity Bar replaces the former Overview entry and opens on the **Inbox** tab by default. The **Inbox** tab brings together conversations from every bot in an email-style list, grouped by the local date of the latest message, newest first. Each row shows the bot, subject, latest-message preview, attachments indicator, and time. Search bot names and message text, or filter by **Needs you**, **Open**, and **Completed**. The dot and tab count indicate conversations needing your input, not unread messages. Select a row to open that exact conversation in the Bots panel, where replies, attachments, completion, and approvals remain available. Inbox is independent of the model usage date range.

**Tasks overview** shows only user-created threads in **Recently completed**, **Tasks requiring attention**, and **Ongoing tasks**. Threads created by agents, bots, sub-agents, and side chats are excluded from these lists. **Models summary** still includes usage from all conversation types.

Inbox and the shared Tasks overview/Models summary load independently in parallel, so you can use Inbox while statistics load. Inbox initially renders 50 entries; **Show more** reveals another 50. Search and status filters apply to the entire Inbox, and shortened list previews do not change the full message in the side panel.

The **Inbox** page is an observability surface, not an execution mode. It summarizes Tasks and Goals, recent activity, work requiring attention, model responses, token use, and model rankings over a selected time range.

## Settings

Navigation groups use the same horizontal separator and spacing throughout, including around AIVAX Features.

Settings contains General, Tuning, Personalization, Providers, Models, Context, MCP servers, AIVAX Features, Maintenance, Remote control, and About Avi. The **Models** page has **Auxiliar models**, **Sub-agents**, **Rules**, and **Model slider** tabs; one **Save default models** action persists the complete draft. Maintenance groups archived-conversation management and temporary-storage cleanup with the Semaphores inspector.

Packaged installations check GitHub for updates at startup and every six hours. A Settings badge and a green banner in **General** announce a newer release. Choose **Install update** to download the matching installer; finish active work first because Avi closes and reopens during installation. **About** always provides update status and a manual update check, including download progress and failure details. General only shows the card when an update is available. See [Automatic updates](Automatic%20updates.md) for platform requirements.

See [Sub-agents](Sub-agents.md), [Side and quick chats](Side%20and%20quick%20chats.md), and [Advanced settings](Advanced%20settings.md).
