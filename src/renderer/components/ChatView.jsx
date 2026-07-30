import {
  ChevronLeft,
  ChevronRight,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Composer } from './Composer.jsx';
import { Message } from './Message.jsx';

function getModelDisplayName(models, modelId) {
  const model = models.find((item) => item.id === modelId);
  const identifier = model?.modelId ?? modelId;

  return model?.name ?? identifier?.slice(identifier.indexOf(':') + 1) ?? 'Model';
}

export function ChatView({
  currentConversation,
  currentMessages,
  currentModel,
  currentProject,
  contextUsage,
  recentModels,
  recentProjects,
  models,
  favorites,
  isRunning,
  onSend,
  onStop,
  onCompress,
  onCreateSideChat,
  subagents,
  onOpenSubagents,
  onFork,
  onRetry,
  onResume,
  onCancelQueued,
  onReorderQueued,
  onSteerQueued,
  onSendContinuation,
  onImplementPlan,
  questionRequest,
  onAnswerQuestion,
  onChooseModel,
  onChooseProject,
  onUseHome,
  onToggleFavorite,
  workMode,
  onWorkModeChange,
  ultraMode,
  onUltraModeChange,
  onGoalAction,
  pendingAttachment,
  onPendingAttachmentConsumed,
  onOpenFileReference,
  messageDeliveryMode = 'queue',
  compact = false,
  draftKey,
}) {
  const chatAreaRef = useRef(null);
  const composerRef = useRef(null);
  const scrollRef = useRef(null);
  const autoScrollTimerRef = useRef(null);
  const autoScrollTargetRef = useRef(null);
  const manualScrollDuringRunRef = useRef(false);
  const wasRunningRef = useRef(false);
  const dragDepthRef = useRef(0);
  const questionCardRef = useRef(null);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState([]);
  const [questionResolving, setQuestionResolving] = useState(false);
  const modelName = getModelDisplayName(models, currentModel);
  const queuedMessages = currentMessages
    .filter((message) => !message.hidden && ['queued', 'steered'].includes(message.status))
    .sort((a, b) => (
      (a.queuePosition ?? Number.MAX_SAFE_INTEGER)
      - (b.queuePosition ?? Number.MAX_SAFE_INTEGER)
      || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ));
  const visibleMessages = currentMessages
    .filter((message) => !message.hidden)
    .filter((message) => !['queued', 'steered'].includes(message.status));
  const lastAssistantMessage = visibleMessages.findLast((message) => message.role === 'assistant');
  const lastMessage = visibleMessages.at(-1);
  const isEmptyChat = visibleMessages.length === 0;
  const streamScrollKey = [
    currentConversation?.id ?? '',
    lastMessage?.id ?? '',
    lastMessage?.updatedAt ?? '',
    lastMessage?.content?.length ?? 0,
    questionRequest?.questionId ?? '',
  ].join(':');
  const Root = compact ? 'section' : 'main';
  const activeQuestion = questionRequest?.questions[questionIndex] ?? null;
  const allQuestionsAnswered = Boolean(
    questionRequest
    && questionRequest.questions.every((question, index) => (
      question.type === 'multiple_choice'
        ? questionAnswers[index]?.length > 0
        : Boolean(String(questionAnswers[index] ?? '').trim())
    )),
  );

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

  function handleDragEnter(event) {
    if (!hasFileTransfer(event.dataTransfer)) return;

    event.preventDefault();
    dragDepthRef.current += 1;
    setFileDropActive(true);
  }

  function handleDragOver(event) {
    if (!hasFileTransfer(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setFileDropActive(true);
  }

  function handleDragLeave(event) {
    if (!hasFileTransfer(event.dataTransfer)) return;

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setFileDropActive(false);
    }
  }

  function handleDrop(event) {
    if (!hasFileTransfer(event.dataTransfer)) return;

    event.preventDefault();
    dragDepthRef.current = 0;
    setFileDropActive(false);

    const files = droppedFileList(event.dataTransfer);
    if (files.length > 0) {
      setDroppedFiles({ id: crypto.randomUUID(), files });
    }
  }

  useEffect(() => {
    manualScrollDuringRunRef.current = false;
    scheduleScrollToBottom(0);

    return () => {
      window.clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    };
  }, [currentConversation?.id]);

  useEffect(() => {
    if (!isRunning) {
      scheduleScrollToBottom(0);
    }
  }, [currentConversation?.id, currentMessages.length, isRunning]);

  useEffect(() => {
    if (isRunning && !wasRunningRef.current) {
      manualScrollDuringRunRef.current = false;
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && !manualScrollDuringRunRef.current) {
      scheduleScrollToBottom();
    }
  }, [isRunning, streamScrollKey]);

  useEffect(() => {
    setQuestionIndex(0);
    setQuestionAnswers(questionRequest?.questions.map((question) => (
      question.type === 'multiple_choice' ? [] : ''
    )) ?? []);
    setQuestionResolving(false);
  }, [questionRequest?.questionId]);

  useEffect(() => {
    if (!questionRequest) return undefined;
    const frame = requestAnimationFrame(() => {
      questionCardRef.current
        ?.querySelector('[data-question-control]')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [questionIndex, questionRequest?.questionId]);

  useEffect(() => {
    if (!chatAreaRef.current || !composerRef.current) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const scrollElement = scrollRef.current;
      const distanceFromBottom = scrollElement
        ? scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
        : Number.POSITIVE_INFINITY;
      chatAreaRef.current?.style.setProperty(
        '--composer-clearance',
        `${Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)}px`,
      );
      if (distanceFromBottom <= 48) {
        requestAnimationFrame(scrollToBottom);
      }
    });
    observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [currentConversation?.id]);

  async function resolveQuestion(cancelled) {
    if (!questionRequest || questionResolving) return;
    setQuestionResolving(true);
    try {
      await onAnswerQuestion(
        questionRequest,
        questionRequest.questions.map((question, index) => ({
          question: question.question,
          answer: questionAnswers[index],
        })),
        cancelled,
      );
    } finally {
      setQuestionResolving(false);
    }
  }

  return (
    <Root
      ref={chatAreaRef}
      className={`chat-area ${compact ? 'auxiliary-chat-view' : ''} ${isEmptyChat ? 'chat-empty' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {fileDropActive && (
        <div className="file-drop-overlay">
          <div>
            <UploadCloud size={28} />
            <span>Drop files to attach</span>
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        className="chat-scroll"
        onScroll={(event) => {
          if (!isRunning) return;

          const scrollElement = event.currentTarget;
          const reachedBottom = (
            scrollElement.scrollHeight
            - scrollElement.scrollTop
            - scrollElement.clientHeight
          ) <= 24;
          const matchedAutoScroll = (
            autoScrollTargetRef.current !== null
            && Math.abs(scrollElement.scrollTop - autoScrollTargetRef.current) <= 1
          );
          autoScrollTargetRef.current = null;
          if (matchedAutoScroll) {
            manualScrollDuringRunRef.current = false;
            return;
          }

          manualScrollDuringRunRef.current = !reachedBottom;
          if (!reachedBottom) {
            window.clearTimeout(autoScrollTimerRef.current);
            autoScrollTimerRef.current = null;
          }
        }}
      >
        {isEmptyChat ? (
          <div className="empty-chat">
            <h1>How can I help you today?</h1>
          </div>
        ) : (
          <div className="messages-column">
            {visibleMessages.map((message) => (
              <Message
                key={message.id}
                message={message}
                modelName={getModelDisplayName(
                  models,
                  message.model || currentConversation?.model,
                )}
                onFork={() => onFork(currentConversation?.id, message.id)}
                onRetry={() => onRetry(message.id)}
                onResume={() => onResume(
                  message.id,
                  message.model || currentConversation?.model || currentModel,
                )}
                runActive={isRunning && message.id === lastAssistantMessage?.id}
                questionPending={Boolean(
                  questionRequest && message.id === lastAssistantMessage?.id,
                )}
                onSendContinuation={onSendContinuation}
                onImplementPlan={() => onImplementPlan?.()}
                onOpenFileReference={onOpenFileReference}
                showContinuations={message.id === lastAssistantMessage?.id}
              />
            ))}
            {questionRequest && activeQuestion && (
              <article
                className="message-row assistant-row question-inline-row"
                aria-live="polite"
              >
                <form
                  ref={questionCardRef}
                  className="question-card"
                  aria-labelledby={`question-card-title-${questionRequest.questionId}`}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    resolveQuestion(true);
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (allQuestionsAnswered) resolveQuestion(false);
                  }}
                >
                  <header className="question-card-header">
                    <span className="question-card-progress">
                      Question {questionIndex + 1} of {questionRequest.questions.length}
                    </span>
                    <div
                      id={`question-card-title-${questionRequest.questionId}`}
                      className="question-card-prompt"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {activeQuestion.question.replace(
                          /\s+(?=1\.\s+)/,
                          '\n\n',
                        ).replace(/\s+(?=[2-9]\d*\.\s+)/g, '\n')}
                      </ReactMarkdown>
                    </div>
                  </header>
                  <fieldset className="question-card-field">
                    <legend className="sr-only">{activeQuestion.question}</legend>
                    {activeQuestion.type === 'free_text' ? (
                      <textarea
                        data-question-control
                        value={questionAnswers[questionIndex] ?? ''}
                        rows={4}
                        aria-label={activeQuestion.question}
                        disabled={questionResolving}
                        onChange={(event) => setQuestionAnswers((state) => {
                          const next = [...state];
                          next[questionIndex] = event.target.value;
                          return next;
                        })}
                      />
                    ) : (
                      <div className="question-card-options">
                        {activeQuestion.options.map((option, optionIndex) => {
                          const inputId = `question-${questionRequest.questionId}-${questionIndex}-${optionIndex}`;
                          const checked = activeQuestion.type === 'multiple_choice'
                            ? questionAnswers[questionIndex]?.includes(option)
                            : questionAnswers[questionIndex] === option;
                          return (
                            <label
                              key={`${option}:${optionIndex}`}
                              className="question-card-option"
                              htmlFor={inputId}
                            >
                              <input
                                id={inputId}
                                data-question-control={optionIndex === 0 ? '' : undefined}
                                type={activeQuestion.type === 'multiple_choice'
                                  ? 'checkbox'
                                  : 'radio'}
                                name={`question-${questionRequest.questionId}-${questionIndex}`}
                                value={option}
                                checked={checked}
                                disabled={questionResolving}
                                onChange={(event) => setQuestionAnswers((state) => {
                                  const next = [...state];
                                  if (activeQuestion.type === 'multiple_choice') {
                                    const selected = new Set(next[questionIndex] ?? []);
                                    if (event.target.checked) {
                                      selected.add(option);
                                    } else {
                                      selected.delete(option);
                                    }
                                    next[questionIndex] = [...selected];
                                  } else {
                                    next[questionIndex] = option;
                                  }
                                  return next;
                                })}
                              />
                              <span className="question-card-option-copy">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{ p: 'span' }}
                                >
                                  {option}
                                </ReactMarkdown>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </fieldset>
                  <footer className="question-card-footer">
                    <button
                      className="question-card-cancel"
                      type="button"
                      disabled={questionResolving}
                      onClick={() => resolveQuestion(true)}
                    >
                      Cancel
                    </button>
                    <nav
                      className="question-card-pagination"
                      aria-label="Question navigation"
                    >
                      {questionRequest.questions.map((question, index) => {
                        const answered = question.type === 'multiple_choice'
                          ? questionAnswers[index]?.length > 0
                          : Boolean(String(questionAnswers[index] ?? '').trim());
                        return (
                          <button
                            key={`${questionRequest.questionId}:${index}`}
                            className={[
                              index === questionIndex && 'active',
                              answered && 'answered',
                            ].filter(Boolean).join(' ')}
                            type="button"
                            disabled={questionResolving}
                            aria-label={`Go to question ${index + 1}`}
                            aria-current={index === questionIndex ? 'step' : undefined}
                            onClick={() => setQuestionIndex(index)}
                          >
                            <span>{index + 1}</span>
                          </button>
                        );
                      })}
                    </nav>
                    <div className="question-card-actions">
                      <button
                        type="button"
                        disabled={questionResolving || questionIndex === 0}
                        onClick={() => setQuestionIndex((index) => index - 1)}
                      >
                        <ChevronLeft size={14} aria-hidden="true" />
                        <span>Previous</span>
                      </button>
                      {questionIndex < questionRequest.questions.length - 1 ? (
                        <button
                          className="primary-mini"
                          type="button"
                          disabled={questionResolving}
                          onClick={() => setQuestionIndex((index) => index + 1)}
                        >
                          <span>Next</span>
                          <ChevronRight size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          className="primary-mini"
                          type="submit"
                          disabled={questionResolving || !allQuestionsAnswered}
                        >
                          {questionResolving ? 'Submitting...' : 'Submit answers'}
                        </button>
                      )}
                    </div>
                  </footer>
                </form>
              </article>
            )}
          </div>
        )}
      </div>
      <Composer
        containerRef={composerRef}
        isRunning={isRunning}
        onSend={onSend}
        onStop={onStop}
        onCompress={onCompress}
        onCreateSideChat={onCreateSideChat}
        subagents={subagents}
        onOpenSubagents={onOpenSubagents}
        queuedMessages={queuedMessages}
        onCancelQueued={onCancelQueued}
        onReorderQueued={onReorderQueued}
        onSteerQueued={onSteerQueued}
        droppedFiles={droppedFiles}
        modelName={modelName}
        recentModels={recentModels}
        recentProjects={recentProjects}
        models={models}
        favorites={favorites}
        currentModel={currentModel}
        contextUsage={contextUsage}
        onChooseModel={onChooseModel}
        project={currentProject}
        projectLocked={Boolean(currentConversation)}
        onChooseProject={onChooseProject}
        onUseHome={onUseHome}
        onToggleFavorite={onToggleFavorite}
        workMode={workMode}
        onWorkModeChange={(nextWorkMode) => (
          onWorkModeChange(nextWorkMode, currentConversation?.id)
        )}
        ultraMode={ultraMode}
        onUltraModeChange={onUltraModeChange}
        goal={currentConversation?.goal}
        onGoalAction={onGoalAction}
        pendingAttachment={pendingAttachment}
        onPendingAttachmentConsumed={onPendingAttachmentConsumed}
        messageDeliveryMode={messageDeliveryMode}
        draftKey={draftKey}
      />
    </Root>
  );
}

function hasFileTransfer(dataTransfer) {
  if (!dataTransfer) return false;

  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) {
    return items.some((item) => isFileItem(item));
  }

  return Array.from(dataTransfer.types ?? []).includes('Files');
}

function isFileItem(item) {
  if (item.kind !== 'file') return false;
  if (typeof item.webkitGetAsEntry !== 'function') return true;

  const entry = item.webkitGetAsEntry();
  return !entry || entry.isFile;
}

function droppedFileList(dataTransfer) {
  return Array.from(dataTransfer.files ?? []).filter((file) => file instanceof File);
}
