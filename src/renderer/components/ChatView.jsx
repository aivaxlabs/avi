import { UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Composer } from './Composer.jsx';
import { Message } from './Message.jsx';

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
  onChooseModel,
  onChooseProject,
  onUseHome,
  onToggleFavorite,
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
  const [fileDropActive, setFileDropActive] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);
  const modelName = models.find((model) => model.id === currentModel)?.name ?? currentModel ?? 'Model';
  const queuedMessages = currentMessages
    .filter((message) => ['queued', 'steered'].includes(message.status))
    .sort((a, b) => (
      (a.queuePosition ?? Number.MAX_SAFE_INTEGER)
      - (b.queuePosition ?? Number.MAX_SAFE_INTEGER)
      || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ));
  const visibleMessages = currentMessages
    .filter((message) => !['queued', 'steered'].includes(message.status));
  const lastAssistantMessage = visibleMessages.findLast((message) => message.role === 'assistant');
  const lastMessage = visibleMessages.at(-1);
  const isEmptyChat = visibleMessages.length === 0;
  const streamScrollKey = [
    currentConversation?.id ?? '',
    lastMessage?.id ?? '',
    lastMessage?.updatedAt ?? '',
    lastMessage?.content?.length ?? 0,
  ].join(':');
  const Root = compact ? 'section' : 'main';

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
                modelName={
                  models.find((model) => model.id === (message.model || currentConversation?.model))?.name
                  ?? message.model
                  ?? currentConversation?.model
                  ?? 'Model'
                }
                onFork={() => onFork(currentConversation?.id, message.id)}
                onRetry={() => onRetry(message.id)}
                onResume={() => onResume(
                  message.id,
                  message.model || currentConversation?.model || currentModel,
                )}
                runActive={isRunning && message.id === lastAssistantMessage?.id}
                onSendContinuation={onSendContinuation}
                showContinuations={message.id === lastAssistantMessage?.id}
              />
            ))}
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
