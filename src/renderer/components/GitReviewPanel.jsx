import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Copy, FileDiff, FileX,
  Folder, FolderOpen, GitBranch, GitCommitHorizontal, GitPullRequest, LoaderCircle,
  MessageCircleQuestionMark, MessageSquarePlus, Minus, MoreHorizontal, Plus, RefreshCw, Rocket,
  RotateCcw, Sparkles, SquareArrowOutUpRight, X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { GitReviewDiff, gitReviewAttachment } from './GitReviewDiff.jsx';
import { buildGitTree, flattenGitTree } from '../lib/git-review.js';
import { Overlay, Presence } from './Overlay.jsx';

const badges = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', untracked: 'U', conflict: 'C' };

const GitTree = memo(function GitTree({ files, selected, staged, onSelect, onMenu, onAction, busy }) {
  const [collapsed, setCollapsed] = useState(new Map());
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const ref = useRef(null);
  const pendingFocus = useRef(null);
  const trees = useMemo(() => [
    { ...buildGitTree(files.filter((file) => file.unstaged || file.status === 'untracked')), name: 'Unstaged', group: 'unstaged' },
    { ...buildGitTree(files.filter((file) => file.staged)), name: 'Staged changes', group: 'staged' },
  ], [files]);
  const rows = useMemo(() => trees.flatMap((tree) => {
    const groupCollapsed = new Map([...collapsed].filter(([key]) => key.startsWith(`${tree.group}:`)).map(([key, value]) => [key.slice(tree.group.length + 1), value]));
    return flattenGitTree(tree, groupCollapsed).map(({ node, depth }) => ({
      node: { ...node, group: tree.group, key: `${tree.group}:${node.path}` }, depth,
    }));
  }), [trees, collapsed]);
  const start = Math.max(0, Math.floor(viewport.top / 28) - 12);
  const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / 28) + 12);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setViewport((value) => ({ ...value, height: entry.contentRect.height })));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = ref.current?.querySelector(`[data-git-key="${CSS.escape(pendingFocus.current)}"]`);
    if (target) { target.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [viewport, rows]);
  const toggle = (node) => setCollapsed((current) => new Map(current).set(node.key, !(current.get(node.key) ?? (node.path !== '.' && node.count > 100))));
  return <div className="git-review-tree" ref={ref} role="tree" aria-label="Changed files" onScroll={(event) => {
    const top = event.currentTarget.scrollTop;
    setViewport((value) => ({ ...value, top }));
  }}><div style={{ height: rows.length * 28, position: 'relative' }}>
    {rows.slice(start, end).map(({ node, depth }, position) => {
      const isCollapsed = collapsed.get(node.key) ?? (node.path !== '.' && node.count > 100);
      return <div key={node.key} className={`git-review-tree-row${selected === node.path && staged === (node.group === 'staged') ? ' selected' : ''}`} style={{ top: (start + position) * 28, paddingLeft: 7 + depth * 12 }}
        role="treeitem" aria-level={depth + 1} aria-selected={selected === node.path && staged === (node.group === 'staged')} aria-expanded={node.directory ? !isCollapsed : undefined}
        tabIndex={0} data-git-path={node.path} data-git-key={node.key} data-git-group={node.group}
        onClick={() => node.directory ? toggle(node) : onSelect(node.path, node.group === 'staged')}
        onContextMenu={(event) => onMenu(event, node)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.directory ? toggle(node) : onSelect(node.path, node.group === 'staged'); }
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onMenu(event, node);
          if (event.key === 'ArrowRight' && node.directory && isCollapsed) { event.preventDefault(); toggle(node); }
          if (event.key === 'ArrowLeft' && node.directory && !isCollapsed) { event.preventDefault(); toggle(node); }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, start + position + (event.key === 'ArrowDown' ? 1 : -1)));
            const nextPath = rows[nextIndex].node.key;
            ref.current.scrollTop = Math.max(0, nextIndex * 28 - viewport.height / 2);
            pendingFocus.current = nextPath;
            setViewport((value) => ({ ...value, top: ref.current.scrollTop }));
          }
        }}>
        {node.directory ? <>{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<Folder size={14} /></> : <FileDiff size={14} />}
        <span className="git-review-tree-name" title={node.path}>{node.name}</span>
        {!node.directory && <span className={`git-review-file-status status-${node.status}`} title={node.status}>{badges[node.status]}</span>}
        {!node.directory && node.staged && <span className="git-review-staged" title="Has staged changes">●</span>}
        <button type="button" className="git-review-tree-action" aria-label={`${node.group === 'staged' ? 'Unstage' : 'Stage'} ${node.path}`} disabled={busy} onClick={(event) => {
          event.stopPropagation(); onAction(node.group === 'staged' ? 'unstage' : 'stage', node);
        }}>{node.group === 'staged' ? <Minus size={13} /> : <Plus size={13} />}</button>
        <button type="button" className="git-review-tree-action" aria-label={`Actions for ${node.path}`} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); onMenu(event, node); }}><MoreHorizontal size={13} /></button>
      </div>;
    })}
  </div></div>;
});

function GitReviewDialog({ dialog, busy, onClose, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.isConnected && previous.focus();
  }, []);
  return createPortal(<Overlay as="dialog" ref={ref} className="git-review-dialog" aria-labelledby="git-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="dialog-header"><h2 id="git-dialog-title">Discard changes?</h2><button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={16} /></button></header>
    <div className="git-review-dialog-body">
      <p>This permanently discards staged and unstaged changes in <strong>{dialog.path}</strong> in <strong>{dialog.repositoryName}</strong>, including untracked files.</p><p>This cannot be undone. Nested repositories are not discarded.</p>
      {dialog.error && <p role="alert">{dialog.error}</p>}
    </div>
    <footer className="dialog-footer"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="danger" disabled={busy} onClick={onConfirm}>{busy ? <><LoaderCircle className="spin" size={14} aria-hidden="true" />Discarding changes...</> : 'Discard permanently'}</button></footer>
  </Overlay>, document.body);
}

export const GitReviewPanel = memo(function GitReviewPanel({ conversationId, model, project, onAddToChat, onAskInSideChat, onQuickQuestion, onRunAgent }) {
  const [catalog, setCatalog] = useState(null);
  const [repositoryPath, setRepositoryPath] = useState('');
  const [index, setIndex] = useState(null);
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState(null);
  const [staged, setStaged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [revision, setRevision] = useState(0);
  const menuRef = useRef(null);
  const scope = useRef(0);
  const operation = useRef(false);
  const indexCache = useRef(new Map());
  const selectedByRepository = useRef(new Map());
  const target = useMemo(() => conversationId ? { conversationId } : { projectPath: project?.path }, [conversationId, project?.path]);

  useEffect(() => {
    let active = true;
    scope.current += 1;
    indexCache.current.clear(); selectedByRepository.current.clear();
    setCatalog(null); setIndex(null); setFile(null); setRepositoryPath(''); setSelected(''); setError(''); setMenu(null); setDialog(null);
    if (!target.conversationId && !target.projectPath) return undefined;
    setLoading(true);
    window.chatApp.gitReview.repositories(target).then((result) => {
      if (!active) return;
      setCatalog(result); setRepositoryPath(result.repositories[0]?.path ?? '');
    }).catch((failure) => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; scope.current += 1; };
  }, [target]);

  useEffect(() => {
    if (!repositoryPath) return undefined;
    let active = true;
    const cached = indexCache.current.get(repositoryPath);
    setIndex(cached ?? null); setFile(null); setMenu(null); setDialog(null);
    setLoading(true); setError('');
    window.chatApp.gitReview.index({ ...target, repositoryPath, refresh: revision > 0 }).then((result) => {
      if (!active) return;
      indexCache.current.set(repositoryPath, result);
      setIndex(result);
      const previous = selectedByRepository.current.get(repositoryPath);
      const nextFile = result.files.find((item) => item.path === previous)
        ?? result.files.find((item) => item.unstaged || item.status === 'untracked')
        ?? result.files[0];
      setSelected(nextFile?.path ?? '');
      setStaged((current) => nextFile?.staged && (current || (!nextFile.unstaged && nextFile.status !== 'untracked')) ? true : false);
    }).catch((failure) => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target, repositoryPath, revision]);

  useEffect(() => {
    if (!index || index.path !== repositoryPath || !selected) { setFile(null); return undefined; }
    let active = true;
    setFileLoading(true); setFile(null);
    window.chatApp.gitReview.file({ ...target, repositoryPath, filePath: selected, staged, unstaged: !staged }).then((result) => {
      if (active) setFile(result);
    }).catch((failure) => { if (active) setError(failure.message); }).finally(() => { if (active) setFileLoading(false); });
    return () => { active = false; };
  }, [target, repositoryPath, selected, staged, index, revision]);

  useEffect(() => {
    if (!menu) return undefined;
    menuRef.current?.querySelector('button:not(:disabled)')?.focus();
    const close = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [menu]);

  const onSelect = useCallback((path, stagedSelection) => {
    selectedByRepository.current.set(repositoryPath, path); setSelected(path); setStaged(stagedSelection);
  }, [repositoryPath]);
  const onMenu = useCallback((event, node) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ node, opener: event.currentTarget, left: Math.max(8, Math.min(window.innerWidth - 245, event.clientX || rect.left)), top: Math.max(8, Math.min(window.innerHeight - 420, event.clientY || rect.bottom)) });
  }, []);
  const perform = useCallback(async (action, node = { path: '.' }, extra = {}) => {
    if (operation.current || loading || !index || index.path !== repositoryPath) return;
    if (action === 'discard' && !extra.confirmed) {
      setDialog({ type: 'discard', path: node.path, repositoryName: index.name, version: index.version }); return;
    }
    operation.current = true;
    setBusy({ stage: 'Staging changes...', unstage: 'Unstaging changes...', discard: 'Discarding changes...', ignore: 'Adding ignore rule...', commit: 'Creating commit...' }[action]);
    setError(''); setNotice('');
    const currentScope = scope.current;
    try {
      const result = await window.chatApp.gitReview.mutate({ ...target, repositoryPath, action, path: node.path, version: index.version, ...extra });
      if (currentScope !== scope.current) return;
      if (action === 'commit') setMessage('');
      setNotice(result.trackedFilesRemainTracked ? 'Ignore rule added. Already tracked files remain tracked.' : `${action === 'commit' ? 'Commit created' : 'Git changes updated'}.`);
      if (extra.push) {
        setBusy('Pushing commits...');
        const pushed = await window.chatApp.gitReview.push({ ...target, repositoryPath });
        if (currentScope !== scope.current) return;
        setNotice(pushed.pushed ? 'Commit created and pushed.' : `Commit created, but push failed: ${pushed.message}`);
      }
      setDialog(null); setRevision((value) => value + 1);
    } catch (failure) {
      if (currentScope === scope.current) {
        setError(failure.message);
        setDialog((value) => value ? { ...value, error: failure.message } : null);
      }
    } finally { operation.current = false; setBusy(false); }
  }, [target, repositoryPath, index, loading]);

  async function generatePlan() {
    if (operation.current) return;
    operation.current = true; setBusy('Generating commit message...'); setError('');
    const currentScope = scope.current;
    try {
      const plan = await window.chatApp.gitReview.plan({ ...target, repositoryPath, model, messageOnly: true });
      if (currentScope === scope.current) setMessage(plan.commits[0].message);
    } catch (failure) { if (currentScope === scope.current) setError(failure.message); }
    finally { operation.current = false; setBusy(false); }
  }

  async function fileAction(action, node) {
    setMenu(null);
    try {
      await window.chatApp.files[action]({ folderPath: catalog.root, filePath: repositoryPath === '.' ? node.path : `${repositoryPath}/${node.path === '.' ? '' : node.path}` });
    } catch (failure) { setError(failure.message); }
  }

  if (!target.conversationId && !target.projectPath) return <div className="git-review-empty"><GitPullRequest size={22} /><strong>Choose a project folder</strong><span>Git Review uses the current project workspace.</span></div>;
  const activeIndex = index?.path === repositoryPath ? index : null;
  const stagedCount = activeIndex?.files.filter((item) => item.staged).length ?? 0;

  async function generateCommits(push) {
    setMenu(null);
    setBusy('Opening commit planning chat...');
    try {
      const text = `Execute the multi-commit workflow now, only in the selected Git repository ${JSON.stringify(activeIndex.directory ?? repositoryPath)} (workspace-relative path: ${JSON.stringify(repositoryPath)}). Inspect its changes, organize them into coherent local commits, and create those commits. Do not touch other repositories or nested repositories. ${push ? 'After all commits are created, push the current branch to its upstream remote; never force-push, and report the push result.' : 'Do not push.'} Never stage credentials or sensitive configuration. Report the created hashes and messages.`;
      const attachments = [{ id: crypto.randomUUID(), kind: 'context_marker', markerType: 'workflow', commandName: 'multi-commit', name: '/multi-commit', size: 0, text: 'Read and execute the multi-commit workflow for the selected repository only.' }];
      await (onAskInSideChat ? onAskInSideChat({ initialPrompt: text, attachments }) : onRunAgent({ text, attachments }));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <div className="git-review-panel" aria-busy={Boolean(busy || loading || fileLoading)}>
    <header className="git-review-topbar"><GitBranch size={16} /><select aria-label="Git repository" value={repositoryPath} disabled={busy || !catalog} onChange={(event) => { setRepositoryPath(event.target.value); setSelected(''); setMessage(''); setStaged(false); }}>
      {!catalog?.repositories.length && <option value="">{loading ? 'Finding repositories...' : 'No repositories found'}</option>}
      {catalog?.repositories.map((repository) => <option key={repository.path} value={repository.path}>{repository.path === '.' ? repository.name : repository.path}</option>)}
    </select><span className="git-review-branch" title={activeIndex?.branch}>{activeIndex?.branch}</span>
      <button type="button" className="icon-button" aria-label="Refresh repositories and changes" title="Refresh" disabled={busy || loading} onClick={async () => {
        setLoading(true); setError('');
        const currentScope = scope.current;
        try {
          const result = await window.chatApp.gitReview.repositories({ ...target, refresh: true });
          if (currentScope !== scope.current) return;
          setCatalog(result);
          if (!result.repositories.some((item) => item.path === repositoryPath)) setRepositoryPath(result.repositories[0]?.path ?? '');
          setRevision((value) => value + 1);
        } catch (failure) { if (currentScope === scope.current) setError(failure.message); }
        finally { if (currentScope === scope.current) setLoading(false); }
      }}>{loading ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <RefreshCw size={14} />}</button>
    </header>
    {error && <div className="git-review-notice error" role="alert"><AlertTriangle size={15} /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={13} /></button></div>}
    {(busy || loading) && <div className="git-review-notice" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" /><span>{busy || (catalog ? 'Refreshing changes...' : 'Finding repositories...')}</span></div>}
    {notice && !busy && !loading && <div className="git-review-notice" role="status"><Check size={15} /><span>{notice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={13} /></button></div>}
    <div className="git-review-workspace">
      <aside className="git-review-navigation">
        <form className="git-review-commit" onSubmit={(event) => { event.preventDefault(); perform('commit', undefined, { message }); }}>
          <label htmlFor="git-commit-message">Commit message</label>
          <div><textarea id="git-commit-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message for staged changes" rows={2} disabled={busy} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (message.trim() && stagedCount) perform('commit', undefined, { message }); } }} />
            <button type="button" className="icon-button" title="Commit AI actions" aria-label="Generate commit with AI" aria-haspopup="menu" aria-expanded={menu?.type === 'generate'} disabled={busy || loading || !activeIndex?.files.length} onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ type: 'generate', opener: event.currentTarget, left: Math.max(8, Math.min(window.innerWidth - 245, rect.left)), top: Math.max(8, Math.min(window.innerHeight - 110, rect.bottom + 5)) });
            }}><Sparkles size={15} /></button>
          </div>
          <div className="git-review-commit-actions"><button type="submit" className="primary-mini" disabled={busy || loading || !stagedCount || !message.trim()}><GitCommitHorizontal size={14} />Commit</button><button type="button" title="Commit staged changes, then push" disabled={busy || loading || !stagedCount || !message.trim()} onClick={() => perform('commit', undefined, { message, push: true })}><Rocket size={14} />Commit + push</button></div>
          <small>{`${activeIndex?.files.length ?? 0} changed · ${stagedCount} staged`}</small>
        </form>
        {activeIndex ? <GitTree key={repositoryPath} files={activeIndex.files} selected={selected} staged={staged} onSelect={onSelect} onMenu={onMenu} onAction={perform} busy={busy || loading} />
          : <div className="git-review-empty">{loading ? 'Loading changes...' : 'Choose a repository.'}</div>}
      </aside>
      <section className="git-review-detail">
        <header className="git-review-file-header"><strong title={selected}>{selected || 'Changes'}</strong><select aria-label="Diff scope" value={staged ? 'staged' : 'all'} onChange={(event) => setStaged(event.target.value === 'staged')}><option value="all">Unstaged</option><option value="staged">Staged changes</option></select></header>
        {fileLoading ? <div className="git-review-empty" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />Loading file changes...</div> : file && activeIndex ? <GitReviewDiff key={`${repositoryPath}:${selected}:${staged}:${revision}`} repository={activeIndex} file={file} onAddToChat={onAddToChat} onAskInSideChat={onAskInSideChat} onQuickQuestion={onQuickQuestion} />
          : <div className="git-review-empty"><GitBranch size={22} /><strong>{activeIndex?.files.length ? 'Select a changed file' : 'Working tree clean'}</strong></div>}
      </section>
    </div>
    <Presence when={activeIndex && menu}>{(menu) => createPortal(<DropdownMenu ref={menuRef} className="git-review-menu" fixed role="menu" style={{ left: menu.left, top: menu.top }} onKeyDown={(event) => {
      const buttons = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
      if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); setMenu(null); menu.opener?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const position = buttons.indexOf(document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (position + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
      {menu.type === 'generate' ? <>
        <DropdownMenuItem icon={<Sparkles size={14} />} role="menuitem" disabled={busy || !stagedCount} onClick={() => { setMenu(null); generatePlan(); }}>Generate commit message</DropdownMenuItem>
        <hr className="dropdown-menu-divider" />
        <DropdownMenuItem icon={<GitCommitHorizontal size={14} />} role="menuitem" disabled={busy || !(onAskInSideChat || onRunAgent)} onClick={() => generateCommits(false)}>Generate commits</DropdownMenuItem>
        <DropdownMenuItem icon={<Rocket size={14} />} role="menuitem" disabled={busy || !(onAskInSideChat || onRunAgent)} onClick={() => generateCommits(true)}>Generate commits + push</DropdownMenuItem>
      </> : <>
      <DropdownMenuItem icon={<Plus size={14} />} role="menuitem" disabled={busy || loading} onClick={() => { perform('stage', menu.node); setMenu(null); }}>{menu.node.path === '.' ? 'Stage all' : 'Stage changes'}</DropdownMenuItem>
      <DropdownMenuItem icon={<Minus size={14} />} role="menuitem" disabled={busy || loading} onClick={() => { perform('unstage', menu.node); setMenu(null); }}>Unstage changes</DropdownMenuItem>
      <DropdownMenuItem icon={<RotateCcw size={14} />} role="menuitem" className="danger" disabled={busy || loading} onClick={() => { perform('discard', menu.node); setMenu(null); }}>{menu.node.path === '.' ? 'Discard all changes...' : 'Discard changes...'}</DropdownMenuItem>
      {menu.node.path !== '.' && <DropdownMenuItem icon={<FileX size={14} />} role="menuitem" disabled={busy || loading} onClick={() => { perform('ignore', menu.node); setMenu(null); }}>Add to .gitignore</DropdownMenuItem>}
      <hr className="dropdown-menu-divider" />
      <DropdownMenuItem icon={<MessageSquarePlus size={14} />} role="menuitem" disabled={!onAddToChat} onClick={() => { onAddToChat(gitReviewAttachment(activeIndex, menu.node.path, '', 'Review the Git changes in this path.')); setMenu(null); }}>Annotate for AI · mention in chat</DropdownMenuItem>
      {onQuickQuestion && <DropdownMenuItem icon={<MessageCircleQuestionMark size={14} />} role="menuitem" onClick={async () => {
        const { node, left, top } = menu;
        const nodeStaged = node.group === 'staged';
        setMenu(null);
        const prefix = node.path === '.' ? '' : `${node.path}/`;
        const content = node.directory
          ? activeIndex.files.filter((item) => !prefix || item.path.startsWith(prefix)).filter((item) => nodeStaged ? item.staged : item.unstaged || item.status === 'untracked')
            .slice(0, 300).map((item) => `${item.status}\t${item.path}`).join('\n')
          : await window.chatApp.gitReview.file({ ...target, repositoryPath, filePath: node.path, staged: nodeStaged, unstaged: !nodeStaged })
            .then((result) => result.diff || result.message || (result.binary ? 'Binary file changed.' : 'No textual changes.'))
            .catch((failure) => `Diff unavailable: ${failure.message}`);
        onQuickQuestion({ label: `${node.path === '.' ? activeIndex.name : node.path} · ${nodeStaged ? 'staged' : 'unstaged'}`, left, top, context: { source: 'git-review', workspacePath: activeIndex.directory, attachments: [gitReviewAttachment(activeIndex, node.path, content, '', nodeStaged ? 'staged' : 'unstaged')] } });
      }}>Quick question</DropdownMenuItem>}
      <hr className="dropdown-menu-divider" />
      <DropdownMenuItem icon={menu.node.directory ? <FolderOpen size={14} /> : <SquareArrowOutUpRight size={14} />} role="menuitem" onClick={() => fileAction('open', menu.node)}>Open {menu.node.directory ? 'folder' : 'file'}</DropdownMenuItem>
      <DropdownMenuItem icon={<FolderOpen size={14} />} role="menuitem" onClick={() => fileAction('reveal', menu.node)}>Show in file explorer</DropdownMenuItem>
      <DropdownMenuItem icon={<Copy size={14} />} role="menuitem" onClick={() => fileAction('copyPath', menu.node)}>Copy path</DropdownMenuItem>
      {menu.node.path === '.' && <><hr className="dropdown-menu-divider" /><DropdownMenuItem icon={<Rocket size={14} />} role="menuitem" disabled={busy} onClick={async () => {
        setMenu(null); if (operation.current) return; operation.current = true; setBusy('Pushing commits...');
        try { const result = await window.chatApp.gitReview.push({ ...target, repositoryPath }); setNotice(result.pushed ? 'Pushed successfully.' : `Push failed: ${result.message}`); } catch (failure) { setError(failure.message); } finally { operation.current = false; setBusy(false); }
      }}>Push repository</DropdownMenuItem><DropdownMenuItem icon={<GitPullRequest size={14} />} role="menuitem" disabled={!onRunAgent} onClick={() => {
        onRunAgent({ text: `Run a read-only code review of the current Git changes in repository ${repositoryPath}. Report prioritized findings; do not modify files.`, attachments: [] }); setMenu(null);
      }}>Code review with agent</DropdownMenuItem></>}
      </>}
    </DropdownMenu>, document.body)}</Presence>
    <Presence when={dialog}>{(dialog) => <GitReviewDialog dialog={dialog} busy={busy} onClose={() => setDialog(null)} onConfirm={() => perform('discard', { path: dialog.path }, { confirmed: true, version: dialog.version })} />}</Presence>
  </div>;
});
