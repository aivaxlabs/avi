# Chat composer

## Extend the existing input surface

Use `src/renderer/components/Composer.jsx` through the existing `ChatView` composition. The hierarchy is prompt/attachments, primary send/stop/resume action, permission/work mode/model, secondary menus, then project and usage context. New controls must not crowd text entry or obscure runtime state.

Reuse these implementations rather than recreating them:

- Local `ComposerChip` and `ComposerStrip` for compact context and goal/queue/task/status rows. They are implementation details in `Composer.jsx`, not exported components.
- `DropdownMenu` / `DropdownMenuItem` for short action menus; read [Overlays](./overlays.md) for caller-owned positioning, focus, keyboard, and dismissal.
- `ModelPicker` for the full model-selection dialog; its props are `models`, `favorites`, `currentModel`, `onClose`, `onChoose`, and `onToggleFavorite`.
- `ContextUsageDialog`, `ProviderUsages`, and `WorkspaceDialog` for their existing domains, not new lookalike dialogs.
- The current command picker for commands, workflows, skills, mentions, models, and effort. `src/renderer/lib/composer-invocation.js` parses the invocation; selection, filtering, and keyboard handling remain in the composer.

## Layout contract

`.composer-wrap` anchors the normal composer with pointer events limited to interactive children. Preserve the centered `min(720px, 100%)` input and `min(680px, 95%)` supporting strips. The grid places text first, then attachment, permission/mode, model, and a stable trailing primary action.

Retain the textarea's 14px text, 1.35 line height, 48px minimum, content-driven growth, and bounded scrolling; action-row controls are 34px. Preserve the focused surface and outline. Inline editing stays in normal flow with Cancel; empty main chat has its own layout. Truncate long model/project labels and hide secondary permission text at existing breakpoints before reducing the input area.

## Input and runtime contracts

- Preserve per-conversation recoverable drafts and the established attachment model across picker, paste, drag/drop, audio, and text. Do not clear input before submission is accepted; retain it on failure.
- Keep multiline and send shortcuts consistent. Check menus, editing, recording, command selection, and dialogs before changing Enter or Escape handling.
- Derive send, stop, resume, cancel, queue, and steer behavior from the existing props/state. Distinguish goal preparation, optimization, recording, editing, and queue resumption; prevent duplicate submission while resolving.
- Keep model, permission, work mode, project, and context usage understandable even when labels collapse. Explain non-obvious disabled actions near the control.

## Check the affected flow

Exercise draft restoration when switching conversations, attachments, multiline input, valid primary actions, menu keyboard handling, and the narrow/compact and inline-edit variants touched by the change. A shared prop change must reach existing callers and memo comparisons. Quick Chat uses its own `QuickComposer` in `QuickChatApp.jsx`; inspect it separately if the task includes that window rather than assuming automatic parity.

Styles: `src/styles/components/composer.xcss`, `project-picker.xcss`, and `zz-context-usage.xcss`. Keep semantic tokens, icon labels, reduced motion, and renderer validation as defined in the Renderer guide.
