import { Check, File, Folder, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { classNames } from '../lib/format.js';
import { workspaceAttachment } from './WorkspaceView.jsx';

export function WorkspaceAttachDialog({ workspaceId, onClose, onAttach }) {
  const [path, setPath] = useState('/');
  const [listing, setListing] = useState({ entries: [] });
  const [selected, setSelected] = useState({});
  const [error, setError] = useState('');
  const entries = useMemo(() => sortEntries(listing.entries), [listing.entries]);
  const selectedItems = Object.values(selected);

  useEffect(() => {
    loadPath(path);
  }, [path, workspaceId]);

  async function loadPath(nextPath) {
    setError('');
    try {
      setListing(await window.aivax.workspaceFiles.list({ path: nextPath }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggle(entry) {
    setSelected((items) => {
      const next = { ...items };
      if (next[entry.path]) {
        delete next[entry.path];
      } else {
        next[entry.path] = workspaceAttachment(entry, workspaceId);
      }
      return next;
    });
  }

  function attach() {
    if (selectedItems.length === 0) return;
    onAttach(selectedItems);
    onClose();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="workspace-dialog attach-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Attach from workspace</h2>
            <p>{workspaceId}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="workspace-path">
          {pathSegments(path).map((segment) => (
            <button key={segment.path} type="button" onClick={() => setPath(segment.path)}>
              {segment.label}
            </button>
          ))}
        </div>
        {error && <div className="workspace-error">{error}</div>}
        <div className="attach-list">
          {path !== '/' && (
            <button type="button" onDoubleClick={() => setPath(parentPath(path))}>
              <Folder size={16} />
              <span>..</span>
            </button>
          )}
          {entries.map((entry) => {
            const active = Boolean(selected[entry.path]);
            const Icon = entry.isDirectory ? Folder : File;
            return (
              <div key={entry.path} className={classNames('attach-row', active && 'active')}>
                <button type="button" onClick={() => toggle(entry)}>
                  <span className="workspace-option-check">{active && <Check size={14} />}</span>
                  <Icon size={16} />
                  <span>{entry.name}</span>
                </button>
                {entry.isDirectory && (
                  <button type="button" onClick={() => setPath(entry.path)}>
                    Open
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="dialog-footer">
          <span>{selectedItems.length} selected</span>
          <button className="primary-button" type="button" disabled={selectedItems.length === 0} onClick={attach}>
            Attach
          </button>
        </div>
      </section>
    </div>
  );
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

function pathSegments(path) {
  const parts = path.split('/').filter(Boolean);
  const segments = [{ label: 'Root', path: '/' }];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

function parentPath(path) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}
