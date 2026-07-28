import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  Mic,
  Paperclip,
  Pause,
  Play,
  Plus,
  Search,
  SquareTerminal,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createMp3Attachment } from '../lib/audio.js';
import { fileToAttachment, formatBytes, textToAttachment } from '../lib/files.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { ModelPicker } from './ModelPicker.jsx';

const composerDraftKey = 'aivax.composer.draft';
const composerCommands = [
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
];

export function Composer({
  isRunning,
  onSend,
  onStop,
  onCompress,
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
}) {
  const [text, setText] = useState(() => window.localStorage.getItem(composerDraftKey) ?? '');
  const [attachments, setAttachments] = useState([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [commandStage, setCommandStage] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [reasoningEffort, setReasoningEffort] = useState(null);
  const [recording, setRecording] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [projectSelecting, setProjectSelecting] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const plusHolderRef = useRef(null);
  const modelMenuRef = useRef(null);
  const projectMenuRef = useRef(null);
  const projectSearchRef = useRef(null);
  const textAreaRef = useRef(null);

  const commandInvocation = commandStage ? null : text.match(/^([/$])([^\s]*)$/);
  const commandMode = commandStage ?? (commandInvocation ? 'commands' : null);
  const commandPrefix = commandInvocation?.[1] ?? '/';
  const commandQuery = commandMode === 'commands' ? commandInvocation?.[2] ?? '' : text;
  const currentModelConfig = models.find((model) => model.id === currentModel) ?? null;
  const activeReasoningEffort = currentModelConfig?.reasoning.includes(reasoningEffort)
    ? reasoningEffort
    : null;
  const commandOptions = useMemo(() => {
    const normalized = commandQuery.trim().toLowerCase();

    if (commandMode === 'commands') {
      return composerCommands
        .filter((command) => command.id !== 'compress' || projectLocked)
        .filter((command) => command.name.includes(normalized))
        .map((command) => ({
          ...command,
          label: `${commandPrefix}${command.name}`,
        }));
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
    currentModel,
    currentModelConfig,
    models,
    projectLocked,
  ]);
  const activeCommandOption = commandOptions[commandIndex] ?? commandOptions[0] ?? null;
  const canSend = !commandMode && (text.trim() || attachments.length > 0);
  const contextPercent = contextUsage?.limit
    ? Math.min(100, Math.max(0, Math.round((contextUsage.tokens / contextUsage.limit) * 100)))
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
    const saveDelay = text.length <= 2048
      ? 300
      : text.length <= 20000
        ? 1000
        : 5000;
    const timer = window.setTimeout(() => saveComposerDraft(text), saveDelay);

    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const saveOnClose = () => saveComposerDraft(text);

    window.addEventListener('beforeunload', saveOnClose);
    return () => window.removeEventListener('beforeunload', saveOnClose);
  }, [text]);

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;

    textArea.style.height = '0px';
    textArea.style.height = `${Math.min(textArea.scrollHeight, 500)}px`;
    textArea.style.overflowY = textArea.scrollHeight > 500 ? 'auto' : 'hidden';
  }, [text]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandMode, commandQuery, currentModel]);

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
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [modelMenuOpen]);

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
    };
    setText('');
    window.localStorage.removeItem(composerDraftKey);
    setAttachments([]);
    await onSend(payload);
  }

  function chooseModel(modelId) {
    onChooseModel(modelId);
    setReasoningEffort(null);
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
      if (option.id === 'compress') {
        exitCommandMode();
        onCompress();
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

    if (event.key !== 'Enter') return;
    if (event.shiftKey && isRunning) {
      event.preventDefault();
      submit({ steer: true });
      return;
    }
    if (!event.shiftKey) {
      event.preventDefault();
      submit();
    }
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
    <section className="composer-wrap">
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
      <div className="composer">
        {commandMode && (
          <section className="command-picker" aria-label="Composer commands">
            <header className="command-picker-header">
              <span>
                {commandMode === 'commands' && 'Commands'}
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
                    {commandMode === 'commands' && <SquareTerminal size={16} />}
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
              <span key={attachment.id} className="attachment-chip">
                <Paperclip size={13} />
                <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                <small>{formatBytes(attachment.size)}</small>
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
                : `Message ${modelName || 'model'}`}
            aria-expanded={Boolean(commandMode)}
            aria-controls={commandMode ? 'composer-command-list' : undefined}
            aria-activedescendant={activeCommandOption ? `composer-command-option-${commandIndex}` : undefined}
          />
          <div className="plus-holder" ref={plusHolderRef}>
            <button className="round-button" type="button" onClick={() => setPlusOpen((value) => !value)}>
              <Plus size={18} />
            </button>
            {plusOpen && (
              <DropdownMenu className="attachment-dropdown-menu">
                <DropdownMenuItem icon={<Wrench size={14} />} disabled>
                  Tools
                </DropdownMenuItem>
                <DropdownMenuItem icon={<HardDrive size={14} />} onClick={attachFromComputer}>
                  Attach from computer
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
          <div className="model-input-holder" ref={modelMenuRef}>
            <button
              className="model-input-trigger"
              type="button"
              onClick={() => setModelMenuOpen((value) => !value)}
            >
              <span>
                {modelName || 'Choose model'}
                {activeReasoningEffort ? ` · ${activeReasoningEffort}` : ''}
              </span>
              <ChevronDown size={14} />
            </button>
            {modelMenuOpen && (
              <DropdownMenu className="model-input-menu">
                <div className="model-input-menu-list">
                  {recentModels.length > 0 ? recentModels.map((model) => (
                    <DropdownMenuItem
                      key={model.id}
                      active={model.id === currentModel}
                      onClick={() => chooseModel(model.id)}
                    >
                      {model.name || model.id}
                    </DropdownMenuItem>
                  )) : (
                    <span className="dropdown-menu-empty">No recent models</span>
                  )}
                </div>
                <div className="dropdown-menu-divider" />
                <DropdownMenuItem
                  icon={<Search size={14} />}
                  onClick={() => {
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
            <button className="round-button send-button" type="button" onClick={onStop} aria-label="Stop">
              <Square size={15} />
            </button>
          ) : canSend ? (
            <button
              className="round-button send-button"
              type="button"
              onClick={(event) => submit({ steer: event.shiftKey })}
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

function saveComposerDraft(text) {
  if (text) {
    window.localStorage.setItem(composerDraftKey, text);
  } else {
    window.localStorage.removeItem(composerDraftKey);
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
