# Chat workspace

## Purpose and anatomy

Keep chat as Avi's primary work surface. Preserve this hierarchy:

1. `.chat-workspace` owns the main chat and optional auxiliary-panel columns.
2. `.chat-area` contains background treatment, the scrollable conversation region, drop feedback, and the anchored composer.
3. `.chat-scroll` is the keyboard-focusable `Conversation messages` region.
4. `.messages-column` centers readable message content.
5. `Composer` remains visually anchored over the lower edge without becoming part of message history.

Do not add a permanent chat header or toolbar unless the task requires it; keep controls near the content or action they affect.

## Layout contract

- Keep the workspace and chat area at `min-width: 0`, `min-height: 0`, and `overflow: hidden`; let `.chat-scroll` own vertical scrolling.
- Keep `.messages-column` at `max-width: 820px`, centered, with the established 22px turn gap.
- Keep user content right-aligned and bounded to `min(620px, 78%)`; narrow windows may expand it to 90%.
- Preserve bottom clearance derived from the live composer height so the last message and focus indicators remain reachable.
- Keep the main chat at least 320px wide when an auxiliary panel is open.
- Do not place page-level controls inside the scroll region or create nested scrolling around the entire conversation.

## Message hierarchy

- Extend `ChatView`, `Message`, and `Composer`; do not introduce a parallel conversation renderer.
- Preserve clear distinctions among user input, assistant output, reasoning, tool activity, approvals, questions, queued or steered prompts, errors, interruptions, and cross-thread content.
- Keep user messages as compact bounded bubbles. Keep assistant output on the reading surface rather than enclosing every response in a decorative card.
- Preserve semantic Markdown, code, media, file references, diffs, and restricted rich directives.
- Keep operational detail visible enough to understand what the agent did and whether it completed.

## Scrolling and streaming

- Preserve `useStreamingAutoScroll`: follow output only while the user is at the live edge; never pull them away from older content they intentionally inspect.
- Preserve incremental history loading near the top and maintain scroll position when older turns are prepended.
- Render streaming output incrementally without destabilizing completed content.
- Keep the conversation region focusable and labeled; selection actions must work with mouse and keyboard selection.

## Empty and transient states

- Empty chat may center a concise prompt and elevate the composer, but text entry remains the dominant element.
- Keep background imagery and WebGPU decoration non-interactive and `aria-hidden`; they must not reduce text or control contrast.
- Use the full-area file-drop overlay only during a valid drag and state the action explicitly.
- Place waiting, semaphore, question, permission, interruption, and error states inline with the relevant turn.
- Preserve user input when an operation fails and provide a clear retry, cancel, resume, or next action.

## Responsive and motion rules

- Preserve the existing compact auxiliary-chat variant: smaller empty heading, tighter horizontal padding, and the same chat semantics.
- Do not solve narrow layouts with fixed widths that clip messages, attachments, code, or focus rings.
- Use the shared motion tokens for new-turn and empty-state transitions, and remove non-essential animation under `prefers-reduced-motion`.

## Accessibility

- Keep `.chat-scroll` as a labeled region with keyboard focus.
- Use semantic headings, sections, fieldsets, navigation, and live regions for their existing meanings.
- Every status must have text or an accessible label; color and animation only reinforce it.
- Keep inline questions operable with native radio, checkbox, text input, and button semantics.

## Source anchors

Use `src/renderer/components/ChatView.jsx`, `src/renderer/components/Message.jsx`, `src/renderer/lib/use-streaming-auto-scroll.js`, `src/styles/components/chat.xcss`, and `src/styles/components/message.xcss`.
