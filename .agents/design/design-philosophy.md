# Design philosophy

## Product character

Design Avi as a calm, compact desktop workspace for sustained technical work. The interface should feel precise and capable without competing with the conversation. Favor legible density, stable placement, restrained surfaces, and direct feedback over decorative chrome, novelty, or dashboard-like ornamentation.

## Priorities

1. Keep the user's current task, context, and system state visible.
2. Make the primary action obvious; keep secondary and destructive actions quieter.
3. Preserve predictable placement and behavior across chat, panels, navigation, and settings.
4. Use progressive disclosure for advanced controls instead of presenting every option at once.
5. Preserve recoverable input and explain the next action when work waits, fails, or is blocked.

## Visual hierarchy

- Establish hierarchy with spacing, alignment, typography, and text tone before adding borders, color, shadows, or cards.
- Use `--font-ui` for interface copy and `--font-code` only for code, identifiers, paths, shortcuts, and monospaced data.
- Reuse the restrained type scale in `src/styles/typo.xcss`: `--font-xl` through `--font-xs`. Do not introduce a feature-local font family or type scale.
- Keep headings concise and sentence case. Use muted supporting copy to clarify consequence or scope, not to repeat the label.
- Reserve strong elevation and backdrop effects for temporary overlays or clear layer separation.

## Color and themes

- Use semantic surfaces and text tokens: `--background-*`, `--text-*`, `--border-color`, `--item-hover`, and `--item-active`.
- Use intent tokens only for intent: `--primary-color`, `--success-color`, `--warn-color`, and `--danger-color`.
- Do not infer meaning from a literal hue or assume a dark or light background. Verify every state in built-in and plugin themes and both color schemes.
- Never use color as the only status signal. Pair it with text, iconography, shape, or accessible state.
- Avoid hard-coded colors except for media, syntax, or an intentional effect that cannot be represented by a semantic token.

## Interaction and feedback

- Preserve established action meanings and keyboard behavior during visual refinements.
- Show specific feedback close to the control or content it affects for loading, waiting, permission, success, interruption, validation, and error states.
- Keep destructive actions visually and spatially separate, label them explicitly, and require confirmation when recovery is difficult.
- Give icon-only controls an accessible name and usually a tooltip. Hover, icons, placeholder text, and color cannot be the only explanation.
- Use native semantic controls before custom clickable containers.

## Motion

- Animate only when motion clarifies origin, continuity, or feedback.
- Reuse `--duration-*`, `--ease-smooth-out`, `--base-transition`, `--distance-base`, and `--scale-*` from `src/styles/globals.xcss`.
- Keep entrance and state transitions short and interruptible. Avoid decorative loops except a bounded operational indicator such as a spinner.
- Provide a `prefers-reduced-motion` path for every non-essential animation or transition.

## Density and responsiveness

- Optimize first for mouse and keyboard in Electron's desktop layout, then preserve the existing narrow-window behavior.
- Compress labels and secondary controls progressively; do not clip content, actions, focus rings, or operational state.
- Use `min-width: 0`, `min-height: 0`, ellipsis, and intentional internal scrolling in grid and flex children.
- Do not invent a mobile layout pattern where Avi currently uses compact desktop columns unless the task explicitly requests one.

## Avoid AI-looking UI

- Do not turn ordinary content into a collection of rounded cards.
- Avoid oversized hero copy, gratuitous gradients, glowing borders, excessive pills, and decorative status chips.
- Do not add empty visual filler, generic illustrations, or verbose helper copy.
- Prefer one coherent surface hierarchy and a small number of purposeful accents.

## Source anchors

Use `src/styles/globals.xcss`, `src/styles/typo.xcss`, `src/styles/layout.xcss`, `src/styles/themes/`, and `.agents/AGENTS.Renderer.md` as the current visual-system contract.
