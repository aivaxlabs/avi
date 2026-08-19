import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '../lib/format.js';
import { presetColors } from '../lib/palette.js';

export function TagsManagerDialog({ tags, busy = false, onSave, onClose }) {
  const [draft, setDraft] = useState(() => tags.map((tag) => ({ ...tag })));
  const [paletteFor, setPaletteFor] = useState(null);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  function updateTag(id, changes) {
    setDraft((state) => state.map((tag) => (tag.id === id ? { ...tag, ...changes } : tag)));
  }

  function removeTag(id) {
    setDraft((state) => state.filter((tag) => tag.id !== id));
    setPaletteFor((current) => (current === id ? null : current));
  }

  function addTag() {
    setDraft((state) => [
      ...state,
      {
        id: crypto.randomUUID(),
        name: '',
        color: presetColors[state.length % presetColors.length].value,
      },
    ]);
  }

  function save() {
    onSave(draft
      .filter((tag) => tag.name.trim())
      .map((tag) => ({ ...tag, name: tag.name.trim() })));
  }

  return createPortal(
    <div className="dialog-backdrop tags-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="tags-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tags-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="tags-dialog-title">Manage tags</h2>
          <button className="icon-button tiny" type="button" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="tags-dialog-list">
          {draft.length === 0 && <p className="tags-dialog-empty">No tags yet. Add one below.</p>}
          {draft.map((tag) => (
            <div className="tags-dialog-tag" key={tag.id}>
              <div className="tags-dialog-row">
                <button
                  type="button"
                  className={classNames('tag-dot large clickable', paletteFor === tag.id && 'active')}
                  style={{ backgroundColor: tag.color }}
                  aria-label={`Color for ${tag.name || 'new tag'}`}
                  title="Change color"
                  aria-expanded={paletteFor === tag.id}
                  onClick={() => setPaletteFor((current) => (current === tag.id ? null : tag.id))}
                />
                <input
                  type="text"
                  value={tag.name}
                  placeholder="Tag name"
                  aria-label="Tag name"
                  maxLength={40}
                  onChange={(event) => updateTag(tag.id, { name: event.target.value })}
                />
                <button
                  className="icon-button tiny danger"
                  type="button"
                  aria-label={`Delete tag ${tag.name || '(unnamed)'}`}
                  title="Delete tag"
                  onClick={() => removeTag(tag.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {paletteFor === tag.id && (
                <div className="tags-dialog-palette" role="group" aria-label={`Color for ${tag.name || 'new tag'}`}>
                  {presetColors.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={classNames('color-swatch', tag.color === color.value && 'active')}
                      style={{ backgroundColor: color.value }}
                      aria-label={color.name}
                      aria-pressed={tag.color === color.value}
                      title={color.name}
                      onClick={() => updateTag(tag.id, { color: color.value })}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <button className="tags-dialog-add" type="button" onClick={addTag}>
          <Plus size={14} />
          Add tag
        </button>
        <footer className="dialog-footer tags-dialog-footer">
          <div>
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary-mini" type="button" disabled={busy} onClick={save}>
              {busy ? 'Saving...' : 'Save tags'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
