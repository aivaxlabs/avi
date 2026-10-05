# Sub-agents

Sub-agents are focused child threads delegated by an orchestrator. They can work in parallel, keep separate context, and report results back to their parent thread.

## Creation

The orchestrator uses `chat_spawn_subagent` with a self-contained task. The tool returns a thread ID immediately while the sub-agent continues asynchronously.

Rules:

- only a normal orchestrator thread can spawn sub-agents;
- side chats and sub-agents cannot spawn nested sub-agents;
- the prompt should include the objective, scope, acceptance criteria, relevant context, available tools, and expected evidence;
- automatic names include Euclid, Archimedes, Pythagoras, and others;
- the child does not copy the parent’s full history or checkpoint.

When a sub-agent completes or fails, Avi automatically steers a `<subagent_report>` back to the parent.

## Coordination tools

- `chat_send_prompt` — sends a prioritized message by default; `low_priority` queues it behind active work;
- `chat_approve_tool_call` — allows a direct orchestrator to approve one pending tool call in its sub-agent by approval ID;
- `chat_interrupt_thread` — interrupts at the next safe boundary without stopping child agents, background processes, or queued prompts;
- `chat_inspect_thread` — returns the latest four turns, pending approval IDs, and waiting state without exposing reasoning, and truncates long output;
- `chat_export_thread` — writes the entire thread to a temporary folder (`metadata.json`, a delimited `transcript.md`, a structured `transcript.json`, and an `attachments/` folder) with full reasoning, content, tool calls, complete arguments, results, and media, and nothing truncated. Use it only when `chat_inspect_thread` cannot provide the needed detail, then open the files with `read_file`;
- `chat_list_threads`, `chat_list_thread_context`, and `chat_list_folders` — discover available threads, teams, and folders;
- `sleep(seconds, releaseTriggers?)` — waits 5–3600 seconds in the current conversation, then reports this conversation's terminals and direct sub-agents.

`releaseTriggers` accepts up to 20 strings. The sleep ends at the timeout or as soon as any trigger is satisfied, including one already satisfied when the call starts; the result reports `Released by: <trigger>` or `Released by: timeout`. Invalid or unknown triggers fail before waiting. Conditions are checked every 500 ms.

| Trigger | Released when |
| --- | --- |
| `after_thread_stop:<thread_id>` | The thread is not running, not waiting for input, and not waiting for a semaphore. |
| `after_thread_input_required:<thread_id>` | The thread waits for a structured answer or a tool approval. |
| `after_subagents_stop` | Every direct sub-agent of the current conversation has stopped. |
| `after_process_killed:<terminal_id\|pid>` | The `run_in_terminal` execution has exited, or the given OS process ID no longer exists. |
| `after_process_output:<terminal_id\|pid>` | The `run_in_terminal` execution printed output after the sleep started. |
| `after_process_input_required:<terminal_id\|pid>` | Heuristic: the running `run_in_terminal` execution has been silent for 1.5 seconds and its last output does not end with a newline, as in an interactive prompt. |

Only `after_process_killed` accepts a PID outside Avi's terminals; the other process triggers require a terminal started by `run_in_terminal`, identified by terminal ID or its shell PID.

Threads waiting for a structured answer or tool permission report `waiting_for_input`. The direct orchestrator can inspect a sub-agent to find a pending approval ID and approve only that call; it cannot grant a persistent `allow_all` permission, and approval is unavailable in Plan mode. A prioritized message supersedes a pending structured question. Use it for urgent corrections; use low priority for normal coordination.

## Semaphore coordination

Instructions can require agents to protect shared work with an Avi-managed named semaphore. Semaphore names are application-wide: the same name always refers to the same semaphore across every thread, project, folder, and workspace in the running Avi application.

- `sleep_semaphore(name, count, maxCount)` acquires permits immediately when capacity is available. It must be the only tool call in that model round; a mixed round is rejected without executing anything or acquiring permits, and every call in it receives an error result so the agent can resend them separately;
- when capacity is unavailable, Avi stores the thread in a strict FIFO queue, finishes the current inference, and marks the thread with a moon icon;
- the sleeping thread shows the semaphore name and its current queue position;
- **Run now** removes that wait and resumes the agent without granting semaphore permits;
- **Cancel semaphore** removes that wait without resuming the agent;
- `release_semaphore(name, count)` releases permits owned by the current thread and automatically resumes FIFO waiters as capacity becomes available;
- `update_semaphore_status(name, status, summary)` marks an owned semaphore `blocked` only when a concrete condition requires user intervention, or returns it to `active` after that blocker is resolved;
- `list_semaphores` reports the current thread's permits and waits plus a global snapshot of every semaphore with its holders, blocked details, explicit waiting count, and FIFO queue, so an orchestrator can diagnose blocked queues without joining them; `chat_list_thread_context` and `chat_list_threads` also show the permits owned by each visible thread.

A resumed thread receives an internal user message explaining whether permits were granted or the wait was overridden. While a thread owns permits, every inference receives context requiring it to release the exact permits promptly after the protected work. If a thread finishes a turn without releasing, Avi sends one invisible continuation with the number of waiting threads and asks the agent to release completed work or mark the semaphore blocked. It does not repeat the same hook until new user input arrives. If a granted waiter cannot resume, Avi retains its permit and marks that holder blocked instead of releasing it automatically. Avi no longer releases permits automatically when a thread becomes idle; blocked holders remain visible with a warning icon until the agent releases the permits, clears the blocker, the user resets the semaphore, or the thread is archived or deleted.

Semaphore owners and wait queues persist in SQLite across Avi restarts. Archiving or deleting a thread removes its waits and owned permits so queued agents cannot remain blocked by a missing thread.

**Settings → Maintenance → Semaphores** lists every semaphore with its holders, held permit counts, and FIFO wait queue. **Reset permits** asks for confirmation, releases all held permits at once, and lets waiting threads acquire permits according to the FIFO queue. Use it to unblock a queue when holders are stuck, for example after a crashed or interrupted run.

Messages sent by `chat_send_prompt` are persisted and delivered inside a `<cross-message>` envelope. Avi supplies `from_thread_id`, `from_role` (the source thread type: `thread`, `subagent`, `side`, `rubber_duck`, or `bot`), and `from_name` when a title is available. Attribute values are escaped. The envelope explicitly identifies agent-to-agent coordination, not a user instruction or a change to the user's request. This applies to prioritized and queued messages and survives history reconstruction. Existing messages are not rewritten.

Automatic final/error reports also persist `fromAgent: true` and identify themselves as sub-agent reports, not user instructions. When reconstructing model input (including retries), Avi wraps every persisted `fromAgent` user-role message in an `<agent_message>` notice. The transport role remains `user` for provider compatibility; it does not represent human authorship. Attachments and the original source envelope are preserved. Existing rows are not migrated: previously flagged messages gain the model-only notice, but old unflagged final reports are not retroactively reclassified.

Calls without a source thread, such as global MCP calls, use `from_thread_id="external"` and `from_role="external_agent"`, with no name. The caller cannot supply origin fields through the tool arguments.

## Plan and Ultra teams

In Plan mode, the entire team remains read-only and conversation tools are restricted to the current Plan orchestration team. In Ultra mode, sub-agents receive a specialist contract, while the orchestrator remains responsible for independent critique, correction, fresh validation, and the integrated final result.

## Models and concurrency

See [Default models](Default%20models.md) for model inheritance and Small/Medium/Large levels.

**Settings → Tuning → Orchestration** accepts 1–128 concurrent sub-agents and defaults to 128. Although the UI label says “per thread,” the current implementation counts running sub-agents globally across the Avi process.

**Rubber Duck max turns** in the same section bounds each rubber-duck analysis. A running analysis appears as its own inspectable child thread in the auxiliary Sub-agents panel, and its critique is reported back to the conversation without automatic follow-up work.

The supervisor's questions are answered by the subject agent in a separate interview thread (`rubber_duck_subject`) that also appears in the Sub-agents panel. That thread starts from the subject thread's history and runs as a normal chat with the subject's model, instructions, skills, MCP servers, and tools, so it can inspect files, diffs, and threads before answering. Its context states that a Rubber Duck supervisor is interviewing it and that it must not change anything: no edits, state-changing commands, data mutations, or thread coordination. Tool approvals still follow the permission mode of the conversation that invoked the Rubber Duck. Each Rubber Duck reuses one interview thread, so later answers build on earlier ones.

## UI and persistence

The **Sub-agents** auxiliary tab shows working, finished, failed, or waiting status. Opening a parent lists its sub-agents and Rubber Ducks without loading their histories; selecting one loads its recent messages and fetches older pages as you scroll upward. Compact child-thread composers omit workspace and Git branch controls. These operational indicators continue updating while the panel is closed without re-rendering the main conversation for text-only sub-agent streaming updates. Sub-agent conversations are persisted as child threads in SQLite and appear in team context, but not in the normal Sidebar conversation list.

Archiving or restoring a parent includes its descendants. Permanent parent deletion cascades to child threads. The default disposable-conversation retention policy deletes eligible sub-agent threads after one day.

## Effective orchestration

- delegate distinct, non-overlapping tasks;
- create agents only when independence, coverage, or speed adds value;
- request verifiable evidence and a concise report;
- inspect blockers and share relevant discoveries;
- do not outsource final judgment, integration, or validation.
