# Auxiliary panels

## Reuse the shell and state owner

Use `src/renderer/components/AuxiliaryPanel.jsx` for persistent contextual work beside chat, not a new sidebar or large popover. Reuse existing bodies such as `FilesPanel`, `GitReviewPanel`, `NotesPanel`, `ProviderPanel`, and `ChatView compact` before adding a panel type.

`App.jsx` owns visibility, active tab, open-tab flags, side-chat/sub-agent/provider data, and persisted width. `AuxiliaryPanel` composes the tabs and bodies and keeps local interaction state, including bot views; it is not a generic `tabs`/`children` container or a separate navigation store.

For a new built-in tab, follow a comparable tab end to end:

1. Add only the necessary open/active state and callbacks in `App`.
2. Integrate tab identity, label/icon, add-menu availability, activation, and close dispatch in `AuxiliaryPanel`.
3. Render the focused body with its own data and callbacks. Preserve existing active-tab fallback when closing; hiding the panel and closing a tab are different actions.
4. Check reopen behavior and project/conversation changes. Do not assume tab persistence merely because panel width is persisted.

Provider contributions use the existing provider-panel path and `ProviderPanel`; do not register a second shell. Compact conversations use the [chat pipeline](./chat-workspace.md) with the correct conversation identity, draft, model, and runtime callbacks.

## Anatomy and containment

Keep the resizable right-hand `aside`, fixed 44px tab header, optional 38px contextual toolbar, and independently scrollable body. Nested complex views own their content scrolling without moving the shell header. Preserve `min-width: 0` and `min-height: 0` throughout grid/flex descendants.

The current layout uses `--auxiliary-panel-width`, roughly 42% by default and 50% at 860px and below, with a 280px panel minimum and at least 320px reserved for main content. `App` calculates and persists resize bounds. Reuse `PanelResizer` in the existing inverse direction: dragging left grows the right panel. Keep its separator label, controlled ID, values, pointer capture, and 16px arrow / 48px Shift+arrow / Home–End behavior. The closed-panel opener remains 32×32px.

## Tabs and add menu

Tabs stay on one horizontally scrolling row with icon, truncated label, optional operational indicator, and a separate close button. Retain the shared active `tabpanel`, matching tab/panel IDs, `aria-selected`, `aria-controls`, and `aria-labelledby` relationships. Only the active tab is in normal tab order; the current tab handler cycles with Left/Right Arrow. Do not describe the resizer's Home/End behavior as already implemented for tabs.

The 30×30px add control opens the existing compact menu, focuses its first enabled item, and returns focus on Escape. Follow [Overlays](./overlays.md) when changing its behavior; `DropdownMenu` alone supplies no focus logic. Keep unavailable choices disabled with an explanation when useful. Distinguish Close tab from Close panel in labels and behavior.

## Content and validation

Keep loading, empty, no-results, waiting, permission, and error states inside the affected body. Empty panels explain their purpose and offer real actions, not decorative cards. Provider content retains provenance and actionable failure/limit information. Truncate header/toolbar labels rather than wrapping; disclose secondary actions before hiding essential ones.

For affected tabs, check add, activate, close active/inactive tab, hide/reopen panel, keyboard focus, narrow width, and pointer/keyboard resizing. Verify body scrolling does not move the header or steal conversation scrolling. Styles: `src/styles/components/auxiliary-panel.xcss` and `src/styles/layout.xcss`; themes, motion, and general validation follow the Renderer guide.
