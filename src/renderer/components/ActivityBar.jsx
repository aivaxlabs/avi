import { Folder, Home, Inbox, Settings } from 'lucide-react';

const activities = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'folders', label: 'Folders', icon: Folder },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function ActivityBar({ active, onSelect, updateAvailable, counts = {} }) {
  return (
    <nav className="activity-bar" aria-label="Main navigation">
      {activities.map(({ id, label, icon: Icon }) => {
        const count = counts[id] ?? 0;
        const accessibleLabel = count > 0
          ? `${label}, ${count} ${id === 'home' ? 'chats need attention or review' : 'unread messages'}`
          : id === 'settings' && updateAvailable ? 'Settings, update available' : label;

        return (
          <button
            key={id}
            className={id === 'settings' ? 'activity-settings' : undefined}
            type="button"
            aria-label={accessibleLabel}
            aria-current={active === id ? 'page' : undefined}
            title={accessibleLabel}
            onClick={() => onSelect(id)}
          >
            <Icon size={21} aria-hidden="true" />
            {count > 0 && (
              <span className="activity-count-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>
            )}
            {id === 'settings' && updateAvailable && <i className="activity-update-badge" />}
          </button>
        );
      })}
    </nav>
  );
}
