import {
  Clock,
  CopyPlus,
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
import { useEffect, useRef, useState } from 'react';
import { classNames } from '../lib/format.js';

export function Sidebar({
  conversations,
  selectedId,
  account,
  running,
  onNewChat,
  onSelect,
  onSearch,
  onFork,
  onDelete,
  onAccount,
  collapsed,
  onToggleCollapsed,
}) {
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
        <button type="button" disabled>
          <Workflow size={17} />
          <span>Workspace</span>
        </button>
        <button type="button" onClick={onSearch}>
          <Search size={17} />
          <span>Search chats</span>
        </button>
      </div>
      <div className="recent-label">
        <Clock size={13} />
        Recent
      </div>
      <div className="conversation-list">
        {conversations.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === selectedId}
            running={Boolean(running[conversation.id])}
            onSelect={() => onSelect(conversation.id)}
            onFork={() => onFork(conversation.id)}
            onDelete={() => onDelete(conversation.id)}
          />
        ))}
      </div>
      <button className="account-button" type="button" onClick={onAccount}>
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
    </aside>
  );
}

function ConversationItem({ conversation, active, running, onSelect, onFork, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuButtonRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const close = (event) => {
      if (menuButtonRef.current?.contains(event.target)) return;
      if (event.target.closest?.('.item-menu')) return;
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
    <div className={classNames('conversation-item', active && 'active')}>
      <button className="conversation-main" type="button" onClick={onSelect}>
        <span className={classNames('run-dot', running && 'live')} />
        <span>{conversation.title || conversation.firstPrompt || 'New chat'}</span>
      </button>
      <button ref={menuButtonRef} className="icon-button tiny" type="button" onClick={toggleMenu}>
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && menuPosition && createPortal(
        <div className="item-menu" style={{ top: menuPosition.top, left: menuPosition.left }}>
          <button type="button" onClick={() => runMenuAction(onFork)}>
            <CopyPlus size={14} />
            Fork chat
          </button>
          <button type="button" onClick={() => runMenuAction(onDelete)}>
            <Trash2 size={14} />
            Delete chat
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
