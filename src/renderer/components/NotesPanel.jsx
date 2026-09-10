import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Download, GripVertical, MoreHorizontal, Plus, SlidersHorizontal, X } from 'lucide-react';
import { compareNotes } from '../../shared/notes.js';

const priorities = ['none', 'low', 'medium', 'high', 'urgent'];
const editorTabs = [['details', 'Details'], ['subtasks', 'Sub-tasks'], ['attachments', 'Attachments']];
const orders = [['urgency', 'Urgency'], ['createdAt', 'Creation time'], ['updatedAt', 'Updated time'], ['priority', 'Priority'], ['dueAt', 'Due time'], ['manual', 'Manual']];

function NotesMenu({ label, children }) {
  return <details className="notes-menu" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); }
  }}>
    <summary aria-label={label} title={label}><MoreHorizontal size={15} /></summary>
    <div className="notes-menu-content" onClick={(event) => {
      if (event.target.closest('button')) event.currentTarget.parentElement.open = false;
    }}>{children}</div>
  </details>;
}

export function NotesPanel({ folderPath = null }) {
  const [lists, setLists] = useState([]);
  const [notes, setNotes] = useState([]);
  const [filters, setFilters] = useState({ query: '', status: 'active', priority: '', dateField: 'dueAt', after: '', before: '' });
  const [allFolders, setAllFolders] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [revision, setRevision] = useState(0);
  const dragRef = useRef(null);
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  const api = window.chatApp.notes;

  useEffect(() => api.onChanged(() => setRevision((value) => value + 1)), [api]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const scope = allFolders ? {} : { folderPath };
        const [nextLists, result] = await Promise.all([
          api.lists({ ...scope, archived: null }), api.search({ ...scope, archived: null, limit: 5000 }),
        ]);
        if (active) { setLists(nextLists); setNotes(result.notes); if (result.total > 5000) setError('Showing the first 5,000 notes. Narrow the folder scope to see more.'); }
      } catch (failure) { if (active) setError(failure.message); }
      finally { if (active) setLoading(false); }
    }, 50);
    return () => { active = false; clearTimeout(timer); };
  }, [api, allFolders, folderPath, revision]);

  const dialogOpen = Boolean(editor || confirmation);
  useEffect(() => {
    if (!dialogOpen) return undefined;
    const previous = document.activeElement;
    const root = document.getElementById('root');
    const wasInert = root?.inert;
    if (root) root.inert = true;
    ([...dialogRef.current.querySelectorAll('input:not([disabled]), button:not([disabled])')]
      .find((element) => element.getClientRects().length > 0) ?? dialogRef.current).focus();
    return () => {
      if (root) root.inert = wasInert;
      previous?.focus();
    };
  }, [dialogOpen]);

  function closeDialog() {
    if (busyRef.current) return;
    setEditor(null);
    setConfirmation(null);
    setError('');
  }

  async function mutate(action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try { return await action(); }
    catch (failure) { setError(failure.message); return null; }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function move(kind, id, targetId, listId) {
    const orderBy = lists.find((list) => list.id === listId)?.orderBy;
    const items = kind === 'list' ? lists : notes.filter((note) => note.listId === listId)
      .toSorted((a, b) => compareNotes(a, b, orderBy));
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    await mutate(() => api.reorder({ ids, ...(kind === 'note' ? { listId } : {}) }));
  }

  const visibleLists = lists.filter((list) => filters.status === 'all' || filters.status === 'archived' || !list.archived);
  const needle = filters.query.trim().toLowerCase();
  const after = filters.after ? new Date(`${filters.after}T00:00:00`).toISOString() : null;
  const before = filters.before ? new Date(`${filters.before}T23:59:59.999`).toISOString() : null;

  return <div className="notes-panel">
    <div className="notes-toolbar">
      <input type="search" aria-label="Filter notes" placeholder="Filter notes..." value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
      <details className="notes-menu" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); }
      }}>
        <summary aria-label="Filter by" title="Filter by"><SlidersHorizontal size={16} /></summary>
        <div className="notes-menu-content notes-filters">
          <strong>Filter by</strong>
          <label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="active">Not archived</option><option value="open">Not done</option><option value="done">Done</option><option value="archived">Archived</option><option value="all">All</option>
          </select></label>
          <label>Priority<select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
            <option value="">Any priority</option>{priorities.map((priority) => <option key={priority}>{priority}</option>)}
          </select></label>
          <label>Time field<select value={filters.dateField} onChange={(event) => setFilters({ ...filters, dateField: event.target.value })}>
            {orders.filter(([key]) => ['createdAt', 'updatedAt', 'dueAt'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>From<input type="date" value={filters.after} onChange={(event) => setFilters({ ...filters, after: event.target.value })} /></label>
          <label>Through<input type="date" value={filters.before} onChange={(event) => setFilters({ ...filters, before: event.target.value })} /></label>
          <label className="notes-checkbox"><input type="checkbox" checked={allFolders} onChange={(event) => setAllFolders(event.target.checked)} />All working folders</label>
        </div>
      </details>
      <button type="button" className="icon-button" title="New list" aria-label="New list" disabled={busy} onClick={() => setEditor({ kind: 'list', name: '', folderPath })}><Plus size={16} /></button>
    </div>
    <p className="notes-scope" title={folderPath ?? 'No working folder'}>{allFolders ? 'All working folders' : folderPath ?? 'No working folder'}</p>
    {error && !dialogOpen && <p role="alert" className="notes-error">{error}</p>}
    {loading && <p role="status" className="notes-empty">Loading notes...</p>}
    {!loading && visibleLists.length === 0 && <p className="notes-empty">No lists here. Create a list to add your first note.</p>}
    <div className="notes-lists" aria-busy={busy}>
      {visibleLists.map((list, listIndex) => {
        const items = notes.filter((note) => note.listId === list.id
          && (filters.status === 'all' || (filters.status === 'archived' ? note.archived || list.archived : !note.archived && !list.archived))
          && (filters.status !== 'done' || note.done) && (filters.status !== 'open' || !note.done)
          && (!filters.priority || note.priority === filters.priority)
          && (!needle || `${note.title}\n${note.description}\n${note.subtasks.map((item) => item.text).join('\n')}`.toLowerCase().includes(needle))
          && (!after || (note[filters.dateField] && note[filters.dateField] >= after))
          && (!before || (note[filters.dateField] && note[filters.dateField] <= before)))
          .toSorted((a, b) => compareNotes(a, b, list.orderBy));
        return <details key={list.id} className="notes-list" open onDragOver={(event) => { if (dragRef.current?.kind === 'list') event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); const drag = dragRef.current; dragRef.current = null; if (drag?.kind === 'list') void move('list', drag.id, list.id); }}>
          <summary className="notes-list-heading">
            <span draggable={!busy} onDragStart={(event) => { event.stopPropagation(); dragRef.current = { kind: 'list', id: list.id }; event.dataTransfer.setData('text/plain', list.id); }} onDragEnd={() => { dragRef.current = null; }} title="Drag to reorder list"><GripVertical size={14} /></span>
            <strong title={list.folderPath ?? 'No folder'}>{list.name}{list.archived ? ' (archived)' : ''}</strong>
            <span className="notes-list-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <button type="button" disabled={busy || list.archived} onClick={() => setEditor({ kind: 'note', listId: list.id, title: '', description: '', priority: 'none', dueAt: '', subtasks: [] })}><Plus size={13} />New note</button>
            <NotesMenu label={`List options for ${list.name}`}>
              <button type="button" disabled={busy} onClick={() => setEditor({ ...list, kind: 'list' })}>Rename list</button>
              <button type="button" disabled={busy} onClick={() => mutate(() => api.saveList({ id: list.id, archived: !list.archived }))}>{list.archived ? 'Restore list' : 'Archive list'}</button>
              <hr /><strong>Order by</strong>
              {orders.map(([value, label]) => <button type="button" key={value} aria-pressed={list.orderBy === value} disabled={busy} onClick={() => mutate(() => api.saveList({ id: list.id, orderBy: value }))}>{label}{list.orderBy === value ? ' ✓' : ''}</button>)}
              <hr />
              <button type="button" disabled={busy || listIndex === 0} onClick={() => move('list', list.id, visibleLists[listIndex - 1].id)}>Move list up</button>
              <button type="button" disabled={busy || listIndex === visibleLists.length - 1} onClick={() => move('list', list.id, visibleLists[listIndex + 1].id)}>Move list down</button>
              <hr />
              <button type="button" disabled={busy} onClick={() => setConfirmation({ id: list.id, archivedOnly: true, title: `Delete all archived notes in “${list.name}”?` })}>Delete all archived notes</button>
              <button type="button" disabled={busy} onClick={() => setConfirmation({ id: list.id, title: `Delete “${list.name}” and all its notes?` })}>Delete list</button>
            </NotesMenu>
            </span>
          </summary>
          <ul className="notes-items">
            {items.map((note, index) => <li key={note.id} className={`notes-item${note.done ? ' is-done' : ''}`}
              onDragOver={(event) => { if (dragRef.current?.kind === 'note' && dragRef.current.listId === list.id) event.preventDefault(); }}
              onDrop={(event) => { const drag = dragRef.current; if (drag?.kind !== 'note') return; event.preventDefault(); event.stopPropagation(); dragRef.current = null; if (drag.listId === list.id) void move('note', drag.id, note.id, list.id); }}>
              <span className="notes-grip" draggable={!busy} title="Drag to reorder note" onDragStart={(event) => { event.stopPropagation(); dragRef.current = { kind: 'note', id: note.id, listId: list.id }; event.dataTransfer.setData('text/plain', note.id); }} onDragEnd={() => { dragRef.current = null; }}><GripVertical size={13} /></span>
              <input type="checkbox" checked={note.done} disabled={busy} aria-label={`Mark ${note.title} ${note.done ? 'not done' : 'done'}`} onChange={(event) => mutate(() => api.save({ id: note.id, done: event.target.checked }))} />
              <button type="button" className="notes-copy" onClick={() => setEditor({ ...note, kind: 'note', dueAt: note.dueAt ? new Date(Date.parse(note.dueAt) - new Date(note.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' })}>
                <strong>{note.title}</strong>{note.description && <span>{note.description}</span>}
                <small>{[note.priority !== 'none' ? `${note.priority} priority` : '', note.dueAt ? `Due ${new Date(note.dueAt).toLocaleString()}` : '', note.subtasks.length ? `${note.subtasks.filter((task) => task.done).length}/${note.subtasks.length} subtasks` : '', note.attachments.length ? `${note.attachments.length} files` : '', note.archived ? 'Archived' : ''].filter(Boolean).join(' · ')}</small>
              </button>
              <NotesMenu label={`Options for ${note.title}`}>
                <button type="button" disabled={busy} onClick={() => mutate(() => api.save({ id: note.id, done: !note.done }))}>{note.done ? 'Set status: Not done' : 'Set status: Done'}</button>
                {[['Set due date', 'details'], ['Manage attachments', 'attachments'], ['Manage sub-tasks', 'subtasks']].map(([label, tab]) => <button type="button" key={label} onClick={() => setEditor({ ...note, kind: 'note', tab, dueAt: note.dueAt ? new Date(Date.parse(note.dueAt) - new Date(note.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' })}>{label}</button>)}
                <hr />
                <button type="button" disabled={busy || index === 0} onClick={() => move('note', note.id, items[index - 1].id, list.id)}>Move up</button>
                <button type="button" disabled={busy || index === items.length - 1} onClick={() => move('note', note.id, items[index + 1].id, list.id)}>Move down</button>
                <hr /><button type="button" disabled={busy} onClick={() => mutate(() => api.save({ id: note.id, archived: !note.archived }))}>{note.archived ? 'Restore' : 'Archive'}</button>
              </NotesMenu>
            </li>)}
          </ul>
          {items.length === 0 && <p className="notes-empty">No matching notes.</p>}
        </details>;
      })}
    </div>
    {dialogOpen && createPortal(<div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section className="notes-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="notes-dialog-title" tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDialog(); }
          if (event.key !== 'Tab') return;
          const controls = [...event.currentTarget.querySelectorAll('button, input, select, textarea, [tabindex]')]
            .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0);
          const next = event.shiftKey ? controls.at(-1) : controls[0];
          if (!controls.length || document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1)) || document.activeElement === event.currentTarget) {
            event.preventDefault();
            (next ?? event.currentTarget).focus();
          }
        }}>
      <form noValidate onSubmit={async (event) => {
        event.preventDefault();
        const invalid = event.currentTarget.querySelector(':invalid');
        if (invalid) {
          const tab = invalid.closest('[role="tabpanel"]')?.dataset.tab;
          if (tab) setEditor((current) => ({ ...current, tab }));
          requestAnimationFrame(() => { invalid.focus(); invalid.reportValidity(); });
          return;
        }
        const result = await mutate(async () => {
          if (confirmation) return api.deleteList({ id: confirmation.id, archivedOnly: Boolean(confirmation.archivedOnly) });
          if (editor.kind === 'list') return api.saveList({ id: editor.id, name: editor.name, folderPath: editor.folderPath });
          return api.save({ id: editor.id, listId: editor.listId, title: editor.title, description: editor.description, priority: editor.priority,
            dueAt: editor.dueAt ? new Date(editor.dueAt).toISOString() : null, subtasks: editor.subtasks });
        });
        if (result) { setEditor(null); setConfirmation(null); }
      }}>
        <header className="dialog-header"><h2 id="notes-dialog-title">{confirmation ? 'Delete notes' : editor.kind === 'list' ? (editor.id ? 'Rename list' : 'New list') : (editor.id ? 'Edit note' : 'New note')}</h2>
          <button type="button" className="icon-button tiny" disabled={busy} aria-label="Close" onClick={closeDialog}><X size={15} /></button></header>
        {confirmation ? <p>{confirmation.title} This permanently removes the notes and their stored attachments.</p> : editor.kind === 'list' ? <label>List name<input required maxLength={200} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label> : <>
          <div className="notes-editor-tabs" role="tablist" aria-label="Note sections">
            {editorTabs.map(([tab, label], index) => <button key={tab} id={`notes-tab-${tab}`} type="button" role="tab"
              className={(editor.tab ?? 'details') === tab ? 'primary-mini' : 'secondary-mini'}
              aria-selected={(editor.tab ?? 'details') === tab} aria-controls={`notes-panel-${tab}`}
              tabIndex={(editor.tab ?? 'details') === tab ? 0 : -1}
              onClick={() => setEditor({ ...editor, tab })}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? editorTabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + editorTabs.length) % editorTabs.length;
                setEditor({ ...editor, tab: editorTabs[next][0] });
                document.getElementById(`notes-tab-${editorTabs[next][0]}`)?.focus();
              }}>
              {label}{tab !== 'details' && <span>{tab === 'subtasks' ? editor.subtasks.length : (editor.attachments ?? []).length}</span>}
            </button>)}
          </div>
          <section className="notes-tabpanel" id="notes-panel-details" role="tabpanel" aria-labelledby="notes-tab-details" data-tab="details" hidden={(editor.tab ?? 'details') !== 'details'}>
          <label>Title<input required maxLength={500} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
          <label>List<select value={editor.listId} onChange={(event) => setEditor({ ...editor, listId: event.target.value })}>{lists.filter((list) => !list.archived || list.id === editor.listId).map((list) => <option key={list.id} value={list.id}>{list.name}{allFolders ? ` — ${list.folderPath ?? 'No folder'}` : ''}</option>)}</select></label>
          <div className="notes-fields"><label>Priority<select value={editor.priority} onChange={(event) => setEditor({ ...editor, priority: event.target.value })}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
            <label>Due date<input type="datetime-local" value={editor.dueAt} onChange={(event) => setEditor({ ...editor, dueAt: event.target.value })} /></label></div>
          <label>Text<textarea rows={6} maxLength={200000} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
          </section>
          <section className="notes-tabpanel" id="notes-panel-subtasks" role="tabpanel" aria-labelledby="notes-tab-subtasks" data-tab="subtasks" hidden={editor.tab !== 'subtasks'}>
            {editor.subtasks.length === 0 && <p className="notes-tab-empty">Break this note into smaller steps.</p>}
            {editor.subtasks.map((task, index) => <div className="notes-subtask" key={task.id}>
              <input type="checkbox" checked={task.done} aria-label={`Complete subtask ${index + 1}`} onChange={(event) => setEditor({ ...editor, subtasks: editor.subtasks.map((item, at) => at === index ? { ...item, done: event.target.checked } : item) })} />
              <input required maxLength={2000} aria-label={`Subtask ${index + 1}`} value={task.text} onChange={(event) => setEditor({ ...editor, subtasks: editor.subtasks.map((item, at) => at === index ? { ...item, text: event.target.value } : item) })} />
              {[-1, 1].map((direction) => <button type="button" className="icon-button" key={direction} aria-label={`Move subtask ${index + 1} ${direction === -1 ? 'up' : 'down'}`} disabled={index + direction < 0 || index + direction >= editor.subtasks.length} onClick={() => { const next = [...editor.subtasks]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setEditor({ ...editor, subtasks: next }); }}>{direction === -1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</button>)}
              <button type="button" className="icon-button" aria-label={`Remove subtask ${index + 1}`} onClick={() => setEditor({ ...editor, subtasks: editor.subtasks.filter((_, at) => at !== index) })}><X size={13} /></button>
            </div>)}
            <button type="button" disabled={editor.subtasks.length >= 500} onClick={() => setEditor({ ...editor, subtasks: [...editor.subtasks, { id: crypto.randomUUID(), text: '', done: false }] })}>Add sub-task</button>
          </section>
          <section className="notes-tabpanel" id="notes-panel-attachments" role="tabpanel" aria-labelledby="notes-tab-attachments" data-tab="attachments" hidden={editor.tab !== 'attachments'}>
            {!(editor.attachments ?? []).length && <p className="notes-tab-empty">No files attached.</p>}
            {(editor.attachments ?? []).map((attachment) => <div className="notes-attachment" key={attachment.id}><span>{attachment.name} <small>({Math.ceil(attachment.size / 1024)} KiB)</small></span>
              <button type="button" className="icon-button" aria-label={`Save ${attachment.name}`} disabled={busy} onClick={() => mutate(() => api.exportAttachment({ id: editor.id, attachmentId: attachment.id }))}><Download size={14} /></button>
              <button type="button" className="icon-button" aria-label={`Remove ${attachment.name}`} disabled={busy} onClick={async () => { const result = await mutate(() => api.save({ id: editor.id, removeAttachmentIds: [attachment.id] })); if (result) setEditor((current) => ({ ...current, attachments: result.attachments })); }}><X size={14} /></button>
            </div>)}
            <button type="button" disabled={busy || !editor.id} onClick={async () => { const result = await mutate(() => api.pickAttachments({ id: editor.id })); if (result) setEditor((current) => ({ ...current, attachments: result.attachments })); }}>Add files</button>
            <small>{editor.id ? 'Files are copied into Avi (50 MiB each). Attachment changes are saved immediately.' : 'Save the note before adding files.'}</small>
          </section>
        </>}
        {error && <p role="alert" className="notes-error">{error}</p>}
        <footer className="dialog-footer"><button type="button" disabled={busy} onClick={closeDialog}>Cancel</button><button className="primary-mini" type="submit" disabled={busy}>{busy ? 'Saving...' : confirmation ? 'Delete permanently' : 'Save'}</button></footer>
      </form>
      </section>
    </div>, document.body)}
  </div>;
}
