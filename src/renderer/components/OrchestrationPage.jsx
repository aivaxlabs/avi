import {
  Activity,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  MessageSquare,
  RefreshCw,
  Rows3,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fullNumber = new Intl.NumberFormat('en-US');
const relativeTime = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const toLocalInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function OrchestrationPage({ models, onOpenThread }) {
  const initialFrom = new Date();
  initialFrom.setHours(0, 0, 0, 0);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState(() => ({
    from: toLocalInput(initialFrom),
    to: toLocalInput(new Date()),
    label: 'Today',
  }));
  const rangePickerRef = useRef(null);
  const modelsById = useMemo(
    () => new Map(models.map((model) => [model.id, model.name])),
    [models],
  );

  async function loadOverview(selectedRange = range) {
    const from = new Date(selectedRange.from);
    const to = new Date(selectedRange.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      setError('Choose a valid date range.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setOverview(await window.chatApp.orchestration.overview({
        from: from.toISOString(),
        to: to.toISOString(),
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, [range]);

  useEffect(() => {
    if (!rangeOpen) return undefined;

    const closePicker = (event) => {
      if (!rangePickerRef.current?.contains(event.target)) setRangeOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setRangeOpen(false);
    };
    document.addEventListener('pointerdown', closePicker);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closePicker);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [rangeOpen]);

  const rangeCaption = range.label || `${dateLabel.format(new Date(range.from))} – ${dateLabel.format(new Date(range.to))}`;

  const topModelCount = Math.max(
    1,
    ...(overview?.metrics.topModels ?? []).map((model) => model.messages),
  );

  return (
    <main className="orchestration-page">
      <header className="orchestration-header" ref={rangePickerRef}>
        <div>
          <span className="orchestration-eyebrow">Operational overview</span>
          <h1>Orchestration</h1>
          <p>Track thread activity and consumption over time.</p>
        </div>
        <button
          className="orchestration-range-trigger"
          type="button"
          aria-expanded={rangeOpen}
          aria-haspopup="dialog"
          onClick={() => setRangeOpen((open) => !open)}
        >
          <CalendarDays size={15} />
          <span>{rangeCaption}</span>
          <ChevronDown size={14} />
        </button>
        {rangeOpen && (
          <div className="orchestration-range-popover" role="dialog" aria-label="Select time range">
            <div className="orchestration-range-fields">
              <label>
                <span>From</span>
                <input
                  type="datetime-local"
                  value={range.from}
                  max={range.to}
                  onChange={(event) => setRange((current) => ({ ...current, from: event.target.value, label: '' }))}
                />
              </label>
              <ArrowRight size={15} />
              <label>
                <span>To</span>
                <input
                  type="datetime-local"
                  value={range.to}
                  min={range.from}
                  onChange={(event) => setRange((current) => ({ ...current, to: event.target.value, label: '' }))}
                />
              </label>
            </div>
            <div className="orchestration-range-presets">
              {[
                ['Today', 'today'],
                ['This week', 'week'],
                ['This month', 'month'],
                ['Past 30 minutes', 30 * 60_000],
                ['Past hour', 60 * 60_000],
                ['Past 3 hours', 3 * 60 * 60_000],
                ['Past day', 24 * 60 * 60_000],
                ['Past week', 7 * 24 * 60 * 60_000],
                ['Past month', 30 * 24 * 60 * 60_000],
                ['Past year', 365 * 24 * 60 * 60_000],
              ].map(([label, duration]) => (
                <button
                  type="button"
                  key={label}
                  className={range.label === label ? 'active' : undefined}
                  onClick={() => {
                    const to = new Date();
                    const from = new Date(to);
                    if (duration === 'today') from.setHours(0, 0, 0, 0);
                    else if (duration === 'week') {
                      from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
                      from.setHours(0, 0, 0, 0);
                    } else if (duration === 'month') {
                      from.setDate(1);
                      from.setHours(0, 0, 0, 0);
                    } else from.setTime(to.getTime() - duration);
                    setRange({ from: toLocalInput(from), to: toLocalInput(to), label });
                    setRangeOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          className="orchestration-refresh"
          type="button"
          disabled={loading}
          onClick={() => loadOverview()}
        >
          <RefreshCw size={15} className={loading ? 'spinning' : undefined} />
          Refresh
        </button>
      </header>

      {error ? (
        <section className="orchestration-error" role="alert">
          Couldn't load the dashboard. {error}
        </section>
      ) : (
        <>
          <section className="orchestration-kpis" aria-label={`${rangeCaption} indicators`}>
            <KpiCard
              icon={<MessageSquare size={17} />}
              label="Messages sent"
              value={fullNumber.format(overview?.metrics.messagesSent ?? 0)}
              caption={rangeCaption}
            />
            <KpiCard
              icon={<Rows3 size={17} />}
              label="Threads opened"
              value={fullNumber.format(overview?.metrics.threadsOpened ?? 0)}
              caption={rangeCaption}
            />
            <KpiCard
              icon={<Sparkles size={17} />}
              label="Token volume"
              value={compactNumber.format(overview?.metrics.tokens ?? 0)}
              title={fullNumber.format(overview?.metrics.tokens ?? 0)}
              caption={rangeCaption}
            />
          </section>

          <div className="orchestration-grid">
            <section className="orchestration-section">
              <div className="orchestration-section-heading">
                <div>
                  <span className="section-icon active"><Activity size={16} /></span>
                  <h2>Ongoing tasks</h2>
                </div>
                <span className="section-count">{overview?.ongoing.length ?? 0}</span>
              </div>
              <div className="task-list">
                {overview?.ongoing.length ? overview.ongoing.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    modelName={modelsById.get(task.model) ?? task.model}
                    ongoing
                    onOpen={() => onOpenThread(task.id)}
                  />
                )) : (
                  <EmptyState
                    icon={<Clock3 size={18} />}
                    text={loading ? 'Loading tasks...' : 'No ongoing tasks.'}
                  />
                )}
              </div>
            </section>

            <section className="orchestration-section">
              <div className="orchestration-section-heading">
                <div>
                  <span className="section-icon"><CheckCircle2 size={16} /></span>
                  <h2>Recently completed</h2>
                </div>
                <span className="section-count">
                  {overview?.recentlyCompleted.length ?? 0}
                </span>
              </div>
              <div className="task-list">
                {overview?.recentlyCompleted.length
                  ? overview.recentlyCompleted.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      modelName={modelsById.get(task.model) ?? task.model}
                      onOpen={() => onOpenThread(task.id)}
                    />
                  ))
                  : (
                    <EmptyState
                      icon={<CheckCircle2 size={18} />}
                      text={loading ? 'Loading history...' : 'No recent completions.'}
                    />
                  )}
              </div>
            </section>

            <section className="orchestration-section model-usage-section">
              <div className="orchestration-section-heading">
                <div>
                  <span className="section-icon"><Bot size={16} /></span>
                  <h2>Top 10 most used models</h2>
                </div>
                <span className="section-caption">{rangeCaption}</span>
              </div>
              <div className="model-usage-list">
                {overview?.metrics.topModels.length
                  ? overview.metrics.topModels.map((model, index) => (
                    <article className="model-usage-row" key={model.id}>
                      <div className="model-usage-header">
                        <span className="model-rank">{index + 1}</span>
                        <div className="model-usage-copy">
                          <strong>{modelsById.get(model.id) ?? model.id}</strong>
                          <span>{model.messages} {model.messages === 1 ? 'response' : 'responses'}</span>
                        </div>
                        <strong className="model-token-total" title={`${fullNumber.format(model.tokens)} total tokens`}>
                          {compactNumber.format(model.tokens)}
                          <span>total</span>
                        </strong>
                      </div>
                      <div className="model-usage-track" aria-hidden="true">
                        <span style={{ width: `${(model.messages / topModelCount) * 100}%` }} />
                      </div>
                      <dl className="model-metrics">
                        <div>
                          <dt>Input tokens</dt>
                          <dd title={fullNumber.format(model.inputTokens)}>{compactNumber.format(model.inputTokens)}</dd>
                        </div>
                        <div>
                          <dt>Cached tokens</dt>
                          <dd title={fullNumber.format(model.cachedInputTokens)}>{compactNumber.format(model.cachedInputTokens)}</dd>
                        </div>
                        <div>
                          <dt>Output tokens</dt>
                          <dd title={fullNumber.format(model.outputTokens)}>{compactNumber.format(model.outputTokens)}</dd>
                        </div>
                        {model.timedMessages === model.messages && (
                          <div>
                            <dt>Model time</dt>
                            <dd>{model.durationMs >= 3_600_000
                              ? `${Math.floor(model.durationMs / 3_600_000)}h ${Math.floor((model.durationMs % 3_600_000) / 60_000)}m`
                              : model.durationMs >= 60_000
                                ? `${Math.floor(model.durationMs / 60_000)}m ${Math.floor((model.durationMs % 60_000) / 1_000)}s`
                                : `${(model.durationMs / 1_000).toFixed(model.durationMs < 10_000 ? 1 : 0)}s`}</dd>
                          </div>
                        )}
                      </dl>
                    </article>
                  ))
                  : (
                    <EmptyState
                      icon={<Bot size={18} />}
                      text={loading ? 'Loading models...' : `No models used during ${rangeCaption.toLowerCase()}.`}
                    />
                  )}
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function KpiCard({ icon, label, value, title, caption }) {
  return (
    <article className="orchestration-kpi">
      <span className="kpi-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong title={title}>{value}</strong>
      </div>
      <small>{caption}</small>
    </article>
  );
}

function TaskRow({ task, modelName, ongoing = false, onOpen }) {
  const updatedAt = new Date(task.updatedAt);
  const elapsedMinutes = Math.round((updatedAt.getTime() - Date.now()) / 60_000);
  const relative = Math.abs(elapsedMinutes) < 60
    ? relativeTime.format(elapsedMinutes, 'minute')
    : Math.abs(elapsedMinutes) < 1_440
      ? relativeTime.format(Math.round(elapsedMinutes / 60), 'hour')
      : relativeTime.format(Math.round(elapsedMinutes / 1_440), 'day');

  return (
    <button className="task-row" type="button" onClick={onOpen}>
      <span className={`task-status-dot${ongoing ? ' live' : ''}`} />
      <span className="task-copy">
        <strong>{task.title || task.firstPrompt || 'New chat'}</strong>
        <span>{task.projectName} · {modelName || 'No model'}</span>
      </span>
      <span className="task-meta">
        <strong>{ongoing ? (task.goal?.status === 'paused' ? 'Paused' : 'Ongoing') : 'Completed'}</strong>
        <span>{relative}</span>
      </span>
    </button>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className="orchestration-empty">
      {icon}
      <span>{text}</span>
    </div>
  );
}
