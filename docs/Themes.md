# Themes

Themes change Avi’s local visual appearance only.

## Choose a color scheme

Open **Settings → Personalization**. Under **Mode**, select:

- **System** — the default; follows the operating-system preference in real time;
- **Light**;
- **Dark**.

## Choose a theme

Available themes are:

- **Axion** — default; neutral surfaces with a vivid green accent;
- **Monokai** — charcoal surfaces with neon colors;
- **Absolute** — warm paper and clay tones;
- **Code** — deep blue-gray editor-inspired surfaces;
- **Goblin** — technical blue on crisp neutral surfaces.

Theme and mode changes are applied immediately and stored in renderer `localStorage` under `aivax.appearance`. Invalid saved values fall back to Axion and System.

## Preview and behavior

Theme cards preview the Sidebar, messages, code, and composer. The **Preview** section shows the resolved active combination. When Mode is System, the preview follows the current system scheme.

The Absolute theme disables the animated empty-chat background. Other themes may display it when WebGPU is available. Missing animation does not affect conversation behavior.

Themes do not change personality, instructions, model selection, permissions, or conversation content. See [Personalities](Personalities.md).
