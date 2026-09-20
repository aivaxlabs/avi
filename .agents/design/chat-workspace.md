# Chat workspace

## Reuse the conversation pipeline

`src/renderer/components/ChatView.jsx` composes history, messages, inline questions and run states, selection actions, and `Composer`. Extend that pipeline instead of adding a second conversation renderer or local inference state model.

| Change | Existing owner |
|---|---|
| Conversation layout, history, selection, inline question flow | `ChatView.jsx` |
| Message roles, segments, reasoning, tools, attachments, usage, and actions | `Message.jsx`; preserve its `RichContent.jsx` rendering path |
| Prompt, queue/goal strips, model/mode controls, send/stop | [Composer](./chat-composer.md) |
| Empty main-chat inbox and notes summary | `EmptyChatSummary.jsx`, mounted by `ChatView` only when not `compact` |
| Same conversation in an auxiliary tab | `ChatView compact` with that conversation's state and callbacks; see the caller in `AuxiliaryPanel.jsx` |

`compact` changes presentation, not the runtime contract. Preserve conversation identity, `draftKey`, messages, model/project context, run state, questions, and the matching action callbacks. Do not feed an auxiliary chat the main conversation's state accidentally. Keep the existing memoized boundaries and callback behavior when extending props so streaming does not rerender unrelated history or reset the composer.

## Layout and scroll ownership

- `.chat-workspace` owns chat/panel columns; `.chat-area` contains the background, `.chat-scroll`, drop feedback, and composer. Keep grid/flex children at `min-width: 0`, `min-height: 0`; `.chat-scroll` owns conversation scrolling.
- Preserve `.chat-scroll` as the focusable, labeled `Conversation messages` region and retain `ChatFind` integration. Do not wrap the conversation in another scroller or add a permanent header without a requested layout change.
- `.messages-column` is centered at 820px maximum with 22px turn gaps. User bubbles remain right-aligned at `min(620px, 78%)`, expanding to 90% in the existing narrow breakpoint; assistant output stays on the reading surface.
- Preserve the live composer-height measurement and `--composer-clearance`, not a guessed bottom spacer. Inline editing stays in flow; the empty main-chat layout has its own composer placement.
- `src/renderer/lib/use-streaming-auto-scroll.js` follows new output only at the live edge. Retain `prepareForPrepend` and the history-loading path so older-message loads do not jump the viewport.

## State and content integrity

Keep user input, assistant output, reasoning, tools, approvals, questions, queues, interruptions, errors, and cross-thread content distinguishable. Extend existing segments and rich content rather than flattening technical output into generic cards. Preserve native question controls, Markdown, code, media, file references, diffs, and restricted directives.

Place waiting, permission, and recovery actions with the relevant turn and expose only actions valid for runtime state. Empty-chat decoration stays non-interactive and `aria-hidden`; the prompt remains primary. Show the full-area drop overlay only for a valid drag. Backgrounds and compact layout must not hide operational state or reduce reading contrast.

## Check the affected flow

Check main and compact chat when shared rendering changes, long/rich content, inline editing, and empty/loaded states. For scroll changes, verify streaming at and away from the live edge, prepending history, and reachability of the final message above the composer. Styles: `src/styles/components/chat.xcss` and `message.xcss`; general accessibility, theme, and build requirements remain in the Renderer guide.
