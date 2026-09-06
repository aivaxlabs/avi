import assert from 'node:assert/strict';
import { defaultShortcuts, normalizeShortcut, resolveShortcuts, shortcutFromEvent } from '../src/shared/keyboard-shortcuts.js';
import { KeyboardShortcuts } from '../src/main/keyboard-shortcuts.js';

assert.equal(defaultShortcuts.length, 14);
assert.equal(normalizeShortcut('ctrl+shift+k'), 'Control+Shift+K');
assert.equal(normalizeShortcut('Control++'), 'Control+Plus');
assert.equal(normalizeShortcut('Control+Shift+Plus'), 'Control+Plus');
assert.equal(normalizeShortcut(''), '');
assert.throws(() => normalizeShortcut('K'));
assert.throws(() => normalizeShortcut('Control+Control+K'));
assert.equal(shortcutFromEvent({ key: 'K', metaKey: true, shiftKey: true }, true), 'Control+Shift+K');
assert.equal(shortcutFromEvent({ key: '+', ctrlKey: true, shiftKey: true }), 'Control+Plus');
assert.equal(shortcutFromEvent({ key: 'q', ctrlKey: true, isComposing: true }), '');
assert.equal(shortcutFromEvent({ key: 'q', ctrlKey: true, getModifierState: () => true }), '');
assert.throws(() => resolveShortcuts(defaultShortcuts, { 'model.previous': { pattern: 'Control+E' } }), /conflicts/);
assert.throws(() => resolveShortcuts(defaultShortcuts, { 'model.previous': { global: true } }), /global/);
let overrides = {};
const registrations = new Map();
let executed;
const manager = new KeyboardShortcuts({
  platform: 'darwin',
  globalShortcut: {
    register(pattern, callback) { if (pattern === 'Command+Alt+X') return false; registrations.set(pattern, callback); return true; },
    unregister(pattern) { registrations.delete(pattern); },
  },
  plugins: { getContributions: () => [{ id: 'demo', pluginId: 'test', title: 'Demo', pattern: 'Control+Alt+D', supportsGlobal: true }] },
  read: () => overrides,
  write: (value) => { overrides = value; },
  execute: (shortcut) => { executed = shortcut.id; },
  notify() {},
});
manager.refresh();
assert.equal(registrations.size, 1);
registrations.get('Command+Alt+S')();
assert.equal(executed, 'quick-chat');
manager.save({ id: 'quick-chat', pattern: '', global: true });
assert.equal(registrations.size, 0);
manager.save({ id: 'quick-chat', reset: true });
assert.equal(registrations.size, 1);
manager.save({ id: 'quick-chat', pattern: 'Control+Alt+X', global: true });
assert.equal(manager.shortcuts.find((item) => item.id === 'quick-chat').globalRegistered, false);
assert.match(manager.shortcuts.find((item) => item.id === 'quick-chat').error, /Unavailable/);
assert.throws(() => manager.save({ id: 'missing', reset: true }), /Unknown/);
assert.throws(() => manager.save({ id: 'model.next', pattern: 'Control+Q', global: false }), /conflicts/);
manager.save({ id: 'plugin:test:demo', pattern: 'Control+Alt+D', global: true });
assert.ok(registrations.has('Command+Alt+D'));
manager.save({ changes: [
  { id: 'model.previous', pattern: 'Control+E', global: false },
  { id: 'model.next', pattern: 'Control+Q', global: false },
] });
assert.equal(overrides['model.previous'].pattern, 'Control+E');
assert.equal(overrides['model.next'].pattern, 'Control+Q');
const beforeInvalidBatch = JSON.stringify(overrides);
assert.throws(() => manager.save({ changes: [
  { id: 'model.previous', pattern: 'Control+X', global: false },
  { id: 'model.next', pattern: 'Control+X', global: false },
] }), /conflicts/);
assert.equal(JSON.stringify(overrides), beforeInvalidBatch);
manager.save({ changes: [{ id: 'model.previous', reset: true }, { id: 'model.next', reset: true }] });
assert.equal(overrides['model.previous'], undefined);
assert.throws(() => manager.save({ changes: [] }), /required/);
assert.throws(() => manager.save({ changes: [{ id: 'model.next', reset: true }, { id: 'model.next', reset: true }] }), /Duplicate/);
console.log('Keyboard shortcut defaults, normalization, conflicts, atomic batch persistence, reset, plugins and global registration passed.');
