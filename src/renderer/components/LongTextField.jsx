import { FileText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Overlay, Presence } from './Overlay.jsx';

function describe(value) {
  if (!value.trim()) return 'Empty';
  const lines = value.split(/\r?\n/).length;
  return `${lines} ${lines === 1 ? 'line' : 'lines'}`;
}

export function LongTextField({
  id,
  label,
  value,
  onChange,
  language = 'plaintext',
  placeholder = '',
  invalid = false,
  disabled = false,
  autoFocus = false,
  describedBy,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        id={id}
        className="long-text-button"
        type="button"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={`Edit ${label}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <FileText size={14} aria-hidden="true" />
        <span>{describe(value ?? '')}</span>
      </button>
      {/* Portaled because hosts wrap the trigger in a <label>: clicks inside it would re-activate the trigger and steal the editor's focus. */}
      <Presence when={open}>{() => createPortal(
        <LongTextDialog
          label={label}
          value={value ?? ''}
          language={language}
          placeholder={placeholder}
          onApply={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}</Presence>
    </>
  );
}

function LongTextDialog({ label, value, language, placeholder, onApply, onClose }) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dialogRef = useRef(null);
  const editorHostRef = useRef(null);
  const dirty = draft !== value;

  useEffect(() => {
    const opener = document.activeElement;
    return () => opener?.isConnected && opener.focus();
  }, []);

  useEffect(() => {
    let editor = null;
    let disposed = false;
    import('../lib/monaco.js').then(({ monaco, applyMonacoTheme }) => {
      if (disposed || !editorHostRef.current) return;
      applyMonacoTheme();
      editor = monaco.editor.create(editorHostRef.current, {
        value: draftRef.current,
        language,
        theme: 'avi',
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
        insertSpaces: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        placeholder,
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim(),
        fontSize: 14,
        lineHeight: 22,
        padding: { top: 12, bottom: 12 },
        ariaLabel: label,
      });
      editor.onDidChangeModelContent(() => setDraft(editor.getValue()));
      editor.focus();
    });
    return () => {
      disposed = true;
      const model = editor?.getModel();
      editor?.dispose();
      model?.dispose();
    };
  }, [label, language, placeholder]);

  function requestClose() {
    if (dirty && !window.confirm(`Discard changes to "${label}"?`)) return;
    onClose();
  }

  function handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onApply(draftRef.current);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== 'Tab' || editorHostRef.current?.contains(event.target)) return;

    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
    if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }

  return (
    <Overlay
      className="dialog-backdrop long-text-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        className="long-text-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="long-text-title"
        onKeyDown={handleKeyDown}
      >
        <header className="dialog-header">
          <h2 id="long-text-title">{label}</h2>
          <button className="icon-button tiny" type="button" aria-label="Close editor" onClick={requestClose}>
            <X size={16} />
          </button>
        </header>
        <div className="long-text-surface">
          <div ref={editorHostRef} className="long-text-editor" />
        </div>
        <footer className="dialog-footer">
          <span>Ctrl+M toggles Tab focus · Ctrl+S applies</span>
          <div>
            <button className="button" type="button" onClick={requestClose}>Cancel</button>
            <button className="button primary" type="button" disabled={!dirty} onClick={() => onApply(draft)}>Apply</button>
          </div>
        </footer>
      </section>
    </Overlay>
  );
}
