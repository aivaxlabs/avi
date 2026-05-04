import {
  ArrowUp,
  FolderOpen,
  HardDrive,
  Mic,
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
  modelName,
  models,
  favorites,
  currentModel,
  isRunning,
  onSend,
  onStop,
  onChooseModel,
  onToggleFavorite,
  onRefreshModels,
}) {
  const [text, setText] = useState(() => window.localStorage.getItem(composerDraftKey) ?? '');
  const [attachments, setAttachments] = useState([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [recording, setRecording] = useState(null);
  const textAreaRef = useRef(null);
  const modelPopoverRef = useRef(null);

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
    if (!modelPickerOpen) return undefined;
    const close = (event) => {
      if (modelPopoverRef.current?.contains(event.target)) return;
      setModelPickerOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [modelPickerOpen]);

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
    const chunks = [];
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    mediaRecorder.start();
    setRecording({ mediaRecorder, chunks, paused: false, stream });
  }

  function pauseRecording() {
    recording.mediaRecorder.pause();
    setRecording({ ...recording, paused: true });
  }

  function resumeRecording() {
    recording.mediaRecorder.resume();
    setRecording({ ...recording, paused: false });
  }

  async function sendRecording() {
    const current = recording;
    if (!current) return;
    const attachment = await stopRecording(current);
    setRecording(null);
    await onSend({ text: '', attachments: [attachment] });
  }

  async function cancelRecording() {
    if (!recording) return;
    recording.mediaRecorder.stop();
    recording.stream.getTracks().forEach((track) => track.stop());
    setRecording(null);
  }

  return (
    <section className="composer-wrap">
      {recording && (
        <div className="recording-bar">
          <span className="record-dot" />
          <span>Recording audio</span>
          <button type="button" onClick={recording.paused ? resumeRecording : pauseRecording}>
            {recording.paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button type="button" onClick={cancelRecording}>
            <Trash2 size={15} />
          </button>
          <button type="button" className="primary-mini" onClick={sendRecording}>
            Send
          </button>
        </div>
      )}
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="attachment-chip">
                <Paperclip size={13} />
                {attachment.name}
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
          <div className="plus-holder">
            <button className="round-button" type="button" onClick={() => setPlusOpen((value) => !value)}>
              <Plus size={18} />
            </button>
            {plusOpen && (
              <div className="plus-menu">
                <button type="button" disabled>
                  <Wrench size={14} />
                  Tools
                </button>
                <button type="button" disabled>
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
          <div className="model-popover-holder" ref={modelPopoverRef}>
            <button className="model-pill" type="button" onClick={() => setModelPickerOpen((value) => !value)}>
              {modelName || 'Choose model'}
            </button>
            {modelPickerOpen && (
              <ModelPicker
                models={models}
                favorites={favorites}
                currentModel={currentModel}
                onClose={() => setModelPickerOpen(false)}
                onChoose={onChooseModel}
                onToggleFavorite={onToggleFavorite}
                onRefresh={onRefreshModels}
              />
            )}
          </div>
          <textarea
            ref={textAreaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Message AIVAX"
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

function stopRecording(recording) {
  return new Promise((resolve, reject) => {
    recording.mediaRecorder.addEventListener('stop', async () => {
      try {
        recording.stream.getTracks().forEach((track) => track.stop());
        resolve(await createMp3Attachment(recording.chunks));
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    recording.mediaRecorder.stop();
  });
}
