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
- `chat_inspect_thread` — returns the latest four turns, pending approval IDs, and waiting state without exposing reasoning;
- `chat_list_threads`, `chat_list_thread_context`, and `chat_list_folders` — discover available threads, teams, and folders.

Threads waiting for a structured answer or tool permission report `waiting_for_input`. The direct orchestrator can inspect a sub-agent to find a pending approval ID and approve only that call; it cannot grant a persistent `allow_all` permission, and approval is unavailable in Plan mode. A prioritized message supersedes a pending structured question. Use it for urgent corrections; use low priority for normal coordination.

## Semaphore coordination

Instructions can require agents to protect shared work with an Avi-managed named semaphore. Semaphore names are application-wide: the same name always refers to the same semaphore across every thread, project, folder, and workspace in the running Avi application.

- `sleep_semaphore(name, count, maxCount)` acquires permits immediately when capacity is available. It must be the only tool call in that model round; a mixed round is rejected without executing anything or acquiring permits, and every call in it receives an error result so the agent can resend them separately;
- when capacity is unavailable, Avi stores the thread in a strict FIFO queue, finishes the current inference, and marks the thread with a moon icon;
- the sleeping thread shows the semaphore name and its current queue position;
- **Run now** removes that wait and resumes the agent without granting semaphore permits;
- **Cancel semaphore** removes that wait without resuming the agent;
- `release_semaphore(name, count)` releases permits owned by the current thread and automatically resumes FIFO waiters as capacity becomes available;
- `list_semaphores` reports the current thread's permits and waits plus a global snapshot of every semaphore with its holders and FIFO queue, so an orchestrator can diagnose blocked queues without joining them; `chat_list_thread_context` and `chat_list_threads` also show the permits owned by each visible thread.

A resumed thread receives an internal user message explaining whether permits were granted or the wait was overridden. While a thread owns permits, every inference receives context requiring it to release the exact permits promptly after the protected work, including before reporting a blocker or finishing. If a thread still goes idle without releasing (natural finish with no queued work), Avi automatically releases its owned permits and resumes FIFO waiters; paused runs and semaphore resumes keep their permits until the thread goes idle.

Semaphore owners and wait queues persist in SQLite across Avi restarts. Archiving or deleting a thread removes its waits and owned permits so queued agents cannot remain blocked by a missing thread.

**Settings → Maintenance → Semaphores** lists every semaphore with its holders, held permit counts, and FIFO wait queue. **Reset permits** asks for confirmation, releases all held permits at once, and lets waiting threads acquire permits according to the FIFO queue. Use it to unblock a queue when holders are stuck, for example after a crashed or interrupted run.

## Plan and Ultra teams

In Plan mode, the entire team remains read-only and conversation tools are restricted to the current Plan orchestration team. In Ultra mode, sub-agents receive a specialist contract, while the orchestrator remains responsible for independent critique, correction, fresh validation, and the integrated final result.

## Models and concurrency

See [Default models](Default%20models.md) for model inheritance and Small/Medium/Large levels.

**Settings → Tuning → Orchestration** accepts 1–128 concurrent sub-agents and defaults to 128. Although the UI label says “per thread,” the current implementation counts running sub-agents globally across the Avi process.

## UI and persistence

The **Sub-agents** auxiliary tab shows working, finished, failed, or waiting status. Sub-agent conversations are persisted as child threads in SQLite and appear in team context, but not in the normal Sidebar conversation list.

Archiving or restoring a parent includes its descendants. Permanent parent deletion cascades to child threads. The default disposable-conversation retention policy deletes eligible sub-agent threads after one day.

## Effective orchestration

- delegate distinct, non-overlapping tasks;
- create agents only when independence, coverage, or speed adds value;
- request verifiable evidence and a concise report;
- inspect blockers and share relevant discoveries;
- do not outsource final judgment, integration, or validation.
