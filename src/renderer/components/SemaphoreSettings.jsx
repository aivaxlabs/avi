import { CircleDot, Lock, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export function SemaphoreSettings() {
  const [semaphores, setSemaphores] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSemaphores(await window.chatApp.semaphores.state());
      setError('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resetSemaphore(semaphore) {
    const holders = semaphore.holders.reduce((total, holder) => total + holder.count, 0);
    const message = semaphore.queue.length > 0
      ? `Reset semaphore "${semaphore.name}"? All ${holders} held permit(s) will be released and waiting threads will acquire permits according to the FIFO queue.`
      : `Reset semaphore "${semaphore.name}"? All ${holders} held permit(s) will be released.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await window.chatApp.semaphores.reset(semaphore.name);
      setSemaphores(result.semaphores);
      setNotice(
        `Semaphore "${result.name}" reset: ${result.released.length} holder(s) cleared, ${result.activated} waiter(s) resumed.`,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section semaphore-settings">
      <div className="settings-section-heading semaphore-heading">
        <div>
          <h3>Semaphores</h3>
          <p>Named permits shared by every thread in the application. Reset a semaphore to release stuck permits and resume queued waiters.</p>
        </div>
        <button
          className="semaphore-refresh"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={14} className={loading ? 'spinning' : undefined} />
          Refresh
        </button>
      </div>
      <div className={`settings-section-card semaphore-list${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {semaphores?.length ? semaphores.map((semaphore) => {
          const used = semaphore.holders.reduce((total, holder) => total + holder.count, 0);
          return (
            <div className="semaphore-row" key={semaphore.name}>
              <span className="settings-entity-icon"><Lock size={16} /></span>
              <span className="semaphore-copy">
                <strong>{semaphore.name}</strong>
                <small>
                  {used} of {semaphore.maxCount} permits in use
                  {' · '}{semaphore.queue.length} waiting
                </small>
                <span className="semaphore-parties">
                  {semaphore.holders.map((holder) => (
                    <small className="semaphore-party" key={holder.conversationId}>
                      <CircleDot size={12} />
                      {holder.conversation.title} · holds {holder.count}
                    </small>
                  ))}
                  {semaphore.queue.map((entry) => (
                    <small className="semaphore-party is-waiting" key={entry.conversationId}>
                      <CircleDot size={12} />
                      #{entry.position} {entry.conversation.title} · waiting
                    </small>
                  ))}
                </span>
              </span>
              <span className="archive-actions">
                <button
                  className="danger"
                  type="button"
                  disabled={busy || loading}
                  title="Release all held permits"
                  onClick={() => void resetSemaphore(semaphore)}
                >
                  <RotateCcw size={14} />
                  Reset permits
                </button>
              </span>
            </div>
          );
        }) : (
          <div className="settings-empty semaphore-empty">
            {loading ? 'Loading semaphores...' : 'No semaphores are currently in use.'}
          </div>
        )}
      </div>

      {notice && <div className="settings-context-status" role="status">{notice}</div>}
      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </section>
  );
}
