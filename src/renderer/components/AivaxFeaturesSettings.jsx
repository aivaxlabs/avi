import {
  ChevronDown,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import aivaxLogoUrl from '../../../assets/aivax.png';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

export function AivaxFeaturesSettings() {
  const [state, setState] = useState(null);
  const [collections, setCollections] = useState([]);
  const [loginKey, setLoginKey] = useState('');
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collectionPickerTarget, setCollectionPickerTarget] = useState(null);
  const [collectionCreateTarget, setCollectionCreateTarget] = useState(null);
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

  function closeLoginDialog() {
    setLoginDialogOpen(false);
    setLoginKey('');
    setError('');
  }

  if (!state) {
    return (
      <div className="aivax-settings-loading">
        <LoaderCircle size={18} />
        Loading AIVAX account&hellip;
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="aivax-features-settings aivax-landing">
        <section className="aivax-landing-intro">
          <img className="aivax-landing-logo" src={aivaxLogoUrl} width="1404" height="266" alt="AIVAX" />
          <div>
            <h3>Connect AIVAX to Avi</h3>
            <p>
              Link your account to enable persistent memory, web and media tools, and semantic
              search across your conversations.
            </p>
            <div className="aivax-landing-actions">
              <button
                className="primary-mini aivax-link-account"
                type="button"
                onClick={() => {
                  setError('');
                  setLoginDialogOpen(true);
                }}
              >
                <KeyRound size={15} />
                Link login key
              </button>
              <button
                className="aivax-create-account"
                type="button"
                onClick={() => window.chatApp.app.openExternal('https://console.aivax.net/login')}
              >
                Create an account
                <ExternalLink size={13} />
              </button>
            </div>
            <p className="aivax-landing-security">
              The login key is exchanged once. Avi stores only the resulting access token, encrypted locally.
            </p>
          </div>
        </section>

        <section className="aivax-landing-features" aria-labelledby="aivax-landing-features-title">
          <h3 id="aivax-landing-features-title">Available after linking</h3>
          <dl>
            <div>
              <dt>Persistent memory</dt>
              <dd>Store and retrieve useful context across conversations.</dd>
            </div>
            <div>
              <dt>Web tools</dt>
              <dd>Search current results and extract content from pages and documents.</dd>
            </div>
            <div>
              <dt>Media descriptions</dt>
              <dd>Read images, audio, video, and PDFs when the selected model cannot.</dd>
            </div>
            <div>
              <dt>Thread search</dt>
              <dd>Find previous conversations by meaning instead of exact wording.</dd>
            </div>
          </dl>
        </section>

        {loginDialogOpen && (
          <div
            className="dialog-backdrop aivax-login-dialog-backdrop"
            onMouseDown={() => !busy && closeLoginDialog()}
          >
            <section
              className="aivax-login-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="aivax-login-dialog-title"
              aria-describedby="aivax-login-dialog-description"
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) closeLoginDialog();
              }}
            >
              <header className="dialog-header">
                <div>
                  <img src={aivaxLogoUrl} width="1404" height="266" alt="" />
                  <h2 id="aivax-login-dialog-title">Link your AIVAX account</h2>
                  <p id="aivax-login-dialog-description">
                    Paste the login key from your AIVAX account. Avi exchanges it once for an encrypted access token.
                  </p>
                </div>
                <button
                  className="icon-button tiny"
                  type="button"
                  aria-label="Close login key dialog"
                  disabled={busy}
                  onClick={closeLoginDialog}
                >
                  <X size={16} />
                </button>
              </header>
              <form
                className="aivax-login-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    const nextState = await window.chatApp.aivax.connect(loginKey);
                    setState(nextState);
                    setLoginKey('');
                    setLoginDialogOpen(false);
                    const items = await window.chatApp.aivax.collections();
                    setCollections(Array.isArray(items) ? items : []);
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : String(nextError));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  <span>Login key</span>
                  <input
                    autoFocus
                    type="password"
                    autoComplete="off"
                    spellCheck="false"
                    value={loginKey}
                    disabled={busy}
                    onChange={(event) => setLoginKey(event.target.value)}
                    placeholder="Paste your AIVAX login key"
                  />
                </label>
                {error && <div className="settings-context-error" role="alert">{error}</div>}
                <div className="aivax-login-actions">
                  <button
                    className="aivax-login-cancel"
                    type="button"
                    disabled={busy}
                    onClick={closeLoginDialog}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-mini aivax-link-account"
                    type="submit"
                    disabled={busy || !loginKey.trim()}
                  >
                    {busy ? <LoaderCircle className="aivax-spinner" size={15} /> : <KeyRound size={15} />}
                    {busy ? <>Linking&hellip;</> : 'Link account'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
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
              onClick={() => setCollectionPickerTarget('memory')}
            >
              {state.settings.memoryCollectionName ?? 'Select a collection'}
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      </section>

      {collectionPickerTarget && (
        <div className="dialog-backdrop aivax-collection-dialog-backdrop" onMouseDown={() => !busy && setCollectionPickerTarget(null)}>
          <section
            className="aivax-collection-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aivax-collection-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) setCollectionPickerTarget(null);
            }}
          >
            <header className="dialog-header">
              <div>
                <h2 id="aivax-collection-dialog-title">
                  Choose a {collectionPickerTarget === 'memory' ? 'memory' : 'thread search'} collection
                </h2>
                <p>{collectionPickerTarget === 'memory'
                  ? 'Select where Avi can save and retrieve persistent memory.'
                  : 'Select a dedicated collection. Avi replaces its complete contents during each thread sync.'}</p>
              </div>
              <button className="icon-button tiny" type="button" aria-label="Close collection picker" disabled={busy} onClick={() => setCollectionPickerTarget(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="aivax-collection-list" role="listbox" aria-label="AIVAX collections">
              {collections.map((collection) => {
                const selectedId = collectionPickerTarget === 'memory'
                  ? state.settings.memoryCollectionId
                  : state.settings.threadSearchCollectionId;
                const unavailable = collectionPickerTarget === 'memory'
                  ? collection.id === state.settings.threadSearchCollectionId
                  : collection.id === state.settings.memoryCollectionId;
                const selected = collection.id === selectedId;
                return (
                  <button
                    className={selected ? 'selected' : ''}
                    key={collection.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={busy || unavailable}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const settings = await window.chatApp.aivax.save({
                          ...state.settings,
                          ...(collectionPickerTarget === 'memory'
                            ? {
                                memoryCollectionId: collection.id,
                                memoryCollectionName: collection.name,
                              }
                            : {
                                threadSearchCollectionId: collection.id,
                                threadSearchCollectionName: collection.name,
                              }),
                        });
                        setState((current) => ({ ...current, settings }));
                        setCollectionPickerTarget(null);
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
                    {unavailable && <span className="aivax-collection-selected">In use</span>}
                  </button>
                );
              })}
              {collections.length === 0 && <p className="aivax-collection-empty">No collections yet. Create your first one.</p>}
            </div>
            <button
              className="button button-secondary aivax-collection-create-trigger"
              type="button"
              disabled={busy}
              onClick={() => {
                setCollectionCreateTarget(collectionPickerTarget);
                setCollectionPickerTarget(null);
              }}
            >
              <Plus size={14} />
              Create new collection
            </button>
          </section>
        </div>
      )}

      {collectionCreateTarget && (
        <div className="dialog-backdrop aivax-collection-dialog-backdrop" onMouseDown={() => !busy && setCollectionCreateTarget(null)}>
          <section
            className="aivax-collection-dialog aivax-collection-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aivax-collection-create-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) setCollectionCreateTarget(null);
            }}
          >
            <header className="dialog-header">
              <div>
                <h2 id="aivax-collection-create-dialog-title">Create a new collection</h2>
                <p>Give the collection a clear name so it is easy to find later.</p>
              </div>
              <button className="icon-button tiny" type="button" aria-label="Close collection creation dialog" disabled={busy} onClick={() => setCollectionCreateTarget(null)}>
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
                      ...(collectionCreateTarget === 'memory'
                        ? {
                            memoryCollectionId: created.collection.id,
                            memoryCollectionName: created.collection.name,
                          }
                        : {
                            threadSearchCollectionId: created.collection.id,
                            threadSearchCollectionName: created.collection.name,
                          }),
                    });
                    setState((current) => ({ ...current, settings }));
                  }
                  setCollectionCreateTarget(null);
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
                <button className="button button-secondary" type="button" disabled={busy} onClick={() => setCollectionCreateTarget(null)}>
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
            ['mediaDescriptionsEnabled', 'Use AIVAX Media Descriptions', 'Let read_media_file describe images, videos, audio, and PDFs when the selected model cannot read them.'],
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
          <p>Search indexed thread turns semantically through a dedicated AIVAX RAG collection.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          <div className="settings-card-row aivax-collection-row">
            <span>
              <strong>Thread search collection</strong>
              <small>{state.settings.threadSearchCollectionName
                ?? 'Choose a dedicated collection to enable semantic thread search.'}</small>
            </span>
            <button
              className="button button-secondary aivax-collection-picker-trigger"
              type="button"
              disabled={!state.connected || busy}
              onClick={() => setCollectionPickerTarget('threadSearch')}
            >
              {state.settings.threadSearchCollectionName ?? 'Select a collection'}
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="settings-card-row aivax-account-row">
            <span>
              <strong>Collection ownership</strong>
              <small>Avi synchronizes on startup and every 15 minutes, replacing all documents in this collection. Do not share it with Memory or other data.</small>
            </span>
          </div>
        </div>
      </section>

      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </div>
  );
}
