import { UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Composer } from './Composer.jsx';
import { Message } from './Message.jsx';
import { WorkspaceAttachDialog } from './WorkspaceAttachDialog.jsx';

export function ChatView({
  currentConversation,
  currentMessages,
  currentModel,
  recentModels,
  models,
  favorites,
  activeWorkspaceId,
  workspaceAttachments,
  isRunning,
  onSend,
  onStop,
  onFork,
  onRetry,
  onCancelQueued,
  onSendContinuation,
  onChooseModel,
  onToggleFavorite,
  onRefreshModels,
}) {
  const scrollRef = useRef(null);
  const autoScrollTimerRef = useRef(null);
  const manualScrollDuringRunRef = useRef(false);
  const wasRunningRef = useRef(false);
  const dragDepthRef = useRef(0);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);
  const [workspaceAttachOpen, setWorkspaceAttachOpen] = useState(false);
  const [selectedWorkspaceAttachments, setSelectedWorkspaceAttachments] = useState(null);
  const modelName = models.find((model) => model.id === currentModel)?.name ?? currentModel ?? 'Model';
  const lastAssistantMessage = currentMessages.findLast((message) => message.role === 'assistant');
  const lastMessage = currentMessages.at(-1);
  const isEmptyChat = currentMessages.length === 0;
  const streamScrollKey = [
    currentConversation?.id ?? '',
    lastMessage?.id ?? '',
    lastMessage?.updatedAt ?? '',
    lastMessage?.content?.length ?? 0,
  ].join(':');

  function scrollToBottom() {
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  }

  function scheduleScrollToBottom(delay = 50) {
    window.clearTimeout(autoScrollTimerRef.current);
    autoScrollTimerRef.current = window.setTimeout(() => {
      requestAnimationFrame(scrollToBottom);
    }, delay);
  }

  function handleManualScroll() {
    if (isRunning) {
      manualScrollDuringRunRef.current = true;
      window.clearTimeout(autoScrollTimerRef.current);
    }
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

    return () => window.clearTimeout(autoScrollTimerRef.current);
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

  return (
    <main
      className={`chat-area ${isEmptyChat ? 'chat-empty' : ''}`}
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
        onTouchMove={handleManualScroll}
        onWheel={handleManualScroll}
      >
        {isEmptyChat ? (
          <div className="empty-chat">
            <h1>How can I help you today?</h1>
          </div>
        ) : (
          <div className="messages-column">
            {currentMessages.map((message) => (
              <Message
                key={message.id}
                message={message}
                onFork={() => onFork(currentConversation?.id, message.id)}
                onRetry={() => onRetry(message.id)}
                onCancelQueued={() => onCancelQueued(message.id)}
                onSendContinuation={onSendContinuation}
                showContinuations={message.id === lastAssistantMessage?.id}
              />
            ))}
          </div>
        )}
      </div>
      <Composer
        isRunning={isRunning}
        onSend={onSend}
        onStop={onStop}
        droppedFiles={droppedFiles}
        modelName={modelName}
        recentModels={recentModels}
        models={models}
        favorites={favorites}
        currentModel={currentModel}
        activeWorkspaceId={activeWorkspaceId}
        workspaceAttachments={workspaceAttachments}
        selectedWorkspaceAttachments={selectedWorkspaceAttachments}
        onChooseModel={onChooseModel}
        onToggleFavorite={onToggleFavorite}
        onRefreshModels={onRefreshModels}
        onAttachFromWorkspace={() => setWorkspaceAttachOpen(true)}
      />
      {workspaceAttachOpen && activeWorkspaceId && (
        <WorkspaceAttachDialog
          workspaceId={activeWorkspaceId}
          onClose={() => setWorkspaceAttachOpen(false)}
          onAttach={(attachments) => setSelectedWorkspaceAttachments({ id: crypto.randomUUID(), attachments })}
        />
      )}
    </main>
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
