import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CornerDownLeft,
  FolderOpen,
  GitBranch,
  GripVertical,
  HardDrive,
  ListChecks,
  LoaderCircle,
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

const composerDraftKey = 'aivax.composer.draft';
const permissionModeKey = 'aivax.composer.permission-mode';
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
];

function shouldSteerMessage(messageDeliveryMode, isRunning, modifierPressed) {
  return isRunning && (
    (messageDeliveryMode === 'steer') !== modifierPressed
  );
}

export function Composer({
  containerRef,
  isRunning,
  onSend,
  onStop,
  onCompress,
  onCreateSideChat,
  subagents = [],
  onOpenSubagents,
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
  currentModel,
  contextUsage,
  onChooseModel,
  project,
  projectLocked,
  onChooseProject,
  onUseHome,
  onToggleFavorite,
  workMode = null,
  onWorkModeChange,
  goal = null,
  onGoalAction,
  messageDeliveryMode = 'queue',
  draftKey = composerDraftKey,
}) {
  const [text, setText] = useState(() => window.localStorage.getItem(draftKey) ?? '');
  const [attachments, setAttachments] = useState([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState(() => {
    const savedMode = window.localStorage.getItem(permissionModeKey);
    return permissionModes.some((mode) => mode.id === savedMode)
      ? savedMode
      : 'approve_for_me';
  });
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [commandStage, setCommandStage] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [contextCommands, setContextCommands] = useState([]);
  const [reasoningEffort, setReasoningEffort] = useState(null);
  const [recording, setRecording] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [projectSelecting, setProjectSelecting] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [draggedQueuedMessageId, setDraggedQueuedMessageId] = useState(null);
  const [queuedMenu, setQueuedMenu] = useState(null);
  const [editingQueuedMessageId, setEditingQueuedMessageId] = useState(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
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
  textRef.current = text;

  const commandInvocation = commandStage ? null : text.match(/^([/$])([^\s]*)$/);
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
    : currentModelConfig?.reasoning[0] ?? null;
  const activePermissionMode = permissionModes.find((mode) => mode.id === permissionMode);
  const commandOptions = useMemo(() => {
    const normalized = commandQuery.trim().toLowerCase();

    if (commandMode === 'commands') {
      const builtInCommands = commandPrefix === '/'
        ? composerCommands
          .filter((command) => command.id !== 'compress' || projectLocked)
          .filter((command) => command.id !== 'side' || onCreateSideChat)
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
  ]);
  const activeCommandOption = commandOptions[commandIndex] ?? commandOptions[0] ?? null;
  const activeGoal = goal && ['active', 'paused'].includes(goal.status) ? goal : null;
  const effectiveWorkMode = activeGoal ? 'goal' : workMode;
  const canSend = !commandMode && (
    effectiveWorkMode === 'goal' && !activeGoal
      ? Boolean(text.trim())
      : Boolean(text.trim() || attachments.length > 0)
  );
  const workingSubagents = subagents.filter((subagent) => subagent.status === 'working').length;
  const finishedSubagents = subagents.filter((subagent) => subagent.status === 'finished').length;
  const failedSubagents = subagents.filter((subagent) => subagent.status === 'failed').length;
  const contextPercent = contextUsage?.limit
    ? Math.min(100, Math.max(0, Math.round((contextUsage.tokens / contextUsage.limit) * 100)))
    : null;
  const goalElapsedMs = activeGoal
    ? activeGoal.activeElapsedMs + (
        activeGoal.status === 'active' && activeGoal.resumedAt
          ? Math.max(0, goalNow - new Date(activeGoal.resumedAt).getTime())
          : 0
      )
    : 0;
  const goalElapsedSeconds = Math.floor(goalElapsedMs / 1000);
  const goalElapsedLabel = [
    Math.floor(goalElapsedSeconds / 3600),
    Math.floor((goalElapsedSeconds % 3600) / 60),
    goalElapsedSeconds % 60,
  ].map((part) => String(part).padStart(2, '0')).join(':');
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
    const saveDelay = text.length <= 2048
      ? 300
      : text.length <= 20000
        ? 1000
        : 5000;
    const timer = window.setTimeout(() => saveComposerDraft(draftKey, text), saveDelay);

    return () => window.clearTimeout(timer);
  }, [draftKey, text]);

  useEffect(() => {
    const saveOnClose = () => saveComposerDraft(draftKey, textRef.current);

    window.addEventListener('beforeunload', saveOnClose);
    return () => window.removeEventListener('beforeunload', saveOnClose);
  }, [draftKey]);

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
    if (queuedMenu && !queuedMessages.some((message) => message.id === queuedMenu.messageId)) {
      setQueuedMenu(null);
    }
  }, [queuedMenu, queuedMessages]);

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

  async function submit({ steer = false } = {}) {
    if (!canSend) return;
    const payload = {
      text,
      attachments,
      steer,
      reasoningEffort: activeReasoningEffort,
      permissionMode,
      workMode: effectiveWorkMode,
    };
    setText('');
    window.localStorage.removeItem(draftKey);
    setAttachments([]);
    await onSend(payload);
  }

  function chooseModel(modelId) {
    onChooseModel(modelId);
    setReasoningEffort(null);
    setReasoningMenuOpen(false);
    setModelMenuOpen(false);
    setModelPickerOpen(false);
  }

  function exitCommandMode() {
    setCommandStage(null);
    setCommandIndex(0);
    setText('');
    queueMicrotask(() => textAreaRef.current?.focus());
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
      if (option.id === 'side') {
        exitCommandMode();
        onCreateSideChat();
        return;
      }
      if (option.id === 'plan') {
        exitCommandMode();
        onWorkModeChange?.('plan');
        return;
      }
      if (option.id === 'goal') {
        exitCommandMode();
        if (activeGoal) {
          setGoalSpecification(activeGoal.specification);
          setGoalDialogOpen(true);
        } else {
          onWorkModeChange?.('goal');
        }
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
        });
        return;
      }
      setCommandStage(option.id);
      setCommandIndex(0);
      setText('');
      queueMicrotask(() => textAreaRef.current?.focus());
      return;
    }

    if (commandMode === 'models') {
      chooseModel(option.value);
    } else if (commandMode === 'efforts') {
      setReasoningEffort(option.value);
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
      const next = await Promise.all(files.map(fileToAttachment));
      setAttachments((items) => [...items, ...next]);
      return;
    }

    const pastedText = event.clipboardData.getData('text');
    if (pastedText && pastedText.length > 4000) {
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
      steer: shouldSteerMessage(messageDeliveryMode, isRunning, event.ctrlKey),
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
    <section ref={containerRef} className="composer-wrap">
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
      {activeGoal && (
        <ComposerStrip
          className={`goal-strip${activeGoal.status === 'paused' ? ' paused' : ''}`}
          aria-label={`Goal ${activeGoal.status}`}
        >
          <Target size={15} aria-hidden="true" />
          <span className="goal-strip-copy">
            <strong title={activeGoal.specification}>{activeGoal.specification}</strong>
            <small>
              <Clock3 size={12} aria-hidden="true" />
              <span>{goalElapsedLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{activeGoal.status === 'paused' ? 'Paused' : 'Working'}</span>
            </small>
          </span>
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
        </ComposerStrip>
      )}
      {subagents.length > 0 && (
        <ComposerStrip
          as="button"
          className="subagent-strip"
          type="button"
          aria-label="Open sub-agents panel"
          onClick={onOpenSubagents}
        >
          <Bot size={15} aria-hidden="true" />
          <span aria-live="polite">
            {workingSubagents} sub-agent{workingSubagents === 1 ? '' : 's'} working,{' '}
            {finishedSubagents} finished
            {failedSubagents > 0 ? `, ${failedSubagents} failed` : ''}
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </ComposerStrip>
      )}
      {queuedMessages.length > 0 && (
        <ComposerStrip as="ol" className="queued-messages" aria-label="Queued messages">
          {queuedMessages.map((message, index) => (
            <li
              key={message.id}
              className={[
                draggedQueuedMessageId === message.id && 'dragging',
                queuedMenu?.messageId === message.id && 'menu-open',
              ].filter(Boolean).join(' ')}
              onDragOver={(event) => {
                if (!draggedQueuedMessageId || draggedQueuedMessageId === message.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedQueuedMessageId || draggedQueuedMessageId === message.id) return;
                const messageIds = queuedMessages
                  .map((item) => item.id)
                  .filter((messageId) => messageId !== draggedQueuedMessageId);
                messageIds.splice(index, 0, draggedQueuedMessageId);
                setDraggedQueuedMessageId(null);
                onReorderQueued(messageIds);
              }}
            >
              <button
                className="queued-message-grip"
                type="button"
                draggable
                title="Drag or use the arrow keys to reorder"
                aria-label={`Reorder queued message ${index + 1}`}
                onKeyDown={(event) => {
                  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  const nextIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
                  if (nextIndex < 0 || nextIndex >= queuedMessages.length) return;
                  const messageIds = queuedMessages.map((item) => item.id);
                  [messageIds[index], messageIds[nextIndex]] = [
                    messageIds[nextIndex],
                    messageIds[index],
                  ];
                  onReorderQueued(messageIds);
                }}
                onDragStart={(event) => {
                  setDraggedQueuedMessageId(message.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', message.id);
                }}
                onDragEnd={() => setDraggedQueuedMessageId(null)}
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
                <button
                  type="button"
                  className="queued-message-steer"
                  title="Stop the current response and send this message next"
                  onClick={() => onSteerQueued(
                    message.id,
                    queuedMessages.map((item) => item.id),
                  )}
                >
                  <CornerDownLeft size={13} />
                  <span>Steer</span>
                </button>
                <button
                  type="button"
                  title="Remove from queue"
                  aria-label={`Remove queued message ${index + 1}`}
                  onClick={() => onCancelQueued(message.id)}
                >
                  <Trash2 size={13} />
                </button>
                <button
                  className={queuedMenu?.messageId === message.id ? 'active' : ''}
                  type="button"
                  title="More actions"
                  aria-label={`More actions for queued message ${index + 1}`}
                  aria-haspopup="menu"
                  aria-expanded={queuedMenu?.messageId === message.id}
                  data-queue-menu-trigger={message.id}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const nextMenu = queuedMenu?.messageId === message.id
                      ? null
                      : {
                          messageId: message.id,
                          top: Math.min(window.innerHeight - 48, rect.bottom + 4),
                          left: Math.max(8, rect.right - 174),
                        };
                    setQueuedMenu(nextMenu);
                    if (nextMenu) {
                      queueMicrotask(() => (
                        document.querySelector('.queued-message-actions-menu button')?.focus()
                      ));
                    }
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </li>
          ))}
        </ComposerStrip>
      )}
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
              const message = queuedMessages.find((item) => item.id === queuedMenu.messageId);
              if (!message) return;
              setEditingQueuedMessageId(message.id);
              try {
                if (!await onCancelQueued(message.id)) return;
                setText(message.content ?? '');
                setAttachments(message.attachments ?? []);
                setCommandStage(null);
                setCommandIndex(0);
                setQueuedMenu(null);
                queueMicrotask(() => textAreaRef.current?.focus());
              } finally {
                setEditingQueuedMessageId(null);
              }
            }}
          >
            {editingQueuedMessageId === queuedMenu.messageId ? 'Opening…' : 'Edit message'}
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
      <div className="composer">
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
              <span
                key={attachment.id}
                className={`attachment-chip${attachment.kind === 'context_marker' ? ' context-marker' : ''}`}
              >
                {attachment.kind === 'context_marker'
                  ? attachment.markerType === 'workflow'
                    ? <Workflow size={13} />
                    : <Sparkles size={13} />
                  : <Paperclip size={13} />}
                <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                {attachment.kind !== 'context_marker' && <small>{formatBytes(attachment.size)}</small>}
                <button
                  type="button"
                  onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-main">
          <textarea
            ref={textAreaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
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
                      onWorkModeChange?.(workMode === 'goal' ? null : 'goal');
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
                    onWorkModeChange?.(workMode === 'plan' ? null : 'plan');
                    setPlusOpen(false);
                  }}
                >
                  Plan
                </DropdownMenuItem>
                <DropdownMenuItem icon={<HardDrive size={14} />} onClick={attachFromComputer}>
                  Attach from computer
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
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
                        window.localStorage.setItem(permissionModeKey, mode.id);
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
                onClick={() => onWorkModeChange?.(null)}
              >
                {workMode === 'goal'
                  ? <Target size={12} aria-hidden="true" />
                  : <ListChecks size={12} aria-hidden="true" />}
                <span>{workMode === 'goal' ? 'Goal' : 'Plan'}</span>
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="model-input-holder" ref={modelMenuRef}>
            <button
              className="model-input-trigger"
              type="button"
              onClick={() => {
                setReasoningMenuOpen(false);
                setModelMenuOpen((value) => !value);
              }}
            >
              <span className="model-input-label">
                {modelName || 'Choose model'}
                {activeReasoningEffort && (
                  <span className="model-input-effort"> - {activeReasoningEffort}</span>
                )}
              </span>
              <ChevronDown size={14} />
            </button>
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
          {!canSend && isRunning ? (
            <button
              className="round-button send-button"
              type="button"
              onClick={() => onStop()}
              aria-label="Stop"
            >
              <Square size={15} />
            </button>
          ) : canSend ? (
            <button
              className="round-button send-button"
              type="button"
              onClick={(event) => submit({
                steer: shouldSteerMessage(messageDeliveryMode, isRunning, event.ctrlKey),
              })}
              aria-label="Send"
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
    <Root className={`composer-strip ${className}`.trim()} {...props}>
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
