import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleOff,
  Ellipsis,
  FileText,
  Folder,
  FolderCog,
  FolderOpen,
  Pencil,
  Plus,
  Save,
  Server,
  Trash2,
  Workflow,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { classNames } from '../lib/format.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const reasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const providerTypes = [
  {
    id: 'responses',
    name: 'OpenAI Compatible',
    description: 'Responses API',
    endpoint: '/v1/responses',
  },
  {
    id: 'chat-completions',
    name: 'OpenAI Compatible',
    description: 'Chat completions API',
    endpoint: '/v1/chat/completions',
  },
];
const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function ActionMenu({
  disabled = false,
  label,
  items,
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const close = () => setOpen(false);
    const focusFrame = requestAnimationFrame(() => {
      menuRef.current?.querySelector('button')?.focus();
    });
    document.addEventListener('mousedown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnKeyDown);
    window.addEventListener('resize', close);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('mousedown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        className={classNames('icon-button', 'tiny', open && 'active')}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = buttonRef.current.getBoundingClientRect();
          const estimatedHeight = items.length * 34 + 12;
          setPosition({
            top: rect.bottom + estimatedHeight + 8 > window.innerHeight
              ? Math.max(8, rect.top - estimatedHeight - 4)
              : rect.bottom + 4,
            left: Math.max(8, rect.right - 184),
          });
          setOpen(true);
        }}
      >
        <Ellipsis size={16} />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          className="settings-action-menu"
          style={position}
          role="menu"
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault();
            const buttons = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
            const currentIndex = buttons.indexOf(document.activeElement);
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            buttons[(currentIndex + direction + buttons.length) % buttons.length]?.focus();
          }}
        >
          <DropdownMenu className="settings-row-menu">
            {items.map((item) => (
              <DropdownMenuItem
                key={item.label}
                className={item.danger ? 'danger' : undefined}
                icon={item.icon}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenu>
        </div>,
        document.body,
      )}
    </>
  );
}

export function SettingsPage({
  providers,
  initialContextFolder = null,
  onClose,
  onSave,
  onRemove,
}) {
  const [view, setView] = useState(initialContextFolder ? 'context-folder' : 'list');
  const [selectedId, setSelectedId] = useState(null);
  const [providerDraft, setProviderDraft] = useState(null);
  const [modelDraft, setModelDraft] = useState(null);
  const [modelIndex, setModelIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contextFolders, setContextFolders] = useState([]);
  const [selectedContextFolder, setSelectedContextFolder] = useState(initialContextFolder);
  const [contextFolder, setContextFolder] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const selectedProvider = providers.find((provider) => provider.id === selectedId) ?? null;
  const selectedType = providerTypes.find((type) => (
    type.id === (providerDraft?.interface ?? selectedProvider?.interface)
  ));

  useEffect(() => {
    if (view !== 'context-folders') return undefined;
    let cancelled = false;
    setContextLoading(true);
    setError('');
    window.chatApp.context.folders()
      .then((folders) => {
        if (!cancelled) setContextFolders(folders);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    if (view !== 'context-folder' || !selectedContextFolder) return undefined;
    let cancelled = false;
    setContextLoading(true);
    setContextFolder(null);
    setError('');
    window.chatApp.context.folder(selectedContextFolder.path)
      .then((folder) => {
        if (!cancelled) setContextFolder(folder);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedContextFolder, view]);

  async function runProviderMutation(mutation) {
    setBusy(true);
    setError('');
    try {
      return await mutation();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function startProviderCreation(interfaceId) {
    const provider = {
      id: crypto.randomUUID(),
      name: '',
      baseUrl: '',
      interface: interfaceId,
      apiKey: '',
      enabled: true,
      models: [],
    };
    setSelectedId(provider.id);
    setProviderDraft(provider);
    setError('');
    setView('provider');
  }

  function openModelEditor(index) {
    const model = selectedProvider?.models[index];
    if (!model) return;
    setModelIndex(index);
    setModelDraft(structuredClone(model));
    setError('');
    setView('model');
  }

  function updateModelDraft(patch) {
    setModelDraft((current) => ({ ...current, ...patch }));
  }

  const pageTitle = {
    list: 'Providers',
    type: 'Add provider',
    provider: providerDraft?.name || 'New provider',
    model: modelDraft?.name || (modelIndex < 0 ? 'New model' : 'Edit model'),
    'context-folders': 'Context management',
    'context-folder': selectedContextFolder?.name || 'Context',
  }[view];
  const pageDescription = {
    list: 'Manage the connections and models available in chats.',
    type: 'Choose the API interface implemented by this provider.',
    provider: selectedType
      ? `${selectedType.name} · ${selectedType.description}`
      : 'Configure this provider connection and its models.',
    model: `Configure the model exposed by ${selectedProvider?.name || 'this provider'}.`,
    'context-folders': 'Manage instructions, skills, and workflows by folder.',
    'context-folder': selectedContextFolder?.displayPath || '',
  }[view];

  return (
    <section className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-titlebar" />
        <button className="settings-back" type="button" onClick={onClose}>
          <ArrowLeft size={15} />
          Back to app
        </button>
        <div className="settings-sidebar-heading">
          <h1>Settings</h1>
          <p>Application preferences</p>
        </div>
        <nav className="settings-navigation" aria-label="Settings sections">
          <span>Configuration</span>
          <button
            className={['list', 'type', 'provider', 'model'].includes(view) ? 'active' : undefined}
            type="button"
            aria-current={['list', 'type', 'provider', 'model'].includes(view) ? 'page' : undefined}
            onClick={() => {
              setView('list');
              setSelectedId(null);
              setProviderDraft(null);
              setModelDraft(null);
              setError('');
            }}
          >
            <Server size={16} />
            Providers
          </button>
          <button
            className={view.startsWith('context-') ? 'active' : undefined}
            type="button"
            aria-current={view.startsWith('context-') ? 'page' : undefined}
            onClick={() => {
              setView('context-folders');
              setSelectedContextFolder(null);
              setContextFolder(null);
              setError('');
            }}
          >
            <FolderCog size={16} />
            Context management
          </button>
        </nav>
      </aside>

      <main className="settings-main">
        <header className="settings-page-header">
          <div>
            {!['list', 'context-folders'].includes(view) && (
              <button
                className="settings-inline-back"
                type="button"
                onClick={() => {
                  if (view === 'context-folder') {
                    setView('context-folders');
                    setSelectedContextFolder(null);
                    setContextFolder(null);
                    setError('');
                    return;
                  }
                  if (view === 'model') {
                    setView('provider');
                    setModelDraft(null);
                    setModelIndex(-1);
                    setError('');
                    return;
                  }
                  setView('list');
                  setSelectedId(null);
                  setProviderDraft(null);
                  setModelDraft(null);
                  setModelIndex(-1);
                  setError('');
                }}
              >
                <ArrowLeft size={14} />
                {view === 'context-folder'
                  ? 'Back to folders'
                  : view === 'model'
                    ? 'Back to provider'
                    : 'Back'}
              </button>
            )}
            <div className="settings-page-title-row">
              <div>
                <h2>{pageTitle}</h2>
                <p>{pageDescription}</p>
              </div>
              {view === 'list' && (
                <button className="primary-mini settings-add-provider" type="button" onClick={() => {
                  setView('type');
                  setError('');
                }}>
                  <Plus size={14} />
                  Add provider
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="settings-content">
          <div className="settings-content-inner">
            {view === 'list' && (
              <section className="settings-section">
                <div className="settings-list-summary">
                  <span>{providers.length} {providers.length === 1 ? 'provider' : 'providers'}</span>
                  <span>{providers.filter((provider) => provider.enabled !== false).length} active</span>
                </div>
                <div className="settings-entity-list">
                  {providers.map((provider) => {
                    const enabled = provider.enabled !== false;
                    const type = providerTypes.find((item) => item.id === provider.interface);
                    return (
                      <article
                        className={classNames('settings-entity-row', !enabled && 'disabled')}
                        key={provider.id}
                      >
                        <button
                          className="settings-entity-main"
                          type="button"
                          onClick={() => {
                            setSelectedId(provider.id);
                            setProviderDraft(structuredClone(provider));
                            setError('');
                            setView('provider');
                          }}
                        >
                          <span className="settings-entity-icon"><Server size={16} /></span>
                          <span className="settings-entity-copy">
                            <strong>{provider.name}</strong>
                            <small>
                              {type?.description ?? provider.interface}
                              {' · '}
                              {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'}
                            </small>
                          </span>
                          <span className={classNames('settings-status', enabled ? 'enabled' : 'disabled')}>
                            {enabled ? 'Active' : 'Disabled'}
                          </span>
                          <ArrowRight className="settings-entity-arrow" size={15} />
                        </button>
                        <ActionMenu
                          disabled={busy}
                          label={`Actions for ${provider.name}`}
                          items={[
                            {
                              label: enabled ? 'Disable' : 'Enable',
                              icon: enabled ? <CircleOff size={14} /> : <CheckCircle2 size={14} />,
                              onClick: () => runProviderMutation(async () => {
                                const nextProviders = await onSave({ ...provider, enabled: !enabled });
                                const saved = nextProviders.find((item) => item.id === provider.id);
                                if (selectedId === provider.id && saved) {
                                  setProviderDraft(structuredClone(saved));
                                }
                              }),
                            },
                            {
                              label: 'Delete',
                              icon: <Trash2 size={14} />,
                              danger: true,
                              onClick: () => {
                                if (!window.confirm(
                                  `Delete provider "${provider.name}" and all of its models?`,
                                )) return;
                                runProviderMutation(async () => {
                                  await onRemove(provider.id);
                                  if (selectedId === provider.id) {
                                    setSelectedId(null);
                                    setProviderDraft(null);
                                    setView('list');
                                  }
                                });
                              },
                            },
                          ]}
                        />
                      </article>
                    );
                  })}
                  {providers.length === 0 && (
                    <div className="settings-empty settings-provider-empty">
                      <Server size={24} />
                      <strong>No providers configured</strong>
                      <span>Add a compatible API provider to make models available.</span>
                      <button className="primary-mini" type="button" onClick={() => setView('type')}>
                        <Plus size={14} />
                        Add provider
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {view === 'context-folders' && (
              <section className="settings-section">
                {!contextLoading && (
                  <div className="settings-list-summary">
                    <span>
                      {contextFolders.length}{' '}
                      {contextFolders.length === 1 ? 'folder' : 'folders'}
                    </span>
                  </div>
                )}
                {contextLoading ? (
                  <div className="settings-empty">Loading context folders...</div>
                ) : (
                  <div className="settings-entity-list">
                    {contextFolders.map((folder) => (
                      <article
                        className="settings-entity-row settings-context-folder-row"
                        key={folder.path}
                      >
                        <button
                          className="settings-entity-main"
                          type="button"
                          onClick={() => {
                            setSelectedContextFolder(folder);
                            setError('');
                            setView('context-folder');
                          }}
                        >
                          <span className="settings-entity-icon"><Folder size={16} /></span>
                          <span className="settings-entity-copy">
                            <strong>{folder.name}</strong>
                            <small>{folder.displayPath}</small>
                          </span>
                          <span className="settings-context-summary">
                            {folder.itemCount} context item(s), ~
                            {compactTokenFormatter.format(folder.tokenCount)} tokens total
                          </span>
                          <ArrowRight className="settings-entity-arrow" size={15} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                {error && <div className="settings-context-error" role="alert">{error}</div>}
              </section>
            )}

            {view === 'context-folder' && (
              <section className="settings-context-groups">
                {contextLoading && (
                  <div className="settings-empty">Loading context items...</div>
                )}
                {!contextLoading && contextFolder?.groups.map((group) => (
                  <section className="settings-context-group" key={group.id}>
                    <header className="settings-context-group-header">
                      <div>
                        <h3>{group.title}</h3>
                        <span>{group.items.length}</span>
                      </div>
                      <ActionMenu
                        label={`Actions for ${group.title}`}
                        items={[{
                          label: 'Open in explorer',
                          icon: <FolderOpen size={14} />,
                          onClick: () => {
                            setError('');
                            window.chatApp.context.open(group.folderPath).catch((nextError) => {
                              setError(
                                nextError instanceof Error ? nextError.message : String(nextError),
                              );
                            });
                          },
                        }]}
                      />
                    </header>
                    <div className="settings-context-item-list">
                      {group.items.map((item) => (
                        <button
                          className="settings-context-item"
                          type="button"
                          key={item.path}
                          title={item.path}
                          onClick={() => {
                            setError('');
                            window.chatApp.context.open(item.path).catch((nextError) => {
                              setError(
                                nextError instanceof Error ? nextError.message : String(nextError),
                              );
                            });
                          }}
                        >
                          <span className="settings-entity-icon">
                            {group.id === 'instruction'
                              ? <FileText size={16} />
                              : group.id === 'skill'
                                ? <FolderCog size={16} />
                                : <Workflow size={16} />}
                          </span>
                          <span className="settings-context-item-copy">
                            <strong>{item.title}</strong>
                            <small>{item.description}</small>
                          </span>
                          <span className="settings-context-token-count">
                            ~{compactTokenFormatter.format(item.tokenCount)} tokens
                          </span>
                        </button>
                      ))}
                      {group.items.length === 0 && (
                        <div className="settings-context-group-empty">No context items.</div>
                      )}
                    </div>
                  </section>
                ))}
                {error && <div className="settings-context-error" role="alert">{error}</div>}
              </section>
            )}

            {view === 'type' && (
              <section className="settings-section">
                <div className="provider-type-list">
                  {providerTypes.map((type) => (
                    <button
                      className="provider-type-card"
                      key={type.id}
                      type="button"
                      onClick={() => startProviderCreation(type.id)}
                    >
                      <span className="settings-entity-icon"><Server size={17} /></span>
                      <span>
                        <strong>{type.name}</strong>
                        <small>{type.description}</small>
                        <code>{type.endpoint}</code>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {view === 'provider' && providerDraft && (
              <section className="settings-provider-detail">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Connection</h3>
                    <p>Provider identity, endpoint, and credentials.</p>
                  </div>
                  <div className="settings-section-card">
                    <div className="settings-form">
                      <label className="settings-field">
                        <span>Name</span>
                        <input
                          value={providerDraft.name}
                          onChange={(event) => setProviderDraft({
                            ...providerDraft,
                            name: event.target.value,
                          })}
                          placeholder="OpenRouter"
                        />
                      </label>
                      <label className="settings-field">
                        <span>Provider type</span>
                        <select
                          value={providerDraft.interface}
                          onChange={(event) => setProviderDraft({
                            ...providerDraft,
                            interface: event.target.value,
                          })}
                        >
                          {providerTypes.map((type) => (
                            <option value={type.id} key={type.id}>
                              {type.name} ({type.description})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="settings-field settings-field-wide">
                        <span>Base URL</span>
                        <input
                          value={providerDraft.baseUrl}
                          onChange={(event) => setProviderDraft({
                            ...providerDraft,
                            baseUrl: event.target.value,
                          })}
                          placeholder="https://openrouter.ai/api/v1"
                        />
                        <small>The interface path is appended when it is not already present.</small>
                      </label>
                      <label className="settings-field settings-field-wide">
                        <span>API key</span>
                        <input
                          type="password"
                          value={providerDraft.apiKey}
                          onChange={(event) => setProviderDraft({
                            ...providerDraft,
                            apiKey: event.target.value,
                          })}
                          placeholder="Optional for local providers"
                          autoComplete="off"
                        />
                      </label>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="models-editor-header">
                    <div>
                      <h3>Models</h3>
                      <p>
                        {selectedProvider
                          ? `${selectedProvider.models.length} ${
                            selectedProvider.models.length === 1 ? 'model' : 'models'
                          }`
                          : 'Save this provider before adding models.'}
                      </p>
                    </div>
                    {selectedProvider && (
                      <button type="button" onClick={() => {
                        setModelIndex(-1);
                        setModelDraft({
                          id: '',
                          name: '',
                          enabled: true,
                          capabilities: { images: false, audio: false },
                          context: { input: '', output: '' },
                          reasoning: [],
                        });
                        setError('');
                        setView('model');
                      }}>
                        <Plus size={14} />
                        Add model
                      </button>
                    )}
                  </div>
                  {selectedProvider ? (
                    <div className="settings-entity-list">
                      {selectedProvider.models.map((model, index) => {
                        const enabled = model.enabled !== false;
                        return (
                          <article
                            className={classNames('settings-entity-row', !enabled && 'disabled')}
                            key={`${model.id}:${index}`}
                          >
                            <button
                              className="settings-entity-main"
                              type="button"
                              onClick={() => openModelEditor(index)}
                            >
                              <span className="settings-entity-icon"><Boxes size={16} /></span>
                              <span className="settings-entity-copy">
                                <strong>{model.name}</strong>
                                <small>{model.id}</small>
                              </span>
                              <span className={classNames(
                                'settings-status',
                                enabled ? 'enabled' : 'disabled',
                              )}>
                                {enabled ? 'Active' : 'Disabled'}
                              </span>
                              <ArrowRight className="settings-entity-arrow" size={15} />
                            </button>
                            <ActionMenu
                              disabled={busy}
                              label={`Actions for ${model.name}`}
                              items={[
                                {
                                  label: 'Edit',
                                  icon: <Pencil size={14} />,
                                  onClick: () => openModelEditor(index),
                                },
                                {
                                  label: enabled ? 'Disable' : 'Enable',
                                  icon: enabled
                                    ? <CircleOff size={14} />
                                    : <CheckCircle2 size={14} />,
                                  onClick: () => runProviderMutation(async () => {
                                    const nextProviders = await onSave({
                                      ...selectedProvider,
                                      models: selectedProvider.models.map((item, modelIndexValue) => (
                                        modelIndexValue === index
                                          ? { ...item, enabled: !enabled }
                                          : item
                                      )),
                                    });
                                    const saved = nextProviders.find(
                                      (provider) => provider.id === selectedProvider.id,
                                    );
                                    if (saved) setProviderDraft(structuredClone(saved));
                                  }),
                                },
                                {
                                  label: 'Delete',
                                  icon: <Trash2 size={14} />,
                                  danger: true,
                                  onClick: () => {
                                    if (!window.confirm(`Delete model "${model.name}"?`)) return;
                                    runProviderMutation(async () => {
                                      const nextProviders = await onSave({
                                        ...selectedProvider,
                                        models: selectedProvider.models.filter(
                                          (_item, modelIndexValue) => modelIndexValue !== index,
                                        ),
                                      });
                                      const saved = nextProviders.find(
                                        (provider) => provider.id === selectedProvider.id,
                                      );
                                      if (saved) setProviderDraft(structuredClone(saved));
                                    });
                                  },
                                },
                              ]}
                            />
                          </article>
                        );
                      })}
                      {selectedProvider.models.length === 0 && (
                        <div className="empty-list settings-models-empty">
                          This provider has no models yet.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="settings-models-locked">
                      Save the provider connection to add its models.
                    </div>
                  )}
                </section>
              </section>
            )}

            {view === 'model' && modelDraft && selectedProvider && (
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h3>Model details</h3>
                  <p>Identifier, display name, capabilities, and context limits.</p>
                </div>
                <div className="model-editor-card">
                  <div className="model-editor-grid">
                    <label className="settings-field">
                      <span>Model ID</span>
                      <input
                        value={modelDraft.id}
                        onChange={(event) => updateModelDraft({ id: event.target.value })}
                        placeholder="openai/gpt-5"
                      />
                    </label>
                    <label className="settings-field">
                      <span>Display name</span>
                      <input
                        value={modelDraft.name}
                        onChange={(event) => updateModelDraft({ name: event.target.value })}
                        placeholder="GPT-5"
                      />
                    </label>
                    <label className="settings-field">
                      <span>Input context</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={modelDraft.context.input ?? ''}
                        onChange={(event) => updateModelDraft({
                          context: { ...modelDraft.context, input: event.target.value },
                        })}
                        placeholder="128000"
                      />
                    </label>
                    <label className="settings-field">
                      <span>Output context</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={modelDraft.context.output ?? ''}
                        onChange={(event) => updateModelDraft({
                          context: { ...modelDraft.context, output: event.target.value },
                        })}
                        placeholder="16384"
                      />
                    </label>
                  </div>
                  <div className="model-options-row">
                    <div
                      className="model-option-row"
                      role="group"
                      aria-labelledby="model-capabilities-label"
                    >
                      <span className="model-option-label" id="model-capabilities-label">
                        Capabilities
                      </span>
                      <div className="model-option-controls">
                        <label>
                          <input
                            type="checkbox"
                            checked={modelDraft.capabilities.images}
                            onChange={(event) => updateModelDraft({
                              capabilities: {
                                ...modelDraft.capabilities,
                                images: event.target.checked,
                              },
                            })}
                          />
                          Images
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={modelDraft.capabilities.audio}
                            onChange={(event) => updateModelDraft({
                              capabilities: {
                                ...modelDraft.capabilities,
                                audio: event.target.checked,
                              },
                            })}
                          />
                          Audio
                        </label>
                      </div>
                    </div>
                    <div
                      className="model-option-row reasoning-options"
                      role="group"
                      aria-labelledby="model-reasoning-label"
                    >
                      <span className="model-option-label" id="model-reasoning-label">
                        Reasoning
                      </span>
                      <div className="model-option-controls">
                        {reasoningEfforts.map((effort) => (
                          <label key={effort}>
                            <input
                              type="checkbox"
                              checked={modelDraft.reasoning.includes(effort)}
                              onChange={(event) => updateModelDraft({
                                reasoning: event.target.checked
                                  ? [...modelDraft.reasoning, effort]
                                  : modelDraft.reasoning.filter((item) => item !== effort),
                              })}
                            />
                            {effort}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        {(view === 'provider' || view === 'model') && (
          <footer className="settings-actions">
            <span className="settings-error" role="alert">{error}</span>
            <div>
              <button
                className="primary-mini"
                type="button"
                disabled={busy || (view === 'provider' ? !providerDraft : !modelDraft)}
                onClick={() => runProviderMutation(async () => {
                  if (view === 'provider') {
                    const nextProviders = await onSave(providerDraft);
                    const saved = nextProviders.find((provider) => provider.id === providerDraft.id);
                    if (saved) {
                      setSelectedId(saved.id);
                      setProviderDraft(structuredClone(saved));
                    }
                    return;
                  }

                  const nextModels = modelIndex < 0
                    ? [...selectedProvider.models, modelDraft]
                    : selectedProvider.models.map((model, index) => (
                      index === modelIndex ? modelDraft : model
                    ));
                  const nextProviders = await onSave({
                    ...selectedProvider,
                    models: nextModels,
                  });
                  const saved = nextProviders.find(
                    (provider) => provider.id === selectedProvider.id,
                  );
                  if (saved) {
                    setProviderDraft(structuredClone(saved));
                    setModelDraft(null);
                    setView('provider');
                  }
                })}
              >
                <Save size={14} />
                {busy
                  ? 'Saving...'
                  : view === 'provider'
                    ? 'Save provider'
                    : 'Save model'}
              </button>
            </div>
          </footer>
        )}
      </main>
    </section>
  );
}
