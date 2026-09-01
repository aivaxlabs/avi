# Chat composer

## Role and hierarchy

The composer is the primary input surface. Preserve this order of attention:

1. Prompt text and attachments.
2. Contextual send, stop, resume, or cancel action.
3. Permission, work mode, model, and reasoning context.
4. Attachment and advanced-action menus.
5. Project and context-usage indicators below the main input.

New controls must not crowd text entry, obscure the current send/stop state, or make model, permission, project, and work mode ambiguous.

## Shell and dimensions

- Keep `.composer-wrap` anchored above the lower edge with pointer events limited to its interactive children.
- Keep the composer centered at `min(720px, 100%)`; supporting goal, queue, and status strips use the narrower `min(680px, 95%)` family.
- Preserve the two-row grid: textarea across the first row, then attachment, permission/mode, model, and primary action.
- Keep the textarea at 14px, `line-height: 1.35`, a 48px minimum, content-driven growth, and bounded vertical scrolling.
- Preserve the focused-surface treatment: semantic background change, primary border, and opaque focus outline.
- Keep the inline editing variant in normal flow and retain its explicit cancel action.

## Controls

- The send/stop/resume control is the strongest action and occupies the stable trailing position.
- Show only the action valid for runtime state; prevent duplicate submission while resolving.
- Keep attachment, permission, model, reasoning, and work-mode controls visually secondary.
- Truncate long model, project, and path labels instead of expanding the composer.
- At narrow widths, progressively hide secondary permission text before reducing the input area; keep accessible names intact.
- Place popovers against their trigger, constrain them to the viewport, and preserve logical focus and Escape behavior.

## Input behavior

- Preserve multiline keyboard behavior and the established send shortcut. Do not repurpose Enter or Escape without checking editing, menus, dialogs, recording, and command modes.
- Persist recoverable drafts per conversation and do not clear text or attachments until submission is accepted.
- Keep command, workflow, skill, mention, model, and effort discovery in the existing command picker rather than adding competing inputs.
- Preserve deterministic keyboard navigation and active-option feedback in pickers.
- Keep drag/drop, file picker, paste, audio, and text attachments within the same attachment model.

## Runtime states

- Distinguish sending, stopping, goal preparation, prompt optimization, recording, editing, queueing, steering, and queue resumption.
- Show goal, queued-message, edit-count, sub-agent, and task context in the existing strips or chips above the input.
- Keep status copy concise and specific. Use tabular numerals for elapsed time, token counts, and similar changing data.
- Disabled controls must remain understandable; use nearby explanation when the reason is not obvious.
- Error handling must preserve prompt text and attachments for retry.

## Visual language

- Use semantic surfaces and restrained borders. The composer may have stronger focus emphasis than surrounding controls because it is the primary action surface.
- Pills are appropriate for compact modes, status, model, permission, or project context; do not turn ordinary actions or copy into pills.
- Use 34px as the established action-row control height and preserve comfortable icon-only targets.
- Keep empty-chat shimmer and optimization motion subordinate to text entry and remove it under `prefers-reduced-motion`.

## Accessibility

- Give every icon-only action an `aria-label`; mirror expanded state with `aria-expanded` and popup type with `aria-haspopup`.
- Preserve native textarea, button, range, dialog, and menu semantics.
- Return focus to the invoking control when menus or dialogs close where the existing pattern does so.
- Do not expose placeholder text as the only label or instruction.

## Source anchors

Use `src/renderer/components/Composer.jsx`, `src/renderer/lib/composer-invocation.js`, `src/styles/components/composer.xcss`, `src/styles/components/project-picker.xcss`, and `src/styles/components/zz-context-usage.xcss`.
