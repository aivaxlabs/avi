# UI basics

The Avi window is divided into the Sidebar, conversation area, composer, and auxiliary panel.

## Sidebar

The Sidebar provides **New chat**, **Quick chat**, conversation search, **Orchestration**, chronological/model/folder grouping, and **Settings**.

Folder menus can open the project or terminal, copy the path, and open context management. Thread menus can fork a conversation, copy its thread ID, or archive it. Status indicators identify running work, unseen completions, pending approvals, and questions waiting for input.

## Conversation area

The center area displays messages, reasoning, and tool traces when **Chat reasoning traces** is set to **Visible**. File, image, audio, and PDF support depends on the capabilities declared by the selected model.

The built-in `get_chat_attachments` tool returns local paths for images, audio, and videos attached by the user in the current chat. When an attachment exists only in the model inference payload, Avi first materializes it under managed temporary storage. The returned `temporary` and `materialized` fields identify temporary files and copies created by the current call. Temporary copies can be removed from **Settings → Archive → Delete temporary storage**.

Message actions may retry or resume a response, fork from a point in history, undo recorded file edits, open `<fileref path="./path" />` references, or implement a completed Plan.

## Auxiliary panel

The resizable right panel can show:

- **Files** — workspace tree, search, file contents, and diffs;
- **Sub-agents** — delegated threads and their status;
- **Tasks** — the current thread checklist;
- panels contributed by enabled providers.

Side chats open as separate private conversation panels.

## Composer

The model picker groups models by provider and shows favorites and recent selections. Changing models clears an incompatible reasoning effort. The project folder can be changed only before the thread is created.

### Sending while work is running

- **Queue** keeps the message for a later turn.
- **Steer** prioritizes the message at the next safe execution boundary.

Choose the default behavior in **Settings → General → Message delivery mode**. `Enter` uses the configured behavior and `Ctrl+Enter` uses the opposite. Pending messages can be reordered or canceled.

### Commands

Type `/` to open Avi actions and workflows, or `$` to open skills. Selecting a skill or workflow attaches a context marker to the next message; the accompanying message supplies the actual task.

## Work and orchestration modes

### Normal

Normal mode executes the request under the active instructions and permission mode.

### Plan

Plan is strictly read-only, including under Full access. It disables MCP and provider tools, restricts terminal commands to investigation, and permits only read-only Plan orchestration. A completed plan is written to `.agents/plannings/<timestamp>/<title>.md`.

Plan persists on the conversation, is incompatible with Ultra, and cancels an active or paused Goal when enabled.

### Goal

Goal creates a persistent objective with a specification, revision, elapsed time, and status. You can pause, resume, edit, or stop it. Avi continues until the Goal is `completed`, `blocked`, or `cancelled`, and resumes continuing Goals after application startup. Interrupting active inference normally pauses rather than cancels the Goal.

### Ultra

Ultra persists on the conversation and requires a model-driven production, independent critique, correction, and fresh-validation loop. It can be combined with Goal, but not Plan. Ultra does not grant authority beyond the user request, permissions, and runtime rules.

### Orchestration dashboard

The **Orchestration** page is an observability surface, not an execution mode. It summarizes Tasks and Goals, recent activity, work requiring attention, model responses, token use, and model rankings over a selected time range.

## Settings

Settings contains General, Tuning, Personalization, Providers, Default models, Context, MCP servers, AIVAX Features, Archive, Remote control, and About Avi.

See [Sub-agents](Sub-agents.md), [Side and quick chats](Side%20and%20quick%20chats.md), and [Advanced settings](Advanced%20settings.md).
