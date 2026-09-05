import Avatar from 'boring-avatars';
import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Files,
  Gauge,
  GitPullRequest,
  Inbox,
  BookOpen,
  MessageSquarePlus,
  ListChecks,
  Moon,
  Network,
  Paperclip,
  Plus,
  Send,
  Shield,
  X,
} from 'lucide-react';
import { hasOpenBotUserAction } from '../../shared/bot-work-items.js';
import { fileToAttachment, formatBytes } from '../lib/files.js';
import { AttachmentImage, AttachmentVideo } from './AttachmentVideo.jsx';
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
  { id: 'inbox', label: 'Inbox' },
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
function BotAttachments({ attachments, onRemove }) {
  return attachments.length > 0 && (
    <ul className="bot-inbox-attachments" aria-label="Attachments">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          {attachment.kind === 'image_url' ? (
            <AttachmentImage attachment={attachment} alt={attachment.name} />
          ) : attachment.kind === 'video_url' ? (
            <AttachmentVideo attachment={attachment} controls preload="metadata" />
          ) : null}
          {typeof attachment.text === 'string' ? (
            <details><summary>{attachment.name}</summary><pre>{attachment.text}</pre></details>
          ) : <span title={attachment.path || attachment.name}>{attachment.name}</span>}
          <small>{formatBytes(attachment.size)}</small>
          {onRemove && (
            <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)}>
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
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
  botDataByBot = emptyObject,
  botsLoading = false,
  onResolveBotApproval,
  onReplyBotPendency,
  onCompleteBotPendency,
  botQueueTabOpen = false,
  selectedBotId,
  inboxNavigation,
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
  const [botPanelTab, setBotPanelTab] = useState('inbox');
  const [inboxFilter, setInboxFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [botQuery, setBotQuery] = useState('');
  const [selectedPendencyId, setSelectedPendencyId] = useState(() => inboxNavigation?.botId === selectedBotId ? inboxNavigation.pendencyId : null);
  const [pendencyDrafts, setPendencyDrafts] = useState({});
  const [pendencyFeedback, setPendencyFeedback] = useState({});
  const [pendencyBusy, setPendencyBusy] = useState(false);
  const pendencyBusyRef = useRef(false);
  const pendencyHeadingRef = useRef(null);
  const pendencyOpenerIdRef = useRef(null);
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? bots[0] ?? null;
  const selectedBotState = botDataByBot[selectedBot?.id] ?? { inbox: emptyList, activity: emptyList, error: null };
  const selectedBotError = selectedBotState.errors ? selectedBotState.errors[botPanelTab] : selectedBotState.error;
  const selectedPendency = selectedBotState.inbox.find((item) => item.id === selectedPendencyId) ?? null;
  const draftKey = `${selectedBot?.id}:${selectedPendency?.id}`;
  const draft = pendencyDrafts[draftKey] ?? { content: '', attachments: emptyList };
  const feedback = pendencyFeedback[draftKey];
  const query = botQuery.trim().toLowerCase();
  const filteredInbox = selectedBotState.inbox.filter((item) => (
    (inboxFilter === 'all' || (inboxFilter === 'needs-user' ? hasOpenBotUserAction(item) : item.status === inboxFilter))
    && (!query || `${item.title} ${item.messages.map((message) => message.content).join(' ')}`.toLowerCase().includes(query))
  )).toSorted((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  const recentBotActivity = selectedBotState.activity.filter((entry) => (
    (activityFilter === 'all' || entry.category === activityFilter)
    && (!query || `${entry.title} ${entry.description}`.toLowerCase().includes(query))
  )).toSorted((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  useEffect(() => {
    if (selectedPendency?.id && botPanelTab === 'inbox') pendencyHeadingRef.current?.focus();
  }, [selectedPendency?.id, botPanelTab]);

  function updatePendencyDraft(patch) {
    setPendencyDrafts((current) => ({
      ...current,
      [draftKey]: { content: '', attachments: [], ...current[draftKey], ...patch },
    }));
  }

  async function attachToPendency(files) {
    if (pendencyBusyRef.current) return;
    pendencyBusyRef.current = true;
    setPendencyBusy(true);
    try {
      const attachments = files
        ? await Promise.all(files.map((file) => fileToAttachment(file, 'clipboard')))
        : await window.chatApp.files.select();
      setPendencyDrafts((current) => ({
        ...current,
        [draftKey]: {
          content: current[draftKey]?.content ?? '',
          attachments: [...(current[draftKey]?.attachments ?? []), ...attachments],
        },
      }));
    } catch (error) {
      setPendencyFeedback((current) => ({ ...current, [draftKey]: { error: true, text: error.message || String(error) } }));
    } finally {
      pendencyBusyRef.current = false;
      setPendencyBusy(false);
    }
  }

  async function actOnPendency(action) {
    if (!selectedPendency || pendencyBusyRef.current) return;
    if (action === 'reply' && !draft.content.trim() && !draft.attachments.length) return;
    pendencyBusyRef.current = true;
    setPendencyBusy(true);
    setPendencyFeedback((current) => ({ ...current, [draftKey]: null }));
    try {
      const result = action === 'reply'
        ? await onReplyBotPendency({ botId: selectedBot.id, pendencyId: selectedPendency.id, ...draft })
        : action === 'complete'
          ? await onCompleteBotPendency({ botId: selectedBot.id, pendencyId: selectedPendency.id })
          : await onResolveBotApproval(selectedPendency.approval.id, action === 'approve');
      if (action === 'reply') updatePendencyDraft({ content: '', attachments: [] });
      setPendencyFeedback((current) => ({ ...current, [draftKey]: {
        error: result?.delivered === false,
        text: result?.delivered === false
          ? `Saved in Inbox, but not delivered to the bot: ${result.error || 'Delivery unavailable.'} Do not resend this message; open the main thread to resume it.`
          : action === 'reply' ? 'Reply sent to the bot.' : action === 'complete' ? 'Pendency completed.' : 'Decision sent to the bot.',
      } }));
    } catch (error) {
      setPendencyFeedback((current) => ({ ...current, [draftKey]: { error: true, text: error.message || String(error) } }));
    } finally {
      pendencyBusyRef.current = false;
      setPendencyBusy(false);
    }
  }
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
              {botsLoading ? <p role="status">Loading bots...</p> : bots.length === 0 ? (
                <div className="bot-queue-empty">
                  <Bot size={20} aria-hidden="true" />
                  <strong>No bots</strong>
                  <span>Create a bot to receive messages and follow its activity.</span>
                </div>
              ) : (
                <>
                  <label className="bot-work-selector">
                    <Bot size={18} aria-hidden="true" />
                    <span>Bot</span>
                    <select value={selectedBot?.id ?? ''} onChange={(event) => { setSelectedPendencyId(null); onSelectBot(event.target.value); }}>
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
                        {tab.id === 'inbox' ? <Inbox size={16} aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />}<span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                  <div id="bot-work-view" className="bot-work-view" role="tabpanel" aria-labelledby={`bot-work-tab-${botPanelTab}`}>
                    {selectedBotError && (
                      <div className="bot-work-warning" role="alert"><AlertTriangle size={17} aria-hidden="true" /><div><strong>Unable to load {botPanelTab === 'inbox' ? 'Inbox' : 'Activity'}</strong><p>The file could not be read. Your data has not been changed.</p><details><summary>Technical details</summary><p>{selectedBotError}</p></details></div></div>
                    )}
                    {!selectedBotError && (botPanelTab === 'activity' || !selectedPendency) && (
                      <div className="bot-inbox-filters">
                        <label><span>Search {botPanelTab === 'inbox' ? 'Inbox' : 'Activity'}</span><input type="search" placeholder="Search" value={botQuery} onChange={(event) => setBotQuery(event.target.value)} /></label>
                        {botPanelTab === 'inbox' ? (
                          <label><span>Status</span><select value={inboxFilter} onChange={(event) => setInboxFilter(event.target.value)}><option value="all">All messages</option><option value="needs-user">Needs you</option><option value="open">Open</option><option value="completed">Completed</option></select></label>
                        ) : (
                          <label><span>Category</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}><option value="all">All categories</option>{['progress', 'discovery', 'decision', 'completed', 'failure'].map((category) => <option key={category} value={category}>{category[0].toUpperCase() + category.slice(1)}</option>)}</select></label>
                        )}
                      </div>
                    )}
                    {!selectedBotError && botPanelTab === 'inbox' && (selectedPendency ? (
                      <section className="bot-inbox-detail" aria-labelledby="bot-pendency-title">
                        <header>
                          <button type="button" onClick={() => {
                            setSelectedPendencyId(null);
                            queueMicrotask(() => document.getElementById(pendencyOpenerIdRef.current)?.focus());
                          }}><ArrowLeft size={15} aria-hidden="true" />Inbox</button>
                          <span>{selectedPendency.status === 'completed' ? 'Completed' : hasOpenBotUserAction(selectedPendency) ? 'Needs you' : 'Waiting for bot'}</span>
                          {selectedPendency.status === 'open' && <button type="button" disabled={pendencyBusy || Boolean(selectedPendency.approval)} title={selectedPendency.approval ? 'Resolve the approval first.' : undefined} onClick={() => actOnPendency('complete')}><Check size={14} aria-hidden="true" />Complete</button>}
                        </header>
                        <h2 id="bot-pendency-title" ref={pendencyHeadingRef} tabIndex={-1}>{selectedPendency.title}</h2>
                        <ol className="bot-inbox-messages">
                          {selectedPendency.messages.toSorted((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).map((message) => (
                            <li key={message.id} className={`from-${message.role}`}>
                              <header><strong>{message.role === 'user' ? 'You' : selectedBot.name}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleString()}</time></header>
                              <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={botWorkMarkdownComponents}>{message.content}</ReactMarkdown></div>
                              <BotAttachments attachments={message.attachments} />
                            </li>
                          ))}
                        </ol>
                        {selectedPendency.approval && (
                          <section className="bot-inbox-approval" aria-label="Pending approval">
                            <strong><Shield size={15} aria-hidden="true" />Approval required</strong>
                            <p>{selectedPendency.approval.prompt}</p>
                            {selectedPendency.approval.kind === 'tool' && <><p><strong>Tool:</strong> {selectedPendency.approval.toolName}</p><p><strong>Workspace:</strong> {selectedPendency.approval.workspacePath || 'Not specified'}</p><pre>{JSON.stringify(selectedPendency.approval.input ?? null, null, 2)}</pre></>}
                            <div><button type="button" disabled={pendencyBusy} onClick={() => actOnPendency('approve')}>Approve</button><button type="button" disabled={pendencyBusy} onClick={() => actOnPendency('deny')}>Deny</button></div>
                          </section>
                        )}
                        {selectedPendency.status === 'open' && (
                          <form className="bot-inbox-composer" onSubmit={(event) => { event.preventDefault(); void actOnPendency('reply'); }}>
                            <label className="sr-only" htmlFor="bot-pendency-reply">Reply to {selectedBot.name}</label>
                            <textarea id="bot-pendency-reply" value={draft.content} disabled={pendencyBusy} placeholder={`Reply to ${selectedBot.name}...`} rows={3} onChange={(event) => updatePendencyDraft({ content: event.target.value })} onPaste={(event) => {
                              const files = Array.from(event.clipboardData.files ?? []);
                              if (files.length) { event.preventDefault(); void attachToPendency(files); }
                            }} onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.isComposing) { event.preventDefault(); void actOnPendency('reply'); }
                            }} />
                            <BotAttachments attachments={draft.attachments} onRemove={pendencyBusy ? undefined : (id) => updatePendencyDraft({ attachments: draft.attachments.filter((attachment) => attachment.id !== id) })} />
                            <footer><button type="button" disabled={pendencyBusy} onClick={() => attachToPendency()}><Paperclip size={15} aria-hidden="true" />Attach</button><button type="submit" disabled={pendencyBusy || (!draft.content.trim() && !draft.attachments.length)}><Send size={14} aria-hidden="true" />{pendencyBusy ? 'Sending...' : 'Send reply'}</button></footer>
                          </form>
                        )}
                        {feedback && <p className={`bot-inbox-feedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
                      </section>
                    ) : filteredInbox.length === 0 ? (
                      <div className="bot-queue-empty"><Inbox size={28} strokeWidth={1.4} aria-hidden="true" /><strong>{selectedBotState.inbox.length ? 'No matching pendencies' : 'Your Inbox is empty'}</strong><span>{selectedBotState.inbox.length ? 'Try another filter or search.' : 'Messages that need your input will appear here.'}</span></div>
                    ) : (
                      <ul className="bot-inbox-list">
                        {filteredInbox.map((item) => (
                          <li key={item.id}><button id={`bot-pendency-${item.id}`} type="button" className={hasOpenBotUserAction(item) ? 'needs-user' : ''} onClick={(event) => { pendencyOpenerIdRef.current = event.currentTarget.id; setSelectedPendencyId(item.id); }}>
                            <strong>{item.title}</strong><span className="bot-inbox-preview">{item.messages.at(-1)?.content || 'Attachment'}</span><span className="bot-inbox-meta"><span>{item.status === 'completed' ? 'Completed' : hasOpenBotUserAction(item) ? 'Needs you' : 'Waiting for bot'}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></span>
                          </button></li>
                        ))}
                      </ul>
                    ))}
                    {!selectedBotError && botPanelTab === 'activity' && (recentBotActivity.length === 0 ? (
                      <div className="bot-queue-empty"><BookOpen size={28} strokeWidth={1.4} aria-hidden="true" /><strong>{selectedBotState.activity.length ? 'No matching activity' : 'No activity yet'}</strong><span>Important results will appear here.</span></div>
                    ) : (
                      <ol className="bot-diary-list">{recentBotActivity.map((entry) => (
                        <li key={entry.id}><h3>{entry.title}</h3><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={botWorkMarkdownComponents}>{entry.description}</ReactMarkdown></div><small>{entry.category} · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></small></li>
                      ))}</ol>
                    ))}
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
    </>
  );
});
