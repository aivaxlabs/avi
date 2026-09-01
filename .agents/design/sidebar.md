# Sidebar

## Purpose and anatomy

The sidebar is compact primary navigation, not a dashboard. Preserve this structure:

1. Fixed top: Avi identity, collapse control, New chat, and Quick chat.
2. Scrollable middle: Orchestration, search, bots, conversations, grouping, and filters.
3. Fixed footer: Settings.

Keep the top and footer outside the independently scrolling list. Do not make the entire sidebar one scroll container.

## Dimensions and collapse

- Use `--sidebar-width` with a 222px default and a persisted 180–420px resize range.
- Preserve at least 320px for main content when calculating the maximum width.
- Keep the collapsed column at 58px. At 700px and below, use the existing collapsed desktop layout rather than inventing a drawer.
- In collapsed mode, center visible controls and hide labels, bot lists, conversation groups, and per-conversation actions.
- Any control that remains icon-only after collapse must have an explicit accessible name, tooltip, and visible focus state. Do not rely on a text `<span>` that CSS hides.

## Navigation hierarchy

- Keep New chat and Quick chat prominent at the top; Orchestration and Search are normal navigation actions.
- Separate Bots and Conversations with restrained labels and dividers.
- Keep grouping choices limited to established mental models such as chronology, model, and folder.
- Preserve active navigation with `aria-current` where applicable and a semantic active surface, not color alone.
- Keep Settings in the stable footer location.

## Lists and state

- Use compact rows with ellipsis for titles and paths. Do not wrap rows to accommodate long identifiers.
- Preserve distinct active, hover, menu-open, disabled, running, completed, attention, waiting, sleeping, and unseen states.
- Pair status color with an icon, label, tooltip, or accessible name.
- Keep secondary row actions quiet and reveal them without causing title or age layout shifts.
- Group long conversation lists and retain Show more / Show less behavior rather than rendering an unbounded section.
- Empty and filtered-empty states must explain what is missing and offer recovery when possible.

## Menus and filters

- Reuse `DropdownMenu` and established row-menu patterns for conversation, folder, tag, bot, filter, and snooze actions.
- Portal menus when needed to escape sidebar overflow; clamp them to the viewport.
- Close menus on outside interaction and Escape, restore focus where established, and close position-sensitive menus on resize.
- Use `menuitemcheckbox` and `aria-checked` for toggleable filters.
- Keep destructive actions explicit and separated from routine navigation.

## Resizing and motion

- Reuse `PanelResizer`: a 9px pointer target with a 1px visual rule, `role="separator"`, and keyboard support.
- Preserve 16px arrow steps, 48px Shift+arrow steps, and Home/End minimum/maximum behavior.
- Disable grid transitions and text selection during drag.
- Stop spinner and non-essential transitions under `prefers-reduced-motion`.

## Visual language

- Use transparent or theme surfaces through semantic tokens; preserve the platform-specific transparency behavior.
- Keep 13px compact navigation typography and subdued section labels.
- Use hover and active surfaces from the sidebar token aliases; do not introduce feature-local palette colors.
- Maintain stable scrollbar gutter and a thin, discoverable scrollbar.

## Source anchors

Use `src/renderer/components/Sidebar.jsx`, `src/renderer/components/PanelResizer.jsx`, `src/renderer/App.jsx`, `src/styles/components/sidebar.xcss`, and `src/styles/layout.xcss`.
