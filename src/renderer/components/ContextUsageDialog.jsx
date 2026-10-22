import {
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { formatMetricDuration } from '../lib/format.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { Overlay, Presence } from './Overlay.jsx';

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
const TABS = [['context', 'Context'], ['stats', 'Stats']];

function formatRatio(value) {
  return Number.isFinite(value) ? `${percentFormatter.format(value * 100)}%` : '—';
}

function formatRate(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} tok/s` : '—';
}

export function ContextUsageDialog({
  conversationId,
  model,
  contextUsage,
  open,
  onOpenChange,
  onCompress,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [highlightedSegmentId, setHighlightedSegmentId] = useState(null);
  const [compressionMenuOpen, setCompressionMenuOpen] = useState(false);
  const [tab, setTab] = useState('context');
  const [stats, setStats] = useState(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState('');
  const compressionMenuRef = useRef(null);
  const dialogRef = useRef(null);

  const loadUsage = useCallback(async () => {
    if (!conversationId || !model) return;
    setBusy(true);
    setError('');
    try {
      setSnapshot(await window.chatApp.chat.contextUsage({
        conversationId,
        model,
        contextLimit: contextUsage?.limit,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }, [contextUsage?.limit, conversationId, model]);

  const loadStats = useCallback(async () => {
    if (!conversationId) return;
    setStatsBusy(true);
    setStatsError('');
    try {
      setStats(await window.chatApp.chat.statistics({ conversationId }));
    } catch (nextError) {
      setStatsError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setStatsBusy(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setHighlightedSegmentId(null);
    void loadUsage();
  }, [loadUsage, open]);

  useEffect(() => {
    if (open && tab === 'stats') void loadStats();
  }, [loadStats, open, tab]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || busy) return;
      if (compressionMenuOpen) {
        setCompressionMenuOpen(false);
        compressionMenuRef.current?.querySelector('.context-compression-trigger')?.focus();
      } else {
        onOpenChange(false);
      }
    }, { signal: controller.signal });
    if (compressionMenuOpen) {
      window.addEventListener('pointerdown', (event) => {
        if (!compressionMenuRef.current?.contains(event.target)) setCompressionMenuOpen(false);
      }, { signal: controller.signal });
      queueMicrotask(() => compressionMenuRef.current?.querySelector('[role="menuitem"]')?.focus());
    }
    return () => controller.abort();
  }, [busy, compressionMenuOpen, onOpenChange, open]);

  const usedRatio = snapshot?.limit
    ? Math.min(1, Math.max(0, snapshot.tokens / snapshot.limit))
    : snapshot ? 1 : 0;
  const freeRatio = snapshot?.limit ? Math.max(0, 1 - usedRatio) : 0;
  const freeTokens = snapshot?.limit ? Math.max(0, snapshot.limit - snapshot.tokens) : 0;
  const groupedSegments = snapshot
    ? [...snapshot.segments.reduce((groups, segment) => {
        const group = groups.get(segment.label);
        if (group) {
          group.characters += segment.characters;
          group.tokens += segment.tokens;
          group.percent += segment.percent;
          group.subcategories.push(segment);
        } else {
          groups.set(segment.label, {
            id: segment.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            label: segment.label,
            characters: segment.characters,
            tokens: segment.tokens,
            percent: segment.percent,
            subcategories: [segment],
          });
        }
        return groups;
      }, new Map()).values()]
    : [];

  const runQuickCompression = async () => {
    setCompressionMenuOpen(false);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.chatApp.chat.compressQuick({ conversationId });
      setMessage(result.replacedResults > 0
        ? `${result.replacedResults} old tool ${result.replacedResults === 1 ? 'result was' : 'results were'} removed.`
        : 'No tool results before the last four turns were available to remove.');
      await loadUsage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const runFullCompression = async () => {
    setCompressionMenuOpen(false);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onCompress();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return <Presence when={open}>{() => createPortal(
    <Overlay
      className="dialog-backdrop context-usage-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false);
      }}
    >
      <section
        className="context-usage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-usage-title"
        ref={dialogRef}
      >
        <header className="dialog-header">
          <div>
            <h2 id="context-usage-title">Context usage</h2>
            <p>
              {tab === 'context'
                ? 'Estimated from serialized character counts and scaled to the latest provider usage.'
                : 'Measured from every model request and tool call recorded in this thread.'}
            </p>
          </div>
          <div className="dialog-header-actions">
            <button
              className="icon-button tiny"
              type="button"
              disabled={busy || statsBusy}
              title={tab === 'context' ? 'Refresh context usage' : 'Refresh thread statistics'}
              aria-label={tab === 'context' ? 'Refresh context usage' : 'Refresh thread statistics'}
              onClick={() => void (tab === 'context' ? loadUsage() : loadStats())}
            >
              <RefreshCw className={busy || statsBusy ? 'spin' : undefined} size={15} />
            </button>
            <button
              className="icon-button tiny"
              type="button"
              disabled={busy}
              aria-label="Close Context usage"
              onClick={() => onOpenChange(false)}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div
          className="context-editor-tabs"
          role="tablist"
          aria-label="Context usage views"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const next = tab === 'context' ? 'stats' : 'context';
            setTab(next);
            requestAnimationFrame(() => dialogRef.current?.querySelector(`#context-usage-tab-${next}`)?.focus());
          }}
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              id={`context-usage-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`context-usage-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'stats' ? (
          <div
            className="context-usage-body"
            id="context-usage-panel-stats"
            role="tabpanel"
            aria-labelledby="context-usage-tab-stats"
          >
            {statsBusy && !stats ? (
              <div className="context-usage-state">
                <LoaderCircle className="spin" size={18} />
                <span>Calculating thread statistics...</span>
              </div>
            ) : stats && (
              <>
                <table className="thread-stats-table">
                  <thead>
                    <tr>
                      <th scope="col">Latency</th>
                      <th scope="col">p50</th>
                      <th scope="col">p95</th>
                      <th scope="col">p99</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Time to first token', stats.latency.firstToken, formatMetricDuration],
                      ['Time to connection', stats.latency.connection, formatMetricDuration],
                      ['Tokens per second', stats.tokensPerSecond, formatRate],
                    ].map(([label, values, format]) => (
                      <tr key={label}>
                        <th scope="row">
                          {label}
                          <small>{numberFormatter.format(values.samples)} samples</small>
                        </th>
                        <td>{format(values.p50)}</td>
                        <td>{format(values.p95)}</td>
                        <td>{format(values.p99)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="thread-stats-list">
                  {[
                    ['Input tokens', numberFormatter.format(stats.tokens.input)],
                    ['Cached tokens', numberFormatter.format(stats.tokens.cached), `${formatRatio(stats.tokens.cachedRatio)} of input`],
                    ['Output tokens', numberFormatter.format(stats.tokens.output), `${formatRatio(stats.tokens.reasoningRatio)} reasoning`],
                    ['Total tokens', numberFormatter.format(stats.tokens.total)],
                    ['Requests', numberFormatter.format(stats.requests.count)],
                    ['Request errors', numberFormatter.format(stats.requests.errors)],
                    ['Tool calls', numberFormatter.format(stats.tools.calls)],
                    [
                      'Tool call errors',
                      numberFormatter.format(stats.tools.invocationErrors + stats.tools.otherErrors),
                      `${numberFormatter.format(stats.tools.invocationErrors)} invocation / ${numberFormatter.format(stats.tools.otherErrors)} other`,
                    ],
                  ].map(([label, value, detail]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        <strong>{value}</strong>
                        {detail && <small>{detail}</small>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {statsError && <p className="context-usage-error" role="alert">{statsError}</p>}
          </div>
        ) : (
        <div
          className="context-usage-body"
          id="context-usage-panel-context"
          role="tabpanel"
          aria-labelledby="context-usage-tab-context"
        >
          {busy && !snapshot ? (
            <div className="context-usage-state">
              <LoaderCircle className="spin" size={18} />
              <span>Calculating context usage...</span>
            </div>
          ) : snapshot && (
            <>
              <div className="context-usage-summary">
                <strong>{numberFormatter.format(Math.round(snapshot.tokens))} tokens</strong>
                <span>
                  {snapshot.limit
                    ? `${percentFormatter.format((snapshot.tokens / snapshot.limit) * 100)}% of ${numberFormatter.format(snapshot.limit)}`
                    : 'No context limit configured'}
                </span>
              </div>
              <div
                className="context-segment-bar"
                role="group"
                aria-label={`${percentFormatter.format(usedRatio * 100)}% used${snapshot.limit ? `, ${percentFormatter.format(freeRatio * 100)}% free` : ''}`}
              >
                {groupedSegments.map((segment, index) => (
                  segment.percent > 0 && (
                    <button
                      key={segment.id}
                      className={`context-segment context-segment-${index % 9}`}
                      type="button"
                      style={{ width: `${segment.percent * usedRatio * 100}%` }}
                      aria-label={`${segment.label}: ${percentFormatter.format(segment.percent * 100)}% of used context${segment.subcategories.length > 1 ? `. ${segment.subcategories.map((subcategory) => `${subcategory.server ?? subcategory.label}: ${percentFormatter.format(subcategory.percent * 100)}%`).join(', ')}` : ''}`}
                      onMouseEnter={() => setHighlightedSegmentId(segment.id)}
                      onMouseLeave={() => setHighlightedSegmentId(null)}
                      onFocus={() => setHighlightedSegmentId(segment.id)}
                      onBlur={() => setHighlightedSegmentId(null)}
                    />
                  )
                ))}
                {freeRatio > 0 && (
                  <button
                    className="context-segment context-segment-free"
                    type="button"
                    style={{ width: `${freeRatio * 100}%` }}
                    aria-label={`Free context: ${percentFormatter.format(freeRatio * 100)}%`}
                    onMouseEnter={() => setHighlightedSegmentId('free')}
                    onMouseLeave={() => setHighlightedSegmentId(null)}
                    onFocus={() => setHighlightedSegmentId('free')}
                    onBlur={() => setHighlightedSegmentId(null)}
                  />
                )}
              </div>
              <div className="context-segment-list">
                {groupedSegments.map((segment, index) => (
                  <article
                    className={highlightedSegmentId && highlightedSegmentId !== segment.id
                      ? 'context-segment-muted'
                      : undefined}
                    key={segment.id}
                  >
                    <span className={`context-segment-dot context-segment-${index % 9}`} aria-hidden="true" />
                    <span className="context-segment-copy">
                      <strong>{segment.label}</strong>
                      {segment.subcategories.length > 1 && (
                        <span className="context-segment-subcategories">
                          {segment.subcategories.map((subcategory) => (
                            <small key={subcategory.id}>
                              <span>{subcategory.server ?? subcategory.label}</span>
                              <b>{percentFormatter.format(subcategory.percent * 100)}%</b>
                            </small>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="context-segment-value">
                      <strong>~{percentFormatter.format(segment.percent * 100)}%</strong>
                      <small>~{numberFormatter.format(Math.round(segment.tokens))} tokens</small>
                    </span>
                  </article>
                ))}
                {snapshot.limit && (
                  <article
                    className={highlightedSegmentId && highlightedSegmentId !== 'free'
                      ? 'context-segment-muted'
                      : undefined}
                  >
                    <span className="context-segment-dot context-segment-free" aria-hidden="true" />
                    <span className="context-segment-copy">
                      <strong>Free</strong>
                      <small>Available context</small>
                    </span>
                    <span className="context-segment-value">
                      <strong>{percentFormatter.format(freeRatio * 100)}%</strong>
                      <small>{numberFormatter.format(Math.round(freeTokens))} tokens available</small>
                    </span>
                  </article>
                )}
              </div>
            </>
          )}
          {error && <p className="context-usage-error" role="alert">{error}</p>}
          {message && <p className="context-usage-message" role="status">{message}</p>}
        </div>
        )}

        {tab === 'context' && <footer className="context-compression-actions">
          <div>
            <strong>Compaction</strong>
            <span>Reduce older context while keeping the latest four turns intact.</span>
          </div>
          <div className="context-compression-menu" ref={compressionMenuRef}>
            <button
              className="button context-compression-trigger"
              type="button"
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={compressionMenuOpen}
              aria-controls="context-compression-menu"
              onClick={() => setCompressionMenuOpen((current) => !current)}
            >
              {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Zap size={14} aria-hidden="true" />}
              Compaction
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            <Presence when={compressionMenuOpen}>{() => (
              <DropdownMenu
                id="context-compression-menu"
                className="context-compression-dropdown"
                role="menu"
                aria-label="Context compaction options"
              >
                <DropdownMenuItem
                  icon={<Zap size={14} aria-hidden="true" />}
                  role="menuitem"
                  onClick={() => void runQuickCompression()}
                >
                  Quick compaction
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<RefreshCw size={14} aria-hidden="true" />}
                  role="menuitem"
                  onClick={() => void runFullCompression()}
                >
                  Full compaction
                </DropdownMenuItem>
              </DropdownMenu>
            )}</Presence>
          </div>
        </footer>}
      </section>
    </Overlay>,
    document.body,
  )}</Presence>;
}
