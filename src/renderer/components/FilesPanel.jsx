import {
  useEffect,
  useMemo,
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
  FileDiff,
  FolderSearch,
  FolderSymlink,
  GitBranch,
  LoaderCircle,
  MessageSquarePlus,
  MessagesSquare,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';
import 'prismjs/plugins/diff-highlight/prism-diff-highlight';
import 'prismjs/plugins/diff-highlight/prism-diff-highlight.css';
import iconTheme from '../../../assets/fileicons/studio-icons.json';
import { formatBytes } from '../lib/files.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const iconAssets = import.meta.glob('../../../assets/fileicons/images/*.svg', {
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
const gitVisibleStatuses = new Set(['conflict', 'modified', 'untracked']);
const diffVisibleStatuses = new Set(['conflict', 'modified']);
const previewLanguages = {
  '.bashrc': 'bash',
  '.env': 'bash',
  '.gitignore': 'text',
  css: 'css',
  cs: 'csharp',
  html: 'markup',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  md: 'markdown',
  mjs: 'javascript',
  ps1: 'powershell',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
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

function selectionOffset(code, container, offset) {
  const range = document.createRange();
  range.selectNodeContents(code);
  range.setEnd(container, offset);
  return range.toString().length;
}

function FileEditPane({ title, lines, start, end, emptyLabel }) {
  return (
    <section className="files-edit-pane">
      <header>{title}</header>
      <pre>{lines.length === 0 ? (
        <span className="files-edit-empty">{emptyLabel}</span>
      ) : lines.map((line, index) => {
        const lineNumber = index + 1;
        return (
          <span
            className={`files-edit-line${
              lineNumber >= start && lineNumber <= end ? ' is-changed' : ''
            }`}
            key={lineNumber}
          >
            <span>{lineNumber}</span><code>{line || ' '}</code>
          </span>
        );
      })}</pre>
    </section>
  );
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
  onAskInSideChat,
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
  const [gitOnly, setGitOnly] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-color-scheme') === 'dark',
  );
  const contextTargetRef = useRef(null);
  const panelRef = useRef(null);
  const { highlightedLines, highlightedDiff, previewLanguage } = useMemo(() => {
    if (!['diff', 'text'].includes(preview?.kind)) {
      return { highlightedLines: [], highlightedDiff: '', previewLanguage: 'text' };
    }
    const lowerName = preview.name.toLowerCase();
    const extension = lowerName.includes('.') ? lowerName.split('.').at(-1) : lowerName;
    const language = previewLanguages[lowerName] ?? previewLanguages[extension] ?? 'text';
    if (preview.kind === 'diff') {
      const diffLanguage = language === 'text' ? 'diff' : `diff-${language}`;
      return {
        highlightedLines: [],
        highlightedDiff: Prism.highlight(preview.content, Prism.languages.diff, diffLanguage),
        previewLanguage: diffLanguage,
      };
    }
    const grammar = Prism.languages[language];
    return {
      highlightedLines: preview.content.split('\n').map((line) => (
        grammar && line ? Prism.highlight(line, grammar, language) : ''
      )),
      highlightedDiff: '',
      previewLanguage: language,
    };
  }, [preview]);

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
    setGitOnly(false);
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
    if (navigation.kind === 'edit' && navigation.edit) {
      setSelectedPath(navigation.path);
      setPreview({
        kind: 'edit',
        name: navigation.path.split(/[\\/]/).at(-1),
        edit: navigation.edit,
      });
      setPreviewLine(null);
      setPreviewLineTo(null);
      setSelectionAction(null);
      setSearchQuery('');
      setSearchResults(null);
      setError('');
      setLoadingPath('');
      onNavigationConsumed?.(navigation.id);
      return undefined;
    }
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
      if (event.target.closest?.('.selection-action-group')) return;
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
    const height = node.type === 'file'
      ? diffVisibleStatuses.has(node.status) ? 178 : 144
      : 110;
    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = event.clientX || rect.left + 8;
    const clientY = event.clientY || rect.bottom;
    setContextMenu({
      node,
      left: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
    });
  };

  const viewDiff = async (node) => {
    setContextMenu(null);
    setSelectedPath(node.path);
    setPreview(null);
    setPreviewLine(null);
    setPreviewLineTo(null);
    setSelectionAction(null);
    setError('');
    setLoadingPath(node.path);
    try {
      setPreview(await window.chatApp.files.diff({
        folderPath: project.path,
        filePath: node.path,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoadingPath('');
    }
  };

  const updateSelectionAction = () => {
    const selection = window.getSelection();
    if (
      (!onAddToChat && !onAskInSideChat)
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
    const diffCode = preview.kind === 'diff'
      && startCode === endCode
      && startCode?.closest('.files-diff');
    let content;
    let lineFrom;
    let lineTo;
    let charFrom;
    let charTo;
    if (diffCode && panelRef.current?.contains(diffCode)) {
      const startOffset = selectionOffset(startCode, range.startContainer, range.startOffset);
      const endOffset = selectionOffset(endCode, range.endContainer, range.endOffset);
      const beforeSelection = preview.content.slice(0, startOffset);
      const throughSelection = preview.content.slice(0, endOffset);
      content = preview.content.slice(startOffset, endOffset);
      lineFrom = beforeSelection.split('\n').length;
      lineTo = throughSelection.split('\n').length;
      charFrom = startOffset - beforeSelection.lastIndexOf('\n');
      charTo = endOffset - throughSelection.lastIndexOf('\n') - 1;
    } else if (
      startLineElement
      && endLineElement
      && panelRef.current?.contains(startLineElement)
      && panelRef.current?.contains(endLineElement)
    ) {
      const lines = preview.content.split('\n');
      lineFrom = Number(startLineElement.dataset.filesLine);
      lineTo = Number(endLineElement.dataset.filesLine);
      const startOffset = Math.min(
        selectionOffset(startCode, range.startContainer, range.startOffset),
        lines[lineFrom - 1].length,
      );
      const endOffset = Math.min(
        selectionOffset(endCode, range.endContainer, range.endOffset),
        lines[lineTo - 1].length,
      );
      content = lineFrom === lineTo
        ? lines[lineFrom - 1].slice(startOffset, endOffset)
        : [
            lines[lineFrom - 1].slice(startOffset),
            ...lines.slice(lineFrom, lineTo - 1),
            lines[lineTo - 1].slice(0, endOffset),
          ].join('\n');
      charFrom = startOffset + 1;
      charTo = endOffset;
    }
    if (!content) {
      setSelectionAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const width = 276;
    const height = 34;
    const above = rect.top - height - 8;
    setSelectionAction({
      content,
      lineFrom,
      lineTo,
      charFrom,
      charTo,
      left: Math.max(8, Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - 8,
      )),
      top: above >= 8 ? above : Math.min(window.innerHeight - height - 8, rect.bottom + 8),
    });
  };

  const renderNodes = (nodes, depth = 0) => nodes
    .filter((node) => !gitOnly || gitVisibleStatuses.has(node.status))
    .map((node) => {
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
  const visibleSearchFiles = searchResults?.files.filter((result) => (
    !gitOnly || gitVisibleStatuses.has(result.status)
  )) ?? [];
  const visibleSearchContent = searchResults?.content.filter((result) => (
    !gitOnly || gitVisibleStatuses.has(result.status)
  )) ?? [];

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
            className={gitOnly ? 'active' : undefined}
            type="button"
            aria-label="Show only Git changes"
            aria-pressed={gitOnly}
            title="Show only Git changes"
            disabled={!workspace}
            onClick={async () => {
              if (gitOnly) {
                setGitOnly(false);
                return;
              }

              setGitOnly(true);
              const nextDirectories = { ...directories };
              const nextExpanded = new Set(expanded);
              let changedDirectories = (nextDirectories[''] ?? workspace.children)
                .filter((node) => (
                  node.type === 'directory' && gitVisibleStatuses.has(node.status)
                ));

              try {
                while (changedDirectories.length > 0) {
                  changedDirectories.forEach((node) => nextExpanded.add(node.path));
                  const unloadedDirectories = changedDirectories.filter((node) => (
                    !nextDirectories[node.path]
                  ));
                  const loadedChildren = await Promise.all(unloadedDirectories.map((node) => (
                    window.chatApp.files.directory({
                      folderPath: project.path,
                      directoryPath: node.path,
                    })
                  )));
                  unloadedDirectories.forEach((node, index) => {
                    nextDirectories[node.path] = loadedChildren[index];
                  });
                  changedDirectories = changedDirectories.flatMap((node) => (
                    nextDirectories[node.path]?.filter((child) => (
                      child.type === 'directory' && gitVisibleStatuses.has(child.status)
                    )) ?? []
                  ));
                }
                setDirectories(nextDirectories);
                setExpanded(nextExpanded);
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
              }
            }}
          >
            <GitBranch size={14} />
          </button>
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
              <span>Scanning files and Git repositories...</span>
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
              {gitOnly && !(directories[''] ?? []).some((node) => gitVisibleStatuses.has(node.status)) && (
                <span className="files-tree-message">No Git changes</span>
              )}
            </div>
          )}
          {hasSearch && (
            <div className="files-search-results">
              {searching && !searchResults && (
                <div className="files-loading">
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                  <span>Searching files and content...</span>
                </div>
              )}
              {searchError && (
                <div className="files-panel-error" role="alert">{searchError}</div>
              )}
              {visibleSearchFiles.length > 0 && (
                <section aria-labelledby="files-search-filenames">
                  <h3 id="files-search-filenames">Files</h3>
                  {visibleSearchFiles.map((result) => {
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
              {visibleSearchContent.length > 0 && (
                <section aria-labelledby="files-search-content">
                  <h3 id="files-search-content">Content</h3>
                  {visibleSearchContent.map((result) => {
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
                && visibleSearchFiles.length === 0
                && visibleSearchContent.length === 0
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
                  setPreview(null);
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
                  <span>Opening preview...</span>
                </div>
              ) : preview?.kind === 'edit' ? (
                <div className="files-edit-columns" aria-label={`Changes to ${selectedPath}`}>
                  <FileEditPane
                    title="Before"
                    lines={preview.edit.beforeLines}
                    start={preview.edit.beforeStartLine}
                    end={preview.edit.beforeEndLine}
                    emptyLabel="File did not exist"
                  />
                  <FileEditPane
                    title="After"
                    lines={preview.edit.afterLines}
                    start={preview.edit.afterStartLine}
                    end={preview.edit.afterEndLine}
                    emptyLabel="Empty file"
                  />
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
                      {highlightedLines[index] ? (
                        <code dangerouslySetInnerHTML={{ __html: highlightedLines[index] }} />
                      ) : (
                        <code>{line || ' '}</code>
                      )}
                    </span>
                  ))}
                </pre>
              ) : preview?.kind === 'diff' ? (
                <pre
                  className={`files-code files-diff diff-highlight language-${previewLanguage}`}
                  tabIndex={0}
                  aria-label={`Git diff for ${preview.name}`}
                  onMouseUp={updateSelectionAction}
                  onKeyUp={updateSelectionAction}
                  onScroll={() => setSelectionAction(null)}
                >
                  {preview.content ? (
                    <code
                      className={`diff-highlight language-${previewLanguage}`}
                      dangerouslySetInnerHTML={{ __html: highlightedDiff }}
                    />
                  ) : <span className="files-edit-empty">No diff available</span>}
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
        <div
          className="selection-action-group"
          role="toolbar"
          aria-label="Selected code actions"
          style={{ left: selectionAction.left, top: selectionAction.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {[
            [onAddToChat, MessageSquarePlus, 'Mention on Chat'],
            [onAskInSideChat, MessagesSquare, 'Ask in Side Chat'],
          ].filter(([callback]) => callback).map(([callback, Icon, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                const lineRange = selectionAction.lineTo === selectionAction.lineFrom
                  ? `L${selectionAction.lineFrom}`
                  : `L${selectionAction.lineFrom}-${selectionAction.lineTo}`;
                const citationPath = `${selectedPath.replaceAll('\\', '/')}:${lineRange}`;
                const escapedContent = selectionAction.content
                  .replaceAll('&', '&amp;')
                  .replaceAll('<', '&lt;')
                  .replaceAll('>', '&gt;');
                callback({
                  id: crypto.randomUUID(),
                  kind: 'context_marker',
                  markerType: 'file_citation',
                  name: `${preview.name}:${lineRange}`,
                  size: 0,
                  filepath: absoluteWorkspacePath(project.path, selectedPath),
                  lineFrom: selectionAction.lineFrom,
                  lineTo: selectionAction.lineTo,
                  charFrom: selectionAction.charFrom,
                  charTo: selectionAction.charTo,
                  text: `<file-citation path="${escapeXmlAttribute(citationPath)}">${
                    escapedContent
                  }</file-citation>`,
                });
                setSelectionAction(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <Icon size={13} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>,
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
          {contextMenu.node.type === 'file' && diffVisibleStatuses.has(contextMenu.node.status) && (
            <DropdownMenuItem
              icon={<FileDiff size={14} />}
              role="menuitem"
              onClick={() => viewDiff(contextMenu.node)}
            >
              View diff
            </DropdownMenuItem>
          )}
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
