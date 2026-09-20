# Dropdowns, flyouts, popovers, and modals

## Choose by interaction, not appearance

| Interaction | Existing implementation |
|---|---|
| Short list of actions or choices | `DropdownMenu` + `DropdownMenuItem` from `src/renderer/components/DropdownMenu.jsx` |
| Nested choices beside a menu (flyout/flyover) | Composer's model/reasoning submenu structure and `.model-reasoning-submenu` family |
| Small non-modal contextual detail | `Message.jsx` response-usage popover; adapt its structure only for comparable content |
| Search, preview, multi-step editing, or confirmation | Reuse the matching feature dialog: `ModelPicker`, `SearchDialog`, `ContextUsageDialog`, `WorkspaceDialog`, `TagsManagerDialog`, or `BotSettingsDialog` |
| Persistent work beside the conversation | [Auxiliary panel](./auxiliary-panels.md), not a large temporary popover |

There is no generic `Modal`, `Popover`, or `Flyover` component. Specialized dialogs are reusable for their own domain, not shells for unrelated content. Follow their markup/style families when a genuinely new dialog is needed; do not add a general overlay framework as part of an ordinary feature.

## Dropdown contract

`DropdownMenu` accepts `children`, `className`, `style`, `fixed`, a forwarded ref, and DOM props. It renders a `div`; `fixed` only adds the fixed-position class. It does **not** portal, calculate position, manage open state, dismiss, move focus, or implement keyboard navigation.

`DropdownMenuItem` renders a `button type="button"`, with optional `icon`, `active`, `className`, and DOM props such as `disabled`, `onClick`, and ARIA attributes. Its children sit inside a label `span`; do not nest interactive controls inside it. `active` is visual, not an ARIA selection state.

Reuse `src/styles/components/dropdown-menu.xcss`, including `.dropdown-menu-divider`, `.dropdown-menu-label`, and `.dropdown-menu-empty`. Feature styles should add only required placement or layout differences.

The caller owns:

- Open state, trigger ref, `aria-haspopup`, and `aria-expanded`.
- Appropriate roles: `menu`/`menuitem` for application actions; `menuitemcheckbox` or `menuitemradio` with `aria-checked` for checked choices. A searchable form is not a menu merely because it floats.
- Initial focus, Arrow Up/Down and Home/End navigation skipping disabled items, Escape, and focus return. Do not steal focus back after an outside click that deliberately focuses another control.
- Closing on selection and outside pointer interaction; closing or repositioning when scrolling/resizing invalidates the anchor; listener cleanup.
- Trigger-bound positioning, available height, and viewport containment. Use `createPortal(..., document.body)` with `fixed` when ancestors clip the menu; increasing `z-index` alone cannot escape clipping.

For a complete local example, inspect `src/renderer/components/FileReferenceMenu.jsx`: its `useFileReferenceMenu(onOpen, onAction)` provides file-reference actions, portal placement, keyboard handling, and Escape focus return. Reuse that hook for file references, not arbitrary menus. Its numeric position bounds are specific to that menu's content; measure or constrain a different menu rather than copying those bounds.

## Flyouts and contextual popovers

Composer's `useSubmenuFlip` is local, not an exported positioning utility. It toggles `.flip-left` when a submenu crosses the right edge; it does not solve vertical overflow or the whole keyboard/dismissal contract. Preserve submenu reachability by keyboard and pointer, and test both opening directions in a narrow window.

The response-usage popover in `Message.jsx` is a non-modal `role="dialog"` with an accessible name, not an application menu. Keep informational content as semantic text, lists, or a definition list; do not render it as fake menu items or trap focus as though it were modal. Check dismissal, focus movement, and clipping for the actual trigger location. Substantial content belongs in a dialog.

## Modal contract and limitations

Two implementations coexist:

- `WorkspaceDialog.jsx` uses a portaled native `<dialog>`, `showModal()`, `onCancel`, and opener-focus restoration. Inspect its lifecycle when native modal behavior fits; retain its `::backdrop` styling rather than wrapping it in another backdrop.
- Other dialogs use `.dialog-backdrop`, a named `role="dialog"` / `aria-modal="true"` surface, `.dialog-header`, a feature body, and `.dialog-footer`. Shared styles are in `src/styles/components/dialog.xcss` and `src/styles/layout.xcss`; feature sizing remains in its own family.

CSS, a portal, and `aria-modal` do not implement modal focus containment or make the background inert. Several custom dialogs do not supply a reusable focus-management layer. For a new or changed flow, verify intentional initial focus, contained Tab/Shift+Tab navigation, inactive background, Escape handling, and restoration to a still-valid opener. Do not claim these behaviors merely because a neighboring dialog has the right roles.

Keep header and final actions visible while the body scrolls. Protect interior pointer events from backdrop dismissal. Dismiss on the backdrop only when abandoning work is safe; preserve drafts and prevent conflicting close/save actions during mutations. Reuse existing domain confirmation flows for difficult-to-recover operations.

## Validation for affected overlays

Exercise mouse and keyboard opening, selection, Escape, outside interaction, focus return, disabled items, and trigger removal. Check the longest content near viewport edges and inside a scrolling panel or modal. A body portal cannot appear above a native dialog's top layer merely through `z-index`; keep nested overlays in the appropriate layer. Apply theme and reduced-motion checks from the Renderer guide. Validate only affected flows; importing the shared visual component is not behavioral validation.
