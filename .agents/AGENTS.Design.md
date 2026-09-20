---
description: Design Avi UI by reusing existing dropdowns, dialogs, popovers, auxiliary tabs, settings pages, and chat components.
embeddable: false
---
# Avi design guide

Use for designing, reviewing, or changing Avi's renderer UI. Read with [Renderer guide](./AGENTS.Renderer.md), which owns architecture, accessibility, themes, XCSS, and validation requirements. A review is read-only unless changes are requested.

## Choose the existing surface

| Need | Reuse / read |
|---|---|
| Short action menu, nested flyout, contextual popover, or modal | [Overlays](./design/overlays.md): `DropdownMenu`, specialized dialogs, and caller-owned behavior |
| Persistent context beside chat or a new auxiliary tab | [Auxiliary panels](./design/auxiliary-panels.md): `AuxiliaryPanel`, `PanelResizer`, and existing panel bodies |
| Configuration page or editor | [Settings](./design/settings.md): `SettingsPage`, focused settings components, and section/row families |
| Conversation content, history, empty chat, or inline run state | [Chat workspace](./design/chat-workspace.md): `ChatView`, `Message`, and rich-content pipeline |
| Prompt entry, attachments, pickers, queues, or send/stop | [Chat composer](./design/chat-composer.md): `Composer` and its existing controls |
| Primary navigation, conversation/bot rows, grouping, or filters | [Sidebar](./design/sidebar.md): `Sidebar` and established row menus |
| Visual hierarchy, density, or a proposed new visual treatment | [Design philosophy](./design/design-philosophy.md) |

Read only the guides for affected surfaces. For example, adding an action menu to a panel needs panels and overlays, not every design reference.

## Reuse means implementation reuse

1. Inspect the existing component, a comparable caller, and its XCSS before editing. Source paths in the guides are relative to the repository root.
2. Use exported components and their props first. Where only a markup/class family exists, follow that structure and keep behavior in the existing owner. Do not invent a generic component API or copy feature-specific persistence into another surface.
3. Reuse classes and semantic tokens, not their resolved CSS values. A renamed selector reproducing an existing control is duplication, not reuse.
4. Add a local variant only for a concrete unmet requirement; state the gap briefly. Do not introduce a wrapper, dependency, parallel state model, or broad refactor merely to make reuse look uniform.

Documented dimensions describe current layout contracts, not universal design constants. Preserve them unless the task explicitly requires redesign; validate affected surfaces together when they change. Existing examples are evidence of structure, not proof that every accessibility or dismissal requirement is already implemented.
