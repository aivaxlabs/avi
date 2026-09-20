# Settings

## User orientation and hierarchy

The user must be able to answer: **Where am I? What am I configuring? What will this change affect? Has it been saved?** Use this contract for new and revised settings flows; it is a target standard, not a claim that every existing screen already complies.

Keep one consistent hierarchy:

1. **Destination:** sidebar navigation identifies the configuration area and selected page.
2. **Page:** one title names the task or resource, followed by a short description of its purpose and scope. In a detail editor, identify the resource and provide Back to its list.
3. **Optional tabs:** sibling views within that page, only when meaningful groups cannot remain clear as sections.
4. **Section:** a concise heading and, only when needed, a sentence explaining the group or its consequences.
5. **Group and field:** one coherent card or row family; each field has a visible label, nearby help, its control, and local validation.
6. **Actions and feedback:** local operations beside their target; page-level persistence in the common footer.

Do not repeat the page title as a tab, section, and card heading. Use stable labels and ordering across related pages; avoid unexplained technical names, icon-only configuration actions, or helper text that merely repeats the label. Explain non-obvious units, defaults, prerequisites, effect scope, and whether a change applies immediately, after saving, or after restart. Keep the visible label associated with its control and help/error text programmatically connected where applicable.

## Extend the management shell

`src/renderer/components/SettingsPage.jsx` owns top-level navigation, the page header, and coordination for its built-in editors. Add a destination within that shell rather than creating a second settings layout. Inspect a comparable destination's navigation entry, search keywords, header, content branch, Back behavior, and applicable footer together.

State ownership is not uniform:

- Provider/model/router and built-in preference editors use the page's draft/save coordination.
- `AppearanceSettings` receives controlled appearance/desktop callbacks; established previews apply immediately.
- `RemoteSettings`, `PluginsSettings`, `AivaxFeaturesSettings`, and `MaintenanceSettings` manage their own feature behavior and asynchronous state. MCP receives navigation callbacks through its existing integration.

Extend the relevant owner rather than moving all feature state into `SettingsPage` or introducing a parallel store. Read the actual save path before choosing draft versus immediate application; do not infer autosave from appearance settings.

## Reuse markup and class families

These are CSS/markup families, not exported React components:

| Role | Existing structure |
|---|---|
| Shell | `.settings-page`, navigation, `.settings-main` |
| Page title and action | `.settings-page-header` |
| Scrollable body and reading measure | `.settings-content` > `.settings-content-inner` |
| Coherent configuration group | `.settings-section`, `.settings-section-heading`, `.settings-section-card` |
| Form controls | `.settings-form`, following a comparable field's label/help/control structure |
| Related rows with separators | `.settings-section-card.settings-form.settings-row-card` |

Do not create a card per label, metric, or button. Keep routine row actions trailing and destructive actions separate. Use native labeled inputs, selects, textareas, buttons, and fieldsets; reserve monospaced text for technical values. Standard controls retain their 32–34px height. For menus and dialogs, use [Overlays](./overlays.md), not settings-specific imitations.

## Layout and navigation

Preserve the 240px navigation column, 210px at 860px and below, and 176px at 700px and below. Header/content share a centered `min(768px, 100%)` measure. Reduce padding at existing breakpoints and stack complex fields without disrupting reading/tab order. Keep header and applicable page footer outside the content scroller; deeper editors use list-detail navigation and inline Back actions.

Keep navigation destinations distinct from internal tabs: sidebar links change configuration area, Back leaves a detail editor, and tabs switch peer views of the same resource. Do not use tabs as action buttons, filters, wizard steps, or a second sidebar.

Current navigation search matches substrings against manually maintained keyword strings. Include a new destination in that path; do not describe it as a structured full-settings search or assume it supplies a no-results state. If changing search, make zero matches recoverable and define what is being searched.

## Save placement and behavior

For draft-based configuration pages, use **one page-level Save action in `.settings-actions`, outside the content scroller**, with status/error text on the leading side and the primary button at the trailing edge. Preserve that location across destinations and tabs, including narrow layouts. Do not duplicate Save in the page header, individual cards, or each tab. Modal editors keep their own action in the dialog footer, not the underlying page footer.

The footer belongs to the shell visually, but saving stays with the existing state owner. `SettingsPage` coordinates provider/model/router/general/tuning/personalization/default-model saves. `KeyboardShortcutSettings` in `KeyboardShortcuts.jsx` portals its own actions into the shell's footer through the `footer` prop; this is an existing example of consistent placement without centralizing feature persistence. Self-contained editors should follow the same placement contract when revised, without moving unrelated state or creating a second Save action.

- **Scope:** Save commits the current page/resource draft, including changes in its inactive tabs, never unrelated destinations. Default to `Save changes`; use `Save provider` or another resource label only when it clarifies scope. Keep labels stable rather than changing them with the selected tab.
- **Unchanged:** disable Save when there are no pending changes. A new resource may be saved once its required initial data is valid. Show unsaved status when a draft differs from the last confirmed saved values.
- **Invalid:** explain what prevents saving near the fields and in footer feedback. Use `aria-invalid`; do not leave a disabled button unexplained. Validate all tabs, reveal the tab containing the first error, and focus its field. Renderer validation does not replace validation at the privileged boundary.
- **Saving:** change the action to `Saving...`, prevent duplicate submissions and conflicting operations, and protect the submitted draft from edits that could be incorrectly marked as saved. Keep the footer stable and accessible while waiting.
- **Success:** show `Saved` or a concise success status only after persistence confirms success; update the saved baseline from the confirmed values. Announce status politely. A subsequent edit clears the saved indication and enables Save again. Do not navigate away except for an established create/detail transition.
- **Failure:** preserve the draft and selected context, show an actionable `role="alert"` error, and allow retry. Do not clear dirty state or report success after a partial failure; identify what remains unsaved.
- **Leaving:** changing tabs preserves the shared draft without saving or discarding. When leaving a dirty page/resource, retain recoverable drafts or offer an explicit Save / Discard / Stay decision if navigation would lose them. Do not silently reset input. Discard/Cancel, when provided, is secondary and restores the confirmed baseline or exits the editor; destructive resource actions remain separate.

For established immediate-application preferences such as appearance, say that changes apply automatically and do not add a misleading Save button. Distinguish a temporary preview from a persisted value. On a page mixing previewable and deferred settings, identify each scope and let Save cover only pending changes. Test, Connect, Refresh, Install, Reset, and Delete are local operations, not substitutes for Save; show their own progress and consequences. Do not render an empty action footer on read-only or fully immediate pages.

## Internal tabs

Use tabs only for a small, stable set of peer groups within one destination. Prefer ordinary sections when the controls benefit from being read together; avoid nested tab bars. Place one tab row below the page header and above the sections it controls, with concise text labels and the same selected/hover/focus treatment across Settings.

Reuse the `.maintenance-tabs` family in `src/styles/components/settings.xcss` despite its historical name. The model-settings tabs in `SettingsPage.jsx` demonstrate the existing `tablist` / `tab` / `tabpanel` structure, IDs, `aria-controls`, `aria-labelledby`, `aria-selected`, roving tab order, Left/Right Arrow, and Home/End navigation. This is a markup/style pattern, not an exported Tabs component. Preserve hidden panels' inaccessibility and draft state; do not create new visual tab families for each feature.

Tab changes must not reset fields, trigger persistence, or change the footer's save scope. Keep the active tab obvious without relying only on color. If validation fails in an inactive tab, make that group discoverable and reveal the error instead of showing an unexplained page-level failure. At narrow widths, keep labels legible and the active/focused tab reachable through a controlled single-row overflow rather than clipped controls or a second line of tabs.

## State selectors and checks

Use `aria-current="page"` for the active destination and an active surface distinct from hover. Attach Cascadium modifiers to the element: `&.active`, `&:hover`, and `.settings-status.enabled` / `&.enabled`. Existing descendant forms such as `& .active`, `& :hover`, and `& .enabled` do not match same-element states and must not be copied as correct patterns. Correct affected selectors when implementing the relevant UI change, not through an unrelated stylesheet refactor.

Check that a user can identify the page/resource, effect scope, and saved/unsaved state without guessing. Exercise navigation/search/Back, dirty-page exit, tab keyboard navigation and draft retention, validation in inactive tabs, save across tabs, successful and failed persistence, duplicate-action prevention, and immediate preview only where applicable. Confirm the footer stays in the same location without duplicate Save controls. Include empty, loading, disabled, validation, and saved states touched by the change. Verify narrow layout and keyboard focus through the actual component, not only a static mock. Source styles: `src/styles/components/settings.xcss`; general accessibility, themes, and renderer validation remain in the Renderer guide.
