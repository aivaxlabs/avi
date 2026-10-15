import { Folder, Home, Inbox, Puzzle, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';

const activities = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'folders', label: 'Folders', icon: Folder },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function ActionPageIcon({ icon }) {
  const name = typeof icon === 'string'
    ? icon.replace(/(^|-)([a-z0-9])/g, (_match, _dash, char) => char.toUpperCase())
    : null;
  const [Icon, setIcon] = useState(null);

  useEffect(() => {
    if (!name) return undefined;
    let cancelled = false;
    // The complete Lucide map is large, so it is split from the main bundle and loaded only for named plugin icons.
    import('lucide-react/dist/esm/icons/index.js')
      .then((icons) => icons[name] ?? Puzzle, () => Puzzle)
      .then((resolved) => {
        if (!cancelled) setIcon(() => resolved);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (icon?.svg) {
    const mask = `url("data:image/svg+xml,${encodeURIComponent(icon.svg)}") center / contain no-repeat`;
    return <span className="activity-svg-icon" style={{ mask, WebkitMask: mask }} aria-hidden="true" />;
  }
  if (!name) return <Puzzle size={21} aria-hidden="true" />;
  return Icon ? <Icon size={21} aria-hidden="true" /> : <span style={{ width: 21, height: 21 }} aria-hidden="true" />;
}

export function ActivityBar({ active, onSelect, updateAvailable, counts = {}, actionPages = [] }) {
  const renderActivity = ({ id, label, icon: Icon }) => {
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
  };

  return (
    <nav className="activity-bar" aria-label="Main navigation">
      {activities.slice(0, -1).map(renderActivity)}
      {actionPages.length > 0 && <hr className="activity-separator" />}
      {actionPages.map((page) => {
        const label = `${page.title} (${page.pluginName})`;
        return (
          <button
            key={page.id}
            type="button"
            aria-label={label}
            aria-current={active === page.id ? 'page' : undefined}
            title={label}
            onClick={() => onSelect(page.id)}
          >
            <ActionPageIcon icon={page.icon} />
          </button>
        );
      })}
      {renderActivity(activities.at(-1))}
    </nav>
  );
}
