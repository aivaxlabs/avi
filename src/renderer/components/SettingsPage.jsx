import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  ClipboardPaste,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  FolderCog,
  FolderOpen,
  Github,
  Globe2,
  Info,
  Link,
  Network,
  Palette,
  Pencil,
  Plus,
  RadioTower,
  Save,
  Search,
  Server,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import aviIconUrl from '../../../assets/icon/avi.png';
import { classNames } from '../lib/format.js';
import { intelligenceLevelLimits, titleCaseEffort } from '../lib/models.js';
import { AivaxFeaturesSettings } from './AivaxFeaturesSettings.jsx';
import { AppearanceSettings } from './AppearanceSettings.jsx';
import { MaintenanceSettings } from './MaintenanceSettings.jsx';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { McpSettings } from './McpSettings.jsx';
import { PluginsSettings } from './PluginsSettings.jsx';
import { RemoteSettings } from './RemoteSettings.jsx';

const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const capabilityOptions = [
  { value: 'images', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'pdfFiles', label: 'PDF files' },
];
const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const personalityDescriptions = Object.freeze({
  none: 'Uses only Avi base instructions without an additional personality.',
  candid: 'Direct and encouraging, with clear feedback and concrete next steps.',
  cynical: 'Critical and dryly sarcastic, questioning weak assumptions without hostility.',
  friendly: 'Warm, supportive, and collaborative while remaining honest and direct.',
  pragmatic: 'Concise, factual, and focused on technical clarity and momentum.',
  quirky: 'Playful and imaginative, using memorable explanations without losing precision.',
});
const verbosityOptions = Object.freeze([
  { value: 'low', label: 'Low', description: 'Terse UX with minimal prose and only the context needed to act.' },
  { value: 'medium', label: 'Medium', description: 'Balanced detail for clear, actionable answers without unnecessary expansion.' },
  { value: 'high', label: 'High', description: 'Thorough responses for audits, teaching, and hand-offs without repetition or filler.' },
]);


function MultiSelect({ label, onChange, options, values }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedLabels = options
    .filter((option) => values.includes(option.value))
    .map((option) => option.label);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnKeyDown);
    };
  }, [open]);

  return (
    <div className="model-multiselect" ref={rootRef}>
      <button
        className="model-multiselect-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={classNames(!selectedLabels.length && 'placeholder')}>
          {selectedLabels.length ? selectedLabels.join(', ') : 'None selected'}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <DropdownMenu
          className="model-multiselect-menu"
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
        >
          {options.map((option) => {
            const selected = values.includes(option.value);
            return (
              <DropdownMenuItem
                key={option.value}
                active={selected}
                role="option"
                aria-selected={selected}
                icon={<span className="model-multiselect-check">{selected && <Check size={13} />}</span>}
                onClick={() => onChange(selected
                  ? values.filter((value) => value !== option.value)
                  : [...values, option.value])}
              >
                {option.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu>
      )}
    </div>
  );
}

function DefaultModelField({
  description,
  label,
  models,
  onChange,
  required = false,
  value,
}) {
  const selectedModel = models.find((model) => model.id === value?.modelId) ?? null;
  const supportedReasoning = Array.isArray(selectedModel?.reasoning)
    ? selectedModel.reasoning
    : [];
  const modelsByProvider = models.reduce((groups, model) => {
    const providerId = model.providerId ?? '';
    const group = groups.get(providerId);
    if (group) {
      group.models.push(model);
    } else {
      groups.set(providerId, {
        label: model.providerName ?? providerId,
        models: [model],
      });
    }
    return groups;
  }, new Map());
  return (
    <div className="settings-field settings-field-wide default-model-field">
      <span>{label}</span>
      <div className="default-model-row">
        <select
          value={value?.modelId ?? ''}
          onChange={(event) => {
            const model = models.find((item) => item.id === event.target.value);
            onChange(model ? {
              modelId: model.id,
              reasoningEffort: (Array.isArray(model.reasoning) ? model.reasoning : [])
                .includes(value?.reasoningEffort)
                ? value.reasoningEffort
                : null,
            } : null);
          }}
        >
          <option value="">{required ? 'Select a model' : 'None'}</option>
          {[...modelsByProvider].map(([providerId, group]) => (
            <optgroup key={providerId} label={group.label}>
              {group.models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          aria-label={`${label} reasoning effort`}
          disabled={!selectedModel}
          value={value?.reasoningEffort ?? ''}
          onChange={(event) => onChange({
            ...value,
            reasoningEffort: event.target.value || null,
          })}
        >
          <option value="">Default reasoning</option>
          {supportedReasoning.map((effort) => (
            <option key={effort} value={effort}>{effort}</option>
          ))}
        </select>
      </div>
      <small>{description}</small>
    </div>
  );
}

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
  providerTypes,
  tuning,
  models,
  defaultModels,
  initialContextFolder = null,
  initialView = null,
  appearance,
  backgroundUrl,
  pluginCatalog = {},
  desktop,
  onAppearanceChange,
  onBackgroundSelect,
  onBackgroundRemove,
  onDesktopChange,
  onClose,
  onSave,
  onRemove,
  onRoutersChange,
  onSaveDefaultModels,
  onSaveTuning,
}) {
  const [view, setView] = useState(
    initialView ?? (initialContextFolder ? 'context-folder' : 'general'),
  );
  const [selectedId, setSelectedId] = useState(null);
  const [providerDraft, setProviderDraft] = useState(null);
  const [routers, setRouters] = useState([]);
  const [routerDraft, setRouterDraft] = useState(null);
  const [routersLoading, setRoutersLoading] = useState(false);
  const [modelDraft, setModelDraft] = useState(null);
  const [modelIndex, setModelIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [providerListMessage, setProviderListMessage] = useState('');
  const [providerImportOpen, setProviderImportOpen] = useState(false);
  const [providerImportDialog, setProviderImportDialog] = useState(null);
  const [providerShareDialog, setProviderShareDialog] = useState(null);
  const providerImportRef = useRef(null);
  const [contextFolders, setContextFolders] = useState([]);
  const [selectedContextFolder, setSelectedContextFolder] = useState(initialContextFolder);
  const [contextFolder, setContextFolder] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [mcpNavigation, setMcpNavigation] = useState(null);
  const [providerState, setProviderState] = useState(null);
  const [copiedProviderValue, setCopiedProviderValue] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');
  const [previewScheme, setPreviewScheme] = useState(appearance.scheme);
  const [tuningDraft, setTuningDraft] = useState(tuning);
  const [defaultModelsDraft, setDefaultModelsDraft] = useState(defaultModels);
  const [defaultModelsSaved, setDefaultModelsSaved] = useState(false);
  const updateIntelligenceLevel = (index, changes) => {
    setDefaultModelsSaved(false);
    setDefaultModelsDraft((current) => ({
      ...current,
      intelligence: {
        levels: current.intelligence.levels.map((level, levelIndex) => (
          levelIndex === index ? { ...level, ...changes } : level
        )),
      },
    }));
  };
  const moveIntelligenceLevel = (from, to) => {
    setDefaultModelsSaved(false);
    setDefaultModelsDraft((current) => {
      const levels = [...current.intelligence.levels];
      [levels[from], levels[to]] = [levels[to], levels[from]];
      return { ...current, intelligence: { levels } };
    });
  };
  const [tuningSaved, setTuningSaved] = useState(false);
  const [terminalShells, setTerminalShells] = useState(null);
  const [terminalShellError, setTerminalShellError] = useState('');
  const [terminalShellLoadAttempt, setTerminalShellLoadAttempt] = useState(0);
  const selectedProvider = providers.find((provider) => provider.id === selectedId) ?? null;
  const selectedType = providerTypes.find((type) => (
    type.id === (providerDraft?.interface ?? selectedProvider?.interface)
  ));
  const selectedTerminalShell = terminalShells?.find(
    (shell) => shell.id === tuningDraft?.terminalShell,
  );
  const personalities = [
    { id: 'none', name: 'None', description: personalityDescriptions.none },
    ...Object.entries(personalityDescriptions)
      .filter(([id]) => id !== 'none')
      .map(([id, description]) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)}`, description })),
    ...(pluginCatalog.personalities ?? []).filter((personality) => (
      personality?.id && !Object.hasOwn(personalityDescriptions, personality.id)
    )),
  ];
  const activePersonality = personalities.find(
    (personality) => personality.id === (tuningDraft.personality ?? 'none'),
  ) ?? personalities[0];
  const activeVerbosity = verbosityOptions.find(
    (option) => option.value === (tuningDraft.verbosity ?? 'medium'),
  ) ?? verbosityOptions[1];

  useEffect(() => {
    if (!providerImportOpen) return undefined;

    const closeOnPointerDown = (event) => {
      if (!providerImportRef.current?.contains(event.target)) setProviderImportOpen(false);
    };
    const closeOnKeyDown = (event) => {
      if (event.key === 'Escape') setProviderImportOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnKeyDown);
    };
  }, [providerImportOpen]);

  useEffect(() => {
    if (view !== 'routers') return undefined;
    let cancelled = false;
    setRoutersLoading(true);
    setError('');
    window.chatApp.routers.list()
      .then((items) => {
        if (!cancelled) setRouters(items);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) setRoutersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

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
    if (view !== 'general') return undefined;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setTerminalShells([]);
        setTerminalShellError('The shell detector did not respond within 10 seconds.');
      }
    }, 10_000);
    setTerminalShells(null);
    setTerminalShellError('');
    Promise.resolve()
      .then(() => window.chatApp.tuning.shells())
      .then((shells) => {
        if (!cancelled) setTerminalShells(shells);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setTerminalShells([]);
          setTerminalShellError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [view, terminalShellLoadAttempt]);

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

  useEffect(() => {
    if (!selectedProvider) {
      setProviderState(null);
      return undefined;
    }
    let active = true;
    setProviderState(null);
    setCopiedProviderValue('');
    window.chatApp.providers.state(selectedProvider.id)
      .then((status) => {
        if (active) setProviderState(status);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, [selectedProvider?.id]);

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

  async function shareProvider(includeApiKey) {
    const sharedProvider = structuredClone(providerShareDialog);
    if (!includeApiKey) delete sharedProvider.apiKey;
    await navigator.clipboard.writeText(JSON.stringify(sharedProvider, null, 2));
    setProviderShareDialog(null);
    setProviderListMessage(
      `Provider "${providerShareDialog.name}" copied to the clipboard ${includeApiKey ? 'with' : 'without'} its API key.`,
    );
  }

  async function reviewProviderImport(json, source) {
    if (!json.trim()) throw new Error('The provider JSON is empty.');
    let importedProvider;
    try {
      importedProvider = JSON.parse(json);
    } catch {
      throw new Error('The provider import does not contain valid JSON.');
    }
    if (!importedProvider || typeof importedProvider !== 'object' || Array.isArray(importedProvider)) {
      throw new Error('The shared JSON must contain one provider.');
    }
    const provider = await window.chatApp.providers.normalize({
      ...importedProvider,
      id: crypto.randomUUID(),
    });
    setProviderImportDialog({ mode: 'review', provider, source });
  }

  function startProviderCreation(interfaceId) {
    const type = providerTypes.find((item) => item.id === interfaceId);
    const provider = {
      id: crypto.randomUUID(),
      name: type?.defaultName ?? '',
      baseUrl: '',
      interface: interfaceId,
      apiKey: '',
      ...Object.fromEntries((type?.fields ?? []).map((field) => [
        field.id,
        field.default ?? '',
      ])),
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
    routers: 'Model routers',
    router: routerDraft?.name || 'New model router',
    type: 'Add provider',
    provider: providerDraft?.name || 'New provider',
    model: modelDraft?.name || (modelIndex < 0 ? 'New model' : 'Edit model'),
    'context-folders': 'Context',
    'context-folder': selectedContextFolder?.name || 'Context',
    mcp: mcpNavigation?.title || 'MCP servers',
    plugins: 'Plugins',
    remote: 'Remote control',
    aivax: 'AIVAX Features',
    maintenance: 'Maintenance',
    'default-models': 'Default models',
    general: 'General',
    tuning: 'Tuning',
    personalization: 'Personalization',
    about: 'About Avi',
  }[view];
  const pageDescription = {
    list: 'Manage the connections and models available in chats.',
    routers: 'Route requests across an ordered set of available models.',
    router: 'Configure the routing mode and ordered model sequence.',
    type: 'Choose the API interface implemented by this provider.',
    provider: selectedType
      ? `${selectedType.name} · ${selectedType.description}`
      : 'Configure this provider connection and its models.',
    model: `Configure the model exposed by ${selectedProvider?.name || 'this provider'}.`,
    'context-folders': 'Manage instructions, skills, and workflows by folder.',
    'context-folder': selectedContextFolder?.displayPath || '',
    mcp: mcpNavigation?.description
      || 'Manage global and per-folder Model Context Protocol servers.',
    plugins: 'View trusted JavaScript plugins installed in Avi.',
    remote: 'Expose Avi orchestration through a local authenticated MCP server.',
    aivax: 'Add persistent memory, richer web tools, and semantic thread search through AIVAX.',
    maintenance: 'Manage archived conversations, storage cleanup, and semaphore permits.',
    'default-models': 'Choose models for supporting tasks, supervision, and sub-agent orchestration.',
    general: 'Configure chat behavior and desktop integration.',
    tuning: 'Adjust context, tool execution, parallel work, and diagnostics.',
    personalization: 'Choose Avi’s personality, response detail, theme, and color scheme.',
    about: 'Project information, version, and links.',
  }[view];
  const showInlineBack = !['list', 'routers', 'context-folders', 'mcp', 'plugins', 'remote', 'aivax', 'maintenance', 'default-models', 'general', 'tuning', 'personalization', 'about'].includes(view)
    || (view === 'mcp' && Boolean(mcpNavigation?.onBack));
  const importedProvider = providerImportDialog?.mode === 'review'
    ? providerImportDialog.provider
    : null;
  const importedProviderType = providerTypes.find(
    (type) => type.id === importedProvider?.interface,
  );

  return (
    <section className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-titlebar" />
        <button className="settings-back" type="button" onClick={onClose}>
          <ArrowLeft size={15} />
          Back to app
        </button>
        <div className="settings-search">
          <Search size={14} />
          <input
            type="search"
            value={settingsQuery}
            aria-label="Search settings"
            placeholder="Search settings..."
            onChange={(event) => setSettingsQuery(event.target.value.toLowerCase())}
          />
        </div>
        <nav className="settings-navigation" aria-label="Settings sections">
          {(!settingsQuery || 'general reasoning traces permission message delivery shell terminal background tray login logon'.includes(settingsQuery)) && (
            <button
              className={view === 'general' ? 'active' : undefined}
              type="button"
              aria-current={view === 'general' ? 'page' : undefined}
              onClick={() => {
                setView('general');
                setError('');
                setTuningSaved(false);
              }}
            >
              <Boxes size={16} />
              General
            </button>
          )}
          {(!settingsQuery || 'tuning compaction output terminal timeout sub-agents diagnostics logging logs'.includes(settingsQuery)) && (
            <button
              className={view === 'tuning' ? 'active' : undefined}
              type="button"
              aria-current={view === 'tuning' ? 'page' : undefined}
              onClick={() => {
                setView('tuning');
                setError('');
                setTuningSaved(false);
              }}
            >
              <SlidersHorizontal size={16} />
              Tuning
            </button>
          )}
          {(!settingsQuery || 'personalization personality verbosity response detail low medium high terse balanced verbose audit teaching hand-off theme themes color scheme light dark monokai absolute code goblin axion preview'.includes(settingsQuery)) && (
            <button
              className={view === 'personalization' ? 'active' : undefined}
              type="button"
              aria-current={view === 'personalization' ? 'page' : undefined}
              onClick={() => {
                setView('personalization');
                setPreviewScheme(appearance.scheme);
                setError('');
                setTuningSaved(false);
              }}
            >
              <Palette size={16} />
              Personalization
            </button>
          )}

          <div className="settings-navigation-separator" role="separator" />
          <span>Models</span>
          {(!settingsQuery || 'models providers api'.includes(settingsQuery)) && (
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
          )}
          {(!settingsQuery || 'models routers routing fallback round robin ordered'.includes(settingsQuery)) && (
            <button
              className={['routers', 'router'].includes(view) ? 'active' : undefined}
              type="button"
              aria-current={['routers', 'router'].includes(view) ? 'page' : undefined}
              onClick={() => {
                setView('routers');
                setRouterDraft(null);
                setError('');
              }}
            >
              <Workflow size={16} />
              Routers
            </button>
          )}
          {(!settingsQuery || 'models default auxiliary supervision quick chat sub-agent orchestration fallback reasoning compactation compression'.includes(settingsQuery)) && (
            <button
              className={view === 'default-models' ? 'active' : undefined}
              type="button"
              aria-current={view === 'default-models' ? 'page' : undefined}
              onClick={() => {
                setView('default-models');
                setError('');
                setDefaultModelsSaved(false);
              }}
            >
              <Network size={16} />
              Default models
            </button>
          )}
          {(!settingsQuery || 'context instructions skills workflows'.includes(settingsQuery)) && (
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
              Context
            </button>
          )}
          {(!settingsQuery || 'mcp servers integrations tools'.includes(settingsQuery)) && (
            <button
              className={view === 'mcp' ? 'active' : undefined}
              type="button"
              aria-current={view === 'mcp' ? 'page' : undefined}
              onClick={() => {
                setView('mcp');
                setError('');
              }}
            >
              <RadioTower size={16} />
              MCP Servers
            </button>
          )}
          {(!settingsQuery || 'plugins extensions javascript themes personalities tools'.includes(settingsQuery)) && (
            <button
              className={view === 'plugins' ? 'active' : undefined}
              type="button"
              aria-current={view === 'plugins' ? 'page' : undefined}
              onClick={() => { setView('plugins'); setError(''); }}
            >
              <Boxes size={16} />
              Plugins
            </button>
          )}

          <div className="settings-navigation-separator" role="separator" />
          {(!settingsQuery || 'aivax features memory account balance plan web search fetch semantic thread rag collection index'.includes(settingsQuery)) && (
            <button
              className={view === 'aivax' ? 'active' : undefined}
              type="button"
              aria-current={view === 'aivax' ? 'page' : undefined}
              onClick={() => {
                setView('aivax');
                setError('');
              }}
            >
              <Sparkles size={16} />
              AIVAX Features
            </button>
          )}

          <div className="settings-navigation-separator" role="separator" />

          {(!settingsQuery || 'remote control mcp http api key bearer token port'.includes(settingsQuery)) && (
            <button
              className={view === 'remote' ? 'active' : undefined}
              type="button"
              aria-current={view === 'remote' ? 'page' : undefined}
              onClick={() => {
                setView('remote');
                setError('');
              }}
            >
              <Globe2 size={16} />
              Remote control
            </button>
          )}
          {(!settingsQuery || 'maintenance archive archived conversations retention cleanup restore storage semaphores permits'.includes(settingsQuery)) && (
            <button
              className={view === 'maintenance' ? 'active' : undefined}
              type="button"
              aria-current={view === 'maintenance' ? 'page' : undefined}
              onClick={() => {
                setView('maintenance');
                setError('');
              }}
            >
              <Wrench size={16} />
              Maintenance
            </button>
          )}

          <div className="settings-navigation-separator" role="separator" />
          {(!settingsQuery || 'about avi version website github repository project'.includes(settingsQuery)) && (
            <button
              className={view === 'about' ? 'active' : undefined}
              type="button"
              aria-current={view === 'about' ? 'page' : undefined}
              onClick={() => {
                setView('about');
                setError('');
              }}
            >
              <Info size={16} />
              About
            </button>
          )}
        </nav>
      </aside>

      <main className="settings-main">
        <header className="settings-page-header">
          <div>
            {showInlineBack && (
              <button
                className="settings-inline-back"
                type="button"
                onClick={() => {
                  if (view === 'mcp') {
                    mcpNavigation.onBack();
                    return;
                  }
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
                  if (view === 'router') {
                    setView('routers');
                    setRouterDraft(null);
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
                {view === 'mcp'
                  ? mcpNavigation.backLabel
                  : view === 'context-folder'
                    ? 'Back to folders'
                    : view === 'model'
                      ? 'Back to provider'
                      : view === 'router'
                        ? 'Back to routers'
                        : 'Back'}
              </button>
            )}
            <div className="settings-page-title-row">
              <div>
                <h2>{pageTitle}</h2>
                <p>{pageDescription}</p>
              </div>
              {view === 'list' && (
                <div className="settings-add-provider-group" ref={providerImportRef}>
                  <button
                    className="primary-mini settings-add-provider"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setView('type');
                      setError('');
                      setProviderListMessage('');
                    }}
                  >
                    <Plus size={14} />
                    Add provider
                  </button>
                  <button
                    className="primary-mini settings-add-provider-menu-trigger"
                    type="button"
                    disabled={busy}
                    aria-label="More provider actions"
                    aria-haspopup="menu"
                    aria-expanded={providerImportOpen}
                    onClick={() => setProviderImportOpen((open) => !open)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  {providerImportOpen && (
                    <DropdownMenu className="settings-add-provider-menu" role="menu">
                      <DropdownMenuItem
                        icon={<ClipboardPaste size={14} />}
                        role="menuitem"
                        onClick={() => {
                          setProviderImportOpen(false);
                          setProviderListMessage('');
                          setError('');
                          setProviderImportDialog({ mode: 'json', json: '' });
                        }}
                      >
                        Import
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<Link size={14} />}
                        role="menuitem"
                        onClick={() => {
                          setProviderImportOpen(false);
                          setProviderListMessage('');
                          setError('');
                          setProviderImportDialog({ mode: 'url', url: '' });
                        }}
                      >
                        Import from URL
                      </DropdownMenuItem>
                    </DropdownMenu>
                  )}
                </div>
              )}
              {view === 'routers' && (
                <button
                  className="primary-mini settings-add-provider"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRouterDraft({
                      id: `@${crypto.randomUUID()}`,
                      name: '',
                      mode: 'fallback',
                      models: [],
                    });
                    setError('');
                    setView('router');
                  }}
                >
                  <Plus size={14} />
                  Add router
                </button>
              )}
              {view === 'mcp' && mcpNavigation?.onAction && (
                <button
                  className="primary-mini settings-add-provider"
                  type="button"
                  onClick={mcpNavigation.onAction}
                >
                  <Plus size={14} />
                  {mcpNavigation.actionLabel}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="settings-content">
          <div className="settings-content-inner">
            {view === 'list' && (
              <section className="settings-section">
                {(error || providerListMessage) && (
                  <div
                    className={classNames('settings-provider-notice', error && 'error')}
                    role={error ? 'alert' : 'status'}
                  >
                    {error || providerListMessage}
                  </div>
                )}
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
                          <span className="settings-entity-icon">
                            {type?.icon === 'sparkles'
                              ? <Sparkles size={16} />
                              : <Server size={16} />}
                          </span>
                          <span className="settings-entity-copy">
                            <strong>{provider.name}</strong>
                            <small>
                              {type?.description ?? provider.interface}
                              {' · '}
                              {type?.models === 'managed'
                                ? 'Managed model catalog'
                                : `${provider.models.length} ${provider.models.length === 1 ? 'model' : 'models'
                                }`}
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
                              label: 'Share',
                              icon: <Share2 size={14} />,
                              onClick: () => {
                                setProviderShareDialog(provider);
                                setProviderListMessage('');
                                setError('');
                              },
                            },
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

            {view === 'routers' && (
              <section className="settings-section">
                {error && (
                  <div className="settings-provider-notice error" role="alert">{error}</div>
                )}
                <div className="settings-list-summary">
                  <span>{routers.length} {routers.length === 1 ? 'router' : 'routers'}</span>
                  <span>{routers.reduce((count, router) => count + router.models.length, 0)} routes</span>
                </div>
                <div className="settings-entity-list">
                  {routers.map((router) => (
                    <article className="settings-entity-row settings-router-row" key={router.id}>
                      <button
                        className="settings-entity-main"
                        type="button"
                        onClick={() => {
                          setRouterDraft(structuredClone(router));
                          setError('');
                          setView('router');
                        }}
                      >
                        <span className="settings-entity-icon"><Workflow size={16} /></span>
                        <span className="settings-entity-copy">
                          <strong>{router.name}</strong>
                          <small>
                            {router.mode === 'round-robin' ? 'Round robin' : 'Fallback'}
                            {' · '}
                            {router.models.length} {router.models.length === 1 ? 'model' : 'models'}
                          </small>
                        </span>
                        <ArrowRight className="settings-entity-arrow" size={15} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        disabled={busy}
                        aria-label={`Delete ${router.name}`}
                        onClick={() => {
                          if (!window.confirm(`Delete model router "${router.name}"?`)) return;
                          runProviderMutation(async () => {
                            await window.chatApp.routers.remove(router.id);
                            const nextRouters = await window.chatApp.routers.list();
                            setRouters(nextRouters);
                            await onRoutersChange();
                          });
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </article>
                  ))}
                  {!routersLoading && routers.length === 0 && (
                    <div className="settings-empty settings-provider-empty">
                      <Workflow size={24} />
                      <strong>No model routers configured</strong>
                      <span>Add a router to combine models behind one selectable catalog entry.</span>
                      <button
                        className="primary-mini"
                        type="button"
                        onClick={() => {
                          setRouterDraft({
                            id: `@${crypto.randomUUID()}`,
                            name: '',
                            mode: 'fallback',
                            models: [],
                          });
                          setView('router');
                        }}
                      >
                        <Plus size={14} />
                        Add router
                      </button>
                    </div>
                  )}
                  {routersLoading && (
                    <div className="settings-empty" role="status">Loading model routers...</div>
                  )}
                </div>
              </section>
            )}

            {view === 'router' && routerDraft && (
              <section className="settings-router-detail settings-section">
                <div className="settings-section-card settings-form">
                  <label className="settings-field">
                    <span>Name</span>
                    <input
                      value={routerDraft.name}
                      required
                      placeholder="Reliable coding model"
                      onChange={(event) => setRouterDraft({
                        ...routerDraft,
                        name: event.target.value,
                      })}
                    />
                  </label>
                  <label className="settings-field">
                    <span>Routing mode</span>
                    <select
                      value={routerDraft.mode}
                      onChange={(event) => setRouterDraft({
                        ...routerDraft,
                        mode: event.target.value,
                      })}
                    >
                      <option value="fallback">Fallback</option>
                      <option value="round-robin">Round robin</option>
                    </select>
                    <small>
                      {routerDraft.mode === 'round-robin'
                        ? 'Cycles through the configured models in order.'
                        : 'Tries each configured model in order until one succeeds.'}
                    </small>
                  </label>
                  <label className="settings-field settings-field-wide">
                    <span>Add model</span>
                    <select
                      value=""
                      onChange={(event) => {
                        if (!event.target.value) return;
                        setRouterDraft({
                          ...routerDraft,
                          models: [...routerDraft.models, { modelId: event.target.value }],
                        });
                      }}
                    >
                      <option value="">Select a model</option>
                      {models.map((model) => (
                        !model.id.startsWith('@')
                        && !routerDraft.models.some((entry) => entry.modelId === model.id)
                          ? (
                              <option key={model.id} value={model.id}>
                                {model.providerName ? `${model.providerName} · ` : ''}{model.name}
                              </option>
                            )
                          : null
                      ))}
                    </select>
                    <small>Models are attempted or selected in the order shown below.</small>
                  </label>
                </div>

                <div className="settings-router-models" aria-label="Ordered router models">
                  {routerDraft.models.map((entry, index) => {
                    const model = models.find((item) => item.id === entry.modelId);
                    const available = entry.available
                      ?? entry.availability?.available
                      ?? Boolean(model);
                    return (
                      <div className="settings-router-model" key={entry.modelId}>
                        <span className="settings-router-model-order">{index + 1}</span>
                        <span className="settings-router-model-copy">
                          <strong>{model?.name ?? entry.modelId}</strong>
                          <small>{model?.providerName ?? (model ? entry.modelId : 'Missing from model catalog')}</small>
                        </span>
                        <span className={classNames('settings-status', available ? 'enabled' : 'disabled')}>
                          {available ? 'Available' : 'Unavailable'}
                        </span>
                        <div className="settings-router-model-actions">
                          <button
                            className="icon-button"
                            type="button"
                            disabled={index === 0}
                            aria-label={`Move ${model?.name ?? entry.modelId} up`}
                            onClick={() => {
                              const nextModels = [...routerDraft.models];
                              [nextModels[index - 1], nextModels[index]] = [nextModels[index], nextModels[index - 1]];
                              setRouterDraft({ ...routerDraft, models: nextModels });
                            }}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            disabled={index === routerDraft.models.length - 1}
                            aria-label={`Move ${model?.name ?? entry.modelId} down`}
                            onClick={() => {
                              const nextModels = [...routerDraft.models];
                              [nextModels[index], nextModels[index + 1]] = [nextModels[index + 1], nextModels[index]];
                              setRouterDraft({ ...routerDraft, models: nextModels });
                            }}
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            className="icon-button danger"
                            type="button"
                            aria-label={`Remove ${model?.name ?? entry.modelId}`}
                            onClick={() => setRouterDraft({
                              ...routerDraft,
                              models: routerDraft.models.filter((_, modelIndex) => modelIndex !== index),
                            })}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {routerDraft.models.length === 0 && (
                    <div className="settings-empty">
                      <Workflow size={22} />
                      <strong>No models in this router</strong>
                      <span>Select at least one model to save the router.</span>
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
                          <span className="settings-context-summary">Open to inspect</span>
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

            {view === 'remote' && <RemoteSettings />}
            {view === 'plugins' && <PluginsSettings />}
            {view === 'aivax' && <AivaxFeaturesSettings />}
            {view === 'maintenance' && <MaintenanceSettings />}
            {view === 'mcp' && (
              <McpSettings
                initialFolder={initialContextFolder}
                onNavigationChange={setMcpNavigation}
              />
            )}

            {view === 'about' && (
              <section className="settings-about">
                <div className="settings-about-hero">
                  <img className="settings-about-logo" src={aviIconUrl} alt="Avi logo" />
                  <div>
                    <h3>Avi</h3>
                    <p>
                      A local desktop workspace for AI conversations, tools, and orchestration.
                    </p>
                  </div>
                </div>
                <dl className="settings-about-details">
                  <div>
                    <dt>Version</dt>
                    <dd>{__APP_VERSION__}</dd>
                  </div>
                  <div>
                    <dt>Website</dt>
                    <dd>
                      <a
                        className="settings-about-link"
                        href="https://avi.aivax.net"
                        onClick={(event) => {
                          event.preventDefault();
                          window.chatApp.app.openExternal(event.currentTarget.href);
                        }}
                      >
                        <Globe2 size={15} />
                        avi.aivax.net
                        <ExternalLink size={13} />
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Repository</dt>
                    <dd>
                      <a
                        className="settings-about-link"
                        href="https://github.com/aivaxlabs/avi"
                        onClick={(event) => {
                          event.preventDefault();
                          window.chatApp.app.openExternal(event.currentTarget.href);
                        }}
                      >
                        <Github size={15} />
                        github.com/aivaxlabs/avi
                        <ExternalLink size={13} />
                      </a>
                    </dd>
                  </div>
                </dl>
                <p className="settings-about-credit">
                  Created and maintained by <strong>AIVAX Labs</strong>.
                </p>
              </section>
            )}

            {view === 'default-models' && defaultModelsDraft && (
              <div className="settings-tuning">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>General tasks</h3>
                    <p>Optional models used for supporting tasks, Quick Chat, agent supervision, and context compactation.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <DefaultModelField
                      label="Auxiliary model"
                      description="Used for goal analysis, task titles, and other supporting tasks. Choose None to disable it."
                      models={models}
                      value={defaultModelsDraft.auxiliary}
                      onChange={(value) => {
                        setDefaultModelsSaved(false);
                        setDefaultModelsDraft((current) => ({ ...current, auxiliary: value }));
                      }}
                    />
                    <DefaultModelField
                      label="Supervision model"
                      description="Used to supervise agents and look for new tasks. Choose None to disable supervision."
                      models={models}
                      value={defaultModelsDraft.supervision}
                      onChange={(value) => {
                        setDefaultModelsSaved(false);
                        setDefaultModelsDraft((current) => ({ ...current, supervision: value }));
                      }}
                    />
                    <DefaultModelField
                      label="Compactation model"
                      description="Best-effort model used to compress the conversation context. When inference fails, the chat model performs the compactation. Choose None to always use the chat model."
                      models={models}
                      value={defaultModelsDraft.compactation}
                      onChange={(value) => {
                        setDefaultModelsSaved(false);
                        setDefaultModelsDraft((current) => ({ ...current, compactation: value }));
                      }}
                    />
                    <DefaultModelField
                      label="Quick chat model"
                      description="Reserved for the upcoming Quick Chat experience. Choose None to leave it unconfigured."
                      models={models}
                      value={defaultModelsDraft.quickChat}
                      onChange={(value) => {
                        setDefaultModelsSaved(false);
                        setDefaultModelsDraft((current) => ({ ...current, quickChat: value }));
                      }}
                    />
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Sub-agent model levels</h3>
                    <p>When enabled, orchestration tools request a task level instead of a model and reasoning effort.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Use model levels</strong>
                        <small>Requires small, medium, and large models. If one is unavailable, Avi uses the orchestrator or last-used model.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={defaultModelsDraft.subagents.enabled}
                        onChange={(event) => {
                          setDefaultModelsSaved(false);
                          setDefaultModelsDraft((current) => ({
                            ...current,
                            subagents: { ...current.subagents, enabled: event.target.checked },
                          }));
                        }}
                      />
                    </label>
                    {defaultModelsDraft.subagents.enabled && [
                      ['small', 'Small model', 'Code exploration, context aggregation, and research.'],
                      ['medium', 'Medium model', 'Reports, deeper research, and bug analysis.'],
                      ['large', 'Large model', 'Complex implementations and detailed exploration.'],
                    ].map(([key, label, description]) => (
                      <DefaultModelField
                        key={key}
                        label={label}
                        description={description}
                        models={models}
                        required
                        value={defaultModelsDraft.subagents[key]}
                        onChange={(value) => {
                          setDefaultModelsSaved(false);
                          setDefaultModelsDraft((current) => ({
                            ...current,
                            subagents: { ...current.subagents, [key]: value },
                          }));
                        }}
                      />
                    ))}
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Intelligence levels</h3>
                    <p>Between 3 and 10 levels for the composer intelligence slider. Each level selects a model and an optional reasoning effort.</p>
                  </div>
                  {(defaultModelsDraft.intelligence?.levels ?? []).map((level, index, levels) => {
                    const levelModel = models.find((model) => model.id === level.modelId);
                    const levelEffort = level.reasoningEffort
                      ?? (levelModel?.reasoning.includes('medium')
                        ? 'medium'
                        : levelModel?.reasoning[0] ?? null);
                    const levelSummary = levelModel
                      ? `${levelModel.name} - ${titleCaseEffort(levelEffort) || 'Default'}`
                      : `Level ${index + 1}`;
                    return (
                      <div
                        className="settings-section-card settings-form settings-row-card"
                        key={level.id}
                      >
                        <DefaultModelField
                          label={`Level ${index + 1}`}
                          description="Select the model and reasoning effort used at this slider position."
                          models={models}
                          required
                          value={level.modelId ? {
                            modelId: level.modelId,
                            reasoningEffort: level.reasoningEffort,
                          } : null}
                          onChange={(value) => updateIntelligenceLevel(index, {
                            modelId: value?.modelId ?? '',
                            reasoningEffort: value?.reasoningEffort ?? null,
                          })}
                        />
                        <div className="settings-card-row">
                        <span>{levelSummary}</span>
                        <span>
                          <button
                            className="icon-button tiny"
                            type="button"
                            disabled={index === 0}
                            aria-label={`Move level ${index + 1} up`}
                            onClick={() => moveIntelligenceLevel(index, index - 1)}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            className="icon-button tiny"
                            type="button"
                            disabled={index === levels.length - 1}
                            aria-label={`Move level ${index + 1} down`}
                            onClick={() => moveIntelligenceLevel(index, index + 1)}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            className="icon-button tiny danger"
                            type="button"
                            disabled={levels.length === intelligenceLevelLimits.min}
                            aria-label={`Remove level ${index + 1}`}
                            onClick={() => {
                              setDefaultModelsSaved(false);
                              setDefaultModelsDraft((current) => ({
                                ...current,
                                intelligence: {
                                  levels: current.intelligence.levels.filter(
                                    (_, levelIndex) => levelIndex !== index,
                                  ),
                                },
                              }));
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="settings-section-card settings-form settings-row-card">
                    <div className="settings-card-row">
                      <span>
                        {(defaultModelsDraft.intelligence?.levels?.length ?? 0) === 0
                          ? 'No intelligence levels configured. The composer model picker stays in advanced mode.'
                          : `${defaultModelsDraft.intelligence.levels.length} of ${intelligenceLevelLimits.max} levels configured.`}
                      </span>
                      <button
                        type="button"
                        className="primary-mini"
                        disabled={(defaultModelsDraft.intelligence?.levels?.length ?? 0)
                          >= intelligenceLevelLimits.max}
                        onClick={() => {
                          setDefaultModelsSaved(false);
                          setDefaultModelsDraft((current) => ({
                            ...current,
                            intelligence: {
                              levels: [
                                ...(current.intelligence?.levels ?? []),
                                {
                                  id: crypto.randomUUID(),
                                  modelId: '',
                                  reasoningEffort: null,
                                },
                              ],
                            },
                          }));
                        }}
                      >
                        <Plus size={13} />
                        Add level
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {view === 'general' && tuningDraft && (
              <div className="settings-tuning">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Chat</h3>
                    <p>Set the defaults used by conversations and terminal commands.</p>
                  </div>
                  <div className="settings-section-card settings-form settings-row-card">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Continuation replies</strong>
                        <small>Suggest up to four likely replies after the assistant finishes.</small>
                      </span>
                      <input
                        className="appearance-desktop-switch"
                        type="checkbox"
                        checked={tuningDraft.continuationRepliesEnabled}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            continuationRepliesEnabled: event.target.checked,
                          }));
                        }}
                      />
                    </label>
                    <label className="settings-field settings-field-wide">
                      <span>Chat reasoning traces</span>
                      <select
                        value={tuningDraft.chatReasoningTraces}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            chatReasoningTraces: event.target.value,
                          }));
                        }}
                      >
                        <option value="visible">Visible</option>
                        <option value="hidden">Hidden</option>
                      </select>
                      <small>
                        Controls whether reasoning and tool trace blocks appear in chats.
                      </small>
                    </label>
                    <label className="settings-field settings-field-wide">
                      <span>Default permission mode</span>
                      <select
                        value={tuningDraft.defaultPermissionMode}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            defaultPermissionMode: event.target.value,
                          }));
                        }}
                      >
                        <option value="ask_for_approval">Ask for approval</option>
                        <option value="approve_for_me">Approve for me</option>
                        <option value="full_access">Full access</option>
                      </select>
                      <small>
                        Used as the initial permission mode when a new conversation is created.
                      </small>
                    </label>
                    <label className="settings-field settings-field-wide">
                      <span>Message delivery mode</span>
                      <select
                        value={tuningDraft.messageDeliveryMode}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            messageDeliveryMode: event.target.value,
                          }));
                        }}
                      >
                        <option value="queue">Queue · Enter queues</option>
                        <option value="steer">Steer · Enter steers</option>
                      </select>
                      <small>
                        Queue uses Enter to enqueue and Ctrl+Enter to steer. Steer reverses these shortcuts.
                      </small>
                    </label>
                    <label className="settings-field settings-field-wide">
                      <span>Terminal shell</span>
                      <select
                        value={tuningDraft.terminalShell}
                        disabled={!terminalShells}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            terminalShell: event.target.value,
                          }));
                        }}
                      >
                        {!selectedTerminalShell && tuningDraft.terminalShell !== 'auto' && (
                          <option value={tuningDraft.terminalShell} disabled>
                            {tuningDraft.terminalShell} · Not installed
                          </option>
                        )}
                        {terminalShells?.map((shell) => (
                          <option key={shell.id} value={shell.id}>
                            {shell.label}
                          </option>
                        ))}
                      </select>
                      <small className={
                        terminalShellError || (terminalShells && !selectedTerminalShell)
                          ? 'settings-field-warning'
                          : undefined
                      }>
                        {!terminalShells
                          ? 'Detecting installed shells...'
                          : terminalShellError
                            ? `Unable to detect installed shells: ${terminalShellError}`
                            : selectedTerminalShell
                              ? `Commands run with ${selectedTerminalShell.label}. The installation is checked again before every command.`
                              : 'This shell is no longer installed. Choose an available option to continue.'}
                      </small>
                    </label>
                    {terminalShellError && (
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => setTerminalShellLoadAttempt((attempt) => attempt + 1)}
                      >
                        Try again
                      </button>
                    )}
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Desktop</h3>
                    <p>Control how Avi behaves when the window closes and when you sign in.</p>
                  </div>
                  <div className="settings-section-card settings-form settings-row-card">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Keep Avi in the background</strong>
                        <small>Continue running in the tray when the window is closed.</small>
                      </span>
                      <input
                        className="appearance-desktop-switch"
                        type="checkbox"
                        checked={desktop?.closeToTray === true}
                        onChange={(event) => onDesktopChange({ ...desktop, closeToTray: event.target.checked })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Start Avi on logon</strong>
                        <small>Launch Avi in the background when you sign in to your computer.</small>
                      </span>
                      <input
                        className="appearance-desktop-switch"
                        type="checkbox"
                        checked={desktop?.openAtLogin === true}
                        onChange={(event) => onDesktopChange({ ...desktop, openAtLogin: event.target.checked })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Notify when a conversation finishes</strong>
                        <small>Notify after a user-created main thread finishes with no sub-agents still running.</small>
                      </span>
                      <input
                        className="appearance-desktop-switch"
                        type="checkbox"
                        checked={desktop?.notifyOnCompletion === true}
                        onChange={(event) => onDesktopChange({ ...desktop, notifyOnCompletion: event.target.checked })}
                      />
                    </label>
                  </div>
                </section>
              </div>
            )}

            {view === 'tuning' && tuningDraft && (
              <div className="settings-tuning">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Context</h3>
                    <p>Choose when Avi compacts a conversation automatically.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <label className="settings-field settings-field-wide">
                      <span>Automatic compaction threshold</span>
                      <select
                        value={tuningDraft.automaticCompactionThreshold}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            automaticCompactionThreshold: Number(event.target.value),
                          }));
                        }}
                      >
                        <option value={0.8}>80%</option>
                        <option value={0.9}>90%</option>
                        <option value={0.95}>95%</option>
                      </select>
                      <small>
                        Creates a context checkpoint after the selected share of the model window is used.
                      </small>
                    </label>
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Tool execution</h3>
                    <p>Control retained tool output and the default terminal wait.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <label className="settings-field settings-field-wide">
                      <span>Tool output length</span>
                      <select
                        value={tuningDraft.toolOutputLimit ?? 'none'}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            toolOutputLimit: event.target.value === 'none'
                              ? null
                              : Number(event.target.value),
                          }));
                        }}
                      >
                        <option value={4_096}>Small · 1,024 tokens</option>
                        <option value={8_192}>Medium · 2,048 tokens</option>
                        <option value={32_768}>Long · 8,192 tokens</option>
                        <option value="none">Disabled · No limit</option>
                      </select>
                      <small>
                        Token count is estimated as output length divided by 4. Disabling truncation can exhaust the context window.
                      </small>
                    </label>
                    <label className="settings-field settings-field-wide">
                      <span>Terminal timeout</span>
                      <input
                        type="number"
                        min="5"
                        max="300"
                        step="1"
                        value={tuningDraft.terminalTimeoutSeconds}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            terminalTimeoutSeconds: Number(event.target.value),
                          }));
                        }}
                      />
                      <small>
                        Default wait in seconds when a terminal command does not provide its own timeout. From 5 to 300.
                      </small>
                    </label>
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Orchestration</h3>
                    <p>Bound parallel agent work for each conversation.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <label className="settings-field settings-field-wide">
                      <span>Max concurrent sub-agents per thread</span>
                      <input
                        type="number"
                        min="1"
                        max="128"
                        step="1"
                        value={tuningDraft.maxConcurrentSubagents}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            maxConcurrentSubagents: Number(event.target.value),
                          }));
                        }}
                      />
                      <small>
                        Global maximum of sub-agents that may run at the same time. From 1 to 128.
                      </small>
                    </label>
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Diagnostics</h3>
                    <p>Choose how much operational detail is written to ~/.aivax/trace.log. Fatal errors are always recorded.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <label className="settings-field settings-field-wide">
                      <span>Diagnosis log level</span>
                      <select
                        value={tuningDraft.logLevel}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            logLevel: event.target.value,
                          }));
                        }}
                      >
                        <option value="verbose">Verbose · Detailed timings and errors</option>
                        <option value="minimal">Minimal · Errors only</option>
                        <option value="disabled">Disabled · Fatal errors only</option>
                      </select>
                      <small>
                        Logs never include prompts, messages, tool inputs, attachments, API keys, or user file paths.
                      </small>
                    </label>
                  </div>
                </section>
              </div>
            )}

            {view === 'personalization' && tuningDraft && (
              <div className="settings-tuning">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Personality</h3>
                    <p>Choose the communication style applied globally to every conversation.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <label className="settings-field settings-field-wide">
                      <span>Personality</span>
                      <select
                        value={tuningDraft.personality ?? 'none'}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            personality: event.target.value === 'none'
                              ? null
                              : event.target.value,
                          }));
                        }}
                      >
                        {personalities.map((personality) => (
                          <option key={personality.id} value={personality.id}>{personality.name}</option>
                        ))}
                      </select>
                      <small>{activePersonality.description}</small>
                    </label>
                  </div>
                </section>
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>Verbosity</h3>
                    <p>Choose how much detail Avi includes in responses.</p>
                  </div>
                  <div className="settings-section-card settings-form">
                    <label className="settings-field settings-field-wide">
                      <span>Verbosity</span>
                      <select
                        value={tuningDraft.verbosity ?? 'medium'}
                        onChange={(event) => {
                          setTuningSaved(false);
                          setTuningDraft((current) => ({
                            ...current,
                            verbosity: event.target.value,
                          }));
                        }}
                      >
                        {verbosityOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <small>{activeVerbosity.description}</small>
                    </label>
                  </div>
                </section>
                <AppearanceSettings
                  appearance={appearance}
                  backgroundUrl={backgroundUrl}
                  previewScheme={previewScheme}
                  themeCatalog={pluginCatalog.themes ?? []}
                  onChange={(next) => {
                    setPreviewScheme(next.scheme);
                    onAppearanceChange(next);
                  }}
                  onBackgroundSelect={onBackgroundSelect}
                  onBackgroundRemove={onBackgroundRemove}
                />
              </div>
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
                      <span className="settings-entity-icon">
                        {type.icon === 'sparkles'
                          ? <Sparkles size={17} />
                          : <Server size={17} />}
                      </span>
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
                          onChange={(event) => {
                            const type = providerTypes.find(
                              (item) => item.id === event.target.value,
                            );
                            setProviderDraft({
                              ...providerDraft,
                              interface: event.target.value,
                              baseUrl: type?.connection === 'custom'
                                ? providerDraft.baseUrl
                                : '',
                              apiKey: type?.connection === 'custom' ? providerDraft.apiKey : '',
                              models: type?.models === 'custom' ? providerDraft.models : [],
                              ...Object.fromEntries((type?.fields ?? []).map((field) => [
                                field.id,
                                providerDraft[field.id] ?? field.default ?? '',
                              ])),
                            });
                          }}
                        >
                          {providerTypes.map((type) => (
                            <option value={type.id} key={type.id}>
                              {type.name} ({type.description})
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedType?.connection === 'managed' ? (
                        <div className="settings-field settings-field-wide subscription-auth">
                          <span>{providerState?.connection?.title ?? 'Managed connection'}</span>
                          <div className="subscription-auth-row">
                            <span className={classNames(
                              'settings-status',
                              providerState?.connection?.status === 'connected'
                                ? 'enabled'
                                : 'disabled',
                            )}>
                              {providerState?.connection?.statusLabel ?? 'Not connected'}
                            </span>
                            {selectedProvider ? (
                              providerState?.connection?.action && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => runProviderMutation(async () => {
                                    const result = await window.chatApp.providers.action({
                                      providerId: selectedProvider.id,
                                      action: providerState.connection.action.id,
                                    });
                                    setProviderState(result?.state ?? result);
                                    if (result?.followUp) {
                                      try {
                                        const completed = await window.chatApp.providers.action({
                                          providerId: selectedProvider.id,
                                          action: result.followUp.action,
                                          input: result.followUp.input,
                                        });
                                        setProviderState(completed?.state ?? completed);
                                      } catch (nextError) {
                                        setProviderState(
                                          await window.chatApp.providers.state(selectedProvider.id),
                                        );
                                        throw nextError;
                                      }
                                    }
                                  })}
                                >
                                  {providerState.connection.action.label}
                                </button>
                              )
                            ) : (
                              <small>Save the provider before signing in.</small>
                            )}
                          </div>
                          {providerState?.connection?.verification && (
                            <div className="provider-security-code" aria-live="polite">
                              <span>{providerState.connection.verification.label}</span>
                              <code>{providerState.connection.verification.value}</code>
                              <button
                                type="button"
                                onClick={async () => {
                                  const value = providerState.connection.verification.value;
                                  try {
                                    await navigator.clipboard.writeText(value);
                                    setCopiedProviderValue(value);
                                    setTimeout(() => setCopiedProviderValue((current) => (
                                      current === value ? '' : current
                                    )), 2_000);
                                  } catch (nextError) {
                                    setError(
                                      nextError instanceof Error
                                        ? nextError.message
                                        : String(nextError),
                                    );
                                  }
                                }}
                              >
                                {copiedProviderValue === providerState.connection.verification.value
                                  ? 'Copied'
                                  : providerState.connection.verification.copyLabel}
                              </button>
                              <small>{providerState.connection.verification.description}</small>
                            </div>
                          )}
                          {providerState?.connection?.description && (
                            <small>{providerState.connection.description}</small>
                          )}
                          {(selectedType?.fields ?? []).map((field) => (
                            <label className="settings-field settings-field-wide" key={field.id}>
                              <span>{field.label}</span>
                              {field.type === 'select' ? (
                                <select
                                  value={providerDraft[field.id] ?? field.default ?? ''}
                                  onChange={(event) => setProviderDraft({
                                    ...providerDraft,
                                    [field.id]: event.target.value,
                                  })}
                                >
                                  {field.options.map((option) => (
                                    <option value={option.value} key={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={field.type === 'password' ? 'password' : 'text'}
                                  value={providerDraft[field.id] ?? field.default ?? ''}
                                  placeholder={field.placeholder ?? ''}
                                  autoComplete={field.type === 'password' ? 'off' : undefined}
                                  onChange={(event) => setProviderDraft({
                                    ...providerDraft,
                                    [field.id]: event.target.value,
                                  })}
                                />
                              )}
                              {field.description && <small>{field.description}</small>}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <>
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
                          {(selectedType?.fields ?? []).map((field) => (
                            <label className="settings-field settings-field-wide" key={field.id}>
                              <span>{field.label}</span>
                              {field.type === 'select' ? (
                                <select
                                  value={providerDraft[field.id] ?? field.default ?? ''}
                                  onChange={(event) => setProviderDraft({
                                    ...providerDraft,
                                    [field.id]: event.target.value,
                                  })}
                                >
                                  {field.options.map((option) => (
                                    <option value={option.value} key={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={field.type === 'password' ? 'password' : 'text'}
                                  value={providerDraft[field.id] ?? field.default ?? ''}
                                  placeholder={field.placeholder ?? ''}
                                  autoComplete={field.type === 'password' ? 'off' : undefined}
                                  onChange={(event) => setProviderDraft({
                                    ...providerDraft,
                                    [field.id]: event.target.value,
                                  })}
                                />
                              )}
                              {field.description && <small>{field.description}</small>}
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="models-editor-header">
                    <div>
                      <h3>Models</h3>
                      <p>
                        {selectedType?.models === 'managed'
                          ? 'Managed by the provider'
                          : selectedProvider
                            ? `${selectedProvider.models.length} ${selectedProvider.models.length === 1 ? 'model' : 'models'
                            }`
                            : 'Save this provider before adding models.'}
                      </p>
                    </div>
                    {selectedProvider && selectedType?.models === 'custom' && (
                      <button type="button" onClick={() => {
                        setModelIndex(-1);
                        setModelDraft({
                          id: '',
                          name: '',
                          enabled: true,
                          capabilities: { images: false, video: false, audio: false, pdfFiles: false },
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
                  {selectedType?.models === 'managed' ? (
                    <div className="settings-models-locked subscription-models">
                      <Sparkles size={17} />
                      <span>{selectedType.modelsDescription}</span>
                    </div>
                  ) : selectedProvider ? (
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
                                  label: 'Clone',
                                  icon: <Copy size={14} />,
                                  onClick: () => runProviderMutation(async () => {
                                    const copyIdBase = `${model.id}-copy`;
                                    let copyId = copyIdBase;
                                    let copyNumber = 2;
                                    while (selectedProvider.models.some((item) => item.id === copyId)) {
                                      copyId = `${copyIdBase}-${copyNumber}`;
                                      copyNumber += 1;
                                    }
                                    const nextProviders = await onSave({
                                      ...selectedProvider,
                                      models: [
                                        ...selectedProvider.models,
                                        {
                                          ...structuredClone(model),
                                          id: copyId,
                                          name: `${model.name} - Copy`,
                                        },
                                      ],
                                    });
                                    const saved = nextProviders.find(
                                      (provider) => provider.id === selectedProvider.id,
                                    );
                                    if (saved) setProviderDraft(structuredClone(saved));
                                  }),
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
                    <div className="model-option-row">
                      <span className="model-option-label">Capabilities</span>
                      <MultiSelect
                        label="Capabilities"
                        options={capabilityOptions}
                        values={capabilityOptions
                          .filter((option) => modelDraft.capabilities[option.value])
                          .map((option) => option.value)}
                        onChange={(values) => updateModelDraft({
                          capabilities: Object.fromEntries(capabilityOptions.map(
                            (option) => [option.value, values.includes(option.value)],
                          )),
                        })}
                      />
                    </div>
                    <div className="model-option-row">
                      <span className="model-option-label">Reasoning</span>
                      <MultiSelect
                        label="Reasoning"
                        options={reasoningEfforts.map((effort) => ({
                          value: effort,
                          label: effort,
                        }))}
                        values={modelDraft.reasoning}
                        onChange={(reasoning) => updateModelDraft({ reasoning })}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        {(view === 'provider' || view === 'model' || view === 'router' || ['general', 'tuning', 'personalization'].includes(view) || view === 'default-models') && (
          <footer className="settings-actions">
            <span className="settings-error" role="alert">{error}</span>
            <div>
              <button
                className="primary-mini"
                type="button"
                disabled={busy || (
                  view === 'provider'
                    ? !providerDraft
                    : view === 'model'
                      ? !modelDraft
                      : view === 'router'
                        ? !routerDraft?.name.trim() || routerDraft.models.length === 0
                        : view === 'default-models'
                        ? !defaultModelsDraft
                        || (defaultModelsDraft.subagents.enabled && [
                          defaultModelsDraft.subagents.small,
                          defaultModelsDraft.subagents.medium,
                          defaultModelsDraft.subagents.large,
                        ].some((selection) => !selection))
                        : !tuningDraft
                        || !selectedTerminalShell
                        || !Number.isInteger(tuningDraft.terminalTimeoutSeconds)
                        || tuningDraft.terminalTimeoutSeconds < 5
                        || tuningDraft.terminalTimeoutSeconds > 300
                        || !Number.isInteger(tuningDraft.maxConcurrentSubagents)
                        || tuningDraft.maxConcurrentSubagents < 1
                        || tuningDraft.maxConcurrentSubagents > 128
                )}
                onClick={() => runProviderMutation(async () => {
                  if (view === 'default-models') {
                    const result = await onSaveDefaultModels(defaultModelsDraft);
                    setDefaultModelsDraft(result.settings);
                    setDefaultModelsSaved(true);
                    return;
                  }
                  if (['general', 'tuning', 'personalization'].includes(view)) {
                    const saved = await onSaveTuning(tuningDraft);
                    setTuningDraft(saved);
                    setTuningSaved(true);
                    return;
                  }
                  if (view === 'router') {
                    await window.chatApp.routers.save({
                      id: routerDraft.id,
                      name: routerDraft.name.trim(),
                      mode: routerDraft.mode,
                      models: routerDraft.models.map(({ modelId }) => ({ modelId })),
                    });
                    setRouters(await window.chatApp.routers.list());
                    await onRoutersChange();
                    setRouterDraft(null);
                    setView('routers');
                    return;
                  }
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
                {(tuningSaved && ['general', 'tuning', 'personalization'].includes(view)) || (defaultModelsSaved && view === 'default-models')
                  ? <CheckCircle2 size={14} />
                  : <Save size={14} />}
                {busy
                  ? 'Saving...'
                  : view === 'provider'
                    ? 'Save provider'
                    : view === 'model'
                      ? 'Save model'
                      : view === 'router'
                        ? 'Save router'
                        : view === 'default-models'
                        ? defaultModelsSaved ? 'Saved' : 'Save default models'
                        : tuningSaved ? 'Saved' : 'Save changes'}
              </button>
            </div>
          </footer>
        )}
      </main>
      {providerShareDialog && (
        <div
          className="dialog-backdrop provider-import-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget || busy) return;
            setProviderShareDialog(null);
            setError('');
          }}
        >
          <div
            className="provider-import-dialog provider-share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-share-dialog-title"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || busy) return;
              event.preventDefault();
              setProviderShareDialog(null);
              setError('');
            }}
          >
            <header className="dialog-header">
              <div>
                <h2 id="provider-share-dialog-title">Share provider</h2>
                <p>Copy this provider’s endpoints, models, and settings as JSON.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                disabled={busy}
                aria-label="Close provider share dialog"
                onClick={() => {
                  setProviderShareDialog(null);
                  setError('');
                }}
              >
                <X size={16} />
              </button>
            </header>

            <div className="provider-share-summary">
              <span className="provider-share-icon" aria-hidden="true">
                <Share2 size={17} />
              </span>
              <span>
                <strong>{providerShareDialog.name}</strong>
                <small>{providerShareDialog.models.length} {providerShareDialog.models.length === 1 ? 'model' : 'models'} included</small>
              </span>
            </div>

            {providerShareDialog.apiKey && (
              <div className="provider-share-warning">
                <Info size={16} aria-hidden="true" />
                <span>
                  <strong>API key detected</strong>
                  <small>Only include it when sharing with someone you trust.</small>
                </span>
              </div>
            )}

            <footer className="dialog-footer">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setProviderShareDialog(null);
                  setError('');
                }}
              >
                Cancel
              </button>
              <div>
                <button
                  className="primary-mini"
                  type="button"
                  disabled={busy}
                  onClick={() => runProviderMutation(() => shareProvider(false))}
                >
                  {busy ? 'Copying...' : providerShareDialog.apiKey ? 'Copy without key' : 'Copy provider'}
                </button>
                {providerShareDialog.apiKey && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runProviderMutation(() => shareProvider(true))}
                  >
                    Include API key
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>
      )}
      {providerImportDialog && (
        <div
          className="dialog-backdrop provider-import-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget || busy) return;
            setProviderImportDialog(null);
            setError('');
          }}
        >
          <form
            className={classNames(
              'provider-import-dialog',
              providerImportDialog.mode !== 'review' && 'provider-import-source-dialog',
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-import-dialog-title"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || busy) return;
              event.preventDefault();
              setProviderImportDialog(null);
              setError('');
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              if (providerImportDialog.mode === 'url') {
                runProviderMutation(async () => {
                  const url = providerImportDialog.url.trim();
                  if (!url) throw new Error('Enter a provider JSON URL.');
                  const json = await window.chatApp.providers.importFromUrl(url);
                  await reviewProviderImport(json, url);
                });
                return;
              }
              if (providerImportDialog.mode === 'json') {
                runProviderMutation(() => reviewProviderImport(providerImportDialog.json, 'Pasted JSON'));
                return;
              }
              runProviderMutation(async () => {
                const nextProviders = await onSave(importedProvider);
                const saved = nextProviders.find((provider) => provider.id === importedProvider.id);
                setProviderImportDialog(null);
                setProviderListMessage(`Imported provider "${saved?.name ?? importedProvider.name}".`);
              });
            }}
          >
            <header className="dialog-header">
              <div>
                <h2 id="provider-import-dialog-title">
                  {providerImportDialog.mode === 'url'
                    ? 'Import provider from URL'
                    : providerImportDialog.mode === 'json'
                      ? 'Import provider'
                      : 'Review provider import'}
                </h2>
                <p>
                  {providerImportDialog.mode === 'url'
                    ? 'Enter a direct HTTP or HTTPS link to a shared provider JSON file.'
                    : providerImportDialog.mode === 'json'
                      ? 'Paste a shared provider JSON to review it before importing.'
                      : 'Confirm these connection details before adding the provider to Avi.'}
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                disabled={busy}
                aria-label="Close provider import dialog"
                onClick={() => {
                  setProviderImportDialog(null);
                  setError('');
                }}
              >
                <X size={16} />
              </button>
            </header>

            {providerImportDialog.mode === 'url' ? (
              <label className="provider-import-url-field" htmlFor="provider-import-url">
                <span>JSON URL</span>
                <input
                  id="provider-import-url"
                  type="url"
                  autoFocus
                  required
                  disabled={busy}
                  placeholder="https://example.com/provider.json"
                  value={providerImportDialog.url}
                  onChange={(event) => setProviderImportDialog({
                    mode: 'url',
                    url: event.target.value,
                  })}
                />
                <small>The file is downloaded for review and is not imported automatically.</small>
              </label>
            ) : providerImportDialog.mode === 'json' ? (
              <label className="provider-import-json-field" htmlFor="provider-import-json">
                <span>Provider JSON</span>
                <textarea
                  id="provider-import-json"
                  autoFocus
                  required
                  disabled={busy}
                  spellCheck="false"
                  placeholder={'{\n  "name": "Example provider",\n  ...\n}'}
                  value={providerImportDialog.json}
                  onChange={(event) => setProviderImportDialog({
                    mode: 'json',
                    json: event.target.value,
                  })}
                />
                <small>The provider will be validated and shown for confirmation before it is imported.</small>
              </label>
            ) : (
              <div className="provider-import-review">
                <dl>
                  <div>
                    <dt>Name</dt>
                    <dd>{importedProvider.name}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd title={providerImportDialog.source}>{providerImportDialog.source}</dd>
                  </div>
                  <div>
                    <dt>Interface</dt>
                    <dd>{importedProviderType?.name ?? importedProvider.interface}</dd>
                  </div>
                  <div>
                    <dt>Base URL</dt>
                    <dd>{importedProvider.baseUrl || 'Managed by provider'}</dd>
                  </div>
                  <div>
                    <dt>API endpoint</dt>
                    <dd>{importedProviderType?.endpoint || 'Managed by provider'}</dd>
                  </div>
                  <div>
                    <dt>API key</dt>
                    <dd>{importedProvider.apiKey ? 'Included · ••••••••' : 'Not included'}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{importedProvider.enabled ? 'Active' : 'Disabled'}</dd>
                  </div>
                  {(importedProviderType?.fields ?? []).map((field) => (
                    <div key={field.id}>
                      <dt>{field.label}</dt>
                      <dd>{importedProvider[field.id] || 'Not set'}</dd>
                    </div>
                  ))}
                </dl>
                <section>
                  <strong>Models</strong>
                  {importedProviderType?.models === 'managed' ? (
                    <p>Managed model catalog</p>
                  ) : importedProvider.models.length ? (
                    <ul>
                      {importedProvider.models.map((model) => (
                        <li key={model.id}>
                          <span>{model.name}</span>
                          <small>{model.id}{model.enabled ? '' : ' · Disabled'}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No models included</p>
                  )}
                </section>
                {importedProvider.apiKey && (
                  <p className="provider-import-warning">
                    This import includes a secret API key. Only continue if you trust the source.
                  </p>
                )}
              </div>
            )}

            {error && <div className="provider-import-error" role="alert">{error}</div>}
            <footer className="dialog-footer">
              <span>
                {providerImportDialog.mode === 'url'
                  ? 'The response is limited to 1 MB and must contain one provider.'
                  : providerImportDialog.mode === 'json'
                    ? 'The JSON must contain one shared provider.'
                    : 'A new provider ID will be generated; existing providers will not be overwritten.'}
              </span>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setProviderImportDialog(null);
                    setError('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary-mini"
                  type="submit"
                  disabled={busy
                    || (providerImportDialog.mode === 'url' && !providerImportDialog.url.trim())
                    || (providerImportDialog.mode === 'json' && !providerImportDialog.json.trim())}
                >
                  {busy
                    ? providerImportDialog.mode === 'url'
                      ? 'Loading...'
                      : providerImportDialog.mode === 'json' ? 'Validating...' : 'Importing...'
                    : ['url', 'json'].includes(providerImportDialog.mode)
                      ? 'Review provider'
                      : 'Import provider'}
                </button>
              </div>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
