import {
  Download,
  File,
  Folder,
  Grid2X2,
  Info,
  Link,
  List,
  Paperclip,
  Plus,
  ExternalLink,
  Copy,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '../lib/files.js';
import { classNames } from '../lib/format.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

export function WorkspaceView({ workspaceId, uploadQueue, onUploadQueueChange, onAttachToChat }) {
  const [path, setPath] = useState('/');
  const [listing, setListing] = useState({ path: '/', entries: [] });
  const [viewMode, setViewMode] = useState('list');
  const [loading, setLoading] = useState(false);
  const [uploadSelecting, setUploadSelecting] = useState(false);
  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [details, setDetails] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(null);
  const [shareLink, setShareLink] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const sortedEntries = useMemo(() => sortEntries(listing.entries), [listing.entries]);

  useEffect(() => {
    setPath('/');
    setSelectedPath(null);
  }, [workspaceId]);

  useEffect(() => {
    loadPath(path);
    setSelectedPath(null);
  }, [path, workspaceId]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event) => {
      if (event.target.closest?.('.dropdown-menu')) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close, { once: true });
    return () => window.removeEventListener('pointerdown', close);
  }, [contextMenu]);

  async function loadPath(nextPath = path) {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    try {
      setListing(await window.aivax.workspaceFiles.list({ path: nextPath }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function upload() {
    setError('');
    setUploadSelecting(true);
    try {
      onUploadQueueChange(await window.aivax.workspaceUploads.start({ path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadSelecting(false);
    }
  }

  async function cancelUpload(id) {
    onUploadQueueChange(await window.aivax.workspaceUploads.cancel(id));
  }

  async function createFolder(name) {
    setError('');
    try {
      await window.aivax.workspaceFiles.createDirectory({ parentPath: path, name });
      await loadPath(path);
      setFolderDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function showPreview(entry) {
    setContextMenu(null);
    if (entry.isDirectory) {
      setPath(entry.path);
      return;
    }
    setError('');
    setPreview(null);
    setPreviewLoading({ name: entry.name });
    try {
      setPreview(await window.aivax.workspaceFiles.preview({ path: entry.path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(null);
    }
  }

  async function showDetails(entry) {
    setContextMenu(null);
    if (entry.isDirectory) {
      setDetails(entry);
      return;
    }
    setError('');
    try {
      setDetails(await window.aivax.workspaceFiles.details({ path: entry.path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function download(entry) {
    setContextMenu(null);
    if (entry.isDirectory) return;
    setError('');
    try {
      await window.aivax.workspaceFiles.download({ path: entry.path });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function share(entry) {
    setContextMenu(null);
    if (entry.isDirectory) return;
    setError('');
    try {
      const result = await window.aivax.workspaceFiles.share({ path: entry.path });
      if (result.publicUrl) {
        await navigator.clipboard.writeText(result.publicUrl);
        setShareLink({
          ...result,
          path: entry.path,
          copied: true,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(entry) {
    setContextMenu(null);
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    setError('');
    try {
      await window.aivax.workspaceFiles.delete({ path: entry.path, isDirectory: entry.isDirectory });
      await loadPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function attach(entry) {
    setContextMenu(null);
    onAttachToChat([workspaceAttachment(entry, workspaceId)]);
  }

  function openContextMenu(event, entry) {
    event.preventDefault();
    setSelectedPath(entry.path);
    const menuSize = { width: 180, height: entry.isDirectory ? 128 : 248 };
    const margin = 8;
    setContextMenu({
      entry,
      top: clamp(event.clientY, margin, window.innerHeight - menuSize.height - margin),
      left: clamp(event.clientX, margin, window.innerWidth - menuSize.width - margin),
    });
  }

  const uploadAsideVisible = (uploadQueue?.items ?? []).length > 0;

  return (
    <main className="workspace-area">
      <div className="workspace-toolbar">
        <div>
          <h1>Workspace</h1>
          <p>{workspaceId}</p>
        </div>
        <div className="workspace-actions">
          <button type="button" onClick={() => setFolderDialogOpen(true)}>
            <Plus size={15} />
            Folder
          </button>
          <button type="button" onClick={upload} disabled={uploadSelecting}>
            {uploadSelecting ? <LoaderCircle className="spin-icon" size={15} /> : <Upload size={15} />}
            {uploadSelecting ? 'Selecting' : 'Upload'}
          </button>
          <button type="button" onClick={() => loadPath(path)} disabled={loading}>
            <RefreshCw className={classNames(loading && 'spin-icon')} size={15} />
            {loading ? 'Loading' : 'Refresh'}
          </button>
          <button className={classNames(viewMode === 'list' && 'active')} type="button" onClick={() => setViewMode('list')} aria-label="List view">
            <List size={15} />
          </button>
          <button className={classNames(viewMode === 'grid' && 'active')} type="button" onClick={() => setViewMode('grid')} aria-label="Grid view">
            <Grid2X2 size={15} />
          </button>
        </div>
      </div>
      <div className="workspace-path">
        {pathSegments(path).map((segment, index) => (
          <span key={segment.path} className="workspace-path-segment">
            {index > 0 && <span className="workspace-path-separator">{'>'}</span>}
            <button type="button" onClick={() => setPath(segment.path)}>
              {segment.label}
            </button>
          </span>
        ))}
      </div>
      {error && <div className="workspace-error">{error}</div>}
      <div className={classNames('workspace-content', uploadAsideVisible && 'uploads-visible')}>
        <div className={classNames('workspace-files', viewMode === 'grid' && 'grid-view', loading && 'loading')}>
          {loading && (
            <div className="workspace-loading">
              <LoaderCircle className="spin-icon" size={15} />
              Loading files
            </div>
          )}
          {path !== '/' && (
            <WorkspaceEntry
              entry={{ name: '..', path: parentPath(path), isDirectory: true }}
              viewMode={viewMode}
              selected={selectedPath === parentPath(path)}
              onSelect={() => setSelectedPath(parentPath(path))}
              onOpen={() => setPath(parentPath(path))}
            />
          )}
          {sortedEntries.map((entry) => (
            <WorkspaceEntry
              key={entry.path}
              entry={entry}
              viewMode={viewMode}
              selected={selectedPath === entry.path}
              onSelect={() => setSelectedPath(entry.path)}
              onOpen={() => (entry.isDirectory ? setPath(entry.path) : showPreview(entry))}
              onContextMenu={(event) => openContextMenu(event, entry)}
            />
          ))}
          {!loading && sortedEntries.length === 0 && path === '/' && (
            <div className="empty-list">This workspace has no files yet.</div>
          )}
        </div>
        <UploadAside
          visible={uploadAsideVisible}
          queue={uploadQueue}
          onCancel={cancelUpload}
          onRefresh={() => loadPath(path)}
        />
      </div>
      {contextMenu && (
        <DropdownMenu className="workspace-context-menu" fixed style={{ top: contextMenu.top, left: contextMenu.left }}>
          <DropdownMenuItem icon={<File size={14} />} onClick={() => showPreview(contextMenu.entry)}>
            Preview
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Info size={14} />} onClick={() => showDetails(contextMenu.entry)}>
            Details
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Paperclip size={14} />} onClick={() => attach(contextMenu.entry)}>
            Attach in chat
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Link size={14} />} disabled={contextMenu.entry.isDirectory} onClick={() => share(contextMenu.entry)}>
            Share link
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Download size={14} />} disabled={contextMenu.entry.isDirectory} onClick={() => download(contextMenu.entry)}>
            Download
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Trash2 size={14} />} onClick={() => remove(contextMenu.entry)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenu>
      )}
      {details && <DetailsDialog details={details} onClose={() => setDetails(null)} />}
      {previewLoading && <PreviewDialog preview={previewLoading} loading onClose={() => setPreviewLoading(null)} />}
      {preview && <PreviewDialog preview={preview} onClose={() => setPreview(null)} />}
      {shareLink && <ShareLinkDialog share={shareLink} onClose={() => setShareLink(null)} />}
      {folderDialogOpen && (
        <FolderDialog
          onClose={() => setFolderDialogOpen(false)}
          onCreate={createFolder}
        />
      )}
    </main>
  );
}

function UploadAside({ visible, queue, onCancel, onRefresh }) {
  const items = queue?.items ?? [];
  const recentItems = items.slice(-8).reverse();

  return (
    <aside className={classNames('upload-aside', visible && 'visible')} aria-hidden={!visible}>
      <div className="upload-aside-header">
        <div>
          <h2>Uploads</h2>
          <p>{uploadSummary(items)}</p>
        </div>
      </div>
      <div className="upload-list">
        {recentItems.length === 0 ? (
          <div className="upload-empty">No uploads yet.</div>
        ) : (
          recentItems.map((item) => (
            <div key={item.id} className={classNames('upload-item', `status-${item.status}`)}>
              <div>
                <strong title={item.name}>{item.name}</strong>
                <span>{formatBytes(item.size)} · {uploadStatusLabel(item.status)}</span>
                {item.error && <small>{item.error}</small>}
              </div>
              {['queued', 'uploading'].includes(item.status) && (
                <button type="button" aria-label={`Cancel ${item.name}`} onClick={() => onCancel(item.id)}>
                  <X size={13} />
                </button>
              )}
              {item.status === 'uploading' ? (
                <LoaderCircle className="upload-spinner spin-icon" size={13} />
              ) : (
                <span className="upload-status-dot" />
              )}
            </div>
          ))
        )}
      </div>
      <button className="upload-refresh" type="button" onClick={onRefresh}>
        <RefreshCw size={14} />
        Refresh files
      </button>
    </aside>
  );
}

function WorkspaceEntry({ entry, viewMode, selected, onSelect, onOpen, onContextMenu }) {
  const Icon = entry.isDirectory ? Folder : File;
  if (viewMode === 'grid') {
    return (
      <button
        className={classNames('workspace-grid-item', selected && 'selected')}
        type="button"
        onClick={onSelect}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
      >
        <Icon size={22} />
        <span>{entry.name}</span>
        {!entry.isDirectory && <small>{formatBytes(entry.size)}</small>}
      </button>
    );
  }
  return (
    <div className={classNames('workspace-row', selected && 'selected')} onContextMenu={onContextMenu}>
      <button type="button" onClick={onSelect} onDoubleClick={onOpen}>
        <Icon size={16} />
        <span>{entry.name}</span>
      </button>
      <span>{entry.isDirectory ? 'Folder' : formatBytes(entry.size)}</span>
      <span>{formatDate(entry.lastModifiedUtc)}</span>
    </div>
  );
}

function DetailsDialog({ details, onClose }) {
  const isDirectory = Boolean(details.isDirectory);
  const mimeType = details.mimeType || (isDirectory ? 'Folder' : 'Unknown type');
  const createdAt = formatDateTime(details.createdAtUtc);
  const modifiedAt = formatDateTime(details.lastModifiedUtc);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="small-dialog details-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Details</h2>
            <p>{details.name}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="details-card">
          <div className="details-file">
            {isDirectory ? <Folder size={20} /> : <File size={20} />}
            <div>
              <strong>{details.name}</strong>
              <span>{isDirectory ? 'Folder' : mimeType}</span>
            </div>
          </div>
          <div className="details-list">
            <DetailItem label="Size" value={isDirectory ? 'Folder' : formatBytes(details.size)} />
            <DetailItem label="Created" value={createdAt} />
            <DetailItem label="Modified" value={modifiedAt} />
            <DetailItem label="MIME type" value={mimeType} />
          </div>
        </div>
      </section>
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );
}

function PreviewDialog({ preview, loading = false, onClose }) {
  const isImage = preview.mime?.startsWith('image/');
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="preview-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Preview</h2>
            <p>{preview.name}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        {loading ? (
          <div className="preview-loading">
            <LoaderCircle className="spin-icon" size={22} />
            <span>Loading preview</span>
          </div>
        ) : preview.isPlainText ? (
          <pre className="preview-text">{preview.text}</pre>
        ) : isImage ? (
          <img className="preview-image" src={preview.dataUrl} alt="" />
        ) : (
          <div className="empty-list">Preview is not available for this file type.</div>
        )}
      </section>
    </div>
  );
}

function ShareLinkDialog({ share, onClose }) {
  const [copied, setCopied] = useState(Boolean(share.copied));

  async function copyLink() {
    await navigator.clipboard.writeText(share.publicUrl);
    setCopied(true);
  }

  async function openLink() {
    await window.aivax.workspaceFiles.openShare(share.publicUrl);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="small-dialog share-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Share link</h2>
            <p>{share.name}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="share-card">
          <div className="share-file">
            <File size={18} />
            <div>
              <strong>{share.name}</strong>
              <span>{formatBytes(share.size)}</span>
            </div>
          </div>
          <label className="share-link-field">
            <span>Public URL</span>
            <input value={share.publicUrl} readOnly onFocus={(event) => event.target.select()} />
          </label>
          <div className="share-actions">
            <button type="button" onClick={copyLink}>
              <Copy size={14} />
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button className="primary-mini" type="button" onClick={openLink}>
              <ExternalLink size={14} />
              Open
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FolderDialog({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setError('Folder name is required.');
      return;
    }
    setError('');
    await onCreate(nextName);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form className="small-dialog folder-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>New folder</h2>
            <p>Create a folder in the current workspace path.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="folder-form">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Folder name"
          />
          {error && <div className="inline-error">{error}</div>}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}

export function workspaceAttachment(entry, workspaceId) {
  return {
    id: crypto.randomUUID(),
    kind: 'workspace_ref',
    workspaceId,
    path: entry.path,
    name: entry.name,
    isDirectory: Boolean(entry.isDirectory),
    size: entry.size ?? 0,
  };
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

function uploadSummary(items) {
  const uploading = items.filter((item) => item.status === 'uploading').length;
  const queued = items.filter((item) => item.status === 'queued').length;
  if (uploading || queued) {
    return `${uploading} uploading, ${queued} queued`;
  }
  const completed = items.filter((item) => item.status === 'completed').length;
  const failed = items.filter((item) => item.status === 'error').length;
  if (completed || failed) {
    return `${completed} completed, ${failed} failed`;
  }
  return 'Idle';
}

function uploadStatusLabel(status) {
  if (status === 'queued') return 'Queued';
  if (status === 'uploading') return 'Uploading';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'error') return 'Failed';
  return status;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function pathSegments(path) {
  const parts = path.split('/').filter(Boolean);
  const segments = [{ label: 'Root', path: '/' }];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

function parentPath(path) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}
