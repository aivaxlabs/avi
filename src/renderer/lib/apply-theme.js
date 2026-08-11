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
  return { themeId, scheme };
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
