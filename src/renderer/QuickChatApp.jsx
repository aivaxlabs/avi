import { ArrowUp, ChevronDown, Mic, Paperclip, Square, UploadCloud, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createMp3Attachment } from './lib/audio.js';
import { fileToAttachment, formatBytes, textToAttachment } from './lib/files.js';
import { Message } from './components/Message.jsx';
import { ModelPicker } from './components/ModelPicker.jsx';
import { applyTheme, readAppearance } from './lib/apply-theme.js';
import { setPluginThemes } from './lib/themes.js';

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
  const scrollRef = useRef(null);
  const messagesColumnRef = useRef(null);
  const autoScrollTimerRef = useRef(null);
  const autoScrollTargetRef = useRef(null);
  const manualScrollDuringRunRef = useRef(false);
  const wasRunningRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const dragDepthRef = useRef(0);

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
      } else if (event.type === 'error') {
        setError(event.message);
      }
    });
  }, []);

  const lastMessage = messages.at(-1);
  const streamScrollKey = [
    lastMessage?.id ?? '',
    lastMessage?.updatedAt ?? '',
    lastMessage?.content?.length ?? 0,
    questionRequest?.questionId ?? '',
  ].join(':');

  function scrollToBottom() {
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      const target = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      autoScrollTargetRef.current = target;
      scrollElement.scrollTop = target;
    }
  }

  function scheduleScrollToBottom(delay = 50) {
    if (autoScrollTimerRef.current !== null) return;

    autoScrollTimerRef.current = window.setTimeout(() => {
      autoScrollTimerRef.current = null;
      requestAnimationFrame(scrollToBottom);
    }, delay);
  }

  useEffect(() => {
    scheduleScrollToBottom(0);

    return () => {
      window.clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!running) scheduleScrollToBottom(0);
  }, [messages.length, running]);

  useEffect(() => {
    if (running && !wasRunningRef.current) {
      manualScrollDuringRunRef.current = false;
    }
    wasRunningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (running && !manualScrollDuringRunRef.current) {
      scheduleScrollToBottom();
    }
  }, [running, streamScrollKey]);

  useEffect(() => {
    const column = messagesColumnRef.current;
    if (!column) return undefined;
    if (!running) {
      lastScrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
      return undefined;
    }

    let frame = null;
    const observer = new ResizeObserver(() => {
      if (manualScrollDuringRunRef.current) return;
      if (autoScrollTimerRef.current !== null) return;
      autoScrollTimerRef.current = window.setTimeout(() => {
        autoScrollTimerRef.current = null;
        frame = requestAnimationFrame(scrollToBottom);
      }, 16);
    });
    observer.observe(column);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (autoScrollTimerRef.current !== null) {
        window.clearTimeout(autoScrollTimerRef.current);
        autoScrollTimerRef.current = null;
      }
    };
  }, [running]);

  const selectedModel = models.find((item) => item.id === model);
  const modelName = selectedModel?.name ?? selectedModel?.modelId ?? 'Choose model';

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
      <section
        className="quick-chat-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const scrollElement = event.currentTarget;
          const previousScrollTop = lastScrollTopRef.current;
          const currentScrollTop = scrollElement.scrollTop;
          const scrollTopDelta = currentScrollTop - previousScrollTop;
          lastScrollTopRef.current = currentScrollTop;

          if (!running) return;

          const distanceFromBottom = scrollElement.scrollHeight
            - currentScrollTop
            - scrollElement.clientHeight;
          const matchedAutoScroll = (
            autoScrollTargetRef.current !== null
            && Math.abs(currentScrollTop - autoScrollTargetRef.current) <= 24
          );
          autoScrollTargetRef.current = null;
          if (matchedAutoScroll) {
            manualScrollDuringRunRef.current = false;
            return;
          }

          const userScrolledUp = scrollTopDelta < 0;
          if (userScrolledUp && distanceFromBottom > 24) {
            manualScrollDuringRunRef.current = true;
            window.clearTimeout(autoScrollTimerRef.current);
            autoScrollTimerRef.current = null;
          } else {
            manualScrollDuringRunRef.current = false;
            if (distanceFromBottom <= 24) {
              scheduleScrollToBottom(0);
            }
          }
        }}
      >
        {messages.length === 0 ? (
          <div className="quick-chat-empty">
            <strong>What can I help with?</strong>
            <span>This conversation disappears when you close the window.</span>
          </div>
        ) : (
          <div className="quick-chat-messages" ref={messagesColumnRef}>
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
          <QuickQuestion
            request={questionRequest}
            onResolve={(answers, cancelled = false) => {
              api.quickChat.answerQuestion({
                sessionId,
                questionId: questionRequest.questionId,
                answers,
                cancelled,
              });
              setQuestionRequest(null);
            }}
          />
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
    if (recording) {
      recording.recorder.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      const attachment = await createMp3Attachment(chunks);
      setAttachments((current) => [...current, attachment]);
      setRecording(null);
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
            aria-label={recording ? 'Stop recording' : 'Record audio'}
            title={recording ? 'Stop recording' : 'Record audio'}
            onClick={() => void toggleRecording()}
          >
            {recording ? <Square size={15} /> : <Mic size={18} />}
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
      {pickerOpen && (
        <ModelPicker
          models={models}
          favorites={favorites}
          currentModel={model}
          onClose={() => setPickerOpen(false)}
          onChoose={onChooseModel}
          onToggleFavorite={onToggleFavorite}
        />
      )}
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

function QuickQuestion({ request, onResolve }) {
  const [answers, setAnswers] = useState(() => request.questions.map((question) => (
    question.type === 'multiple_choice' ? [] : ''
  )));
  const [customAnswers, setCustomAnswers] = useState(() => request.questions.map(() => ''));
  const [customActive, setCustomActive] = useState(() => request.questions.map(() => false));
  const complete = useMemo(() => request.questions.every((question, index) => {
    if (question.type === 'free_text') return Boolean(answers[index]?.trim());
    if (customActive[index]) return Boolean(customAnswers[index]?.trim());
    return question.type === 'multiple_choice'
      ? answers[index]?.length > 0
      : Boolean(answers[index]);
  }), [answers, customActive, customAnswers, request.questions]);

  return (
    <form className="quick-question" onSubmit={(event) => {
      event.preventDefault();
      if (!complete) return;
      onResolve(request.questions.map((question, index) => ({
        question: question.question,
        answer: customActive[index]
          ? question.type === 'multiple_choice'
            ? [...answers[index], customAnswers[index].trim()]
            : customAnswers[index].trim()
          : answers[index],
      })));
    }}>
      {request.questions.map((question, index) => (
        <fieldset key={`${question.question}:${index}`}>
          <legend>{question.question}</legend>
          {question.type === 'free_text' ? (
            <textarea value={answers[index]} onChange={(event) => setAnswers((current) => {
              const next = [...current];
              next[index] = event.target.value;
              return next;
            })} />
          ) : (
            <div className="quick-question-options">
              {question.options.map((option) => (
                <label key={option}>
                  <input
                    type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                    name={`question-${index}`}
                    checked={question.type === 'multiple_choice'
                      ? answers[index]?.includes(option)
                      : answers[index] === option && !customActive[index]}
                    onChange={(event) => {
                      if (question.type === 'single_choice') {
                        setCustomActive((current) => {
                          const next = [...current];
                          next[index] = false;
                          return next;
                        });
                      }
                      setAnswers((current) => {
                        const next = [...current];
                        if (question.type === 'multiple_choice') {
                          const selected = new Set(next[index] || []);
                          if (event.target.checked) selected.add(option);
                          else selected.delete(option);
                          next[index] = [...selected];
                        } else next[index] = option;
                        return next;
                      });
                    }}
                  />
                  {option}
                </label>
              ))}
              <label>
                <input
                  type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                  name={`question-${index}`}
                  checked={customActive[index]}
                  onChange={(event) => setCustomActive((current) => {
                    const next = [...current];
                    next[index] = event.target.checked;
                    return next;
                  })}
                />
                Other
              </label>
              {customActive[index] && (
                <input
                  className="quick-question-custom-input"
                  type="text"
                  value={customAnswers[index]}
                  placeholder="Type your answer"
                  aria-label={`${question.question} — custom answer`}
                  autoFocus
                  onChange={(event) => setCustomAnswers((current) => {
                    const next = [...current];
                    next[index] = event.target.value;
                    return next;
                  })}
                />
              )}
            </div>
          )}
        </fieldset>
      ))}
      <div>
        <button type="button" onClick={() => onResolve([], true)}>Cancel</button>
        <button type="submit" disabled={!complete}>Continue</button>
      </div>
    </form>
  );
}
