import { X } from 'lucide-react';
import { ChatView } from './ChatView.jsx';

export function SideChatPanel({
  sideChats,
  activeId,
  messagesByConversation,
  running,
  models,
  favorites,
  recentModels,
  recentProjects,
  fallbackModel,
  onSelect,
  onClose,
  onSend,
  onStop,
  onCompress,
  onFork,
  onRetry,
  onResume,
  onCancelQueued,
  onReorderQueued,
  onSteerQueued,
  onChooseModel,
  onToggleFavorite,
}) {
  const activeSideChat = sideChats.find((sideChat) => sideChat.id === activeId) ?? sideChats[0];
  if (!activeSideChat) return null;

  const currentModel = models.some((model) => model.id === activeSideChat.model)
    ? activeSideChat.model
    : fallbackModel;
  const currentProject = {
    path: activeSideChat.projectPath,
    name: activeSideChat.projectName,
    displayPath: activeSideChat.projectDisplayPath,
    gitBranch: activeSideChat.gitBranch,
  };
  const contextLimit = models.find((model) => model.id === currentModel)?.context.input ?? null;

  return (
    <aside className="side-chat-panel" aria-label="Side chats">
      <header className="side-chat-header">
        <div className="side-chat-tabs" role="tablist" aria-label="Open side chats">
          {sideChats.map((sideChat, index) => (
            <div
              key={sideChat.id}
              className={`side-chat-tab ${sideChat.id === activeSideChat.id ? 'active' : ''}`}
            >
              <button
                id={`side-chat-tab-${sideChat.id}`}
                type="button"
                role="tab"
                aria-selected={sideChat.id === activeSideChat.id}
                aria-controls={`side-chat-content-${sideChat.id}`}
                tabIndex={sideChat.id === activeSideChat.id ? 0 : -1}
                title={sideChat.title}
                onClick={() => onSelect(sideChat.id)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                  event.preventDefault();
                  const offset = event.key === 'ArrowRight' ? 1 : -1;
                  const next = sideChats[(index + offset + sideChats.length) % sideChats.length];
                  onSelect(next.id);
                  queueMicrotask(() => document.getElementById(`side-chat-tab-${next.id}`)?.focus());
                }}
              >
                <span className={`run-dot ${running[sideChat.id] ? 'live' : ''}`} />
                <span>{sideChat.title}</span>
              </button>
              <button
                className="side-chat-close"
                type="button"
                aria-label={`Close ${sideChat.title}`}
                title={`Close ${sideChat.title}`}
                onClick={() => onClose(sideChat.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </header>
      <div
        id={`side-chat-content-${activeSideChat.id}`}
        className="side-chat-content"
        role="tabpanel"
        aria-labelledby={`side-chat-tab-${activeSideChat.id}`}
      >
        <ChatView
          key={activeSideChat.id}
          compact
          currentConversation={activeSideChat}
          currentMessages={messagesByConversation[activeSideChat.id] ?? []}
          currentModel={currentModel}
          currentProject={currentProject}
          contextUsage={{
            tokens: activeSideChat.contextTokens ?? 0,
            limit: contextLimit,
          }}
          recentModels={recentModels}
          recentProjects={recentProjects}
          models={models}
          favorites={favorites}
          isRunning={Boolean(running[activeSideChat.id])}
          onSend={(payload) => onSend(activeSideChat, currentModel, payload)}
          onStop={() => onStop(activeSideChat.id)}
          onCompress={() => onCompress(activeSideChat.id, currentModel)}
          onFork={(conversationId, throughMessageId) => onFork(conversationId, throughMessageId)}
          onRetry={(messageId) => onRetry(activeSideChat.id, messageId, currentModel)}
          onResume={(messageId, model) => onResume(activeSideChat.id, messageId, model)}
          onCancelQueued={(messageId) => onCancelQueued(activeSideChat.id, messageId)}
          onReorderQueued={(messageIds) => onReorderQueued(activeSideChat.id, messageIds)}
          onSteerQueued={(messageId, messageIds) => (
            onSteerQueued(activeSideChat.id, messageId, messageIds)
          )}
          onSendContinuation={(text) => (
            onSend(activeSideChat, currentModel, { text, attachments: [] })
          )}
          onChooseModel={(modelId) => onChooseModel(modelId, activeSideChat.id)}
          onChooseProject={() => {}}
          onUseHome={() => {}}
          onToggleFavorite={onToggleFavorite}
          draftKey={`aivax.composer.side.${activeSideChat.id}`}
        />
      </div>
    </aside>
  );
}
