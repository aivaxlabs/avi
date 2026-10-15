import { ExternalLink, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Overlay } from './Overlay.jsx';

const frontmatterPattern = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const blockScalarPattern = /^[>|][+-]?$/;

function readProperty(content, key) {
  const lines = content.match(frontmatterPattern)?.[1].split(/\r?\n/) ?? [];
  const index = lines.findIndex((line) => line.toLowerCase().startsWith(`${key}:`));
  if (index < 0) return null;

  const value = lines[index].slice(key.length + 1).trim();
  if (!blockScalarPattern.test(value)) return value.replace(/^(['"])(.*)\1$/, '$2');

  const block = [];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() && !/^\s/.test(line)) break;
    block.push(line.trim());
  }
  return block.join(' ').trim();
}

function writeProperty(content, key, value) {
  const match = content.match(frontmatterPattern);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = match ? match[1].split(/\r?\n/) : [];
  const index = lines.findIndex((line) => line.toLowerCase().startsWith(`${key}:`));
  let end = index + 1;
  if (index >= 0 && blockScalarPattern.test(lines[index].slice(key.length + 1).trim())) {
    while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end += 1;
  }

  const entry = value === null
    ? []
    : [`${key}: ${/^[\p{L}\p{N} .,()/_-]+$/u.test(value) && value.trim() === value ? value : JSON.stringify(value)}`];
  if (index >= 0) lines.splice(index, end - index, ...entry);
  else lines.push(...entry);

  const body = match ? content.slice(match[0].length) : content;
  return lines.some((line) => line.trim())
    ? ['---', ...lines, '---', ''].join(newline) + body
    : body;
}

export function ContextEditorDialog({ item, kind, readOnly, onClose, onSaved }) {
  const [tab, setTab] = useState('content');
  const [content, setContent] = useState(null);
  const [savedContent, setSavedContent] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef(null);
  const editorHostRef = useRef(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const dirty = content !== null && content !== savedContent;
  const editorVisible = content !== null && tab === 'content';

  useEffect(() => {
    const opener = document.activeElement;
    return () => opener?.isConnected && opener.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.chatApp.context.read(item.path)
      .then((document) => {
        if (cancelled) return;
        setContent(document.content);
        setSavedContent(document.content);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [item.path]);

  useEffect(() => {
    if (!editorVisible) return undefined;
    let editor = null;
    let disposed = false;
    import('../lib/monaco.js').then(({ monaco, applyMonacoTheme }) => {
      if (disposed || !editorHostRef.current) return;
      applyMonacoTheme();
      editor = monaco.editor.create(editorHostRef.current, {
        value: contentRef.current,
        language: 'avi-markdown',
        theme: 'avi',
        readOnly,
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
        insertSpaces: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim(),
        fontSize: 14,
        lineHeight: 22,
        padding: { top: 12, bottom: 12 },
        ariaLabel: `Content of ${item.title}`,
      });
      editor.onDidChangeModelContent(() => setContent(editor.getValue()));
      if (!readOnly) {
        const { KeyCode, KeyMod } = monaco;
        [
          ['bold', 'Bold', '**', '**', KeyMod.CtrlCmd | KeyCode.KeyB],
          ['italic', 'Italic', '*', '*', KeyMod.CtrlCmd | KeyCode.KeyI],
          ['code', 'Inline code', '`', '`', null],
          ['link', 'Link', '[', '](url)', null],
        ].forEach(([id, label, before, after, keybinding], index) => editor.addAction({
          id: `avi.markdown.${id}`,
          label,
          keybindings: keybinding ? [keybinding] : [],
          contextMenuGroupId: '1_markdown',
          contextMenuOrder: index,
          run: (target) => {
            target.pushUndoStop();
            target.executeEdits('markdown-format', target.getSelections().map((range) => ({
              range,
              text: `${before}${target.getModel().getValueInRange(range)}${after}`,
            })));
            target.pushUndoStop();
          },
        }));
      }
      editor.focus();
    });
    return () => {
      disposed = true;
      const model = editor?.getModel();
      editor?.dispose();
      model?.dispose();
    };
  }, [editorVisible, item.title, readOnly]);

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm(`Discard unsaved changes to "${item.title}"?`)) return;
    onClose();
  }

  async function save() {
    if (readOnly || !dirty || saving) return;
    const snapshot = content;
    setSaving(true);
    setError('');
    try {
      await window.chatApp.context.write({ path: item.path, content: snapshot });
      setSavedContent(snapshot);
      onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  }

  function handleDialogKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== 'Tab' || (editorHostRef.current?.contains(event.target) && !readOnly)) return;

    const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
      .filter((element) => element.getClientRects().length);
    if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }

  const nameKey = content !== null && readProperty(content, 'name') === null && readProperty(content, 'title') !== null
    ? 'title'
    : 'name';
  const updateProperty = (key, value) => setContent((current) => writeProperty(current, key, value));

  return (
    <Overlay
      className="dialog-backdrop context-editor-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        className="context-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-editor-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="dialog-header">
          <div>
            <h2 id="context-editor-title">{item.title}{dirty && <span className="context-editor-dirty"> · Unsaved</span>}</h2>
            <p title={item.path}>{item.relativePath || item.path}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close editor" disabled={saving} onClick={requestClose}>
            <X size={16} />
          </button>
        </header>

        <div
          className="context-editor-tabs"
          role="tablist"
          aria-label="Editor views"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const next = tab === 'content' ? 'properties' : 'content';
            setTab(next);
            requestAnimationFrame(() => dialogRef.current?.querySelector(`#context-editor-tab-${next}`)?.focus());
          }}
        >
          {[['content', 'Content'], ['properties', 'Properties']].map(([id, label]) => (
            <button
              key={id}
              id={`context-editor-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`context-editor-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {content === null ? (
          <div className="context-editor-state">{error ? 'Could not open this file.' : 'Loading...'}</div>
        ) : tab === 'content' ? (
          <div
            className="context-editor-surface"
            id="context-editor-panel-content"
            role="tabpanel"
            aria-labelledby="context-editor-tab-content"
          >
            <div ref={editorHostRef} className="context-editor-monaco" />
          </div>
        ) : (
          <div
            className="context-editor-properties"
            id="context-editor-panel-properties"
            role="tabpanel"
            aria-labelledby="context-editor-tab-properties"
          >
            <label className="context-editor-field">
              <span>{nameKey === 'title' ? 'Title' : 'Name'}</span>
              <small>{kind === 'instruction' ? 'Display name in Context.' : 'Display and command name; defaults to the file or folder name.'}</small>
              <input
                className="input"
                type="text"
                value={readProperty(content, nameKey) ?? ''}
                disabled={readOnly}
                onChange={(event) => updateProperty(nameKey, event.target.value ? event.target.value : null)}
              />
            </label>
            <label className="context-editor-field">
              <span>Description</span>
              <small>Shown in the catalog so the agent knows when to use this item.</small>
              <textarea
                className="input"
                rows={4}
                value={readProperty(content, 'description') ?? ''}
                disabled={readOnly}
                onChange={(event) => updateProperty('description', event.target.value ? event.target.value.replace(/\s*\n\s*/g, ' ') : null)}
              />
            </label>
            {kind === 'instruction' ? (
              <label className="context-editor-toggle">
                <span>
                  <strong>Embed automatically</strong>
                  <small>Root instructions are injected into every chat. Turn off to keep only the catalog entry (<code>embeddable: false</code>).</small>
                </span>
                <input
                  className="toggle"
                  type="checkbox"
                  checked={readProperty(content, 'embeddable') !== 'false'}
                  disabled={readOnly}
                  onChange={(event) => updateProperty('embeddable', event.target.checked ? null : 'false')}
                />
              </label>
            ) : (
              <label className="context-editor-toggle">
                <span>
                  <strong>Show in composer picker</strong>
                  <small>Turn off to hide it from the {kind === 'skill' ? '$' : '/'} selector while keeping it available to the agent (<code>user-invocable: false</code>).</small>
                </span>
                <input
                  className="toggle"
                  type="checkbox"
                  checked={readProperty(content, 'user-invocable') !== 'false'}
                  disabled={readOnly}
                  onChange={(event) => updateProperty('user-invocable', event.target.checked ? null : 'false')}
                />
              </label>
            )}
            <p className="context-editor-note">Other frontmatter fields are preserved and can be edited in Content.</p>
          </div>
        )}

        {error && <div className="context-editor-error" role="alert">{error}</div>}

        <footer className="dialog-footer">
          <span className="context-editor-hint">
            {readOnly ? 'Read-only context' : 'Ctrl+M toggles Tab focus · Ctrl+S saves'}
          </span>
          <div>
            <button
              className="button"
              type="button"
              onClick={() => window.chatApp.context.open(item.path).catch((nextError) => {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
              })}
            >
              <ExternalLink size={14} />
              Open externally
            </button>
            {!readOnly && (
              <button className="button primary" type="button" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
              </button>
            )}
          </div>
        </footer>
      </section>
    </Overlay>
  );
}
