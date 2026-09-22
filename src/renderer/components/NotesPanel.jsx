import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive, ArchiveRestore, ArrowDown, ArrowUp, AtSign, CalendarClock, Check, CheckCircle2,
  Circle, Download, Flag, GripVertical, ListChecks, MoreHorizontal, Paperclip, Pencil,
  Plus, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import { compareNotes } from '../../shared/notes.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const priorities = ['none', 'low', 'medium', 'high', 'urgent'];
const editorTabs = [['details', 'Details'], ['subtasks', 'Sub-tasks'], ['attachments', 'Attachments']];
const orders = [['urgency', 'Urgency'], ['createdAt', 'Creation time'], ['updatedAt', 'Updated time'], ['priority', 'Priority'], ['dueAt', 'Due time'], ['manual', 'Manual']];

function NotesMenu({ label, children, filter = false }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const lastItemRef = useRef(false);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const anchor = triggerRef.current.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - bounds.height - 8))}px`;
    const controls = menu.querySelectorAll('button:not(:disabled), select, input');
    (lastItemRef.current ? controls[controls.length - 1] : controls[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className="icon-button tiny" aria-label={label} title={label}
      aria-haspopup={filter ? 'dialog' : 'menu'} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { lastItemRef.current = false; setOpen(!open); }}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        lastItemRef.current = event.key === 'ArrowUp';
        setOpen(true);
      }}>
      {filter ? <SlidersHorizontal size={16} /> : <MoreHorizontal size={15} />}
    </button>
    {open && createPortal(<DropdownMenu ref={menuRef} fixed id={id} role={filter ? 'dialog' : 'menu'} aria-label={label}
      className={filter ? 'notes-dropdown notes-filters' : 'notes-dropdown'}
      onClick={(event) => {
        if (filter || !event.target.closest('button:not(:disabled)')) return;
        triggerRef.current?.focus();
        setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          triggerRef.current?.focus();
          setOpen(false);
        }
        if (filter) return;
        if (event.key === 'Tab') {
          triggerRef.current?.focus();
          setOpen(false);
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>{children}</DropdownMenu>, document.body)}
  </>;
}

export function NotesPanel({ folderPath = null, onAddToChat }) {
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
  const [now, setNow] = useState(Date.now);
  const dragRef = useRef(null);
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  const api = window.chatApp.notes;

  useEffect(() => api.onChanged(() => setRevision((value) => value + 1)), [api]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
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
      <NotesMenu label="Filter by" filter>
          <strong className="dropdown-menu-label">Filter by</strong>
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
      </NotesMenu>
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
              <DropdownMenuItem role="menuitem" icon={<Pencil size={14} />} disabled={busy} onClick={() => setEditor({ ...list, kind: 'list' })}>Rename list</DropdownMenuItem>
              <DropdownMenuItem role="menuitem" icon={list.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} disabled={busy} onClick={() => mutate(() => api.saveList({ id: list.id, archived: !list.archived }))}>{list.archived ? 'Restore list' : 'Archive list'}</DropdownMenuItem>
              <hr className="dropdown-menu-divider" /><div className="dropdown-menu-label">Order by</div>
              {orders.map(([value, label]) => <DropdownMenuItem key={value} role="menuitemradio" aria-checked={list.orderBy === value} active={list.orderBy === value}
                icon={list.orderBy === value ? <Check size={14} /> : <span />} disabled={busy}
                onClick={() => mutate(() => api.saveList({ id: list.id, orderBy: value }))}>{label}</DropdownMenuItem>)}
              <hr className="dropdown-menu-divider" />
              <DropdownMenuItem role="menuitem" icon={<ArrowUp size={14} />} disabled={busy || listIndex === 0} onClick={() => move('list', list.id, visibleLists[listIndex - 1].id)}>Move list up</DropdownMenuItem>
              <DropdownMenuItem role="menuitem" icon={<ArrowDown size={14} />} disabled={busy || listIndex === visibleLists.length - 1} onClick={() => move('list', list.id, visibleLists[listIndex + 1].id)}>Move list down</DropdownMenuItem>
              <hr className="dropdown-menu-divider" />
              <DropdownMenuItem role="menuitem" icon={<Trash2 size={14} />} disabled={busy} onClick={() => setConfirmation({ id: list.id, archivedOnly: true, title: `Delete all archived notes in “${list.name}”?` })}>Delete all archived notes</DropdownMenuItem>
              <DropdownMenuItem role="menuitem" icon={<Trash2 size={14} />} disabled={busy} onClick={() => setConfirmation({ id: list.id, title: `Delete “${list.name}” and all its notes?` })}>Delete list</DropdownMenuItem>
            </NotesMenu>
            </span>
          </summary>
          <ul className="notes-items">
            {items.map((note, index) => {
              const due = note.dueAt ? new Date(note.dueAt) : null;
              const overdue = due && !note.done && !note.archived && !list.archived && due.getTime() < now;
              const dueToday = due && !note.done && !note.archived && !list.archived && due.toDateString() === new Date(now).toDateString();
              const dueLabel = overdue ? 'Overdue' : dueToday ? 'Due today' : 'Due';
              return <li key={note.id} className={`notes-item${note.done ? ' is-done' : ''}`}
              onDragOver={(event) => { if (dragRef.current?.kind === 'note' && dragRef.current.listId === list.id) event.preventDefault(); }}
              onDrop={(event) => { const drag = dragRef.current; if (drag?.kind !== 'note') return; event.preventDefault(); event.stopPropagation(); dragRef.current = null; if (drag.listId === list.id) void move('note', drag.id, note.id, list.id); }}>
              <span className="notes-grip" draggable={!busy} title="Drag to reorder note" onDragStart={(event) => { event.stopPropagation(); dragRef.current = { kind: 'note', id: note.id, listId: list.id }; event.dataTransfer.setData('text/plain', note.id); }} onDragEnd={() => { dragRef.current = null; }}><GripVertical size={13} /></span>
              <input type="checkbox" checked={note.done} disabled={busy} aria-label={`Mark ${note.title} ${note.done ? 'not done' : 'done'}`} onChange={(event) => mutate(() => api.save({ id: note.id, done: event.target.checked }))} />
              <button type="button" className="notes-copy" onClick={() => setEditor({ ...note, kind: 'note', dueAt: note.dueAt ? new Date(Date.parse(note.dueAt) - new Date(note.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' })}>
                <strong>{note.title}</strong>{note.description && <span>{note.description}</span>}
                {(note.priority !== 'none' || due) && <small className="notes-metadata">
                  {note.priority !== 'none' && <span className={`notes-priority is-${note.priority}`}><Flag size={12} />{note.priority[0].toUpperCase() + note.priority.slice(1)} priority</span>}
                  {due && <time dateTime={note.dueAt} title={due.toLocaleString()} className={`notes-due${overdue ? ' is-overdue' : dueToday ? ' is-today' : ''}`}>
                    <CalendarClock size={12} />{dueLabel} · {due.toLocaleString([], { month: 'short', day: 'numeric', ...(due.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' })}
                  </time>}
                </small>}
                {(note.subtasks.length > 0 || note.attachments.length > 0 || note.archived) && <small>{[note.subtasks.length ? `${note.subtasks.filter((task) => task.done).length}/${note.subtasks.length} subtasks` : '', note.attachments.length ? `${note.attachments.length} files` : '', note.archived ? 'Archived' : ''].filter(Boolean).join(' · ')}</small>}
              </button>
              <NotesMenu label={`Options for ${note.title}`}>
                <DropdownMenuItem role="menuitem" icon={<AtSign size={14} />} disabled={!onAddToChat}
                onClick={() => onAddToChat?.({
                  id: crypto.randomUUID(), kind: 'context_marker', markerType: 'note_reference', markerKey: note.id,
                  name: `@${note.title}`, size: 0,
                  text: `Referenced note (snapshot):\n${JSON.stringify({ id: note.id, title: note.title, description: note.description, priority: note.priority, dueAt: note.dueAt, done: note.done, subtasks: note.subtasks.map(({ text, done }) => ({ text, done })) }, null, 2)}`,
                })}>Mention in chat</DropdownMenuItem>
                <DropdownMenuItem role="menuitem" icon={note.done ? <Circle size={14} /> : <CheckCircle2 size={14} />} disabled={busy} onClick={() => mutate(() => api.save({ id: note.id, done: !note.done }))}>{note.done ? 'Set status: Not done' : 'Set status: Done'}</DropdownMenuItem>
                {[['Set due date', 'details', CalendarClock], ['Manage attachments', 'attachments', Paperclip], ['Manage sub-tasks', 'subtasks', ListChecks]].map(([label, tab, Icon]) => <DropdownMenuItem role="menuitem" icon={<Icon size={14} />} key={label} disabled={busy} onClick={() => setEditor({ ...note, kind: 'note', tab, dueAt: note.dueAt ? new Date(Date.parse(note.dueAt) - new Date(note.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' })}>{label}</DropdownMenuItem>)}
                <hr className="dropdown-menu-divider" />
                <DropdownMenuItem role="menuitem" icon={<ArrowUp size={14} />} disabled={busy || index === 0} onClick={() => move('note', note.id, items[index - 1].id, list.id)}>Move up</DropdownMenuItem>
                <DropdownMenuItem role="menuitem" icon={<ArrowDown size={14} />} disabled={busy || index === items.length - 1} onClick={() => move('note', note.id, items[index + 1].id, list.id)}>Move down</DropdownMenuItem>
                <hr className="dropdown-menu-divider" />
                <DropdownMenuItem role="menuitem" icon={note.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} disabled={busy} onClick={() => mutate(() => api.save({ id: note.id, archived: !note.archived }))}>{note.archived ? 'Restore' : 'Archive'}</DropdownMenuItem>
              </NotesMenu>
            </li>;
            })}
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
