# Design philosophy

Avi is a calm, compact desktop workspace for sustained technical work. Chat is the primary surface; navigation and panels support it, while settings is a dedicated management workspace. Do not apply a landing-page, mobile drawer, or dashboard aesthetic to these surfaces without a requested redesign.

## Decision priorities

- Keep the user's task, context, and operational state visible. Make the primary action obvious and preserve predictable placement.
- Establish hierarchy through alignment, spacing, typography, and text tone before adding borders, color, shadows, or cards.
- Use progressive disclosure for advanced controls. Short supporting copy should explain a consequence or scope, not repeat the label.
- Preserve recoverable input and show the next action when work waits, fails, or is blocked. Partial or failed output must not look complete.
- Prefer legible density over empty visual space. At narrow widths, truncate labels and disclose secondary actions before clipping content or shrinking essential controls.

## Visual decisions

Use the token, typography, theme, accessibility, and motion contracts in [Renderer guide](../AGENTS.Renderer.md), not a new local design system. The sources are `src/styles/globals.xcss`, `typo.xcss`, `layout.xcss`, and `themes/`.

Reserve elevation and backdrops for actual layer separation. Avoid decorative gradients, glowing borders, oversized hero copy, excessive pills, and a rounded card around every message or setting. Pills suit compact modes and context; cards suit coherent configuration groups, not individual labels or metrics.

Motion should explain origin, continuity, or feedback. An overlay may enter from its trigger and a panel from its edge; decorative loops and motion that competes with reading or typing do not belong here. Preserve reduced-motion paths.

## Before adding a new treatment

Compare the same role in the existing UI: menu with menu, configuration group with configuration group, and chat output with chat output. Prefer the implemented family even when a standalone alternative looks attractive. If the family cannot meet the requirement, identify the missing behavior rather than silently restyling the product.
