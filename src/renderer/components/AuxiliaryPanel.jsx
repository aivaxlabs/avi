import Avatar from 'boring-avatars';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  ClipboardCheck,
  Files,
  Gauge,
  GitPullRequest,
  MessageSquarePlus,
  ListChecks,
  Moon,
  Plus,
  X,
} from 'lucide-react';
import { ChatView } from './ChatView.jsx';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { FilesPanel } from './FilesPanel.jsx';
import { GitReviewPanel } from './GitReviewPanel.jsx';
import { ProviderPanel } from './ProviderPanel.jsx';

const subagentsTabId = 'subagents';
const filesTabId = 'files';
const gitReviewTabId = 'git-review';
const tasksTabId = 'tasks';
const botQueueTabId = 'bot-queue';
const subagentAvatarColors = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];

function AuxiliaryAddMenu({ panels }) {
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
          {panels.map((panel) => {
            const Icon = panel.icon;
            return (
              <DropdownMenuItem
                icon={<Icon size={14} />}
                key={panel.id}
                role="menuitem"
                disabled={panel.disabled}
                title={panel.title}
                onClick={() => {
                  setOpen(false);
                  panel.onOpen();
                }}
              >
                {panel.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu>
      )}
    </div>
  );
}

export function AuxiliaryPanel({
  sideChats,
  subagents,
  bots = [],
  botQueue = [],
  onResolveBotApproval,
  botQueueTabOpen = false,
  onOpenBotQueueTab,
  onCloseBotQueueTab,
  tasks = [],
  activeTab,
  activeSubagentId,
  messagesByConversation,
  running,
  semaphoreWaits = [],
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
  gitReviewTabOpen,
  subagentsTabOpen,
  tasksTabOpen,
  canCreateSideChat,
  onSelectTab,
  onCloseSideChat,
  onCloseFilesTab,
  onCloseGitReviewTab,
  onCloseSubagentsTab,
  onCloseTasksTab,
  onOpenFilesTab,
  onOpenGitReviewTab,
  onOpenTasksTab,
  onOpenSubagentsTab,
  onOpenProviderPanel,
  onCloseProviderPanel,
  onClosePanel,
  onCreateSideChat,
  onAddToChat,
  onAskInSideChat,
  onRunAgent,
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
  onRunSemaphoreNow,
  onCancelSemaphore,
  semaphoreResolving = false,
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
  onUltraModeChange,
  onGoalAction,
  messageDeliveryMode = 'queue',
  defaultPermissionMode = 'approve_for_me',
  continuationRepliesEnabled = true,
}) {
  const availablePanels = [
    {
      id: 'side-chat',
      label: 'Side chat',
      description: 'Fork this conversation',
      icon: MessageSquarePlus,
      disabled: !canCreateSideChat,
      title: canCreateSideChat
        ? 'Create a side chat'
        : 'Start a conversation before creating a side chat',
      onOpen: onCreateSideChat,
    },
    {
      id: filesTabId,
      label: 'Files',
      description: 'Browse the current directory',
      icon: Files,
      disabled: false,
      title: 'Browse the current directory',
      onOpen: onOpenFilesTab,
    },
    {
      id: gitReviewTabId,
      label: 'Git Review',
      description: 'Review changes and create commits',
      icon: GitPullRequest,
      disabled: !canCreateSideChat,
      title: canCreateSideChat
        ? 'Review Git changes'
        : 'Start a conversation before opening Git Review',
      onOpen: onOpenGitReviewTab,
    },
    {
      id: tasksTabId,
      label: 'Tasks',
      description: "View this conversation's task list",
      icon: ListChecks,
      disabled: !canCreateSideChat,
      title: canCreateSideChat
        ? 'View tasks for this conversation'
        : 'Start a conversation before opening tasks',
      onOpen: onOpenTasksTab,
    },
    {
      id: subagentsTabId,
      label: 'Sub-agents',
      description: 'View orchestrated tasks',
      icon: Bot,
      disabled: false,
      title: 'View orchestrated tasks',
      onOpen: onOpenSubagentsTab,
    },
    {
      id: botQueueTabId,
      label: 'Bot queue',
      description: 'Review pending bot approvals',
      icon: ListChecks,
      disabled: false,
      title: 'Review pending bot approvals',
      onOpen: onOpenBotQueueTab,
    },
    ...providerPanels.map((panel) => ({
      id: panel.id,
      label: panel.title,
      description: `Provided by ${panel.providerName}`,
      icon: Gauge,
      disabled: false,
      title: `${panel.title} - ${panel.providerName}`,
      onOpen: () => onOpenProviderPanel(panel.id),
    })),
  ];
  const tabs = [
    ...sideChats.map((sideChat) => ({
      id: sideChat.id,
      label: sideChat.title,
      running: Boolean(running[sideChat.id]),
      sleeping: semaphoreWaits.some((wait) => wait.conversationId === sideChat.id),
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
    ...(gitReviewTabOpen
      ? [{ id: gitReviewTabId, label: 'Git Review', running: false, type: 'git-review' }]
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
    ...(botQueueTabOpen
      ? [{
          id: botQueueTabId,
          label: `Bot queue${botQueue.length > 0 ? ` (${botQueue.length})` : ''}`,
          running: false,
          type: 'bot-queue',
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
  const showingGitReview = activeTab === gitReviewTabId;
  const showingSubagents = activeTab === subagentsTabId;
  const showingTasks = activeTab === tasksTabId;
  const showingBotQueue = activeTab === botQueueTabId;
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
                    {tab.type === 'tasks' ? (
                      <ListChecks size={14} aria-hidden="true" />
                    ) : tab.type === 'subagents' ? (
                      <Bot size={14} aria-hidden="true" />
                    ) : tab.type === 'bot-queue' ? (
                      <ClipboardCheck size={14} aria-hidden="true" />
                    ) : tab.type === 'files' ? (
                      <Files size={14} aria-hidden="true" />
                    ) : tab.type === 'git-review' ? (
                      <GitPullRequest size={14} aria-hidden="true" />
                    ) : tab.type === 'provider' ? (
                      <Gauge size={14} aria-hidden="true" />
                    ) : tab.sleeping ? (
                      <Moon size={14} aria-label="Waiting for semaphore" />
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
                        : tab.type === 'bot-queue'
                          ? onCloseBotQueueTab()
                        : tab.type === 'files'
                          ? onCloseFilesTab()
                        : tab.type === 'git-review'
                          ? onCloseGitReviewTab()
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
            <AuxiliaryAddMenu panels={availablePanels} />
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
              <AuxiliaryAddMenu panels={availablePanels} />
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
        {showingBotQueue ? (
          <div className="bot-queue">
            <header>
              <strong>{botQueue.length} pending</strong>
              <span>Approvals requested by bots</span>
            </header>
            {botQueue.length === 0 ? (
              <div className="bot-queue-empty">
                <Bot size={20} aria-hidden="true" />
                <strong>Nothing waiting</strong>
                <span>Bot approval requests appear here.</span>
              </div>
            ) : (
              botQueue.map((item) => (
                <article className="bot-queue-item" key={item.id}>
                  <header>
                    <strong>{item.title}</strong>
                    <small>
                      {item.botName}
                      {item.kind === 'tool' ? ' · tool approval' : ' · work'}
                      {` · ${new Date(item.createdAt).toLocaleString()}`}
                    </small>
                  </header>
                  {item.context && <p>{item.context}</p>}
                  <div className="bot-queue-actions">
                    <button
                      className="bot-queue-approve"
                      type="button"
                      onClick={() => onResolveBotApproval?.(item.id, true)}
                    >
                      <Check size={14} aria-hidden="true" />
                      <span>Approve</span>
                    </button>
                    <button
                      className="bot-queue-deny"
                      type="button"
                      onClick={() => onResolveBotApproval?.(item.id, false)}
                    >
                      <X size={14} aria-hidden="true" />
                      <span>Deny</span>
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        ) : showingTasks ? (
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
        ) : showingGitReview ? (
          <GitReviewPanel
            conversationId={conversationId}
            model={fallbackModel}
            project={project}
            onAddToChat={onAddToChat}
            onAskInSideChat={canCreateSideChat ? onAskInSideChat : undefined}
            onRunAgent={onRunAgent}
          />
        ) : activeProviderPanel ? (
          <ProviderPanel
            panel={activeProviderPanel}
            conversationId={conversationId}
          />
        ) : !hasActiveTab ? (
          <div className="auxiliary-empty">
            <p>Open in this panel</p>
            {availablePanels.map((panel) => {
              const Icon = panel.icon;
              return (
                <button
                  key={panel.id}
                  type="button"
                  disabled={panel.disabled}
                  title={panel.title}
                  onClick={panel.onOpen}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{panel.label}</strong>
                    <small>{panel.description}</small>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              );
            })}
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
                    {subagent.status === 'sleeping' ? (
                      <Moon
                        className="subagent-sleep-indicator"
                        size={12}
                        aria-label="Waiting for semaphore"
                      />
                    ) : (
                      <span className={`subagent-status-dot ${subagent.status}`} />
                    )}
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
            semaphoreWait={semaphoreWaits.find(
              (wait) => wait.conversationId === activeThread.id,
            ) ?? null}
            onRunSemaphoreNow={() => onRunSemaphoreNow(activeThread.id)}
            onCancelSemaphore={() => onCancelSemaphore(activeThread.id)}
            semaphoreResolving={semaphoreResolving}
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
            workMode={activeThread.orchestrationMode === 'plan' ? 'plan' : workMode}
            onWorkModeChange={onWorkModeChange}
            ultraMode={activeThread.orchestrationMode === 'ultra'}
            onUltraModeChange={onUltraModeChange}
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
            continuationRepliesEnabled={continuationRepliesEnabled}
            draftKey={`aivax.composer.${
              activeThread.isSubagent ? 'subagent' : 'side'
            }.${activeThread.id}`}
          />
        ) : null}
      </div>
    </aside>
  );
}
