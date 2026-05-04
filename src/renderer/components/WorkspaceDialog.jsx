import { Check, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { classNames } from '../lib/format.js';

export function WorkspaceDialog({ workspaceState, onClose, onChange }) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState('');
  const activeWorkspaceId = workspaceState?.activeWorkspaceId ?? null;
  const workspaces = workspaceState?.workspaces ?? [];

  async function addWorkspace(event) {
    event.preventDefault();
    const nextId = workspaceId.trim();
    if (!nextId) {
      setError('Workspace ID is required.');
      return;
    }
    setError('');
    onChange(await window.aivax.workspaces.add(nextId));
    setWorkspaceId('');
  }

  async function setActive(id) {
    setError('');
    onChange(await window.aivax.workspaces.setActive(id));
  }

  async function removeWorkspace(id) {
    setError('');
    onChange(await window.aivax.workspaces.remove(id));
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="workspace-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Switch workspace</h2>
            <p>Choose the file sandbox used by chat and agents.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <form className="workspace-add-form" onSubmit={addWorkspace}>
          <input
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            placeholder="Workspace ID"
          />
          <button className="primary-mini" type="submit">
            <Plus size={15} />
            Add
          </button>
        </form>
        {error && <div className="inline-error">{error}</div>}
        <div className="workspace-list">
          <WorkspaceOption
            id=""
            label="No workspace"
            active={!activeWorkspaceId}
            onSelect={() => setActive(null)}
          />
          {workspaces.map((workspace) => (
            <WorkspaceOption
              key={workspace.id}
              id={workspace.id}
              label={workspace.id}
              active={workspace.id === activeWorkspaceId}
              onSelect={() => setActive(workspace.id)}
              onRemove={() => removeWorkspace(workspace.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkspaceOption({ label, active, onSelect, onRemove }) {
  return (
    <div className={classNames('workspace-option', active && 'active')}>
      <button type="button" onClick={onSelect}>
        <span className="workspace-option-check">{active && <Check size={14} />}</span>
        <span>{label}</span>
      </button>
      {onRemove && (
        <button className="workspace-remove" type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
