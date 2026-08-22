import {
  Archive,
  Bot,
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
  Palette,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  SquareTerminal,
  Tags,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import Avatar from 'boring-avatars';
import { createPortal } from 'react-dom';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import aviIconUrl from '../../../assets/icon/avi.png';
import { classNames } from '../lib/format.js';
import { presetColors } from '../lib/palette.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { TagsManagerDialog } from './TagsManagerDialog.jsx';

const GROUP_LIMIT = 5;
const emptyList = Object.freeze([]);
const emptyObject = Object.freeze({});
const conversationGroupingKey = 'aivax.sidebar.conversation-grouping';
const botAvatarColors = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];
const compactTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const Sidebar = memo(function Sidebar({
  conversations,
  bots = emptyList,
  models = emptyList,
  selectedId,
  running,
  runStartedAt = emptyObject,
  completedUnseen,
  approvalPending = emptyObject,
  inputPending = emptyObject,
  semaphoreWaiting = emptyObject,
  onNewChat,
  onQuickChat,
  onSelect,
  onNewBot,
  onSelectBot,
  onBotSettings,
  onDeleteBot,
  onActivateBot,
  onSearch,
  onOpenOrchestration,
  onFork,
  onArchive,
  onOpenProject,
  onOpenTerminal,
  onCopyPath,
  onCopyThreadId,
  onSettings,
  chatTags = emptyList,
  folderColors = emptyObject,
  onSetConversationTags,
  onSetFolderColor,
  onSaveChatTags,
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
  const [activeTagIds, setActiveTagIds] = useState(() => new Set());
  const [folderMenu, setFolderMenu] = useState(null);
  const [tagsManagerOpen, setTagsManagerOpen] = useState(false);
  const [tagsSaving, setTagsSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const filterButtonRef = useRef(null);
  const folderMenuButtonRef = useRef(null);
  const chronologicalDayStart = conversationGrouping === 'chronological'
    ? new Date(now).setHours(0, 0, 0, 0)
    : null;

  const conversationGroups = useMemo(() => {
    const sortedConversations = [...conversations]
      .filter((conversation) => activeTagIds.size === 0
        || (conversation.tags ?? []).some((id) => activeTagIds.has(id)))
      .sort(
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

    const todayStart = chronologicalDayStart;
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
    activeTagIds,
    approvalPending,
    chronologicalDayStart,
    completedUnseen,
    conversationGrouping,
    conversations,
    homePath,
    inputPending,
    models,
    running,
    semaphoreWaiting,
  ]);

  useEffect(() => {
    const currentTime = Date.now();
    const nextBoundary = conversations.reduce((earliest, conversation) => {
      const updatedTime = new Date(conversation.updatedAt).getTime();
      if (!Number.isFinite(updatedTime)) return earliest;
      const elapsedHours = Math.max(0, Math.floor((currentTime - updatedTime) / 3_600_000));
      return Math.min(earliest, updatedTime + ((elapsedHours + 1) * 3_600_000));
    }, conversationGrouping === 'chronological'
      ? new Date(currentTime).setHours(24, 0, 0, 0)
      : Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextBoundary)) return undefined;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1_000, nextBoundary - currentTime),
    );
    return () => window.clearTimeout(timeout);
  }, [conversationGrouping, conversations, now]);

  useEffect(() => {
    setActiveTagIds((current) => {
      const valid = chatTags.filter((tag) => current.has(tag.id));
      return valid.length === current.size ? current : new Set(valid.map((tag) => tag.id));
    });
  }, [chatTags]);

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

  function toggleTagFilter(tagId) {
    setActiveTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function clearTagFilter() {
    setActiveTagIds(new Set());
  }

  async function saveChatTags(tags) {
    setTagsSaving(true);
    try {
      await onSaveChatTags(tags);
      setTagsManagerOpen(false);
    } catch {
      // App.jsx surfaces the failure; keep the dialog open so the user can retry.
    } finally {
      setTagsSaving(false);
    }
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
      <div className="recent-label bots-label">
        <span className="recent-title">
          <Bot size={13} aria-hidden="true" />
          <span>Bots</span>
        </span>
        {onNewBot && (
          <button
            className="recent-filter-button"
            type="button"
            aria-label="New bot"
            title="New bot"
            onClick={() => onNewBot()}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      <div className="sidebar-bots">
        {bots.length === 0 ? (
          <p className="sidebar-bots-empty">
            Autonomous teammates. They find, organize, and delegate work periodically.
          </p>
        ) : (
          bots.map((bot) => (
            <BotItem
              key={bot.id}
              bot={bot}
              active={bot.conversationId === selectedId}
              onSelect={onSelectBot}
              onSettings={onBotSettings}
              onActivate={onActivateBot}
              onDelete={onDeleteBot}
            />
          ))
        )}
      </div>
      <div className="recent-label">
        <span className="recent-title">
          <Clock size={13} />
          Conversations
        </span>
        <button
          ref={filterButtonRef}
          className={classNames('recent-filter-button', (filterMenuOpen || activeTagIds.size > 0) && 'active')}
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
          {chatTags.length > 0 && (
            <>
              <div className="dropdown-menu-divider" role="separator" />
              <div className="dropdown-menu-label">Filter by tags</div>
              {chatTags.map((tag) => {
                const checked = activeTagIds.has(tag.id);
                return (
                  <DropdownMenuItem
                    key={tag.id}
                    active={checked}
                    icon={<span className="tag-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />}
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggleTagFilter(tag.id)}
                  >
                    {tag.name}
                  </DropdownMenuItem>
                );
              })}
              {activeTagIds.size > 0 && (
                <DropdownMenuItem icon={<X size={14} />} onClick={clearTagFilter}>
                  Clear filter
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenu>,
        document.body,
      )}
      <div className="conversation-list">
        {activeTagIds.size > 0 && conversationGroups.length === 0 && (
          <div className="conversation-filter-empty">
            <span>No chats with the selected tags.</span>
            <button type="button" onClick={clearTagFilter}>Clear filter</button>
          </div>
        )}
        {conversationGroups.map((group) => {
          const expanded = Boolean(expandedGroups[group.key]);
          const visibleItems = expanded ? group.items : group.items.slice(0, GROUP_LIMIT);
          const groupLabel = conversationGrouping === 'folder' && group.isHome
            ? 'Chats'
            : group.label;
          const folderColor = conversationGrouping === 'folder' && !group.isHome && !group.isTaskGroup
            ? folderColors[group.preset.project.path]
            : undefined;
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
                      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 330)),
                      left: Math.max(8, Math.min(event.clientX, window.innerWidth - 192)),
                    });
                  }
                  : undefined}
              >
                <span className="conversation-group-title" title={groupLabel}>
                  {conversationGrouping === 'folder' && !group.isHome && !group.isTaskGroup && (
                    <Folder
                      size={13}
                      aria-hidden="true"
                      style={folderColor ? { color: folderColor } : undefined}
                    />
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
                  <div className="dropdown-menu-divider" role="separator" />
                  <DropdownMenuItem
                    icon={folderColor
                      ? <span className="tag-dot" style={{ backgroundColor: folderColor }} aria-hidden="true" />
                      : <Palette size={14} />}
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={Boolean(folderMenu.colorMenu)}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const width = 232;
                      const fitsRight = rect.right + 8 + width <= window.innerWidth;
                      setFolderMenu((menu) => (menu ? {
                        ...menu,
                        colorMenu: menu.colorMenu
                          ? null
                          : {
                            top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - 120)),
                            left: Math.max(
                              8,
                              fitsRight
                                ? rect.right + 8
                                : Math.min(rect.left - 8 - width, window.innerWidth - width - 8),
                            ),
                          },
                      } : menu));
                    }}
                  >
                    Color
                  </DropdownMenuItem>
                </DropdownMenu>,
                document.body,
              )}
              {folderMenu?.key === group.key && folderMenu.colorMenu && createPortal(
                <DropdownMenu
                  className="conversation-folder-menu folder-color-menu"
                  fixed
                  role="menu"
                  style={{ top: folderMenu.colorMenu.top, left: folderMenu.colorMenu.left }}
                >
                  <div className="folder-color-picker" role="group" aria-label="Folder color">
                    <span className="folder-color-picker-label">Color</span>
                    <div className="folder-color-swatches">
                      <button
                        className={classNames('color-swatch', 'none', !folderColor && 'active')}
                        type="button"
                        role="menuitemradio"
                        aria-label="No color"
                        aria-checked={!folderColor}
                        title="No color"
                        onClick={() => onSetFolderColor(group.preset.project.path, null)}
                      >
                        <X size={10} aria-hidden="true" />
                      </button>
                      {presetColors.map((color) => (
                        <button
                          key={color.value}
                          className={classNames('color-swatch', folderColor === color.value && 'active')}
                          type="button"
                          role="menuitemradio"
                          style={{ backgroundColor: color.value }}
                          aria-label={color.name}
                          aria-checked={folderColor === color.value}
                          title={color.name}
                          onClick={() => onSetFolderColor(group.preset.project.path, color.value)}
                        />
                      ))}
                    </div>
                  </div>
                </DropdownMenu>,
                document.body,
              )}
              {visibleItems.map((conversation) => {
                const updatedTime = new Date(conversation.updatedAt).getTime();
                const ageHours = Number.isFinite(updatedTime)
                  ? Math.floor((now - updatedTime) / 3_600_000)
                  : null;
                return (
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
                    ageHours={ageHours}
                    chatTags={chatTags}
                    onSelect={onSelect}
                    onFork={onFork}
                    onArchive={onArchive}
                    onCopyId={onCopyThreadId}
                    onSetTags={onSetConversationTags}
                    onManageTags={setTagsManagerOpen}
                  />
                );
              })}
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
      {tagsManagerOpen && createPortal(
        <TagsManagerDialog
          tags={chatTags}
          busy={tagsSaving}
          onSave={saveChatTags}
          onClose={() => setTagsManagerOpen(false)}
        />,
        document.body,
      )}
    </aside>
  );
});

const BotItem = memo(function BotItem({ bot, active, onSelect, onSettings, onActivate, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const itemRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (itemRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.dropdown-menu')) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  function toggleMenu(sourceEvent) {
    const rect = sourceEvent?.currentTarget?.getBoundingClientRect?.();
    setMenuPosition(rect ? {
      top: Math.min(rect.bottom + 4, window.innerHeight - 150),
      left: Math.min(rect.right - 150, window.innerWidth - 160),
    } : { top: 100, left: 100 });
    setMenuOpen((value) => !value);
  }

  const statusLabel = bot.running || bot.scheduleState === 'working'
    ? 'Working'
    : bot.scheduleState === 'disabled'
      ? 'Disabled'
      : bot.scheduleState === 'sleep'
        ? 'Sleep'
        : 'Active';

  return (
    <div
      ref={itemRef}
      className={classNames(
        'conversation-item',
        'bot-item',
        bot.enabled === false && 'disabled',
        active && 'active',
        menuOpen && 'menu-open',
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPosition({
          top: Math.max(8, Math.min(event.clientY, window.innerHeight - 150)),
          left: Math.max(8, Math.min(event.clientX, window.innerWidth - 160)),
        });
        setMenuOpen(true);
      }}
    >
      <button
        className="conversation-main"
        type="button"
        onClick={() => onSelect(bot.conversationId)}
        title={bot.name}
      >
        <span className="bot-avatar" aria-hidden="true">
          <Avatar
            size={22}
            name={bot.iconSeed}
            variant="beam"
            colors={botAvatarColors}
          />
        </span>
        <span className="conversation-title">{bot.name}</span>
        {bot.pendingApprovals > 0 && (
          <span className="bot-queue-badge" title="Pending user approvals">
            {bot.pendingApprovals}
          </span>
        )}
        {bot.running || bot.scheduleState === 'working' ? (
          <LoaderCircle className="run-spinner" size={13} aria-label="Working" />
        ) : bot.scheduleState === 'disabled' ? (
          <span className="bot-status-dot disabled" aria-label={statusLabel} />
        ) : bot.scheduleState === 'sleep' ? (
          <Moon className="bot-status-sleep" size={13} aria-label="Sleep" />
        ) : (
          <span className="bot-status-dot active" aria-label={statusLabel} />
        )}
      </button>
      <button
        className="icon-button tiny"
        type="button"
        aria-label={`Actions for ${bot.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => toggleMenu(event)}
      >
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && menuPosition && createPortal(
        <DropdownMenu fixed style={{ top: menuPosition.top, left: menuPosition.left }}>
          <DropdownMenuItem icon={<Settings size={14} />} onClick={() => {
            setMenuOpen(false);
            onSettings(bot.id);
          }}>
            Bot settings
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Play size={14} />}
            disabled={bot.enabled === false}
            title={bot.enabled === false ? 'Enable this bot in Schedule first' : undefined}
            onClick={() => {
              setMenuOpen(false);
              onActivate(bot.id);
            }}
          >
            Activate now
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Trash2 size={14} />} onClick={() => {
            setMenuOpen(false);
            onDelete(bot.id);
          }}>
            Delete bot...
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
    </div>
  );
});

const ConversationItem = memo(function ConversationItem({
  conversation,
  active,
  running,
  runStartedAt,
  completedUnseen,
  approvalPending,
  inputPending,
  semaphoreWaiting,
  needsAttention,
  ageHours,
  chatTags = emptyList,
  onSelect,
  onFork,
  onArchive,
  onCopyId,
  onSetTags,
  onManageTags,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const [tagsMenuOpen, setTagsMenuOpen] = useState(false);
  const [tagsMenuPosition, setTagsMenuPosition] = useState(null);
  const [optimisticTags, setOptimisticTags] = useState(null);
  const optimisticTagsRef = useRef(null);
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
  const tagIds = new Set(optimisticTags ?? conversation.tags ?? []);
  const tagChips = chatTags.filter((tag) => tagIds.has(tag.id));

  // The prop catching up with a pending edit means the round-trip finished.
  useEffect(() => {
    optimisticTagsRef.current = null;
    setOptimisticTags(null);
  }, [conversation.tags]);
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
    if (!Number.isFinite(ageHours) || ageHours < 1) return '';
    if (ageHours < 24) return `${ageHours}h`;
    const days = Math.floor(ageHours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (days < 30) return `${weeks}w`;
    const months = Math.floor(days / 30);
    if (days < 365) return `${months}mo`;
    return `${Math.floor(days / 365)}y`;
  })();

  useEffect(() => {
    if (!menuOpen && !tagsMenuOpen) return undefined;

    const close = (event) => {
      if (menuButtonRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.dropdown-menu')) return;
      setMenuOpen(false);
      setTagsMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setTagsMenuOpen(false);
    };
    const closeOnResize = () => {
      setMenuOpen(false);
      setTagsMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnResize, { once: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [menuOpen, tagsMenuOpen]);

  useEffect(() => () => window.clearTimeout(tooltipTimerRef.current), []);

  // Menus and the tags dialog take over the interaction; the tooltip must go.
  useEffect(() => {
    if (menuOpen || tagsMenuOpen) closeTooltip();
  }, [menuOpen, tagsMenuOpen]);

  useEffect(() => {
    if (!tooltipPosition) return undefined;
    setTooltipNow(Date.now());
    const interval = window.setInterval(() => setTooltipNow(Date.now()), 1000);
    const close = () => setTooltipPosition(null);
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setTooltipPosition(null);
    };
    const closeOnOutsidePointer = (event) => {
      if (!itemRef.current?.contains(event.target)) close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('pointerdown', closeOnOutsidePointer, { capture: true });
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('pointerdown', closeOnOutsidePointer, { capture: true });
    };
  }, [tooltipPosition]);

  function openTooltip() {
    if (menuOpen || tagsMenuOpen) return;
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

  function openTagsMenu() {
    const rect = itemRef.current.getBoundingClientRect();
    setMenuOpen(false);
    setTagsMenuPosition({
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 240)),
      left: Math.max(8, Math.min(rect.right - 170, window.innerWidth - 200)),
    });
    setTagsMenuOpen(true);
  }

  function toggleTag(tagId) {
    // Optimistic local state: rapid clicks race the IPC round-trip, so the
    // next list must build on pending edits, not on the stale prop. The ref
    // survives same-tick clicks that share the same render closure.
    const base = optimisticTagsRef.current ?? conversation.tags ?? [];
    const next = base.includes(tagId)
      ? base.filter((id) => id !== tagId)
      : [...base, tagId];
    optimisticTagsRef.current = next;
    setOptimisticTags(next);
    onSetTags(conversation.id, next).catch(() => {
      optimisticTagsRef.current = null;
      setOptimisticTags(null);
    });
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
        onClick={() => onSelect(conversation.id)}
        onFocus={openTooltip}
        onBlur={closeTooltip}
      >
        <span className="conversation-title">{conversation.title || conversation.firstPrompt || 'New chat'}</span>
        {conversation.createdBy === 'agent' && (
          <Bot
            className="agent-thread-icon"
            size={12}
            aria-label="Created by an agent"
          />
        )}
        {tagChips.length > 0 && (
          <span className="conversation-tag-dots">
            {tagChips.map((tag) => (
              <span
                key={tag.id}
                className="tag-dot"
                style={{ backgroundColor: tag.color }}
                title={tag.name}
              />
            ))}
          </span>
        )}
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
          <DropdownMenuItem
            icon={<CopyPlus size={14} />}
            onClick={() => runMenuAction(() => onFork(conversation.id))}
          >
            Fork chat
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Hash size={14} />}
            onClick={() => runMenuAction(() => onCopyId(conversation.id))}
          >
            Copy thread ID
          </DropdownMenuItem>
          <div className="dropdown-menu-divider" role="separator" />
          <DropdownMenuItem icon={<Tags size={14} />} onClick={openTagsMenu}>
            Tags
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Archive size={14} />}
            onClick={() => runMenuAction(() => onArchive(conversation.id))}
          >
            Archive chat
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
      {tagsMenuOpen && tagsMenuPosition && createPortal(
        <DropdownMenu
          className="conversation-tags-menu"
          fixed
          role="menu"
          style={{ top: tagsMenuPosition.top, left: tagsMenuPosition.left }}
        >
          {chatTags.length === 0 && <div className="dropdown-menu-empty">No tags yet</div>}
          {chatTags.map((tag) => {
            const checked = tagIds.has(tag.id);
            return (
              <DropdownMenuItem
                key={tag.id}
                active={checked}
                icon={<span className="tag-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />}
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => toggleTag(tag.id)}
              >
                {tag.name}
              </DropdownMenuItem>
            );
          })}
          <div className="dropdown-menu-divider" role="separator" />
          <DropdownMenuItem
            icon={<Settings size={14} />}
            onClick={() => {
              setTagsMenuOpen(false);
              onManageTags(true);
            }}
          >
            Manage tags...
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
});
