import { ArrowUp, ChevronDown, LoaderCircle, Mic, Paperclip, Square, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createMp3Attachment } from './lib/audio.js';
import { fileToAttachment, formatBytes, textToAttachment } from './lib/files.js';
import { Message } from './components/Message.jsx';
import { ModelPicker } from './components/ModelPicker.jsx';
import { applyTheme, readAppearance } from './lib/apply-theme.js';
import { useStreamingAutoScroll } from './lib/use-streaming-auto-scroll.js';
import { setPluginThemes } from './lib/themes.js';
import { Presence } from './components/Overlay.jsx';
import { QuestionForm } from './components/QuestionForm.jsx';

const api = window.chatApp;
const sessionId = new URLSearchParams(window.location.search).get('session');

export default function QuickChatApp() {
  const [models, setModels] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const [questionRequest, setQuestionRequest] = useState(null);
  const [error, setError] = useState('');
  const [fileDropActive, setFileDropActive] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);
  const dragDepthRef = useRef(0);
  const questionRequestRef = useRef(null);

  useEffect(() => {
    questionRequestRef.current = questionRequest;
  }, [questionRequest]);

  useEffect(() => {
    Promise.all([
      api.app.state(),
      api.quickChat.state(sessionId),
      api.models.list(),
      api.models.favorites(),
    ]).then(([appState, state, availableModels, favoriteModels]) => {
      setPluginThemes(appState.pluginCatalog?.themes);
      applyTheme(readAppearance());
      setModel(state.model);
      setMessages(state.messages);
      setRunning(state.running);
      setModels(availableModels);
      setFavorites(favoriteModels);
    }).catch((nextError) => setError(nextError.message));
    return api.quickChat.onEvent((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.type === 'message') {
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === event.message.id);
          if (index < 0) return [...current, event.message];
          const next = [...current];
          next[index] = event.message;
          return next;
        });
      } else if (event.type === 'run-state') {
        setRunning(event.running);
      } else if (event.type === 'question-request') {
        setQuestionRequest(event);
      } else if (event.type === 'question-cancelled') {
        if (event.questionId === questionRequestRef.current?.questionId) {
          setQuestionRequest(null);
        }
      } else if (event.type === 'error') {
        setError(event.message);
      }
    });
  }, []);

  const lastMessage = messages.at(-1);
  const streamScrollKey = [
    lastMessage?.id ?? '',
    lastMessage?.updatedAt ?? '',
    String(lastMessage?.content ?? '').length,
    questionRequest?.questionId ?? '',
  ].join(':');

  const { scrollRef } = useStreamingAutoScroll({
    scrollKey: streamScrollKey,
    isRunning: running,
    resetKey: sessionId,
  });

  const selectedModel = models.find((item) => item.id === model);
  const modelName = selectedModel?.name ?? selectedModel?.modelId ?? 'Choose model';

  function resolveQuickQuestion(answers, cancelled) {
    api.quickChat.answerQuestion({
      sessionId,
      questionId: questionRequest.questionId,
      answers,
      cancelled,
    });
    setQuestionRequest(null);
  }

  return (
    <main
      className="quick-chat-shell"
      onDragEnter={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setFileDropActive(true);
      }}
      onDragOver={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setFileDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setFileDropActive(false);
      }}
      onDrop={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setFileDropActive(false);
        const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file instanceof File);
        if (files.length > 0) setDroppedFiles({ id: crypto.randomUUID(), files });
      }}
    >
      {fileDropActive && (
        <div className="quick-file-drop-overlay">
          <UploadCloud size={24} />
          <span>Drop files to attach</span>
        </div>
      )}
      <section className="quick-chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="quick-chat-empty">
            <strong>What can I help with?</strong>
            <span>This conversation disappears when you close the window.</span>
          </div>
        ) : (
          <div className="quick-chat-messages">
            {messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                modelName={modelName}
                workedMessages={[]}
                runActive={running && index === messages.length - 1 && message.role === 'assistant'}
                questionPending={Boolean(questionRequest && index === messages.length - 1)}
                showContinuations={false}
              />
            ))}
          </div>
        )}
        {questionRequest && (
          <div className="quick-question">
            <QuestionForm
              key={questionRequest.questionId}
              formId={questionRequest.questionId}
              questions={questionRequest.questions}
              onActivity={() => {
                api.quickChat.questionActivity({
                  sessionId,
                  questionId: questionRequest.questionId,
                }).catch(console.error);
              }}
              onSubmit={(answers) => resolveQuickQuestion(answers, false)}
              onCancel={() => resolveQuickQuestion([], true)}
            />
          </div>
        )}
      </section>
      {error && <div className="quick-chat-error">{error}</div>}
      <QuickComposer
        models={models}
        favorites={favorites}
        model={model}
        modelName={modelName}
        running={running}
        droppedFiles={droppedFiles}
        onChooseModel={setModel}
        onToggleFavorite={async (modelId) => setFavorites(await api.models.favorite({
          modelId,
          favorited: !favorites.includes(modelId),
        }))}
        onSend={async ({ text, attachments }) => {
          setError('');
          await api.quickChat.send({ sessionId, text, attachments, model });
        }}
        onStop={() => api.quickChat.stop(sessionId)}
      />
    </main>
  );
}

function QuickComposer({
  models,
  favorites,
  model,
  modelName,
  running,
  droppedFiles,
  onChooseModel,
  onToggleFavorite,
  onSend,
  onStop,
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recording, setRecording] = useState(null);
  const inputRef = useRef(null);

  async function attachFiles(files, source = null) {
    const nextAttachments = await Promise.all(
      [...files].map((file) => fileToAttachment(file, source)),
    );
    setAttachments((current) => [...current, ...nextAttachments]);
  }

  useEffect(() => {
    if (droppedFiles?.files.length > 0) void attachFiles(droppedFiles.files, 'drop');
  }, [droppedFiles?.id]);

  async function submit() {
    if (running) return onStop();
    const normalizedText = text.trim();
    if (!normalizedText && attachments.length === 0) return;
    const payload = { text: normalizedText, attachments };
    setText('');
    setAttachments([]);
    await onSend(payload);
  }

  async function toggleRecording() {
    if (recording?.processing) return;
    if (recording) {
      setRecording({ ...recording, processing: true });
      recording.recorder.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      try {
        const attachment = await createMp3Attachment(chunks);
        setAttachments((current) => [...current, attachment]);
      } finally {
        setRecording(null);
      }
    }, { once: true });
    recorder.start();
    setRecording({ recorder });
  }

  return (
    <footer className="quick-composer">
      {attachments.length > 0 && (
        <div className="quick-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id}>
              {attachment.name} <small>{formatBytes(attachment.size)}</small>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        value={text}
        rows={1}
        placeholder="Message Avi"
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files ?? []);
          if (files.length > 0) {
            event.preventDefault();
            void attachFiles(files, 'clipboard');
            return;
          }
          const pastedText = event.clipboardData.getData('text');
          if (pastedText.length > 2048) {
            event.preventDefault();
            setAttachments((current) => [...current, textToAttachment(pastedText)]);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="quick-composer-actions">
        <div className="quick-composer-tools">
          <label className="quick-icon-button" aria-label="Attach files" title="Attach files">
            <Paperclip size={18} />
            <input type="file" multiple onChange={(event) => {
              void attachFiles(event.target.files);
              event.target.value = '';
            }} />
          </label>
          <button
            className={`quick-icon-button${recording ? ' active' : ''}`}
            type="button"
            aria-label={recording?.processing ? 'Processing audio' : recording ? 'Stop recording' : 'Record audio'}
            title={recording?.processing ? 'Processing audio...' : recording ? 'Stop recording' : 'Record audio'}
            disabled={recording?.processing}
            onClick={() => void toggleRecording()}
          >
            {recording?.processing
              ? <LoaderCircle className="recording-spinner" size={15} />
              : recording ? <Square size={15} /> : <Mic size={18} />}
          </button>
        </div>
        <button className="quick-model-button" type="button" onClick={() => setPickerOpen(true)}>
          <span>{modelName}</span>
          <ChevronDown size={14} />
        </button>
        <button
          className="quick-send-button"
          type="button"
          aria-label={running ? 'Stop' : 'Send'}
          onClick={() => void submit()}
        >
          {running ? <Square size={15} /> : <ArrowUp size={18} />}
        </button>
      </div>
      <Presence when={pickerOpen}>{() => (
        <ModelPicker
          models={models}
          favorites={favorites}
          currentModel={model}
          onClose={() => setPickerOpen(false)}
          onChoose={onChooseModel}
          onToggleFavorite={onToggleFavorite}
        />
      )}</Presence>
    </footer>
  );
}

function hasFileTransfer(dataTransfer) {
  if (!dataTransfer) return false;
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) {
    return items.some((item) => {
      if (item.kind !== 'file') return false;
      if (typeof item.webkitGetAsEntry !== 'function') return true;
      const entry = item.webkitGetAsEntry();
      return !entry || entry.isFile;
    });
  }
  return Array.from(dataTransfer.types ?? []).includes('Files');
}
