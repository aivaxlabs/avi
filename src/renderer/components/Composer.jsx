import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CornerDownLeft,
  FileDiff,
  FileText,
  FolderOpen,
  GitBranch,
  GripVertical,
  HardDrive,
  ListChecks,
  LoaderCircle,
  Network,
  LockKeyhole,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Sparkles,
  SquareTerminal,
  Square,
  Star,
  Target,
  Trash2,
  Workflow,
  X,
  Zap,
  Ellipsis,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { createMp3Attachment } from '../lib/audio.js';
import { fileToAttachment, formatBytes, textToAttachment } from '../lib/files.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { ModelPicker } from './ModelPicker.jsx';
import { ProviderUsages } from './ProviderUsages.jsx';

const composerDraftKey = 'aivax.composer.draft';
const composerReasoningEffortsKey = 'aivax.composer.reasoning-efforts';

function readPersistedReasoningEfforts() {
  try {
    const raw = window.localStorage.getItem(composerReasoningEffortsKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readPersistedReasoningEffort(modelId) {
  if (!modelId) return null;
  const value = readPersistedReasoningEfforts()[modelId];
  return typeof value === 'string' ? value : null;
}

function writePersistedReasoningEffort(modelId, effort) {
  if (!modelId) return;
  const map = readPersistedReasoningEfforts();
  if (effort) map[modelId] = effort;
  else delete map[modelId];
  try {
    window.localStorage.setItem(composerReasoningEffortsKey, JSON.stringify(map));
  } catch {}
}
const permissionModes = [
  {
    id: 'ask_for_approval',
    label: 'Ask for approval',
    description: 'Ask before every tool call',
  },
  {
    id: 'approve_for_me',
    label: 'Approve for me',
    description: 'Ask only before destructive actions',
  },
  {
    id: 'full_access',
    label: 'Full access',
    description: 'Run tool calls without approval',
  },
];
const composerCommands = [
  {
    id: 'ultra',
    name: 'ultra',
    description: 'Lead a proactive team of sub-agents for maximum quality',
  },
  {
    id: 'plan',
    name: 'plan',
    description: 'Create a detailed execution plan without changing anything',
  },
  {
    id: 'goal',
    name: 'goal',
    description: 'Work persistently until a defined objective is completed or blocked',
  },
  {
    id: 'efforts',
    name: 'effort',
    description: 'Set the reasoning effort for the selected model',
  },
  {
    id: 'models',
    name: 'model',
    description: 'Switch the active model',
  },
  {
    id: 'compress',
    name: 'compress',
    description: 'Create a detailed checkpoint and compress the conversation context',
  },
  {
    id: 'optimize-prompt',
    name: 'optimize-prompt',
    description: 'Expand and optimize the current prompt using the auxiliary model',
  },
  {
    id: 'side',
    name: 'side',
    description: 'Fork this chat into a temporary side panel',
  },
  {
    id: 'mcp',
    name: 'mcp',
    description: 'Show MCP servers available in this conversation',
  },
  {
    id: 'restart-mcp',
    name: 'restart-mcp',
    description: 'Restart all loaded MCP servers',
  },
  {
    id: 'usage',
    name: 'usage',
    description: 'Show provider account limits and counters',
  },
];

function shouldSteerMessage(messageDeliveryMode, isRunning, modifierPressed) {
  return isRunning && (
    (messageDeliveryMode === 'steer') !== modifierPressed
  );
}

function ComposerChip({ as: Component = 'div', children, className = '', icon: Icon, ...props }) {
  return (
    <Component className={`composer-chip${className ? ` ${className}` : ''}`} {...props}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </Component>
  );
}

export function Composer({
  containerRef,
  conversationId,
  isRunning,
  onSend,
  onExpandPrompt,
  onStop,
  onCompress,
  onCreateSideChat,
  subagents = [],
  tasks = [],
  onOpenTasks,
  onOpenSubagents,
  editStats = null,
  steeredMessages = [],
  queuedMessages = [],
  onCancelQueued,
  onReorderQueued,
  onSteerQueued,
  droppedFiles,
  modelName,
  recentModels = [],
  recentProjects = [],
  models,
  favorites,
  currentModel: initialModel,
  contextUsage,
  onChooseModel,
  project,
  projectLocked,
  onChooseProject,
  onUseHome,
  onToggleFavorite,
  workMode: initialWorkMode = null,
  onWorkModeChange,
  ultraMode: initialUltraMode = false,
  onUltraModeChange,
  goal = null,
  goalPreparation = null,
  onGoalAction,
  pendingAttachment,
  onPendingAttachmentConsumed,
  messageDeliveryMode = 'queue',
  draftKey = composerDraftKey,
  autoFocus = false,
  defaultPermissionMode = 'approve_for_me',
  initialState = null,
  persistState = true,
  inline = false,
  botMode = false,
  onShowBotInPanel,
  onCancel,
}) {
  const [text, setText] = useState(() => (
    initialState?.text ?? window.localStorage.getItem(draftKey) ?? ''
  ));
  const [attachments, setAttachments] = useState(() => initialState?.attachments ?? []);
  const [currentModel, setCurrentModel] = useState(initialState?.model ?? initialModel);
  const [workMode, setWorkMode] = useState(initialState?.workMode ?? initialWorkMode);
  const [ultraMode, setUltraMode] = useState(initialState?.ultraMode ?? initialUltraMode);
  const [plusOpen, setPlusOpen] = useState(false);
  const [promptExpanding, setPromptExpanding] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState(
    initialState?.permissionMode ?? defaultPermissionMode,
  );
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [commandStage, setCommandStage] = useState(null);
  const [commandDraft, setCommandDraft] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(text.length);
  const [contextCommands, setContextCommands] = useState([]);
  const [reasoningEffort, setReasoningEffort] = useState(() => initialState?.reasoningEffort ?? readPersistedReasoningEffort(initialModel) ?? null);
  const [recording, setRecording] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [projectSelecting, setProjectSelecting] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [draggedPendingMessage, setDraggedPendingMessage] = useState(null);
  const [queueMutationPending, setQueueMutationPending] = useState(false);
  const [queuedMenu, setQueuedMenu] = useState(null);
  const [editingQueuedMessageId, setEditingQueuedMessageId] = useState(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [providerUsageProviders, setProviderUsageProviders] = useState([]);
  const [providerUsagesOpen, setProviderUsagesOpen] = useState(false);
  const [goalSpecification, setGoalSpecification] = useState('');
  const [goalAction, setGoalAction] = useState(null);
  const [goalNow, setGoalNow] = useState(Date.now());
  const plusHolderRef = useRef(null);
  const permissionMenuRef = useRef(null);
  const modelMenuRef = useRef(null);
  const projectMenuRef = useRef(null);
  const projectSearchRef = useRef(null);
  const textAreaRef = useRef(null);
  const textRef = useRef(text);
  const conversationIdRef = useRef(conversationId);
  const promptExpandingRef = useRef(false);
  const composerStatesRef = useRef(new Map());
  const hydratedConversationIdRef = useRef(null);
  textRef.current = text;
  conversationIdRef.current = conversationId;
  if (conversationId && persistState) {
    composerStatesRef.current.set(conversationId, {
      conversationId,
      permissionMode,
      model: currentModel,
      reasoningEffort,
      workMode,
      ultraMode,
      draftText: text,
      attachments,
    });
  }

  const commandInvocation = commandStage
    ? null
    : text.slice(0, cursorPosition).match(/(?:^|\s)([/$])([^\s]*)$/);
  const commandStart = commandInvocation
    ? cursorPosition - commandInvocation[1].length - commandInvocation[2].length
    : -1;
  const commandMode = commandStage ?? (commandInvocation ? 'commands' : null);
  const commandPrefix = commandInvocation?.[1] ?? '/';
  const commandQuery = commandMode === 'commands'
    ? commandInvocation?.[2] ?? ''
    : commandMode
      ? text
      : '';
  const {
    currentModelConfig,
    favoriteModels,
    quickRecentModels,
  } = useMemo(() => {
    const modelsById = new Map(models.map((model) => [model.id, model]));
    const nextFavoriteModels = favorites
      .map((modelId) => modelsById.get(modelId))
      .filter(Boolean);
    const favoriteModelIds = new Set(nextFavoriteModels.map((model) => model.id));

    return {
      currentModelConfig: modelsById.get(currentModel) ?? null,
      favoriteModels: nextFavoriteModels,
      quickRecentModels: recentModels.filter((model) => !favoriteModelIds.has(model.id)),
    };
  }, [currentModel, favorites, models, recentModels]);
  const activeReasoningEffort = currentModelConfig?.reasoning.includes(reasoningEffort)
    ? reasoningEffort
    : currentModelConfig?.reasoning.includes('medium')
      ? 'medium'
      : currentModelConfig?.reasoning[0] ?? null;
  const activePermissionMode = permissionModes.find((mode) => mode.id === permissionMode);
  const commandOptions = useMemo(() => {
    const normalized = commandQuery.trim().toLowerCase();

    if (commandMode === 'commands') {
      const builtInCommands = commandPrefix === '/'
        ? composerCommands
          .filter((command) => command.id !== 'compress' || projectLocked)
          .filter((command) => command.id !== 'side' || onCreateSideChat)
          .filter((command) => command.id !== 'usage' || providerUsageProviders.length > 0)
          .map((command) => ({
            ...command,
            label: `/${command.name}`,
          }))
        : [];
      const markerCommands = contextCommands
        .filter(({ type }) => type === (commandPrefix === '/' ? 'workflow' : 'skill'))
        .filter((command) => command.name !== 'side' || onCreateSideChat)
        .map((command) => ({
          ...command,
          kind: 'context_marker',
          label: `${commandPrefix}${command.name}`,
        }));
      const names = new Set();

      return [...builtInCommands, ...markerCommands]
        .filter((command) => command.name.includes(normalized))
        .sort((left, right) => (
          Number(right.name === normalized) - Number(left.name === normalized)
        ))
        .filter((command) => {
          if (names.has(command.name)) return false;
          names.add(command.name);
          return true;
        });
    }

    if (commandMode === 'models') {
      return models
        .filter((model) => (
          `${model.name} ${model.modelId} ${model.providerName}`.toLowerCase().includes(normalized)
        ))
        .map((model) => ({
          id: model.id,
          label: model.name,
          description: `${model.providerName} · ${model.modelId}`,
          value: model.id,
          selected: model.id === currentModel,
        }));
    }

    if (commandMode === 'efforts') {
      return (currentModelConfig?.reasoning ?? [])
        .filter((effort) => effort.includes(normalized))
        .map((effort) => ({
          id: effort,
          label: effort,
          description: effort === 'max' ? 'Maximum reasoning depth' : `${effort} reasoning effort`,
          value: effort,
          selected: effort === activeReasoningEffort,
        }));
    }

    return [];
  }, [
    activeReasoningEffort,
    commandMode,
    commandPrefix,
    commandQuery,
    contextCommands,
    currentModel,
    currentModelConfig,
    models,
    onCreateSideChat,
    projectLocked,
    providerUsageProviders.length,
  ]);
  const activeCommandOption = commandOptions[commandIndex] ?? commandOptions[0] ?? null;
  const activeGoal = goal && ['active', 'paused'].includes(goal.status) ? goal : null;
  const finishedGoal = goal && ['completed', 'blocked', 'cancelled'].includes(goal.status) ? goal : null;
  const visibleGoal = activeGoal ?? finishedGoal;
  const effectiveWorkMode = activeGoal ? 'goal' : workMode;
  const canSend = !goalPreparation && !promptExpanding && !commandMode && (
    effectiveWorkMode === 'goal' && !activeGoal
      ? Boolean(text.trim())
      : Boolean(text.trim() || attachments.length > 0)
  );
  const pendingMessages = [...steeredMessages, ...queuedMessages];
  const canResumeQueue = !isRunning && pendingMessages.length > 0;
  const workingSubagents = subagents.filter((subagent) => subagent.status === 'working').length;
  const finishedSubagents = subagents.filter((subagent) => subagent.status === 'finished').length;
  const failedSubagents = subagents.filter((subagent) => subagent.status === 'failed').length;
  const contextPercent = contextUsage?.limit
    ? Math.min(100, Math.max(0, Math.round((contextUsage.tokens / contextUsage.limit) * 100)))
    : null;
  const goalElapsedMs = visibleGoal
    ? visibleGoal.activeElapsedMs + (
        visibleGoal.status === 'active' && visibleGoal.resumedAt
          ? Math.max(0, goalNow - new Date(visibleGoal.resumedAt).getTime())
          : 0
      )
    : 0;
  const goalElapsedSeconds = Math.floor(goalElapsedMs / 1000);
  const goalElapsedLabel = [
    Math.floor(goalElapsedSeconds / 3600),
    Math.floor((goalElapsedSeconds % 3600) / 60),
    goalElapsedSeconds % 60,
  ].map((part) => String(part).padStart(2, '0')).join(':');
  const goalStatusLabel = activeGoal
    ? activeGoal.status === 'paused' ? 'Paused' : 'Working'
    : finishedGoal?.status === 'completed'
      ? 'Completed'
      : finishedGoal?.status === 'blocked'
        ? 'Blocked'
        : 'Stopped';
  const finishedTokens = finishedGoal?.tokensTransacted ?? 0;
  const finishedTokenLabel = finishedTokens > 0
    ? finishedTokens >= 1_000_000
      ? `${(finishedTokens / 1_000_000).toFixed(finishedTokens >= 10_000_000 ? 0 : 1)}M`
      : finishedTokens >= 1_000
        ? `${Math.round(finishedTokens / 1_000)}K`
        : String(finishedTokens)
    : null;
  const filteredRecentProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return recentProjects;
    return recentProjects.filter((recentProject) => (
      `${recentProject.name} ${recentProject.displayPath} ${recentProject.gitBranch ?? ''}`
        .toLowerCase()
        .includes(query)
    ));
  }, [projectQuery, recentProjects]);

  useEffect(() => {
    let active = true;
    hydratedConversationIdRef.current = null;
    if (!persistState) return () => { active = false; };
    setText(conversationId ? '' : window.localStorage.getItem(draftKey) ?? '');
    setAttachments([]);
    setPermissionMode(defaultPermissionMode);
    setCurrentModel(initialModel);
    setReasoningEffort(initialState?.reasoningEffort ?? readPersistedReasoningEffort(initialModel) ?? null);
    setWorkMode(initialWorkMode);
    setUltraMode(initialUltraMode);

    if (!conversationId) return () => { active = false; };

    window.chatApp.composerState.get(conversationId)
      .then((state) => {
        if (!active) return;
        setText(state?.draftText ?? '');
        setAttachments((items) => [
          ...(state?.attachments ?? []),
          ...items.filter((item) => !(state?.attachments ?? []).some(
            (attachment) => attachment.id === item.id,
          )),
        ]);
        setPermissionMode(state?.permissionMode ?? defaultPermissionMode);
        setCurrentModel(botMode ? initialModel : state?.model || initialModel);
        setReasoningEffort(state?.reasoningEffort ?? null);
        hydratedConversationIdRef.current = conversationId;
      })
      .catch(() => {
        if (active) hydratedConversationIdRef.current = conversationId;
      });

    return () => {
      active = false;
      const state = composerStatesRef.current.get(conversationId);
      if (hydratedConversationIdRef.current === conversationId && state) {
        window.chatApp.composerState.save(state).catch(() => {});
      }
    };
  }, [conversationId, persistState]);

  useEffect(() => {
    if (!persistState) return;
    setWorkMode(initialWorkMode);
    setUltraMode(initialUltraMode);
  }, [initialUltraMode, initialWorkMode, persistState]);

  useEffect(() => {
    if (!persistState) return;
    setCurrentModel(initialModel);
    setReasoningEffort(readPersistedReasoningEffort(initialModel) ?? null);
  }, [initialModel, persistState]);

  useEffect(() => {
    if (!persistState || !currentModel || !reasoningEffort) return;
    if (!currentModelConfig?.reasoning?.includes(reasoningEffort)) return;
    writePersistedReasoningEffort(currentModel, reasoningEffort);
  }, [currentModel, currentModelConfig, persistState, reasoningEffort]);

  useEffect(() => {
    if (!persistState || !conversationId || hydratedConversationIdRef.current !== conversationId) return undefined;
    const timer = window.setTimeout(() => {
      const state = composerStatesRef.current.get(conversationId);
      if (state) window.chatApp.composerState.save(state).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    attachments,
    conversationId,
    currentModel,
    permissionMode,
    reasoningEffort,
    text,
    ultraMode,
    workMode,
  ]);

  useEffect(() => {
    if (!persistState || conversationId) return undefined;
    const timer = window.setTimeout(() => saveComposerDraft(draftKey, text), 250);
    return () => window.clearTimeout(timer);
  }, [conversationId, draftKey, text]);

  useEffect(() => {
    if (!persistState) return undefined;
    const saveOnClose = () => {
      const state = conversationId
        ? composerStatesRef.current.get(conversationId)
        : null;
      if (state && hydratedConversationIdRef.current === conversationId) {
        window.chatApp.composerState.save(state).catch(() => {});
      } else {
        saveComposerDraft(draftKey, text);
      }
    };
    window.addEventListener('beforeunload', saveOnClose);
    return () => window.removeEventListener('beforeunload', saveOnClose);
  }, [conversationId, draftKey, text]);

  useEffect(() => {
    setGoalNow(Date.now());
    if (activeGoal?.status !== 'active') return undefined;
    const timer = window.setInterval(() => setGoalNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeGoal?.id, activeGoal?.status, activeGoal?.resumedAt]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandMode, commandQuery, currentModel]);

  useEffect(() => {
    let active = true;
    window.chatApp.providers.usages()
      .then((items) => {
        if (active) setProviderUsageProviders(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (active) setProviderUsageProviders([]);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    window.chatApp.context.commands(project?.path)
      .then((commands) => {
        if (active) setContextCommands(commands);
      })
      .catch(() => {
        if (active) setContextCommands([]);
      });

    return () => {
      active = false;
    };
  }, [project?.path]);

  useEffect(() => {
    if (!droppedFiles?.files.length) return;

    Promise.all(droppedFiles.files.map(fileToAttachment))
      .then((next) => setAttachments((items) => [...items, ...next]))
      .catch(() => {});
  }, [droppedFiles]);

  useEffect(() => {
    if (!pendingAttachment) return;

    setAttachments((items) => (
      items.some((item) => item.id === pendingAttachment.id)
        ? items
        : [...items, pendingAttachment]
    ));
    onPendingAttachmentConsumed?.(pendingAttachment.id);
    queueMicrotask(() => textAreaRef.current?.focus());
  }, [onPendingAttachmentConsumed, pendingAttachment]);

  useEffect(() => {
    if (!plusOpen) return undefined;
    const close = (event) => {
      if (plusHolderRef.current?.contains(event.target)) return;
      setPlusOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [plusOpen]);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const close = (event) => {
      if (modelMenuRef.current?.contains(event.target)) return;
      setModelMenuOpen(false);
      setReasoningMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!permissionMenuOpen) return undefined;
    const close = (event) => {
      if (permissionMenuRef.current?.contains(event.target)) return;
      setPermissionMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [permissionMenuOpen]);

  useEffect(() => {
    if (!projectMenuOpen) return undefined;
    setProjectQuery('');
    queueMicrotask(() => projectSearchRef.current?.focus());

    const close = (event) => {
      if (projectMenuRef.current?.contains(event.target)) return;
      setProjectMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [projectMenuOpen]);

  useEffect(() => {
    if (!queuedMenu) return undefined;
    const close = (event) => {
      if (event.target.closest?.('.queued-message-actions-menu')) return;
      if (event.target.closest?.('[data-queue-menu-trigger]')) return;
      setQueuedMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [queuedMenu]);

  useEffect(() => {
    if (queuedMenu && !pendingMessages.some((message) => message.id === queuedMenu.messageId)) {
      setQueuedMenu(null);
    }
  }, [queuedMenu, pendingMessages]);

  useEffect(() => {
    if (!recording?.analyser || recording.paused) {
      setAudioLevel(0);
      return undefined;
    }

    const samples = new Uint8Array(recording.analyser.fftSize);
    let frameId = 0;
    const updateLevel = () => {
      recording.analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      setAudioLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5));
      frameId = window.requestAnimationFrame(updateLevel);
    };
    updateLevel();

    return () => window.cancelAnimationFrame(frameId);
  }, [recording]);

  async function changeWorkMode(nextWorkMode) {
    const normalizedWorkMode = ['plan', 'goal'].includes(nextWorkMode)
      ? nextWorkMode
      : null;
    const accepted = await onWorkModeChange?.(normalizedWorkMode);
    if (accepted === false) return;
    setWorkMode(normalizedWorkMode);
    if (normalizedWorkMode === 'plan') setUltraMode(false);
  }

  async function changeUltraMode(enabled) {
    const nextUltraMode = Boolean(enabled);
    const accepted = await onUltraModeChange?.(nextUltraMode);
    if (accepted === false) return;
    setUltraMode(nextUltraMode);
    if (nextUltraMode) setWorkMode(null);
  }

  async function submit({ steer = false } = {}) {
    if (!canSend) return;
    const payload = {
      text,
      attachments,
      steer: inline ? false : steer,
      model: currentModel,
      reasoningEffort: activeReasoningEffort,
      permissionMode,
      workMode: effectiveWorkMode,
      ultraMode,
    };
    if (inline) {
      await onSend(payload);
      return;
    }
    setText('');
    setCursorPosition(0);
    window.localStorage.removeItem(draftKey);
    setAttachments([]);
    await onSend(payload);
  }

  function chooseModel(modelId) {
    setCurrentModel(modelId);
    onChooseModel(modelId);
    setReasoningEffort(readPersistedReasoningEffort(modelId) ?? null);
    setReasoningMenuOpen(false);
    setModelMenuOpen(false);
    setModelPickerOpen(false);
  }

  function exitCommandMode() {
    const nextText = commandStage && commandDraft
      ? commandDraft.text
      : commandStart >= 0
        ? `${text.slice(0, commandStart)}${text.slice(cursorPosition)}`
        : text;
    const nextCursorPosition = commandStage && commandDraft
      ? commandDraft.cursorPosition
      : commandStart >= 0
        ? commandStart
        : cursorPosition;
    setCommandStage(null);
    setCommandDraft(null);
    setCommandIndex(0);
    setText(nextText);
    setCursorPosition(nextCursorPosition);
    queueMicrotask(() => {
      textAreaRef.current?.focus();
      textAreaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  async function optimizePrompt(sourcePrompt, { replaceDraft = false } = {}) {
    if (promptExpandingRef.current) return;

    const sourceConversationId = conversationId;
    if (replaceDraft) {
      setCommandStage(null);
      setCommandDraft(null);
      setCommandIndex(0);
      setText(sourcePrompt);
      textRef.current = sourcePrompt;
      setCursorPosition(sourcePrompt.length);
      queueMicrotask(() => {
        textAreaRef.current?.focus();
        textAreaRef.current?.setSelectionRange(sourcePrompt.length, sourcePrompt.length);
      });
    }
    if (!sourcePrompt.trim()) return;

    setPlusOpen(false);
    promptExpandingRef.current = true;
    setPromptExpanding(true);
    try {
      const expandedPrompt = await onExpandPrompt?.({
        conversationId: sourceConversationId,
        prompt: sourcePrompt,
      });
      if (
        typeof expandedPrompt !== 'string'
        || !expandedPrompt.trim()
        || textRef.current !== sourcePrompt
        || conversationIdRef.current !== sourceConversationId
      ) return;
      setText(expandedPrompt);
      setCursorPosition(expandedPrompt.length);
      queueMicrotask(() => {
        textAreaRef.current?.focus();
        textAreaRef.current?.setSelectionRange(expandedPrompt.length, expandedPrompt.length);
      });
    } finally {
      promptExpandingRef.current = false;
      setPromptExpanding(false);
    }
  }

  function activateCommandOption(option) {
    if (!option) return;

    if (commandMode === 'commands') {
      if (option.kind === 'context_marker') {
        const prefix = option.type === 'workflow' ? '/' : '$';
        setAttachments((items) => (
          items.some((item) => (
            item.kind === 'context_marker'
            && item.markerType === option.type
            && item.commandName === option.name
          ))
            ? items
            : [...items, {
                id: crypto.randomUUID(),
                kind: 'context_marker',
                markerType: option.type,
                commandName: option.name,
                name: `${prefix}${option.name}`,
                size: 0,
                text: `Use the ${option.name} ${option.type}.`,
              }]
        ));
        exitCommandMode();
        return;
      }
      if (option.id === 'compress') {
        exitCommandMode();
        onCompress();
        return;
      }
      if (option.id === 'optimize-prompt') {
        optimizePrompt(`${text.slice(0, commandStart)}${text.slice(cursorPosition)}`, {
          replaceDraft: true,
        });
        return;
      }
      if (option.id === 'side') {
        exitCommandMode();
        onCreateSideChat();
        return;
      }
      if (option.id === 'plan') {
        exitCommandMode();
        changeWorkMode('plan');
        return;
      }
      if (option.id === 'ultra') {
        exitCommandMode();
        changeUltraMode(!ultraMode);
        return;
      }
      if (option.id === 'goal') {
        exitCommandMode();
        if (activeGoal) {
          setGoalSpecification(activeGoal.specification);
          setGoalDialogOpen(true);
        } else {
          changeWorkMode('goal');
        }
        return;
      }
      if (option.id === 'usage') {
        exitCommandMode();
        setProviderUsagesOpen(true);
        return;
      }
      if (option.id === 'mcp' || option.id === 'restart-mcp') {
        exitCommandMode();
        onSend({
          text: `/${option.name}`,
          attachments: [],
          reasoningEffort: activeReasoningEffort,
          permissionMode,
          workMode: effectiveWorkMode,
          ultraMode,
        });
        return;
      }
      setCommandDraft({
        text: `${text.slice(0, commandStart)}${text.slice(cursorPosition)}`,
        cursorPosition: commandStart,
      });
      setCommandStage(option.id);
      setCommandIndex(0);
      setText('');
      setCursorPosition(0);
      queueMicrotask(() => textAreaRef.current?.focus());
      return;
    }

    if (commandMode === 'models') {
      chooseModel(option.value);
    } else if (commandMode === 'efforts') {
      setReasoningEffort(option.value);
      if (persistState) writePersistedReasoningEffort(currentModel, option.value);
    }
    exitCommandMode();
  }

  async function attachFromComputer() {
    const selected = await window.chatApp.files.select();
    setAttachments((items) => [...items, ...selected]);
    setPlusOpen(false);
  }

  async function handlePaste(event) {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      const next = await Promise.all(files.map((file) => fileToAttachment(file, 'clipboard')));
      setAttachments((items) => [...items, ...next]);
      return;
    }

    const pastedText = event.clipboardData.getData('text');
    if (pastedText && pastedText.length > 2048) {
      event.preventDefault();
      setAttachments((items) => [...items, textToAttachment(pastedText)]);
    }
  }

  function handleKeyDown(event) {
    if (commandMode) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (commandOptions.length === 0) return;
        setCommandIndex((current) => (
          event.key === 'ArrowDown'
            ? (current + 1) % commandOptions.length
            : (current - 1 + commandOptions.length) % commandOptions.length
        ));
        return;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        activateCommandOption(activeCommandOption);
        return;
      }

      if (event.key === 'Escape' || (event.key === 'Backspace' && commandStage && text.length === 0)) {
        event.preventDefault();
        exitCommandMode();
      }
      return;
    }

    if (
      event.key !== 'Enter'
      || event.shiftKey
      || event.altKey
      || event.metaKey
      || event.isComposing
    ) return;

    event.preventDefault();
    submit({
      steer: inline
        ? false
        : shouldSteerMessage(messageDeliveryMode, isRunning, event.ctrlKey),
    });
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const chunks = [];
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    mediaRecorder.start();
    setRecording({ mediaRecorder, chunks, paused: false, stream, audioContext, source, analyser });
  }

  function pauseRecording() {
    if (!recording || recording.stopping || recording.mediaRecorder.state !== 'recording') return;
    recording.mediaRecorder.pause();
    setRecording({ ...recording, paused: true });
  }

  function resumeRecording() {
    if (!recording || recording.stopping || recording.mediaRecorder.state !== 'paused') return;
    recording.mediaRecorder.resume();
    setRecording({ ...recording, paused: false });
  }

  async function sendRecording() {
    const current = recording;
    if (!current || current.stopping || current.mediaRecorder.state === 'inactive') return;
    setRecording({ ...current, stopping: true });
    const attachment = await stopRecording(current);
    setRecording(null);
    await onSend({
      text: '',
      attachments: [attachment],
      reasoningEffort: activeReasoningEffort,
      permissionMode,
      workMode: effectiveWorkMode,
      ultraMode,
    });
  }

  async function cancelRecording() {
    if (!recording || recording.stopping) return;
    if (recording.mediaRecorder.state !== 'inactive') {
      recording.mediaRecorder.stop();
    }
    cleanupRecording(recording);
    setRecording(null);
  }

  const visibleAttachments = attachments;

  return (
    <section
      ref={containerRef}
      className={`composer-wrap${inline ? ' inline-composer-wrap' : ''}`}
    >
      {botMode && onShowBotInPanel && (
        <ComposerChip
          as="button"
          className="bot-panel-chip"
          icon={Bot}
          type="button"
          onClick={onShowBotInPanel}
        >
          <span>Show in bots panel</span>
        </ComposerChip>
      )}
      {editStats?.files > 0 && (
        <ComposerChip
          className="edit-counter-pill"
          icon={FileDiff}
          role="status"
          aria-live="polite"
          aria-label={`${editStats.files} ${editStats.files === 1 ? 'file' : 'files'} touched, ${editStats.additions} lines added, ${editStats.deletions} lines removed`}
        >
          <span>{editStats.files} {editStats.files === 1 ? 'file' : 'files'}</span>
          <span className="edit-counter-additions">+{editStats.additions}</span>
          <span className="edit-counter-deletions">-{editStats.deletions}</span>
        </ComposerChip>
      )}
      {recording && (
        <div className="recording-bar">
          <span className="record-dot" />
          <span>Recording audio</span>
          <AudioWave level={audioLevel} paused={recording.paused} />
          <button type="button" disabled={recording.stopping} onClick={recording.paused ? resumeRecording : pauseRecording}>
            {recording.paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button type="button" disabled={recording.stopping} onClick={cancelRecording}>
            <Trash2 size={15} />
          </button>
          <button type="button" className="primary-mini" disabled={recording.stopping} onClick={sendRecording}>
            Send
          </button>
        </div>
      )}
      {goalPreparation && !activeGoal && (
        <ComposerStrip
          className="goal-strip preparing"
          aria-label="Defining Goal criteria"
          aria-live="polite"
        >
          <LoaderCircle className="goal-strip-spinner" size={15} aria-hidden="true" />
          <span className="goal-strip-copy">
            <strong title={goalPreparation.specification}>{goalPreparation.specification}</strong>
            <small>Defining Goal criteria...</small>
          </span>
        </ComposerStrip>
      )}
      {visibleGoal && (
        <ComposerStrip
          className={`goal-strip${activeGoal?.status === 'paused' ? ' paused' : ''}${finishedGoal ? ` ${finishedGoal.status}` : ''}`}
          aria-label={`Goal ${visibleGoal.status}`}
        >
          {finishedGoal ? (
            finishedGoal.status === 'completed'
              ? <Check size={15} aria-hidden="true" />
              : finishedGoal.status === 'blocked'
                ? <ShieldQuestion size={15} aria-hidden="true" />
                : <X size={15} aria-hidden="true" />
          ) : (
            <Target size={15} aria-hidden="true" />
          )}
          <span className="goal-strip-copy">
            <strong title={visibleGoal.specification}>{visibleGoal.specification}</strong>
            <small>
              <Clock3 size={12} aria-hidden="true" />
              <span>{goalElapsedLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{goalStatusLabel}</span>
              {finishedTokenLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{finishedTokenLabel}</span>
                </>
              )}
            </small>
          </span>
          {activeGoal && (
          <span className="goal-strip-actions">
            <button
              type="button"
              disabled={Boolean(goalAction)}
              title={activeGoal.status === 'paused' ? 'Resume Goal' : 'Pause Goal'}
              aria-label={activeGoal.status === 'paused' ? 'Resume Goal' : 'Pause Goal'}
              onClick={async () => {
                const action = activeGoal.status === 'paused' ? 'resume' : 'pause';
                setGoalAction(action);
                await onGoalAction?.(action);
                setGoalAction(null);
              }}
            >
              {activeGoal.status === 'paused'
                ? <Play size={14} aria-hidden="true" />
                : <Pause size={14} aria-hidden="true" />}
            </button>
            <button
              type="button"
              disabled={Boolean(goalAction)}
              title="Edit Goal"
              aria-label="Edit Goal"
              onClick={() => {
                setGoalSpecification(activeGoal.specification);
                setGoalDialogOpen(true);
              }}
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={Boolean(goalAction)}
              title="Stop Goal"
              aria-label="Stop Goal"
              onClick={async () => {
                setGoalAction('stop');
                await onGoalAction?.('stop');
                setGoalAction(null);
              }}
            >
              <Square size={13} aria-hidden="true" />
            </button>
          </span>
          )}
        </ComposerStrip>
      )}
      {tasks.length > 0 && !botMode && (
        <ComposerStrip as="button" className="tasks-strip" type="button" aria-label="Open thread tasks" onClick={onOpenTasks}>
          <ListChecks size={15} aria-hidden="true" />
          <span aria-live="polite">{tasks.filter((task) => task.done).length}/{tasks.length} tasks completed</span>
          <ChevronRight size={15} aria-hidden="true" />
        </ComposerStrip>
      )}
      {subagents.length > 0 && !botMode && (
        <ComposerStrip
          as="button"
          className="subagent-strip"
          type="button"
          aria-label="Open sub-agents panel"
          onClick={onOpenSubagents}
        >
          <Network size={15} aria-hidden="true" />
          <span aria-live="polite">
            {workingSubagents} sub-agent{workingSubagents === 1 ? '' : 's'} working,{' '}
            {finishedSubagents} finished
            {failedSubagents > 0 ? `, ${failedSubagents} failed` : ''}
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </ComposerStrip>
      )}
      {[
        {
          queueType: 'steer',
          label: 'Steer',
          description: 'Applied after the current assistant turn',
          messages: steeredMessages,
        },
        {
          queueType: 'queue',
          label: 'Queue',
          description: 'Sent after the assistant finishes',
          messages: queuedMessages,
        },
      ].filter((section) => section.messages.length > 0).map((section) => (
        <ComposerStrip
          key={section.queueType}
          as="section"
          className={`pending-messages-section ${section.queueType}-messages-section`}
          aria-label={`${section.label} messages`}
        >
          <header className="pending-messages-header">
            <span className="pending-messages-title">
              {section.queueType === 'steer'
                ? <CornerDownLeft size={13} aria-hidden="true" />
                : <Clock3 size={13} aria-hidden="true" />}
              <strong>{section.label}</strong>
              <span>{section.messages.length}</span>
            </span>
            <span>{section.description}</span>
          </header>
          <ol className="queued-messages">
            {section.messages.map((message, index) => (
              <li
                key={message.id}
                className={[
                  section.queueType === 'steer' && 'steered',
                  draggedPendingMessage?.queueType === section.queueType
                    && draggedPendingMessage?.messageId === message.id
                    && 'dragging',
                  queuedMenu?.messageId === message.id && 'menu-open',
                ].filter(Boolean).join(' ')}
                onDragOver={(event) => {
                  if (
                    queueMutationPending
                    || draggedPendingMessage?.queueType !== section.queueType
                    || draggedPendingMessage.messageId === message.id
                  ) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (
                    queueMutationPending
                    || draggedPendingMessage?.queueType !== section.queueType
                    || draggedPendingMessage.messageId === message.id
                  ) return;
                  const messageIds = section.messages
                    .map((item) => item.id)
                    .filter((messageId) => messageId !== draggedPendingMessage.messageId);
                  messageIds.splice(index, 0, draggedPendingMessage.messageId);
                  setDraggedPendingMessage(null);
                  setQueueMutationPending(true);
                  Promise.resolve(onReorderQueued(section.queueType, messageIds))
                    .finally(() => setQueueMutationPending(false));
                }}
              >
                <button
                  className="queued-message-grip"
                  type="button"
                  draggable={!queueMutationPending}
                  disabled={queueMutationPending}
                  title="Drag or use the arrow keys to reorder"
                  aria-label={`Reorder ${section.label.toLowerCase()} message ${index + 1}`}
                  onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    const nextIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
                    if (nextIndex < 0 || nextIndex >= section.messages.length) return;
                    const messageIds = section.messages.map((item) => item.id);
                    [messageIds[index], messageIds[nextIndex]] = [
                      messageIds[nextIndex],
                      messageIds[index],
                    ];
                    setQueueMutationPending(true);
                    Promise.resolve(onReorderQueued(section.queueType, messageIds))
                      .finally(() => setQueueMutationPending(false));
                  }}
                  onDragStart={(event) => {
                    setDraggedPendingMessage({
                      queueType: section.queueType,
                      messageId: message.id,
                    });
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', message.id);
                  }}
                  onDragEnd={() => setDraggedPendingMessage(null)}
                >
                  <GripVertical size={14} />
                </button>
                <span className="queued-message-position" aria-hidden="true">{index + 1}</span>
                <span
                  className="queued-message-copy"
                  title={message.content || message.attachments.map((attachment) => attachment.name).join(', ')}
                >
                  {message.content
                    || message.attachments.map((attachment) => attachment.name).join(', ')
                    || 'Message with attachments'}
                </span>
                <div className="queued-message-actions">
                  {section.queueType === 'queue' && (
                    <button
                      type="button"
                      className="queued-message-steer"
                      title="Prioritize after the current assistant turn"
                      disabled={queueMutationPending}
                      onClick={() => {
                        setQueueMutationPending(true);
                        Promise.resolve(onSteerQueued(
                          message.id,
                          section.messages.map((item) => item.id),
                        )).finally(() => setQueueMutationPending(false));
                      }}
                    >
                      <CornerDownLeft size={13} />
                      <span>Steer</span>
                    </button>
                  )}
                  <button
                    type="button"
                    title={`Remove from ${section.label.toLowerCase()}`}
                    aria-label={`Remove from ${section.label.toLowerCase()}`}
                    disabled={queueMutationPending}
                    onClick={() => {
                      setQueueMutationPending(true);
                      Promise.resolve(onCancelQueued(message.id))
                        .finally(() => setQueueMutationPending(false));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    type="button"
                    title="More actions"
                    aria-label="More queued message actions"
                    data-queue-menu-trigger={message.id}
                    className={queuedMenu?.messageId === message.id ? 'active' : ''}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setQueuedMenu((current) => (
                        current?.messageId === message.id
                          ? null
                          : { messageId: message.id, top: rect.bottom + 6, left: rect.right - 180 }
                      ));
                    }}
                  >
                    <Ellipsis size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </ComposerStrip>
      ))}
      {queuedMenu && createPortal(
        <DropdownMenu
          className="queued-message-actions-menu"
          fixed
          role="menu"
          aria-label="Queued message actions"
          style={{ top: queuedMenu.top, left: queuedMenu.left }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            const messageId = queuedMenu.messageId;
            setQueuedMenu(null);
            queueMicrotask(() => (
              document.querySelector(`[data-queue-menu-trigger="${messageId}"]`)?.focus()
            ));
          }}
        >
          <DropdownMenuItem
            icon={<Pencil size={14} />}
            role="menuitem"
            disabled={editingQueuedMessageId === queuedMenu.messageId}
            onClick={async () => {
              const message = pendingMessages.find((item) => item.id === queuedMenu.messageId);
              if (!message) return;
              setEditingQueuedMessageId(message.id);
              try {
                if (!await onCancelQueued(message.id)) return;
                const messageText = message.content ?? '';
                setText(messageText);
                setCursorPosition(messageText.length);
                setAttachments(message.attachments ?? []);
                setCommandStage(null);
                setCommandDraft(null);
                setCommandIndex(0);
                setQueuedMenu(null);
                queueMicrotask(() => textAreaRef.current?.focus());
              } finally {
                setEditingQueuedMessageId(null);
              }
            }}
          >
            {editingQueuedMessageId === queuedMenu.messageId ? 'Opening...' : 'Edit message'}
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
      <div className={`composer${promptExpanding ? ' prompt-optimizing' : ''}`} aria-busy={promptExpanding}>
        {commandMode && (
          <section
            className="command-picker"
            aria-label={commandMode === 'commands'
              ? commandPrefix === '/'
                ? 'Action commands'
                : 'Skills'
              : 'Composer options'}
          >
            <header className="command-picker-header">
              <span>
                {commandMode === 'commands' && (
                  commandPrefix === '/' ? 'Action commands' : 'Skills'
                )}
                {commandMode === 'models' && 'Choose model'}
                {commandMode === 'efforts' && `Reasoning · ${currentModelConfig?.name ?? 'No model'}`}
              </span>
              <small><kbd>↑↓</kbd> Navigate <kbd>Tab</kbd> Select</small>
            </header>
            <div id="composer-command-list" className="command-picker-list" role="listbox">
              {commandOptions.map((option, index) => (
                <button
                  id={`composer-command-option-${index}`}
                  key={option.id}
                  className={index === commandIndex ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => activateCommandOption(option)}
                  onMouseEnter={() => setCommandIndex(index)}
                >
                  <span className="command-picker-icon">
                    {commandMode === 'commands' && (
                      option.kind === 'context_marker'
                        ? option.type === 'workflow'
                          ? <Workflow size={16} />
                          : <Sparkles size={16} />
                        : <SquareTerminal size={16} />
                    )}
                    {commandMode === 'models' && <Bot size={16} />}
                    {commandMode === 'efforts' && <Brain size={16} />}
                  </span>
                  <span className="command-picker-copy">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  {option.selected && <Check size={15} aria-label="Selected" />}
                </button>
              ))}
              {commandOptions.length === 0 && (
                <div className="command-picker-empty">
                  {commandMode === 'efforts'
                    ? 'The selected model has no matching reasoning effort.'
                    : 'No matching results.'}
                </div>
              )}
            </div>
          </section>
        )}
        {visibleAttachments.length > 0 && (
          <div className="attachment-strip">
            {visibleAttachments.map((attachment) => (
              attachment.kind === 'image_url' && attachment.dataUrl ? (
                <figure key={attachment.id} className="attachment-image">
                  <img src={attachment.dataUrl} alt={attachment.name} draggable="false" />
                  <figcaption>
                    <span title={attachment.name}>{attachment.name}</span>
                    <small>{formatBytes(attachment.size)}</small>
                  </figcaption>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    title={`Remove ${attachment.name}`}
                    onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
                  >
                    <X size={13} />
                  </button>
                </figure>
              ) : attachment.kind === 'video_url' && attachment.dataUrl ? (
                <figure key={attachment.id} className="attachment-image attachment-video">
                  <video src={attachment.dataUrl} controls muted preload="metadata" />
                  <figcaption>
                    <span title={attachment.name}>{attachment.name}</span>
                    <small>{formatBytes(attachment.size)}</small>
                  </figcaption>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    title={`Remove ${attachment.name}`}
                    onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
                  >
                    <X size={13} />
                  </button>
                </figure>
              ) : (
                <span
                  key={attachment.id}
                  className={`attachment-chip${attachment.kind === 'context_marker' ? ' context-marker' : ''}`}
                >
                  {attachment.kind === 'context_marker'
                    ? attachment.markerType === 'workflow'
                      ? <Workflow size={13} />
                      : attachment.markerType === 'directory_reference'
                        ? <FolderOpen size={13} />
                        : attachment.markerType?.startsWith('file_')
                          ? <FileText size={13} />
                          : <Sparkles size={13} />
                    : <Paperclip size={13} />}
                  <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                  {attachment.kind !== 'context_marker' && <small>{formatBytes(attachment.size)}</small>}
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    title={`Remove ${attachment.name}`}
                    onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
                  >
                    <X size={12} />
                  </button>
                </span>
              )
            ))}
          </div>
        )}
        {promptExpanding && (
          <div className="prompt-optimization-status" role="status" aria-live="polite">
            <LoaderCircle size={14} />
            <span>Optimizing prompt...</span>
          </div>
        )}
        <div className="composer-main">
          <textarea
            ref={textAreaRef}
            value={text}
            autoFocus={autoFocus}
            onChange={(event) => {
              setText(event.target.value);
              setCursorPosition(event.target.selectionStart ?? event.target.value.length);
            }}
            onSelect={(event) => {
              setCursorPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={commandMode === 'models'
              ? 'Filter models...'
              : commandMode === 'efforts'
                ? 'Filter reasoning efforts...'
                : activeGoal?.status === 'paused'
                  ? 'Goal paused...'
                  : activeGoal
                    ? 'Guide the active Goal...'
                    : workMode === 'goal'
                      ? 'Describe the Goal...'
                      : workMode === 'plan'
                        ? 'Describe your task to generate a plan...'
                        : ultraMode
                          ? 'Describe the objective for the Ultra team...'
                          : `Message ${modelName || 'model'}`}
            aria-expanded={Boolean(commandMode)}
            aria-controls={commandMode ? 'composer-command-list' : undefined}
            aria-activedescendant={activeCommandOption ? `composer-command-option-${commandIndex}` : undefined}
          />
          <div className="plus-holder" ref={plusHolderRef}>
            <button
              className="round-button"
              type="button"
              title="Composer actions"
              aria-label="Open composer actions"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              onClick={() => setPlusOpen((value) => !value)}
            >
              <Plus size={18} />
            </button>
            {plusOpen && (
              <DropdownMenu className="attachment-dropdown-menu" role="menu">
                {!botMode && (
                  <>
                    <DropdownMenuItem
                      active={ultraMode}
                      icon={<Zap size={14} />}
                      role="menuitemcheckbox"
                      aria-checked={ultraMode}
                      onClick={() => {
                        changeUltraMode(!ultraMode);
                        setPlusOpen(false);
                      }}
                    >
                      Ultra
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      active={Boolean(activeGoal) || workMode === 'goal'}
                      icon={<Target size={14} />}
                      role="menuitemcheckbox"
                      aria-checked={Boolean(activeGoal) || workMode === 'goal'}
                      onClick={() => {
                        if (activeGoal) {
                          setGoalSpecification(activeGoal.specification);
                          setGoalDialogOpen(true);
                        } else {
                          changeWorkMode(workMode === 'goal' ? null : 'goal');
                        }
                        setPlusOpen(false);
                      }}
                    >
                      Goal
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      active={workMode === 'plan'}
                      icon={<ListChecks size={14} />}
                      role="menuitemcheckbox"
                      aria-checked={workMode === 'plan'}
                      onClick={() => {
                        changeWorkMode(workMode === 'plan' ? null : 'plan');
                        setPlusOpen(false);
                      }}
                    >
                      Plan
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  icon={promptExpanding
                    ? <LoaderCircle className="goal-strip-spinner" size={14} />
                    : <Sparkles size={14} />}
                  disabled={promptExpanding || !text.trim()}
                  onClick={() => optimizePrompt(text)}
                >
                  {promptExpanding ? 'Optimizing prompt...' : 'Expand prompt'}
                </DropdownMenuItem>
                <DropdownMenuItem icon={<HardDrive size={14} />} onClick={attachFromComputer}>
                  Attach from computer
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
          {!botMode && (
          <div className="composer-mode-controls">
            <div className="permission-mode-holder" ref={permissionMenuRef}>
              <button
                className="permission-mode-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={permissionMenuOpen}
                title={activePermissionMode?.description}
                onClick={() => setPermissionMenuOpen((value) => !value)}
              >
                {permissionMode === 'ask_for_approval' && <ShieldQuestion size={14} />}
                {permissionMode === 'approve_for_me' && <ShieldCheck size={14} />}
                {permissionMode === 'full_access' && <ShieldOff size={14} />}
                <span>{activePermissionMode?.label}</span>
                <ChevronDown size={13} />
              </button>
              {permissionMenuOpen && (
                <DropdownMenu className="permission-mode-menu" role="menu">
                  {permissionModes.map((mode) => (
                    <DropdownMenuItem
                      key={mode.id}
                      active={mode.id === permissionMode}
                      icon={mode.id === 'ask_for_approval'
                        ? <ShieldQuestion size={14} />
                        : mode.id === 'approve_for_me'
                          ? <ShieldCheck size={14} />
                          : <ShieldOff size={14} />}
                      role="menuitemradio"
                      aria-checked={mode.id === permissionMode}
                      onClick={() => {
                        setPermissionMode(mode.id);
                        setPermissionMenuOpen(false);
                      }}
                    >
                      <span className="permission-mode-copy">
                        <strong>{mode.label}</strong>
                        <small>{mode.description}</small>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              )}
            </div>
            {workMode && !activeGoal && (
              <button
                className="work-mode-chip"
                type="button"
                title={`Exit ${workMode === 'goal' ? 'Goal' : 'Plan'} mode`}
                aria-label={`Exit ${workMode === 'goal' ? 'Goal' : 'Plan'} mode`}
                onClick={() => changeWorkMode(null)}
              >
                {workMode === 'goal'
                  ? <Target size={12} aria-hidden="true" />
                  : <ListChecks size={12} aria-hidden="true" />}
                <span>{workMode === 'goal' ? 'Goal' : 'Plan'}</span>
                <X size={12} aria-hidden="true" />
              </button>
            )}
            {ultraMode && (
              <button
                className="work-mode-chip"
                type="button"
                title="Exit Ultra mode"
                aria-label="Exit Ultra mode"
                onClick={() => changeUltraMode(false)}
              >
                <Zap size={12} aria-hidden="true" />
                <span>Ultra</span>
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          )}
          <div className="model-input-holder" ref={modelMenuRef}>
            {botMode ? (
              <span
                className="model-input-label bot-model-label"
                title="The model is configured in the bot settings"
              >
                {currentModelConfig?.name || modelName || 'Model'}
                {activeReasoningEffort && (
                  <span className="model-input-effort"> - {activeReasoningEffort}</span>
                )}
              </span>
            ) : (
            <button
              className="model-input-trigger"
              type="button"
              onClick={() => {
                setReasoningMenuOpen(false);
                setModelMenuOpen((value) => !value);
              }}
            >
              <span className="model-input-label">
                {currentModelConfig?.name || modelName || 'Choose model'}
                {activeReasoningEffort && (
                  <span className="model-input-effort"> - {activeReasoningEffort}</span>
                )}
              </span>
              <ChevronDown size={14} />
            </button>
            )}
            {modelMenuOpen && (
              <DropdownMenu className="model-input-menu">
                <div className="model-input-menu-list">
                  {[
                    {
                      id: 'recent',
                      label: 'Recent',
                      icon: <Clock3 size={12} />,
                      models: quickRecentModels,
                      empty: 'No recent models',
                    },
                    {
                      id: 'favorites',
                      label: 'Favorites',
                      icon: <Star size={12} />,
                      models: favoriteModels,
                      empty: 'No favorite models',
                    },
                  ].map((section) => (
                    <section className="model-menu-section" key={section.id}>
                      <div className="model-menu-section-title">
                        {section.icon}
                        <span>{section.label}</span>
                      </div>
                      {section.models.length > 0 ? section.models.map((model) => (
                        <DropdownMenuItem
                          className="model-menu-model"
                          key={model.id}
                          active={model.id === currentModel}
                          aria-label={`${model.name || model.id}, ${model.providerName}`}
                          onClick={() => chooseModel(model.id)}
                        >
                          <span className="model-menu-model-copy">
                            <strong>{model.name || model.id}</strong>
                            <small>{model.providerName}</small>
                          </span>
                        </DropdownMenuItem>
                      )) : (
                        <span className="dropdown-menu-empty">{section.empty}</span>
                      )}
                    </section>
                  ))}
                </div>
                <div className="dropdown-menu-divider" />
                {currentModelConfig?.reasoning.length > 0 && (
                  <>
                    <div
                      className="model-reasoning-submenu-holder"
                      onMouseEnter={() => setReasoningMenuOpen(true)}
                      onMouseLeave={() => setReasoningMenuOpen(false)}
                      onFocus={() => setReasoningMenuOpen(true)}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                          setReasoningMenuOpen(false);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
                          event.preventDefault();
                          setReasoningMenuOpen(false);
                          event.currentTarget.querySelector('.model-reasoning-trigger')?.focus();
                        } else if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          const holder = event.currentTarget;
                          setReasoningMenuOpen(true);
                          queueMicrotask(() => (
                            holder.querySelector('.model-reasoning-submenu button')?.focus()
                          ));
                        }
                      }}
                    >
                      <DropdownMenuItem
                        className="model-reasoning-trigger"
                        icon={<Brain size={14} />}
                        aria-haspopup="menu"
                        aria-expanded={reasoningMenuOpen}
                        onClick={() => setReasoningMenuOpen((open) => !open)}
                      >
                        <>
                          <span>Reasoning</span>
                          <ChevronRight size={14} />
                        </>
                      </DropdownMenuItem>
                      {reasoningMenuOpen && (
                        <DropdownMenu className="model-reasoning-submenu">
                          {currentModelConfig.reasoning.map((effort) => (
                            <DropdownMenuItem
                              key={effort}
                              active={effort === activeReasoningEffort}
                              icon={(
                                <span className="model-reasoning-check">
                                  {effort === activeReasoningEffort && <Check size={13} />}
                                </span>
                              )}
                              onClick={() => {
                                setReasoningEffort(effort);
                                if (persistState) writePersistedReasoningEffort(currentModel, effort);
                                setReasoningMenuOpen(false);
                                setModelMenuOpen(false);
                              }}
                            >
                              {effort}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenu>
                      )}
                    </div>
                    <div className="dropdown-menu-divider" />
                  </>
                )}
                <DropdownMenuItem
                  icon={<Search size={14} />}
                  onClick={() => {
                    setReasoningMenuOpen(false);
                    setModelMenuOpen(false);
                    setModelPickerOpen(true);
                  }}
                >
                  Explore models
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
          {inline && (
            <button
              className="round-button composer-cancel-button"
              type="button"
              onClick={onCancel}
              aria-label="Cancel editing"
              title="Cancel editing"
            >
              <X size={16} />
            </button>
          )}
          {goalPreparation ? (
            <button
              className="round-button send-button"
              type="button"
              disabled
              aria-label="Defining Goal criteria"
            >
              <LoaderCircle className="goal-strip-spinner" size={16} aria-hidden="true" />
            </button>
          ) : !inline && !canSend && isRunning ? (
            <button
              className="round-button send-button"
              type="button"
              onClick={() => onStop()}
              aria-label="Stop"
            >
              <Square size={15} />
            </button>
          ) : canSend || (!inline && canResumeQueue) ? (
            <button
              className="round-button send-button"
              type="button"
              onClick={(event) => {
                if (!canSend) {
                  const next = steeredMessages[0] ?? queuedMessages[0];
                  onReorderQueued(
                    next.status === 'steered' ? 'steer' : 'queue',
                    (next.status === 'steered' ? steeredMessages : queuedMessages)
                      .map((message) => message.id),
                    null,
                    true,
                  );
                  return;
                }
                submit({
                  steer: inline
                    ? false
                    : shouldSteerMessage(messageDeliveryMode, isRunning, event.ctrlKey),
                });
              }}
              aria-label={canSend ? 'Send' : 'Resume queue'}
            >
              <ArrowUp size={18} />
            </button>
          ) : (
            <button className="round-button" type="button" onClick={startRecording} aria-label="Record">
              <Mic size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="project-picker-row">
        <div className="project-picker-holder" ref={projectMenuRef}>
          <button
          className="project-picker"
          type="button"
          disabled={projectLocked || projectSelecting}
          title={projectLocked
            ? 'The project folder is fixed after the conversation starts.'
            : `Choose project folder · ${project?.displayPath ?? '~/'}`}
          aria-label={projectLocked
            ? `Project folder: ${project?.displayPath ?? '~/'}. Fixed for this conversation.`
            : `Choose project folder. Current folder: ${project?.displayPath ?? '~/'}`}
            aria-expanded={projectMenuOpen}
            aria-haspopup="dialog"
            onClick={() => setProjectMenuOpen((value) => !value)}
          >
          {projectSelecting ? (
            <LoaderCircle className="project-picker-spinner" size={14} />
          ) : (
            <FolderOpen size={14} />
          )}
          <span className="project-picker-path">{project?.displayPath ?? '~/'}</span>
          {project?.gitBranch && (
            <span className="project-picker-branch">
              <GitBranch size={12} />
              <span>{project.gitBranch}</span>
            </span>
          )}
          {projectLocked && <LockKeyhole className="project-picker-lock" size={12} />}
          </button>
          {projectMenuOpen && !projectLocked && (
            <div
              className="project-picker-menu"
              role="dialog"
              aria-label="Choose project folder"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setProjectMenuOpen(false);
                }
              }}
            >
              <label className="project-picker-search">
                <Search size={13} aria-hidden="true" />
                <input
                  ref={projectSearchRef}
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                  placeholder="Search projects"
                  aria-label="Search recent projects"
                />
              </label>
              <div className="project-picker-list">
                {filteredRecentProjects.map((recentProject) => (
                  <button
                    key={recentProject.path}
                    type="button"
                    className={recentProject.path === project?.path ? 'active' : ''}
                    title={recentProject.displayPath}
                    onClick={() => {
                      onChooseProject(recentProject);
                      setProjectMenuOpen(false);
                    }}
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                    <span>{recentProject.name}</span>
                    {recentProject.gitBranch && <small>{recentProject.gitBranch}</small>}
                    {recentProject.path === project?.path && <Check size={14} aria-label="Selected" />}
                  </button>
                ))}
                {filteredRecentProjects.length === 0 && (
                  <span className="project-picker-empty">
                    {recentProjects.length === 0 ? 'No recent projects' : 'No matching projects'}
                  </span>
                )}
              </div>
              <div className="project-picker-divider" />
              <button
                className="project-picker-action"
                type="button"
                onClick={async () => {
                  setProjectMenuOpen(false);
                  setProjectSelecting(true);
                  try {
                    await onChooseProject();
                  } finally {
                    setProjectSelecting(false);
                  }
                }}
              >
                <Plus size={14} aria-hidden="true" />
                <span>Select a folder</span>
              </button>
              <button
                className={`project-picker-action${project?.displayPath === '~/' ? ' active' : ''}`}
                type="button"
                onClick={() => {
                  onUseHome();
                  setProjectMenuOpen(false);
                }}
              >
                <X size={14} aria-hidden="true" />
                <span>Don't use a project</span>
                {project?.displayPath === '~/' && <Check size={14} aria-label="Selected" />}
              </button>
            </div>
          )}
        </div>
        <div className="composer-usage-indicators">
          <ProviderUsages
            providers={providerUsageProviders}
            open={providerUsagesOpen}
            onOpenChange={setProviderUsagesOpen}
          />
          <div
            className="context-usage"
            title={contextPercent === null
              ? 'Context limit is not configured for this model.'
              : `${contextUsage.tokens.toLocaleString()} of ${contextUsage.limit.toLocaleString()} input tokens used`}
            role="progressbar"
            aria-label="Context usage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={contextPercent ?? undefined}
          >
            <span
              className="context-usage-ring"
              style={{ '--context-progress': `${(contextPercent ?? 0) * 3.6}deg` }}
              aria-hidden="true"
            />
            <span>{contextPercent === null ? '—' : contextPercent}%</span>
          </div>
        </div>
      </div>
      {goalDialogOpen && createPortal(
        <div
          className="dialog-backdrop goal-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget || goalAction) return;
            setGoalDialogOpen(false);
            queueMicrotask(() => textAreaRef.current?.focus());
          }}
        >
          <form
            className="goal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="goal-dialog-title"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || goalAction) return;
              event.preventDefault();
              setGoalDialogOpen(false);
              queueMicrotask(() => textAreaRef.current?.focus());
            }}
            onSubmit={async (event) => {
              event.preventDefault();
              const specification = goalSpecification.trim();
              if (!specification || goalAction) return;
              setGoalAction('edit');
              const saved = await onGoalAction?.('edit', specification);
              setGoalAction(null);
              if (saved === false) return;
              setGoalDialogOpen(false);
              queueMicrotask(() => textAreaRef.current?.focus());
            }}
          >
            <header className="dialog-header">
              <div>
                <h2 id="goal-dialog-title">Edit Goal</h2>
                <p>
                  Define the objective, acceptance terms, constraints, and the conditions for
                  authentic completion.
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                disabled={Boolean(goalAction)}
                aria-label="Close Goal dialog"
                onClick={() => {
                  setGoalDialogOpen(false);
                  queueMicrotask(() => textAreaRef.current?.focus());
                }}
              >
                <X size={16} />
              </button>
            </header>
            <label htmlFor="goal-specification">Goal specification</label>
            <textarea
              id="goal-specification"
              autoFocus
              rows={9}
              value={goalSpecification}
              disabled={Boolean(goalAction)}
              placeholder="Describe the objective, what must be true at the end, and any constraints the agent must respect."
              onChange={(event) => setGoalSpecification(event.target.value)}
            />
            <footer className="dialog-footer">
              <span>The agent will keep iterating until it completes or blocks this Goal.</span>
              <div>
                <button
                  type="button"
                  disabled={Boolean(goalAction)}
                  onClick={() => {
                    setGoalDialogOpen(false);
                    queueMicrotask(() => textAreaRef.current?.focus());
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary-mini"
                  type="submit"
                  disabled={Boolean(goalAction) || !goalSpecification.trim()}
                >
                  {goalAction
                    ? 'Saving...'
                    : 'Save changes'}
                </button>
              </div>
            </footer>
          </form>
        </div>,
        document.body,
      )}
      {modelPickerOpen && (
        <ModelPicker
          models={models}
          favorites={favorites}
          currentModel={currentModel}
          onClose={() => setModelPickerOpen(false)}
          onChoose={chooseModel}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </section>
  );
}

function ComposerStrip({
  as: Root = 'div',
  className = '',
  children,
  ...props
}) {
  return (
    <Root className={`composer-wrap-strip ${className}`.trim()} {...props}>
      {children}
    </Root>
  );
}

function saveComposerDraft(key, text) {
  if (text) {
    window.localStorage.setItem(key, text);
  } else {
    window.localStorage.removeItem(key);
  }
}

function AudioWave({ level, paused }) {
  const bars = [0.28, 0.56, 0.82, 0.48, 0.7, 0.36, 0.62];

  return (
    <div className={`audio-wave${paused ? ' paused' : ''}`} style={{ '--audio-level': level }}>
      {bars.map((base, index) => (
        <span
          key={base}
          style={{
            '--bar-base': base,
            '--bar-index': index,
          }}
        />
      ))}
    </div>
  );
}

function stopRecording(recording) {
  return new Promise((resolve, reject) => {
    recording.mediaRecorder.addEventListener('stop', async () => {
      try {
        cleanupRecording(recording);
        resolve(await createMp3Attachment(recording.chunks));
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    recording.mediaRecorder.stop();
  });
}

function cleanupRecording(recording) {
  recording.stream.getTracks().forEach((track) => track.stop());
  recording.source?.disconnect();
  if (recording.audioContext?.state !== 'closed') {
    recording.audioContext?.close();
  }
}
