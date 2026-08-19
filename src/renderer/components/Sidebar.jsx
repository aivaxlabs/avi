import {
  Archive,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CopyPlus,
  Filter,
  Folder,
  FolderCog,
  FolderOpen,
  Hash,
  LayoutDashboard,
  LoaderCircle,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Server,
  Settings,
  SquareTerminal,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import aviIconUrl from '../../../assets/icon/avi.png';
import { classNames } from '../lib/format.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const GROUP_LIMIT = 5;
const conversationGroupingKey = 'aivax.sidebar.conversation-grouping';
const compactTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function Sidebar({
  conversations,
  models = [],
  selectedId,
  running,
  runStartedAt = {},
  completedUnseen,
  approvalPending = {},
  inputPending = {},
  semaphoreWaiting = {},
  onNewChat,
  onQuickChat,
  onSelect,
  onSearch,
  onOpenOrchestration,
  onFork,
  onArchive,
  onOpenProject,
  onOpenTerminal,
  onCopyPath,
  onCopyThreadId,
  onSettings,
  collapsed,
  orchestrationOpen,
  onToggleCollapsed,
  homePath,
}) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPosition, setFilterMenuPosition] = useState(null);
  const [conversationGrouping, setConversationGrouping] = useState(() => {
    const saved = window.localStorage.getItem(conversationGroupingKey);
    return ['model', 'folder'].includes(saved) ? saved : 'chronological';
  });
  const [expandedGroups, setExpandedGroups] = useState({});
  const [folderMenu, setFolderMenu] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const filterButtonRef = useRef(null);
  const folderMenuButtonRef = useRef(null);

  const conversationGroups = useMemo(() => {
    const sortedConversations = [...conversations].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    if (conversationGrouping === 'model' || conversationGrouping === 'folder') {
      const modelsById = new Map(models.map((model) => [model.id, model]));
      const groupsByValue = new Map();

      for (const conversation of sortedConversations) {
        const model = modelsById.get(conversation.model);
        const key = conversationGrouping === 'model'
          ? `model:${conversation.model || 'none'}`
          : `folder:${conversation.projectPath || 'home'}`;
        const label = conversationGrouping === 'model'
          ? model?.name || conversation.model || 'No model'
          : conversation.projectName || '~/';
        const current = groupsByValue.get(key) ?? {
          key,
          label,
          isHome: conversationGrouping === 'folder'
            && (!conversation.projectPath || conversation.projectPath === homePath),
          preset: conversationGrouping === 'model'
            ? { modelId: conversation.model }
            : {
                project: {
                  path: conversation.projectPath,
                  name: conversation.projectName,
                  displayPath: conversation.projectDisplayPath,
                  gitBranch: conversation.gitBranch,
                },
              },
          items: [],
          latestTime: 0,
        };
        const latestTime = new Date(
          conversationGrouping === 'folder' ? conversation.createdAt : conversation.updatedAt,
        ).getTime();
        current.items.push(conversation);
        current.latestTime = Math.max(
          current.latestTime,
          Number.isFinite(latestTime) ? latestTime : 0,
        );
        groupsByValue.set(key, current);
      }

      const groupedConversations = [...groupsByValue.values()]
        .sort((a, b) => (
          Number(a.isHome) - Number(b.isHome)
          || b.latestTime - a.latestTime
          || a.label.localeCompare(b.label)
        ));

      if (conversationGrouping === 'folder') {
        const workingTasks = sortedConversations.filter((conversation) => (
          running[conversation.id]
          || approvalPending[conversation.id]
          || inputPending[conversation.id]
          || semaphoreWaiting[conversation.id]
          || conversation.needsAttention
        ));
        const workingTaskIds = new Set(workingTasks.map((conversation) => conversation.id));
        const reviewTasks = sortedConversations.filter((conversation) => (
          completedUnseen[conversation.id]
          && !workingTaskIds.has(conversation.id)
        ));
        const taskGroups = [
          { key: 'tasks:working', label: 'Working tasks', items: workingTasks, isTaskGroup: true },
          { key: 'tasks:review', label: 'Review', items: reviewTasks, isTaskGroup: true },
        ].filter((group) => group.items.length > 0);
        const firstFolderIndex = groupedConversations.findIndex((group) => !group.isHome);

        return [
          ...taskGroups,
          ...groupedConversations.map((group, index) => ({
            ...group,
            showFoldersLabel: index === firstFolderIndex,
          })),
        ];
      }

      return groupedConversations;
    }

    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const day = 24 * 60 * 60 * 1000;
    const groups = [
      { key: 'time:today', label: 'Today', items: [] },
      { key: 'time:yesterday', label: 'Yesterday', items: [] },
      { key: 'time:past-week', label: 'Past week', items: [] },
      { key: 'time:past-month', label: 'Past month', items: [] },
      { key: 'time:very-old', label: 'Very old', items: [] },
    ];

    for (const conversation of sortedConversations) {
      const updatedTime = new Date(conversation.updatedAt).getTime();
      const groupIndex = updatedTime >= todayStart
        ? 0
        : updatedTime >= todayStart - day
          ? 1
          : updatedTime >= todayStart - day * 7
            ? 2
            : updatedTime >= todayStart - day * 30
              ? 3
              : 4;
      groups[groupIndex].items.push(conversation);
    }

    return groups.filter((group) => group.items.length > 0);
  }, [
    approvalPending,
    completedUnseen,
    conversationGrouping,
    conversations,
    homePath,
    inputPending,
    models,
    now,
    running,
    semaphoreWaiting,
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!filterMenuOpen) return undefined;
    const close = (event) => {
      if (filterButtonRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.dropdown-menu')) return;
      setFilterMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', () => setFilterMenuOpen(false), { once: true });
    return () => window.removeEventListener('pointerdown', close);
  }, [filterMenuOpen]);

  useEffect(() => {
    if (!folderMenu) return undefined;
    const close = (event) => {
      if (folderMenuButtonRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.conversation-folder-menu')) return;
      setFolderMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setFolderMenu(null);
      folderMenuButtonRef.current?.focus();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', close, { once: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', close);
    };
  }, [folderMenu]);

  function toggleFilterMenu() {
    const rect = filterButtonRef.current.getBoundingClientRect();
    setFilterMenuPosition({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 196)),
    });
    setFilterMenuOpen((value) => !value);
  }

  function chooseConversationGrouping(grouping) {
    setConversationGrouping(grouping);
    window.localStorage.setItem(conversationGroupingKey, grouping);
    setExpandedGroups({});
    setFilterMenuOpen(false);
    setFolderMenu(null);
  }

  return (
    <aside className="sidebar" id="main-sidebar">
      <div className="sidebar-titlebar">
        <div className="app-name">
          <img src={aviIconUrl} alt="" />
          <span>Avi</span>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className="nav-actions">
        <button type="button" onClick={() => onNewChat()}>
          <MessageSquarePlus size={17} />
          <span>New chat</span>
        </button>
        <button type="button" onClick={onQuickChat}>
          <Zap size={17} />
          <span>Quick chat</span>
        </button>
        <button
          className={orchestrationOpen ? 'active' : undefined}
          type="button"
          aria-current={orchestrationOpen ? 'page' : undefined}
          onClick={onOpenOrchestration}
        >
          <LayoutDashboard size={17} />
          <span>Orchestration</span>
        </button>
        <button type="button" onClick={onSearch}>
          <Search size={17} />
          <span>Search chats</span>
        </button>
      </div>
      <div className="recent-label">
        <span className="recent-title">
          <Clock size={13} />
          Recent
        </span>
        <button
          ref={filterButtonRef}
          className={classNames('recent-filter-button', filterMenuOpen && 'active')}
          type="button"
          aria-label="Filter conversations"
          title="Filter conversations"
          onClick={toggleFilterMenu}
        >
          <Filter size={13} />
        </button>
      </div>
      {filterMenuOpen && filterMenuPosition && createPortal(
        <DropdownMenu
          className="conversation-filter-menu"
          fixed
          style={{ top: filterMenuPosition.top, left: filterMenuPosition.left }}
        >
          <DropdownMenuItem
            active={conversationGrouping === 'chronological'}
            icon={conversationGrouping === 'chronological' ? <Check size={14} /> : <Clock size={14} />}
            onClick={() => chooseConversationGrouping('chronological')}
          >
            Chronological
          </DropdownMenuItem>
          <DropdownMenuItem
            active={conversationGrouping === 'model'}
            icon={conversationGrouping === 'model' ? <Check size={14} /> : <Filter size={14} />}
            onClick={() => chooseConversationGrouping('model')}
          >
            By model
          </DropdownMenuItem>
          <DropdownMenuItem
            active={conversationGrouping === 'folder'}
            icon={conversationGrouping === 'folder' ? <Check size={14} /> : <Folder size={14} />}
            onClick={() => chooseConversationGrouping('folder')}
          >
            By folder
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
      <div className="conversation-list">
        {conversationGroups.map((group) => {
          const expanded = Boolean(expandedGroups[group.key]);
          const visibleItems = expanded ? group.items : group.items.slice(0, GROUP_LIMIT);
          const groupLabel = conversationGrouping === 'folder' && group.isHome
            ? 'Chats'
            : group.label;
          return (
            <section key={group.key} className="conversation-group">
              {group.showFoldersLabel && (
                <div className="conversation-group-header">Folders</div>
              )}
              <div
                className="conversation-group-header"
                onContextMenu={conversationGrouping === 'folder' && !group.isHome && !group.isTaskGroup
                  ? (event) => {
                      event.preventDefault();
                      folderMenuButtonRef.current = event.currentTarget;
                      setFolderMenu({
                        key: group.key,
                        top: Math.max(8, Math.min(event.clientY, window.innerHeight - 260)),
                        left: Math.max(8, Math.min(event.clientX, window.innerWidth - 192)),
                      });
                    }
                  : undefined}
              >
                <span className="conversation-group-title" title={groupLabel}>
                  {conversationGrouping === 'folder' && !group.isHome && !group.isTaskGroup && (
                    <Folder size={13} aria-hidden="true" />
                  )}
                  <span>{groupLabel}</span>
                </span>
                {conversationGrouping !== 'chronological' && !group.isTaskGroup && (
                  <div className="conversation-group-actions">
                    <button
                      type="button"
                      aria-label={`New chat with ${groupLabel}`}
                      title={`New chat with ${groupLabel}`}
                      onClick={() => onNewChat(group.preset)}
                    >
                      <Plus size={13} />
                    </button>
                    {conversationGrouping === 'folder' && !group.isHome && (
                      <button
                        className={folderMenu?.key === group.key ? 'active' : undefined}
                        type="button"
                        aria-label={`Actions for ${group.label}`}
                        aria-haspopup="menu"
                        aria-expanded={folderMenu?.key === group.key}
                        title={`Actions for ${group.label}`}
                        onClick={(event) => {
                          if (folderMenu?.key === group.key) {
                            setFolderMenu(null);
                            return;
                          }
                          const rect = event.currentTarget.getBoundingClientRect();
                          folderMenuButtonRef.current = event.currentTarget;
                          setFolderMenu({
                            key: group.key,
                            top: rect.bottom + 4,
                            left: Math.max(8, Math.min(rect.right - 184, window.innerWidth - 192)),
                          });
                        }}
                      >
                        <MoreHorizontal size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {folderMenu?.key === group.key && createPortal(
                <DropdownMenu
                  className="conversation-folder-menu"
                  fixed
                  role="menu"
                  style={{ top: folderMenu.top, left: folderMenu.left }}
                >
                  <DropdownMenuItem
                    icon={<FolderOpen size={14} />}
                    role="menuitem"
                    onClick={() => {
                      setFolderMenu(null);
                      onOpenProject(group.preset.project);
                    }}
                  >
                    Open in explorer
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<SquareTerminal size={14} />}
                    role="menuitem"
                    onClick={() => {
                      setFolderMenu(null);
                      onOpenTerminal(group.preset.project);
                    }}
                  >
                    Open in terminal
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<Copy size={14} />}
                    role="menuitem"
                    onClick={() => {
                      setFolderMenu(null);
                      onCopyPath(group.preset.project);
                    }}
                  >
                    Copy path
                  </DropdownMenuItem>
                  <div className="dropdown-menu-divider" role="separator" />
                  <DropdownMenuItem
                    icon={<FolderCog size={14} />}
                    role="menuitem"
                    onClick={() => {
                      setFolderMenu(null);
                      onSettings(group.preset.project);
                    }}
                  >
                    Manage Context
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<Server size={14} />}
                    role="menuitem"
                    onClick={() => {
                      setFolderMenu(null);
                      onSettings(group.preset.project, 'mcp');
                    }}
                  >
                    Manage MCP Servers
                  </DropdownMenuItem>
                </DropdownMenu>,
                document.body,
              )}
              {visibleItems.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === selectedId}
                  running={Boolean(running[conversation.id])}
                  runStartedAt={runStartedAt[conversation.id] ?? null}
                  completedUnseen={Boolean(completedUnseen[conversation.id])}
                  approvalPending={Boolean(approvalPending[conversation.id])}
                  inputPending={Boolean(inputPending[conversation.id])}
                  semaphoreWaiting={Boolean(semaphoreWaiting[conversation.id])}
                  needsAttention={Boolean(conversation.needsAttention)}
                  now={now}
                  onSelect={() => onSelect(conversation.id)}
                  onFork={() => onFork(conversation.id)}
                  onArchive={() => onArchive(conversation.id)}
                  onCopyId={() => onCopyThreadId(conversation.id)}
                />
              ))}
              {group.items.length > GROUP_LIMIT && (
                <button
                  className="conversation-show-toggle"
                  type="button"
                  onClick={() => setExpandedGroups((state) => ({
                    ...state,
                    [group.key]: !state[group.key],
                  }))}
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </section>
          );
        })}
      </div>
      <button className="settings-button" type="button" onClick={() => onSettings()}>
        <Settings size={17} />
        <span>Settings</span>
      </button>
    </aside>
  );
}

function ConversationItem({
  conversation,
  active,
  running,
  runStartedAt,
  completedUnseen,
  approvalPending,
  inputPending,
  semaphoreWaiting,
  needsAttention,
  now,
  onSelect,
  onFork,
  onArchive,
  onCopyId,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  const [tooltipNow, setTooltipNow] = useState(() => Date.now());
  const menuButtonRef = useRef(null);
  const itemRef = useRef(null);
  const tooltipTimerRef = useRef(null);
  const status = approvalPending
    ? { icon: TriangleAlert, className: 'attention-indicator', label: 'Awaiting approval', size: 13 }
    : inputPending
      ? { icon: TriangleAlert, className: 'attention-indicator', label: 'Awaiting input', size: 13 }
      : semaphoreWaiting
        ? { icon: Moon, className: 'sleep-indicator', label: 'Waiting for semaphore', size: 13 }
        : running
          ? { icon: LoaderCircle, className: 'run-spinner', label: 'Working', size: 12 }
          : needsAttention
            ? { icon: TriangleAlert, className: 'attention-indicator', label: 'Needs attention', size: 13 }
            : completedUnseen
              ? { icon: CheckCircle2, className: 'completion-indicator', label: 'Completed', size: 13 }
              : null;
  const StatusIcon = status?.icon ?? Clock;
  const statusLabel = status?.label ?? 'Idle';
  const folderLabel = conversation.projectDisplayPath
    || conversation.projectName
    || '~/';
  const elapsedLabel = (() => {
    if (!tooltipPosition || !Number.isFinite(runStartedAt)) return '';
    const totalSeconds = Math.max(0, Math.floor((tooltipNow - runStartedAt) / 1000));
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const days = Math.floor(totalSeconds / 86400);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `${totalSeconds}s`;
  })();
  const tokensLabel = `~${compactTokenFormatter.format(conversation.contextTokens ?? 0)} input tokens`;
  const ageLabel = (() => {
    const updatedTime = new Date(conversation.updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) return '';
    const minutes = Math.floor((now - updatedTime) / 60_000);
    if (minutes < 60) return '';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (days < 30) return `${weeks}w`;
    const months = Math.floor(days / 30);
    if (days < 365) return `${months}mo`;
    return `${Math.floor(days / 365)}y`;
  })();

  useEffect(() => {
    if (!menuOpen) return undefined;

    const close = (event) => {
      if (menuButtonRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.dropdown-menu')) return;
      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', () => setMenuOpen(false), { once: true });
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => () => window.clearTimeout(tooltipTimerRef.current), []);

  useEffect(() => {
    if (!tooltipPosition) return undefined;
    setTooltipNow(Date.now());
    const interval = window.setInterval(() => setTooltipNow(Date.now()), 1000);
    const close = () => setTooltipPosition(null);
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setTooltipPosition(null);
    };
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [tooltipPosition]);

  function openTooltip() {
    const rect = itemRef.current.getBoundingClientRect();
    setTooltipPosition({
      top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - 180)),
      left: Math.min(rect.right + 8, window.innerWidth - 292),
    });
  }

  function scheduleTooltip() {
    window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(openTooltip, 350);
  }

  function closeTooltip() {
    window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setTooltipPosition(null);
  }

  function toggleMenu() {
    const rect = menuButtonRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: Math.min(rect.right - 150, window.innerWidth - 160),
    });
    setMenuOpen((value) => !value);
  }

  function runMenuAction(action) {
    setMenuOpen(false);
    action();
  }

  return (
    <div
      ref={itemRef}
      className={classNames('conversation-item', active && 'active', menuOpen && 'menu-open')}
      onMouseEnter={scheduleTooltip}
      onMouseLeave={closeTooltip}
      onContextMenu={(event) => {
        event.preventDefault();
        menuButtonRef.current = event.currentTarget;
        setMenuPosition({
          top: Math.max(8, Math.min(event.clientY, window.innerHeight - 130)),
          left: Math.max(8, Math.min(event.clientX, window.innerWidth - 160)),
        });
        setMenuOpen(true);
      }}
    >
      <button
        className="conversation-main"
        type="button"
        onClick={onSelect}
        onFocus={openTooltip}
        onBlur={closeTooltip}
      >
        <span className="conversation-title">{conversation.title || conversation.firstPrompt || 'New chat'}</span>
        {status && (
          <StatusIcon className={status.className} size={status.size} aria-label={status.label} />
        )}
      </button>
      {ageLabel && <span className="conversation-age">{ageLabel}</span>}
      <button ref={menuButtonRef} className="icon-button tiny" type="button" onClick={toggleMenu}>
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && menuPosition && createPortal(
        <DropdownMenu fixed style={{ top: menuPosition.top, left: menuPosition.left }}>
          <DropdownMenuItem icon={<CopyPlus size={14} />} onClick={() => runMenuAction(onFork)}>
            Fork chat
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Hash size={14} />} onClick={() => runMenuAction(onCopyId)}>
            Copy thread ID
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Archive size={14} />} onClick={() => runMenuAction(onArchive)}>
            Archive chat
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
      {tooltipPosition && createPortal(
        <div className="conversation-tooltip" style={tooltipPosition} role="tooltip">
          <div className="conversation-tooltip-title">
            {conversation.title || conversation.firstPrompt || 'New chat'}
          </div>
          <div className="conversation-tooltip-row">
            <Folder size={13} aria-hidden="true" />
            <span className="conversation-tooltip-label">Folder</span>
            <span className="conversation-tooltip-value" title={folderLabel}>{folderLabel}</span>
          </div>
          <div className="conversation-tooltip-row">
            <StatusIcon
              className={status?.className ?? 'sleep-indicator'}
              size={13}
              aria-hidden="true"
            />
            <span className="conversation-tooltip-label">Status</span>
            <span className="conversation-tooltip-value">{statusLabel}</span>
          </div>
          {elapsedLabel && (
            <div className="conversation-tooltip-row">
              <Clock size={13} aria-hidden="true" />
              <span className="conversation-tooltip-label">Running for</span>
              <span className="conversation-tooltip-value">{elapsedLabel}</span>
            </div>
          )}
          <div className="conversation-tooltip-row">
            <Hash size={13} aria-hidden="true" />
            <span className="conversation-tooltip-label">Input tokens</span>
            <span className="conversation-tooltip-value">{tokensLabel}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
