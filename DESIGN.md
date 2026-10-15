---
name: Avi Desktop
description: Calm, compact desktop workspace for sustained technical work. Token values are the Axion light palette; every built-in or plugin theme overrides them through CSS custom properties in src/styles/themes/.
colors:
  primary: "#b97900"
  ink: "#171717"
  ink-inverse: "#f7f7f7"
  text-muted: "#686868"
  text-subtle: "#969696"
  surface: "#fafafa"
  surface-raised: "#f5f5f5"
  control: "#eeeeee"
  control-hover: "#e5e5e5"
  border: "#e5e5e5"
  danger: "#c43c3c"
typography:
  body:
    fontFamily: Segoe UI
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Segoe UI
    fontSize: 14px
    fontWeight: 500
  help:
    fontFamily: Segoe UI
    fontSize: 0.9rem
    fontWeight: 400
    lineHeight: 1.5
  heading:
    fontFamily: Segoe UI
    fontSize: 1.4rem
    fontWeight: 500
    lineHeight: 1.25
  code:
    fontFamily: Cascadia Code
    fontSize: 14px
rounded:
  control: 9999px
  multiline: 12px
  menu: 10px
  card: 14px
spacing:
  control-x: 12px
  control-gap: 6px
  stack: 16px
components:
  button:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 30px
    padding: 0 12px
  button-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-inverse}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 30px
    padding: 0 12px
  select:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 30px
    padding: 0 12px
  input:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 30px
    padding: 0 12px
  input-editing:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  toggle:
    backgroundColor: "{colors.control}"
    size: 36px 20px
    rounded: "{rounded.control}"
  toggle-on:
    backgroundColor: "{colors.primary}"
  long-text-button:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 30px
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.menu}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  help-text:
    textColor: "{colors.text-muted}"
    typography: "{typography.help}"
  placeholder:
    textColor: "{colors.text-subtle}"
  invalid:
    textColor: "{colors.danger}"
  divider:
    backgroundColor: "{colors.border}"
  primary-focus:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
---

# Avi Desktop design system

This file is the visual source of truth for Avi's renderer. Agents read it before creating or changing any interface control. The prose explains the rules; the tokens above document the Axion light values. Implementation lives in `src/styles/controls.xcss` (primitives and `--control-*` tokens), `src/styles/globals.xcss`, `src/styles/typo.xcss`, and `src/styles/themes/`.

## Overview

Avi is a calm, compact desktop workspace. Chat is the primary surface; navigation, panels, dialogs, and settings support it. Hierarchy comes from alignment, spacing, weight, and text tone before borders, color, or elevation.

Every interactive control outside the chat and composer is built from one small set of primitives. A control looks like a soft pill; its **state** — not a new shape or color — tells the user what it does:

| Intent | Primitive | Looks like |
|---|---|---|
| Run an action | `.button` | Grey pill |
| The one main action of a surface | `.button.primary` | Inverted ink pill |
| Action plus related actions | `.button-group` | Pills joined by a thin divider; the trailing part opens a menu |
| Choose one value | `select.select` | Grey pill with a chevron, sized to the selected value |
| On/off | `input[type=checkbox].toggle` | Toggle switch, accent fill when on |
| Short single-line text | `.input` | Grey pill; while editing it lightens and shows an accent ring |
| Medium or long text, JSON, line lists | `LongTextField` | Grey pill reading "12 lines"; opens a modal Monaco editor |

The chat transcript (`ChatView`, `Message`, `RichContent`) and the composer (`Composer`) keep their own specialized controls. Do not restyle them with these primitives, and do not change shared selectors they depend on (`.primary-mini`, `.icon-button`, `.round-button`, `.dialog-footer`, `.dialog-backdrop`, global `button`).

## Colors

Never hard-code palette values in feature styles. Use semantic theme variables, which every theme redefines for light and dark schemes:

- **Surfaces:** `--background-0` (deepest, editing fields) to `--background-4`; `--background-5` is the inverted ink used by primary actions.
- **Text:** `--text-1` (primary copy) to `--text-4` (placeholder, disabled); `--text-5` is text on `--background-5`.
- **Intent:** `--primary-color` is the theme accent. It marks *state* (toggle on, editing ring, focus ring, selected tab indicator), never a routine button fill. `--danger-color` appears on hover or for invalid state only; it never fills a routine action.
- **Control tokens:** `--control-background`, `--control-background-hover`, `--control-text`, `--control-primary-background`, `--control-primary-text`, `--control-accent`, `--control-focus-ring`. A theme or plugin theme may override these to retune every control at once; it must not restyle feature selectors to achieve the same effect.

Color is never the only signal. Pair it with text, an icon, shape, or position.

## Typography

Interface copy uses `--font-ui` (Segoe UI, system fallback). `--font-code` is only for code, identifiers, paths, shortcuts, and editors. Controls inherit the surrounding size (14px base) at weight 400; labels and headings use 500. Use the `typo.xcss` scale (`--font-xs` to `--font-xxl`); do not add a per-feature type scale.

## Layout

Controls share one height (`--control-height`, 30px; `.small` is 26px), horizontal padding (`--control-padding-x`, 12px), and icon gap (`--control-gap`, 6px). Buttons and selects are content-sized; inputs fill their column. In settings, a field is a row of label + help on the leading side and the control on the trailing side (`.settings-field`). Prefer legible density: no oversized controls, no empty decorative space.

## Elevation & Depth

Elevation is reserved for real layers: menus, popovers, dialogs. Controls are flat — no shadows, gradients, or glows. Cards (`.settings-section-card`, `.settings-row-card`) group a coherent set of settings, not individual values.

## Shapes

Single-line controls are full pills (`--control-radius`). Multi-line surfaces use `--control-radius-multiline`. Menus use 10px and cards 14px. A theme can retune the shape language through the radius tokens (the Code theme uses 6px for every control); features must not override radius per control.

## Components

### Buttons

- **Default** (`.button`): grey pill for every routine action — Cancel, Test, Refresh, Add, Open.
- **Primary** (`.button.primary`): at most one per surface, for the action that completes the task (Save, Create, Apply). It uses the inverted ink, not the accent.
- **Destructive** (`.button.danger`): default appearance, danger tone on hover; confirm irreversible actions. Never use a red fill.
- **With menu** (`.button-group`): the leading button runs the main action; the trailing button (`aria-haspopup="menu"`, a chevron or ellipsis icon, and an `aria-label`) opens a `DropdownMenu` with related actions.
- **Icon-only** (`.icon-button`, `.icon-button.tiny`): toolbar and row actions with `aria-label` and `title`. Do not use icon-only buttons for configuration or destructive operations without a confirmation.
- **Small** (`.button.small`): dense rows and toolbars only.

### Dropdowns

`select.select` (native `<select>` with `appearance: base-select`) looks like a default button with a trailing chevron and resizes to the selected value. Dropdowns have no primary state. For action lists, use a button with `DropdownMenu` instead of a select.

### Checks

Every boolean setting is a toggle: `<input type="checkbox" className="toggle">` inside a `<label>` with visible text. The legacy `.appearance-desktop-switch` class is an alias for existing callers; new code uses `.toggle`. Radio groups with descriptions use the existing card choice family (`.bot-settings-choice`); short exclusive choices use a select or tabs.

### Input

`.input` is for short single-line values: names, URLs, numbers, keys, times. It looks like a default button until focused; while editing it lightens to `--background-0` and shows the accent ring. Set `aria-invalid="true"` to show the danger border. Do not use `.input` or a bare `<textarea>` for medium or long text.

### Long text

`LongTextField` (`src/renderer/components/LongTextField.jsx`) replaces textareas for instructions, JSON, and line-per-item lists. The field shows the content size ("12 lines", "Empty"); activating it opens a modal editor (Monaco, `language="avi-json"` for JSON or `plaintext`) with Cancel and Apply, Ctrl+S to apply, and a discard confirmation. Quick compose fields (commit message, review comment, annotation, inbox reply) stay textareas because they are typed and submitted in place.

### Menus, dialogs, and settings

Reuse `DropdownMenu`, the `.dialog-backdrop` + `.dialog-header` + `.dialog-footer` family, and the settings shell. Dialog footers place secondary actions before the single primary action at the trailing edge.

## Do's and Don'ts

- **Do** compose every new non-chat control from the primitives above, and add a feature class only for layout (position, width, grid placement).
- **Do** retune controls for a theme through `--control-*` and theme tokens.
- **Do** keep focus rings visible (`--control-focus-ring`), labels visible, and state readable without color.
- **Do** validate a new or changed control in at least one light and one dark theme, including Code (square radius) and Axion (pill radius).
- **Don't** create another button, toggle, select, or input family (`.foo-button`, `.foo-switch`) that repeats a primitive with different colors, radius, or padding.
- **Don't** use the accent color as a button fill or the danger color for routine actions.
- **Don't** use a bare `<textarea>` for configuration text; use `LongTextField`.
- **Don't** use a native checkbox for a boolean setting; use `.toggle`.
- **Don't** change chat or composer controls to match these primitives, or alter selectors they share, without an explicit request.
