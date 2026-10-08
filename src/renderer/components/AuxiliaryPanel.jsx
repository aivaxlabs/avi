import Avatar from 'boring-avatars';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Ellipsis,
  Files,
  Gauge,
  GitPullRequest,
  Inbox,
  BookOpen,
  MessageCircleQuestionMark,
  MessageSquarePlus,
  Maximize2,
  Minimize2,
  ListChecks,
  Moon,
  Network,
  Paperclip,
  PencilLine,
  Plus,
  Send,
  Shield,
  X,
} from 'lucide-react';
import { BOT_PENDENCY_COMPLETION_REASONS, getBotPendencyStatusLabel, hasOpenBotUserAction } from '../../shared/bot-work-items.js';
import { fileToAttachment, formatBytes } from '../lib/files.js';
import { AttachmentImage, AttachmentVideo } from './AttachmentVideo.jsx';
import { ChatView } from './ChatView.jsx';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { FilesPanel } from './FilesPanel.jsx';
import { GitReviewPanel } from './GitReviewPanel.jsx';
import { MarkdownSegment } from './Message.jsx';
import { ProviderPanel } from './ProviderPanel.jsx';
import { Overlay, Presence } from './Overlay.jsx';

const emptyList = Object.freeze([]);
const emptyObject = Object.freeze({});
const subagentsTabId = 'subagents';
const filesTabId = 'files';
const gitReviewTabId = 'git-review';
const tasksTabId = 'tasks';
const botQueueTabId = 'bot-queue';
const tabCloseDuration = 150;
const botPanelTabs = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'activity', label: 'Activity' },
];
const subagentAvatarColors = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];
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
      <Presence when={open}>{() => (
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
      )}</Presence>
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
  onMarkBotPendencyRead,
  botQueueTabOpen = false,
  selectedBotId,
  inboxNavigation,
  inboxOnly = false,
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
  closing = false,
  expanded = false,
  onToggleExpanded,
  onCreateSideChat,
  onAddToChat,
  onAskInSideChat,
  onQuickQuestion,
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
  approvalRequests = emptyList,
  onResolveApproval,
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
  const [pendencyMenu, setPendencyMenu] = useState(null);
  const [selectionAction, setSelectionAction] = useState(null);
  const [selectionAnnotation, setSelectionAnnotation] = useState('');
  const [closingTabIds, setClosingTabIds] = useState(emptyList);
  const [lockedTabWidths, setLockedTabWidths] = useState(null);
  const pendencyMenuRef = useRef(null);
  const pendencyMenuTriggerRef = useRef(null);
  const pendencyBusyRef = useRef(false);
  const pendencyHeadingRef = useRef(null);
  const pendencyHistoryRef = useRef(null);
  const pendencyOpenerIdRef = useRef(null);
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? (inboxOnly ? null : bots[0]) ?? null;
  const selectedBotState = botDataByBot[selectedBot?.id] ?? { inbox: emptyList, activity: emptyList, error: null };
  const selectedBotError = selectedBotState.errors ? selectedBotState.errors[botPanelTab] : selectedBotState.error;
  const selectedPendency = selectedBotState.inbox.find((item) => item.id === (inboxOnly ? inboxNavigation?.pendencyId : selectedPendencyId)) ?? null;
  const draftKey = `${selectedBot?.id}:${selectedPendency?.id}`;
  const draft = pendencyDrafts[draftKey] ?? { content: '', attachments: emptyList };
  const feedback = pendencyFeedback[draftKey];
  useEffect(() => {
    if (!pendencyMenu) return undefined;
    if (pendencyMenu.key !== draftKey || pendencyBusy || selectedPendency?.status !== 'open' || selectedPendency.approval) {
      setPendencyMenu(null);
      return undefined;
    }
    const controller = new AbortController();
    const dismiss = () => {
      setPendencyMenu(null);
      pendencyMenuTriggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', (event) => {
      if (!pendencyMenuRef.current?.contains(event.target) && !pendencyMenuTriggerRef.current?.contains(event.target)) dismiss();
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') dismiss();
    }, { signal: controller.signal });
    window.addEventListener('resize', dismiss, { signal: controller.signal });
    window.addEventListener('scroll', (event) => {
      if (!pendencyMenuRef.current?.contains(event.target)) dismiss();
    }, { capture: true, signal: controller.signal });
    pendencyMenuRef.current?.querySelector('[role="menuitem"]')?.focus();
    return () => controller.abort();
  }, [pendencyMenu, draftKey, pendencyBusy, selectedPendency?.status, selectedPendency?.approval]);
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

  useEffect(() => {
    setSelectionAction(null);
  }, [draftKey, selectedPendency?.status]);

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
    window.addEventListener('resize', () => setSelectionAction(null), { once: true, signal: controller.signal });
    return () => {
      controller.abort();
      setSelectionAnnotation('');
    };
  }, [selectionAction]);

  function updateSelectionAction() {
    const selection = window.getSelection();
    if ((selectedPendency?.status !== 'open' && !onQuickQuestion) || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const elementOf = (node) => node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const startMessage = elementOf(range.startContainer)?.closest?.('.bot-inbox-messages > li');
    const content = selection.toString().trim();
    if (!startMessage || startMessage !== elementOf(range.endContainer)?.closest?.('.bot-inbox-messages > li') || !content) {
      setSelectionAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const width = (selectedPendency.status === 'open' ? 230 : 0) + (onQuickQuestion ? 130 : 0);
    const height = 34;
    const above = rect.top - height - 8;
    setSelectionAction({
      content,
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)),
      top: above >= 8 ? above : Math.min(window.innerHeight - height - 8, rect.bottom + 8),
    });
  }

  function mentionSelection(annotation = '') {
    if (!selectionAction) return;
    const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    updatePendencyDraft({
      attachments: [...draft.attachments, {
        id: crypto.randomUUID(),
        kind: 'context_marker',
        markerType: annotation ? 'citation_annotation' : 'citation',
        name: annotation ? 'Inbox annotation' : 'Inbox citation',
        size: 0,
        text: annotation
          ? `<citation>${escape(selectionAction.content)}</citation>\n<annotation>${escape(annotation)}</annotation>`
          : `<citation>${escape(selectionAction.content)}</citation>`,
      }],
    });
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
    document.getElementById('bot-pendency-reply')?.focus();
  }

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

  async function actOnPendency(action, reason) {
    if (!selectedPendency || pendencyBusyRef.current) return;
    if (action === 'reply' && !draft.content.trim() && !draft.attachments.length) return;
    pendencyBusyRef.current = true;
    setPendencyBusy(true);
    setPendencyFeedback((current) => ({ ...current, [draftKey]: null }));
    try {
      const result = action === 'reply'
        ? await onReplyBotPendency({ botId: selectedBot.id, pendencyId: selectedPendency.id, ...draft })
        : action === 'complete'
          ? await onCompleteBotPendency({ botId: selectedBot.id, pendencyId: selectedPendency.id, ...(reason ? { reason } : {}) })
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
      disabled: false,
      title: 'Review Git changes',
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
  useEffect(() => {
    if (!showingBotQueue || botPanelTab !== 'inbox' || botsLoading || selectedBotError || !selectedPendency || !onMarkBotPendencyRead) return undefined;
    const history = pendencyHistoryRef.current;
    if (!history) return undefined;
    const unreadIds = new Set();
    for (const message of selectedPendency.messages) {
      if (message.role === 'bot' && !message.readAt) unreadIds.add(message.id);
    }
    if (!unreadIds.size) return undefined;
    const targets = [...history.querySelectorAll('[data-bot-message-id]')].filter((element) => unreadIds.has(element.dataset.botMessageId));
    const controller = new AbortController();
    const observer = new IntersectionObserver((entries) => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const messageIds = [];
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
        messageIds.push(entry.target.dataset.botMessageId);
        observer.unobserve(entry.target);
      }
      if (!messageIds.length) return;
      void onMarkBotPendencyRead({ botId: selectedBot.id, pendencyId: selectedPendency.id, messageIds }).catch((error) => {
        setPendencyFeedback((current) => ({ ...current, [draftKey]: { error: true, text: `Could not mark messages as read: ${error.message || String(error)}. Reopen this Inbox conversation to retry.` } }));
      });
    }, { root: history, threshold: 0.5 });
    const observeUnread = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      for (const target of targets) {
        observer.unobserve(target);
        observer.observe(target);
      }
    };
    observeUnread();
    window.addEventListener('focus', observeUnread, { signal: controller.signal });
    document.addEventListener('visibilitychange', observeUnread, { signal: controller.signal });
    return () => { controller.abort(); observer.disconnect(); };
  }, [showingBotQueue, botPanelTab, botsLoading, selectedBotError, selectedPendency, selectedBot?.id, draftKey, onMarkBotPendencyRead]);
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
  const activeThreadApprovalRequests = useMemo(() => (
    approvalRequests.filter((request) => request.conversationId === activeThread?.id)
  ), [activeThread?.id, approvalRequests]);

  const hasActiveTab = tabs.some((tab) => tab.id === activeTab);
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const [settledTabIds, setSettledTabIds] = useState(tabIds);
  if (!settledTabIds.isSubsetOf(tabIds)) {
    setSettledTabIds(settledTabIds.intersection(tabIds));
  }
  const closingTabIdSet = new Set(closingTabIds);

  return (
    <>
      <aside
        className={`auxiliary-panel${closing ? ' closing' : ''}`}
        id="auxiliary-panel"
        aria-label={inboxOnly ? 'Inbox conversation' : 'Auxiliary panel'}
        inert={closing}
      >
        <header className="auxiliary-panel-header" onPointerLeave={() => setLockedTabWidths(null)}>
          {inboxOnly ? (
            <div className="auxiliary-empty-header">
              <span>{selectedBot?.name ?? 'Inbox'}</span>
              <button className="auxiliary-tab-close" type="button" aria-label="Close Inbox panel" title="Close Inbox panel" onClick={onClosePanel}>
                <X size={13} />
              </button>
            </div>
          ) : tabs.length > 0 ? (
            <div className="auxiliary-tabs-row">
              <div
                className={`auxiliary-tabs${lockedTabWidths ? ' widths-locked' : ''}`}
                role="tablist"
                aria-label="Auxiliary panel tabs"
              >
                {tabs.map((tab, index) => {
                  const tabClosing = closingTabIdSet.has(tab.id);
                  const lockedWidth = lockedTabWidths?.[tab.id];
                  const tabClassName = [
                    'auxiliary-tab',
                    tab.id === activeTab && 'active',
                    !settledTabIds.has(tab.id) && 'entering',
                    tabClosing && 'closing',
                  ].filter(Boolean).join(' ');

                  return (
                  <div
                    key={tab.id}
                    data-tab-id={tab.id}
                    className={tabClassName}
                    style={lockedWidth ? { flex: `0 0 ${lockedWidth}px` } : undefined}
                    inert={tabClosing}
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
                      onClick={(event) => {
                        if (event.detail > 0) {
                          const tabElements = event.currentTarget.closest('[role="tablist"]').children;
                          setLockedTabWidths(Object.fromEntries([...tabElements].map((element) => [
                            element.dataset.tabId,
                            parseFloat(getComputedStyle(element).width),
                          ])));
                        }

                        setClosingTabIds((ids) => [...ids, tab.id]);
                        window.setTimeout(() => {
                          Promise.resolve().then(() => (
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
                          )).finally(() => setClosingTabIds((ids) => ids.filter((id) => id !== tab.id)));
                        }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : tabCloseDuration);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  );
                })}
              </div>
              <AuxiliaryAddMenu panels={availablePanels} />
              {onToggleExpanded && <button className="auxiliary-tab-close" type="button" aria-label={expanded ? 'Restore panel width' : 'Expand auxiliary panel'} title={expanded ? 'Restore panel width' : 'Expand auxiliary panel'} aria-pressed={expanded} onClick={onToggleExpanded}>
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>}
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
                {onToggleExpanded && <button className="auxiliary-tab-close" type="button" aria-label={expanded ? 'Restore panel width' : 'Expand auxiliary panel'} title={expanded ? 'Restore panel width' : 'Expand auxiliary panel'} aria-pressed={expanded} onClick={onToggleExpanded}>
                  {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>}
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
          role={!inboxOnly && hasActiveTab ? 'tabpanel' : undefined}
          aria-labelledby={!inboxOnly && hasActiveTab ? `auxiliary-tab-${activeTab}` : undefined}
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
                  {!inboxOnly && <>
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
                  </>}
                  <div id="bot-work-view" className="bot-work-view" role={inboxOnly ? undefined : 'tabpanel'} aria-labelledby={inboxOnly ? undefined : `bot-work-tab-${botPanelTab}`}>
                    {selectedBotError && (
                      <div className="bot-work-warning" role="alert"><AlertTriangle size={17} aria-hidden="true" /><div><strong>Unable to load {botPanelTab === 'inbox' ? 'Inbox' : 'Activity'}</strong><p>The file could not be read. Your data has not been changed.</p><details><summary>Technical details</summary><p>{selectedBotError}</p></details></div></div>
                    )}
                    {!inboxOnly && !selectedBotError && (botPanelTab === 'activity' || !selectedPendency) && (
                      <div className="bot-inbox-filters">
                        <label><span>Search {botPanelTab === 'inbox' ? 'Inbox' : 'Activity'}</span><input type="search" placeholder="Search" value={botQuery} onChange={(event) => setBotQuery(event.target.value)} /></label>
                        {botPanelTab === 'inbox' ? (
                          <label><span>Status</span><select value={inboxFilter} onChange={(event) => setInboxFilter(event.target.value)}><option value="all">All messages</option><option value="needs-user">Needs you</option><option value="open">Open</option><option value="completed">Completed</option></select></label>
                        ) : (
                          <label><span>Category</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}><option value="all">All categories</option>{['progress', 'discovery', 'decision', 'completed', 'failure'].map((category) => <option key={category} value={category}>{category[0].toUpperCase() + category.slice(1)}</option>)}</select></label>
                        )}
                      </div>
                    )}
                    {!selectedBotError && inboxOnly && !selectedPendency && <p role="status">This Inbox conversation is no longer available.</p>}
                    {!selectedBotError && botPanelTab === 'inbox' && (!inboxOnly || selectedPendency) && (selectedPendency ? (
                      <section className="bot-inbox-detail" aria-labelledby="bot-pendency-title">
                        <div className="bot-inbox-history" ref={pendencyHistoryRef}>
                        <header>
                          {!inboxOnly && <button type="button" onClick={() => {
                            setSelectedPendencyId(null);
                            queueMicrotask(() => document.getElementById(pendencyOpenerIdRef.current)?.focus());
                          }}><ArrowLeft size={15} aria-hidden="true" />Inbox</button>}
                          <span>{getBotPendencyStatusLabel(selectedPendency)}</span>
                          {selectedPendency.status === 'open' && <>
                            <button className="bot-inbox-complete" type="button" disabled={pendencyBusy || Boolean(selectedPendency.approval)} title={selectedPendency.approval ? 'Resolve the approval first.' : undefined} onClick={() => actOnPendency('complete')}><Check size={14} aria-hidden="true" />Complete</button>
                            <button
                              ref={pendencyMenuTriggerRef}
                              className="bot-inbox-completion-menu-trigger"
                              type="button"
                              aria-label="More completion options"
                              title={selectedPendency.approval ? 'Resolve the approval first.' : 'More completion options'}
                              aria-haspopup="menu"
                              aria-expanded={Boolean(pendencyMenu)}
                              disabled={pendencyBusy || Boolean(selectedPendency.approval)}
                              onClick={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setPendencyMenu((current) => current ? null : {
                                  key: draftKey,
                                  left: Math.max(8, Math.min(rect.right - 180, window.innerWidth - 188)),
                                  top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 144)),
                                });
                              }}
                            ><Ellipsis size={16} aria-hidden="true" /></button>
                            <Presence when={pendencyMenu?.key === draftKey && pendencyMenu}>{(pendencyMenu) => createPortal(
                              <DropdownMenu
                                ref={pendencyMenuRef}
                                className="bot-inbox-completion-menu"
                                fixed
                                role="menu"
                                aria-label="Completion options"
                                style={{ left: pendencyMenu.left, top: pendencyMenu.top }}
                                onKeyDown={(event) => {
                                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                                  event.preventDefault();
                                  const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
                                  const index = items.indexOf(document.activeElement);
                                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                                  items[next]?.focus();
                                }}
                              >
                                {Object.entries(BOT_PENDENCY_COMPLETION_REASONS).map(([reason, label]) => (
                                  <DropdownMenuItem key={reason} role="menuitem" disabled={pendencyBusy || Boolean(selectedPendency.approval)} onClick={() => {
                                    setPendencyMenu(null);
                                    pendencyHeadingRef.current?.focus();
                                    void actOnPendency('complete', reason);
                                  }}>{label}</DropdownMenuItem>
                                ))}
                              </DropdownMenu>,
                              document.body,
                            )}</Presence>
                          </>}
                        </header>
                        <h2 id="bot-pendency-title" ref={pendencyHeadingRef} tabIndex={-1}>{selectedPendency.title}</h2>
                        <ol className="bot-inbox-messages" onMouseUp={updateSelectionAction} onKeyUp={updateSelectionAction}>
                          {selectedPendency.messages.toSorted((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).map((message) => (
                            <li key={message.id} className={`from-${message.role}`}>
                              <header data-bot-message-id={message.role === 'bot' ? message.id : undefined}>
                                {message.role !== 'user' && <span className="bot-avatar" aria-hidden="true"><img src={`https://orb.aivax.net/${encodeURIComponent(message.role === 'agent' ? message.sender.botId : selectedBot.id)}`} width={22} height={22} alt="" /></span>}
                                <strong>{message.role === 'user' ? 'You' : message.role === 'agent' ? message.sender.name : selectedBot.name}</strong>
                                {message.role === 'agent' && <span className="bot-message-response-indicator">Sent by another bot</span>}
                                {message.role === 'bot' && <span className="bot-message-response-indicator">{message.requiresUserResponse !== false ? 'Requires your response' : 'No response required'}</span>}
                                <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleString()}</time>
                              </header>
                              <MarkdownSegment text={message.content} finalized />
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
                        </div>
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
                              if (selectionAnnotation.trim()) mentionSelection(selectionAnnotation.trim());
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
                              <button type="submit" className="primary-mini" disabled={!selectionAnnotation.trim()}>Add to reply</button>
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
                            {selectedPendency.status === 'open' && <>
                              <button type="button" onClick={() => mentionSelection()}>
                                <MessageSquarePlus size={13} aria-hidden="true" />
                                <span>Mention on Chat</span>
                              </button>
                              <button type="button" onClick={() => setSelectionAction((current) => ({ ...current, annotating: true }))}>
                                <PencilLine size={13} aria-hidden="true" />
                                <span>Annotate</span>
                              </button>
                            </>}
                            {onQuickQuestion && (
                              <button type="button" onClick={() => {
                                const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
                                onQuickQuestion({
                                  label: selectionAction.content,
                                  left: selectionAction.left,
                                  top: selectionAction.top,
                                  context: {
                                    source: 'inbox',
                                    workspacePath: selectedBot.resolvedWorkingFolder,
                                    botId: selectedBot.id,
                                    workLogId: selectedPendency.id,
                                    attachments: [{
                                      kind: 'context_marker',
                                      markerType: 'citation',
                                      name: 'Inbox citation',
                                      text: `<inbox-citation bot="${escape(selectedBot.name)}" work-log="${escape(selectedPendency.title)}">${escape(selectionAction.content)}</inbox-citation>`,
                                    }],
                                  },
                                });
                                setSelectionAction(null);
                                window.getSelection()?.removeAllRanges();
                              }}>
                                <MessageCircleQuestionMark size={13} aria-hidden="true" />
                                <span>Quick question</span>
                              </button>
                            )}
                          </Overlay>
                        ), document.body)}</Presence>
                        {feedback && <p className={`bot-inbox-feedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
                      </section>
                    ) : filteredInbox.length === 0 ? (
                      <div className="bot-queue-empty"><Inbox size={28} strokeWidth={1.4} aria-hidden="true" /><strong>{selectedBotState.inbox.length ? 'No matching pendencies' : 'Your Inbox is empty'}</strong><span>{selectedBotState.inbox.length ? 'Try another filter or search.' : 'Messages that need your input will appear here.'}</span></div>
                    ) : (
                      <ul className="bot-inbox-list">
                        {filteredInbox.map((item) => (
                          <li key={item.id}><button id={`bot-pendency-${item.id}`} type="button" className={hasOpenBotUserAction(item) ? 'needs-user' : ''} onClick={(event) => { pendencyOpenerIdRef.current = event.currentTarget.id; setSelectedPendencyId(item.id); }}>
                            <strong>{item.title}</strong><span className="bot-inbox-preview">{item.messages.at(-1)?.content || 'Attachment'}</span><span className="bot-inbox-meta"><span>{getBotPendencyStatusLabel(item)}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></span>
                          </button></li>
                        ))}
                      </ul>
                    ))}
                    {!selectedBotError && botPanelTab === 'activity' && (recentBotActivity.length === 0 ? (
                      <div className="bot-queue-empty"><BookOpen size={28} strokeWidth={1.4} aria-hidden="true" /><strong>{selectedBotState.activity.length ? 'No matching activity' : 'No activity yet'}</strong><span>Important results will appear here.</span></div>
                    ) : (
                      <ol className="bot-diary-list">{recentBotActivity.map((entry) => (
                        <li key={entry.id}><h3>{entry.title}</h3><MarkdownSegment text={entry.description} finalized /><small>{entry.category} · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></small></li>
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
              onQuickQuestion={onQuickQuestion}
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
              onQuickQuestion={onQuickQuestion}
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
              approvalRequests={activeThreadApprovalRequests}
              onResolveApproval={onResolveApproval}
              onStop={() => onStop(activeThread.id)}
              onCompress={() => onCompress(activeThread.id, currentModel)}
              onMentionSelection={onAddToChat}
              onAskSelection={activeThread.isSubagent || activeThread.isRubberDuck ? undefined : onAskInSideChat}
              onQuickQuestion={onQuickQuestion}
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
            />
          ) : null}
        </div>
      </aside>
    </>
  );
});
