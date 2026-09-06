import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, CircleOff, Save } from 'lucide-react';
import { normalizeShortcut, shortcutFromEvent } from '../../shared/keyboard-shortcuts.js';

export function KeyboardShortcuts() {
  useEffect(() => {
    let shortcuts = [];
    let disposed = false;
    const api = window.chatApp.shortcuts;
    const changed = api.onChanged((items) => { shortcuts = items; });
    const executed = api.onExecute(({ id }) => window.dispatchEvent(new CustomEvent('avi:shortcut', { detail: id })));
    api.list().then((items) => { if (!disposed) shortcuts = items; }).catch(console.error);
    const onKey = (event) => {
      if (event.defaultPrevented || event.target.closest?.('[data-shortcut-editor]')) return;
      const pattern = shortcutFromEvent(event, /Mac/.test(navigator.platform));
      const shortcut = shortcuts.find((item) => item.active && item.pattern === pattern);
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || shortcut.globalRegistered) return;
      if (shortcut.pluginId || shortcut.id === 'quick-chat' || shortcut.id.startsWith('zoom.')) {
        api.execute(shortcut.id).catch((error) => window.dispatchEvent(new CustomEvent('avi:shortcut-error', { detail: error.message })));
      } else window.dispatchEvent(new CustomEvent('avi:shortcut', { detail: shortcut.id }));
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      disposed = true;
      changed();
      executed();
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
  return null;
}

export function KeyboardShortcutSettings({ footer }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    let active = true;
    window.chatApp.shortcuts.list().then((value) => { if (active) setItems(value); }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  const conflicts = new Map();
  const patterns = new Map();
  for (const item of items ?? []) {
    const pattern = normalizeShortcut(item.pattern);
    if (!pattern) continue;
    const group = patterns.get(pattern) ?? [];
    group.push(item);
    patterns.set(pattern, group);
  }
  for (const group of patterns.values()) {
    if (group.length < 2) continue;
    for (const item of group) conflicts.set(item.id, group.filter((other) => other.id !== item.id).map((other) => other.title).join(', '));
  }
  return (
    <div className="shortcut-settings" data-shortcut-editor>
      <p className="shortcut-help" id="shortcut-capture-help">Click a field and press a key combination, then Save. Control means Ctrl on Windows/Linux or Command on macOS. Backspace or Delete clears the field; Escape leaves it.</p>
      {saved && <p role="status">{saved}</p>}
      {!items && !error && <p role="status">Loading shortcuts...</p>}
      <div className="shortcut-list">
        <div className="shortcut-list-heading" aria-hidden="true"><span>Action</span><span>Shortcut</span><span>Scope</span><span /></div>
        {items?.map((item) => (
          <section className={`shortcut-row${conflicts.has(item.id) ? ' shortcut-conflict' : ''}`} key={item.id} aria-label={item.title}>
            <div className="shortcut-description">
              <label htmlFor={`shortcut-${item.id}`}>{item.title}</label>
              <small>Default: <code>{item.defaultPattern || 'Disabled'}</code></small>
              {item.pluginId && <small className="shortcut-plugin">Plugin · {item.pluginId}</small>}
            </div>
            <input id={`shortcut-${item.id}`} className="shortcut-pattern" aria-label={`${item.title} pattern`} aria-invalid={conflicts.has(item.id)} aria-describedby={conflicts.has(item.id) ? `shortcut-conflict-${item.id} shortcut-capture-help` : 'shortcut-capture-help'} placeholder="Press shortcut" readOnly value={item.pattern} disabled={busy} onKeyDown={(event) => {
              const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
              if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.repeat || event.isComposing) return;
              if (event.key === 'Escape' && !modified) {
                event.currentTarget.blur();
                return;
              }
              const clear = !modified && ['Backspace', 'Delete'].includes(event.key);
              const pattern = shortcutFromEvent(event, /Mac/.test(navigator.platform));
              if (!clear && !pattern) return;
              setSaved('');
              setError('');
              setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, pattern: clear ? '' : pattern, reset: false, error: null } : entry));
            }} />
            {item.supportsGlobal ? (
              <select className="shortcut-scope" aria-label={`${item.title} scope`} value={item.global ? 'global' : 'app'} disabled={busy} onChange={(event) => { setSaved(''); setItems(items.map((entry) => entry.id === item.id ? { ...entry, global: event.target.value === 'global', reset: false, error: null } : entry)); }}>
                <option value="app">In-App</option><option value="global">Global</option>
              </select>
            ) : <span className="shortcut-scope-label">In-App</span>}
            <div className="shortcut-actions">
              <button type="button" aria-label={`Reset ${item.title}`} title="Reset default" disabled={busy} onClick={() => { setSaved(''); setItems(items.map((entry) => entry.id === item.id ? { ...entry, pattern: entry.defaultPattern, global: entry.defaultGlobal, reset: true, error: null } : entry)); }}><RotateCcw size={15} /></button>
              <button type="button" aria-label={`Disable ${item.title}`} title="Disable shortcut" disabled={busy || !item.pattern} onClick={() => { setSaved(''); setItems(items.map((entry) => entry.id === item.id ? { ...entry, pattern: '', reset: false, error: null } : entry)); }}><CircleOff size={15} /></button>
            </div>
            {conflicts.has(item.id) && <p id={`shortcut-conflict-${item.id}`} className="shortcut-error" role="status">Conflicts with {conflicts.get(item.id)}.</p>}
            {!conflicts.has(item.id) && item.error && <p className="shortcut-error" role="status">{item.error}</p>}
          </section>
        ))}
      </div>
      {footer && createPortal(<>
        <span className="settings-error" role="status">{conflicts.size > 0 ? 'Resolve the highlighted conflicts before saving.' : error}</span>
        <div><button type="button" className="primary-mini" disabled={busy || !items || conflicts.size > 0} onClick={async () => {
          setBusy(true);
          setError('');
          setSaved('');
          try {
            setItems(await window.chatApp.shortcuts.save({ changes: items.map(({ id, pattern, global, reset }) => ({ id, pattern, global, reset })) }));
            setSaved('Keyboard shortcuts saved.');
          } catch (failure) { setError(failure.message); } finally { setBusy(false); }
        }}><Save size={14} />{busy ? 'Saving...' : 'Save changes'}</button></div>
      </>, footer)}
    </div>
  );
}
