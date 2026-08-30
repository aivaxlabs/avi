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
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

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
  const compressionMenuRef = useRef(null);

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

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setHighlightedSegmentId(null);
    void loadUsage();
  }, [loadUsage, open]);

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

  if (!open) return null;

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

  return createPortal(
    <div
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
      >
        <header className="dialog-header">
          <div>
            <h2 id="context-usage-title">Context usage</h2>
            <p>Estimated from serialized character counts and scaled to the latest provider usage.</p>
          </div>
          <div className="dialog-header-actions">
            <button
              className="icon-button tiny"
              type="button"
              disabled={busy}
              title="Refresh context usage"
              aria-label="Refresh context usage"
              onClick={() => void loadUsage()}
            >
              <RefreshCw className={busy ? 'spin' : undefined} size={15} />
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

        <div className="context-usage-body">
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

        <footer className="context-compression-actions">
          <div>
            <strong>Compaction</strong>
            <span>Reduce older context while keeping the latest four turns intact.</span>
          </div>
          <div className="context-compression-menu" ref={compressionMenuRef}>
            <button
              className="context-compression-trigger"
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
            {compressionMenuOpen && (
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
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
