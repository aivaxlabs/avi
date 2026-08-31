# Themes

Themes change Avi’s local visual appearance only.

## Choose a color scheme

Open **Settings → Personalization**. Under **Mode**, select a **Color mode**:

- **System** — the default; follows the operating-system preference in real time;
- **Light** — keeps Avi in light mode;
- **Dark** — keeps Avi in dark mode.

Enable **Transparent sidebar** in the same section to use the active theme’s transparent surfaces over the operating system’s native window effect. Avi uses Tabbed Mica on Windows 11, requests Acrylic on Windows 10, uses native Sidebar vibrancy on macOS, and keeps the standard opaque sidebar on Linux. Electron only officially supports its Windows background-material API on Windows 11 22H2 and later, so Acrylic availability on Windows 10 depends on the operating system and Electron runtime.

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

Each theme defines `--background-transparent-0` through `--background-transparent-5`, translucent counterparts of its normal background surfaces. The Sidebar uses these surfaces while **Transparent sidebar** is enabled.

Themes do not change personality, instructions, model selection, permissions, or conversation content. See [Personalities](Personalities.md).
