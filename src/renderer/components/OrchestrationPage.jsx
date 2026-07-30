import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  MessageSquare,
  RefreshCw,
  Rows3,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fullNumber = new Intl.NumberFormat('en-US');
const relativeTime = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function OrchestrationPage({ models, onOpenThread }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const modelsById = useMemo(
    () => new Map(models.map((model) => [model.id, model.name])),
    [models],
  );

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      setOverview(await window.chatApp.orchestration.overview());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  const topModelCount = Math.max(
    1,
    ...(overview?.metrics.topModels ?? []).map((model) => model.messages),
  );

  return (
    <main className="orchestration-page">
      <header className="orchestration-header">
        <div>
          <span className="orchestration-eyebrow">Operational overview</span>
          <h1>Orchestration</h1>
          <p>Track thread activity and today's consumption.</p>
        </div>
        <button
          className="orchestration-refresh"
          type="button"
          disabled={loading}
          onClick={loadOverview}
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
          <section className="orchestration-kpis" aria-label="Today's indicators">
            <KpiCard
              icon={<MessageSquare size={17} />}
              label="Messages sent"
              value={fullNumber.format(overview?.metrics.messagesSent ?? 0)}
            />
            <KpiCard
              icon={<Rows3 size={17} />}
              label="Threads opened"
              value={fullNumber.format(overview?.metrics.threadsOpened ?? 0)}
            />
            <KpiCard
              icon={<Sparkles size={17} />}
              label="Token volume"
              value={compactNumber.format(overview?.metrics.tokens ?? 0)}
              title={fullNumber.format(overview?.metrics.tokens ?? 0)}
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
                    text={loading ? 'Loading tasks…' : 'No ongoing tasks.'}
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
                      text={loading ? 'Loading history…' : 'No recent completions.'}
                    />
                  )}
              </div>
            </section>

            <section className="orchestration-section model-usage-section">
              <div className="orchestration-section-heading">
                <div>
                  <span className="section-icon"><Bot size={16} /></span>
                  <h2>Top 5 most used models</h2>
                </div>
                <span className="section-caption">Today</span>
              </div>
              <div className="model-usage-list">
                {overview?.metrics.topModels.length
                  ? overview.metrics.topModels.map((model, index) => (
                    <div className="model-usage-row" key={model.id}>
                      <span className="model-rank">{index + 1}</span>
                      <div className="model-usage-copy">
                        <div>
                          <strong>{modelsById.get(model.id) ?? model.id}</strong>
                          <span>{model.messages} {model.messages === 1 ? 'response' : 'responses'}</span>
                        </div>
                        <div className="model-usage-track" aria-hidden="true">
                          <span style={{ width: `${(model.messages / topModelCount) * 100}%` }} />
                        </div>
                      </div>
                      <span className="model-token-count" title={`${fullNumber.format(model.tokens)} tokens`}>
                        {compactNumber.format(model.tokens)}
                      </span>
                    </div>
                  ))
                  : (
                    <EmptyState
                      icon={<Bot size={18} />}
                      text={loading ? 'Loading models…' : 'No models used today.'}
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

function KpiCard({ icon, label, value, title }) {
  return (
    <article className="orchestration-kpi">
      <span className="kpi-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong title={title}>{value}</strong>
      </div>
      <small>Today</small>
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
