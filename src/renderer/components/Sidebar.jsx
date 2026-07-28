import {
  Check,
  Clock,
  CopyPlus,
  Filter,
  FolderOpen,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2,
  UserRound,
  Workflow,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { classNames } from '../lib/format.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const GROUP_LIMIT = 5;

export function Sidebar({
  conversations,
  models = [],
  selectedId,
  account,
  running,
  onNewChat,
  onSelect,
  onSearch,
  onFork,
  onDelete,
  onAccount,
  onSwitchWorkspace,
  onLogout,
  onWorkspace,
  activeWorkspaceId,
  collapsed,
  onToggleCollapsed,
}) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountMenuPosition, setAccountMenuPosition] = useState(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPosition, setFilterMenuPosition] = useState(null);
  const [conversationGrouping, setConversationGrouping] = useState('chronological');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const accountButtonRef = useRef(null);
  const filterButtonRef = useRef(null);

  const conversationGroups = useMemo(() => {
    const sortedConversations = [...conversations].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    if (conversationGrouping === 'model') {
      const modelsById = new Map(models.map((model) => [model.id, model]));
      const groupsByModel = new Map();

      for (const conversation of sortedConversations) {
        const model = modelsById.get(conversation.model);
        const key = `model:${conversation.model || 'none'}`;
        const current = groupsByModel.get(key) ?? {
          key,
          label: model?.name || conversation.model || 'No model',
          items: [],
          latestTime: 0,
        };
        const updatedTime = new Date(conversation.updatedAt).getTime();
        current.items.push(conversation);
        current.latestTime = Math.max(
          current.latestTime,
          Number.isFinite(updatedTime) ? updatedTime : 0,
        );
        groupsByModel.set(key, current);
      }

      return [...groupsByModel.values()]
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
    if (!accountMenuOpen) return undefined;
    const close = (event) => {
      if (accountButtonRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.dropdown-menu')) return;
      setAccountMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', () => setAccountMenuOpen(false), { once: true });
    return () => window.removeEventListener('pointerdown', close);
  }, [accountMenuOpen]);

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

  function toggleAccountMenu() {
    const rect = accountButtonRef.current.getBoundingClientRect();
    setAccountMenuPosition({
      top: Math.max(8, Math.min(rect.top - 118, window.innerHeight - 130)),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 190)),
    });
    setAccountMenuOpen((value) => !value);
  }

  function toggleFilterMenu() {
    const rect = filterButtonRef.current.getBoundingClientRect();
    setFilterMenuPosition({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 196)),
    });
    setFilterMenuOpen((value) => !value);
  }

  function runAccountAction(action) {
    setAccountMenuOpen(false);
    action();
  }

  function chooseConversationGrouping(grouping) {
    setConversationGrouping(grouping);
    setExpandedGroups({});
    setFilterMenuOpen(false);
  }

  return (
    <aside className="sidebar">
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
        <button type="button" onClick={onNewChat}>
          <MessageSquarePlus size={17} />
          <span>New chat</span>
        </button>
        <button type="button" disabled={!activeWorkspaceId} onClick={onWorkspace}>
          <Workflow size={17} />
          <span>Workspace</span>
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
        </DropdownMenu>,
        document.body,
      )}
      <div className="conversation-list">
        {conversationGroups.map((group) => {
          const expanded = Boolean(expandedGroups[group.key]);
          const visibleItems = expanded ? group.items : group.items.slice(0, GROUP_LIMIT);
          return (
            <section key={group.key} className="conversation-group">
              <div className="conversation-group-header">{group.label}</div>
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
      <button ref={accountButtonRef} className="account-button" type="button" onClick={toggleAccountMenu}>
        {account?.emailSha256 ? (
          <img
            src={`https://www.gravatar.com/avatar/${account.emailSha256}?d=identicon&s=64`}
            alt=""
          />
        ) : (
          <span className="account-fallback"><UserRound size={17} /></span>
        )}
        <span>{account?.name || 'Account'}</span>
      </button>
      {accountMenuOpen && accountMenuPosition && createPortal(
        <DropdownMenu className="account-menu" fixed style={{ top: accountMenuPosition.top, left: accountMenuPosition.left }}>
          <DropdownMenuItem icon={<UserRound size={14} />} onClick={() => runAccountAction(onAccount)}>
            Account
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FolderOpen size={14} />} onClick={() => runAccountAction(onSwitchWorkspace)}>
            Switch workspace
          </DropdownMenuItem>
          <DropdownMenuItem icon={<LogOut size={14} />} onClick={() => runAccountAction(onLogout)}>
            Log out
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
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
