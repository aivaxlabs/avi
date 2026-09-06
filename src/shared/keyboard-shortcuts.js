export const defaultShortcuts = Object.freeze([
  ['model.previous', 'Previous model slider level', 'Control+Q'],
  ['model.next', 'Next model slider level', 'Control+E'],
  ['reasoning.previous', 'Previous reasoning level', 'Shift+Down'],
  ['reasoning.next', 'Next reasoning level', 'Shift+Up'],
  ['quick-chat', 'Open Quick Chat', 'Control+Alt+S', true],
  ['threads.search', 'Search threads', 'Control+K'],
  ['sidebar.toggle', 'Toggle sidebar', 'Control+B'],
  ['panel.toggle', 'Toggle side panel', 'Control+J'],
  ['thread.new', 'New thread', 'Control+N'],
  ['thread.home', 'New thread in home folder', 'Control+Shift+N'],
  ['chat.find', 'Find in current chat', 'Control+F'],
  ['zoom.in', 'Zoom in', 'Control+Plus'],
  ['zoom.out', 'Zoom out', 'Control+-'],
  ['zoom.reset', 'Reset zoom', 'Control+0'],
].map(([id, title, pattern, supportsGlobal = false]) => ({
  id, title, pattern, supportsGlobal, global: supportsGlobal,
})));

export function normalizeShortcut(pattern) {
  if (typeof pattern !== 'string') throw new Error('Shortcut pattern must be text.');
  if (!pattern.trim()) return '';
  const parts = pattern.trim().replace(/\+\+$/, '+Plus').split('+').map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  const modifiers = parts.map((part) => ({ ctrl: 'Control', control: 'Control', cmd: 'Control', command: 'Control', commandorcontrol: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift' })[part]);
  if (modifiers.some((part) => !part) || new Set(modifiers).size !== modifiers.length) throw new Error('Use Control, Alt, and Shift modifiers only.');
  const normalizedKey = ({ arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', up: 'Up', down: 'Down', left: 'Left', right: 'Right', plus: 'Plus', space: 'Space', enter: 'Enter', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' })[key]
    ?? (/^(?:[a-z0-9,./;\[\]\\'`=-]|f(?:[1-9]|1\d|2[0-4]))$/.test(key) ? key.toUpperCase() : null);
  if (!normalizedKey || !modifiers.length) throw new Error('Use a modifier and a supported key, for example Control+Shift+K.');
  return [...['Control', 'Alt', 'Shift'].filter((part) => modifiers.includes(part) && !(part === 'Shift' && normalizedKey === 'Plus')), normalizedKey].join('+');
}

export function shortcutFromEvent(event, mac = false) {
  if (event.isComposing || event.getModifierState?.('AltGraph') || (mac ? event.ctrlKey : event.metaKey)) return '';
  const key = event.key === '+' ? 'Plus' : event.key === ' ' ? 'Space' : event.key;
  const modifiers = [((mac ? event.metaKey : event.ctrlKey) && 'Control'), event.altKey && 'Alt', event.shiftKey && key !== 'Plus' && 'Shift'].filter(Boolean);
  try { return normalizeShortcut([...modifiers, key].join('+')); } catch { return ''; }
}

export function resolveShortcuts(definitions, overrides = {}) {
  const patterns = new Map();
  return definitions.map((definition) => {
    const override = overrides[definition.id] ?? {};
    const pattern = normalizeShortcut(override.pattern ?? definition.pattern);
    const global = override.global ?? definition.global ?? false;
    if (typeof global !== 'boolean' || (global && !definition.supportsGlobal)) throw new Error(`${definition.title} does not support global shortcuts.`);
    if (pattern && patterns.has(pattern)) throw new Error(`${pattern} conflicts with ${patterns.get(pattern)}.`);
    if (pattern) patterns.set(pattern, definition.title);
    return { ...definition, defaultPattern: definition.pattern, defaultGlobal: definition.global ?? false, pattern, global };
  });
}
