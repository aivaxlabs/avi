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
- `chat_interrupt_thread` — interrupts at the next safe boundary without stopping child agents, background processes, or queued prompts;
- `chat_inspect_thread` — returns the latest four turns and waiting state without exposing reasoning;
- `chat_list_threads` and `chat_list_folders` — discover available threads and folders.

A prioritized message supersedes a pending structured question. Use it for urgent corrections; use low priority for normal coordination.

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
