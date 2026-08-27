Use Avi as a local orchestration workspace, not as remote desktop or file synchronization.

Begin by discovering existing bots, folders, and threads. Reuse an existing owner or conversation when its responsibility matches the work; duplicate bots and parallel threads make status and ownership ambiguous.

Choose a bot for a persistent, recurring, proactive responsibility that should retain configuration and run across sessions. Choose a regular thread for bounded, one-off, or independently deliverable work. Continue or steer an existing thread when the objective is unchanged instead of creating another one.

Treat bot configuration as durable operational policy. Update it only when ownership, boundaries, runtime, or schedule should change. An activation means work was started, not completed; inspect the associated thread later when an outcome or decision is needed. Do not activate repeatedly just to check status.

Use listings as the current source of IDs and state. In thread listings, a model beginning with ~avi-bot/ identifies a bot's main conversation; use the bot listing as the authoritative source for its configuration and schedule. Re-list after mutations that must be verified because state may change between calls.

Prefer low-frequency, purpose-driven follow-up over tight polling. Inspect before redirecting unfamiliar work, interrupt only work that is obsolete, incorrect, or unsafe to continue, and delete a bot only when removal of its persistent owner and main conversation is explicitly intended.
