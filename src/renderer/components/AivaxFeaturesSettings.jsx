import {
  ChevronDown,
  ExternalLink,
  Folder,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import aivaxLogoUrl from '../../../assets/aivax.png';
import { Overlay, Presence } from './Overlay.jsx';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});
const countFormatter = new Intl.NumberFormat('en-US');
const FEATURE_TABS = [
  ['account', 'Account'],
  ['memory', 'Memory'],
  ['web', 'Web'],
  ['media', 'Media'],
  ['search', 'Search'],
  ['grep', 'Semantic Grep'],
  ['enhancements', 'Enhancements'],
];
const RERANKERS = [
  ['rrf', 'RRF'],
  ['none', 'None'],
  ['lexical', 'Lexical'],
  ['smart', 'Smart'],
];

function collectionChanges(target, collection) {
  if (target === 'memory') {
    return { memoryCollectionId: collection.id, memoryCollectionName: collection.name };
  }
  if (target === 'semanticGrep') {
    return { semanticGrepCollectionId: collection.id, semanticGrepCollectionName: collection.name };
  }
  return { threadSearchCollectionId: collection.id, threadSearchCollectionName: collection.name };
}

function selectedCollectionId(target, settings) {
  if (target === 'memory') return settings.memoryCollectionId;
  if (target === 'semanticGrep') return settings.semanticGrepCollectionId;
  return settings.threadSearchCollectionId;
}

function semanticGrepStatusLines(state) {
  const status = state.semanticGrep;
  if (!state.settings.semanticGrepCollectionId) {
    return { headline: 'Choose a collection before indexing can start.' };
  }
  if (!state.settings.semanticGrepDirectories?.length) {
    return { headline: 'Add a directory to start indexing.' };
  }
  if (!status || (status.state === 'idle' && !status.finishedAt)) {
    return { headline: 'Waiting for the first index.' };
  }
  if (status.state === 'indexing') {
    return { headline: `Reading files... ${countFormatter.format(status.files || 0)} read.` };
  }
  if (status.state === 'error') {
    return { headline: status.error || 'The last index failed.' };
  }
  const when = status.finishedAt
    ? new Date(status.finishedAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : null;
  const counts = [
    status.updated > 0 && `${countFormatter.format(status.updated)} updated`,
    status.skipped > 0 && `${countFormatter.format(status.skipped)} unchanged`,
    status.removed > 0 && `${countFormatter.format(status.removed)} removed`,
    status.cost != null && currencyFormatter.format(status.cost),
  ].filter(Boolean);
  const queued = status.queuedDocuments > 0
    ? `${countFormatter.format(status.queuedDocuments)} still indexing`
    : null;
  return {
    headline: queued ?? (when ? `Up to date · ${when}` : 'Up to date'),
    detail: [queued ? when : null, ...counts].filter(Boolean).join(' · ') || null,
  };
}

function collectionInUse(target, collection, settings) {
  const usedByOthers = [
    target === 'memory' ? null : settings.memoryCollectionId,
    target === 'threadSearch' ? null : settings.threadSearchCollectionId,
    target === 'semanticGrep' ? null : settings.semanticGrepCollectionId,
  ];
  return usedByOthers.includes(collection.id);
}

export function AivaxFeaturesSettings() {
  const [state, setState] = useState(null);
  const [collections, setCollections] = useState([]);
  const [mediaModels, setMediaModels] = useState({ image: [], audio: [] });
  const [loginKey, setLoginKey] = useState('');
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collectionPickerTarget, setCollectionPickerTarget] = useState(null);
  const [collectionCreateTarget, setCollectionCreateTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('account');
  const [recommendations, setRecommendations] = useState([]);
  const directoryKey = state?.settings?.semanticGrepDirectories?.join('\0') ?? '';

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

  useEffect(() => {
    if (!state?.connected) return undefined;
    let active = true;
    window.chatApp.aivax.mediaModels()
      .then((models) => {
        if (active) setMediaModels(models);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, [state?.connected]);

  useEffect(() => {
    if (!state?.connected || tab !== 'grep') return undefined;
    let active = true;
    const refresh = () => window.chatApp.aivax.semanticGrepStatus()
      .then((semanticGrep) => {
        if (active) setState((current) => (current ? { ...current, semanticGrep } : current));
      })
      .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 3000);
    window.chatApp.aivax.semanticGrepRecommendations()
      .then((items) => {
        if (active) setRecommendations(Array.isArray(items) ? items : []);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state?.connected, tab, directoryKey]);

  async function saveSettings(changes) {
    setBusy(true);
    setError('');
    try {
      const settings = await window.chatApp.aivax.save({ ...state.settings, ...changes });
      setState((current) => ({ ...current, settings }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  function closeLoginDialog() {
    setLoginDialogOpen(false);
    setLoginKey('');
    setError('');
  }

  if (!state) {
    return (
      <div className="aivax-settings-loading" role="status">
        <span className="aivax-spinner" aria-hidden="true" />
        Loading AIVAX account...
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
                className="button primary"
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
                className="button"
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
            <div>
              <dt>Semantic Grep</dt>
              <dd>Index chosen directories and search them by meaning from the current chat folder.</dd>
            </div>
          </dl>
        </section>

        <Presence when={loginDialogOpen}>{() => (
          <Overlay
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
                    className="input"
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
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={closeLoginDialog}
                  >
                    Cancel
                  </button>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={busy || !loginKey.trim()}
                  >
                    {busy ? <span className="aivax-spinner" aria-hidden="true" /> : <KeyRound size={15} />}
                    {busy ? <>Linking&hellip;</> : 'Link account'}
                  </button>
                </div>
              </form>
            </section>
          </Overlay>
        )}</Presence>
      </div>
    );
  }

  const indexingStatus = semanticGrepStatusLines(state);

  return (
    <div className="settings-tuning aivax-features-settings">
      <div className="maintenance-tabs" role="tablist" aria-label="AIVAX feature sessions" onKeyDown={(event) => {
        const index = FEATURE_TABS.findIndex(([id]) => id === tab);
        const nextIndex = event.key === 'ArrowRight' ? index + 1
          : event.key === 'ArrowLeft' ? index - 1
            : event.key === 'Home' ? 0
              : event.key === 'End' ? FEATURE_TABS.length - 1
                : -1;
        if (nextIndex < 0) return;
        event.preventDefault();
        const next = FEATURE_TABS[(nextIndex + FEATURE_TABS.length) % FEATURE_TABS.length][0];
        setTab(next);
        document.getElementById(`aivax-feature-tab-${next}`)?.focus();
      }}>
        {FEATURE_TABS.map(([id, label]) => (
          <button
            id={`aivax-feature-tab-${id}`}
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`aivax-feature-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="settings-section" id="aivax-feature-panel-account" role="tabpanel" aria-labelledby="aivax-feature-tab-account" hidden={tab !== 'account'}>
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
                className="button"
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
                className="button"
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
                className="button"
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

      <section className="settings-section" id="aivax-feature-panel-memory" role="tabpanel" aria-labelledby="aivax-feature-tab-memory" hidden={tab !== 'memory'}>
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
              className="toggle"
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
              className="button aivax-collection-picker-trigger"
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

      <Presence when={collectionPickerTarget}>{(collectionPickerTarget) => (
        <Overlay className="dialog-backdrop aivax-collection-dialog-backdrop" onMouseDown={() => !busy && setCollectionPickerTarget(null)}>
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
                  Choose a {collectionPickerTarget === 'memory' ? 'memory' : collectionPickerTarget === 'semanticGrep' ? 'Semantic Grep' : 'thread search'} collection
                </h2>
                <p>{collectionPickerTarget === 'memory'
                  ? 'Select where Avi can save and retrieve persistent memory.'
                  : 'Select a dedicated collection. Sync mode replaces documents that are not part of this session.'}</p>
              </div>
              <button className="icon-button tiny" type="button" aria-label="Close collection picker" disabled={busy} onClick={() => setCollectionPickerTarget(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="aivax-collection-list" role="listbox" aria-label="AIVAX collections">
              {collections.map((collection) => {
                const selectedId = selectedCollectionId(collectionPickerTarget, state.settings);
                const unavailable = collectionInUse(collectionPickerTarget, collection, state.settings);
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
                          ...collectionChanges(collectionPickerTarget, collection),
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
              className="button aivax-collection-create-trigger"
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
        </Overlay>
      )}</Presence>

      <Presence when={collectionCreateTarget}>{(collectionCreateTarget) => (
        <Overlay className="dialog-backdrop aivax-collection-dialog-backdrop" onMouseDown={() => !busy && setCollectionCreateTarget(null)}>
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
                      ...collectionChanges(collectionCreateTarget, created.collection),
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
                <input className="input" autoFocus value={newCollectionName} disabled={busy} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="e.g. Team knowledge" />
              </label>
              <div className="aivax-collection-create-actions">
                <button className="button" type="button" disabled={busy} onClick={() => setCollectionCreateTarget(null)}>
                  Cancel
                </button>
                <button className="button primary" type="submit" disabled={busy || !newCollectionName.trim()}>
                  {busy ? <span className="aivax-spinner" aria-hidden="true" /> : <Plus size={14} />}
                  Create collection
                </button>
              </div>
            </form>
          </section>
        </Overlay>
      )}</Presence>

      <section className="settings-section" id="aivax-feature-panel-web" role="tabpanel" aria-labelledby="aivax-feature-tab-web" hidden={tab !== 'web'}>
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
                className="toggle"
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

      <section className="settings-section" id="aivax-feature-panel-media" role="tabpanel" aria-labelledby="aivax-feature-tab-media" hidden={tab !== 'media'}>
        <div className="settings-section-heading">
          <h3>Media generation</h3>
          <p>Let agents generate images and speech audio with AIVAX models. Generation consumes AIVAX balance.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          {[
            {
              enabledKey: 'imageGenerationEnabled',
              modelKey: 'imageGenerationModel',
              models: mediaModels.image,
              title: 'Image generation',
              description: 'Add the generate_image tool. Reference images require a model that supports them.',
            },
            {
              enabledKey: 'audioGenerationEnabled',
              modelKey: 'audioGenerationModel',
              models: mediaModels.audio,
              title: 'Audio generation',
              description: 'Add the generate_audio text-to-speech tool.',
            },
          ].map(({ enabledKey, modelKey, models, title, description }) => {
            const selectedModel = models.find((model) => model.name === state.settings[modelKey]);
            return (
              <div className="settings-card-row aivax-media-row" key={enabledKey}>
                <span>
                  <strong>{title}</strong>
                  <small>{selectedModel
                    ? [
                        selectedModel.pricingDescription,
                        selectedModel.referenceImages && 'Supports reference images',
                      ].filter(Boolean).join(' · ')
                    : description}</small>
                </span>
                <div className="aivax-media-actions">
                  <select className="select"
                    aria-label={`${title} model`}
                    disabled={!state.connected || busy}
                    value={state.settings[modelKey] ?? ''}
                    onChange={(event) => saveSettings({
                      [modelKey]: event.target.value || null,
                      ...(event.target.value ? {} : { [enabledKey]: false }),
                    })}
                  >
                    <option value="">Select a model</option>
                    {state.settings[modelKey] && !selectedModel && (
                      <option value={state.settings[modelKey]}>{state.settings[modelKey]}</option>
                    )}
                    {models.map((model) => (
                      <option key={model.name} value={model.name} title={model.description}>
                        {model.displayName}
                      </option>
                    ))}
                  </select>
                  <input
                    className="toggle"
                    type="checkbox"
                    aria-label={`Enable ${title.toLowerCase()}`}
                    disabled={!state.connected || !state.settings[modelKey] || busy}
                    checked={state.settings[enabledKey]}
                    onChange={(event) => saveSettings({ [enabledKey]: event.target.checked })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-section" id="aivax-feature-panel-search" role="tabpanel" aria-labelledby="aivax-feature-tab-search" hidden={tab !== 'search'}>
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
              className="button aivax-collection-picker-trigger"
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

      <section className="settings-section" id="aivax-feature-panel-grep" role="tabpanel" aria-labelledby="aivax-feature-tab-grep" hidden={tab !== 'grep'}>
        <div className="settings-section-heading">
          <h3>Semantic Grep</h3>
          <p>Index directories into a dedicated collection. Agents can then use file_search as the first search in the current chat directory. It does not replace rg.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          <div className="settings-card-row aivax-collection-row">
            <span>
              <strong>Collection</strong>
              <small>{state.settings.semanticGrepCollectionName ?? 'Choose a dedicated collection. Sync removes documents that are no longer in these directories.'}</small>
            </span>
            <button className="button aivax-collection-picker-trigger" type="button" disabled={busy} onClick={() => setCollectionPickerTarget('semanticGrep')}>
              {state.settings.semanticGrepCollectionName ?? 'Select a collection'}
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="settings-card-row aivax-media-row">
            <span>
              <strong>Reranker</strong>
              <small>RRF is the default. It reorders semantic matches before file_search returns them.</small>
            </span>
            <select
              className="select"
              aria-label="Semantic Grep reranker"
              disabled={busy}
              value={state.settings.semanticGrepReranker ?? 'rrf'}
              onChange={(event) => saveSettings({ semanticGrepReranker: event.target.value })}
            >
              {RERANKERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="settings-card-row aivax-account-row">
            <span>
              <strong>Indexing</strong>
              <small className="aivax-index-status">{indexingStatus.headline}</small>
              {indexingStatus.detail && (
                <small className="aivax-index-status">{indexingStatus.detail}</small>
              )}
            </span>
          </div>
          <div className="settings-card-row aivax-account-row">
            <span>
              <strong>Directories</strong>
              <small>{(state.settings.semanticGrepDirectories ?? []).length === 0
                ? 'Add at least one directory to start background indexing.'
                : 'Avi reindexes these directories every 15 minutes in sync mode.'}</small>
            </span>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={async () => {
                const picked = await window.chatApp.bots.chooseFolder();
                if (!picked) return;
                const existing = state.settings.semanticGrepDirectories ?? [];
                if (existing.some((item) => item.toLowerCase() === picked.toLowerCase())) return;
                await saveSettings({ semanticGrepDirectories: [...existing, picked] });
              }}
            >
              <Plus size={14} />
              Add directory
            </button>
          </div>
          {(state.settings.semanticGrepDirectories ?? []).length > 0 && (
            <div className="aivax-folder-list" role="list" aria-label="Indexed directories">
              {(state.settings.semanticGrepDirectories ?? []).map((directory) => (
                <div className="aivax-folder-item" role="listitem" key={directory}>
                  <Folder size={15} aria-hidden="true" />
                  <span className="aivax-folder-copy">
                    <strong className="aivax-path" title={directory}>{directory}</strong>
                  </span>
                  <button
                    className="icon-button tiny"
                    type="button"
                    aria-label={`Remove ${directory}`}
                    disabled={busy}
                    onClick={() => saveSettings({
                      semanticGrepDirectories: state.settings.semanticGrepDirectories.filter((item) => item !== directory),
                    })}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {recommendations.length > 0 && (
            <div className="settings-card-row aivax-account-row">
              <span>
                <strong>Recommended</strong>
                <small>Frequent chat folders. A worktree suggests that worktree root.</small>
              </span>
            </div>
          )}
          {recommendations.length > 0 && (
            <div className="aivax-folder-list" role="list" aria-label="Recommended directories">
              {recommendations.map((item) => (
                <div className="aivax-folder-item" role="listitem" key={item.path}>
                  <Folder size={15} aria-hidden="true" />
                  <span className="aivax-folder-copy">
                    <strong className="aivax-path" title={item.path}>{item.path}</strong>
                    <small>{item.worktree ? 'Worktree' : 'Frequent chat folder'} · {item.conversations} chats</small>
                  </span>
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => saveSettings({
                      semanticGrepDirectories: [...(state.settings.semanticGrepDirectories ?? []), item.path],
                    })}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="settings-section" id="aivax-feature-panel-enhancements" role="tabpanel" aria-labelledby="aivax-feature-tab-enhancements" hidden={tab !== 'enhancements'}>
        <div className="settings-section-heading">
          <h3>Enhancements</h3>
          <p>Replace local model work with faster AIVAX services. These consume AIVAX balance; if a request fails, Avi falls back to its usual behavior.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          {[
            ['fastCompressEnabled', 'Fast Compress', 'Compress chat context with the AIVAX summarization endpoint instead of the compactation model.'],
            ['fastNameEnabled', 'Fast Name', 'Generate thread titles with the AIVAX summarization model instead of the auxiliary model.'],
            ['smartApproveEnabled', 'Smart Approve for Me', 'In Approve for me, ask the @perplexity/pplx-decider-flash decision model whether a tool call the agent marked as safe still needs your approval.'],
          ].map(([key, title, description]) => (
            <label className="settings-toggle-row" key={key}>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <input
                className="toggle"
                type="checkbox"
                disabled={busy}
                checked={state.settings[key]}
                onChange={(event) => saveSettings({ [key]: event.target.checked })}
              />
            </label>
          ))}
        </div>
      </section>

      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </div>
  );
}
