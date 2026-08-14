import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  FileDiff,
  FilePenLine,
  FilePlus2,
  FileQuestion,
  FileSymlink,
  FileWarning,
  FileX2,
  GitPullRequest,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  Rocket,
  Search,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const fileStatuses = {
  added: { badge: 'A', label: 'Added', Icon: FilePlus2 },
  conflict: { badge: 'C', label: 'Merge conflict', Icon: FileWarning },
  deleted: { badge: 'D', label: 'Deleted', Icon: FileX2 },
  modified: { badge: 'M', label: 'Modified', Icon: FilePenLine },
  renamed: { badge: 'R', label: 'Renamed', Icon: FileSymlink },
  untracked: { badge: 'U', label: 'Untracked', Icon: FileQuestion },
};
const diffLanguages = {
  '.bashrc': 'bash',
  '.env': 'bash',
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

function FileStatus({ status, iconOnly = false, showLabel = false }) {
  const { badge, label, Icon } = fileStatuses[status] ?? {
    badge: 'M',
    label: 'Changed',
    Icon: FileDiff,
  };
  return (
    <span
      className={`git-review-file-status status-${status}`}
      aria-hidden={iconOnly || undefined}
      aria-label={iconOnly ? undefined : label}
      title={label}
    >
      <Icon size={14} aria-hidden="true" />
      {!iconOnly && <b>{badge}</b>}
      {showLabel && <span>{label}</span>}
    </span>
  );
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function selectionLineRange(diff, content) {
  const offset = Math.max(0, diff.indexOf(content));
  const first = diff.slice(0, offset).split('\n').length;
  const last = first + content.split('\n').length - 1;
  return first === last ? `D${first}` : `D${first}-D${last}`;
}

function reviewAttachment(repository, file, content, comment = '') {
  const lineRange = selectionLineRange(file.diff, content);
  const path = repository.path === '.' ? file.path : `${repository.path}/${file.path}`;
  return {
    id: crypto.randomUUID(),
    kind: 'context_marker',
    markerType: comment ? 'git_annotation' : 'file_citation',
    name: `${file.path}:${lineRange}${comment ? ' · annotation' : ''}`,
    size: 0,
    filepath: path,
    text: [
      `<git-review-citation repository="${escapeXml(repository.path)}" path="${escapeXml(file.path)}" range="${lineRange}">`,
      `<diff>${escapeXml(content)}</diff>`,
      comment ? `<comment>${escapeXml(comment)}</comment>` : null,
      '</git-review-citation>',
    ].filter(Boolean).join('\n'),
  };
}

function CommitPlanDialog({ plans, committing, onClose, onCommit }) {
  const commitCount = plans.reduce((total, plan) => total + plan.commits.length, 0);
  const repositoryCount = plans.length;

  return createPortal(
    <div className="dialog-backdrop git-review-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !committing) onClose();
    }}>
      <section
        className="git-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-plan-title"
        aria-describedby="commit-plan-description"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || committing) return;
          event.preventDefault();
          onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2 id="commit-plan-title">Review commit plan</h2>
            <p id="commit-plan-description">
              {commitCount} {commitCount === 1 ? 'commit' : 'commits'} across {repositoryCount} {repositoryCount === 1 ? 'repository' : 'repositories'}
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="Close commit plan" disabled={committing} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="git-review-plan-list">
          {plans.map((plan) => (
            <section key={plan.repositoryPath}>
              <h3><GitCommitHorizontal size={15} aria-hidden="true" />{plan.repositoryName}</h3>
              {plan.commits.map((commit, index) => (
                <article key={`${commit.message}-${index}`}>
                  <strong>{commit.message}</strong>
                  <ul>{commit.files.map((file) => <li key={file}>{file}</li>)}</ul>
                </article>
              ))}
            </section>
          ))}
        </div>
        <footer className="dialog-footer">
          <span>Creates local commits only. Nothing will be pushed.</span>
          <div>
            <button type="button" disabled={committing} onClick={onClose}>Cancel</button>
            <button className="primary-mini" type="button" disabled={committing} onClick={onCommit}>
              {committing ? <RefreshCw className="spin" size={14} /> : <Check size={14} />}
              {committing ? 'Creating commits...' : `Create ${commitCount} ${commitCount === 1 ? 'commit' : 'commits'}`}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function GitReviewPanel({
  conversationId,
  model,
  project,
  onAddToChat,
  onAskInSideChat,
  onRunAgent,
}) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [menu, setMenu] = useState(null);
  const [filePickerRepositoryId, setFilePickerRepositoryId] = useState(null);
  const [fileQuery, setFileQuery] = useState('');
  const [selection, setSelection] = useState(null);
  const [annotation, setAnnotation] = useState('');
  const [plans, setPlans] = useState(null);
  const [busyRepositories, setBusyRepositories] = useState(new Set());
  const [committing, setCommitting] = useState(false);
  const [visibleDiffs, setVisibleDiffs] = useState(new Set());
  const [diffHeights, setDiffHeights] = useState(new Map());
  const panelRef = useRef(null);
  const contentRef = useRef(null);
  const fileSearchRef = useRef(null);

  const changedRepositories = useMemo(() => (
    Array.isArray(review?.repositories)
      ? review.repositories.filter((repository) => repository.files.length > 0)
      : []
  ), [review]);
  const highlightedDiffs = useMemo(() => new Map(
    (review?.repositories ?? []).flatMap((repository) => repository.files.flatMap((file) => {
      const key = JSON.stringify([repository.id, file.path]);
      if (!visibleDiffs.has(key)) return [];
      const lowerName = file.path.toLowerCase().split('/').at(-1);
      const extension = lowerName.includes('.') ? lowerName.split('.').at(-1) : lowerName;
      const language = diffLanguages[lowerName] ?? diffLanguages[extension];
      const diffLanguage = language ? `diff-${language}` : 'diff';
      return [[
        key,
        {
          html: Prism.highlight(file.diff, Prism.languages.diff, diffLanguage),
          language: diffLanguage,
        },
      ]];
    })),
  ), [review, visibleDiffs]);

  async function refresh() {
    if (!conversationId) return;
    setLoading(true);
    setError('');
    setNotice(null);
    try {
      const result = await window.chatApp.gitReview.state(conversationId);
      if (!result || !Array.isArray(result.repositories)) {
        throw new Error('Git Review returned an invalid response.');
      }
      setReview(result);
      setExpanded((current) => current.size > 0
        ? new Set([...current].filter((id) => result.repositories.some((item) => item.id === id)))
        : new Set(result.repositories.filter((item) => item.files.length > 0).map((item) => item.id)));
    } catch (nextError) {
      setReview(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setReview(null);
    setExpanded(new Set());
    setFilePickerRepositoryId(null);
    setFileQuery('');
    setSelection(null);
    setVisibleDiffs(new Set());
    setDiffHeights(new Map());
    if (conversationId) refresh();
  }, [conversationId, project?.path]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const measuredHeights = entries.flatMap((entry) => {
        if (entry.isIntersecting) return [];
        const body = entry.target.querySelector('.git-review-diff');
        return body ? [[entry.target.dataset.gitReviewDiffKey, body.getBoundingClientRect().height]] : [];
      });
      if (measuredHeights.length > 0) {
        setDiffHeights((current) => {
          const next = new Map(current);
          for (const [key, height] of measuredHeights) next.set(key, height);
          return next;
        });
      }
      setVisibleDiffs((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          const key = entry.target.dataset.gitReviewDiffKey;
          if (entry.isIntersecting) next.add(key); else next.delete(key);
        }
        return next;
      });
    }, { root: contentRef.current, rootMargin: '600px 0px' });
    for (const element of contentRef.current?.querySelectorAll('[data-git-review-diff-key]') ?? []) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [review, expanded]);

  useEffect(() => {
    if (!menu) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', () => setMenu(null), { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenu(null);
    }, { signal: controller.signal });
    return () => controller.abort();
  }, [menu]);

  useEffect(() => {
    if (!filePickerRepositoryId) return undefined;
    fileSearchRef.current?.focus();
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.git-review-file-picker')) return;
      setFilePickerRepositoryId(null);
      setFileQuery('');
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setFilePickerRepositoryId(null);
      setFileQuery('');
    }, { signal: controller.signal });
    return () => controller.abort();
  }, [filePickerRepositoryId]);

  useEffect(() => {
    if (!selection) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.selection-action-group, .git-review-annotation')) return;
      setSelection(null);
      setAnnotation('');
    }, { signal: controller.signal });
    return () => controller.abort();
  }, [selection]);

  function updateSelection(event, repository, file) {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) return;
    const range = selected.getRangeAt(0);
    const code = event.currentTarget;
    if (!code.contains(range.commonAncestorContainer)) return;
    const content = selected.toString().trim();
    if (!content) return;
    const rect = range.getBoundingClientRect();
    setSelection({
      repository,
      file,
      content,
      left: Math.max(8, Math.min(window.innerWidth - 310, rect.left)),
      top: Math.max(8, Math.min(window.innerHeight - 120, rect.bottom + 7)),
      annotating: false,
    });
  }

  async function createPlans(repositories) {
    const eligible = repositories.filter((repository) => (
      repository.commitPlanAvailable
    ));
    if (eligible.length !== repositories.length) {
      setError('Commit planning is disabled because the changes are too large or truncated.');
      return;
    }
    setBusyRepositories(new Set(repositories.map((repository) => repository.id)));
    setError('');
    try {
      const nextPlans = [];
      for (const repository of repositories) {
        const plan = await window.chatApp.gitReview.plan({
          conversationId,
          repositoryPath: repository.path,
          model,
        });
        nextPlans.push({ ...plan, repositoryName: repository.name });
      }
      setPlans(nextPlans);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyRepositories(new Set());
    }
  }

  async function acceptPlans() {
    setCommitting(true);
    setError('');
    try {
      for (const plan of plans) {
        await window.chatApp.gitReview.commit({
          conversationId,
          repositoryPath: plan.repositoryPath,
          commits: plan.commits,
        });
      }
      setPlans(null);
      setNotice({ type: 'success', text: 'Commit plan created successfully.' });
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setCommitting(false);
    }
  }

  async function pushRepositories(repositories) {
    setBusyRepositories(new Set(repositories.map((repository) => repository.id)));
    setError('');
    const failures = [];
    try {
      for (const repository of repositories) {
        const result = await window.chatApp.gitReview.push({
          conversationId,
          repositoryPath: repository.path,
        });
        if (!result.pushed) failures.push({ repository, result });
      }
      if (failures.length === 0) {
        setNotice({ type: 'success', text: `Pushed ${repositories.length} repository(ies).` });
      } else {
        const conflictCount = failures.reduce((total, failure) => total + failure.result.conflicts.length, 0);
        setNotice({
          type: 'warning',
          text: `${failures.length} push operation(s) failed.${conflictCount ? ` ${conflictCount} conflicted file(s) found.` : ''}`,
          failures,
        });
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyRepositories(new Set());
    }
  }

  function runCodeReview(repository) {
    onRunAgent?.({
      text: `Run a code review for the repository at ${repository.path}. Review the current Git changes and report prioritized findings only; do not modify files.`,
      attachments: [{
        id: crypto.randomUUID(),
        kind: 'context_marker',
        markerType: 'workflow',
        commandName: 'code-review',
        name: '/code-review',
        size: 0,
        text: 'Use the code-review workflow.',
      }],
    });
  }

  function resolveConflicts(failure) {
    const files = failure.result.conflicts.length > 0
      ? failure.result.conflicts.join(', ')
      : 'the current repository conflict state';
    onRunAgent?.({
      text: `Resolve the Git conflicts in repository ${failure.repository.path} on branch ${failure.result.branch ?? failure.repository.branch}. Conflicted files: ${files}. Inspect the repository state, preserve intent from both sides, validate the resolution, and do not push without explicit user approval.`,
      attachments: [],
    });
  }

  if (!conversationId) {
    return <div className="git-review-empty"><GitPullRequest size={22} /><strong>Start a conversation</strong><span>Git Review is linked to the conversation workspace.</span></div>;
  }

  return (
    <div className="git-review-panel" ref={panelRef}>
      <header className="git-review-topbar">
        <span>
          <strong>Git Review</strong>
          <small>{project?.displayPath ?? project?.path}</small>
        </span>
        <div>
          <button type="button" disabled={loading || changedRepositories.length === 0 || !review?.commitPlanAvailable} onClick={() => createPlans(changedRepositories)}>
            <GitCommitHorizontal size={14} /> Commit all
          </button>
          <button type="button" disabled={loading || !Array.isArray(review?.repositories) || review.repositories.length === 0} onClick={() => pushRepositories(review.repositories)}>
            <Rocket size={14} /> Push all
          </button>
          <button type="button" aria-label="Git Review menu" title="More actions" onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ type: 'global', left: rect.right - 160, top: rect.bottom + 5 });
          }}><MoreHorizontal size={15} /></button>
        </div>
      </header>

      {error && <div className="git-review-notice error"><AlertTriangle size={15} /><span>{error}</span><button type="button" onClick={() => setError('')}><X size={13} /></button></div>}
      {notice && <div className={`git-review-notice ${notice.type}`}>
        {notice.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />}
        <span>{notice.text}</span>
        {notice.failures?.some((failure) => failure.result.canResolveWithAgent) && (
          <button type="button" onClick={() => resolveConflicts(notice.failures.find((failure) => failure.result.canResolveWithAgent))}>Resolve conflicts with agent</button>
        )}
        <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={13} /></button>
      </div>}

      <div className="git-review-content" ref={contentRef}>
        {loading && !review ? (
          <div className="git-review-empty"><RefreshCw className="spin" size={20} /><strong>Loading changes</strong></div>
        ) : !review ? (
          <div className="git-review-empty">
            <AlertTriangle size={22} />
            <strong>Could not load Git changes</strong>
            <span>{error || 'Git Review did not return repository data.'}</span>
            <button type="button" disabled={loading} onClick={refresh}><RefreshCw size={14} /> Retry</button>
          </div>
        ) : review.repositories.length === 0 ? (
          <div className="git-review-empty"><GitBranch size={22} /><strong>No repositories found</strong><span>Git repositories are discovered up to three folders deep.</span></div>
        ) : review.repositories.map((repository) => {
          const isExpanded = expanded.has(repository.id);
          const busy = busyRepositories.has(repository.id);
          const filePickerOpen = filePickerRepositoryId === repository.id;
          const normalizedFileQuery = fileQuery.trim().toLocaleLowerCase();
          const matchingFiles = normalizedFileQuery
            ? repository.files.filter((file) => file.path.toLocaleLowerCase().includes(normalizedFileQuery))
            : repository.files;
          return (
            <section className="git-review-repository" key={repository.id}>
              <header className="git-review-repository-header">
                <button type="button" className="git-review-repository-toggle" onClick={() => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(repository.id)) next.delete(repository.id); else next.add(repository.id);
                  return next;
                })}>
                  {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <span><strong>{repository.name}</strong><small>{repository.files.length} changed · <i>+{repository.additions}</i> <b>-{repository.deletions}</b></small></span>
                  <span className="git-review-branch"><GitBranch size={13} />{repository.branch}</span>
                </button>
                <button type="button" disabled={busy || !repository.commitPlanAvailable} onClick={() => createPlans([repository])}>
                  {busy ? <RefreshCw className="spin" size={14} /> : <GitCommitHorizontal size={14} />} Create commits
                </button>
                <button type="button" aria-label={`${repository.name} menu`} onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ type: 'repository', repository, left: rect.right - 170, top: rect.bottom + 5 });
                }}><MoreHorizontal size={15} /></button>
              </header>

              {isExpanded && repository.files.length === 0 && <div className="git-review-clean">Working tree clean</div>}
              {isExpanded && repository.files.length > 0 && (
                <>
                  <div className="git-review-file-nav">
                    <div className={`git-review-file-picker${filePickerOpen ? ' open' : ''}`}>
                      <button
                        type="button"
                        className="git-review-file-picker-trigger"
                        aria-expanded={filePickerOpen}
                        aria-haspopup="listbox"
                        onClick={() => {
                          setFilePickerRepositoryId(filePickerOpen ? null : repository.id);
                          setFileQuery('');
                        }}
                      >
                        <Search size={15} aria-hidden="true" />
                        <span>Go to file</span>
                        <small>{repository.files.length}</small>
                      </button>
                      {filePickerOpen && (
                        <div className="git-review-file-picker-popover">
                          <label className="git-review-file-search">
                            <Search size={15} aria-hidden="true" />
                            <input
                              ref={fileSearchRef}
                              value={fileQuery}
                              onChange={(event) => setFileQuery(event.target.value)}
                              placeholder="Search changed files"
                              aria-label={`Search files in ${repository.name}`}
                            />
                            {fileQuery && (
                              <button type="button" aria-label="Clear search" onClick={() => {
                                setFileQuery('');
                                fileSearchRef.current?.focus();
                              }}><X size={13} /></button>
                            )}
                          </label>
                          <div className="git-review-file-results" role="listbox" aria-label={`Files in ${repository.name}`}>
                            {matchingFiles.map((file) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected="false"
                                key={file.path}
                                title={file.path}
                                onClick={() => {
                                  setFilePickerRepositoryId(null);
                                  setFileQuery('');
                                  document.getElementById(`git-review-${repository.id}-${file.path}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }}
                              >
                                <FileStatus status={file.status} iconOnly />
                                <span>{file.path}</span>
                                <FileStatus status={file.status} showLabel />
                              </button>
                            ))}
                            {matchingFiles.length === 0 && <span className="git-review-file-results-empty">No matching files</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="git-review-diffs">
                    {repository.files.map((file) => {
                      const key = JSON.stringify([repository.id, file.path]);
                      const highlightedDiff = highlightedDiffs.get(key);
                      const visible = visibleDiffs.has(key);
                      const estimatedHeight = diffHeights.get(key)
                        ?? Math.min(560, Math.max(42, file.diff.split('\n').length * 18 + 18));
                      return (
                        <article
                          id={`git-review-${repository.id}-${file.path}`}
                          className="git-review-file"
                          key={file.path}
                          data-git-review-diff-key={key}
                        >
                          <header><FileStatus status={file.status} /><strong>{file.path}</strong>{file.staged && <small>staged</small>}{file.unstaged && <small>unstaged</small>}</header>
                          {visible ? (file.diff ? (
                            <pre className={`git-review-diff diff-highlight language-${highlightedDiff.language}`} tabIndex={0} onMouseUp={(event) => updateSelection(event, repository, file)} onKeyUp={(event) => updateSelection(event, repository, file)}>
                              <code className={`diff-highlight language-${highlightedDiff.language}`} dangerouslySetInnerHTML={{ __html: highlightedDiff.html }} />
                            </pre>
                          ) : <div className="git-review-no-diff">{file.binary ? 'Binary file changed' : 'No textual diff available'}</div>) : (
                            <div aria-hidden="true" style={{ height: estimatedHeight }} />
                          )}
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>

      {menu && createPortal(
        <DropdownMenu className="git-review-menu" fixed role="menu" style={{ left: menu.left, top: menu.top }} onPointerDown={(event) => event.stopPropagation()}>
          {menu.type === 'global' ? (
            <DropdownMenuItem icon={<RefreshCw size={14} />} role="menuitem" onClick={() => { setMenu(null); refresh(); }}>Refresh</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem icon={<Rocket size={14} />} role="menuitem" disabled={busyRepositories.has(menu.repository.id)} onClick={() => { const repository = menu.repository; setMenu(null); pushRepositories([repository]); }}>Push</DropdownMenuItem>
              <DropdownMenuItem icon={<GitPullRequest size={14} />} role="menuitem" disabled={!onRunAgent} onClick={() => { const repository = menu.repository; setMenu(null); runCodeReview(repository); }}>Code review</DropdownMenuItem>
            </>
          )}
        </DropdownMenu>,
        document.body,
      )}

      {selection && createPortal(
        selection.annotating ? (
          <form className="git-review-annotation" style={{ left: selection.left, top: selection.top }} onSubmit={(event) => {
            event.preventDefault();
            if (!annotation.trim()) return;
            onAddToChat?.(reviewAttachment(selection.repository, selection.file, selection.content, annotation.trim()));
            setSelection(null);
            setAnnotation('');
            window.getSelection()?.removeAllRanges();
          }}>
            <textarea autoFocus value={annotation} onChange={(event) => setAnnotation(event.target.value)} placeholder="Add a review comment..." rows={3} />
            <footer><button type="button" onClick={() => { setSelection(null); setAnnotation(''); }}>Cancel</button><button type="submit" disabled={!annotation.trim()}>Add to chat</button></footer>
          </form>
        ) : (
          <div
            className="selection-action-group"
            role="toolbar"
            aria-label="Selected diff actions"
            style={{ left: selection.left, top: selection.top }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button type="button" onClick={() => setSelection((current) => ({ ...current, annotating: true }))}>
              <PencilLine size={13} aria-hidden="true" />
              <span>Annotate</span>
            </button>
            {onAddToChat && (
              <button type="button" onClick={() => { onAddToChat(reviewAttachment(selection.repository, selection.file, selection.content)); setSelection(null); window.getSelection()?.removeAllRanges(); }}>
                <MessageSquarePlus size={13} aria-hidden="true" />
                <span>Add to chat</span>
              </button>
            )}
            {onAskInSideChat && (
              <button type="button" onClick={() => { onAskInSideChat(reviewAttachment(selection.repository, selection.file, selection.content)); setSelection(null); window.getSelection()?.removeAllRanges(); }}>
                <MessagesSquare size={13} aria-hidden="true" />
                <span>Open in side chat</span>
              </button>
            )}
          </div>
        ),
        document.body,
      )}

      {plans && <CommitPlanDialog plans={plans} committing={committing} onClose={() => setPlans(null)} onCommit={acceptPlans} />}
    </div>
  );
}
