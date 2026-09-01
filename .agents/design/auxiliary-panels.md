# Auxiliary panels

## Purpose and anatomy

The auxiliary panel holds contextual work alongside the main conversation. It must support the primary task rather than duplicate the main workspace.

Preserve this hierarchy:

1. Resizable right-hand `<aside>`.
2. Fixed 44px header with open tabs, add-tab menu, and panel close action.
3. Optional contextual toolbar.
4. One independently scrollable content region.

Use existing panel types for side chats, files, Git review, tasks, sub-agents, bots, and provider contributions before creating a new shell.

## Sizing and containment

- Use `--auxiliary-panel-width`; default to roughly 42% of remaining workspace and roughly 50% at 860px and below.
- Enforce a 280px panel minimum and preserve at least 320px for main content.
- Keep `min-width: 0`, `min-height: 0`, and explicit overflow ownership throughout nested grid and flex content.
- Persist user resize and reuse `PanelResizer` with inverse direction: dragging left grows the panel.
- When closed, retain the fixed 32×32px open control in the upper-right workspace area.

## Tabs

- Keep tabs in one horizontally scrollable row with icon, truncated label, optional operational indicator, and a separate close action.
- Use `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, and `aria-labelledby` consistently.
- Keep only the active tab in normal tab order and preserve circular Left/Right Arrow focus navigation.
- Use `--item-active` for the active surface and `--item-hover` for hover; text tone alone is insufficient.
- Never combine tab activation and closing into one ambiguous click target.

## Add and close behavior

- Keep the add control at 30×30px with an accessible name, popup semantics, and expanded state.
- Use the established compact menu; focus the first enabled item when it opens.
- Escape closes the menu and returns focus to the add control.
- Keep unavailable panel types visible but disabled when the explanation helps; expose the reason in text or tooltip.
- Keep close-panel separate from close-tab, with specific labels for both.

## Content states

- Provide intentional loading, empty, no-results, disabled, waiting, error, and permission states inside the affected panel.
- Empty panels should explain their purpose and offer a small set of real button actions; avoid decorative empty cards.
- Complex views own their internal scrolling and may add a 38px contextual toolbar without moving the panel header.
- Provider panels must retain provenance and actionable error or limit information.
- Compact chats reuse `ChatView` and `Composer`; do not build a separate message interaction model.

## Visual and responsive behavior

- Use semantic background and border tokens to distinguish the panel from chat with one restrained vertical boundary.
- Keep tab and toolbar labels at compact sizes and truncate long labels.
- Do not wrap tabs, headers, or toolbars onto multiple lines.
- Use the shared horizontal entrance motion only to clarify where the panel came from; remove it under `prefers-reduced-motion`.
- Do not let a narrow panel hide essential actions; progressively disclose secondary controls instead.

## Resizer accessibility

- Preserve the vertical separator's label, controlled panel ID, min/max/current values, and focus ring.
- Preserve pointer capture and keyboard resize: Arrow keys 16px, Shift+Arrow 48px, Home minimum, End maximum.
- Keep the visual rule narrow while retaining the larger interactive target.

## Source anchors

Use `src/renderer/components/AuxiliaryPanel.jsx`, `src/renderer/components/PanelResizer.jsx`, `src/renderer/components/ProviderPanel.jsx`, `src/renderer/App.jsx`, `src/styles/components/auxiliary-panel.xcss`, and `src/styles/layout.xcss`.
