import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FolderClock,
  Layers3,
  Inbox,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPrice } from '../lib/format.js';
import Avatar from 'boring-avatars';
import { hasOpenBotUserAction } from '../../shared/bot-work-items.js';

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
const USAGE_TYPE_LABELS = Object.freeze({
  subagent: 'Sub-agent',
  bot: 'Bot',
  inference: 'Inference',
  auxiliary: 'Auxiliary',
  supervision: 'Supervision',
});
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
const getScaleMaximum = (maximum) => {
  if (maximum <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalizedMaximum = maximum / magnitude;
  const scaleFactor = normalizedMaximum <= 1
    ? 1
    : normalizedMaximum <= 2
      ? 2
      : normalizedMaximum <= 5
        ? 5
        : 10;
  return scaleFactor * magnitude;
};
const drawCurve = (points, firstCommand) => points.reduce((path, point, index) => {
  if (index === 0) return `${firstCommand}${point.x},${point.y}`;
  const previous = points[index - 1];
  const middleX = (previous.x + point.x) / 2;
  return `${path} C${middleX},${previous.y} ${middleX},${point.y} ${point.x},${point.y}`;
}, '');
const toLocalInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function OrchestrationPage({ models, onOpenThread, bots = [], botDataByBot = {}, botsLoading = false, onRefreshBots, onOpenBotPendency }) {
  const initialFrom = new Date();
  initialFrom.setDate(1);
  initialFrom.setHours(0, 0, 0, 0);
  const [activeTab, setActiveTab] = useState('inbox');
  const [inboxQuery, setInboxQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState('all');
  const inboxRows = bots.flatMap((bot) => (botDataByBot[bot.id]?.inbox ?? []).map((pendency) => ({ bot, pendency })))
    .sort((left, right) => new Date(right.pendency.updatedAt) - new Date(left.pendency.updatedAt));
  const query = inboxQuery.trim().toLowerCase();
  const filteredInbox = inboxRows.filter(({ bot, pendency }) => (
    (inboxFilter === 'all' || (inboxFilter === 'needs-user' ? hasOpenBotUserAction(pendency) : pendency.status === inboxFilter))
    && (!query || `${bot.name} ${pendency.title} ${pendency.messages.map((message) => message.content).join(' ')}`.toLowerCase().includes(query))
  ));
  const inboxErrors = bots.flatMap((bot) => {
    const state = botDataByBot[bot.id];
    const message = state?.errors ? state.errors.inbox : state?.error;
    return message ? [{ bot, message }] : [];
  });
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState(() => ({
    from: toLocalInput(initialFrom),
    to: toLocalInput(new Date()),
    label: 'This month',
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
  const usageByType = (overview?.metrics.usageByType ?? []).toSorted((a, b) => b.tokens - a.tokens);
  const usageByProject = (overview?.metrics.usageByProject ?? []).toSorted((a, b) => b.tokens - a.tokens);
  const maximumTypeUsage = usageByType[0]?.tokens ?? 0;
  const maximumProjectUsage = usageByProject[0]?.tokens ?? 0;

  const modelUsageGroups = useMemo(() => {
    const groups = new Map();
    for (const usage of overview?.metrics.topModels ?? []) {
      const catalogModel = modelsById.get(usage.id);
      const providerId = catalogModel?.providerId ?? 'unknown';
      const group = groups.get(providerId) ?? {
        id: providerId,
        name: catalogModel?.providerName ?? 'Unknown provider',
        tokens: 0,
        cost: 0,
        pricedResponses: 0,
        models: [],
      };
      group.tokens += usage.tokens;
      group.cost += usage.cost;
      group.pricedResponses += usage.pricedMessages;
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
    const dailyTotals = days.map((_, dayIndex) => providersWithUsage.reduce(
      (total, provider) => total + provider.values[dayIndex],
      0,
    ));
    const maximum = Math.max(0, ...dailyTotals);
    const scaleMaximum = getScaleMaximum(maximum);

    const series = providersWithUsage.map((provider, providerIndex) => ({
      ...provider,
      color: TOKEN_CHART_COLORS[providerIndex % TOKEN_CHART_COLORS.length],
    }));
    const slotWidth = TOKEN_CHART_WIDTH / Math.max(days.length, 1);
    const barWidth = Math.min(46, slotWidth * 0.72);
    const bars = days.map((date, dayIndex) => {
      let cumulativeTokens = 0;
      const nonEmptyProviders = series.filter((provider) => provider.values[dayIndex] > 0);
      return {
        date,
        x: slotWidth * dayIndex + (slotWidth - barWidth) / 2,
        segments: nonEmptyProviders.map((provider, segmentIndex) => {
          const tokens = provider.values[dayIndex];
          const yBottom = TOKEN_CHART_TOP + (1 - (cumulativeTokens / scaleMaximum))
            * (TOKEN_CHART_BOTTOM - TOKEN_CHART_TOP);
          cumulativeTokens += tokens;
          const yTop = TOKEN_CHART_TOP + (1 - (cumulativeTokens / scaleMaximum))
            * (TOKEN_CHART_BOTTOM - TOKEN_CHART_TOP);
          return {
            color: provider.color,
            height: yBottom - yTop,
            id: provider.id,
            name: provider.name,
            rounded: segmentIndex === nonEmptyProviders.length - 1,
            tokens,
            y: yTop,
          };
        }),
      };
    });
    const yTicks = scaleMaximum > 0
      ? [scaleMaximum, 0].map((value, index) => ({
        value,
        y: index === 0 ? TOKEN_CHART_TOP : TOKEN_CHART_BOTTOM,
      }))
      : [];
    const dateTickIndexes = days.length > 1 ? [0, days.length - 1] : days.length ? [0] : [];
    const dateTicks = dateTickIndexes.map((dayIndex) => ({
      align: days.length === 1 ? 'center' : dayIndex === 0 ? 'start' : 'end',
      date: days[dayIndex],
      label: dateLabel.format(days[dayIndex]),
      x: days.length === 1 ? 50 : dayIndex === 0 ? 0 : 100,
    }));

    return { bars, barWidth, dateTicks, maximum, series, yTicks };
  }, [modelUsageGroups, modelsById, overview?.metrics.dailyTokens, range.from, range.to]);

  const modelTokenChart = useMemo(() => {
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

    const modelsWithUsage = new Map((overview?.metrics.topModels ?? []).map((model) => [model.id, {
      id: model.id,
      name: modelsById.get(model.id)?.name ?? model.id,
      tokens: 0,
      values: Array(days.length).fill(0),
    }]));
    for (const dailyUsage of overview?.metrics.dailyTokens ?? []) {
      const dayIndex = dayIndexes.get(Number(dailyUsage.date));
      if (dayIndex === undefined) continue;

      for (const usage of dailyUsage.models ?? []) {
        const model = modelsWithUsage.get(usage.id) ?? {
          id: usage.id,
          name: modelsById.get(usage.id)?.name ?? usage.id,
          tokens: 0,
          values: Array(days.length).fill(0),
        };
        const tokens = Number(usage.tokens) || 0;
        model.tokens += tokens;
        model.values[dayIndex] += tokens;
        modelsWithUsage.set(usage.id, model);
      }
    }

    const chartModels = [...modelsWithUsage.values()]
      .filter((model) => model.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);
    const dailyTotals = days.map((_, dayIndex) => chartModels.reduce(
      (total, model) => total + model.values[dayIndex],
      0,
    ));
    const maximum = Math.max(0, ...dailyTotals);
    const scaleMaximum = getScaleMaximum(maximum);
    const cumulativeValues = Array(days.length).fill(0);
    const series = chartModels.map((model, modelIndex) => {
      const lowerValues = [...cumulativeValues];
      const upperValues = model.values.map((tokens, dayIndex) => {
        cumulativeValues[dayIndex] += tokens;
        return cumulativeValues[dayIndex];
      });
      const xPositions = days.length === 1 ? [0, TOKEN_CHART_WIDTH] : days.map(
        (_, dayIndex) => (dayIndex / (days.length - 1)) * TOKEN_CHART_WIDTH,
      );
      const lowerPoints = xPositions.map((x, pointIndex) => ({
        x,
        y: TOKEN_CHART_TOP + (1 - (lowerValues[Math.min(pointIndex, lowerValues.length - 1)] / scaleMaximum))
          * (TOKEN_CHART_BOTTOM - TOKEN_CHART_TOP),
      }));
      const upperPoints = xPositions.map((x, pointIndex) => ({
        x,
        y: TOKEN_CHART_TOP + (1 - (upperValues[Math.min(pointIndex, upperValues.length - 1)] / scaleMaximum))
          * (TOKEN_CHART_BOTTOM - TOKEN_CHART_TOP),
      }));
      return {
        ...model,
        color: TOKEN_CHART_COLORS[modelIndex % TOKEN_CHART_COLORS.length],
        path: `${drawCurve(upperPoints, 'M')} ${drawCurve(lowerPoints.toReversed(), 'L')} Z`,
      };
    });
    const yTicks = scaleMaximum > 0
      ? [scaleMaximum, scaleMaximum / 2, 0].map((value, index) => ({
        value,
        y: TOKEN_CHART_TOP + ((TOKEN_CHART_BOTTOM - TOKEN_CHART_TOP) * index) / 2,
      }))
      : [];
    const tickCount = Math.min(6, days.length);
    const dateTickIndexes = [...new Set(Array.from({ length: tickCount }, (_, index) => (
      tickCount === 1 ? 0 : Math.round((index / (tickCount - 1)) * (days.length - 1))
    )))];
    const dateTicks = dateTickIndexes.map((dayIndex) => ({
      align: dayIndex === 0 ? 'start' : dayIndex === days.length - 1 ? 'end' : 'center',
      date: days[dayIndex],
      label: dateLabel.format(days[dayIndex]),
      x: days.length === 1 ? 50 : (dayIndex / (days.length - 1)) * 100,
    }));

    return { dateTicks, maximum, series, yTicks };
  }, [modelsById, overview?.metrics.dailyTokens, overview?.metrics.topModels, range.from, range.to]);

  return (
    <main className="orchestration-page">
      <header className="orchestration-header" ref={rangePickerRef}>
        <div>
          <span className="orchestration-eyebrow">Operational overview</span>
          <h1>Overview</h1>
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
          disabled={activeTab === 'inbox' ? botsLoading : loading}
          onClick={() => activeTab === 'inbox' ? onRefreshBots?.() : loadOverview()}
        >
          <RefreshCw size={15} className={(activeTab === 'inbox' ? botsLoading : loading) ? 'spinning' : undefined} />
          Refresh
        </button>
      </header>

      <div className="orchestration-tabs" role="tablist" aria-label="Overview views">
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
        <button type="button" role="tab" aria-selected={activeTab === 'inbox'} onClick={() => { setActiveTab('inbox'); setRangeOpen(false); }}>
          Inbox · {inboxRows.filter(({ pendency }) => hasOpenBotUserAction(pendency)).length}
        </button>
      </div>

      {activeTab === 'inbox' ? (
        <section className="orchestration-inbox" aria-label="All bots Inbox">
          <div className="orchestration-inbox-filters">
            <label><span>Search Inbox</span><input type="search" placeholder="Search bots and messages" value={inboxQuery} onChange={(event) => setInboxQuery(event.target.value)} /></label>
            <label><span>Status</span><select value={inboxFilter} onChange={(event) => setInboxFilter(event.target.value)}><option value="all">All messages</option><option value="needs-user">Needs you</option><option value="open">Open</option><option value="completed">Completed</option></select></label>
          </div>
          {inboxErrors.map(({ bot, message }) => (
            <div className="orchestration-error" role="alert" key={bot.id}>Couldn't load Inbox for {bot.name}.<details><summary>Technical details</summary>{message}</details></div>
          ))}
          {botsLoading && <p role="status">Loading bots...</p>}
          <div className="orchestration-inbox-list">
            {filteredInbox.map(({ bot, pendency }, index) => {
              const updated = new Date(pendency.updatedAt);
              const day = updated.toLocaleDateString();
              const previousDay = index ? new Date(filteredInbox[index - 1].pendency.updatedAt).toLocaleDateString() : null;
              const today = new Date();
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const latest = pendency.messages.at(-1);
              const needsUser = hasOpenBotUserAction(pendency);
              const status = pendency.status === 'completed' ? 'Completed' : needsUser ? 'Needs you' : 'Waiting for bot';
              return (
                <div key={`${bot.id}:${pendency.id}`}>
                  {day !== previousDay && <h2>{day === today.toLocaleDateString() ? 'Today' : day === yesterday.toLocaleDateString() ? 'Yesterday' : updated.toLocaleDateString(undefined, { dateStyle: 'long' })}</h2>}
                  <button type="button" className={`orchestration-inbox-row${needsUser ? ' needs-user' : ''}`} onClick={() => onOpenBotPendency(bot.id, pendency.id)}>
                    <span className="orchestration-inbox-dot" aria-label={status} title={status} />
                    <Avatar size={30} name={bot.iconSeed || bot.id} variant="beam" />
                    <strong className="orchestration-inbox-sender">{bot.name}</strong>
                    <span className="orchestration-inbox-copy"><strong>{pendency.title}</strong><span>{latest?.role === 'user' ? 'You: ' : ''}{latest?.content || 'Attachment'}</span></span>
                    {pendency.messages.some((message) => message.attachments?.length) && <Paperclip size={14} aria-label="Has attachments" />}
                    <time dateTime={pendency.updatedAt} title={`${updated.toLocaleString()} · ${status}`}>{day === today.toLocaleDateString() ? updated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : dateLabel.format(updated)}</time>
                  </button>
                </div>
              );
            })}
          </div>
          {!botsLoading && !filteredInbox.length && <EmptyState icon={<Inbox size={20} />} text={inboxRows.length ? 'No messages match your search.' : inboxErrors.length ? 'No messages available from the other bots.' : 'Your Inbox is empty. Messages from all bots will appear here.'} />}
        </section>
      ) : error ? (
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
                <div className="token-overview-cost">
                  <span>API cost</span>
                  <strong>
                    {overview?.metrics.pricedResponses ? formatPrice(overview.metrics.cost) : '—'}
                  </strong>
                  <small>
                    {fullNumber.format(overview?.metrics.pricedResponses ?? 0)} of {fullNumber.format(overview?.metrics.responses ?? 0)} responses priced
                  </small>
                </div>
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
                <div className="usage-breakdown-grid">
                  <section className="orchestration-section usage-breakdown-section">
                    <div className="orchestration-section-heading">
                      <div>
                        <span className="section-icon"><Layers3 size={16} /></span>
                        <div className="daily-token-title">
                          <h2>Usage Type</h2>
                          <span>Consumption by inference type</span>
                        </div>
                      </div>
                    </div>
                    <div className="usage-breakdown-list">
                      {usageByType.map((usage) => (
                        <div className="usage-breakdown-row" key={usage.id}>
                          <div className="usage-breakdown-content">
                            <div className="usage-breakdown-copy">
                              <strong>{USAGE_TYPE_LABELS[usage.id] ?? usage.id}</strong>
                              <span>{usage.responses} {usage.responses === 1 ? 'response' : 'responses'}</span>
                            </div>
                            <div className="usage-breakdown-value">
                              <strong title={`${fullNumber.format(usage.tokens)} tokens`}>
                                {compactNumber.format(usage.tokens)}
                              </strong>
                              <span>
                                {overview?.metrics.tokens
                                  ? `${((usage.tokens / overview.metrics.tokens) * 100).toFixed(1)}%`
                                  : '0%'}
                              </span>
                            </div>
                          </div>
                          <span className="usage-breakdown-track" aria-hidden="true">
                            <span style={{ width: `${maximumTypeUsage ? (usage.tokens / maximumTypeUsage) * 100 : 0}%` }} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="orchestration-section usage-breakdown-section">
                    <div className="orchestration-section-heading">
                      <div>
                        <span className="section-icon"><FolderClock size={16} /></span>
                        <div className="daily-token-title">
                          <h2>Usage by project</h2>
                          <span>Five most recently used folders</span>
                        </div>
                      </div>
                    </div>
                    <div className="usage-breakdown-list">
                      {usageByProject.length
                        ? usageByProject.map((project) => (
                          <div className="usage-breakdown-row" key={project.path}>
                            <div className="usage-breakdown-content">
                              <div className="usage-breakdown-copy">
                                <strong title={project.displayPath}>{project.name}</strong>
                                <span title={project.displayPath}>{project.displayPath}</span>
                              </div>
                              <div className="usage-breakdown-value">
                                <strong title={`${fullNumber.format(project.tokens)} tokens`}>
                                  {compactNumber.format(project.tokens)}
                                </strong>
                                <span>{project.responses} {project.responses === 1 ? 'response' : 'responses'}</span>
                              </div>
                            </div>
                            <span className="usage-breakdown-track" aria-hidden="true">
                              <span style={{ width: `${maximumProjectUsage ? (project.tokens / maximumProjectUsage) * 100 : 0}%` }} />
                            </span>
                          </div>
                        ))
                        : (
                          <EmptyState
                            icon={<FolderClock size={18} />}
                            text={loading ? 'Loading projects...' : `No project usage during ${rangeCaption.toLowerCase()}.`}
                          />
                        )}
                    </div>
                  </section>
                </div>

                <section className="orchestration-section daily-token-section">
                  <div className="orchestration-section-heading daily-token-heading">
                    <div>
                      <span className="section-icon"><Activity size={16} /></span>
                      <div className="daily-token-title">
                        <h2>Daily tokens</h2>
                        <span>Token volume by provider</span>
                      </div>
                    </div>
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
                              {dailyTokenChart.bars.map((bar) => (
                                <g className="daily-token-bar" key={bar.date}>
                                  {bar.segments.map((segment) => (
                                    <rect
                                      fill={segment.color}
                                      height={segment.height}
                                      key={segment.id}
                                      rx={segment.rounded ? 4 : 0}
                                      width={dailyTokenChart.barWidth}
                                      x={bar.x}
                                      y={segment.y}
                                    >
                                      <title>
                                        {dateLabel.format(bar.date)} · {segment.name}: {fullNumber.format(segment.tokens)} tokens
                                      </title>
                                    </rect>
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
                  {modelTokenChart.maximum > 0 && (
                    <div
                      className="model-token-chart"
                      role="img"
                      aria-label={`${rangeCaption} token usage by model. ${modelTokenChart.series
                        .map((model) => `${model.name}: ${fullNumber.format(model.tokens)} tokens`)
                        .join(', ')}`}
                    >
                      <div className="model-token-chart-layout">
                        <div className="model-token-y-axis" aria-hidden="true">
                          {modelTokenChart.yTicks.map((tick) => (
                            <span
                              key={tick.value}
                              style={{ top: `${(tick.y / TOKEN_CHART_HEIGHT) * 100}%` }}
                            >
                              {compactNumber.format(tick.value)}
                            </span>
                          ))}
                        </div>
                        <div className="model-token-plot">
                          <svg
                            viewBox={`0 0 ${TOKEN_CHART_WIDTH} ${TOKEN_CHART_HEIGHT}`}
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <g className="model-token-grid">
                              {modelTokenChart.yTicks.map((tick) => (
                                <line
                                  key={tick.value}
                                  x1="0"
                                  x2={TOKEN_CHART_WIDTH}
                                  y1={tick.y}
                                  y2={tick.y}
                                />
                              ))}
                            </g>
                            {modelTokenChart.series.map((model) => (
                              <path fill={model.color} d={model.path} key={model.id}>
                                <title>{`${model.name}: ${fullNumber.format(model.tokens)} tokens`}</title>
                              </path>
                            ))}
                          </svg>
                          <div className="model-token-x-axis" aria-hidden="true">
                            {modelTokenChart.dateTicks.map((tick) => (
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
                        <div className="model-token-legend" aria-hidden="true">
                          {modelTokenChart.series.map((model) => (
                            <span className="model-token-legend-item" key={model.id}>
                              <i
                                className="model-token-legend-dot"
                                style={{ '--chart-color': model.color }}
                              />
                              <span>{model.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
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
                                <span>
                                  {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'} · {provider.pricedResponses ? formatPrice(provider.cost) : 'cost unavailable'}
                                </span>
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
                                  <span>{model.messages} {model.messages === 1 ? 'response' : 'responses'} · {model.pricedMessages ? formatPrice(model.cost) : 'cost unavailable'}</span>
                                  <span className="provider-model-pricing">
                                    {model.pricing
                                      ? `in ${formatPrice(model.pricing.inputPerMillionTokens)} · cache ${formatPrice(model.pricing.cachedInputPerMillionTokens)} · out ${formatPrice(model.pricing.outputPerMillionTokens)} / 1M`
                                      : 'API pricing unavailable'}
                                  </span>
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
