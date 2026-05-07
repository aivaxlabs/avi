import {
  ArrowUp,
  FolderOpen,
  HardDrive,
  Mic,
  Bot,
  Paperclip,
  Pause,
  Play,
  Plus,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createMp3Attachment } from '../lib/audio.js';
import { fileToAttachment, formatBytes, textToAttachment } from '../lib/files.js';
import { ModelPicker } from './ModelPicker.jsx';

const composerDraftKey = 'aivax.composer.draft';

export function Composer({
  isRunning,
  onSend,
  onStop,
  droppedFiles,
  modelName,
  models,
  favorites,
  currentModel,
  activeWorkspaceId,
  workspaceAttachments,
  selectedWorkspaceAttachments,
  onChooseModel,
  onToggleFavorite,
  onRefreshModels,
  onAttachFromWorkspace,
}) {
  const [text, setText] = useState(() => window.localStorage.getItem(composerDraftKey) ?? '');
  const [attachments, setAttachments] = useState([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [recording, setRecording] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const plusHolderRef = useRef(null);
  const textAreaRef = useRef(null);

  const canSend = text.trim() || attachments.length > 0;

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
    if (!droppedFiles?.files.length) return;

    Promise.all(droppedFiles.files.map(fileToAttachment))
      .then((next) => setAttachments((items) => [...items, ...next]))
      .catch(() => {});
  }, [droppedFiles]);

  useEffect(() => {
    if (!workspaceAttachments?.attachments?.length) return;
    setAttachments((items) => [...items, ...workspaceAttachments.attachments]);
  }, [workspaceAttachments]);

  useEffect(() => {
    if (!selectedWorkspaceAttachments?.attachments?.length) return;
    setAttachments((items) => [...items, ...selectedWorkspaceAttachments.attachments]);
  }, [selectedWorkspaceAttachments]);

  useEffect(() => {
    if (!plusOpen) return undefined;
    const close = (event) => {
      if (plusHolderRef.current?.contains(event.target)) return;
      setPlusOpen(false);
      setModelPickerOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [plusOpen]);

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

  function chooseModel(modelId) {
    onChooseModel(modelId);
    setModelPickerOpen(false);
    setPlusOpen(false);
  }

  async function submit({ steer = false } = {}) {
    if (!canSend) return;
    const payload = { text, attachments, steer };
    setText('');
    window.localStorage.removeItem(composerDraftKey);
    setAttachments([]);
    await onSend(payload);
  }

  async function attachFromComputer() {
    const selected = await window.aivax.files.select();
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
    await onSend({ text: '', attachments: [attachment] });
  }

  async function cancelRecording() {
    if (!recording || recording.stopping) return;
    if (recording.mediaRecorder.state !== 'inactive') {
      recording.mediaRecorder.stop();
    }
    cleanupRecording(recording);
    setRecording(null);
  }

  const visibleAttachments = attachments.filter(isVisibleAttachment);

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
        {visibleAttachments.length > 0 && (
          <div className="attachment-strip">
            {visibleAttachments.map((attachment) => (
              <span key={attachment.id} className="attachment-chip">
                <Paperclip size={13} />
                <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                <small>{attachmentLabel(attachment)}</small>
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
          <div className="plus-holder" ref={plusHolderRef}>
            <button className="round-button" type="button" onClick={() => setPlusOpen((value) => !value)}>
              <Plus size={18} />
            </button>
            {plusOpen && (
              <div className="plus-menu">
                <button
                  type="button"
                  onClick={() => {
                    setModelPickerOpen(true);
                    setPlusOpen(false);
                  }}
                >
                  <Bot size={14} />
                  <span className="plus-menu-model">
                    <span>Model</span>
                    <small>{modelName || 'Choose model'}</small>
                  </span>
                </button>
                <button type="button" disabled>
                  <Wrench size={14} />
                  Tools
                </button>
                <button
                  type="button"
                  disabled={!activeWorkspaceId}
                  onClick={() => {
                    setPlusOpen(false);
                    onAttachFromWorkspace();
                  }}
                >
                  <FolderOpen size={14} />
                  Attach from workspace
                </button>
                <button type="button" onClick={attachFromComputer}>
                  <HardDrive size={14} />
                  Attach from computer
                </button>
              </div>
            )}
          </div>
          <textarea
            ref={textAreaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={`Message ${modelName || 'model'}`}
          />
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
      {modelPickerOpen && (
        <ModelPicker
          models={models}
          favorites={favorites}
          currentModel={currentModel}
          onClose={() => setModelPickerOpen(false)}
          onChoose={chooseModel}
          onToggleFavorite={onToggleFavorite}
          onRefresh={onRefreshModels}
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

function isVisibleAttachment() {
  return true;
}

function attachmentLabel(attachment) {
  if (attachment.kind === 'workspace_ref') {
    return attachment.isDirectory ? 'Workspace folder' : 'Workspace file';
  }
  return formatBytes(attachment.size);
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
