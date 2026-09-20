import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const tabs = [['activation', 'Activation settings'], ['statistics', 'Statistics']];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const number = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const states = { working: 'Working', queued: 'Activation queued', 'outside-window': 'Outside activation hours', sleep: 'Sleeping', disabled: 'Disabled', active: 'Ready' };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

export function BotSettingsPage({ footerTarget }) {
  const [tab, setTab] = useState('activation');
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [days, setDays] = useState(7);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statisticsError, setStatisticsError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(baseline);

  useEffect(() => {
    let active = true;
    window.chatApp.bots.settings().then((value) => {
      if (active) { setDraft(value); setBaseline(value); }
    }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (tab !== 'statistics') return undefined;
    let active = true;
    setLoading(true);
    setStatisticsError('');
    window.chatApp.bots.statistics(days).then((value) => {
      if (active) setStatistics(value);
    }).catch((reason) => {
      if (active) setStatisticsError(reason.message);
    }).finally(() => { if (active) setLoading(false); });
    const timer = setTimeout(() => setRefresh((value) => value + 1), 30_000);
    return () => { active = false; clearTimeout(timer); };
  }, [days, tab, refresh]);

  const maximum = Math.max(1, ...(statistics?.bots ?? []).map((bot) => bot.totals.tokens));
  const maximumTimeline = Math.max(1, ...(statistics?.timeline ?? []).map((bucket) => bucket.tokens));
  const windowDraft = draft?.activationWindow;

  return (
    <div className="maintenance-settings bot-settings-page">
      <div className="maintenance-tabs" role="tablist" aria-label="Bot settings">
        {tabs.map(([id, label], index) => (
          <button key={id} type="button" role="tab" id={`bots-tab-${id}`}
            aria-controls={`bots-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                : event.key === 'ArrowRight' ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
              if (next === null) return;
              event.preventDefault();
              setTab(tabs[next][0]);
              document.getElementById(`bots-tab-${tabs[next][0]}`)?.focus();
            }}
          >{label}</button>
        ))}
      </div>
      <section className="settings-section" role="tabpanel" id="bots-panel-activation"
        aria-labelledby="bots-tab-activation" hidden={tab !== 'activation'}>
        <div className="settings-section-heading">
          <h3>New activations</h3>
          <p>Additional rules for all bots. Existing tasks, replies, resumed work, and work threads continue independently.</p>
        </div>
        {!draft ? <div className="settings-empty">{error || 'Loading activation settings...'}</div> : (
          <div className="settings-section-card settings-row-card">
            <label className="settings-field settings-field-wide">
              <span>Simultaneous activations</span>
              <input type="number" min="1" max="128" step="1" disabled={busy} value={draft.maxConcurrentBots}
                onChange={(event) => { setNotice(''); setDraft({ ...draft, maxConcurrentBots: event.target.value === '' ? '' : Number(event.target.value) }); }} />
              <small>1–128. New activations wait in FIFO order while bot turns occupy the available slots. This never pauses existing work.</small>
            </label>
            <label className="settings-field settings-field-wide">
              <span>Default execution mode</span>
              <select disabled={busy} value={draft.executionMode}
                onChange={(event) => { setNotice(''); setDraft({ ...draft, executionMode: event.target.value }); }}>
                <option value="orchestrator">Orchestrator</option>
                <option value="direct">Direct</option>
              </select>
              <small>Used only when a bot has no individual override.</small>
            </label>
            <label className="settings-toggle-row">
              <span><strong>Global activation window</strong><small>Complements each bot’s schedule, including manual new activations. It does not restrict ongoing work.</small></span>
              <input type="checkbox" className="appearance-desktop-switch" disabled={busy} checked={windowDraft !== null}
                onChange={(event) => { setNotice(''); setDraft({ ...draft, activationWindow: event.target.checked ? { days: [], startMinute: null, endMinute: null } : null }); }} />
            </label>
            {windowDraft && <>
              <div className="settings-field settings-field-wide bot-activation-days" role="group"
                aria-labelledby="bots-active-days-label" aria-describedby="bots-active-days-hint">
                <span id="bots-active-days-label">Active days</span>
                <div className="bot-settings-days">
                  {weekdays.map((day, index) => <button key={day} type="button" disabled={busy}
                    className={`bot-settings-day${windowDraft.days.includes(index) ? ' active' : ''}`} aria-pressed={windowDraft.days.includes(index)}
                    onClick={() => { setNotice(''); setDraft({ ...draft, activationWindow: { ...windowDraft, days: windowDraft.days.includes(index) ? windowDraft.days.filter((value) => value !== index) : [...windowDraft.days, index].sort() } }); }}
                  >{day}</button>)}
                </div>
                <small id="bots-active-days-hint">No selection means every day.</small>
              </div>
              {[['startMinute', 'From'], ['endMinute', 'To']].map(([key, label]) => <label key={key} className="settings-field settings-field-wide">
                <span>{label}</span>
                <input type="time" disabled={busy}
                  value={windowDraft[key] == null ? '' : `${String(Math.floor(windowDraft[key] / 60)).padStart(2, '0')}:${String(windowDraft[key] % 60).padStart(2, '0')}`}
                  onChange={(event) => {
                    const [hours, minutes] = event.target.value.split(':').map(Number);
                    setNotice('');
                    setDraft({ ...draft, activationWindow: { ...windowDraft, [key]: event.target.value ? hours * 60 + minutes : null } });
                  }} />
                <small>{key === 'startMinute' ? 'Local time. Empty times allow the full day.' : 'Overnight ranges are supported. Start and end must differ.'}</small>
              </label>)}
            </>}
          </div>
        )}
      </section>
      <section className="settings-section bot-statistics" role="tabpanel" id="bots-panel-statistics"
        aria-labelledby="bots-tab-statistics" hidden={tab !== 'statistics'} aria-busy={loading}>
        <div className="settings-section-heading">
          <h3>Bot consumption</h3>
          <p>Includes each bot and all descendant threads, including archived threads with retained history.</p>
        </div>
        <div className="maintenance-tabs" role="group" aria-label="Statistics period">
          {[1, 7, 30].map((period) => <button key={period} type="button" aria-pressed={days === period}
            onClick={() => setDays(period)}>{period}d</button>)}
          <button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
        </div>
        {statisticsError && <p className="settings-error" role="alert">{statisticsError}</p>}
        {loading ? <p role="status">Loading statistics...</p> : statistics && <>
          <section className="token-overview" aria-label="Total bot consumption">
            <div className="token-overview-total">
              <span>Total tokens</span><strong>{number.format(statistics.totals.tokens)}</strong>
              <small>{statistics.totals.responses} responses · {statistics.totals.createdThreads} threads created</small>
              <div className="token-overview-cost"><span>Estimated API cost</span>
                <strong>{statistics.totals.cost === null ? 'Unavailable' : money.format(statistics.totals.cost)}</strong>
                <small>{statistics.totals.unpricedResponses} responses without pricing. Not a billing total.</small>
              </div>
            </div>
            <dl className="token-overview-metrics">
              {[['inputTokens', 'Input'], ['cachedInputTokens', 'Cached input'], ['outputTokens', 'Output'], ['reasoningTokens', 'Reasoning']].map(([key, label]) => (
                <div key={key}><dt>{label}</dt><dd>{number.format(statistics.totals[key])}</dd></div>
              ))}
            </dl>
          </section>
          <div className="usage-breakdown-list">
            {statistics.bots.length === 0 && <p className="settings-empty">No bots configured.</p>}
            {statistics.bots.map((bot) => <div className="usage-breakdown-row" key={bot.id}>
              <div className="usage-breakdown-content">
                <div className="usage-breakdown-copy"><strong>{bot.name}</strong>
                  <span>{states[bot.scheduleState] || 'Ready'} · {bot.totals.responses} responses · {bot.totals.createdThreads} new threads</span></div>
                <div className="usage-breakdown-value"><strong>{number.format(bot.totals.tokens)} tokens</strong>
                  <span>{bot.totals.cost === null ? 'Cost unavailable' : money.format(bot.totals.cost)}</span></div>
              </div>
              <span className="usage-breakdown-track" aria-hidden="true"><span style={{ width: `${bot.totals.tokens / maximum * 100}%` }} /></span>
            </div>)}
          </div>
          <div className="settings-section-heading"><h3>Consumption timeline</h3>
            <p>UTC dates of recorded responses, not activation or execution intervals. Older consumption may be absent after history cleanup.</p></div>
          <div className="usage-breakdown-list">
            {statistics.timeline.map((bucket) => <div className="usage-breakdown-row" key={bucket.date}>
              <div className="usage-breakdown-content"><div className="usage-breakdown-copy"><strong>{bucket.date}</strong>
                <span>{bucket.usageMessages} responses</span>
                {bucket.bots.map((bot) => <span key={bot.id}>{bot.name}: {number.format(bot.tokens)} tokens · {bot.cost === null ? 'cost unavailable' : money.format(bot.cost)}</span>)}
                </div><div className="usage-breakdown-value"><strong>{number.format(bucket.tokens)} tokens</strong></div></div>
              <span className="usage-breakdown-track" aria-hidden="true"><span style={{ width: `${bucket.tokens / maximumTimeline * 100}%` }} /></span>
            </div>)}
          </div>
        </>}
      </section>
      {footerTarget && draft && createPortal(<>
        <span className="settings-error" role={error ? 'alert' : 'status'}>{error || notice || (dirty ? 'Unsaved activation settings' : '')}</span>
        <div><button type="button" className="primary-mini" disabled={busy || !dirty}
          onClick={async () => {
            setBusy(true); setError(''); setNotice('');
            try {
              const saved = await window.chatApp.bots.saveSettings(draft);
              setDraft(saved); setBaseline(saved); setNotice('Activation settings saved.');
            } catch (reason) { setError(reason.message); setTab('activation'); }
            finally { setBusy(false); }
          }}>{busy ? 'Saving...' : 'Save changes'}</button></div>
      </>, footerTarget)}
    </div>
  );
}
