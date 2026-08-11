import { ChevronDown, ExternalLink, LoaderCircle, LogOut, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

export function AivaxFeaturesSettings() {
  const [state, setState] = useState(null);
  const [collections, setCollections] = useState([]);
  const [loginKey, setLoginKey] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collectionCreateOpen, setCollectionCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.chatApp.aivax.state()
      .then((nextState) => {
        if (active) setState(nextState);
        if (active && nextState.connected) return window.chatApp.aivax.collections();
        return [];
      })
      .then((items) => {
        if (active) setCollections(Array.isArray(items) ? items : []);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, []);

  if (!state) {
    return (
      <div className="aivax-settings-loading">
        <LoaderCircle size={18} />
        Loading AIVAX account...
      </div>
    );
  }

  return (
    <div className="settings-tuning aivax-features-settings">
      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Account</h3>
          <p>Connect Avi to AIVAX using a login key. The resulting access token is encrypted locally.</p>
        </div>
        <div className="settings-section-card settings-row-card">
          {state.connected ? (
            <>
              <div className="settings-card-row aivax-account-row">
                <span>
                  <strong>Login key</strong>
                  <small>Connected · ••••••••••••••••</small>
                </span>
                <div className="aivax-account-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        setState(await window.chatApp.aivax.disconnect());
                        setCollections([]);
                      } catch (nextError) {
                        setError(nextError instanceof Error ? nextError.message : String(nextError));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <LogOut size={14} />
                    Disconnect
                  </button>
                </div>
              </div>
              <div className="settings-card-row aivax-account-row">
                <span>
                  <strong>Current balance</strong>
                  <small>{currencyFormatter.format(Number(state.account?.balance) || 0)}</small>
                </span>
                <div className="aivax-account-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => window.chatApp.app.openExternal('https://console.aivax.net/dashboard/usage')}
                  >
                    Add balance
                    <ExternalLink size={13} />
                  </button>
                </div>
              </div>
              <div className="settings-card-row aivax-account-row">
                <span>
                  <strong>Usage · last 24 hours</strong>
                  <small>{currencyFormatter.format(Number(state.account?.usage24h) || 0)}</small>
                </span>
                <div className="aivax-account-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        setState(await window.chatApp.aivax.state());
                      } catch (nextError) {
                        setError(nextError instanceof Error ? nextError.message : String(nextError));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RefreshCw size={13} />
                    Refresh
                  </button>
                </div>
              </div>
              <div className="settings-card-row aivax-account-row">
                <span>
                  <strong>Plan</strong>
                  <small>{Array.isArray(state.account?.plan)
                    ? state.account.plan.join(', ') || 'Unknown'
                    : state.account?.plan || 'Unknown'}</small>
                </span>
              </div>
            </>
          ) : (
            <form
              className="aivax-connect-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const nextState = await window.chatApp.aivax.connect(loginKey);
                  setState(nextState);
                  setLoginKey('');
                  const items = await window.chatApp.aivax.collections();
                  setCollections(Array.isArray(items) ? items : []);
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : String(nextError));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="settings-field settings-field-wide">
                <span>Login key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={loginKey}
                  onChange={(event) => setLoginKey(event.target.value)}
                  placeholder="Paste your AIVAX login key"
                />
                <small>The login key is exchanged once and is never shown again.</small>
              </label>
              <button className="button button-primary" type="submit" disabled={busy || !loginKey.trim()}>
                {busy && <LoaderCircle className="aivax-spinner" size={14} />}
                Connect account
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Memory</h3>
          <p>Give Avi persistent memory tools through an AIVAX RAG collection.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          <label className="settings-toggle-row">
            <span>
              <strong>Enable memory features</strong>
              <small>Add persistent memory search, write, and delete tools to agents.</small>
            </span>
            <input
              className="appearance-desktop-switch"
              type="checkbox"
              disabled={!state.connected || !state.settings.memoryCollectionId || busy}
              checked={state.settings.memoryEnabled}
              onChange={async (event) => {
                setBusy(true);
                setError('');
                try {
                  const settings = await window.chatApp.aivax.save({
                    ...state.settings,
                    memoryEnabled: event.target.checked,
                  });
                  setState((current) => ({ ...current, settings }));
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : String(nextError));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <div className="settings-card-row aivax-collection-row">
            <span>
              <strong>Memory collection</strong>
              <small>{state.settings.memoryCollectionName ?? 'Choose where Avi should store persistent memory.'}</small>
            </span>
            <button
              className="button button-secondary aivax-collection-picker-trigger"
              type="button"
              disabled={!state.connected || busy}
              onClick={() => setCollectionPickerOpen(true)}
            >
              {state.settings.memoryCollectionName ?? 'Select a collection'}
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      </section>

      {collectionPickerOpen && (
        <div className="dialog-backdrop aivax-collection-dialog-backdrop" onMouseDown={() => !busy && setCollectionPickerOpen(false)}>
          <section
            className="aivax-collection-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aivax-collection-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) setCollectionPickerOpen(false);
            }}
          >
            <header className="dialog-header">
              <div>
                <h2 id="aivax-collection-dialog-title">Choose a memory collection</h2>
                <p>Select where Avi can save and retrieve persistent memory.</p>
              </div>
              <button className="icon-button tiny" type="button" aria-label="Close collection picker" disabled={busy} onClick={() => setCollectionPickerOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <div className="aivax-collection-list" role="listbox" aria-label="AIVAX collections">
              {collections.map((collection) => {
                const selected = collection.id === state.settings.memoryCollectionId;
                return (
                  <button
                    className={selected ? 'selected' : ''}
                    key={collection.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const settings = await window.chatApp.aivax.save({
                          ...state.settings,
                          memoryEnabled: state.settings.memoryEnabled,
                          memoryCollectionId: collection.id,
                          memoryCollectionName: collection.name,
                        });
                        setState((current) => ({ ...current, settings }));
                        setCollectionPickerOpen(false);
                      } catch (nextError) {
                        setError(nextError instanceof Error ? nextError.message : String(nextError));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <span>
                      <strong>{collection.name}</strong>
                      <small>{collection.documentCount?.totalDocuments ?? 0} documents</small>
                    </span>
                    {selected && <span className="aivax-collection-selected">Selected</span>}
                  </button>
                );
              })}
              {collections.length === 0 && <p className="aivax-collection-empty">No collections yet. Create your first one to use memory.</p>}
            </div>
            <button
              className="button button-secondary aivax-collection-create-trigger"
              type="button"
              disabled={busy}
              onClick={() => {
                setCollectionPickerOpen(false);
                setCollectionCreateOpen(true);
              }}
            >
              <Plus size={14} />
              Create new collection
            </button>
          </section>
        </div>
      )}

      {collectionCreateOpen && (
        <div className="dialog-backdrop aivax-collection-dialog-backdrop" onMouseDown={() => !busy && setCollectionCreateOpen(false)}>
          <section
            className="aivax-collection-dialog aivax-collection-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aivax-collection-create-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) setCollectionCreateOpen(false);
            }}
          >
            <header className="dialog-header">
              <div>
                <h2 id="aivax-collection-create-dialog-title">Create a new collection</h2>
                <p>Give the collection a clear name so it is easy to find later.</p>
              </div>
              <button className="icon-button tiny" type="button" aria-label="Close collection creation dialog" disabled={busy} onClick={() => setCollectionCreateOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <form
              className="aivax-collection-create"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!newCollectionName.trim()) return;
                setBusy(true);
                setError('');
                try {
                  const created = await window.chatApp.aivax.createCollection(newCollectionName.trim());
                  setCollections(Array.isArray(created.collections) ? created.collections : []);
                  setNewCollectionName('');
                  if (created.collection) {
                    const settings = await window.chatApp.aivax.save({
                      ...state.settings,
                      memoryCollectionId: created.collection.id,
                      memoryCollectionName: created.collection.name,
                    });
                    setState((current) => ({ ...current, settings }));
                  }
                  setCollectionCreateOpen(false);
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : String(nextError));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                <span>Collection name</span>
                <input autoFocus value={newCollectionName} disabled={busy} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="e.g. Team knowledge" />
              </label>
              <div className="aivax-collection-create-actions">
                <button className="button button-secondary" type="button" disabled={busy} onClick={() => setCollectionCreateOpen(false)}>
                  Cancel
                </button>
                <button className="button button-primary" type="submit" disabled={busy || !newCollectionName.trim()}>
                  {busy ? <LoaderCircle className="aivax-spinner" size={14} /> : <Plus size={14} />}
                  Create collection
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Web utilities</h3>
          <p>Use AIVAX content extraction and current web search in agent tools.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          {[
            ['advancedFetchEnabled', 'Use AIVAX advanced fetch', 'Replace URL reading with AIVAX HTML, image, document, and OCR extraction.'],
            ['webSearchEnabled', 'Use AIVAX web search', 'Add web search with country, language, and domain filters.'],
          ].map(([key, title, description]) => (
            <label className="settings-toggle-row" key={key}>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <input
                className="appearance-desktop-switch"
                type="checkbox"
                disabled={!state.connected || busy}
                checked={state.settings[key]}
                onChange={async (event) => {
                  setBusy(true);
                  setError('');
                  try {
                    const settings = await window.chatApp.aivax.save({
                      ...state.settings,
                      [key]: event.target.checked,
                    });
                    setState((current) => ({ ...current, settings }));
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : String(nextError));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>In-app search</h3>
          <p>Improve thread ranking with the AIVAX Reflex reranker.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          <label className="settings-toggle-row">
            <span>
              <strong>Use Reflex for thread search</strong>
              <small>Rerank local search candidates remotely. Local search remains available if Reflex fails.</small>
            </span>
            <input
              className="appearance-desktop-switch"
              type="checkbox"
              disabled={!state.connected || busy}
              checked={state.settings.reflexSearchEnabled}
              onChange={async (event) => {
                setBusy(true);
                setError('');
                try {
                  const settings = await window.chatApp.aivax.save({
                    ...state.settings,
                    reflexSearchEnabled: event.target.checked,
                  });
                  setState((current) => ({ ...current, settings }));
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : String(nextError));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        </div>
      </section>

      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </div>
  );
}
