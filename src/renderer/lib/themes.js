export const THEMES_STORAGE_KEY = 'aivax.appearance';

export const DEFAULT_THEME_ID = 'axion';

export const themes = Object.freeze([
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

export function getTheme(id) {
  return themes.find((theme) => theme.id === id) ?? themes[0];
}
