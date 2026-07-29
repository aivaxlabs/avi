import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  MessageSquarePlus,
  Plus,
  X,
} from 'lucide-react';
import { ChatView } from './ChatView.jsx';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const subagentsTabId = 'subagents';

export function AuxiliaryPanel({
  sideChats,
  subagents,
  activeTab,
  activeSubagentId,
  messagesByConversation,
  running,
  models,
  favorites,
  recentModels,
  recentProjects,
  fallbackModel,
  canCreateSideChat,
  onSelectTab,
  onCloseSideChat,
  onCloseSubagentsTab,
  onClosePanel,
  onCreateSideChat,
  onSelectSubagent,
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef(null);
  const tabs = [
    ...sideChats.map((sideChat) => ({
      id: sideChat.id,
      label: sideChat.title,
      running: Boolean(running[sideChat.id]),
      type: 'side-chat',
    })),
    ...(subagents.length > 0 || activeTab === subagentsTabId
      ? [{
          id: subagentsTabId,
          label: 'Sub-agents',
          running: subagents.some((subagent) => subagent.status === 'working'),
          type: 'subagents',
        }]
      : []),
  ];
  const activeSideChat = sideChats.find((sideChat) => sideChat.id === activeTab) ?? null;
  const showingSubagents = activeTab === subagentsTabId;
  const activeSubagent = showingSubagents
    ? subagents.find((subagent) => subagent.id === activeSubagentId) ?? null
    : null;
  const activeThread = activeSubagent ?? activeSideChat;
  const currentModel = activeThread
    ? models.some((model) => model.id === activeThread.model)
      ? activeThread.model
      : fallbackModel
    : fallbackModel;
  const currentProject = activeThread
    ? {
        path: activeThread.projectPath,
        name: activeThread.projectName,
        displayPath: activeThread.projectDisplayPath,
        gitBranch: activeThread.gitBranch,
      }
    : null;
  const contextLimit = models.find((model) => model.id === currentModel)?.context.input ?? null;

  const hasActiveTab = tabs.some((tab) => tab.id === activeTab);

  useEffect(() => {
    if (!actionsOpen) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (!actionsRef.current?.contains(event.target)) setActionsOpen(false);
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setActionsOpen(false);
      actionsRef.current?.querySelector('.auxiliary-add-button')?.focus();
    }, { signal: controller.signal });
    queueMicrotask(() => actionsRef.current?.querySelector('[role="menuitem"]:enabled')?.focus());
    return () => controller.abort();
  }, [actionsOpen]);

  return (
    <aside className="auxiliary-panel" aria-label="Auxiliary panel">
      <header className="auxiliary-panel-header">
        {tabs.length > 0 ? (
          <div className="auxiliary-tabs-row">
            <div className="auxiliary-tabs" role="tablist" aria-label="Auxiliary panel tabs">
              {tabs.map((tab, index) => (
                <div
                  key={tab.id}
                  className={`auxiliary-tab ${tab.id === activeTab ? 'active' : ''}`}
                >
                  <button
                    id={`auxiliary-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeTab}
                    aria-controls={`auxiliary-content-${tab.id}`}
                    tabIndex={tab.id === activeTab ? 0 : -1}
                    title={tab.label}
                    onClick={() => onSelectTab(tab.id)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                      event.preventDefault();
                      const offset = event.key === 'ArrowRight' ? 1 : -1;
                      const next = tabs[(index + offset + tabs.length) % tabs.length];
                      onSelectTab(next.id);
                      queueMicrotask(() => (
                        document.getElementById(`auxiliary-tab-${next.id}`)?.focus()
                      ));
                    }}
                  >
                    {tab.type === 'subagents' ? (
                      <Bot size={14} aria-hidden="true" />
                    ) : (
                      <span className={`run-dot ${tab.running ? 'live' : ''}`} />
                    )}
                    <span>{tab.label}</span>
                    {tab.type === 'subagents' && tab.running && (
                      <span className="run-dot live" aria-label="Sub-agents working" />
                    )}
                  </button>
                  <button
                    className="auxiliary-tab-close"
                    type="button"
                    aria-label={tab.type === 'subagents'
                      ? 'Close Sub-agents tab'
                      : `Close ${tab.label}`}
                    title={tab.type === 'subagents' ? 'Close Sub-agents tab' : `Close ${tab.label}`}
                    onClick={() => (
                      tab.type === 'subagents'
                        ? onCloseSubagentsTab()
                        : onCloseSideChat(tab.id)
                    )}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="auxiliary-add" ref={actionsRef}>
              <button
                className="auxiliary-add-button"
                type="button"
                aria-label="Open another auxiliary panel"
                title="Open another auxiliary panel"
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
                aria-controls="auxiliary-add-menu"
                onClick={() => setActionsOpen((open) => !open)}
              >
                <Plus size={15} />
              </button>
              {actionsOpen && (
                <DropdownMenu
                  id="auxiliary-add-menu"
                  className="auxiliary-add-menu"
                  role="menu"
                  aria-label="Auxiliary panel options"
                >
                  <DropdownMenuItem
                    icon={<MessageSquarePlus size={14} />}
                    role="menuitem"
                    disabled={!canCreateSideChat}
                    title={canCreateSideChat
                      ? 'Create a side chat'
                      : 'Start a conversation before creating a side chat'}
                    onClick={() => {
                      setActionsOpen(false);
                      onCreateSideChat();
                    }}
                  >
                    Side chat
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<Bot size={14} />}
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false);
                      onSelectTab(subagentsTabId);
                    }}
                  >
                    Sub-agents
                  </DropdownMenuItem>
                </DropdownMenu>
              )}
            </div>
          </div>
        ) : (
          <div className="auxiliary-empty-header">
            <span>Auxiliary panel</span>
            <button
              className="auxiliary-tab-close"
              type="button"
              aria-label="Close auxiliary panel"
              title="Close auxiliary panel"
              onClick={onClosePanel}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </header>
      <div
        id={hasActiveTab ? `auxiliary-content-${activeTab}` : undefined}
        className={`auxiliary-content${activeSubagent ? ' with-toolbar' : ''}${
          hasActiveTab ? '' : ' is-empty'
        }`}
        role={hasActiveTab ? 'tabpanel' : undefined}
        aria-labelledby={hasActiveTab ? `auxiliary-tab-${activeTab}` : undefined}
      >
        {activeSubagent && (
          <div className="subagent-chat-toolbar">
            <button type="button" onClick={() => onSelectSubagent(null)}>
              <ArrowLeft size={15} />
              <span>{activeSubagent.title}</span>
            </button>
          </div>
        )}
        {!hasActiveTab ? (
          <div className="auxiliary-empty">
            <p>Open in this panel</p>
            <button
              type="button"
              disabled={!canCreateSideChat}
              title={canCreateSideChat
                ? 'Create a side chat'
                : 'Start a conversation before creating a side chat'}
              onClick={onCreateSideChat}
            >
              <MessageSquarePlus size={16} aria-hidden="true" />
              <span>
                <strong>Side chat</strong>
                <small>Fork this conversation</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onSelectTab(subagentsTabId)}>
              <Bot size={16} aria-hidden="true" />
              <span>
                <strong>Sub-agents</strong>
                <small>View orchestrated tasks</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : showingSubagents && !activeSubagent && subagents.length === 0 ? (
          <div className="subagent-empty">
            <Bot size={20} aria-hidden="true" />
            <strong>No sub-agents yet</strong>
            <span>Sub-agents appear here when the orchestrator starts them.</span>
          </div>
        ) : showingSubagents && !activeSubagent ? (
          <div className="subagent-list">
            {subagents.map((subagent) => {
              const assignment = (messagesByConversation[subagent.id] ?? [])
                .findLast((message) => message.role === 'user')
                ?.content;
              return (
                <button
                  key={subagent.id}
                  className="subagent-list-item"
                  type="button"
                  onClick={() => onSelectSubagent(subagent.id)}
                >
                  <span className={`subagent-status-dot ${subagent.status}`} aria-hidden="true" />
                  <span className="subagent-list-copy">
                    <strong>{subagent.title}</strong>
                    <span>{assignment || subagent.firstPrompt || 'Waiting for an assignment'}</span>
                  </span>
                  <span className={`subagent-status ${subagent.status}`}>
                    {subagent.status}
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : activeThread ? (
          <ChatView
            key={activeThread.id}
            compact
            currentConversation={activeThread}
            currentMessages={messagesByConversation[activeThread.id] ?? []}
            currentModel={currentModel}
            currentProject={currentProject}
            contextUsage={{
              tokens: activeThread.contextTokens ?? 0,
              limit: contextLimit,
            }}
            recentModels={recentModels}
            recentProjects={recentProjects}
            models={models}
            favorites={favorites}
            isRunning={Boolean(running[activeThread.id])}
            onSend={(payload) => onSend(activeThread, currentModel, payload)}
            onStop={() => onStop(activeThread.id)}
            onCompress={() => onCompress(activeThread.id, currentModel)}
            onFork={(conversationId, throughMessageId) => onFork(
              conversationId,
              throughMessageId,
            )}
            onRetry={(messageId) => onRetry(activeThread.id, messageId, currentModel)}
            onResume={(messageId, model) => onResume(activeThread.id, messageId, model)}
            onCancelQueued={(messageId) => onCancelQueued(activeThread.id, messageId)}
            onReorderQueued={(messageIds) => onReorderQueued(activeThread.id, messageIds)}
            onSteerQueued={(messageId, messageIds) => onSteerQueued(
              activeThread.id,
              messageId,
              messageIds,
            )}
            onSendContinuation={(text) => onSend(
              activeThread,
              currentModel,
              { text, attachments: [] },
            )}
            onChooseModel={(modelId) => onChooseModel(modelId, activeThread.id)}
            onChooseProject={() => {}}
            onUseHome={() => {}}
            onToggleFavorite={onToggleFavorite}
            draftKey={`aivax.composer.${
              activeThread.isSubagent ? 'subagent' : 'side'
            }.${activeThread.id}`}
          />
        ) : null}
      </div>
    </aside>
  );
}
