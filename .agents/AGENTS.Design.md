---
description: Optional design guidance for Avi's workspace, panels, navigation, settings, composer, and visual philosophy.
embeddable: false
---
# Avi design guide

Read this instruction before designing, reviewing, or changing Avi's renderer UI. Apply it together with `.agents/AGENTS.Renderer.md`; the renderer guide remains authoritative for architecture, accessibility, XCSS, generated styles, and validation.

## Choose the relevant guide

- [Design philosophy](./design/design-philosophy.md): read for every visual or interaction change.
- [Chat workspace](./design/chat-workspace.md): read for conversation layout, messages, empty chat, scrolling, and chat-level states.
- [Chat composer](./design/chat-composer.md): read for prompt entry, attachments, model or mode controls, queueing, and send/stop behavior.
- [Sidebar](./design/sidebar.md): read for primary navigation, conversations, bots, grouping, filters, and collapsed behavior.
- [Auxiliary panels](./design/auxiliary-panels.md): read for the resizable right panel, tabs, side chats, files, tasks, agents, bots, and provider panels.
- [Settings](./design/settings.md): read for configuration navigation, forms, list-detail flows, persistence, validation, and feedback.

Read every guide touched by a cross-surface change. Do not apply one surface's density, hierarchy, or interaction model to another without checking both guides.

## Shared implementation contract

- Ground new work in the existing components under `src/renderer/components/` and the XCSS sources under `src/styles/`.
- Reuse semantic tokens, component families, responsive breakpoints, focus behavior, and established state models before adding variants.
- Preserve mouse and keyboard operation, accessible names, logical focus, reduced motion, and light, dark, built-in, and plugin themes.
- Treat dimensions documented in these guides as current layout contracts. Change them only when the task explicitly requires a layout redesign and validate all affected surfaces together.
- Keep `src/styles/**/*.xcss` authoritative. Never edit `src/renderer/styles.css` directly; regenerate it with `bun run styles` after XCSS changes.
