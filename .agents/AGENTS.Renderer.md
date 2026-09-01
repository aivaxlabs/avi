---
description: Applies to src/renderer, src/styles, and renderer-facing assets and tests.
embeddable: false
---
# Renderer guide

## Entry points and data flow
- `main.jsx` renders either `App` or `QuickChatApp` from the `?window=quick-chat` query parameter and applies appearance before mounting.
- `App.jsx` is the main state and event coordinator. It loads application state through `window.chatApp`, subscribes to navigation/chat/MCP events, and composes feature components. Keep feature presentation and local behavior in the relevant component instead of expanding `App` unnecessarily.
- `QuickChatApp.jsx` has its own session lifecycle but reuses shared renderer components and utilities.
- Common pure renderer helpers belong in `lib/`. Pass component behavior through explicit props and callbacks, following adjacent components; there is no client-side global store.

## Runtime boundary
- Use only the preload-provided `window.chatApp` API for privileged operations. Do not import Electron, Node built-ins, main-process modules, or provider implementations into renderer code.
- When a renderer feature needs a new privileged operation, update the main logical handler and `src/preload/preload.cjs` bridge as part of the same coherent change.
- Clean up every event subscription using the unsubscribe function returned by the preload bridge.

## Components and accessibility
- Follow existing function-component, named-export, and feature-oriented file patterns. Reuse renderer utilities and existing component families before adding abstractions.
- Preserve semantic controls, keyboard behavior, focus handling, and established ARIA roles/labels/states. Include loading, empty, disabled, selected, and error states when the affected interaction has them.
- Use the existing `classNames()` helper for conditional classes where appropriate and retain the feature's established flat class family.

## UI/UX philosophy and usability
- Design Avi as a calm, compact desktop workspace for sustained technical work. Prefer clear hierarchy, predictable placement, progressive disclosure, and legible density over decorative chrome or novelty.
- Keep the user's current task and system state visible. Actions that start inference, mutate configuration, wait for approval, fail, or finish must provide immediate, specific feedback and a clear recovery or next action.
- Preserve established interaction patterns before inventing variants. A visual refinement must not change keyboard behavior, information hierarchy, action meaning, or the distinction between draft, pending, active, and completed state.
- Make the primary action obvious without making every action prominent. Keep secondary and destructive actions quieter, and require explicit confirmation when the consequence is difficult to reverse.
- Use concise product language that describes the action or state. Do not rely on icons, color, animation, hover, or placeholder text as the only source of meaning; icon-only controls need an accessible name and usually a tooltip.
- Optimize first for mouse and keyboard use in the Electron desktop layout, then preserve usability in the existing narrow-window breakpoints. Avoid fixed dimensions that clip content, actions, or focus indicators.

## Dropdowns, popovers, and modals
- Reuse `components/DropdownMenu.jsx` and the `.dropdown-menu` family for compact action or selection menus. Keep menu items as semantic buttons, expose the trigger with `aria-haspopup` and `aria-expanded`, and add `menu`/`menuitem` roles plus arrow-key navigation when the interaction behaves as an application menu.
- Position anchored overlays from the trigger bounds and keep them inside the viewport. Use the established fixed/portal pattern when an ancestor clips or creates a stacking context; diagnose the containing stacking context instead of escalating arbitrary `z-index` values.
- Close transient overlays on outside pointer interaction, `Escape`, selection, and relevant viewport changes. Move focus into keyboard-operated menus when opened and restore it to the trigger when dismissed.
- Use a dialog rather than a dropdown when the task needs search, filters, previews, multiple decisions, substantial explanation, or confirmation. Follow the `.dialog-backdrop`, header, content, and footer families instead of creating a visually unrelated modal.
- Every modal must have `role="dialog"`, `aria-modal="true"`, an accessible name, an intentional initial focus target, an `Escape` path, and protected interior pointer events. Backdrop dismissal is appropriate only when abandoning the dialog is safe; restore focus to the opener on close.
- Keep overlays responsive to available height, with scrolling inside the content region rather than allowing headers or final actions to leave the viewport. Respect the existing reduced-motion behavior for entrance and exit effects.

## Chat, inference, and messages
- Treat `ChatView`, `Message`, and `Composer` as the canonical chat composition. Extend their existing role, status, segment, attachment, reasoning, tool, approval, and continuation patterns rather than introducing a parallel message renderer or inference state model.
- Preserve the visual distinction between user input, assistant output, tool activity, reasoning, queued or steered prompts, cross-thread content, errors, interruptions, and approval requests. Do not present partial or failed output as a completed assistant answer.
- Render streaming content incrementally without destabilizing completed content. Preserve `useStreamingAutoScroll` behavior: follow new output while the user is at the live edge, but do not pull them away from older content they intentionally scrolled to inspect.
- Keep inference controls synchronized with runtime state. Sending, stopping, retrying, resuming, editing, queueing, steering, and answering a pending question must expose only actions valid for the current state and prevent duplicate submission while an action is resolving.
- Provide explicit empty, loading, waiting, permission, interruption, and error states near the content or control they affect. Error copy must explain what failed and retain recoverable user input whenever possible.
- Preserve semantic Markdown, code, file references, restricted rich directives, and accessible media labels through the existing rich-content pipeline. Do not reduce technical content to decorative cards or hide operational detail needed to understand an agent run.
- Keep the composer as the clear primary input surface. New controls must not crowd text entry, obscure send/stop state, break multiline and keyboard behavior, or make model and work-mode context ambiguous.

## Management, configuration, and forms
- Keep `SettingsPage` responsible for top-level navigation, drafts, persistence coordination, and page-level status; keep provider, plugin, appearance, MCP, and other feature-specific presentation inside their existing focused components.
- Follow the established settings hierarchy: sidebar navigation, one page header with contextual description, grouped sections, and `.settings-section-card` or row-card families. Prefer list-detail flows and progressive disclosure over placing every setting in one dense form.
- Use persistent local drafts for multi-field configuration and save only through an explicit action. Immediate application is reserved for established previewable preferences such as appearance; make that behavior clear in the surrounding copy.
- Use native `label`, `input`, `textarea`, `select`, `button`, and `fieldset` semantics whenever they fit. Give every control a visible label, put help text next to the affected field, and preserve logical tab and reading order.
- During asynchronous work, disable conflicting actions, prevent duplicate submission, and change the relevant action or nearby status to describe the operation. On failure, keep entered values, mark invalid fields with `aria-invalid` when applicable, and expose actionable error text with `role="alert"`.
- Separate primary, secondary, and destructive actions visually and by placement. Never use a destructive color for a routine action, and do not hide irreversible operations in ambiguous icon-only controls.
- Include intentional loading, empty, no-results, disabled, validation, saved, and error states. Validate configuration in the renderer for immediate guidance and again at the privileged boundary for authority.

## Visual system, typography, themes, and color
- Build on the semantic tokens in `globals.xcss`, the type scale in `typo.xcss`, and the palettes in `themes/`. Use `--font-ui` for interface copy and `--font-code` only for code, identifiers, paths, shortcuts, or other monospaced data.
- Preserve the restrained typography hierarchy: weight, size, spacing, and text tone establish structure before borders or color. Reuse `--font-xl` through `--font-xs`; do not introduce a new font family or isolated type scale for one feature.
- Use semantic surface and text variables (`--background-*`, `--text-*`, `--border-color`, `--item-hover`, and `--item-active`) and semantic intent variables (`--primary-color`, `--success-color`, `--warn-color`, and `--danger-color`). Do not hard-code palette colors in feature styles unless the value represents media, syntax, or an intentional effect that cannot be expressed by a semantic token.
- Every component must remain legible and preserve hierarchy across all built-in themes, plugin themes, and both light and dark color schemes. Do not infer meaning from one theme's literal hue or assume a specific background luminance.
- Color may reinforce status but cannot be its only signal; pair it with text, iconography, shape, or semantic state. Verify readable contrast for primary copy, muted copy, controls, focus rings, selected rows, and destructive feedback.
- Reuse the global duration, easing, distance, and scale tokens for motion. Animate state changes only when motion clarifies origin, continuity, or feedback; avoid decorative looping motion and provide a `prefers-reduced-motion` path.
- Keep theme and background previews representative of the real interface by reusing production components where practical. Appearance customization must not reduce chat readability or obscure interactive states.

## Styles
- `src/styles/**/*.xcss` is the style source of truth: root tokens/layout are in `globals.xcss`, `typo.xcss`, and `layout.xcss`; feature rules are in `components/`; built-in palettes are in `themes/`.
- Use Cascadium's existing hierarchy-first nesting, `&` modifiers/states, and CSS custom-property tokens. Co-locate responsive and state rules with their feature.
- Never hand-edit `styles.css`. It is a tracked generated artifact imported by `main.jsx`; run `bun run styles` after every XCSS change and review both source and generated diffs.

## Validation
- Run focused renderer tests directly when applicable: `bun scripts/test-message-groups.mjs`, `bun scripts/test-file-edits.mjs`, or the related package script such as `bun run test:interruptions`.
- Run `bun run renderer:build` after JSX, XCSS, Vite, or `index.html` changes. `bun run syntax` does not validate JSX.
- Browser-only Vite checks cannot exercise `window.chatApp`. For IPC-dependent behavior, validate through Electron using the smoke path in the root guide or a targeted manual Electron flow.
- After completing React feature or bug-fix work, read and apply `.agents/skills/react-doctor/SKILL.md`; do not substitute it for the focused regression check.
