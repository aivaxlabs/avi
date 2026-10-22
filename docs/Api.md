# Avi commands

Avi exposes its bot and chat orchestration tools as commands. Each command can be called as a plain HTTP request through `/commands/:command`, or as an MCP tool with the same name and arguments through `/mcp` (see [Remote MCP API](api/mcp/overview.md)).

## Calling commands

Commands are served by the local Remote Control server, by default at `http://127.0.0.1:18992`. Enable the server and create an API key in **Settings → Remote Control** (see [Remote Control](Remote%20control.md)).

```sh
curl -H "Authorization: Bearer $AVI_KEY" http://127.0.0.1:18992/commands/bots_list
curl -H "Authorization: Bearer $AVI_KEY" http://127.0.0.1:18992/commands/bots_activate -d '{"id":"<bot-id>"}'
curl -H "Authorization: Bearer $AVI_KEY" "http://127.0.0.1:18992/commands/bots_activate?id=<bot-id>&workQueueId=0"
```

| Aspect | Behavior |
| --- | --- |
| Authentication | `Authorization: Bearer <api-key>` with a live, unexpired Remote Control key. Path credentials are not accepted. |
| `POST` | Arguments are a JSON object in the body. An empty body means `{}`. |
| `GET` | Arguments come from the query string. Parameters declared as `integer`, `number`, `boolean`, `object`, or `array` are parsed as JSON (`workQueueId=0`, `low_priority=true`, `changes={"enabled":false}`); all others stay strings. |
| Structured result | HTTP `200` with the result object as JSON. |
| Text result | HTTP `200` with `{ "text": "..." }`. Commands that return text are marked **Text** below. |
| Errors | `400` `{ "error": "..." }` for invalid arguments or command failures; `401` for missing or invalid keys; `404` for unknown commands; `405` for methods other than `GET` and `POST`; `413` for bodies over 1 MiB. |

Commands run with the identity of an external agent: there is no source thread, `chat_create_thread` defaults to the user home folder, and prompts are delivered as `<cross-message from_thread_id="external" from_role="external_agent">`. Commands run immediately, without Avi tool approvals; treat every API key as full control of Avi.

The endpoint is local only. AIVAX Remote does not publish `/commands`; remote clients use the relay MCP endpoints instead.

## Command index

| Command | Result | Summary |
| --- | --- | --- |
| [`bots_list`](#bots_list) | JSON | List bots with configuration, schedule state, and work threads. |
| [`bots_create`](#bots_create) | JSON | Create a bot and its main thread. |
| [`bots_update`](#bots_update) | JSON | Change selected bot fields. |
| [`bots_delete`](#bots_delete) | JSON | Delete a bot and its main thread. |
| [`bots_activate`](#bots_activate) | JSON | Activate a bot now, ignoring scheduling rules. |
| [`bots_read_work_log`](#bots_read_work_log) | JSON | Read a bot's Inbox work logs and activity diary. |
| [`bots_send_work_log_message`](#bots_send_work_log_message) | JSON | Reply to a bot's Inbox work log. |
| [`chat_overview`](#chat_overview) | JSON | Running threads, recently finished turns, and open bot work logs. |
| [`chat_list_folders`](#chat_list_folders) | Text | Folders that contain threads. |
| [`chat_list_threads`](#chat_list_threads) | Text | Threads filtered by folder, creator, and parent. |
| [`chat_create_thread`](#chat_create_thread) | Text | Create a thread and optionally start it. |
| [`chat_send_prompt`](#chat_send_prompt) | Text | Send a prompt to a thread. |
| [`chat_interrupt_thread`](#chat_interrupt_thread) | Text | Interrupt a thread's active run. |
| [`chat_inspect_thread`](#chat_inspect_thread) | Text | Peek at a thread's latest turns and status. |
| [`chat_export_thread`](#chat_export_thread) | Text | Export a full thread transcript to disk. |
| [`quick_chat_invoke`](#quick_chat_invoke) | JSON | Run one Quick chat turn and return its answer. |

## Bots

Bot result types are documented in [RPC bots](api/rpc/bots.md): [`BotRecord`](api/rpc/bots.md#botrecord), [`BotSnapshot`](api/rpc/bots.md#botsnapshot), [`PriorityQueueItem`](api/rpc/bots.md#priorityqueueitem), [`Pendency`](api/rpc/bots.md#pendency), [`PendencyMessage`](api/rpc/bots.md#pendencymessage), and [`ActivityEntry`](api/rpc/bots.md#activityentry).

### Bot configuration fields

`bots_create` accepts these fields, and `bots_update` accepts them inside `changes`. All are optional except `name` and `model` on creation.

| Field | Type | Description |
| --- | --- | --- |
| `name` | string, min 1 | Display name and thread title. Required on create. |
| `model` | string, min 1 | Configured model ID, such as `openai:gpt-5`. Must exist in Avi. Required on create. |
| `iconSeed` | string, min 1 | Legacy avatar seed. |
| `personality` | string | Personality ID; `""` inherits the global personality. |
| `workingFolder` | string | Absolute folder; `""` uses the bot's dedicated default folder. Relative paths are rejected. |
| `reasoningEffort` | string | Effort supported by the model; `""` uses the model default. |
| `contextSize` | integer ≥ 0 | Context-window override; `0` uses the model default. |
| `activationPeriodMinutes` | integer ≥ 1 | Minutes between automatic activation checks. |
| `activationMode` | `"static"` \| `"smart"` | `static` activates every period; `smart` can idle when no work remains. |
| `executionMode` | `"inherit"` \| `"direct"` \| `"orchestrator"` | `inherit` follows the global execution mode. |
| `maxActivations` | integer ≥ 0 | Consecutive activations before a cooldown; `0` disables the limit. |
| `activationWindow` | object | Local-time window: `days` (integers 0–6, Sunday is 0; empty means every day), `startMinute` and `endMinute` (0–1439; omit for no bound). |
| `instructions` | string | Responsibilities, priorities, and boundaries injected into every activation. |
| `workQueue` | string[] | Ordered round-robin tasks. The bot does not activate automatically while empty. |
| `priorityAutoContinue` | boolean | When `true` (default), waiting priority items run right after each finished run. |
| `enabled` | boolean | Whether automatic scheduling may activate the bot. |
| `workQueueIndex` | integer ≥ 0 | `bots_update` only. Work queue item to run on the next activation. |

`permissionMode` cannot be set through commands; passing it fails. Change it in Bot settings or with the RPC `bots:update` method.

### `bots_list`

List every bot with its configuration, runtime and schedule state, and direct work threads.

**Arguments:** none.

**Result:**

```json
{
  "bots": [
    {
      "id": "b0f3...",
      "name": "Release watcher",
      "conversationId": "c91a...",
      "workingFolder": "C:\\Code\\app",
      "dataFolder": "C:\\Code\\app\\.avi-bots\\b0f3...",
      "model": "openai:gpt-5",
      "reasoningEffort": "low",
      "contextSize": null,
      "personality": null,
      "instructions": "...",
      "workQueue": ["Check new issues"],
      "workQueueItems": [{ "id": 0, "task": "Check new issues" }],
      "workQueueIndex": 0,
      "priorityQueue": [],
      "priorityAutoContinue": true,
      "lastActivationKind": "work",
      "enabled": true,
      "running": false,
      "scheduleState": "active",
      "queued": false,
      "executionMode": null,
      "permissionMode": "approve_for_me",
      "effectiveExecutionMode": "direct",
      "activationMode": "smart",
      "activationPeriodMinutes": 30,
      "maxActivations": 0,
      "activationWindow": { "days": [], "startMinute": null, "endMinute": null },
      "activationWindowDescription": "Any time",
      "nextActivationAt": "2026-10-22T17:00:00.000Z",
      "pendingApprovals": 0,
      "thread": { "id": "c91a...", "title": "Release watcher" },
      "workThreads": [{ "id": "d22e...", "title": "...", "running": false }]
    }
  ]
}
```

| Field | Description |
| --- | --- |
| `workingFolder`, `dataFolder` | Effective folders after defaults. |
| `workQueueItems` | `workQueue` with the zero-based IDs accepted by `bots_activate.workQueueId`. |
| `priorityQueue` | [`PriorityQueueItem[]`](api/rpc/bots.md#priorityqueueitem) in execution order. |
| `scheduleState` | `"working"`, `"queued"`, `"outside-window"`, `"disabled"`, `"sleep"`, or `"active"`. |
| `queued` | Whether an activation is waiting for admission. |
| `executionMode` / `effectiveExecutionMode` | Configured mode (`null` inherits) and the resolved mode. |
| `pendingApprovals` | Count of protected pending Inbox approvals. |
| `thread` | The bot's main [`Conversation`](api/rpc/types.md#conversation), or `null`. |
| `workThreads` | Child conversations of the main thread, each with `running`. |

Fails when cross-bot Inbox access is disabled and the caller is a bot; external callers are not affected.

### `bots_create`

Create a persistent bot and its main thread.

**Arguments:** [bot configuration fields](#bot-configuration-fields); `name` and `model` are required.

```json
{ "name": "Release watcher", "model": "openai:gpt-5", "workQueue": ["Check new issues"], "enabled": false }
```

**Result:** `{ "bot": BotRecord }` with the stored [`BotRecord`](api/rpc/bots.md#botrecord).

**Errors:** unconfigured model, relative `workingFolder`, or `permissionMode` present.

### `bots_update`

Update selected fields of an existing bot; omitted fields are preserved.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Bot ID. |
| `changes` | object | Yes | At least one [bot configuration field](#bot-configuration-fields). Unknown fields are rejected. |

```json
{ "id": "b0f3...", "changes": { "enabled": true, "activationPeriodMinutes": 15 } }
```

With `GET`, pass `changes` as JSON: `?id=b0f3...&changes={"enabled":true}` (URL-encoded).

**Result:** `{ "bot": BotRecord }`.

**Errors:** empty `changes`, unknown bot, unconfigured model, relative `workingFolder`, or `permissionMode` present.

### `bots_delete`

Delete a bot, its main conversation, and pending approvals. Bot data files and work threads remain on disk and in the thread list. Irreversible.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Bot ID. |

**Result:** `{ "deleted": true, "id": "b0f3..." }`.

### `bots_activate`

Activate a bot explicitly. The activation becomes the bot's next item: it starts immediately when the bot is free, or right after its current run otherwise. It ignores every automatic scheduling rule: enabled state, period, idle, activation windows, snoozes, activation limit, and capacity. With an empty work queue, the bot reviews its full scope.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Bot ID. |
| `workQueueId` | integer ≥ 0 | No | ID from `workQueueItems`. Focuses this activation on that task without moving the recurring queue cursor. |

**Result:**

```json
{ "id": "b0f3...", "activated": true, "status": "started" }
```

| `status` | `activated` | Meaning |
| --- | --- | --- |
| `started` | `true` | The run started. |
| `queued_next` | `false` | The bot is working; the activation runs right after the current run. |
| `start_failed` | `false` | The activation could not start and was discarded. |

### `bots_read_work_log`

Read a bot's Inbox work logs, their messages, and its activity diary.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Bot ID. |
| `workLogId` | string | No | Return only this work log. |
| `status` | `"all"` \| `"open"` \| `"completed"` | No | Filter work logs by status. Defaults to `all`. |

**Result:**

```json
{
  "id": "b0f3...",
  "inbox": [{ "id": "p1...", "title": "...", "status": "open", "messages": [], "approval": null, "createdAt": "...", "updatedAt": "...", "completedAt": null }],
  "activity": [{ "id": "a1...", "title": "...", "description": "...", "category": "completed", "createdAt": "..." }],
  "errors": { "inbox": null, "activity": null },
  "error": null
}
```

`inbox` contains [`Pendency`](api/rpc/bots.md#pendency) items and `activity` contains [`ActivityEntry`](api/rpc/bots.md#activityentry) items. Unreadable data files are reported in `errors` and `error` instead of failing the command.

**Errors:** unknown bot, invalid `status`, or `workLogId` not found.

### `bots_send_work_log_message`

Append a message to an existing Inbox work log and add it to the bot's priority queue. The bot receives it in a later activation; the message does not interrupt a running bot or resolve pending approvals.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Bot ID. |
| `workLogId` | string | Yes | Work log ID from `bots_read_work_log`. |
| `message` | string, min 1 | Yes | Markdown message. |

**Result:**

```json
{ "item": { "id": "m1...", "role": "user", "content": "...", "createdAt": "..." }, "queued": true, "queueItemId": "q1..." }
```

`item` is the persisted [`PendencyMessage`](api/rpc/bots.md#pendencymessage). `queued` is `false` and `queueItemId` is `null` when the work log is waiting for an approval: the reply is saved but not queued.

## Threads

### `chat_overview`

Summarize running or waiting threads, turns that finished recently, and open bot work logs. Hidden side chats are excluded.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `recentMinutes` | integer 1–10080 | No | Window for finished turns. Defaults to `60`. |
| `limit` | integer 1–100 | No | Maximum finished threads. Defaults to `20`. |

**Result:**

```json
{
  "running": [{ "id": "...", "title": "...", "folderPath": "...", "type": "user", "threadType": "thread", "parentThreadId": null, "status": "running" }],
  "recentlyFinished": [{ "id": "...", "title": "...", "folderPath": "...", "type": "agent", "threadType": "thread", "parentThreadId": null, "status": "completed", "finishedAt": "2026-10-22T16:00:00.000Z" }],
  "botInbox": [{ "id": "b0f3...", "name": "Release watcher", "inbox": [], "error": null }]
}
```

| Field | Description |
| --- | --- |
| `running[].status` | `running`, `waiting_for_input` (question or approval), or `sleeping` (waiting for a semaphore). |
| `recentlyFinished[].status` | `completed`, `error`, or `aborted`. Ordered newest first. Completion means the latest turn ended, not that a Goal is finished. |
| `type` / `threadType` | Persisted creator (`user` or `agent`) and the conversation type: `thread`, `bot`, `subagent`, `side`, `rubber_duck`, or `rubber_duck_subject`. |
| `botInbox` | Bots with open work logs ([`Pendency[]`](api/rpc/bots.md#pendency)) or data read errors. |

### `chat_list_folders`

List folders associated with threads, including the user home folder. **Text** result.

**Arguments:** none.

```text
Folders:
- app
  Path: C:\Code\app
  Threads: 12
--------
- gscat
  Path: C:\Users\gscat
  Threads: 3
```

Returns `No folders found.` when empty.

### `chat_list_threads`

List threads with optional filters. **Text** result.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `folderPath` | string | No | Absolute folder; only its threads are listed. |
| `type` | `"all"` \| `"user"` \| `"agent"` | No | Filter by persisted creator. Defaults to `all`. |
| `parentThreadId` | string | No | Exact parent ID; `""` selects root threads. Omit for any parent. |

```text
Threads:
- Release watcher
  ID: c91a...
  Type: user (bot)
  Sub-threads: 2
  Folder: C:\Code\app
  Model: ~avi-bot/Release watcher
  Status: idle
  Created: 2026-10-20T10:00:00.000Z
  Updated: 2026-10-22T16:00:00.000Z
```

Child threads show `Parent thread: <id>` instead of `Sub-threads`. `Status` is `running`, `waiting_for_input`, `sleeping`, or `idle`; `Semaphore permits` appears when the thread holds any. Returns `No threads found.` when nothing matches.

**Errors:** relative `folderPath` or invalid `type`.

### `chat_create_thread`

Create a thread and optionally send its first prompt. **Text** result.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | No | First prompt. Without it, the thread is created idle. |
| `folderPath` | string | No | Absolute existing directory. Defaults to the user home folder. |
| `model_name` | string | No | Configured model ID. Defaults to the latest model used in the folder, then Avi's last model. |
| `reasoning_effort` | string | No | Effort supported by the model. Defaults to the latest effort used in the folder. |
| `model_level` | `"small"` \| `"medium"` \| `"large"` | When level mode is on | See below. |
| `wait_for_response` | boolean | No | When `true`, the request waits for the run to finish and includes the final answer. |

The model arguments depend on **Default models → Sub-agents**. When it is off, use `model_name` and `reasoning_effort`; `model_level` is ignored. When it is on, `model_level` is required and selects the configured model and effort for that level; `model_name` and `reasoning_effort` are ignored. If that level's model is unavailable, Avi falls back to its last-used model. Call `tools/list` on `/mcp` to see the schema currently in effect.

```text
Thread created: Summarize open issues
ID: e5f1...
Folder: C:\Code\app
Model: openai:gpt-5
Reasoning effort: low
Status: completed
Prompt message ID: 7a2c...

Response status: completed
Response:
...final assistant answer...
```

`Status` is `idle` without a prompt, `running` after a prompt, or `completed` with `wait_for_response`. The response block appears only when waiting. Long runs keep the HTTP request open; use a client timeout that matches the work.

**Errors:** relative or non-directory `folderPath`, unconfigured model, unsupported reasoning effort, or a missing or invalid `model_level` in level mode.

### `chat_send_prompt`

Send a prompt to an existing thread. **Text** result.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `threadId` | string | Yes | Target thread ID. |
| `prompt` | string | Yes | Prompt text; must not be blank. |
| `low_priority` | boolean | No | `true` queues behind active work. Defaults to `false`, which steers the message in at the next safe boundary and cancels a pending question. |

```text
Prompt sent.
Thread ID: e5f1...
Message ID: 9b3d...
Status: running
```

| `Status` | Meaning |
| --- | --- |
| `running` | The thread was idle and started a run. |
| `steered` | Delivered into the active run. |
| `queued` | Low priority; waits behind the active run. |
| `queued_waiting_for_input` | Low priority; waits behind a pending question. |
| `queued_for_bot` | Target is a bot's main thread; the prompt entered the bot's priority queue. The output shows `Queue item ID` instead of `Message ID`. |

**Errors:** unknown thread, blank prompt, non-boolean `low_priority`, or a side-chat target.

### `chat_interrupt_thread`

Interrupt the active run at its next safe boundary. Sub-agents, background processes, and queued prompts keep running. **Text** result.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `threadId` | string | Yes | Thread ID. |

Returns `Thread <id> interrupted.` or `Thread <id> was not running.`

### `chat_inspect_thread`

Return the latest four turns, with final assistant text only, plus status and pending approvals. Reasoning and tool calls are omitted and long output is truncated. **Text** result.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `threadId` | string | Yes | Thread ID. |

```text
thread_id: e5f1...
thread_type: thread
status: waiting_for_input
model: openai:gpt-5
title: Summarize open issues
<|pending_approval_start|>
id: ap1...
name: run_in_terminal
goal: Run the test suite
<|pending_approval_end|>
<|user_start|>Summarize the open issues<|user_end|>
<|assistant_start|>There are 4 open issues...<|assistant_end|>
```

Media is shown as `<<image_media>>`, `<<audio_media>>`, `<<video_media>>`, or `<<file_media>>`. Inspecting an idle, non-bot thread whose last message was aborted or failed deletes that thread.

### `chat_export_thread`

Export a complete thread to a temporary folder, without truncation. **Text** result.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `threadId` | string | Yes | Thread ID. |

```text
Exported thread e5f1... to:
C:\Users\gscat\AppData\Local\Temp\.avi\thread-exports\2026-10-22T16-00-00-000Z-e5f1...

Files: metadata.json, transcript.md, transcript.json, attachments/ (2 files)
Messages: 14 (assistant 7, user 7, system 0)
transcript.md uses BEGIN/END-delimited blocks for ...
```

| File | Content |
| --- | --- |
| `metadata.json` | Thread metadata and the attachment manifest. |
| `transcript.md` | Every message with reasoning, content, tool calls with full arguments and results, and errors, in BEGIN/END-delimited blocks. |
| `transcript.json` | The same transcript as structured data. |
| `attachments/` | Stored media and files, referenced from both transcripts. |

The folder is on the machine running Avi, under the system temporary directory.

## Quick chat

### `quick_chat_invoke`

Run one Quick chat turn and return its final answer. The turn runs with the same tools as the Quick chat window, then the session is discarded: nothing is stored, no thread is created, and no window opens. The request stays open until the turn finishes.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string, min 1 | Yes | Message sent to Quick chat. |
| `model_name` | string | No | Configured model ID. Defaults to the Quick chat model in **Settings → Default models**. |
| `reasoning_effort` | string | No | Effort supported by the model. Defaults to the Quick chat reasoning effort. |

```sh
curl -H "Authorization: Bearer $AVI_KEY" http://127.0.0.1:18992/commands/quick_chat_invoke -d '{"prompt":"What time is it in Tokyo?"}'
```

**Result:**

```json
{
  "text": "It is 01:12 in Tokyo.",
  "model": "openai:gpt-5-mini",
  "toolCalls": [{ "name": "web_search", "status": "completed" }],
  "attachments": [],
  "usage": { "inputTokens": 1840, "outputTokens": 32, "totalTokens": 1872 }
}
```

| Field | Description |
| --- | --- |
| `text` | Final answer, without reasoning or tool blocks. |
| `model` | Model that answered. |
| `toolCalls` | Tools called during the turn, in order, with `completed` or `error`. |
| `attachments` | Metadata of files the tools produced, such as generated images, with their local `path`; inline data is omitted. |
| `usage` | Token usage reported by the provider, or `null`. |

Tools follow the Quick chat window: core tools, MCP servers for the user home folder, plugin and provider tools, and AIVAX tools enabled in Settings. They run with full access and no approvals. `ask_question` is unavailable because nobody can answer it; tools such as `chat_create_thread` can still create threads, and those remain.

**Errors:** blank prompt, no Quick chat model configured, unavailable model, or a failed turn. A failed turn returns its provider error message.

## Related documents

- [Remote Control](Remote%20control.md)
- [Remote MCP API](api/mcp/overview.md)
- [API reference](api/overview.md)
- [Bots](Bots.md)
