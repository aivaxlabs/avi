import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderSearch,
  FolderSymlink,
  GitBranch,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import iconTheme from '../../../fileicons/studio-icons.json';
import { formatBytes } from '../lib/files.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const iconAssets = import.meta.glob('../../../fileicons/images/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
});
const iconUrls = Object.fromEntries(Object.entries(iconAssets).map(([path, url]) => (
  [path.split('/').at(-1), url]
)));
const statusLabels = {
  conflict: { badge: 'C', label: 'Merge conflict' },
  ignored: { badge: 'I', label: 'Ignored' },
  modified: { badge: 'M', label: 'Modified' },
  untracked: { badge: 'U', label: 'Untracked' },
};

function absoluteWorkspacePath(folderPath, targetPath) {
  const separator = folderPath.includes('\\') ? '\\' : '/';
  return `${folderPath.replace(/[\\/]+$/, '')}${
    targetPath ? `${separator}${targetPath.replace(/[\\/]/g, separator)}` : ''
  }`;
}

function escapeXmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function FileIcon({
  dark,
  expanded,
  node,
  root = false,
}) {
  const theme = dark ? iconTheme : iconTheme.light;
  const lowerName = node.name.toLowerCase();
  const extension = lowerName.includes('.') ? lowerName.split('.').at(-1) : '';
  const iconName = node.type === 'directory'
    ? root
      ? expanded
        ? theme.rootFolderExpanded
        : theme.rootFolder
      : expanded
        ? theme.folderNamesExpanded?.[lowerName] ?? theme.folderExpanded
        : theme.folderNames?.[lowerName] ?? theme.folder
    : theme.fileNames?.[node.name]
      ?? theme.fileNames?.[lowerName]
      ?? theme.fileExtensions?.[extension]
      ?? theme.file;
  const source = iconUrls[iconName] ?? iconUrls[theme.file];

  return source
    ? <img className="files-node-icon" src={source} alt="" aria-hidden="true" />
    : <span className="files-node-icon" aria-hidden="true" />;
}

export function FilesPanel({
  project,
  onAddToChat,
  navigation,
  onNavigationConsumed,
}) {
  const [workspace, setWorkspace] = useState(null);
  const [directories, setDirectories] = useState({});
  const [expanded, setExpanded] = useState(new Set(['']));
  const [selectedPath, setSelectedPath] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLine, setPreviewLine] = useState(null);
  const [previewLineTo, setPreviewLineTo] = useState(null);
  const [loadingPath, setLoadingPath] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectionAction, setSelectionAction] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [contextMenu, setContextMenu] = useState(null);
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-color-scheme') === 'dark',
  );
  const contextTargetRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute('data-color-scheme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    setWorkspace(null);
    setDirectories({});
    setExpanded(new Set(['']));
    setSelectedPath('');
    setPreview(null);
    setPreviewLine(null);
    setPreviewLineTo(null);
    setError('');
    setSearchQuery('');
    setSearchResults(null);
    setSearchError('');
    setSelectionAction(null);
    if (!project?.path) return undefined;

    window.chatApp.files.workspace(project.path)
      .then((result) => {
        if (!active) return;
        setWorkspace(result);
        setDirectories({ '': result.children });
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, [project?.path, refreshKey]);

  useEffect(() => {
    let active = true;
    const query = searchQuery.trim();
    if (!query || !project?.path) {
      setSearchResults(null);
      setSearchError('');
      setSearching(false);
      return undefined;
    }

    setSearching(true);
    setSearchError('');
    setSearchResults(null);
    const timeout = setTimeout(() => {
      window.chatApp.files.search({
        folderPath: project.path,
        query,
      })
        .then((results) => {
          if (active) setSearchResults(results);
        })
        .catch((nextError) => {
          if (active) {
            setSearchResults(null);
            setSearchError(nextError instanceof Error ? nextError.message : String(nextError));
          }
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 120);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [project?.path, searchQuery]);

  useEffect(() => {
    if (!workspace || !navigation?.path || !project?.path) return undefined;
    let active = true;
    const normalizedRoot = project.path.replaceAll('\\', '/').replace(/\/+$/, '');
    const normalizedTarget = navigation.path.replaceAll('\\', '/');
    const windowsPath = /^[a-z]:\//i.test(normalizedRoot);
    const targetInsideRoot = windowsPath
      ? normalizedTarget.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
      : normalizedTarget.startsWith(`${normalizedRoot}/`);
    const unresolvedPath = targetInsideRoot
      ? normalizedTarget.slice(normalizedRoot.length + 1)
      : normalizedTarget.replace(/^\.\//, '');
    if (
      unresolvedPath.startsWith('/')
      || /^[a-z]:\//i.test(unresolvedPath)
      || unresolvedPath === '..'
      || unresolvedPath.startsWith('../')
    ) {
      setError(`"${navigation.path}" is outside the current directory.`);
      onNavigationConsumed?.(navigation.id);
      return undefined;
    }

    const separator = project.path.includes('\\') ? '\\' : '/';
    const relativePath = unresolvedPath.replaceAll('/', separator);
    const pathParts = relativePath.split(separator);
    const directoryPaths = pathParts.slice(0, -1).map((_, index) => (
      pathParts.slice(0, index + 1).join(separator)
    ));
    setSelectedPath(relativePath);
    setPreview(null);
    setPreviewLine(navigation.lineFrom);
    setPreviewLineTo(navigation.lineTo);
    setSelectionAction(null);
    setSearchQuery('');
    setSearchResults(null);
    setError('');
    setLoadingPath(relativePath);

    Promise.all([
      window.chatApp.files.read({
        folderPath: project.path,
        filePath: relativePath,
      }),
      ...directoryPaths.map((directoryPath) => window.chatApp.files.directory({
        folderPath: project.path,
        directoryPath,
      })),
    ])
      .then(([nextPreview, ...directoryEntries]) => {
        if (!active) return;
        setPreview(nextPreview);
        setDirectories((current) => ({
          ...current,
          ...Object.fromEntries(directoryPaths.map((path, index) => (
            [path, directoryEntries[index]]
          ))),
        }));
        setExpanded((current) => new Set([
          ...current,
          '',
          ...directoryPaths,
        ]));
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!active) return;
        setLoadingPath('');
        onNavigationConsumed?.(navigation.id);
      });

    return () => {
      active = false;
    };
  }, [navigation?.id, project?.path, workspace]);

  useEffect(() => {
    if (!previewLine || preview?.kind !== 'text') return;
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector(`[data-files-line="${previewLine}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [preview, previewLine]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.files-context-menu')) return;
      setContextMenu(null);
    }, {
      once: true,
      signal: controller.signal,
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setContextMenu(null);
      contextTargetRef.current?.focus();
    }, { signal: controller.signal });
    window.addEventListener('resize', () => setContextMenu(null), {
      once: true,
      signal: controller.signal,
    });
    queueMicrotask(() => document.querySelector('.files-context-menu [role="menuitem"]')?.focus());
    return () => controller.abort();
  }, [contextMenu]);

  useEffect(() => {
    if (!selectionAction) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.files-selection-action')) return;
      setSelectionAction(null);
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setSelectionAction(null);
      window.getSelection()?.removeAllRanges();
    }, { signal: controller.signal });
    window.addEventListener('resize', () => setSelectionAction(null), {
      once: true,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [selectionAction]);

  const toggleDirectory = async (path) => {
    if (expanded.has(path)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set([...current, path]));
    if (directories[path]) return;

    setLoadingPath(path);
    try {
      const children = await window.chatApp.files.directory({
        folderPath: project.path,
        directoryPath: path,
      });
      setDirectories((current) => ({ ...current, [path]: children }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoadingPath('');
    }
  };

  const selectFile = async (node, line = null, lineTo = line) => {
    if (node.type === 'directory') {
      await toggleDirectory(node.path);
      return;
    }
    if (node.type !== 'file') return;

    setSelectedPath(node.path);
    setPreview(null);
    setPreviewLine(line);
    setPreviewLineTo(lineTo);
    setSelectionAction(null);
    setError('');
    setLoadingPath(node.path);
    try {
      setPreview(await window.chatApp.files.read({
        folderPath: project.path,
        filePath: node.path,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoadingPath('');
    }
  };

  const showContextMenu = (event, node) => {
    event.preventDefault();
    contextTargetRef.current = event.currentTarget;
    const width = 190;
    const height = node.type === 'file' ? 144 : 110;
    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = event.clientX || rect.left + 8;
    const clientY = event.clientY || rect.bottom;
    setContextMenu({
      node,
      left: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
    });
  };

  const updateSelectionAction = () => {
    const selection = window.getSelection();
    if (
      !onAddToChat
      || !preview?.content
      || !selection
      || selection.rangeCount === 0
      || selection.isCollapsed
    ) {
      setSelectionAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
    const endElement = range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : range.endContainer;
    const startCode = startElement?.closest?.('code');
    const endCode = endElement?.closest?.('code');
    const startLineElement = startCode?.closest('.files-code-line');
    const endLineElement = endCode?.closest('.files-code-line');
    if (
      !startLineElement
      || !endLineElement
      || !panelRef.current?.contains(startLineElement)
      || !panelRef.current?.contains(endLineElement)
    ) {
      setSelectionAction(null);
      return;
    }

    const lines = preview.content.split('\n');
    const lineFrom = Number(startLineElement.dataset.filesLine);
    const lineTo = Number(endLineElement.dataset.filesLine);
    const startOffset = Math.min(
      range.startContainer.nodeType === Node.TEXT_NODE ? range.startOffset : 0,
      lines[lineFrom - 1].length,
    );
    const endOffset = Math.min(
      range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endOffset
        : lines[lineTo - 1].length,
      lines[lineTo - 1].length,
    );
    const content = lineFrom === lineTo
      ? lines[lineFrom - 1].slice(startOffset, endOffset)
      : [
          lines[lineFrom - 1].slice(startOffset),
          ...lines.slice(lineFrom, lineTo - 1),
          lines[lineTo - 1].slice(0, endOffset),
        ].join('\n');
    if (!content) {
      setSelectionAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const width = 104;
    const height = 34;
    const below = rect.bottom + 8;
    setSelectionAction({
      content,
      lineFrom,
      lineTo,
      charFrom: startOffset + 1,
      charTo: endOffset,
      left: Math.max(8, Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - 8,
      )),
      top: below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - height - 8),
    });
  };

  const renderNodes = (nodes, depth = 0) => nodes.map((node) => {
    const isExpanded = node.type === 'directory' && expanded.has(node.path);
    const status = statusLabels[node.status];
    return (
      <div className="files-tree-entry" key={node.path}>
        <button
          className={`files-tree-node${selectedPath === node.path ? ' selected' : ''}${
            node.status ? ` status-${node.status}` : ''
          }`}
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selectedPath === node.path}
          style={{ '--files-depth': depth }}
          title={node.path}
          aria-expanded={node.type === 'directory' ? isExpanded : undefined}
          onClick={() => selectFile(node)}
          onContextMenu={(event) => showContextMenu(event, node)}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              showContextMenu(event, node);
            } else if (node.type === 'directory' && event.key === 'ArrowRight' && !isExpanded) {
              event.preventDefault();
              toggleDirectory(node.path);
            } else if (node.type === 'directory' && event.key === 'ArrowLeft' && isExpanded) {
              event.preventDefault();
              toggleDirectory(node.path);
            }
          }}
        >
          <span className="files-node-chevron" aria-hidden="true">
            {node.type === 'directory'
              ? loadingPath === node.path
                ? <LoaderCircle className="spin" size={13} />
                : isExpanded
                  ? <ChevronDown size={13} />
                  : <ChevronRight size={13} />
              : null}
          </span>
          <FileIcon dark={dark} expanded={isExpanded} node={node} />
          <span className="files-node-name">{node.name}</span>
          {node.repository && (
            <GitBranch className="files-repository-mark" size={12} aria-label="Git repository" />
          )}
          {status && (
            <span className="files-status" title={status.label} aria-label={status.label}>
              {status.badge}
            </span>
          )}
        </button>
        {isExpanded && (
          <div role="group">
            {directories[node.path]
              ? renderNodes(directories[node.path], depth + 1)
              : loadingPath !== node.path && (
                <span className="files-tree-message" style={{ '--files-depth': depth + 1 }}>
                  Could not load directory
                </span>
              )}
          </div>
        )}
      </div>
    );
  });

  if (!project?.path) {
    return (
      <div className="files-panel-state">
        <FolderSearch size={20} aria-hidden="true" />
        <strong>No directory selected</strong>
        <span>Choose a project directory to browse its files.</span>
      </div>
    );
  }

  const selectedDirectory = /[\\/]/.test(selectedPath)
    ? selectedPath.replace(/[\\/][^\\/]+$/, '')
    : '';
  const hasSearch = Boolean(searchQuery.trim());

  return (
    <section
      ref={panelRef}
      className={`files-panel${selectedPath ? ' has-preview' : ''}`}
      aria-label="Files"
    >
      <div className="files-explorer">
        <header className="files-explorer-header">
          <span>
            <strong>{workspace?.name ?? project.name}</strong>
            <small>{project.displayPath ?? project.path}</small>
          </span>
          <button
            type="button"
            aria-label="Refresh files and Git status"
            title="Refresh files and Git status"
            disabled={!workspace}
            onClick={() => setRefreshKey((current) => current + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </header>
        <label className="files-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search files and content"
            placeholder="Search files and content"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearchQuery('');
            }}
          />
          {searching ? (
            <LoaderCircle className="spin" size={13} aria-label="Searching" />
          ) : hasSearch ? (
            <button
              className="files-search-clear"
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => setSearchQuery('')}
            >
              <X size={12} />
            </button>
          ) : null}
        </label>
        <div
          className="files-tree"
          role={hasSearch ? 'region' : 'tree'}
          aria-label={hasSearch ? 'File search results' : `Files in ${project.path}`}
        >
          {!hasSearch && !workspace && !error && (
            <div className="files-loading">
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
              <span>Scanning files and Git repositories…</span>
            </div>
          )}
          {!hasSearch && workspace && (
            <div className="files-root">
              <div className="files-root-label">
                <FileIcon
                  dark={dark}
                  expanded
                  node={{ name: workspace.name, type: 'directory' }}
                  root
                />
                <span>{workspace.name}</span>
              </div>
              {renderNodes(directories[''] ?? [])}
            </div>
          )}
          {hasSearch && (
            <div className="files-search-results">
              {searching && !searchResults && (
                <div className="files-loading">
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                  <span>Searching files and content…</span>
                </div>
              )}
              {searchError && (
                <div className="files-panel-error" role="alert">{searchError}</div>
              )}
              {searchResults?.files.length > 0 && (
                <section aria-labelledby="files-search-filenames">
                  <h3 id="files-search-filenames">Files</h3>
                  {searchResults.files.map((result) => {
                    const status = statusLabels[result.status];
                    return (
                      <button
                        className={`files-search-result${
                          result.status ? ` status-${result.status}` : ''
                        }`}
                        type="button"
                        key={`file-${result.path}`}
                        title={result.path}
                        onClick={() => selectFile(result)}
                        onContextMenu={(event) => showContextMenu(event, result)}
                      >
                        <FileIcon dark={dark} node={result} />
                        <span>
                          <strong>{result.name}</strong>
                          <small>{result.path}</small>
                        </span>
                        {status && (
                          <span className="files-status" title={status.label}>
                            {status.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </section>
              )}
              {searchResults?.content.length > 0 && (
                <section aria-labelledby="files-search-content">
                  <h3 id="files-search-content">Content</h3>
                  {searchResults.content.map((result) => {
                    const status = statusLabels[result.status];
                    return (
                      <button
                        className={`files-search-result files-search-content-result${
                          result.status ? ` status-${result.status}` : ''
                        }`}
                        type="button"
                        key={`content-${result.path}-${result.line}`}
                        title={`${result.path}:${result.line}`}
                        onClick={() => selectFile({ ...result, type: 'file' }, result.line)}
                        onContextMenu={(event) => showContextMenu(event, {
                          ...result,
                          type: 'file',
                        })}
                      >
                        <FileIcon dark={dark} node={{ ...result, type: 'file' }} />
                        <span>
                          <strong>{result.path}:{result.line}</strong>
                          <small>{result.preview}</small>
                        </span>
                        {status && (
                          <span className="files-status" title={status.label}>
                            {status.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </section>
              )}
              {searchResults
                && searchResults.files.length === 0
                && searchResults.content.length === 0
                && !searching
                && (
                  <div className="files-panel-state">
                    <Search size={19} aria-hidden="true" />
                    <strong>No results</strong>
                    <span>Try another file name or text fragment.</span>
                  </div>
                )}
              {searchResults?.truncated && (
                <div className="files-search-limit">
                  More matches exist. Refine your search to narrow the results.
                </div>
              )}
            </div>
          )}
          {!hasSearch && error && <div className="files-panel-error" role="alert">{error}</div>}
        </div>
      </div>

      <div className="files-preview">
        {selectedPath ? (
          <>
            <header className="files-preview-header">
              <button
                className="files-preview-back"
                type="button"
                aria-label="Back to files"
                title="Back to files"
                onClick={() => {
                  setSelectedPath('');
                  setPreviewLine(null);
                  setPreviewLineTo(null);
                }}
              >
                <ArrowLeft size={14} />
              </button>
              <span className="files-preview-title" title={selectedPath}>
                <strong>{preview?.name ?? selectedPath.split(/[\\/]/).at(-1)}</strong>
                <small
                  className="files-preview-breadcrumb"
                  role="button"
                  tabIndex={0}
                  aria-label={`Directory options for ${selectedDirectory || workspace?.name}`}
                  title="Right-click for directory options"
                  onContextMenu={(event) => showContextMenu(event, {
                    name: selectedDirectory.split(/[\\/]/).at(-1) || workspace?.name,
                    path: selectedDirectory,
                    type: 'directory',
                  })}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ContextMenu'
                      || (event.shiftKey && event.key === 'F10')
                      || event.key === 'Enter'
                      || event.key === ' '
                    ) {
                      showContextMenu(event, {
                        name: selectedDirectory.split(/[\\/]/).at(-1) || workspace?.name,
                        path: selectedDirectory,
                        type: 'directory',
                      });
                    }
                  }}
                >
                  {selectedDirectory || workspace?.name}
                </small>
              </span>
            </header>
            <div className="files-preview-content">
              {loadingPath === selectedPath ? (
                <div className="files-panel-state">
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  <span>Opening preview…</span>
                </div>
              ) : preview?.kind === 'text' ? (
                <pre
                  className="files-code"
                  tabIndex={0}
                  aria-label={`Read-only preview of ${preview.name}`}
                  onMouseUp={updateSelectionAction}
                  onKeyUp={updateSelectionAction}
                  onScroll={() => setSelectionAction(null)}
                >
                  {preview.content.split('\n').map((line, index) => (
                    <span
                      className={`files-code-line${
                        previewLine !== null
                        && index + 1 >= previewLine
                        && index + 1 <= (previewLineTo ?? previewLine)
                          ? ' target-line'
                          : ''
                      }`}
                      data-files-line={index + 1}
                      key={`${index}-${line.slice(0, 12)}`}
                    >
                      <span aria-hidden="true">{index + 1}</span>
                      <code>{line || ' '}</code>
                    </span>
                  ))}
                </pre>
              ) : preview?.kind === 'image' ? (
                <div className="files-image-preview">
                  <img src={preview.dataUrl} alt={preview.name} />
                  <span>{formatBytes(preview.size)}</span>
                </div>
              ) : preview ? (
                <div className="files-panel-state">
                  <FolderSymlink size={20} aria-hidden="true" />
                  <strong>
                    {preview.kind === 'large' ? 'File is too large to preview' : 'Preview unavailable'}
                  </strong>
                  <span>{formatBytes(preview.size)} · Open it with the default application.</span>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="files-panel-state">
            <FolderSearch size={20} aria-hidden="true" />
            <strong>Select a file</strong>
            <span>Its read-only preview will open here.</span>
          </div>
        )}
      </div>

      {selectionAction && createPortal(
        <button
          className="files-selection-action"
          type="button"
          style={{ left: selectionAction.left, top: selectionAction.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const absolutePath = absoluteWorkspacePath(project.path, selectedPath);
            const escapedFilePath = escapeXmlAttribute(absolutePath);
            onAddToChat({
              id: crypto.randomUUID(),
              kind: 'context_marker',
              markerType: 'file_selection',
              name: `${preview.name}:${selectionAction.lineFrom}${
                selectionAction.lineTo === selectionAction.lineFrom
                  ? ''
                  : `-${selectionAction.lineTo}`
              }`,
              size: 0,
              filepath: absolutePath,
              lineFrom: selectionAction.lineFrom,
              lineTo: selectionAction.lineTo,
              charFrom: selectionAction.charFrom,
              charTo: selectionAction.charTo,
              text: `<file-selection filepath="${escapedFilePath}" line-from=${
                selectionAction.lineFrom
              } line-to=${selectionAction.lineTo} char-from=${
                selectionAction.charFrom
              } char-to=${selectionAction.charTo}>${
                selectionAction.content
              }</file-selection>`,
            });
            setSelectionAction(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          <MessageSquarePlus size={13} aria-hidden="true" />
          <span>Add to chat</span>
        </button>,
        document.body,
      )}

      {contextMenu && createPortal(
        <DropdownMenu
          className="files-context-menu"
          fixed
          role="menu"
          aria-label={`Actions for ${contextMenu.node.name}`}
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <DropdownMenuItem
            icon={<MessageSquarePlus size={14} />}
            role="menuitem"
            disabled={!onAddToChat}
            onClick={() => {
              const absolutePath = absoluteWorkspacePath(
                project.path,
                contextMenu.node.path,
              );
              const referenceType = contextMenu.node.type === 'directory'
                ? 'directory'
                : 'file';
              onAddToChat?.({
                id: crypto.randomUUID(),
                kind: 'context_marker',
                markerType: `${referenceType}_reference`,
                name: contextMenu.node.name,
                size: 0,
                filepath: absolutePath,
                text: `<${referenceType}-reference filepath="${
                  escapeXmlAttribute(absolutePath)
                }"></${referenceType}-reference>`,
              });
              setContextMenu(null);
            }}
          >
            Add to chat
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Copy size={14} />}
            role="menuitem"
            onClick={async () => {
              setContextMenu(null);
              await window.chatApp.files.copyPath({
                folderPath: project.path,
                filePath: contextMenu.node.path,
              }).catch((nextError) => (
                setError(nextError instanceof Error ? nextError.message : String(nextError))
              ));
            }}
          >
            Copy path
          </DropdownMenuItem>
          <div className="dropdown-menu-divider" role="separator" />
          {contextMenu.node.type === 'file' && (
            <DropdownMenuItem
              icon={<ExternalLink size={14} />}
              role="menuitem"
              onClick={async () => {
                setContextMenu(null);
                await window.chatApp.files.open({
                  folderPath: project.path,
                  filePath: contextMenu.node.path,
                }).catch((nextError) => (
                  setError(nextError instanceof Error ? nextError.message : String(nextError))
                ));
              }}
            >
              Open
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            icon={<FolderSearch size={14} />}
            role="menuitem"
            onClick={async () => {
              setContextMenu(null);
              const method = contextMenu.node.type === 'directory' ? 'open' : 'reveal';
              await window.chatApp.files[method]({
                folderPath: project.path,
                filePath: contextMenu.node.path,
              }).catch((nextError) => (
                setError(nextError instanceof Error ? nextError.message : String(nextError))
              ));
            }}
          >
            Open in Explorer
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
    </section>
  );
}
