import { defaultShortcuts, resolveShortcuts } from '../shared/keyboard-shortcuts.js';

export class KeyboardShortcuts {
  constructor({ globalShortcut, platform, plugins, read, write, execute, notify }) {
    Object.assign(this, { globalShortcut, platform, plugins, read, write, execute, notify });
    this.registered = new Set();
    this.shortcuts = [];
  }

  definitions() {
    return [...defaultShortcuts, ...this.plugins.getContributions('shortcuts').map((item) => ({
      ...item,
      id: `plugin:${item.pluginId}:${item.id}`,
      contributionId: item.id,
      global: item.global ?? false,
    }))];
  }

  refresh() {
    for (const accelerator of this.registered) this.globalShortcut.unregister(accelerator);
    this.registered.clear();
    const accepted = [];
    const overrides = this.read();
    this.shortcuts = this.definitions().map((definition) => {
      let shortcut;
      try {
        shortcut = resolveShortcuts([...accepted, definition], overrides).at(-1);
        accepted.push(definition);
      } catch (error) {
        return { ...definition, defaultPattern: definition.pattern, defaultGlobal: definition.global ?? false, pattern: overrides[definition.id]?.pattern ?? definition.pattern, global: overrides[definition.id]?.global ?? definition.global, error: error.message, active: false };
      }
      if (!shortcut.pattern) return { ...shortcut, active: false };
      if (!shortcut.global) return { ...shortcut, active: true };
      const accelerator = shortcut.pattern.replace('Control', this.platform === 'darwin' ? 'Command' : 'Control');
      try {
        const registered = this.globalShortcut.register(accelerator, () => {
          Promise.resolve(this.execute(shortcut)).catch((error) => this.notify('shortcuts:error', error.message));
        });
        if (!registered) return { ...shortcut, active: true, globalRegistered: false, error: 'Unavailable on the desktop; shortcut remains active inside Avi.' };
        this.registered.add(accelerator);
        return { ...shortcut, active: true, globalRegistered: true };
      } catch (error) {
        return { ...shortcut, active: true, globalRegistered: false, error: error.message };
      }
    });
    this.notify('shortcuts:changed', this.shortcuts);
    return this.shortcuts;
  }

  save(payload = {}) {
    const definitions = this.definitions();
    const changes = payload.changes ?? [payload];
    if (!Array.isArray(changes) || !changes.length) throw new Error('Shortcut changes are required.');
    const overrides = { ...this.read() };
    const ids = new Set();
    for (const { id, pattern, global, reset = false } of changes) {
      if (!definitions.some((item) => item.id === id)) throw new Error('Unknown shortcut.');
      if (ids.has(id)) throw new Error('Duplicate shortcut ID.');
      ids.add(id);
      if (reset) delete overrides[id];
      else {
        if (typeof pattern !== 'string' || typeof global !== 'boolean') throw new Error('Pattern and global mode are required.');
        overrides[id] = { pattern, global };
      }
    }
    resolveShortcuts(definitions, overrides);
    this.write(overrides);
    return this.refresh();
  }
}
