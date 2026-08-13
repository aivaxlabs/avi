import { THEMES_STORAGE_KEY, getTheme } from './themes.js';

const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function readStoredAppearance() {
  try {
    const raw = window.localStorage.getItem(THEMES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function readAppearance() {
  const stored = readStoredAppearance();
  const themeId = getTheme(stored.themeId).id;
  const scheme = ['light', 'dark', 'system'].includes(stored.scheme) ? stored.scheme : 'system';
  const backgroundFile = /^chat-background\.(gif|jpe?g|png|webp)$/.test(stored.backgroundFile)
    ? stored.backgroundFile
    : null;
  const backgroundBlendMode = [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light',
    'difference',
    'exclusion',
    'hue',
    'saturation',
    'color',
    'luminosity',
  ].includes(stored.backgroundBlendMode)
    ? stored.backgroundBlendMode
    : 'screen';
  const storedOpacity = Number(stored.backgroundOpacity);
  const backgroundOpacity = Number.isFinite(storedOpacity)
    ? Math.max(0.05, Math.min(0.8, storedOpacity))
    : 0.2;
  return {
    themeId,
    scheme,
    backgroundFile,
    backgroundBlendMode,
    backgroundOpacity,
  };
}

export function saveAppearance(appearance) {
  window.localStorage.setItem(THEMES_STORAGE_KEY, JSON.stringify(appearance));
}

export function resolvedScheme(scheme) {
  return scheme === 'system' ? (systemDarkQuery.matches ? 'dark' : 'light') : scheme;
}

export function applyTheme({ themeId, scheme }) {
  const root = document.documentElement;
  const theme = getTheme(themeId);
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-color-scheme', resolvedScheme(scheme));

  let style = document.getElementById('avi-plugin-theme');
  if (!style && theme.css) {
    style = document.createElement('style');
    style.id = 'avi-plugin-theme';
    document.head.append(style);
  }
  if (style) style.textContent = theme.css ?? '';
}

export function onSystemSchemeChange(listener) {
  const handler = () => listener(systemDarkQuery.matches);
  systemDarkQuery.addEventListener('change', handler);
  return () => systemDarkQuery.removeEventListener('change', handler);
}
