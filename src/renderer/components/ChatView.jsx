import { Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Composer } from './Composer.jsx';
import { Message } from './Message.jsx';

export function ChatView({
  currentConversation,
  currentMessages,
  currentModel,
  models,
  favorites,
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
  const modelName = models.find((model) => model.id === currentModel)?.name ?? currentModel ?? 'Model';
  const lastAssistantMessage = currentMessages.findLast((message) => message.role === 'assistant');
  const lastMessage = currentMessages.at(-1);
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
    <main className="chat-area">
      <div
        ref={scrollRef}
        className="chat-scroll"
        onTouchMove={handleManualScroll}
        onWheel={handleManualScroll}
      >
        {currentMessages.length === 0 ? (
          <div className="empty-chat">
            <div className="copilot-orb">
              <Sparkles size={22} />
            </div>
            <h1>Hey, good afternoon!</h1>
            <p>How can AIVAX help you today?</p>
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
        modelName={modelName}
        models={models}
        favorites={favorites}
        currentModel={currentModel}
        isRunning={isRunning}
        onSend={onSend}
        onStop={onStop}
        onChooseModel={onChooseModel}
        onToggleFavorite={onToggleFavorite}
        onRefreshModels={onRefreshModels}
      />
    </main>
  );
}
