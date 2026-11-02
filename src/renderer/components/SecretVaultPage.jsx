import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Vault,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const NAME_PATTERN = /^[A-Za-z0-9_.@-]{1,128}$/;
const vault = () => window.chatApp.secretVault;
const errorText = (reason) => (reason instanceof Error ? reason.message : String(reason));
const formatDate = (value) => (value ? new Date(value).toLocaleString() : '');

function PageHeader({ title, description, onBack, children }) {
  return (
    <header className="settings-page-header">
      <div>
        {onBack && (
          <button className="settings-inline-back" type="button" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
        )}
        <div className="settings-page-title-row">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {children && <div className="secret-vault-header-actions">{children}</div>}
        </div>
      </div>
    </header>
  );
}

function SecretEditor({ entry, onClose, onSaved, onDeleted }) {
  const [draft, setDraft] = useState({ name: entry?.name ?? '', description: entry?.description ?? '', value: '' });
  const [valueLoaded, setValueLoaded] = useState(!entry);
  const [valueChanged, setValueChanged] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const nameInvalid = !NAME_PATTERN.test(draft.name);
  const valueMissing = (!entry || valueChanged) && !draft.value;
  const dirty = draft.name !== (entry?.name ?? '')
    || draft.description !== (entry?.description ?? '')
    || valueChanged;

  async function loadValue() {
    if (valueLoaded) return draft.value;
    const value = await vault().reveal(entry.name);
    setDraft((current) => ({ ...current, value }));
    setValueLoaded(true);
    return value;
  }

  async function toggleReveal() {
    setError('');
    try {
      if (!revealed) await loadValue();
      setRevealed((value) => !value);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(await loadValue());
      setNotice('Value copied to the clipboard.');
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const saved = await vault().save({
        name: draft.name,
        previousName: entry?.name ?? draft.name,
        description: draft.description,
        value: valueChanged || !entry ? draft.value : undefined,
      });
      onSaved(saved);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the secret "${entry.name}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await vault().remove(entry.name);
      onDeleted();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (dirty && !window.confirm('Discard unsaved changes to this secret?')) return;
    onClose();
  }

  return (
    <>
      <PageHeader
        title={entry ? entry.name : 'New secret'}
        description={entry
          ? `Created ${formatDate(entry.createdAt)} · Updated ${formatDate(entry.updatedAt)}`
          : 'Store one value per secret, such as a single password or API key.'}
        onBack={close}
      />
      <div className="settings-content">
        <div className="settings-content-inner secret-vault-editor">
          <fieldset className="settings-section-card settings-form settings-row-card secret-vault-fieldset" aria-label="Secret" disabled={saving}>
            <label className="settings-field">
              <span>Name</span>
              <small>Letters, digits, ".", "_", "-", or "@", for example user_john_gmail.password.</small>
              <input className="input" type="text" value={draft.name} maxLength={128} spellCheck={false}
                aria-invalid={Boolean(draft.name) && nameInvalid}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="settings-field">
              <span>Description</span>
              <small>Optional. Visible to agents in secret_vault_list.</small>
              <input className="input" type="text" value={draft.description} maxLength={500}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <div className="settings-field secret-vault-value-field">
              <span>Value</span>
              <small id="secret-vault-value-help">
                {entry && !valueChanged ? 'Leave hidden to keep the current value, or type to replace it.' : 'Encrypted on this device. Agents never receive it directly.'}
              </small>
              <div className="secret-vault-value-actions">
                <button className="button" type="button" disabled={!entry && !draft.value} onClick={() => void toggleReveal()}>
                  {revealed ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  {revealed ? 'Hide secret' : 'Reveal secret'}
                </button>
                <button className="button" type="button" disabled={!entry && !draft.value} onClick={() => void copy()}>
                  <Copy size={14} aria-hidden="true" />
                  Copy
                </button>
              </div>
              <textarea className="input secret-vault-value" value={draft.value} rows={3} spellCheck={false}
                autoComplete="off" data-masked={!revealed} aria-label="Value" aria-describedby="secret-vault-value-help"
                aria-invalid={valueMissing && valueChanged}
                placeholder={entry && !valueLoaded ? '••••••••' : ''}
                onChange={(event) => {
                  setValueLoaded(true);
                  setValueChanged(true);
                  setDraft((current) => ({ ...current, value: event.target.value }));
                }} />
            </div>
          </fieldset>
          {entry && (
            <section className="settings-section">
              <div className="settings-section-card settings-form settings-row-card">
                <div className="settings-card-row">
                  <span><strong>Delete secret</strong><small>Placeholders already issued to agents stop resolving.</small></span>
                  <button className="button danger" type="button" disabled={saving} onClick={() => void remove()}>
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      <footer className="settings-actions">
        <span className="settings-error" role={error ? 'alert' : 'status'}>
          {error || notice || (dirty ? 'Unsaved changes' : '')}
        </span>
        <div>
          <button className="button" type="button" disabled={saving} onClick={close}>Cancel</button>
          <button className="button primary" type="button" disabled={saving || nameInvalid || valueMissing || !dirty}
            onClick={() => void save()}>
            <Save size={14} aria-hidden="true" />
            {saving ? 'Saving...' : entry ? 'Save' : 'Add secret'}
          </button>
        </div>
      </footer>
    </>
  );
}

export function SecretVaultPage() {
  const [entries, setEntries] = useState(null);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    vault().list()
      .then((items) => {
        if (!active) return;
        setEntries(items);
        setError('');
      })
      .catch((reason) => active && setError(errorText(reason)));
    return () => { active = false; };
  }, [refreshKey]);

  const backToList = () => {
    setView(null);
    setRefreshKey((key) => key + 1);
  };

  let body;
  if (view) {
    body = (
      <SecretEditor key={view.entry?.name ?? 'new'} entry={view.entry} onClose={() => setView(null)}
        onSaved={backToList} onDeleted={backToList} />
    );
  } else {
    const query = filter.trim().toLowerCase();
    const visible = (entries ?? []).filter((entry) => !query
      || entry.name.toLowerCase().includes(query)
      || entry.description.toLowerCase().includes(query));
    body = (
      <>
        <PageHeader title="Secret Vault" description="Logins, API keys, and other credentials, encrypted on this device with the operating system's secure storage.">
          <button className="button" type="button" onClick={() => setRefreshKey((key) => key + 1)}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </button>
          <button className="button primary" type="button" onClick={() => setView({ entry: null })}>
            <Plus size={14} aria-hidden="true" />
            New secret
          </button>
        </PageHeader>
        <div className="settings-content">
          <div className="settings-content-inner secret-vault-list">
            <section className="settings-section" aria-busy={!entries && !error}>
              {error && <p className="settings-context-error" role="alert">{error}</p>}
              <div className="settings-list-summary">
                <span>{entries ? `${visible.length} ${visible.length === 1 ? 'secret' : 'secrets'}` : ''}</span>
                <input className="input" type="search" aria-label="Filter secrets" placeholder="Filter by name or description"
                  value={filter} onChange={(event) => setFilter(event.target.value)} />
              </div>
              {!entries ? (
                !error && <p className="settings-empty" role="status">Loading...</p>
              ) : visible.length === 0 ? (
                <div className="settings-empty">
                  <Vault size={22} aria-hidden="true" />
                  <strong>{query ? 'No matching secrets' : 'The vault is empty'}</strong>
                  <span>{query ? 'Try another name or description.' : 'Agents save credentials here when you share them, or add one yourself.'}</span>
                </div>
              ) : (
                <div className="settings-entity-list">
                  {visible.map((entry) => (
                    <article key={entry.name} className="settings-entity-row">
                      <button className="settings-entity-main" type="button" onClick={() => setView({ entry })}>
                        <span className="settings-entity-icon"><KeyRound size={16} aria-hidden="true" /></span>
                        <span className="settings-entity-copy">
                          <strong>{entry.name}</strong>
                          <small>
                            {entry.description && `${entry.description} · `}
                            Updated {formatDate(entry.updatedAt)}
                          </small>
                        </span>
                        <ArrowRight className="settings-entity-arrow" size={15} aria-hidden="true" />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </>
    );
  }

  return (
    <section className="settings-page secret-vault-page" aria-label="Secret Vault">
      <main className="settings-main">{body}</main>
    </section>
  );
}
