# Avi Plugin API Changelog

## [Canary]

### Added
- **Selectable next bot queue item** — `bot.update({ workQueueIndex })` selects the zero-based Work queue item used by the next activation. Compatibility: Backward compatible; supports API v2.
- **Per-tool forced truncation** — static and runtime tool definitions can set `forcedTruncationLength` as a positive estimated-token output limit that overrides the global tool-output setting. Compatibility: Backward compatible; supports API v2.
- **Theme transparent surfaces** — theme CSS can define `--background-transparent-0` through `--background-transparent-5` for the native Sidebar transparency mode. Compatibility: Backward compatible; supports API v2.
- **Child Processes reference plugin** — demonstrates trusted Node.js process supervision using existing Plugin API v2 storage, panels, settings, and lifecycle APIs; no public API surface was added. Compatibility: Backward compatible; supports API v2.
- **Declarative plugin settings** — plugin definitions can add Avi-rendered settings sections backed by JSON Schema and main-process `getValue`, optional `validate`, and `setValue` handlers. Compatibility: Backward compatible; supports API v2.

### Changed
- **Retry rejection semantics** — `ThreadHandle.retry()` now rejects when no eligible prompt or checkpoint exists instead of returning an idle handle after a successful no-op. Compatibility: Breaking behavior change in API v2's Canary retry revision; the last compatible silent-no-op behavior is API v2 shipped in Avi 0.6.0. This runtime supports API v2 only; successful and already-active retries keep their existing contract.
- **Bot Inbox and Activity contract** — removes `bot.workState.get()` and the old work-item/worker types in favor of `bot.inbox.list/reply/complete`, `bot.activity.list`, dated messages, attachments, and pendency-bound approvals. `bots.readState` reads the new data; `bots.manage` permits replies/completion without granting protected approvals. Compatibility: Breaking in API v2's Canary bot-domain revision; the last compatible old bot-work contract is API v2 shipped in Avi 0.6.0. This runtime still supports API v2 only; existing bot-work integrations must update. Other Plugin API v2 namespaces are unchanged.
- **Persisted user-stop provenance** — `MessageSnapshot.stoppedByUser` identifies messages aborted by an explicit user Stop action. Compatibility: Backward compatible; supports API v2.
- **Provider model instance identities** — `ModelConfig` snapshots now include Avi-managed `instanceId`; configured model `id` values may repeat and continue to be sent unchanged to inference, while catalog `ModelSnapshot.id` is qualified as `providerId:instanceId`. Compatibility: Backward compatible; supports API v2.

### Fixed
- **Fork and activation lifecycle** — copied streaming messages become completed partial-response snapshots; bot activation clears the previous compaction summary and token counter when advancing its history boundary. Compatibility: Backward compatible; supports API v2.
- **Thread fork handles and checkpoints** — `ThreadHandle.fork()` returns a usable handle for the copied conversation and preserves hidden checkpoint boundaries without replaying compacted history. Compatibility: Backward compatible; supports API v2.

---
