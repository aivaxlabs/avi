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
    tagline: 'Inspired by VS Code 2026. Inset editor surfaces, crisp menus, and VS Code blue.',
  },
  {
    id: 'goblin',
    name: 'Goblin',
    tagline: 'Codex blue on crisp neutral surfaces. Focused, technical, and sharp.',
  },
  {
    id: 'github',
    name: 'GitHub',
    tagline: 'GitHub Light and Dark Default. Primer surfaces with GitHub blue.',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    tagline: 'Soothing pastels. Latte by day, Mocha by night, with a mauve accent.',
  },
  {
    id: 'solarized',
    name: 'Solarized',
    tagline: 'Ethan Schoonover\'s precision palette. Low-contrast base tones with blue accents.',
  },
  {
    id: 'nord',
    name: 'Nord',
    tagline: 'Arctic, north-bluish calm. Polar Night and Snow Storm with Frost accents.',
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    tagline: 'Downtown Tokyo at night. Deep indigo surfaces with neon blue and violet.',
  },
  {
    id: 'darcula',
    name: 'Darcula',
    tagline: 'JetBrains Darcula, with IntelliJ Light for the light scheme.',
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
