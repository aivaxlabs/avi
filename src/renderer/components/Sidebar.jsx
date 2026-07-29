import {
  Check,
  Clock,
  CopyPlus,
  Filter,
  Folder,
  FolderCog,
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { classNames } from '../lib/format.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const GROUP_LIMIT = 5;
const conversationGroupingKey = 'aivax.sidebar.conversation-grouping';
const savedConversationGrouping = window.localStorage.getItem(conversationGroupingKey);

export function Sidebar({
  conversations,
  models = [],
  selectedId,
  running,
  onNewChat,
  onSelect,
  onSearch,
  onFork,
  onDelete,
  onOpenProject,
  onSettings,
  collapsed,
  onToggleCollapsed,
}) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPosition, setFilterMenuPosition] = useState(null);
  const [conversationGrouping, setConversationGrouping] = useState(
    ['model', 'folder'].includes(savedConversationGrouping)
      ? savedConversationGrouping
      : 'chronological',
  );
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
        const updatedTime = new Date(conversation.updatedAt).getTime();
        current.items.push(conversation);
        current.latestTime = Math.max(
          current.latestTime,
          Number.isFinite(updatedTime) ? updatedTime : 0,
        );
        groupsByValue.set(key, current);
      }

      return [...groupsByValue.values()]
        .sort((a, b) => b.latestTime - a.latestTime || a.label.localeCompare(b.label));
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
  }, [conversationGrouping, conversations, models, now]);

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
        <div className="app-name">AIVAX</div>
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
          return (
            <section key={group.key} className="conversation-group">
              <div className="conversation-group-header">
                <span title={group.label}>{group.label}</span>
                {conversationGrouping !== 'chronological' && (
                  <div className="conversation-group-actions">
                    <button
                      type="button"
                      aria-label={`New chat with ${group.label}`}
                      title={`New chat with ${group.label}`}
                      onClick={() => onNewChat(group.preset)}
                    >
                      <Plus size={13} />
                    </button>
                    {conversationGrouping === 'folder' && (
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
                    icon={<FolderCog size={14} />}
                    role="menuitem"
                    onClick={() => {
                      setFolderMenu(null);
                      onSettings(group.preset.project);
                    }}
                  >
                    Manage Context
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
                  now={now}
                  onSelect={() => onSelect(conversation.id)}
                  onFork={() => onFork(conversation.id)}
                  onDelete={() => onDelete(conversation.id)}
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

function ConversationItem({ conversation, active, running, now, onSelect, onFork, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuButtonRef = useRef(null);
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
    <div className={classNames('conversation-item', active && 'active', menuOpen && 'menu-open')}>
      <button className="conversation-main" type="button" onClick={onSelect}>
        <span className={classNames('run-dot', running && 'live')} />
        <span className="conversation-title">{conversation.title || conversation.firstPrompt || 'New chat'}</span>
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
          <DropdownMenuItem icon={<Trash2 size={14} />} onClick={() => runMenuAction(onDelete)}>
            Delete chat
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
    </div>
  );
}
