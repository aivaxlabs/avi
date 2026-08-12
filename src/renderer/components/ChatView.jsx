import {
  ChevronLeft,
  ChevronRight,
  MessageSquarePlus,
  MessagesSquare,
  UploadCloud,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Composer } from './Composer.jsx';
import { groupAssistantTurns } from '../lib/message-groups.js';
import { Message } from './Message.jsx';

const emptyChatBackgroundShader = `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  pixelRatio: f32,
  primary: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn glow(point: vec2f, center: vec2f, spread: f32) -> f32 {
  let offset = point - center;
  return exp(-dot(offset, offset) * spread);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let resolution = max(uniforms.resolution, vec2f(1.0));
  let uv = position.xy / resolution;
  let aspect = resolution.x / resolution.y;
  let point = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  let drift = uniforms.time * 0.11;

  let primaryCenter = vec2f(
    sin(drift) * 0.18,
    0.27 + cos(drift * 0.73) * 0.035,
  );
  let secondaryCenter = vec2f(
    -0.48 + cos(drift * 0.61) * 0.12,
    0.16 + sin(drift * 0.47) * 0.08,
  );
  let tertiaryCenter = vec2f(
    0.5 + sin(drift * 0.53) * 0.1,
    0.08 + cos(drift * 0.39) * 0.07,
  );

  let primaryGlow = glow(point, primaryCenter, 4.8);
  let secondaryGlow = glow(point, secondaryCenter, 7.5);
  let tertiaryGlow = glow(point, tertiaryCenter, 8.5);
  let primary = uniforms.primary.rgb;
  let secondary = mix(primary, primary.gbr, 0.68);
  let tertiary = mix(primary, primary.brg, 0.62);

  let spacing = 24.0 * uniforms.pixelRatio;
  let cell = (fract(position.xy / spacing) - vec2f(0.5)) * spacing;
  let dot = 1.0 - smoothstep(
    0.75 * uniforms.pixelRatio,
    1.5 * uniforms.pixelRatio,
    length(cell),
  );
  let gridField = smoothstep(
    0.08,
    0.72,
    primaryGlow + secondaryGlow * 0.28 + tertiaryGlow * 0.2,
  );

  let primaryWeight = primaryGlow * 0.09;
  let secondaryWeight = secondaryGlow * 0.014;
  let tertiaryWeight = tertiaryGlow * 0.01;
  let dotWeight = dot * gridField * 0.04;
  let alpha = min(
    primaryWeight + secondaryWeight + tertiaryWeight + dotWeight,
    0.15,
  );
  let color = primary * primaryWeight
    + secondary * secondaryWeight
    + tertiary * tertiaryWeight
    + mix(primary, vec3f(1.0), 0.16) * dotWeight;

  return vec4f(color, alpha);
}
`;

function getModelDisplayName(models, modelId) {
  const model = models.find((item) => item.id === modelId);
  const identifier = model?.modelId ?? modelId;

  return model?.name ?? identifier?.slice(identifier.indexOf(':') + 1) ?? 'Model';
}

export const ChatView = memo(function ChatView({
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
  onMentionSelection,
  onAskSelection,
  subagents,
  tasks = [],
  onOpenTasks,
  onOpenSubagents,
  onFork,
  onRetry,
  onResume,
  onCancelQueued,
  onReorderQueued,
  onSteerQueued,
  onSendContinuation,
  onUndoEdits,
  onOpenFileEdit,
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
  goalPreparation,
  onGoalAction,
  pendingAttachment,
  onPendingAttachmentConsumed,
  onOpenFileReference,
  onFileReferenceAction,
  messageDeliveryMode = 'queue',
  defaultPermissionMode = 'approve_for_me',
  compact = false,
  draftKey,
  emptyBackgroundEnabled = true,
  emptyBackgroundThemeKey,
}) {
  const chatAreaRef = useRef(null);
  const composerRef = useRef(null);
  const emptyBackgroundRef = useRef(null);
  const scrollRef = useRef(null);
  const autoScrollTimerRef = useRef(null);
  const autoScrollTargetRef = useRef(null);
  const manualScrollDuringRunRef = useRef(false);
  const wasRunningRef = useRef(false);
  const dragDepthRef = useRef(0);
  const questionCardRef = useRef(null);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);
  const [selectionAction, setSelectionAction] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState([]);
  const [questionCustomAnswers, setQuestionCustomAnswers] = useState([]);
  const [questionCustomActive, setQuestionCustomActive] = useState([]);
  const [questionResolving, setQuestionResolving] = useState(false);
  const modelName = getModelDisplayName(models, currentModel);
  const pendingMessages = currentMessages
    .filter((message) => !message.hidden && ['queued', 'steered'].includes(message.status));
  const byQueuePosition = (a, b) => (
    (a.queuePosition ?? Number.MAX_SAFE_INTEGER)
    - (b.queuePosition ?? Number.MAX_SAFE_INTEGER)
    || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const steeredMessages = pendingMessages
    .filter((message) => message.status === 'steered')
    .sort(byQueuePosition);
  const queuedMessages = pendingMessages
    .filter((message) => message.status === 'queued')
    .sort(byQueuePosition);
  const visibleMessages = currentMessages
    .filter((message) => !message.hidden)
    .filter((message) => !['queued', 'steered'].includes(message.status));
  const groupedMessages = groupAssistantTurns(visibleMessages);
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
    && questionRequest.questions.every((question, index) => {
      if (question.type === 'free_text') {
        return Boolean(String(questionAnswers[index] ?? '').trim());
      }
      if (questionCustomActive[index]) {
        return Boolean(String(questionCustomAnswers[index] ?? '').trim());
      }
      return question.type === 'multiple_choice'
        ? questionAnswers[index]?.length > 0
        : Boolean(String(questionAnswers[index] ?? '').trim());
    }),
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
    setQuestionCustomAnswers(questionRequest?.questions.map(() => '') ?? []);
    setQuestionCustomActive(questionRequest?.questions.map(() => false) ?? []);
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

  useEffect(() => {
    const canvas = emptyBackgroundRef.current;
    if (!canvas || compact || !emptyBackgroundEnabled || !isEmptyChat) return undefined;

    canvas.width = canvas.width;
    canvas.removeAttribute('data-webgpu-ready');
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!navigator.gpu || reducedMotionQuery.matches) {
      return undefined;
    }

    let cancelled = false;
    let device = null;
    let frameId = null;
    let timeoutId = null;
    let resizeObserver = null;
    let resizeCanvas = null;
    let handleVisibilityChange = null;
    let handleReducedMotionChange = null;

    const stopRendering = ({ preserveFrame = true, destroyDelay = 0 } = {}) => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      timeoutId = null;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      resizeObserver?.disconnect();
      if (resizeCanvas) window.removeEventListener('resize', resizeCanvas);
      if (handleVisibilityChange) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (handleReducedMotionChange) {
        reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
      }
      if (!preserveFrame) canvas.removeAttribute('data-webgpu-ready');

      const activeDevice = device;
      device = null;
      if (!activeDevice) return;
      if (destroyDelay > 0) {
        window.setTimeout(() => activeDevice.destroy(), destroyDelay);
      } else {
        activeDevice.destroy();
      }
    };

    handleReducedMotionChange = (event) => {
      if (event.matches) stopRendering({ preserveFrame: false });
    };
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);

    (async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
        if (!adapter || cancelled) return;

        device = await adapter.requestDevice();
        if (cancelled) {
          device.destroy();
          return;
        }

        const context = canvas.getContext('webgpu');
        if (!context) {
          device.destroy();
          return;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        const shader = device.createShaderModule({ code: emptyChatBackgroundShader });
        const pipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: shader, entryPoint: 'vertexMain' },
          fragment: {
            module: shader,
            entryPoint: 'fragmentMain',
            targets: [{ format }],
          },
          primitive: { topology: 'triangle-list' },
        });
        const uniformBuffer = device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        });
        const uniformValues = new Float32Array(8);
        const primaryColor = getComputedStyle(document.documentElement)
          .getPropertyValue('--primary-color')
          .trim();
        const primaryHex = primaryColor.match(/^#([\da-f]{6})$/i)?.[1] ?? 'b97900';
        const primaryNumber = Number.parseInt(primaryHex, 16);
        uniformValues.set([
          ((primaryNumber >> 16) & 255) / 255,
          ((primaryNumber >> 8) & 255) / 255,
          (primaryNumber & 255) / 255,
          1,
        ], 4);

        resizeCanvas = () => {
          const bounds = canvas.getBoundingClientRect();
          const cssWidth = Math.max(1, bounds.width);
          const cssHeight = Math.max(1, bounds.height);
          const deviceScale = Math.min(window.devicePixelRatio || 1, 1.5);
          const pixelCapScale = Math.sqrt(1_800_000 / (cssWidth * cssHeight));
          const renderScale = Math.min(deviceScale, pixelCapScale);
          const width = Math.max(1, Math.round(cssWidth * renderScale));
          const height = Math.max(1, Math.round(cssHeight * renderScale));

          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          uniformValues[0] = width;
          uniformValues[1] = height;
          uniformValues[3] = renderScale;
        };

        resizeCanvas();
        context.configure({ device, format, alphaMode: 'premultiplied' });
        resizeObserver = new ResizeObserver(resizeCanvas);
        resizeObserver.observe(canvas);
        window.addEventListener('resize', resizeCanvas);

        const startedAt = performance.now();
        const renderFrame = (timestamp) => {
          frameId = null;
          if (cancelled || document.hidden) return;

          try {
            uniformValues[2] = (timestamp - startedAt) / 1000;
            device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
            const commandEncoder = device.createCommandEncoder();
            const pass = commandEncoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
              }],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
            pass.end();
            device.queue.submit([commandEncoder.finish()]);
            canvas.setAttribute('data-webgpu-ready', 'true');
          } catch {
            stopRendering({ preserveFrame: false });
            return;
          }

          timeoutId = window.setTimeout(() => {
            timeoutId = null;
            if (!cancelled && !document.hidden) {
              frameId = requestAnimationFrame(renderFrame);
            }
          }, 1000 / 12);
        };

        handleVisibilityChange = () => {
          window.clearTimeout(timeoutId);
          timeoutId = null;
          if (frameId !== null) cancelAnimationFrame(frameId);
          frameId = null;
          if (!cancelled && !document.hidden) {
            frameId = requestAnimationFrame(renderFrame);
          }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        device.lost.then(() => {
          if (!cancelled) stopRendering({ preserveFrame: false });
        });
        frameId = requestAnimationFrame(renderFrame);

      } catch {
        if (!cancelled) stopRendering({ preserveFrame: false });
      }
    })();

    return () => stopRendering({ destroyDelay: 1800 });
  }, [compact, emptyBackgroundEnabled, emptyBackgroundThemeKey, isEmptyChat]);

  useEffect(() => {
    if (!selectionAction) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.selection-action-group')) return;
      setSelectionAction(null);
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setSelectionAction(null);
      window.getSelection()?.removeAllRanges();
    }, { signal: controller.signal });
    window.addEventListener('resize', () => setSelectionAction(null), {
      once: true,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [selectionAction]);

  const updateSelectionAction = () => {
    const selection = window.getSelection();
    if (
      (!onMentionSelection && !onAskSelection)
      || !selection
      || selection.rangeCount === 0
      || selection.isCollapsed
    ) {
      setSelectionAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
    const endElement = range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : range.endContainer;
    const startMessage = startElement?.closest?.('.message-row');
    const endMessage = endElement?.closest?.('.message-row');
    if (
      !startMessage
      || startMessage !== endMessage
      || !chatAreaRef.current?.contains(startMessage)
      || startElement?.closest?.('button, input, textarea, [contenteditable="true"]')
      || endElement?.closest?.('button, input, textarea, [contenteditable="true"]')
    ) {
      setSelectionAction(null);
      return;
    }

    const content = selection.toString().trim();
    if (!content) {
      setSelectionAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const width = 276;
    const height = 34;
    const above = rect.top - height - 8;
    setSelectionAction({
      content,
      left: Math.max(8, Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - 8,
      )),
      top: above >= 8 ? above : Math.min(window.innerHeight - height - 8, rect.bottom + 8),
    });
  };

  const useSelection = (callback) => {
    if (!selectionAction || !callback) return;
    const escapedContent = selectionAction.content
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    callback({
      id: crypto.randomUUID(),
      kind: 'context_marker',
      markerType: 'citation',
      name: 'Chat citation',
      size: 0,
      text: `<citation>${escapedContent}</citation>`,
    });
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  };

  async function resolveQuestion(cancelled) {
    if (!questionRequest || questionResolving) return;
    setQuestionResolving(true);
    try {
      await onAnswerQuestion(
        questionRequest,
        questionRequest.questions.map((question, index) => ({
          question: question.question,
          answer: questionCustomActive[index]
            ? question.type === 'multiple_choice'
              ? [...questionAnswers[index], questionCustomAnswers[index].trim()]
              : questionCustomAnswers[index].trim()
            : questionAnswers[index],
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
      {!compact && emptyBackgroundEnabled && (
        <canvas
          ref={emptyBackgroundRef}
          className="empty-chat-background"
          aria-hidden="true"
        />
      )}
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
        onMouseUp={updateSelectionAction}
        onKeyUp={updateSelectionAction}
        onScroll={(event) => {
          setSelectionAction(null);
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
            {groupedMessages.map(({ message, workedMessages, workedStartedAt }) => (
                <Message
                  key={message.id}
                  message={message}
                  workedMessages={workedMessages}
                  workedStartedAt={workedStartedAt}
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
                  onUndoEdits={onUndoEdits}
                  onOpenFileEdit={onOpenFileEdit}
                  onImplementPlan={(options) => onImplementPlan?.(options)}
                  onOpenFileReference={onOpenFileReference}
                  onFileReferenceAction={onFileReferenceAction}
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
                            : questionAnswers[questionIndex] === option
                              && !questionCustomActive[questionIndex];
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
                                onClick={() => {
                                  if (activeQuestion.type !== 'single_choice') return;
                                  setQuestionCustomActive((state) => {
                                    const next = [...state];
                                    next[questionIndex] = false;
                                    return next;
                                  });
                                }}
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
                        <div className="question-card-custom-option">
                          <label className="question-card-option">
                            <input
                              type={activeQuestion.type === 'multiple_choice'
                                ? 'checkbox'
                                : 'radio'}
                              name={`question-${questionRequest.questionId}-${questionIndex}`}
                              checked={Boolean(questionCustomActive[questionIndex])}
                              disabled={questionResolving}
                              onChange={(event) => setQuestionCustomActive((state) => {
                                const next = [...state];
                                next[questionIndex] = event.target.checked;
                                return next;
                              })}
                            />
                            <span className="question-card-option-copy">Other</span>
                          </label>
                          {questionCustomActive[questionIndex] && (
                            <input
                              className="question-card-custom-input"
                              type="text"
                              value={questionCustomAnswers[questionIndex] ?? ''}
                              placeholder="Type your answer"
                              aria-label={`${activeQuestion.question} — custom answer`}
                              disabled={questionResolving}
                              autoFocus
                              onChange={(event) => setQuestionCustomAnswers((state) => {
                                const next = [...state];
                                next[questionIndex] = event.target.value;
                                return next;
                              })}
                            />
                          )}
                        </div>
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
                        const answered = questionCustomActive[index]
                          ? Boolean(String(questionCustomAnswers[index] ?? '').trim())
                          : question.type === 'multiple_choice'
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
        conversationId={currentConversation?.id ?? null}
        isRunning={isRunning}
        onSend={onSend}
        onStop={onStop}
        onCompress={onCompress}
        onCreateSideChat={onCreateSideChat}
        subagents={subagents}
        tasks={tasks}
        onOpenTasks={onOpenTasks}
        onOpenSubagents={onOpenSubagents}
        steeredMessages={steeredMessages}
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
        onUltraModeChange={(enabled) => (
          onUltraModeChange(enabled, currentConversation?.id)
        )}
        goal={currentConversation?.goal}
        goalPreparation={goalPreparation}
        onGoalAction={onGoalAction}
        pendingAttachment={pendingAttachment}
        onPendingAttachmentConsumed={onPendingAttachmentConsumed}
        messageDeliveryMode={messageDeliveryMode}
        draftKey={draftKey}
        autoFocus={!currentConversation || Boolean(currentConversation.isSideChat)}
        defaultPermissionMode={defaultPermissionMode}
      />
      {selectionAction && createPortal(
        <div
          className="selection-action-group"
          role="toolbar"
          aria-label="Selected text actions"
          style={{ left: selectionAction.left, top: selectionAction.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {onMentionSelection && (
            <button type="button" onClick={() => useSelection(onMentionSelection)}>
              <MessageSquarePlus size={13} aria-hidden="true" />
              <span>Mention on Chat</span>
            </button>
          )}
          {onAskSelection && (
            <button type="button" onClick={() => useSelection(onAskSelection)}>
              <MessagesSquare size={13} aria-hidden="true" />
              <span>Ask in Side Chat</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </Root>
  );
}, (previous, next) => {
  const allProps = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...allProps].every((property) => {
    if (property === 'currentProject') {
      return previous[property] === next[property] || (
        previous[property]?.path === next[property]?.path
        && previous[property]?.name === next[property]?.name
        && previous[property]?.displayPath === next[property]?.displayPath
        && previous[property]?.gitBranch === next[property]?.gitBranch
      );
    }
    if (property === 'recentProjects') {
      const previousProjects = previous[property] ?? [];
      const nextProjects = next[property] ?? [];
      return previousProjects.length === nextProjects.length
        && previousProjects.every((project, index) => (
          project.path === nextProjects[index]?.path
          && project.name === nextProjects[index]?.name
          && project.displayPath === nextProjects[index]?.displayPath
          && project.gitBranch === nextProjects[index]?.gitBranch
        ));
    }
    if (property === 'subagents') {
      const previousSubagents = previous[property] ?? [];
      const nextSubagents = next[property] ?? [];
      return previousSubagents.length === nextSubagents.length
        && previousSubagents.every((subagent, index) => (
          subagent.id === nextSubagents[index]?.id
          && subagent.status === nextSubagents[index]?.status
          && subagent.title === nextSubagents[index]?.title
          && subagent.firstPrompt === nextSubagents[index]?.firstPrompt
        ));
    }
    if (property === 'recentModels') {
      const previousModels = previous[property] ?? [];
      const nextModels = next[property] ?? [];
      return previousModels.length === nextModels.length
        && previousModels.every((model, index) => model === nextModels[index]);
    }
    return Object.is(previous[property], next[property]);
  });
});

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
