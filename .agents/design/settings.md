# Settings

## Purpose and hierarchy

Settings is a focused management workspace. Preserve this page structure:

1. Left navigation with Back, search, grouped destinations, and the current page state.
2. Main page header with one title, concise description, and an optional page-level action.
3. Scrollable content constrained to 768px.
4. Grouped sections using headings plus card or row-card families.
5. Persistent footer actions only for views with explicit save or destructive actions.

Keep `SettingsPage` responsible for top-level navigation, drafts, persistence coordination, and page status. Keep feature-specific presentation in focused settings components.

## Layout contract

- Preserve the two-column shell: 240px navigation, 210px at 860px and below, and 176px at 700px and below.
- Keep main header and content aligned to the same centered `min(768px, 100%)` measure.
- Reduce page padding at existing 860px and 700px breakpoints instead of compressing controls below usable sizes.
- Keep header and footer outside the content scroller.
- Use list-detail navigation and inline Back actions for deeper editors rather than nesting every configuration on one page.

## Sections, cards, and rows

- Use `.settings-section` with a heading and optional explanatory sentence.
- Use `.settings-section-card` for one coherent configuration group.
- Use `.settings-row-card` for related settings that read as rows, with separators instead of independent floating cards.
- Do not wrap every label, metric, or action in a card. Let spacing and typography carry hierarchy.
- Keep routine row actions at the trailing edge and separate destructive actions from save or navigation actions.

## Forms

- Use native `label`, `input`, `textarea`, `select`, `button`, and `fieldset` semantics.
- Give every control a visible label and place help text next to the affected field.
- Preserve the established field relationship: label and help on the left, control on the right; stack complex controls at the existing narrow breakpoints.
- Keep standard controls at the established 32–34px height and use semantic surfaces, borders, and visible focus.
- Use monospaced text only for paths, identifiers, commands, code, and secrets that are intentionally displayed.
- Do not use placeholder text as the only label or validation guidance.

## Persistence and feedback

- Maintain local drafts for multi-field configuration and save through an explicit action.
- Immediate application is appropriate only for established previewable preferences such as appearance; make that behavior clear.
- During asynchronous work, disable conflicting actions, prevent duplicate submission, and change nearby copy to `Saving...`, `Testing...`, or the specific operation.
- On failure, keep entered values, set `aria-invalid` where applicable, and show actionable error text with `role="alert"` near the affected scope.
- Include intentional loading, empty, no-results, disabled, validation, saved, and error states.
- Validate in the renderer for immediate guidance and again at the privileged boundary for authority.

## Navigation and search

- Use `aria-current="page"` for the active destination and a matching active surface distinct from hover. In Cascadium, attach state selectors to the control with `&.active` and `&:hover`; do not use descendant forms such as `& .active` or `& :hover`.
- Attach status modifiers to the status element itself, for example `.settings-status.enabled` or `&.enabled`; do not target nonexistent descendant modifiers.
- Group navigation by user mental model and separate groups with restrained dividers.
- Search should filter destinations or settings predictably and show a recoverable no-results state.
- Keep page-level actions in the header; keep save/cancel/delete in the footer or the affected editor, not scattered through unrelated sections.

## Responsive and accessibility rules

- Preserve logical reading and tab order when fields stack.
- Keep focus rings visible and outside clipped containers.
- Use accessible names for icon-only actions and proper menu or dialog semantics for overlays.
- Keep irreversible operations explicit and confirmed when recovery is difficult.
- Color may reinforce validation or danger but cannot be the only signal.
- Do not make status badges hidden at narrow widths the only status indication.

## Source anchors

Use `src/renderer/components/SettingsPage.jsx`, representative focused components in `src/renderer/components/*Settings.jsx`, and `src/styles/components/settings.xcss`.
