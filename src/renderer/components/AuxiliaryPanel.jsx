import Avatar from 'boring-avatars';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Files,
  Gauge,
  GitPullRequest,
  MessageSquarePlus,
  ListChecks,
  Moon,
  Network,
  Plus,
  Shield,
  X,
} from 'lucide-react';
import { hasOpenBotUserAction } from '../../shared/bot-work-items.js';
import { ChatView } from './ChatView.jsx';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { FilesPanel } from './FilesPanel.jsx';
import { GitReviewPanel } from './GitReviewPanel.jsx';
import { ProviderPanel } from './ProviderPanel.jsx';

const emptyList = Object.freeze([]);
const emptyObject = Object.freeze({});
const subagentsTabId = 'subagents';
const filesTabId = 'files';
const gitReviewTabId = 'git-review';
const tasksTabId = 'tasks';
const botQueueTabId = 'bot-queue';
const botPanelTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'all-work', label: 'All work' },
  { id: 'activity', label: 'Activity' },
];
const subagentAvatarColors = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];
const botWorkMarkdownComponents = {
  a: ({ children, href, node: _node, ...props }) => (
    <a
      href={href}
      {...props}
      onClick={href && /^https?:\/\//i.test(href) ? (event) => {
        event.preventDefault();
        window.chatApp.app.openExternal(href);
      } : undefined}
    >
      {children}
    </a>
  ),
};
const botPriorityOrder = Object.freeze({ critical: 0, high: 1, normal: 2, low: 3 });
const botWorkStatusOptions = Object.freeze([
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]);

const botUserActionCopy = Object.freeze({
  approval: 'You need to approve this.',
  review: 'You need to review this.',
  answer: 'You need to answer this.',
});

function BotWorkCard({ item, expanded = false, onOpen, onOpenFileReference, onResolveApproval, variant = 'summary' }) {
  const actionType = item.approval ? 'approval' : item.attention?.type;
  const previewText = hasOpenBotUserAction(item)
    ? botUserActionCopy[actionType]
    : item.state === 'completed'
      ? item.summary || item.lastProgress || 'Work completed.'
      : item.state === 'planned'
        ? item.nextStep || 'No next step reported yet.'
        : item.lastProgress || item.summary || 'No progress reported yet.';

  if (!expanded) {
    return (
      <button
        className={`bot-work-card bot-work-preview state-${item.state} ${variant}${hasOpenBotUserAction(item) ? ' needs-attention' : ''}`}
        type="button"
        aria-label={`Open work item: ${item.title}`}
        onClick={onOpen}
      >
        <span className="bot-work-preview-heading">
          <strong>{item.title}</strong>
          <ChevronRight size={14} aria-hidden="true" />
        </span>
        <span className="bot-work-preview-summary">{previewText}</span>
      </button>
    );
  }

  return (
    <article className={`bot-work-card state-${item.state} expanded${hasOpenBotUserAction(item) ? ' needs-attention' : ''}`}>
      <header>
        <div className="bot-work-card-heading">
          <strong>{item.title}</strong>
          <span className={`bot-work-state ${item.state}`}>{item.state}</span>
          {item.priority !== 'normal' && (
            <span className={`bot-work-priority ${item.priority}`}>{item.priority}</span>
          )}
        </div>
        <small>{new Date(item.updatedAt).toLocaleString()}</small>
      </header>
      <div className="bot-work-card-body">
        <div className="bot-markdown-body bot-work-objective">
          <h2>Objective</h2>
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={botWorkMarkdownComponents}>
              {item.objective || ''}
            </ReactMarkdown>
          </div>
        </div>
        {item.summary && (
          <div className="bot-markdown-body bot-work-summary">
            <h2>Summary</h2>
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={botWorkMarkdownComponents}>
                {item.summary}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {item.lastProgress && (
          <dl className="bot-work-fields">
            <dt>Latest progress</dt>
            <dd>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={botWorkMarkdownComponents}>
                  {item.lastProgress}
                </ReactMarkdown>
              </div>
            </dd>
          </dl>
        )}
      </div>
      {item.attention && (
        <div className="bot-work-notice attention">
          <Shield size={14} aria-hidden="true" />
          <span><strong>{item.attention.type}</strong>{item.attention.summary}</span>
        </div>
      )}
      {item.blocker && (
        <div className="bot-work-notice blocker">
          <AlertTriangle size={14} aria-hidden="true" />
          <span><strong>Blocked by {item.blocker.waitingOn}</strong>{item.blocker.reason}</span>
        </div>
      )}
      {item.workers?.length > 0 && (
        <div className="bot-work-chips" aria-label="Workers">
          {item.workers.map((worker) => (
            <span className={`bot-worker-chip ${worker.status}`} key={worker.id}>
              <span aria-hidden="true" />{worker.title || worker.id} · {worker.status}
            </span>
          ))}
        </div>
      )}
      {item.evidence?.length > 0 && (
        <dl className="bot-work-fields">
          <dt>Evidence</dt>
          <dd>
            <ul className="bot-evidence-list">
              {item.evidence.map((entry) => {
                const evidence = typeof entry === 'string'
                  ? { type: /^https?:\/\//i.test(entry) ? 'external_reference' : 'text', value: entry }
                  : entry;
                const key = `${evidence.type}:${evidence.value}`;
                return (
                  <li key={key}>
                    {evidence.type === 'file_reference' ? (
                      <button type="button" onClick={() => onOpenFileReference?.({ path: evidence.value, lineFrom: null, lineTo: null })}>
                        {evidence.value}
                      </button>
                    ) : evidence.type === 'external_reference' ? (
                      <a href={evidence.value} target="_blank" rel="noreferrer">
                        {evidence.value}
                      </a>
                    ) : evidence.value}
                  </li>
                );
              })}
            </ul>
          </dd>
        </dl>
      )}
      {item.approval && (
        <div className="bot-approval-details">
          {item.approval.kind === 'tool' && (
            <>
              <dl>
                <dt>Tool</dt><dd><code>{item.approval.toolName}</code></dd>
                <dt>Workspace</dt><dd><code>{item.approval.workspacePath || 'Not specified'}</code></dd>
              </dl>
              <pre>{JSON.stringify(item.approval.input ?? null, null, 2)}</pre>
            </>
          )}
          <p>{item.approval.prompt}</p>
          <div className="bot-queue-actions">
            <button className="bot-queue-approve" type="button" onClick={() => onResolveApproval?.(item.approval.id, true)}>
              <Check size={14} aria-hidden="true" /><span>Approve</span>
            </button>
            <button className="bot-queue-deny" type="button" onClick={() => onResolveApproval?.(item.approval.id, false)}>
              <X size={14} aria-hidden="true" /><span>Deny</span>
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

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

export const AuxiliaryPanel = memo(function AuxiliaryPanel({
  sideChats,
  subagents,
  bots = emptyList,
  botWorkStateByBot = emptyObject,
  onResolveBotApproval,
  onMentionBotWork,
  onSetBotWorkState,
  botQueueTabOpen = false,
  selectedBotId,
  onSelectBot,
  onOpenBotQueueTab,
  onCloseBotQueueTab,
  tasks = emptyList,
  activeTab,
  activeSubagentId,
  visibleMessagesByConversation,
  historyPagesByConversation,
  onLoadOlderHistory,
  visibleRunning,
  semaphoreWaits = emptyList,
  models,
  favorites,
  recentModels,
  recentProjects,
  fallbackModel,
  conversationId,
  project,
  providerPanels = emptyList,
  openProviderPanels = emptyList,
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
  questionRequests = emptyList,
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
  const [botPanelTab, setBotPanelTab] = useState('overview');
  const [botWorkFilter, setBotWorkFilter] = useState('all');
  const [expandedBotItem, setExpandedBotItem] = useState(null);
  const botWorkDialogRef = useRef(null);
  const botWorkOpenerRef = useRef(null);
  const [workActionsMenu, setWorkActionsMenu] = useState(null);
  const workActionsButtonRef = useRef(null);
  const [workStatusDialogOpen, setWorkStatusDialogOpen] = useState(false);
  const workStatusDialogRef = useRef(null);
  const [workStatusError, setWorkStatusError] = useState(null);
  const [workStatusUpdating, setWorkStatusUpdating] = useState(false);

  useEffect(() => {
    if (!expandedBotItem || !botWorkDialogRef.current) return undefined;
    const dialog = botWorkDialogRef.current;
    dialog.showModal();
    queueMicrotask(() => dialog.querySelector('button')?.focus());
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [expandedBotItem]);

  useEffect(() => {
    if (!workActionsMenu) return undefined;
    const close = (event) => {
      if (workActionsButtonRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.dropdown-menu')) return;
      setWorkActionsMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setWorkActionsMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [workActionsMenu]);

  useEffect(() => {
    if (!workStatusDialogOpen || !workStatusDialogRef.current) return undefined;
    const dialog = workStatusDialogRef.current;
    dialog.showModal();
    queueMicrotask(() => dialog.querySelector('button:not([disabled])')?.focus());
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [workStatusDialogOpen]);

  useEffect(() => {
    setWorkActionsMenu(null);
    setWorkStatusDialogOpen(false);
    setWorkStatusError(null);
    setWorkStatusUpdating(false);
  }, [expandedBotItem?.id]);

  function toggleWorkActionsMenu(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setWorkActionsMenu((open) => (open ? null : {
      top: Math.min(rect.bottom + 4, window.innerHeight - 150),
      left: Math.min(rect.right - 180, window.innerWidth - 200),
    }));
  }

  async function handleSetWorkStatus(state) {
    if (!expandedBotItem || workStatusUpdating) return;
    setWorkStatusUpdating(true);
    setWorkStatusError(null);
    try {
      const updated = await onSetBotWorkState(expandedBotItem, state);
      setExpandedBotItem((current) => (
        current?.id === updated.id ? { ...updated, workers: current.workers } : current
      ));
      workStatusDialogRef.current?.close();
    } catch (error) {
      setWorkStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkStatusUpdating(false);
    }
  }

  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? bots[0] ?? null;
  const selectedBotState = selectedBot
    ? botWorkStateByBot[selectedBot.id] ?? { items: emptyList, activity: emptyList, untrackedWorkers: emptyList, error: null }
    : { items: emptyList, activity: emptyList, untrackedWorkers: emptyList, error: null };
  const currentBotWork = selectedBotState.items.filter((item) => (
    !hasOpenBotUserAction(item)
    && (item.state === 'active' || item.workers?.some((worker) => worker.running))
  ));
  const botWorkNeedingAttention = selectedBotState.items.filter(hasOpenBotUserAction);
  const recentlyCompletedBotWork = selectedBotState.items
    .filter((item) => item.state === 'completed')
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    .slice(0, 5);
  const upcomingBotWork = selectedBotState.items
    .filter((item) => item.nextStep && item.state === 'planned' && !hasOpenBotUserAction(item))
    .sort((left, right) => (
      botPriorityOrder[left.priority] - botPriorityOrder[right.priority]
      || new Date(right.updatedAt) - new Date(left.updatedAt)
    ));
  const filteredBotWork = selectedBotState.items
    .filter((item) => botWorkFilter === 'all' || item.state === botWorkFilter)
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  const recentBotActivity = selectedBotState.activity
    .toSorted((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
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
      icon: Network,
      disabled: false,
      title: 'View orchestrated tasks',
      onOpen: onOpenSubagentsTab,
    },
    {
      id: botQueueTabId,
      label: 'Bots',
      description: 'View bot work logs',
      icon: Bot,
      disabled: false,
      title: 'View bot work logs',
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
      running: Boolean(visibleRunning[sideChat.id]),
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
        label: 'Bots',
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
    <>
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
                        <Network size={14} aria-hidden="true" />
                      ) : tab.type === 'bot-queue' ? (
                        <Bot size={14} aria-hidden="true" />
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
          className={`auxiliary-content${activeSubagent ? ' with-toolbar' : ''}${hasActiveTab ? '' : ' is-empty'
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
              {bots.length === 0 ? (
                <div className="bot-queue-empty">
                  <Bot size={20} aria-hidden="true" />
                  <strong>No bots</strong>
                  <span>Create a bot to see its current work and recent outcomes.</span>
                </div>
              ) : (
                <>
                  <label className="bot-work-selector">
                    <span className="sr-only">Bot</span>
                    <select value={selectedBot?.id ?? ''} onChange={(event) => onSelectBot(event.target.value)}>
                      {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
                    </select>
                  </label>
                  <div className="bot-work-tabs" role="tablist" aria-label="Bot work views">
                    {botPanelTabs.map((tab, index) => (
                      <button
                        id={`bot-work-tab-${tab.id}`}
                        className={tab.id === botPanelTab ? 'active' : ''}
                        type="button"
                        role="tab"
                        aria-selected={tab.id === botPanelTab}
                        aria-controls="bot-work-view"
                        tabIndex={tab.id === botPanelTab ? 0 : -1}
                        key={tab.id}
                        onClick={() => setBotPanelTab(tab.id)}
                        onKeyDown={(event) => {
                          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                          event.preventDefault();
                          const nextIndex = event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? botPanelTabs.length - 1
                              : (index + (event.key === 'ArrowRight' ? 1 : -1) + botPanelTabs.length)
                              % botPanelTabs.length;
                          const next = botPanelTabs[nextIndex];
                          setBotPanelTab(next.id);
                          queueMicrotask(() => document.getElementById(`bot-work-tab-${next.id}`)?.focus());
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div id="bot-work-view" className="bot-work-view" role="tabpanel" aria-labelledby={`bot-work-tab-${botPanelTab}`}>
                    {selectedBotState.error && (
                      <div className="bot-work-warning"><AlertTriangle size={15} aria-hidden="true" /><span>{selectedBotState.error}</span></div>
                    )}
                    {botPanelTab === 'overview' && (
                      <div className="bot-work-overview">
                        {selectedBotState.untrackedWorkers.length > 0 && (
                          <section className="bot-work-section">
                            <header><div><AlertTriangle size={14} aria-hidden="true" /><strong>Untracked workers</strong></div><small>{selectedBotState.untrackedWorkers.length}</small></header>
                            <div className="bot-work-warning">
                              <span>{selectedBotState.untrackedWorkers.map((worker) => worker.title || worker.id).join(', ')} must be attached to a work item or explained.</span>
                            </div>
                          </section>
                        )}
                        {[
                          ['Current work', currentBotWork, 'summary'],
                          ['Needs your attention', botWorkNeedingAttention, 'attention'],
                          ['Recently completed', recentlyCompletedBotWork, 'completed'],
                          ['Up next', upcomingBotWork, 'up-next'],
                        ].map(([title, items, variant]) => (
                          <section className="bot-work-section" key={title}>
                            <header><strong>{title}</strong><small>{items.length}</small></header>
                            {items.length === 0 ? <p className="bot-work-section-empty">Nothing here right now.</p> : items.map((item) => (
                              <BotWorkCard
                                item={item}
                                key={`${title}-${item.id}`}
                                variant={variant}
                                onResolveApproval={onResolveBotApproval}
                                onOpenFileReference={onOpenFileReference}
                                onOpen={(event) => {
                                  botWorkOpenerRef.current = event.currentTarget;
                                  setExpandedBotItem(item);
                                }}
                              />
                            ))}
                          </section>
                        ))}
                        <section className="bot-work-section">
                          <header><strong>Recent activity</strong><small>{Math.min(recentBotActivity.length, 8)}</small></header>
                          {recentBotActivity.length === 0 ? <p className="bot-work-section-empty">No material activity yet.</p> : (
                            <ol className="bot-activity-list">
                              {recentBotActivity.slice(0, 8).map((entry) => (
                                <li key={entry.id}><span className={`bot-activity-dot ${entry.type}`} /><div><strong>{entry.summary}</strong>{entry.details && <p>{entry.details}</p>}<small>{entry.type} · {new Date(entry.createdAt).toLocaleString()}</small></div></li>
                              ))}
                            </ol>
                          )}
                        </section>
                      </div>
                    )}
                    {botPanelTab === 'all-work' && (
                      <div className="bot-all-work">
                        <label className="bot-work-filter">
                          <span>State</span>
                          <select value={botWorkFilter} onChange={(event) => setBotWorkFilter(event.target.value)}>
                            <option value="all">All</option>
                            <option value="planned">Planned</option>
                            <option value="active">Active</option>
                            <option value="waiting">Waiting</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </label>
                        {filteredBotWork.length === 0 ? <div className="bot-queue-empty"><Bot size={20} aria-hidden="true" /><strong>No work items</strong><span>No items match this state.</span></div> : filteredBotWork.map((item) => (
                          <BotWorkCard
                            item={item}
                            key={item.id}
                            onResolveApproval={onResolveBotApproval}
                            onOpenFileReference={onOpenFileReference}
                            onOpen={(event) => {
                              botWorkOpenerRef.current = event.currentTarget;
                              setExpandedBotItem(item);
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {botPanelTab === 'activity' && (
                      recentBotActivity.length === 0 ? <div className="bot-queue-empty"><Bot size={20} aria-hidden="true" /><strong>No activity</strong><span>Material progress will appear here.</span></div> : (
                        <ol className="bot-activity-list standalone">
                          {recentBotActivity.map((entry) => (
                            <li key={entry.id}><span className={`bot-activity-dot ${entry.type}`} /><div><strong>{entry.summary}</strong>{entry.details && <p>{entry.details}</p>}<small>{entry.type} · {new Date(entry.createdAt).toLocaleString()}</small></div></li>
                          ))}
                        </ol>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          ) : showingTasks ? (
            <div className="task-list">
              <header><strong>{tasks.filter((task) => task.done).length}/{tasks.length} completed</strong><span>Defined and updated by the agent</span></header>
              {tasks.map((task, index) => {
                const inconclusive = task.status === 'inconclusive';
                return (
                  <article className={`task-list-item${task.done ? ' done' : ''}${inconclusive ? ' blocked' : ''}`} key={`${index}-${task.title}`}>
                    <span className="task-check" aria-label={task.done ? 'Completed' : inconclusive ? 'Inconclusive' : 'Pending'}>
                      {task.done ? <Check size={13} aria-hidden="true" /> : inconclusive ? <AlertTriangle size={13} aria-hidden="true" /> : index + 1}
                    </span>
                    <span><strong>{task.title}</strong>{task.description && <p>{task.description}</p>}{task.result && <small>{task.result}</small>}</span>
                  </article>
                );
              })}
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
              <Network size={20} aria-hidden="true" />
              <strong>No sub-agents yet</strong>
              <span>Sub-agents appear here when the orchestrator starts them.</span>
            </div>
          ) : showingSubagents && !activeSubagent ? (
            <div className="subagent-list">
              {subagents.map((subagent) => {
                const assignment = (visibleMessagesByConversation[subagent.id] ?? emptyList)
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
                      <span>{subagent.isRubberDuck
                        ? subagent.firstPrompt || 'General execution review'
                        : assignment || subagent.firstPrompt || 'Waiting for an assignment'}</span>
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
              currentMessages={visibleMessagesByConversation[activeThread.id] ?? emptyList}
              messagesLoaded={historyPagesByConversation[activeThread.id]?.loaded ?? false}
              historyHasMore={historyPagesByConversation[activeThread.id]?.hasMore ?? false}
              historyLoading={historyPagesByConversation[activeThread.id]?.loading ?? false}
              onLoadOlderHistory={() => onLoadOlderHistory(activeThread.id)}
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
              isRunning={Boolean(visibleRunning[activeThread.id])}
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
              onAskSelection={activeThread.isSubagent || activeThread.isRubberDuck ? undefined : onAskInSideChat}
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
              onChooseProject={() => { }}
              onUseHome={() => { }}
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
              draftKey={`aivax.composer.${activeThread.isSubagent ? 'subagent' : 'side'
                }.${activeThread.id}`}
            />
          ) : null}
        </div>
      </aside>
      {expandedBotItem && createPortal(
        <dialog
          ref={botWorkDialogRef}
          className="bot-work-dialog"
          aria-labelledby="bot-work-dialog-title"
          onClose={() => {
            setExpandedBotItem(null);
            queueMicrotask(() => botWorkOpenerRef.current?.focus());
          }}
        >
          <header className="dialog-header">
            <div>
              <h2 id="bot-work-dialog-title">{expandedBotItem.title}</h2>
              <p>{expandedBotItem.state} · updated {new Date(expandedBotItem.updatedAt).toLocaleString()}</p>
            </div>
            <div className="dialog-header-actions">
              <button
                ref={workActionsButtonRef}
                className="bot-work-actions-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={Boolean(workActionsMenu)}
                onClick={toggleWorkActionsMenu}
              >
                Actions
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              <button className="icon-button tiny" type="button" aria-label="Close work item" title="Close" onClick={() => botWorkDialogRef.current?.close()}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="bot-work-dialog-content">
            <BotWorkCard item={expandedBotItem} expanded onResolveApproval={onResolveBotApproval} onOpenFileReference={onOpenFileReference} />
            <dl className="bot-work-detail-fields">
              <dt>Created</dt><dd>{new Date(expandedBotItem.createdAt).toLocaleString()}</dd>
              {expandedBotItem.completedAt && <><dt>Completed</dt><dd>{new Date(expandedBotItem.completedAt).toLocaleString()}</dd></>}
              <dt>Work item ID</dt><dd>{expandedBotItem.id}</dd>
              {expandedBotItem.workerThreadIds?.length > 0 && <><dt>Worker thread IDs</dt><dd>{expandedBotItem.workerThreadIds.map((id) => <span key={id}>{id}</span>)}</dd></>}
            </dl>
          </div>
        </dialog>,
        document.body,
      )}
      {expandedBotItem && workActionsMenu && botWorkDialogRef.current && createPortal(
        <DropdownMenu
          fixed
          role="menu"
          aria-label={`Actions for ${expandedBotItem.title}`}
          style={{ top: workActionsMenu.top, left: workActionsMenu.left }}
        >
          <DropdownMenuItem
            icon={<MessageSquarePlus size={14} />}
            role="menuitem"
            onClick={() => {
              setWorkActionsMenu(null);
              onMentionBotWork(expandedBotItem);
              botWorkDialogRef.current?.close();
            }}
          >
            Mention in chat
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ListChecks size={14} />}
            role="menuitem"
            disabled={Boolean(expandedBotItem.approval)}
            title={expandedBotItem.approval ? 'Resolve the pending approval first.' : undefined}
            onClick={() => {
              setWorkActionsMenu(null);
              setWorkStatusError(null);
              setWorkStatusDialogOpen(true);
            }}
          >
            Set status
          </DropdownMenuItem>
        </DropdownMenu>,
        botWorkDialogRef.current,
      )}
      {expandedBotItem && workStatusDialogOpen && createPortal(
        <dialog
          ref={workStatusDialogRef}
          className="bot-work-status-dialog"
          aria-labelledby="bot-work-status-dialog-title"
          onClose={() => setWorkStatusDialogOpen(false)}
        >
          <header className="dialog-header">
            <div>
              <h2 id="bot-work-status-dialog-title">Set status</h2>
              <p>{expandedBotItem.title}</p>
            </div>
            <button
              className="icon-button tiny"
              type="button"
              aria-label="Close status dialog"
              title="Close"
              onClick={() => workStatusDialogRef.current?.close()}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="bot-work-status-options">
            {botWorkStatusOptions.map((option) => {
              const isCurrent = option.value === expandedBotItem.state;
              const waitingNeedsContext = option.value === 'waiting'
                && !expandedBotItem.attention
                && !expandedBotItem.blocker
                && !expandedBotItem.approval;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`bot-work-status-option${isCurrent ? ' current' : ''}`}
                  disabled={isCurrent || workStatusUpdating || waitingNeedsContext}
                  title={waitingNeedsContext
                    ? 'Waiting work needs an attention or blocker context, which only the bot can set.'
                    : undefined}
                  onClick={() => handleSetWorkStatus(option.value)}
                >
                  <span className={`bot-work-state ${option.value}`}>{option.label}</span>
                  {isCurrent && <small>Current</small>}
                </button>
              );
            })}
          </div>
          {workStatusError && <p className="bot-work-status-error" role="alert">{workStatusError}</p>}
        </dialog>,
        document.body,
      )}
    </>
  );
});
