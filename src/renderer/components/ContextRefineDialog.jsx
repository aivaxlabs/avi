import { applyPatch } from 'diff';
import { Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Overlay } from './Overlay.jsx';
import { RichContent } from './RichContent.jsx';

const tokenFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const fixLabels = { modify: 'Modify', remove: 'Remove', transfer: 'Move', add: 'Add' };
const priorityTones = { P0: 'danger', P1: 'warn' };
const statusLabels = { applied: 'Applied', sent: 'Sent to thread', failed: 'Not applied' };

function describeLocations(finding, items) {
  const locations = finding.locations
    .map(({ contextIndex, evidenceSpan }) => {
      const title = items[contextIndex]?.title ?? `Item ${contextIndex}`;
      if (!evidenceSpan) return title;
      return evidenceSpan.fromLine === evidenceSpan.toLine
        ? `${title}, line ${evidenceSpan.fromLine}`
        : `${title}, lines ${evidenceSpan.fromLine}-${evidenceSpan.toLine}`;
    })
    .join('; ');
  return locations ? `In ${locations}.` : '';
}

export function ContextRefineDialog({
  title,
  scope,
  items,
  allItems,
  readOnly,
  onStartThread,
  onOpenThread,
  onSaved,
  onClose,
}) {
  const [view, setView] = useState('micro');
  const [range, setRange] = useState(items.length > 0 ? 'tab' : 'all');
  const reviewed = range === 'all' ? allItems : items;
  const [running, setRunning] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(0);
  const [statuses, setStatuses] = useState({});
  const [threadId, setThreadId] = useState(null);
  const [error, setError] = useState('');
  const tokenCount = reviewed.reduce((total, item) => total + (item.tokenCount ?? 0), 0);

  const entries = useMemo(() => {
    if (!result) return [];
    const findingsById = new Map(result.findings.map((finding) => [finding.id, finding]));
    const referenced = new Set(result.suggestedFixes.flatMap((fix) => fix.refFinding));

    return [
      ...result.suggestedFixes.map((fix) => ({
        fix,
        // Quick fix: AIVAX servers that predate `suggestedFixes[].patches` omit the field, so
        // their suggestions are listed without a patch. Remove this default once every AIVAX
        // environment returns patches.
        patches: fix.patches ?? [],
        findings: fix.refFinding.map((id) => findingsById.get(id)).filter(Boolean),
      })),
      ...result.findings
        .filter((finding) => !referenced.has(finding.id))
        .map((finding) => ({ fix: null, patches: [], findings: [finding] })),
    ].map((entry) => ({
      ...entry,
      title: entry.findings[0]?.title ?? entry.fix.description,
      priority: entry.findings.map((finding) => finding.priority).sort()[0] ?? null,
      files: [...new Set([
        ...entry.patches.map((patch) => patch.contextIndex),
        ...entry.findings.flatMap((finding) => finding.locations.map((location) => location.contextIndex)),
      ])].map((index) => result.items[index]?.title).filter(Boolean).join(', '),
    }));
  }, [result]);

  const entry = entries[selected];
  const status = statuses[selected];
  const patchable = entries.map((_entry, index) => index).filter((index) => entries[index].patches.length > 0);
  const pending = patchable.filter((index) => !statuses[index]);
  const appliedCount = patchable.filter((index) => statuses[index]?.state === 'applied').length;

  const applyEntries = async (indexes) => {
    setWorking(true);
    const next = {};
    for (const index of indexes) {
      try {
        const writes = await Promise.all(entries[index].patches.map(async (patch) => {
          const item = result.items[patch.contextIndex];
          const { content } = await window.chatApp.context.read(item.path);
          // Every patch is written against the reviewed text, so one applied earlier can change
          // the context lines of the next. Removed lines must still match exactly.
          const patched = applyPatch(content, patch.diff, { fuzzFactor: 2 });
          if (patched === false) {
            throw new Error(`The patch no longer matches ${item.title}: the text it changes was edited after the review, by another patch or outside this dialog. Send it to a thread or run Refine again.`);
          }
          return { path: item.path, content: patched };
        }));
        for (const write of writes) await window.chatApp.context.write(write);
        next[index] = { state: 'applied' };
      } catch (nextError) {
        next[index] = {
          state: 'failed',
          message: nextError instanceof Error ? nextError.message : String(nextError),
        };
      }
    }
    setStatuses((current) => ({ ...current, ...next }));
    setWorking(false);
    if (Object.values(next).some((item) => item.state === 'applied')) onSaved();
  };

  return (
    <Overlay
      className="dialog-backdrop provider-import-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !result && !running) onClose();
      }}
    >
      <section
        className="provider-import-dialog context-refine-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-refine-dialog-title"
        aria-busy={running || working}
        data-result={result ? '' : undefined}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || working || running) return;
          event.preventDefault();
          if (!result || window.confirm('Close this review? Its suggestions are discarded.')) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2 id="context-refine-dialog-title">Refine {range === 'all' ? 'context' : title.toLowerCase()}</h2>
            <p>{scope} · AIVAX Instruction Refinement</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close" disabled={working} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {!result && (
          <div className="context-refine-setup">
            <p>
              Reviews {reviewed.length} {reviewed.length === 1 ? 'item' : 'items'} (~{tokenFormatter.format(tokenCount)} tokens)
              {' '}together, as the same agent receives them. Each review is billed to your AIVAX balance, and larger
              {' '}scopes cost more.
            </p>
            <label className="context-editor-field">
              <span>Scope</span>
              <select
                className="select"
                autoFocus
                value={range}
                disabled={running}
                onChange={(event) => setRange(event.target.value)}
              >
                <option value="tab" disabled={items.length === 0}>
                  This tab: {title.toLowerCase()} ({items.length})
                </option>
                <option value="all">
                  Whole context: instructions, skills, and workflows ({allItems.length})
                </option>
              </select>
            </label>
            <label className="context-editor-field">
              <span>Review</span>
              <select
                className="select"
                value={view}
                disabled={running}
                onChange={(event) => setView(event.target.value)}
              >
                <option value="micro">Wording: clarity and structure of each item</option>
                <option value="macro">Architecture: how the items work together</option>
              </select>
            </label>
            {error && <div className="context-editor-error" role="alert">{error}</div>}
          </div>
        )}

        {result && (
          <div className="context-refine-result">
            <div className="context-refine-summary">
              <strong>Score {Math.round(result.overallScore * 100)} / 100</strong>
              <p>{result.summary}</p>
            </div>
            {entries.length === 0 && <p>No suggestions for this context.</p>}
            {entry && (
              <div className="context-refine-panes">
                <ul
                  className="context-refine-list"
                  aria-label="Suggestions"
                  onKeyDown={(event) => {
                    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
                    event.preventDefault();
                    const next = Math.max(0, Math.min(entries.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
                    setSelected(next);
                    event.currentTarget.querySelectorAll('button')[next]?.focus();
                  }}
                >
                  {entries.map((item, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        autoFocus={index === 0}
                        aria-current={index === selected ? 'true' : undefined}
                        onClick={() => setSelected(index)}
                      >
                        <span className="context-refine-tags">
                          {item.priority && (
                            <span className="context-refine-tag" data-tone={priorityTones[item.priority]}>
                              {item.priority}
                            </span>
                          )}
                          <span className="context-refine-tag">
                            {item.fix ? fixLabels[item.fix.type] ?? item.fix.type : 'Finding'}
                          </span>
                          {statuses[index] && (
                            <span
                              className="context-refine-tag"
                              data-tone={{ applied: 'success', failed: 'danger' }[statuses[index].state]}
                            >
                              {statusLabels[statuses[index].state]}
                            </span>
                          )}
                          {item.fix && item.patches.length === 0 && !statuses[index] && (
                            <span className="context-refine-tag">No patch</span>
                          )}
                        </span>
                        <strong>{item.title}</strong>
                        {item.files && <small>{item.files}</small>}
                      </button>
                    </li>
                  ))}
                </ul>

                <section className="context-refine-detail" key={selected} aria-label="Suggestion details">
                  <h3>{entry.title}</h3>

                  {entry.fix && (
                    <div>
                      <h4>Suggested change</h4>
                      <p>{entry.fix.description}</p>
                    </div>
                  )}

                  {entry.findings.length > 0 && (
                    <div>
                      <h4>{entry.findings.length === 1 ? 'Problem' : 'Problems'}</h4>
                      <ul className="context-refine-findings">
                        {entry.findings.map((finding) => (
                          <li key={finding.id}>
                            <span className="context-refine-tag" data-tone={priorityTones[finding.priority]}>
                              {finding.priority}
                            </span>
                            {' '}<strong>{finding.title}</strong>
                            {' '}{finding.description}
                            <small>{describeLocations(finding, result.items)}</small>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {entry.patches.map((patch) => (
                    <div className="markdown-body" key={patch.contextIndex}>
                      <RichContent
                        part={{
                          type: 'diff',
                          title: result.items[patch.contextIndex]?.title ?? 'Patch',
                          value: patch.diff.trimEnd(),
                        }}
                      />
                    </div>
                  ))}

                  {entry.fix && entry.patches.length === 0 && (
                    <p>
                      AIVAX returned no patch for this suggestion, so there is nothing to preview or apply directly.
                      {!readOnly && ' Send it to a thread to work it out with an agent.'}
                    </p>
                  )}

                  {status?.message && <div className="context-editor-error" role="alert">{status.message}</div>}

                  {entry.fix && !readOnly && (
                    <div className="context-refine-actions">
                      {entry.patches.length > 0 && !['applied', 'sent'].includes(status?.state) && (
                        <button
                          className="button"
                          type="button"
                          disabled={working}
                          onClick={() => applyEntries([selected])}
                        >
                          Apply this patch
                        </button>
                      )}
                      {(entry.patches.length === 0 || status?.state === 'failed') && status?.state !== 'sent' && (
                        <button
                          className="button"
                          type="button"
                          disabled={working}
                          onClick={async () => {
                            setWorking(true);
                            try {
                              const id = await onStartThread([
                                'Apply the following context refinement suggestion from AIVAX Instruction Refinement.',
                                'Edit only the context files listed below, change only what the suggestion requires, and keep their frontmatter valid. If it would remove a business rule, safeguard, or required data, or is unclear, ask before changing it.',
                                '',
                                'Context files:',
                                ...result.items.map((item) => `- ${item.title}: ${item.path}`),
                                '',
                                `Suggestion: [${fixLabels[entry.fix.type] ?? entry.fix.type}] ${entry.fix.description}`,
                                ...entry.findings.map((finding) => (
                                  `- ${finding.priority} ${finding.title}: ${finding.description} ${describeLocations(finding, result.items)}`
                                )),
                                ...entry.patches.flatMap((patch) => [
                                  '',
                                  `Proposed patch for ${result.items[patch.contextIndex]?.title}, which no longer applies cleanly:`,
                                  '```diff',
                                  patch.diff.trimEnd(),
                                  '```',
                                ]),
                              ].join('\n'), threadId);
                              if (!id) throw new Error('Could not start the thread. Check that a model is configured and try again.');
                              setThreadId(id);
                              setStatuses((current) => ({ ...current, [selected]: { state: 'sent' } }));
                            } catch (nextError) {
                              setStatuses((current) => ({
                                ...current,
                                [selected]: {
                                  state: 'failed',
                                  message: nextError instanceof Error ? nextError.message : String(nextError),
                                },
                              }));
                            } finally {
                              setWorking(false);
                            }
                          }}
                        >
                          Send to thread
                        </button>
                      )}
                      {status && status.state !== 'failed' && (
                        <span><Check size={14} aria-hidden="true" />{statusLabels[status.state]}</span>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}

        <footer className="dialog-footer">
          <span>
            {running
              ? 'Refining... this can take a few minutes.'
              : !result || patchable.length === 0
                ? ''
                : readOnly
                  ? 'This context is read-only, so patches cannot be applied.'
                  : `${appliedCount} of ${patchable.length} ${patchable.length === 1 ? 'patch' : 'patches'} applied.`}
          </span>
          <div>
            <button className="button" type="button" disabled={working} onClick={onClose}>
              {result ? 'Close' : 'Cancel'}
            </button>
            {threadId && (
              <button
                className="button"
                type="button"
                disabled={working}
                onClick={() => {
                  onClose();
                  onOpenThread(threadId);
                }}
              >
                Open thread
              </button>
            )}
            {!result && (
              <button
                className="button primary"
                type="button"
                disabled={running}
                onClick={async () => {
                  setRunning(true);
                  setError('');
                  try {
                    setResult(await window.chatApp.context.refine({
                      view,
                      items: reviewed.map(({ path, kind, title: itemTitle, description }) => ({
                        path,
                        kind,
                        title: itemTitle,
                        description,
                      })),
                    }));
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : String(nextError));
                  } finally {
                    setRunning(false);
                  }
                }}
              >
                {running ? 'Refining...' : 'Refine'}
              </button>
            )}
            {result && !readOnly && patchable.length > 0 && (
              <button
                className="button primary"
                type="button"
                disabled={working || pending.length === 0}
                onClick={() => {
                  if (window.confirm(`Apply ${pending.length} ${pending.length === 1 ? 'patch' : 'patches'} to the context files? The files are edited directly.`)) {
                    applyEntries(pending);
                  }
                }}
              >
                {working ? 'Applying...' : pending.length > 0 ? `Apply all patches (${pending.length})` : 'Apply all patches'}
              </button>
            )}
          </div>
        </footer>
      </section>
    </Overlay>
  );
}
