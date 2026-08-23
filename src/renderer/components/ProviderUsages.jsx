import {
  Gauge,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTimeRemaining } from '../lib/provider-usages.js';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function ProviderUsages({ providers, open, onOpenChange }) {
  const [usages, setUsages] = useState([]);
  const [resetsFor, setResetsFor] = useState(null);
  const [confirmingReset, setConfirmingReset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 3_600_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open && !resetsFor) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape' || busy) return;
      if (resetsFor) {
        setResetsFor(null);
        setConfirmingReset(null);
      } else onOpenChange(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onOpenChange, open, resetsFor]);

  const loadUsages = useCallback(async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const snapshots = await Promise.all(providers.map(async (provider) => {
        try {
          return { status: 'ready', value: await window.chatApp.providers.usage(provider.id) };
        } catch (nextError) {
          return {
            status: 'error',
            value: provider,
            error: nextError instanceof Error ? nextError.message : String(nextError),
          };
        }
      }));
      setUsages(snapshots);
    } finally {
      setBusy(false);
    }
  }, [providers]);

  useEffect(() => {
    if (open) void loadUsages();
  }, [loadUsages, open]);

  if (providers.length === 0) return null;

  const selectedUsage = resetsFor
    ? usages.find((entry) => entry.status === 'ready' && entry.value.id === resetsFor)?.value
    : null;
  const resets = selectedUsage?.limits.flatMap((limit) => (
    limit.resetList.map((reset) => ({ ...reset, limitLabel: limit.label }))
  )) ?? [];

  return (
    <>
      <button
        className="provider-usages-trigger"
        type="button"
        title="View provider usage"
        aria-label="View provider usage"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        <Gauge size={15} aria-hidden="true" />
        <span>{providers.length}</span>
      </button>

      {open && createPortal(
        <div className="dialog-backdrop provider-usages-backdrop">
          <section
            className="provider-usages-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-usages-title"
          >
            <header className="dialog-header">
              <div>
                <h2 id="provider-usages-title">Provider usages</h2>
                <p>Account limits and counters reported by providers and plugins.</p>
              </div>
              <div className="dialog-header-actions">
                <button
                  className="icon-button tiny"
                  type="button"
                  disabled={busy}
                  aria-label="Refresh provider usages"
                  title="Refresh provider usages"
                  onClick={() => void loadUsages()}
                >
                  <RefreshCw className={busy ? 'spin' : undefined} size={15} />
                </button>
                <button
                  className="icon-button tiny"
                  type="button"
                  disabled={busy}
                  aria-label="Close"
                  onClick={() => onOpenChange(false)}
                >
                  <X size={15} />
                </button>
              </div>
            </header>

            <div className="provider-usages-body">
              {busy && usages.length === 0 ? (
                <div className="provider-usages-state">
                  <LoaderCircle className="spin" size={18} />
                  <span>Loading provider usage...</span>
                </div>
              ) : usages.map((entry) => (
                entry.status === 'error' ? (
                  <section className="provider-usage-card" key={entry.value.id}>
                    <header>
                      <div>
                        <h3>{entry.value.title}</h3>
                        <small>Unavailable</small>
                      </div>
                    </header>
                    <p className="provider-usages-error" role="alert">{entry.error}</p>
                  </section>
                ) : (
                  <section className="provider-usage-card" key={entry.value.id}>
                    <header>
                      <div>
                        <h3>{entry.value.title}</h3>
                        <small>{entry.value.accountDetails}</small>
                      </div>
                      {entry.value.limits.some((limit) => limit.resetList.length > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            setResetsFor(entry.value.id);
                            setConfirmingReset(null);
                            setMessage('');
                            setError('');
                          }}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                          Resets
                        </button>
                      )}
                    </header>

                    {entry.value.limits.length > 0 && (
                      <div className="provider-usage-limits">
                        {entry.value.limits.map((limit) => {
                          const percent = Math.round(limit.amountConsumed * 100);
                          return (
                            <article key={limit.label}>
                              <span className="provider-usage-copy">
                                <strong>{limit.label}</strong>
                                {limit.description && <small>{limit.description}</small>}
                                {limit.resetsAt && (
                                  <small>
                                    Resets {dateTimeFormatter.format(new Date(limit.resetsAt))}, {formatTimeRemaining(limit.resetsAt, now)}
                                  </small>
                                )}
                              </span>
                              <span className="provider-usage-value">
                                <span
                                  className="provider-usage-track"
                                  role="progressbar"
                                  aria-label={limit.label}
                                  aria-valuemin="0"
                                  aria-valuemax="100"
                                  aria-valuenow={percent}
                                >
                                  <span style={{ width: `${percent}%` }} />
                                </span>
                                <span>{percent}% used</span>
                              </span>
                            </article>
                          );
                        })}
                      </div>
                    )}

                    {entry.value.counters.length > 0 && (
                      <div className="provider-usage-counters">
                        {entry.value.counters.map((counter) => (
                          <article key={counter.label}>
                            <span>
                              <strong>{counter.label}</strong>
                              {counter.description && <small>{counter.description}</small>}
                            </span>
                            <b>{counter.valueString}</b>
                          </article>
                        ))}
                      </div>
                    )}

                    {entry.value.limits.length === 0 && entry.value.counters.length === 0 && (
                      <p className="provider-usages-empty">No usage details are available.</p>
                    )}
                  </section>
                )
              ))}
              {error && <p className="provider-usages-error" role="alert">{error}</p>}
              {message && <p className="provider-usages-message" role="status">{message}</p>}
            </div>
          </section>
        </div>,
        document.body,
      )}

      {resetsFor && createPortal(
        <div className="dialog-backdrop provider-resets-backdrop">
          <section
            className="provider-resets-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-resets-title"
          >
            <header className="dialog-header">
              <div>
                <h2 id="provider-resets-title">{selectedUsage?.title} resets</h2>
                <p>Available resets are supplied by this provider.</p>
              </div>
              <button
                className="icon-button tiny"
                type="button"
                disabled={busy}
                aria-label="Close resets"
                onClick={() => {
                  setResetsFor(null);
                  setConfirmingReset(null);
                }}
              >
                <X size={15} />
              </button>
            </header>

            <div className="provider-resets-list">
              {resets.map((reset) => (
                <article key={reset.id}>
                  <span>
                    <strong>{reset.title || reset.limitLabel}</strong>
                    <small>{[reset.type, reset.description].filter(Boolean).join(' · ')}</small>
                    {reset.expiresAt && (
                      <small>Expires {dateTimeFormatter.format(new Date(reset.expiresAt))}</small>
                    )}
                  </span>
                  {confirmingReset === reset.id ? (
                    <span className="provider-reset-confirmation">
                      <small>Use this reset now?</small>
                      <span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmingReset(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="primary-mini"
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            setMessage('');
                            try {
                              const result = await window.chatApp.providers.resetUsage({
                                usageProviderId: resetsFor,
                                resetId: reset.id,
                              });
                              setUsages((current) => current.map((entry) => (
                                entry.status === 'ready' && entry.value.id === resetsFor
                                  ? { status: 'ready', value: result.usage }
                                  : entry
                              )));
                              setMessage(result.message || 'Usage reset applied.');
                              setResetsFor(null);
                              setConfirmingReset(null);
                            } catch (nextError) {
                              setError(nextError instanceof Error ? nextError.message : String(nextError));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {busy ? 'Using...' : 'Confirm'}
                        </button>
                      </span>
                    </span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setConfirmingReset(reset.id)}>
                      Use reset
                    </button>
                  )}
                </article>
              ))}
              {resets.length === 0 && (
                <p className="provider-usages-empty">No resets are currently available.</p>
              )}
              {error && <p className="provider-usages-error" role="alert">{error}</p>}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
