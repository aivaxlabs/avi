import {
  Check,
  Folder,
  MessageCircleQuestionMark,
  MessageSquarePlus,
  MessagesSquare,
  Moon,
  PencilLine,
  ShieldCheck,
  ShieldQuestion,
  UploadCloud,
  Wrench,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatFind } from './ChatFind.jsx';
import { Composer } from './Composer.jsx';
import { EmptyChatSummary } from './EmptyChatSummary.jsx';
import { areComposerPropsEqual } from '../lib/composer-props.js';
import { consolidateFileEdits } from '../lib/file-edits.js';
import {
  groupAssistantTurns,
  isHumanUserMessage,
  isTurnDelimiterMessage,
  startIndexForRecentHumanMessages,
} from '../lib/message-groups.js';
import { areMessageRowPropsEqual } from '../lib/message-row-props.js';
import {
  canResumeAssistantMessage,
  canRetryAssistantMessage,
} from '../lib/message-actions.js';
import { useStreamingAutoScroll } from '../lib/use-streaming-auto-scroll.js';
import { Message } from './Message.jsx';
import { MessageMarkers } from './MessageMarkers.jsx';
import { Overlay, Presence } from './Overlay.jsx';
import { QuestionForm } from './QuestionForm.jsx';

const HISTORY_BATCH_SIZE = 4;
const HISTORY_LOAD_THRESHOLD = 80;
const MESSAGE_MARKERS_MIN_WIDTH = 900;

const MessageRow = memo(function MessageRow({
  message,
  editing,
  editor,
  workedMessages,
  workedStartedAt,
  modelName,
  resumeModel,
  conversationId,
  onEdit,
  onFork,
  onRetry,
  onResume,
  runActive,
  questionPending,
  onSendContinuation,
  onUndoEdits,
  onOpenFileEdit,
  onImplementPlan,
  onOpenFileReference,
  onFileReferenceAction,
  showContinuations,
  canRetry,
  canResume,
}) {
  return (
    <Message
      message={message}
      editing={editing}
      onEdit={onEdit ? () => onEdit(message.id) : undefined}
      editor={editor}
      workedMessages={workedMessages}
      workedStartedAt={workedStartedAt}
      modelName={modelName}
      onFork={() => onFork(conversationId, message.id)}
      onRetry={() => onRetry(message.id)}
      onResume={() => onResume(message.id, resumeModel)}
      runActive={runActive}
      questionPending={questionPending}
      onSendContinuation={onSendContinuation}
      onUndoEdits={onUndoEdits}
      onOpenFileEdit={onOpenFileEdit}
      onImplementPlan={onImplementPlan}
      onOpenFileReference={onOpenFileReference}
      onFileReferenceAction={onFileReferenceAction}
      showContinuations={showContinuations}
      canRetry={canRetry}
      canResume={canResume}
    />
  );
}, areMessageRowPropsEqual);

const MemoizedComposer = memo(Composer, areComposerPropsEqual);

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
  let dotWeight = dot * gridField * 0.06;
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
  messagesLoaded = true,
  historyHasMore = false,
  historyLoading = false,
  onLoadOlderHistory,
  currentModel,
  currentProject,
  contextUsage,
  recentProjects,
  models,
  favorites,
  intelligenceLevels = [],
  isRunning,
  semaphoreWait,
  onRunSemaphoreNow,
  onCancelSemaphore,
  semaphoreResolving = false,
  onSend,
  onReplaceUserMessage,
  onExpandPrompt,
  onStop,
  onQuickCompress,
  onCompress,
  onCreateSideChat,
  onMentionSelection,
  onAskSelection,
  onQuickQuestion,
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
  approvalRequests = [],
  onResolveApproval,
  onChooseModel,
  botMode = false,
  bots,
  botDataByBot,
  botsLoading,
  botsError,
  onOpenInbox,
  onShowBotInPanel,
  onChooseProject,
  allowProjectChange = false,
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
  continuationRepliesEnabled = true,
  composerFloat = null,
  emptyHint = '',
  homeEmpty = true,
  compact = false,
  emptyBackgroundEnabled = true,
  emptyBackgroundThemeKey,
  backgroundUrl = null,
  backgroundBlendMode = 'screen',
  backgroundOpacity = 0.2,
}) {
  const chatAreaRef = useRef(null);
  const composerRef = useRef(null);
  const emptyBackgroundRef = useRef(null);
  const dragDepthRef = useRef(0);
  const approvalCardRef = useRef(null);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [markersFit, setMarkersFit] = useState(true);
  const [droppedFiles, setDroppedFiles] = useState(null);
  const [selectionAction, setSelectionAction] = useState(null);
  const [selectionAnnotation, setSelectionAnnotation] = useState('');
  const [approvalResolving, setApprovalResolving] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [historyWindow, setHistoryWindow] = useState({
    conversationId: null,
    humanMessageCount: HISTORY_BATCH_SIZE,
  });
  const previousChatScrollTopRef = useRef(0);
  const pendingMarkerMessageIdRef = useRef(null);
  const modelName = getModelDisplayName(models, currentModel);
  const semaphoreCardTitleId = `semaphore-card-title-${currentConversation?.id ?? 'draft'}`;
  const activeApproval = approvalRequests[0] ?? null;
  const approvalInputEntries = Object.entries(activeApproval?.input ?? {});
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
  const renderedHumanMessageCount = historyWindow.conversationId === currentConversation?.id
    ? historyWindow.humanMessageCount
    : HISTORY_BATCH_SIZE;
  const historyStartIndex = startIndexForRecentHumanMessages(
    visibleMessages,
    renderedHumanMessageCount,
  );
  const renderedMessages = visibleMessages.slice(historyStartIndex);
  const groupedMessages = groupAssistantTurns(renderedMessages);
  const hasOlderMessages = historyStartIndex > 0;
  const editStats = useMemo(() => {
    const lastUserMessageIndex = currentMessages.findLastIndex((message) => (
      !message.hidden && isHumanUserMessage(message)
    ));
    return consolidateFileEdits(
      currentMessages.slice(lastUserMessageIndex + 1).filter((message) => !message.hidden),
    ).reduce((stats, edit) => ({
      files: stats.files + 1,
      additions: stats.additions + edit.additions,
      deletions: stats.deletions + edit.deletions,
    }), { files: 0, additions: 0, deletions: 0 });
  }, [currentMessages]);
  const lastAssistantMessage = visibleMessages.findLast((message) => message.role === 'assistant');
  const lastMessage = visibleMessages.at(-1);
  const lastHumanMessage = visibleMessages.findLast(isHumanUserMessage);
  const humanMessages = visibleMessages.filter(isHumanUserMessage);
  const isEmptyChat = visibleMessages.length === 0;
  const streamScrollKey = [
    lastMessage?.id ?? '',
    lastMessage?.updatedAt ?? '',
    String(lastMessage?.content ?? '').length,
    questionRequest?.questionId ?? '',
    activeApproval?.approvalId ?? '',
  ].join(':');
  const Root = compact ? 'section' : 'main';

  const { scrollRef, prepareForPrepend } = useStreamingAutoScroll({
    scrollKey: streamScrollKey,
    isRunning,
    resetKey: currentConversation?.id,
    focusKey: lastHumanMessage?.id ?? null,
    focusReady: messagesLoaded,
    prependKey: groupedMessages[0]?.message.id ?? null,
  });
  const loadOlderMessages = useCallback(() => {
    if (
      (!hasOlderMessages && (!historyHasMore || historyLoading || !onLoadOlderHistory))
      || !prepareForPrepend()
    ) return;
    setHistoryWindow((current) => ({
      conversationId: currentConversation?.id ?? null,
      humanMessageCount: (
        current.conversationId === currentConversation?.id
          ? current.humanMessageCount
          : HISTORY_BATCH_SIZE
      ) + HISTORY_BATCH_SIZE,
    }));
    if (!hasOlderMessages) void onLoadOlderHistory();
  }, [
    currentConversation?.id,
    hasOlderMessages,
    historyHasMore,
    historyLoading,
    onLoadOlderHistory,
    prepareForPrepend,
  ]);
  const handleChatScroll = useCallback((event) => {
    const { scrollTop } = event.currentTarget;
    const scrollingUp = scrollTop < previousChatScrollTopRef.current - 1;
    previousChatScrollTopRef.current = scrollTop;
    setSelectionAction(null);
    if (scrollingUp && scrollTop <= HISTORY_LOAD_THRESHOLD) loadOlderMessages();
  }, [loadOlderMessages]);
  const handleChatWheel = useCallback((event) => {
    if (event.deltaY >= 0 || event.currentTarget.scrollTop > HISTORY_LOAD_THRESHOLD) return;
    loadOlderMessages();
  }, [loadOlderMessages]);
  const scrollToRenderedMessage = useCallback((messageId) => {
    const scrollElement = scrollRef.current;
    const target = [...(scrollElement?.querySelectorAll('[data-message-id]') ?? [])]
      .find((element) => element.dataset.messageId === messageId);
    if (!target) return false;
    scrollElement.scrollTop += target.getBoundingClientRect().top
      - scrollElement.getBoundingClientRect().top
      - 16;
    return true;
  }, [scrollRef]);
  const handleMarkerSelect = useCallback((messageId) => {
    if (scrollToRenderedMessage(messageId)) return;
    const messageIndex = visibleMessages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return;
    pendingMarkerMessageIdRef.current = messageId;
    setHistoryWindow({
      conversationId: currentConversation?.id ?? null,
      humanMessageCount: Math.max(
        renderedHumanMessageCount,
        visibleMessages.slice(messageIndex).filter(isTurnDelimiterMessage).length,
      ),
    });
  }, [currentConversation?.id, renderedHumanMessageCount, scrollToRenderedMessage, visibleMessages]);
  useEffect(() => {
    const messageId = pendingMarkerMessageIdRef.current;
    if (!messageId) return;
    pendingMarkerMessageIdRef.current = null;
    scrollToRenderedMessage(messageId);
  }, [historyStartIndex, scrollToRenderedMessage]);
  const handleEditMessage = useCallback((messageId) => {
    setEditingMessageId(messageId);
  }, []);
  const handleCancelEditing = useCallback(() => {
    setEditingMessageId(null);
  }, []);
  const handleReplaceUserMessage = useCallback(async (messageId, payload) => {
    await onReplaceUserMessage(messageId, payload);
    setEditingMessageId(null);
  }, [onReplaceUserMessage]);
  const handleWorkModeChange = useCallback((nextWorkMode) => (
    onWorkModeChange(nextWorkMode, currentConversation?.id)
  ), [currentConversation?.id, onWorkModeChange]);
  const handleUltraModeChange = useCallback((enabled) => (
    onUltraModeChange(enabled, currentConversation?.id)
  ), [currentConversation?.id, onUltraModeChange]);

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
    previousChatScrollTopRef.current = 0;
  }, [currentConversation?.id]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return undefined;
    scrollElement.addEventListener('wheel', handleChatWheel, { passive: true });
    return () => scrollElement.removeEventListener('wheel', handleChatWheel);
  }, [handleChatWheel, scrollRef]);

  useEffect(() => {
    setApprovalResolving(false);
    if (!activeApproval) return undefined;
    const frame = requestAnimationFrame(() => (
      approvalCardRef.current?.focus({ preventScroll: true })
    ));
    return () => cancelAnimationFrame(frame);
  }, [activeApproval?.approvalId]);

  useEffect(() => {
    if (!chatAreaRef.current || !composerRef.current) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      chatAreaRef.current?.style.setProperty(
        '--composer-clearance',
        `${Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)}px`,
      );
    });
    observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [currentConversation?.id]);

  useEffect(() => {
    if (!chatAreaRef.current) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      setMarkersFit(entry.contentRect.width >= MESSAGE_MARKERS_MIN_WIDTH);
    });
    observer.observe(chatAreaRef.current);
    return () => observer.disconnect();
  }, [compact]);

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
      if (event.target.closest?.('.selection-action-group, .git-review-annotation')) return;
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
    return () => {
      controller.abort();
      setSelectionAnnotation('');
    };
  }, [selectionAction]);

  const updateSelectionAction = () => {
    const selection = window.getSelection();
    if (
      (!onMentionSelection && !onAskSelection && !onQuickQuestion)
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
    const width = (onMentionSelection ? 362 : 276) + (onQuickQuestion ? 130 : 0);
    const height = 34;
    const above = rect.top - height - 8;
    setSelectionAction({
      content,
      messageId: startMessage.dataset.messageId,
      left: Math.max(8, Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - 8,
      )),
      top: above >= 8 ? above : Math.min(window.innerHeight - height - 8, rect.bottom + 8),
    });
  };

  const useSelection = (callback, annotation = '') => {
    if (!selectionAction || !callback) return;
    const escape = (value) => value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    callback({
      id: crypto.randomUUID(),
      kind: 'context_marker',
      markerType: annotation ? 'citation_annotation' : 'citation',
      name: annotation ? 'Chat annotation' : 'Chat citation',
      size: 0,
      text: annotation
        ? `<citation>${escape(selectionAction.content)}</citation>\n<annotation>${escape(annotation)}</annotation>`
        : `<citation>${escape(selectionAction.content)}</citation>`,
    });
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  };

  function reportQuestionActivity() {
    if (!questionRequest) return;
    window.chatApp.chat.questionActivity({
      questionId: questionRequest.questionId,
      conversationId: questionRequest.conversationId,
    }).catch(console.error);
  }

  async function resolveApproval(decision) {
    if (!activeApproval || approvalResolving) return;
    setApprovalResolving(true);
    try {
      await onResolveApproval(activeApproval, decision);
    } finally {
      setApprovalResolving(false);
    }
  }

  return (
    <Root
      ref={chatAreaRef}
      className={`chat-area ${compact ? 'auxiliary-chat-view' : ''} ${isEmptyChat ? 'chat-empty' : ''} ${isEmptyChat && homeEmpty && !compact ? 'chat-empty-home' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatFind key={currentConversation?.id ?? 'draft'} scrollRef={scrollRef} conversationId={currentConversation?.id} compact={compact} hasMore={hasOlderMessages || historyHasMore} loading={historyLoading} onLoadMore={loadOlderMessages} />
      {!compact && backgroundUrl && (
        <div
          className="chat-background-image"
          style={{
            backgroundImage: `url(${JSON.stringify(backgroundUrl)})`,
            mixBlendMode: backgroundBlendMode,
            opacity: backgroundOpacity,
          }}
          aria-hidden="true"
        />
      )}
      {!compact && emptyBackgroundEnabled && (
        <canvas
          ref={emptyBackgroundRef}
          className="empty-chat-background"
          aria-hidden="true"
        />
      )}
      {messagesLoaded && markersFit && (
        <MessageMarkers messages={humanMessages} onSelect={handleMarkerSelect} />
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
        role="region"
        aria-label="Conversation messages"
        tabIndex={0}
        onMouseUp={updateSelectionAction}
        onKeyUp={updateSelectionAction}
        onScroll={handleChatScroll}
        onWheel={handleChatWheel}
      >
        {!messagesLoaded ? (
          <div className="empty-chat">
            <p>Loading messages...</p>
          </div>
        ) : isEmptyChat ? (
          <div className="empty-chat">
            <h1>How can I help you today?</h1>
            {emptyHint && <p>{emptyHint}</p>}
            {!compact && homeEmpty && <EmptyChatSummary
              bots={bots} botDataByBot={botDataByBot} botsLoading={botsLoading} botsError={botsError}
              onOpenInbox={onOpenInbox} />}
          </div>
        ) : (
          <div className="messages-column">
            {groupedMessages.map(({ message, workedMessages, workedStartedAt }) => (
              <MessageRow
                key={message.id}
                message={message}
                editing={message.id === editingMessageId}
                onEdit={onReplaceUserMessage ? handleEditMessage : undefined}
                editor={message.id === editingMessageId ? (
                  <Composer
                    key={`edit-${message.id}`}
                    conversationId={currentConversation?.id}
                    isRunning={isRunning}
                    onSend={(payload) => handleReplaceUserMessage(message.id, payload)}
                    onExpandPrompt={onExpandPrompt}
                    onStop={onStop}
                    onQuickCompress={onQuickCompress}
                    onCompress={onCompress}
                    models={models}
                    favorites={favorites}
                    intelligenceLevels={intelligenceLevels}
                    recentProjects={recentProjects}
                    currentModel={message.model || currentModel}
                    modelName={getModelDisplayName(models, message.model || currentModel)}
                    contextUsage={contextUsage}
                    onChooseModel={() => {}}
                    project={currentProject}
                    projectLocked
                    showProject={!compact}
                    onChooseProject={onChooseProject}
                    onUseHome={onUseHome}
                    onToggleFavorite={onToggleFavorite}
                    workMode={message.workMode}
                    onWorkModeChange={() => true}
                    ultraMode={message.ultraMode}
                    onUltraModeChange={() => true}
                    messageDeliveryMode={messageDeliveryMode}
                    defaultPermissionMode={message.permissionMode || defaultPermissionMode}
                    initialState={{
                      text: message.content,
                      attachments: message.attachments,
                      model: models.some((model) => model.id === message.model)
                        ? message.model
                        : currentModel,
                      reasoningEffort: message.reasoningEffort,
                      permissionMode: message.permissionMode || defaultPermissionMode,
                      workMode: message.workMode,
                      ultraMode: message.ultraMode,
                    }}
                    persistState={false}
                    inline
                    botMode={botMode}
                    autoFocus
                    onCancel={handleCancelEditing}
                  />
                ) : null}
                workedMessages={workedMessages}
                workedStartedAt={workedStartedAt}
                modelName={getModelDisplayName(
                  models,
                  message.model || currentConversation?.model,
                )}
                resumeModel={message.model || currentConversation?.model || currentModel}
                conversationId={currentConversation?.id}
                onFork={onFork}
                onRetry={onRetry}
                onResume={onResume}
                runActive={isRunning && message.id === lastAssistantMessage?.id}
                questionPending={Boolean(
                  questionRequest && message.id === lastAssistantMessage?.id,
                )}
                onSendContinuation={onSendContinuation}
                onUndoEdits={onUndoEdits}
                onOpenFileEdit={onOpenFileEdit}
                onImplementPlan={onImplementPlan}
                onOpenFileReference={onOpenFileReference}
                onFileReferenceAction={onFileReferenceAction}
                showContinuations={
                  continuationRepliesEnabled
                  && message.id === lastAssistantMessage?.id
                  && message.status === 'completed'
                  && !isRunning
                  && !subagents?.some((subagent) => (
                    ['waiting', 'working'].includes(subagent.status)
                  ))
                }
                canRetry={canRetryAssistantMessage(
                  message,
                  lastAssistantMessage,
                  isRunning,
                )}
                canResume={canResumeAssistantMessage(
                  message,
                  lastAssistantMessage,
                  isRunning,
                )}
              />
            ))}
            {semaphoreWait && (
              <article
                className="message-row assistant-row semaphore-inline-row"
                aria-live="polite"
              >
                <section className="semaphore-card" aria-labelledby={semaphoreCardTitleId}>
                  <Moon size={18} aria-hidden="true" />
                  <div className="semaphore-card-copy">
                    <strong id={semaphoreCardTitleId}>Agent sleeping</strong>
                    <span>
                      Waiting for semaphore <code>{semaphoreWait.name}</code>. Queue position{' '}
                      {semaphoreWait.position}.
                    </span>
                  </div>
                  <div className="semaphore-card-actions">
                    <button
                      type="button"
                      disabled={semaphoreResolving}
                      onClick={() => onRunSemaphoreNow()}
                    >
                      Run now
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={semaphoreResolving}
                      onClick={() => onCancelSemaphore()}
                    >
                      Cancel semaphore
                    </button>
                  </div>
                </section>
              </article>
            )}
            {activeApproval && (
              <article
                className="message-row assistant-row approval-inline-row"
                aria-live="polite"
              >
                <section
                  key={activeApproval.approvalId}
                  ref={approvalCardRef}
                  className="approval-card"
                  tabIndex={-1}
                  aria-labelledby={`approval-card-title-${activeApproval.approvalId}`}
                  aria-describedby={`approval-card-summary-${activeApproval.approvalId}`}
                  aria-busy={approvalResolving}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    resolveApproval('disallow');
                  }}
                >
                  <header className="approval-card-header">
                    <ShieldQuestion className="approval-card-icon" size={18} aria-hidden="true" />
                    <div className="approval-card-copy">
                      <div className="approval-card-title-row">
                        <strong id={`approval-card-title-${activeApproval.approvalId}`}>
                          Allow this tool call?
                        </strong>
                        {approvalRequests.length > 1 && (
                          <span className="approval-card-queue">
                            {approvalRequests.length - 1} more pending
                          </span>
                        )}
                      </div>
                      <p id={`approval-card-summary-${activeApproval.approvalId}`} className="approval-card-summary">
                        {activeApproval.invocationSummary}
                      </p>
                    </div>
                  </header>
                  <div className="approval-card-call">
                    <div className="approval-card-call-meta">
                      <span title="Tool">
                        <Wrench size={12} aria-hidden="true" />
                        <code>{activeApproval.toolName}</code>
                      </span>
                      <span title="Folder">
                        <Folder size={12} aria-hidden="true" />
                        <span>{activeApproval.workspacePath || 'No folder'}</span>
                      </span>
                    </div>
                    {approvalInputEntries.length > 0 && (
                      <dl className="approval-card-input">
                        {approvalInputEntries.map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>
                              <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  <footer className="approval-card-footer">
                    <button
                      className="approval-card-deny"
                      type="button"
                      disabled={approvalResolving}
                      title="Deny (Esc)"
                      onClick={() => resolveApproval('disallow')}
                    >
                      <X size={14} aria-hidden="true" />
                      <span>Deny</span>
                    </button>
                    <div className="approval-card-actions">
                      <button
                        className="approval-card-always"
                        type="button"
                        disabled={approvalResolving}
                        title="Allow now and remember this command for this folder"
                        onClick={() => resolveApproval('allow_all')}
                      >
                        <ShieldCheck size={14} aria-hidden="true" />
                        <span>Always allow</span>
                      </button>
                      <button
                        className="approval-card-allow primary-mini"
                        type="button"
                        disabled={approvalResolving}
                        onClick={() => resolveApproval('allow')}
                      >
                        <Check size={14} aria-hidden="true" />
                        <span>{approvalResolving ? 'Resolving...' : 'Allow'}</span>
                      </button>
                    </div>
                  </footer>
                </section>
              </article>
            )}
            {questionRequest && (
              <article
                className="message-row assistant-row question-inline-row"
                aria-live="polite"
              >
                <QuestionForm
                  key={questionRequest.questionId}
                  formId={questionRequest.questionId}
                  questions={questionRequest.questions}
                  onActivity={reportQuestionActivity}
                  onSubmit={(answers) => onAnswerQuestion(questionRequest, answers, false)}
                  onCancel={() => onAnswerQuestion(questionRequest, [], true)}
                />
              </article>
            )}
          </div>
        )}
      </div>
      <MemoizedComposer
        containerRef={composerRef}
        projectSelectable={allowProjectChange}
        floatActions={composerFloat}
        conversationId={currentConversation?.id ?? null}
        isRunning={isRunning}
        onSend={onSend}
        onExpandPrompt={onExpandPrompt}
        onStop={onStop}
        onQuickCompress={onQuickCompress}
        onCompress={onCompress}
        onCreateSideChat={onCreateSideChat}
        subagents={subagents}
        tasks={tasks}
        onOpenTasks={onOpenTasks}
        onOpenSubagents={onOpenSubagents}
        editStats={editStats}
        steeredMessages={steeredMessages}
        queuedMessages={queuedMessages}
        onCancelQueued={onCancelQueued}
        onReorderQueued={onReorderQueued}
        onSteerQueued={onSteerQueued}
        droppedFiles={droppedFiles}
        modelName={modelName}
        recentProjects={recentProjects}
        models={models}
        favorites={favorites}
        intelligenceLevels={intelligenceLevels}
        currentModel={currentModel}
        contextUsage={contextUsage}
        onChooseModel={onChooseModel}
        project={currentProject}
        projectLocked={Boolean(currentConversation)}
        showProject={!compact}
        onChooseProject={onChooseProject}
        onUseHome={onUseHome}
        onToggleFavorite={onToggleFavorite}
        workMode={workMode}
        onWorkModeChange={handleWorkModeChange}
        ultraMode={ultraMode}
        onUltraModeChange={handleUltraModeChange}
        goal={currentConversation?.goal}
        goalPreparation={goalPreparation}
        onGoalAction={onGoalAction}
        pendingAttachment={pendingAttachment}
        onPendingAttachmentConsumed={onPendingAttachmentConsumed}
        messageDeliveryMode={messageDeliveryMode}
        autoFocus={!currentConversation || Boolean(currentConversation.isSideChat)}
        defaultPermissionMode={defaultPermissionMode}
        botMode={botMode}
        onShowBotInPanel={onShowBotInPanel}
      />
      <Presence when={selectionAction}>{(selectionAction) => createPortal(selectionAction.annotating ? (
        <Overlay
          as="form"
          className="git-review-annotation"
          aria-label="Annotate selected text"
          style={{
            left: Math.max(8, Math.min(selectionAction.left, window.innerWidth - 348)),
            top: Math.max(8, Math.min(selectionAction.top, window.innerHeight - 200)),
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectionAnnotation.trim()) return;
            useSelection(onMentionSelection, selectionAnnotation.trim());
          }}
        >
          <blockquote title={selectionAction.content}>{selectionAction.content}</blockquote>
          <textarea
            autoFocus
            aria-label="Annotation"
            value={selectionAnnotation}
            onChange={(event) => setSelectionAnnotation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
              event.preventDefault();
              event.currentTarget.form.requestSubmit();
            }}
            placeholder="Add an annotation..."
            rows={3}
          />
          <footer>
            <small>Ctrl+Enter to add</small>
            <button type="button" onClick={() => setSelectionAction(null)}>Cancel</button>
            <button
              type="submit"
              className="primary-mini"
              disabled={!selectionAnnotation.trim()}
            >
              Add to chat
            </button>
          </footer>
        </Overlay>
      ) : (
        <Overlay
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
          {onMentionSelection && (
            <button
              type="button"
              onClick={() => setSelectionAction((current) => ({ ...current, annotating: true }))}
            >
              <PencilLine size={13} aria-hidden="true" />
              <span>Annotate</span>
            </button>
          )}
          {onAskSelection && (
            <button type="button" onClick={() => useSelection(onAskSelection)}>
              <MessagesSquare size={13} aria-hidden="true" />
              <span>Ask in Side Chat</span>
            </button>
          )}
          {onQuickQuestion && (
            <button
              type="button"
              onClick={() => useSelection((attachment) => onQuickQuestion({
                label: selectionAction.content,
                left: selectionAction.left,
                top: selectionAction.top,
                context: {
                  source: 'chat',
                  workspacePath: currentProject?.path,
                  threadId: currentConversation?.id,
                  messageId: selectionAction.messageId,
                  attachments: [attachment],
                },
              }))}
            >
              <MessageCircleQuestionMark size={13} aria-hidden="true" />
              <span>Quick question</span>
            </button>
          )}
        </Overlay>
      ), document.body)}</Presence>
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
