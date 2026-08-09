import {
  Archive,
  Database,
  HardDrive,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const retentionOptions = [
  { value: '7', label: 'After 7 days' },
  { value: '30', label: 'After 30 days' },
  { value: 'never', label: 'Never' },
];
const archivedDeletionOptions = [
  { value: '30', label: 'After 30 days' },
  { value: '60', label: 'After 60 days' },
  { value: 'never', label: 'Never' },
];
const disposableDeletionOptions = [
  { value: '1', label: 'After 1 day' },
  { value: '7', label: 'After 7 days' },
  { value: '30', label: 'After 30 days' },
  { value: 'never', label: 'Never' },
];
const byteFormatter = new Intl.NumberFormat('en-US', {
  style: 'unit',
  unit: 'megabyte',
  maximumFractionDigits: 1,
});

export function ArchiveSettings() {
  const [state, setState] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [temporaryStorage, setTemporaryStorage] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    window.chatApp.archive.state()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    window.chatApp.archive.temporaryStorage()
      .then((storage) => {
        if (active) setTemporaryStorage(storage);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, []);

  const conversations = (state?.conversations ?? []).filter((conversation) => {
    const term = query.trim().toLowerCase();
    return !term || `${conversation.title} ${conversation.firstPrompt}`.toLowerCase().includes(term);
  });

  async function run(mutation) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await mutation();
      setState(next);
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="settings-section archive-settings">
        <div className="settings-empty">Loading archive...</div>
        {error && <div className="settings-context-error" role="alert">{error}</div>}
      </section>
    );
  }

  return (
    <div className="archive-settings">
      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Archive Settings</h3>
          <p>Keep the active thread list fast by moving old conversations out of the main view.</p>
        </div>
        <div className="settings-section-card settings-row-card">
          <label className="settings-field settings-field-wide">
            <span>Automatically archive old conversations</span>
            <select
              disabled={busy}
              value={state.settings.archiveAfterDays ?? 'never'}
              onChange={(event) => run(() => window.chatApp.archive.save({
                ...state.settings,
                archiveAfterDays: event.target.value === 'never' ? null : Number(event.target.value),
              }))}
            >
              {retentionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-field settings-field-wide">
            <span>Automatically delete archived conversations</span>
            <select
              disabled={busy}
              value={state.settings.deleteArchivedAfterDays ?? 'never'}
              onChange={(event) => run(() => window.chatApp.archive.save({
                ...state.settings,
                deleteArchivedAfterDays: event.target.value === 'never' ? null : Number(event.target.value),
              }))}
            >
              {archivedDeletionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-field settings-field-wide">
            <span>Automatically delete disposable conversations</span>
            <select
              disabled={busy}
              value={state.settings.deleteDisposableAfterDays ?? 'never'}
              onChange={(event) => run(() => window.chatApp.archive.save({
                ...state.settings,
                deleteDisposableAfterDays: event.target.value === 'never' ? null : Number(event.target.value),
              }))}
            >
              {disposableDeletionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Archive List</h3>
          <p>Search, restore, or permanently delete archived conversation threads.</p>
        </div>
        <div className="archive-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            placeholder="Search archived conversations..."
            aria-label="Search archived conversations"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="settings-section-card archive-list">
          {conversations.length ? conversations.map((conversation) => (
            <div className="archive-row" key={conversation.id}>
              <span className="settings-entity-icon"><Archive size={16} /></span>
              <span className="archive-copy">
                <strong>{conversation.title || conversation.firstPrompt || 'Untitled conversation'}</strong>
                <small>
                  Archived {new Date(conversation.archivedAt).toLocaleDateString()}
                  {' · '}{conversation.projectDisplayPath}
                </small>
              </span>
              <span className="archive-actions">
                <button
                  type="button"
                  disabled={busy}
                  title="Restore conversation"
                  onClick={() => run(() => window.chatApp.archive.restore(conversation.id))}
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
                <button
                  className="danger"
                  type="button"
                  disabled={busy}
                  title="Delete permanently"
                  onClick={() => {
                    if (!window.confirm('Permanently delete this conversation and all of its child conversations? This cannot be undone.')) return;
                    run(() => window.chatApp.archive.delete(conversation.id));
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </span>
            </div>
          )) : (
            <div className="settings-empty archive-empty">
              {query ? 'No archived conversations match your search.' : 'No archived conversations.'}
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Maintenance</h3>
          <p>Review storage usage or apply all archive policies immediately.</p>
        </div>
        <div className="archive-stats">
          <div><Database size={16} /><span><strong>{state.stats.total}</strong>Total conversations</span></div>
          <div><Database size={16} /><span><strong>{state.stats.active}</strong>Active conversations</span></div>
          <div><Archive size={16} /><span><strong>{state.stats.archived}</strong>Archived conversations</span></div>
          <div><HardDrive size={16} /><span><strong>{byteFormatter.format(state.stats.diskBytes / 1_048_576)}</strong>Conversation storage</span></div>
        </div>
        <div className="settings-section-card archive-maintenance">
          <span>
            <strong>Temporary storage</strong>
            <small>{temporaryStorage ? `${byteFormatter.format(temporaryStorage.bytes / 1_048_576)} in ${temporaryStorage.path}` : 'Calculating temporary storage...'}</small>
          </span>
          <button
            className="danger"
            type="button"
            disabled={busy || !temporaryStorage?.bytes}
            onClick={async () => {
              if (!window.confirm('Delete all Avi temporary storage? Temporary attachments, tool outputs, logs, and cached media will be permanently removed.')) return;
              setBusy(true);
              setError('');
              setNotice('');
              try {
                const storage = await window.chatApp.archive.clearTemporaryStorage();
                setTemporaryStorage(storage);
                setNotice('Temporary storage deleted.');
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={14} />
            Delete temporary storage
          </button>
        </div>
        <div className="settings-section-card archive-maintenance">
          <span>
            <strong>Forced cleanup</strong>
            <small>Archives old threads, deletes expired archive entries, and removes expired side chats and sub-agents using the policies above.</small>
          </span>
          <button
            className="danger"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Run forced cleanup now? Eligible conversations will be archived or permanently deleted according to the current settings.')) return;
              const next = await run(() => window.chatApp.archive.maintenance());
              if (next?.maintenance) {
                setNotice(`Cleanup complete: ${next.maintenance.archived} archived, ${next.maintenance.deletedArchived} archived deleted, ${next.maintenance.deletedDisposable} disposable deleted.`);
              }
            }}
          >
            <Trash2 size={14} />
            Run forced cleanup
          </button>
        </div>
      </section>

      {notice && <div className="settings-context-status" role="status">{notice}</div>}
      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </div>
  );
}
