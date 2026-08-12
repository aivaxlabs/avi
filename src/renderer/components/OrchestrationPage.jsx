import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fullNumber = new Intl.NumberFormat('en-US');
const relativeTime = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const TOKEN_CHART_WIDTH = 1_000;
const TOKEN_CHART_HEIGHT = 240;
const TOKEN_CHART_TOP = 12;
const TOKEN_CHART_BOTTOM = 228;
const TOKEN_CHART_COLORS = [
  'var(--primary-color)',
  'var(--text-1)',
  'var(--success-color)',
  '#8b72d9',
  '#d56f52',
  '#3f8fa3',
  '#b5862c',
  '#c65d87',
];
const toLocalInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function OrchestrationPage({ models, onOpenThread }) {
  const initialFrom = new Date();
  initialFrom.setHours(0, 0, 0, 0);
  const [activeTab, setActiveTab] = useState('tasks');
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
    () => new Map(models.map((model) => [model.id, model])),
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

  const modelUsageGroups = useMemo(() => {
    const groups = new Map();
    for (const usage of overview?.metrics.topModels ?? []) {
      const catalogModel = modelsById.get(usage.id);
      const providerId = catalogModel?.providerId ?? 'unknown';
      const group = groups.get(providerId) ?? {
        id: providerId,
        name: catalogModel?.providerName ?? 'Unknown provider',
        tokens: 0,
        models: [],
      };
      group.tokens += usage.tokens;
      group.models.push({
        ...usage,
        name: catalogModel?.name ?? usage.id,
      });
      groups.set(providerId, group);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        models: group.models.sort((a, b) => b.tokens - a.tokens),
      }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [modelsById, overview?.metrics.topModels]);

  const dailyTokenChart = useMemo(() => {
    const firstDay = new Date(range.from);
    const lastDay = new Date(range.to);
    if (!Number.isFinite(firstDay.getTime()) || !Number.isFinite(lastDay.getTime())) {
      return { dateTicks: [], maximum: 0, series: [], yTicks: [] };
    }
    firstDay.setHours(0, 0, 0, 0);
    lastDay.setHours(0, 0, 0, 0);

    const days = [];
    const dayIndexes = new Map();
    for (const cursor = new Date(firstDay); cursor <= lastDay; cursor.setDate(cursor.getDate() + 1)) {
      const timestamp = cursor.getTime();
      dayIndexes.set(timestamp, days.length);
      days.push(timestamp);
    }

    const providers = new Map(modelUsageGroups.map((provider) => [provider.id, {
      id: provider.id,
      name: provider.name,
      tokens: 0,
      values: Array(days.length).fill(0),
    }]));
    for (const dailyUsage of overview?.metrics.dailyTokens ?? []) {
      const dayIndex = dayIndexes.get(Number(dailyUsage.date));
      if (dayIndex === undefined) continue;

      for (const modelUsage of dailyUsage.models ?? []) {
        const catalogModel = modelsById.get(modelUsage.id);
        const providerId = catalogModel?.providerId ?? 'unknown';
        const provider = providers.get(providerId) ?? {
          id: providerId,
          name: catalogModel?.providerName ?? 'Unknown provider',
          tokens: 0,
          values: Array(days.length).fill(0),
        };
        const tokens = Number(modelUsage.tokens) || 0;
        provider.tokens += tokens;
        provider.values[dayIndex] += tokens;
        providers.set(providerId, provider);
      }
    }

    const providersWithUsage = [...providers.values()]
      .filter((provider) => provider.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);
    let maximum = 0;
    for (const provider of providersWithUsage) {
      for (const tokens of provider.values) maximum = Math.max(maximum, tokens);
    }

    let scaleMaximum = 0;
    if (maximum > 0) {
      const magnitude = 10 ** Math.floor(Math.log10(maximum));
      const normalizedMaximum = maximum / magnitude;
      const scaleFactor = normalizedMaximum <= 1
        ? 1
        : normalizedMaximum <= 2
          ? 2
          : normalizedMaximum <= 5
            ? 5
            : 10;
      scaleMaximum = scaleFactor * magnitude;
    }

    const series = providersWithUsage.map((provider, providerIndex) => {
      const points = provider.values.map((tokens, dayIndex) => ({
        date: days[dayIndex],
        tokens,
        x: days.length === 1
          ? TOKEN_CHART_WIDTH / 2
          : (dayIndex / (days.length - 1)) * TOKEN_CHART_WIDTH,
        y: TOKEN_CHART_TOP + (1 - (tokens / scaleMaximum))
          * (TOKEN_CHART_BOTTOM - TOKEN_CHART_TOP),
      }));
      const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
      return {
        ...provider,
        areaPoints: points.length
          ? `${points[0].x},${TOKEN_CHART_BOTTOM} ${linePoints} ${points.at(-1).x},${TOKEN_CHART_BOTTOM}`
          : '',
        color: TOKEN_CHART_COLORS[providerIndex % TOKEN_CHART_COLORS.length],
        linePoints,
        points,
      };
    });
    const yTicks = scaleMaximum > 0
      ? Array.from({ length: 5 }, (_, index) => ({
        value: scaleMaximum * ((4 - index) / 4),
        y: TOKEN_CHART_TOP + ((TOKEN_CHART_BOTTOM - TOKEN_CHART_TOP) * index) / 4,
      }))
      : [];
    const dateTickCount = Math.min(5, days.length);
    const dateTickIndexes = dateTickCount <= 1
      ? days.length ? [0] : []
      : [...new Set(Array.from(
        { length: dateTickCount },
        (_, index) => Math.round((index * (days.length - 1)) / (dateTickCount - 1)),
      ))];
    const dateTicks = dateTickIndexes.map((dayIndex) => ({
      align: days.length === 1
        ? 'center'
        : dayIndex === 0
          ? 'start'
          : dayIndex === days.length - 1
            ? 'end'
            : 'center',
      date: days[dayIndex],
      label: dateLabel.format(days[dayIndex]),
      x: days.length === 1 ? 50 : (dayIndex / (days.length - 1)) * 100,
    }));

    return { dateTicks, maximum, series, yTicks };
  }, [modelUsageGroups, modelsById, overview?.metrics.dailyTokens, range.from, range.to]);

  return (
    <main className="orchestration-page">
      <header className="orchestration-header" ref={rangePickerRef}>
        <div>
          <span className="orchestration-eyebrow">Operational overview</span>
          <h1>Orchestration</h1>
          <p>Track thread activity and consumption over time.</p>
        </div>
        {activeTab === 'models' && (
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
        )}
        {activeTab === 'models' && rangeOpen && (
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

      <div className="orchestration-tabs" role="tablist" aria-label="Orchestration views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'tasks'}
          onClick={() => {
            setActiveTab('tasks');
            setRangeOpen(false);
          }}
        >
          Tasks overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'models'}
          onClick={() => setActiveTab('models')}
        >
          Models summary
        </button>
      </div>

      {error ? (
        <section className="orchestration-error" role="alert">
          Couldn't load the dashboard. {error}
        </section>
      ) : (
        <>
          {activeTab === 'models' && (
            <section className="token-overview" aria-label={`${rangeCaption} token usage`}>
              <div className="token-overview-total">
                <span>Processed tokens</span>
                <strong title={fullNumber.format(overview?.metrics.tokens ?? 0)}>
                  {compactNumber.format(overview?.metrics.tokens ?? 0)}
                </strong>
                <small>{fullNumber.format(overview?.metrics.responses ?? 0)} model responses</small>
              </div>
              <dl className="token-overview-metrics">
                <div>
                  <dt>Input</dt>
                  <dd title={fullNumber.format(overview?.metrics.inputTokens ?? 0)}>
                    {compactNumber.format(overview?.metrics.inputTokens ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Cached input</dt>
                  <dd title={fullNumber.format(overview?.metrics.cachedInputTokens ?? 0)}>
                    {compactNumber.format(overview?.metrics.cachedInputTokens ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd title={fullNumber.format(overview?.metrics.outputTokens ?? 0)}>
                    {compactNumber.format(overview?.metrics.outputTokens ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Reasoning</dt>
                  <dd title={fullNumber.format(overview?.metrics.reasoningTokens ?? 0)}>
                    {compactNumber.format(overview?.metrics.reasoningTokens ?? 0)}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <div className="orchestration-grid">
            {activeTab === 'tasks' && (
              <>
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
                          modelName={modelsById.get(task.model)?.name ?? task.model}
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

                <section className="orchestration-section">
                  <div className="orchestration-section-heading">
                    <div>
                      <span className="section-icon attention"><AlertTriangle size={16} /></span>
                      <h2>Tasks requiring attention</h2>
                    </div>
                    <span className="section-count">{overview?.requiresAttention.length ?? 0}</span>
                  </div>
                  <div className="task-list">
                    {overview?.requiresAttention.length
                      ? overview.requiresAttention.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          modelName={modelsById.get(task.model)?.name ?? task.model}
                          status="Needs attention"
                          attention
                          onOpen={() => onOpenThread(task.id)}
                        />
                      ))
                      : (
                        <EmptyState
                          icon={<AlertTriangle size={18} />}
                          text={loading ? 'Checking tasks...' : 'No tasks require attention.'}
                        />
                      )}
                  </div>
                </section>

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
                        modelName={modelsById.get(task.model)?.name ?? task.model}
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
              </>
            )}

            {activeTab === 'models' && (
              <>
                <section className="orchestration-section daily-token-section">
                  <div className="orchestration-section-heading daily-token-heading">
                    <div>
                      <span className="section-icon"><Activity size={16} /></span>
                      <div className="daily-token-title">
                        <h2>Daily tokens</h2>
                        <span>Token volume by provider</span>
                      </div>
                    </div>
                    {dailyTokenChart.series.length > 0 && (
                      <div className="daily-token-legend" aria-label="Providers">
                        {dailyTokenChart.series.map((provider) => (
                          <span className="daily-token-legend-item" key={provider.id}>
                            <i
                              className="daily-token-legend-dot"
                              style={{ '--chart-color': provider.color }}
                              aria-hidden="true"
                            />
                            <span>{provider.name}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="daily-token-chart">
                    {dailyTokenChart.maximum > 0
                      ? (
                        <div
                          className="daily-token-chart-layout"
                          role="img"
                          aria-label={`${rangeCaption} daily token usage. ${dailyTokenChart.series
                            .map((provider) => `${provider.name}: ${fullNumber.format(provider.tokens)} tokens`)
                            .join(', ')}`}
                        >
                          <div className="daily-token-y-axis" aria-hidden="true">
                            {dailyTokenChart.yTicks.map((tick) => (
                              <span
                                key={tick.value}
                                style={{ top: `${(tick.y / TOKEN_CHART_HEIGHT) * 100}%` }}
                              >
                                {compactNumber.format(tick.value)}
                              </span>
                            ))}
                          </div>
                          <div className="daily-token-plot">
                            <svg
                              viewBox={`0 0 ${TOKEN_CHART_WIDTH} ${TOKEN_CHART_HEIGHT}`}
                              preserveAspectRatio="none"
                              aria-hidden="true"
                            >
                              <g className="daily-token-grid">
                                {dailyTokenChart.yTicks.map((tick) => (
                                  <line
                                    key={tick.value}
                                    x1="0"
                                    x2={TOKEN_CHART_WIDTH}
                                    y1={tick.y}
                                    y2={tick.y}
                                  />
                                ))}
                              </g>
                              {dailyTokenChart.series.map((provider) => (
                                <g
                                  className="daily-token-series"
                                  key={provider.id}
                                  style={{ '--chart-color': provider.color }}
                                >
                                  <polygon className="daily-token-area" points={provider.areaPoints} />
                                  <polyline className="daily-token-line" points={provider.linePoints} />
                                  {provider.points.map((point) => point.tokens > 0 && (
                                    <circle
                                      className="daily-token-point"
                                      key={point.date}
                                      cx={point.x}
                                      cy={point.y}
                                      r="3.5"
                                    >
                                      <title>
                                        {provider.name} · {dateLabel.format(point.date)}: {fullNumber.format(point.tokens)} tokens
                                      </title>
                                    </circle>
                                  ))}
                                </g>
                              ))}
                            </svg>
                            <div className="daily-token-x-axis" aria-hidden="true">
                              {dailyTokenChart.dateTicks.map((tick) => (
                                <span
                                  className={tick.align}
                                  key={tick.date}
                                  style={{ left: `${tick.x}%` }}
                                >
                                  {tick.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                      : (
                        <EmptyState
                          icon={<Activity size={18} />}
                          text={loading ? 'Loading daily usage...' : `No token usage during ${rangeCaption.toLowerCase()}.`}
                        />
                      )}
                  </div>
                </section>

                <section className="orchestration-section model-usage-section">
                  <div className="orchestration-section-heading">
                    <div>
                      <span className="section-icon"><Bot size={16} /></span>
                      <h2>Usage by provider and model</h2>
                    </div>
                    <span className="section-caption">
                      {overview?.metrics.modelsUsed ?? 0} models · {rangeCaption}
                    </span>
                  </div>
                  <div className="provider-usage-list">
                    {modelUsageGroups.length
                      ? modelUsageGroups.map((provider) => (
                        <article className="provider-usage-group" key={provider.id}>
                          <header className="provider-usage-header">
                            <div>
                              <span className="provider-mark" aria-hidden="true">
                                {provider.name.slice(0, 1).toUpperCase()}
                              </span>
                              <div>
                                <h3>{provider.name}</h3>
                                <span>{provider.models.length} {provider.models.length === 1 ? 'model' : 'models'}</span>
                              </div>
                            </div>
                            <div className="provider-token-total">
                              <strong title={`${fullNumber.format(provider.tokens)} tokens`}>
                                {compactNumber.format(provider.tokens)}
                              </strong>
                              <span>
                                {overview?.metrics.tokens
                                  ? `${((provider.tokens / overview.metrics.tokens) * 100).toFixed(1)}% of tokens`
                                  : '0% of tokens'}
                              </span>
                            </div>
                          </header>
                          <div className="provider-usage-track" aria-hidden="true">
                            <span style={{
                              width: `${overview?.metrics.tokens
                                ? (provider.tokens / overview.metrics.tokens) * 100
                                : 0}%`,
                            }} />
                          </div>
                          <div className="provider-model-list">
                            {provider.models.map((model) => (
                              <div className="provider-model-row" key={model.id}>
                                <div className="provider-model-name">
                                  <strong>{model.name}</strong>
                                  <span>{model.messages} {model.messages === 1 ? 'response' : 'responses'}</span>
                                </div>
                                <dl className="provider-model-metrics">
                                  <div>
                                    <dt>Total</dt>
                                    <dd title={fullNumber.format(model.tokens)}>{compactNumber.format(model.tokens)}</dd>
                                  </div>
                                  <div>
                                    <dt>Input</dt>
                                    <dd title={fullNumber.format(model.inputTokens)}>{compactNumber.format(model.inputTokens)}</dd>
                                  </div>
                                  <div>
                                    <dt>Cached</dt>
                                    <dd title={fullNumber.format(model.cachedInputTokens)}>{compactNumber.format(model.cachedInputTokens)}</dd>
                                  </div>
                                  <div>
                                    <dt>Output</dt>
                                    <dd title={fullNumber.format(model.outputTokens)}>{compactNumber.format(model.outputTokens)}</dd>
                                  </div>
                                  <div>
                                    <dt>Reasoning</dt>
                                    <dd title={fullNumber.format(model.reasoningTokens)}>{compactNumber.format(model.reasoningTokens)}</dd>
                                  </div>
                                </dl>
                              </div>
                            ))}
                          </div>
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
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function TaskRow({ task, modelName, ongoing = false, attention = false, status, onOpen }) {
  const updatedAt = new Date(task.updatedAt);
  const elapsedMinutes = Math.round((updatedAt.getTime() - Date.now()) / 60_000);
  const relative = Math.abs(elapsedMinutes) < 60
    ? relativeTime.format(elapsedMinutes, 'minute')
    : Math.abs(elapsedMinutes) < 1_440
      ? relativeTime.format(Math.round(elapsedMinutes / 60), 'hour')
      : relativeTime.format(Math.round(elapsedMinutes / 1_440), 'day');

  return (
    <button className="task-row" type="button" onClick={onOpen}>
      <span className={`task-status-dot${ongoing ? ' live' : ''}${attention ? ' attention' : ''}`} />
      <span className="task-copy">
        <strong>{task.title || task.firstPrompt || 'New chat'}</strong>
        <span>{task.projectName} · {modelName || 'No model'}</span>
      </span>
      <span className="task-meta">
        <strong>{status ?? (ongoing ? (task.goal?.status === 'paused' ? 'Paused' : 'Ongoing') : 'Completed')}</strong>
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
