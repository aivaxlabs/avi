import { Folder, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function WorkspaceDialog({ project = null, onClose, onSave }) {
  const dialogRef = useRef(null);
  const [name, setName] = useState(project?.name ?? '');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(Boolean(project));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current.showModal();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (!project) return;
    let active = true;
    window.chatApp.workspaces.get({ path: project.path }).then((workspace) => {
      if (active) {
        setFolders(workspace.folders);
        setLoading(false);
      }
    }).catch((failure) => {
      if (active) setError(failure.message);
    });
    return () => { active = false; };
  }, [project]);

  return createPortal(
    <dialog ref={dialogRef} className="workspace-dialog" aria-labelledby="workspace-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (busy || loading) return;
        setBusy(true);
        setError('');
        try {
          const workspace = await window.chatApp.workspaces.save({ path: project?.path, name, folders });
          onSave?.(workspace);
          onClose();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      }}>
        <div className="dialog-header">
          <h2 id="workspace-dialog-title">{project ? 'Edit workspace' : 'Create workspace'}</h2>
          <button className="icon-button tiny" type="button" disabled={busy} onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="workspace-dialog-body">
          <label>Workspace name
            <input value={name} required maxLength={120} disabled={busy || Boolean(project)}
              onChange={(event) => setName(event.target.value)} />
          </label>
          <p className="workspace-location">~/.aivax/workspaces/{name.trim() || 'workspace-name'}</p>
          <div className="workspace-folders-heading">Linked folders <span>{folders.length}</span></div>
          {loading && !error && <p role="status">Loading folders...</p>}
          {!loading && folders.length === 0 && <p className="workspace-empty">Add the folders you want to work with together.</p>}
          {folders.map((folder, index) => (
            <div className="workspace-folder-row" key={folder.path}>
              <Folder size={17} aria-hidden="true" />
              <label>
                <input aria-label={`Link name for ${folder.path}`} title="Edit link name" value={folder.name} required disabled={busy}
                  onChange={(event) => setFolders((items) => items.map((item, position) => (
                    position === index ? { ...item, name: event.target.value } : item
                  )))} />
                <span title={folder.path}>{folder.path}{folder.available === false ? ' (unavailable)' : ''}</span>
              </label>
              <button className="icon-button tiny" type="button" disabled={busy} aria-label={`Remove ${folder.name}`}
                onClick={() => setFolders((items) => items.filter((_, position) => position !== index))}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
        </div>
        <p className="workspace-note">Removing a link keeps the original folder untouched.</p>
        <div className="workspace-dialog-footer">
          <button className="workspace-add" type="button" disabled={busy || loading} onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const selected = await window.chatApp.projects.select();
              if (selected) setFolders((items) => items.some((item) => item.path === selected.path)
                ? items : [...items, { name: selected.name, path: selected.path }]);
            } catch (failure) {
              setError(failure.message);
            } finally {
              setBusy(false);
            }
          }}><Plus size={14} /> Add folder</button>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="workspace-submit" disabled={busy || loading || !name.trim()}>
            {busy ? 'Saving...' : project ? 'Save workspace' : 'Create workspace'}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
