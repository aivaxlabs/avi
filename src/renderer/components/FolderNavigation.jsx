import { Archive, ArrowLeft, FileText, Folder, Globe2, MessagesSquare, Search, Server } from 'lucide-react';
import { useEffect, useState } from 'react';

const destinations = [
  { id: 'mcp', label: 'MCP Servers', icon: Server },
  { id: 'context-folder', label: 'Context', icon: FileText },
  { id: 'folder-threads', label: 'Threads', icon: MessagesSquare },
  { id: 'folder-archive', label: 'Archive', icon: Archive },
];

export function FolderNavigation({ homeFolder, selectedFolder, view, onSelectFolder, onSelectView }) {
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const workingFolders = folders.filter((folder) => folder.path !== homeFolder.path);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleFolders = workingFolders.filter((folder) => (
    `${folder.name} ${folder.displayPath ?? ''} ${folder.path}`.toLocaleLowerCase().includes(normalizedQuery)
  ));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    window.chatApp.folders.list().then((items) => {
      if (active) setFolders(items);
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [attempt]);

  return (
    <aside className="settings-sidebar folder-navigation">
      <div className="settings-sidebar-titlebar" />
      <h2>Folders</h2>
      {!selectedFolder && (
        <div className="settings-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" aria-label="Filter folders" placeholder="Filter folders..."
            value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      )}
      <nav className="settings-navigation folder-global" aria-label="Global folder">
        <button
          type="button"
          aria-current={selectedFolder?.path === homeFolder.path ? 'location' : undefined}
          className={selectedFolder?.path === homeFolder.path ? 'active' : undefined}
          onClick={() => onSelectFolder({ ...homeFolder, name: 'Global' })}
        >
          <Globe2 size={16} aria-hidden="true" /> Global
        </button>
      </nav>
      <div className="folder-navigation-scroll">
        {selectedFolder ? (
          <>
            <button className="settings-back" type="button" onClick={() => onSelectFolder(null)}>
              <ArrowLeft size={15} aria-hidden="true" /> All folders
            </button>
            <div className="folder-navigation-heading" title={selectedFolder.displayPath || selectedFolder.path}>
              <Folder size={16} aria-hidden="true" />
              <strong>{selectedFolder.name}</strong>
            </div>
            <nav className="settings-navigation" aria-label="Folder sections">
              {destinations.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className={view === id ? 'active' : undefined}
                  aria-current={view === id ? 'page' : undefined} onClick={() => onSelectView(id)}>
                  <Icon size={16} aria-hidden="true" /> {label}
                </button>
              ))}
            </nav>
          </>
        ) : (
          <nav className="settings-navigation" aria-label="Working folders">
            {loading && <p role="status">Loading folders...</p>}
            {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></p>}
            {!loading && !error && workingFolders.length === 0 && (
              <p>No working folders yet. Choose a folder when starting a chat.</p>
            )}
            {!loading && !error && workingFolders.length > 0 && visibleFolders.length === 0 && (
              <p role="status">No folders match your filter.</p>
            )}
            {visibleFolders.map((folder) => (
              <button key={folder.path} type="button" title={folder.displayPath || folder.path}
                onClick={() => onSelectFolder(folder)}>
                <Folder size={16} aria-hidden="true" /><span>{folder.name}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}
