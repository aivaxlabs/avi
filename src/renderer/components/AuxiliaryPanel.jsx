import Avatar from 'boring-avatars';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Files,
  Gauge,
  MessageSquarePlus,
  ListChecks,
  Plus,
  X,
} from 'lucide-react';
import { ChatView } from './ChatView.jsx';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { FilesPanel } from './FilesPanel.jsx';
import { ProviderPanel } from './ProviderPanel.jsx';

const subagentsTabId = 'subagents';
const filesTabId = 'files';
const tasksTabId = 'tasks';
const subagentAvatarColors = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];

function AuxiliaryAddMenu({
  providerPanels,
  canCreateSideChat,
  onCreateSideChat,
  onOpenFilesTab,
  onOpenTasksTab,
  onOpenSubagentsTab,
  onOpenProviderPanel,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      rootRef.current?.querySelector('.auxiliary-add-button')?.focus();
    }, { signal: controller.signal });
    queueMicrotask(() => rootRef.current?.querySelector('[role="menuitem"]:enabled')?.focus());
    return () => controller.abort();
  }, [open]);

  return (
    <div className="auxiliary-add" ref={rootRef}>
      <button
        className="auxiliary-add-button"
        type="button"
        aria-label="Open another auxiliary tab"
        title="Open another auxiliary tab"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="auxiliary-add-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <Plus size={15} />
      </button>
      {open && (
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
              setOpen(false);
              onCreateSideChat();
            }}
          >
            Side chat
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Files size={14} />}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenFilesTab();
            }}
          >
            Files
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ListChecks size={14} />}
            role="menuitem"
            disabled={!canCreateSideChat}
            title={canCreateSideChat
              ? 'View tasks for this conversation'
              : 'Start a conversation before opening tasks'}
            onClick={() => {
              setOpen(false);
              onOpenTasksTab();
            }}
          >
            Tasks
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Bot size={14} />}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSubagentsTab();
            }}
          >
            Sub-agents
          </DropdownMenuItem>
          {providerPanels.map((panel) => (
            <DropdownMenuItem
              icon={<Gauge size={14} />}
              key={panel.id}
              role="menuitem"
              title={`${panel.title} - ${panel.providerName}`}
              onClick={() => {
                setOpen(false);
                onOpenProviderPanel(panel.id);
              }}
            >
              {panel.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}

export function AuxiliaryPanel({
  sideChats,
  subagents,
  tasks = [],
  activeTab,
  activeSubagentId,
  messagesByConversation,
  running,
  models,
  favorites,
  recentModels,
  recentProjects,
  fallbackModel,
  conversationId,
  project,
  providerPanels = [],
  openProviderPanels = [],
  filesTabOpen,
  subagentsTabOpen,
  tasksTabOpen,
  canCreateSideChat,
  onSelectTab,
  onCloseSideChat,
  onCloseFilesTab,
  onCloseSubagentsTab,
  onCloseTasksTab,
  onOpenFilesTab,
  onOpenTasksTab,
  onOpenSubagentsTab,
  onOpenProviderPanel,
  onCloseProviderPanel,
  onClosePanel,
  onCreateSideChat,
  onAddToChat,
  onAskInSideChat,
  pendingSideChatAttachment,
  onPendingSideChatAttachmentConsumed,
  fileNavigation,
  onFileNavigationConsumed,
  onOpenFileReference,
  onFileReferenceAction,
  onSelectSubagent,
  onSend,
  onImplementPlan,
  questionRequests = [],
  onAnswerQuestion,
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
  workMode,
  onWorkModeChange,
  onGoalAction,
  messageDeliveryMode = 'queue',
  defaultPermissionMode = 'approve_for_me',
}) {
  const tabs = [
    ...sideChats.map((sideChat) => ({
      id: sideChat.id,
      label: sideChat.title,
      running: Boolean(running[sideChat.id]),
      type: 'side-chat',
    })),
    ...(filesTabOpen
      ? [{
          id: filesTabId,
          label: 'Files',
          running: false,
          type: 'files',
        }]
      : []),
    ...(tasksTabOpen
      ? [{ id: tasksTabId, label: 'Tasks', running: false, type: 'tasks' }]
      : []),
    ...(subagentsTabOpen
      ? [{
          id: subagentsTabId,
          label: 'Sub-agents',
          running: subagents.some((subagent) => subagent.status === 'working'),
          type: 'subagents',
        }]
      : []),
    ...openProviderPanels.map((panel) => ({
      ...panel,
      label: panel.title,
      type: 'provider',
    })),
  ];
  const activeSideChat = sideChats.find((sideChat) => sideChat.id === activeTab) ?? null;
  const showingFiles = activeTab === filesTabId;
  const showingSubagents = activeTab === subagentsTabId;
  const showingTasks = activeTab === tasksTabId;
  const activeProviderPanel = openProviderPanels.find((panel) => panel.id === activeTab) ?? null;
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

  return (
    <aside className="auxiliary-panel" id="auxiliary-panel" aria-label="Auxiliary panel">
      <header className="auxiliary-panel-header">
        {tabs.length > 0 ? (
          <div className="auxiliary-tabs-row">
            <div className="auxiliary-tabs" role="tablist" aria-label="Auxiliary panel tabs">
              {tabs.map((tab, index) => (
                <div
                  key={tab.id}
                  className={`auxiliary-tab ${tab.type} ${tab.id === activeTab ? 'active' : ''}`}
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
                    {tab.type === 'tasks' ? (
                      <ListChecks size={14} aria-hidden="true" />
                    ) : tab.type === 'subagents' ? (
                      <Bot size={14} aria-hidden="true" />
                    ) : tab.type === 'files' ? (
                      <Files size={14} aria-hidden="true" />
                    ) : tab.type === 'provider' ? (
                      <Gauge size={14} aria-hidden="true" />
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
                    title={tab.type === 'subagents'
                      ? 'Close Sub-agents tab'
                      : `Close ${tab.label}`}
                    onClick={() => (
                      tab.type === 'tasks'
                        ? onCloseTasksTab()
                        : tab.type === 'subagents'
                          ? onCloseSubagentsTab()
                        : tab.type === 'files'
                          ? onCloseFilesTab()
                        : tab.type === 'provider'
                          ? onCloseProviderPanel(tab.id)
                          : onCloseSideChat(tab.id)
                    )}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            <AuxiliaryAddMenu
              providerPanels={providerPanels}
              canCreateSideChat={canCreateSideChat}
              onCreateSideChat={onCreateSideChat}
              onOpenFilesTab={onOpenFilesTab}
              onOpenTasksTab={onOpenTasksTab}
              onOpenSubagentsTab={onOpenSubagentsTab}
              onOpenProviderPanel={onOpenProviderPanel}
            />
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
        ) : (
          <div className="auxiliary-empty-header">
            <span>Auxiliary panel</span>
            <div className="auxiliary-empty-actions">
              <AuxiliaryAddMenu
                providerPanels={providerPanels}
                canCreateSideChat={canCreateSideChat}
                onCreateSideChat={onCreateSideChat}
                onOpenFilesTab={onOpenFilesTab}
                onOpenTasksTab={onOpenTasksTab}
                onOpenSubagentsTab={onOpenSubagentsTab}
                onOpenProviderPanel={onOpenProviderPanel}
              />
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
        {showingTasks ? (
          <div className="task-list">
            <header><strong>{tasks.filter((task) => task.done).length}/{tasks.length} completed</strong><span>Defined and updated by the agent</span></header>
            {tasks.map((task, index) => (
              <article className={`task-list-item${task.done ? ' done' : ''}`} key={`${index}-${task.title}`}>
                <span className="task-check" aria-label={task.done ? 'Completed' : 'Pending'}>
                  {task.done ? <Check size={13} aria-hidden="true" /> : index + 1}
                </span>
                <span><strong>{task.title}</strong>{task.description && <p>{task.description}</p>}{task.result && <small>{task.result}</small>}</span>
              </article>
            ))}
          </div>
        ) : showingFiles ? (
          <FilesPanel
            project={project}
            onAddToChat={onAddToChat}
            onAskInSideChat={onAskInSideChat}
            navigation={fileNavigation}
            onNavigationConsumed={onFileNavigationConsumed}
          />
        ) : activeProviderPanel ? (
          <ProviderPanel
            panel={activeProviderPanel}
            conversationId={conversationId}
          />
        ) : !hasActiveTab ? (
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
            <button type="button" onClick={onOpenFilesTab}>
              <Files size={16} aria-hidden="true" />
              <span>
                <strong>Files</strong>
                <small>Browse the current directory</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!canCreateSideChat}
              title={canCreateSideChat
                ? 'View tasks for this conversation'
                : 'Start a conversation before opening tasks'}
              onClick={onOpenTasksTab}
            >
              <ListChecks size={16} aria-hidden="true" />
              <span>
                <strong>Tasks</strong>
                <small>View this conversation's task list</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            <button type="button" onClick={onOpenSubagentsTab}>
              <Bot size={16} aria-hidden="true" />
              <span>
                <strong>Sub-agents</strong>
                <small>View orchestrated tasks</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            {providerPanels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                onClick={() => onOpenProviderPanel(panel.id)}
              >
                <Gauge size={16} aria-hidden="true" />
                <span>
                  <strong>{panel.title}</strong>
                  <small>Provided by {panel.providerName}</small>
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
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
                  <span className="subagent-avatar" aria-hidden="true">
                    <Avatar
                      size={32}
                      name={subagent.title}
                      variant="beam"
                      colors={subagentAvatarColors}
                    />
                    <span className={`subagent-status-dot ${subagent.status}`} />
                  </span>
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
            onImplementPlan={(options) => onImplementPlan(activeThread, currentModel, options)}
            questionRequest={questionRequests.find(
              (request) => request.conversationId === activeThread.id,
            ) ?? null}
            onAnswerQuestion={onAnswerQuestion}
            onStop={() => onStop(activeThread.id)}
            onCompress={() => onCompress(activeThread.id, currentModel)}
            onMentionSelection={onAddToChat}
            onAskSelection={activeThread.isSubagent ? undefined : onAskInSideChat}
            onFork={(conversationId, throughMessageId) => onFork(
              conversationId,
              throughMessageId,
            )}
            onRetry={(messageId) => onRetry(activeThread.id, messageId, currentModel)}
            onResume={(messageId, model) => onResume(activeThread.id, messageId, model)}
            onCancelQueued={(messageId) => onCancelQueued(activeThread.id, messageId)}
            onReorderQueued={(queueType, messageIds, steerMessageId, dispatchNext) => (
              onReorderQueued(
                activeThread.id,
                queueType,
                messageIds,
                steerMessageId,
                dispatchNext,
              )
            )}
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
            workMode={workMode}
            onWorkModeChange={onWorkModeChange}
            onGoalAction={(action, specification) => (
              onGoalAction(activeThread, action, specification)
            )}
            pendingAttachment={pendingSideChatAttachment?.conversationId === activeThread.id
              ? pendingSideChatAttachment.attachment
              : null}
            onPendingAttachmentConsumed={onPendingSideChatAttachmentConsumed}
            onOpenFileReference={onOpenFileReference}
            onFileReferenceAction={(action, reference) => onFileReferenceAction(
              action,
              reference,
              currentProject,
            )}
            messageDeliveryMode={messageDeliveryMode}
            defaultPermissionMode={defaultPermissionMode}
            draftKey={`aivax.composer.${
              activeThread.isSubagent ? 'subagent' : 'side'
            }.${activeThread.id}`}
          />
        ) : null}
      </div>
    </aside>
  );
}
