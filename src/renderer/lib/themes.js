export const THEMES_STORAGE_KEY = 'aivax.appearance';

export const DEFAULT_THEME_ID = 'axion';

const builtInThemes = Object.freeze([
  {
    id: 'axion',
    name: 'Axion',
    tagline: 'The default Avi experience. Neutral surfaces with a vivid green pulse.',
  },
  {
    id: 'monokai',
    name: 'Monokai',
    tagline: 'The cult classic. Charcoal canvas with neon pink, green, and cyan.',
  },
  {
    id: 'absolute',
    name: 'Absolute',
    tagline: 'Warm paper and clay tones, inspired by Claude. Calm and editorial.',
    emptyChatBackground: false,
  },
  {
    id: 'code',
    name: 'Code',
    tagline: 'The familiar editor. Deep blue-gray surfaces with VS Code blue.',
  },
  {
    id: 'goblin',
    name: 'Goblin',
    tagline: 'Codex blue on crisp neutral surfaces. Focused, technical, and sharp.',
  },
]);

export let themes = builtInThemes;

export function setPluginThemes(pluginThemes = []) {
  const builtInIds = new Set(builtInThemes.map((theme) => theme.id));
  const seen = new Set(builtInIds);
  const validPluginThemes = pluginThemes.filter((theme) => {
    if (!theme?.id || !theme.name || seen.has(theme.id)) return false;
    seen.add(theme.id);
    return true;
  });
  themes = Object.freeze([...builtInThemes, ...validPluginThemes]);
}

export function getTheme(id) {
  return themes.find((theme) => theme.id === id) ?? themes[0];
}
