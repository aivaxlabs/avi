---
description: Rules and onboarding context for Avi's React renderer, preload API consumption, and Cascadium styles.
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

## Styles
- `src/styles/**/*.xcss` is the style source of truth: root tokens/layout are in `globals.xcss`, `typo.xcss`, and `layout.xcss`; feature rules are in `components/`; built-in palettes are in `themes/`.
- Use Cascadium's existing hierarchy-first nesting, `&` modifiers/states, and CSS custom-property tokens. Co-locate responsive and state rules with their feature.
- Never hand-edit `styles.css`. It is a tracked generated artifact imported by `main.jsx`; run `bun run styles` after every XCSS change and review both source and generated diffs.

## Validation
- Run focused renderer tests directly when applicable: `bun scripts/test-message-groups.mjs`, `bun scripts/test-file-edits.mjs`, or the related package script such as `bun run test:interruptions`.
- Run `bun run renderer:build` after JSX, XCSS, Vite, or `index.html` changes. `bun run syntax` does not validate JSX.
- Browser-only Vite checks cannot exercise `window.chatApp`. For IPC-dependent behavior, validate through Electron using the smoke path in the root guide or a targeted manual Electron flow.
- After completing React feature or bug-fix work, read and apply `.agents/skills/react-doctor/SKILL.md`; do not substitute it for the focused regression check.
