# Avi Plugin API Changelog

## [Canary]

### Added
- **Child Processes reference plugin** — demonstrates trusted Node.js process supervision using existing Plugin API v2 storage, panels, settings, and lifecycle APIs; no public API surface was added. Compatibility: Backward compatible; supports API v2.
- **Declarative plugin settings** — plugin definitions can add Avi-rendered settings sections backed by JSON Schema and main-process `getValue`, optional `validate`, and `setValue` handlers. Compatibility: Backward compatible; supports API v2.

### Changed
- **Provider model instance identities** — `ModelConfig` snapshots now include Avi-managed `instanceId`; configured model `id` values may repeat and continue to be sent unchanged to inference, while catalog `ModelSnapshot.id` is qualified as `providerId:instanceId`. Compatibility: Backward compatible; supports API v2.

---
