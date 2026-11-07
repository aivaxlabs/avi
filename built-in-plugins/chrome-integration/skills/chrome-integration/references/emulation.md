# Emulation

Emulation applies to the tab until reset, the debugger detaches or Avi restarts, and also to its iframes. Each setter returns the full emulation state. Call `browser.resetEmulation()` when done so the user's tab returns to normal.

## Screen and device

- `browser.setViewport(width, height, { deviceScaleFactor?, mobile?, touch? })` sets a desktop-style viewport (200–7680 × 200–4320). `mobile: true` adds mobile layout behavior. `setViewport(null)` restores the window size.
- `browser.setEmulation("mobile" | "tablet" | "none")` applies a phone (390×844 @3x) or tablet (820×1180 @2x) preset with touch and a matching Android user agent; `"none"` clears it.
- `browser.setTouch(true)` enables touch events without changing the viewport.

Snapshot coordinates follow the emulated viewport. Take a new snapshot after changing it.

## Media

- `browser.setColorScheme("dark" | "light" | "default")`.
- `browser.setMedia({ type?: "print" | "screen" | "", features?: { "prefers-reduced-motion": "reduce", ... } })`.

## Identity and location

- `browser.setUserAgent(userAgent, { platform?, acceptLanguage?, metadata? })`; `setUserAgent(null)` restores the original. Reload when the site reads it at load time.
- `browser.setLocale("pt-BR")` changes `Intl` and `navigator.language`; combine with `acceptLanguage` for server-side language selection.
- `browser.setTimezone("America/Sao_Paulo")`; empty string restores.
- `browser.setGeolocation({ latitude, longitude, accuracy? })`; `null` clears. Allow it with `browser.setPermission("geolocation", "allow")`.

## Performance

- `browser.setCPUThrottling(4)` slows the CPU by the given factor (1 = normal).
- Network throttling is in [network](./network.md).
