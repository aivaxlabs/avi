import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarClock,
  ExternalLink,
  FolderOpen,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { nextCronOccurrence, parseCron } from '../../shared/cron.js';
import {
  cronToSchedule,
  defaultSchedule,
  describeCron,
  minuteIntervals,
  scheduleModes,
  scheduleToCron,
  weekdayLabels,
} from '../lib/cron-schedule.js';
import { classNames, formatMetricDuration } from '../lib/format.js';
import { LongTextField } from './LongTextField.jsx';
import { MarkdownSegment } from './Message.jsx';

const tabs = [['tasks', 'Tasks'], ['jobs', 'Recurring jobs']];
const statusLabels = {
  scheduled: 'Scheduled',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const permissionLabels = { approve_for_me: 'Approve for me', full_access: 'Full access' };
const relativeTime = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const fullNumber = new Intl.NumberFormat('en-US');
const timeUnits = [['year', 31_536e6], ['month', 2_592e6], ['week', 6_048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];

const errorText = (reason) => (reason instanceof Error ? reason.message : String(reason));
const folderName = (path) => String(path ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? path;
const scheduler = () => window.chatApp.taskScheduler;

function TimeLabel({ value, now, empty = 'never' }) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return empty;
  const difference = date.getTime() - now;
  const [unit, size] = timeUnits.find(([, length]) => Math.abs(difference) >= length) ?? ['minute', 6e4];
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()}>
      {relativeTime.format(Math.round(difference / size), unit)}
    </time>
  );
}

function StatusBadge({ status }) {
  return <span className="scheduled-jobs-status" data-status={status}>{statusLabels[status] ?? status}</span>;
}

function PageHeader({ title, description, onBack, children }) {
  return (
    <header className="settings-page-header">
      <div>
        {onBack && (
          <button className="settings-inline-back" type="button" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
        )}
        <div className="settings-page-title-row">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {children && <div className="scheduled-jobs-header-actions">{children}</div>}
        </div>
      </div>
    </header>
  );
}

function TaskRow({ task, now, jobTitle, modelName, onOpen }) {
  const when = task.status === 'scheduled'
    ? ['Runs', task.runAt]
    : task.status === 'running'
      ? ['Started', task.startedAt ?? task.runAt]
      : [statusLabels[task.status], task.finishedAt ?? task.updatedAt];

  return (
    <article className="settings-entity-row">
      <button className="settings-entity-main" type="button" onClick={onOpen}>
        <span className="settings-entity-icon">
          {task.recurringJobId ? <Repeat size={16} aria-hidden="true" /> : <CalendarClock size={16} aria-hidden="true" />}
        </span>
        <span className="settings-entity-copy">
          <strong>{task.title || 'Untitled task'}</strong>
          <small>
            {when[0]} <TimeLabel value={when[1]} now={now} />
            {' · '}{folderName(task.folderPath)}
            {' · '}{modelName(task.model)}
            {task.recurringJobId && ` · From ${jobTitle ?? 'a recurring job'}`}
          </small>
        </span>
        <StatusBadge status={task.status} />
        <ArrowRight className="settings-entity-arrow" size={15} aria-hidden="true" />
      </button>
    </article>
  );
}

function runDraft(source, defaults) {
  return {
    title: source?.title ?? '',
    instruction: source?.instruction ?? '',
    folderPath: source?.folderPath ?? defaults.folderPath,
    model: source?.model ?? defaults.model,
    reasoningEffort: source?.reasoningEffort ?? '',
    permissionMode: source?.permissionMode === 'full_access' ? 'full_access' : 'approve_for_me',
  };
}

function runInput(draft) {
  return {
    title: draft.title.trim() || undefined,
    instruction: draft.instruction,
    folderPath: draft.folderPath,
    model: draft.model,
    reasoningEffort: draft.reasoningEffort || null,
    permissionMode: draft.permissionMode,
  };
}

function runValidation(draft) {
  if (!draft.instruction.trim()) return 'Add an instruction to save.';
  if (!draft.folderPath) return 'Choose a folder to save.';
  if (!draft.model) return 'Choose a model to save.';
  return '';
}

function RunFields({ draft, update, models, folders, disabled }) {
  const [browseError, setBrowseError] = useState('');
  const selectedModel = models.find((model) => model.id === draft.model) ?? null;
  const folderOptions = folders.some((folder) => folder.path === draft.folderPath) || !draft.folderPath
    ? folders
    : [{ path: draft.folderPath, name: folderName(draft.folderPath) }, ...folders];
  const modelGroups = useMemo(() => {
    const groups = new Map();
    for (const model of models) {
      if (!groups.has(model.providerId)) groups.set(model.providerId, { id: model.providerId, name: model.providerName, models: [] });
      groups.get(model.providerId).models.push(model);
    }
    return [...groups.values()];
  }, [models]);

  async function browse() {
    setBrowseError('');
    try {
      const folder = await window.chatApp.projects.select({ defaultPath: draft.folderPath });
      if (folder?.path) update({ folderPath: folder.path });
    } catch (reason) {
      setBrowseError(errorText(reason));
    }
  }

  return (
    <fieldset className="settings-section-card settings-form settings-row-card scheduled-jobs-fieldset" aria-label="Run settings" disabled={disabled}>
      <label className="settings-field">
        <span>Title</span>
        <small>Optional. Generated from the instruction when empty.</small>
        <input className="input" type="text" value={draft.title} maxLength={120}
          onChange={(event) => update({ title: event.target.value })} />
      </label>
      <div className="settings-field">
        <span>Instruction</span>
        <small id="scheduled-instruction-help">The prompt sent to the agent when the run starts.</small>
        <LongTextField label="Instruction" value={draft.instruction} invalid={!draft.instruction.trim()}
          describedBy="scheduled-instruction-help" onChange={(instruction) => update({ instruction })} />
      </div>
      <div className="settings-field">
        <span>Folder</span>
        <small>{browseError || 'Project instructions, context, and MCP servers come from this folder.'}</small>
        <div className="scheduled-jobs-field-control">
          <select className="select" aria-label="Folder" value={draft.folderPath}
            onChange={(event) => update({ folderPath: event.target.value })}>
            {!draft.folderPath && <option value="">Choose a folder</option>}
            {folderOptions.map((folder) => (
              <option key={folder.path} value={folder.path} title={folder.path}>{folder.name || folder.path}</option>
            ))}
          </select>
          <button className="button" type="button" onClick={() => void browse()}>
            <FolderOpen size={14} aria-hidden="true" />
            Browse
          </button>
        </div>
      </div>
      <label className="settings-field">
        <span>Model</span>
        <select className="select" value={draft.model}
          onChange={(event) => update({ model: event.target.value, reasoningEffort: '' })}>
          {!selectedModel && <option value={draft.model}>{draft.model || 'Choose a model'}</option>}
          {modelGroups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {selectedModel?.reasoning?.length > 0 && (
        <label className="settings-field">
          <span>Reasoning effort</span>
          <select className="select" value={draft.reasoningEffort}
            onChange={(event) => update({ reasoningEffort: event.target.value })}>
            <option value="">Default</option>
            {selectedModel.reasoning.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select>
        </label>
      )}
      <label className="settings-field">
        <span>Permission</span>
        <small>Full access skips tool approvals, including destructive actions.</small>
        <select className="select" value={draft.permissionMode}
          onChange={(event) => update({ permissionMode: event.target.value })}>
          {Object.entries(permissionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
    </fieldset>
  );
}

function EditorFooter({ status, error, saving, canSave, label, onCancel, onSave }) {
  return (
    <footer className="settings-actions">
      <span className="settings-error" role={error ? 'alert' : 'status'}>{error || status}</span>
      <div>
        <button className="button" type="button" disabled={saving} onClick={onCancel}>Cancel</button>
        <button className="button primary" type="button" disabled={saving || !canSave} onClick={onSave}>
          <Save size={14} aria-hidden="true" />
          {saving ? 'Saving...' : label}
        </button>
      </div>
    </footer>
  );
}

function TaskEditor({ models, folders, defaults, onClose, onCreated }) {
  const [draft, setDraft] = useState(() => ({ ...runDraft(null, defaults), when: 'now', runAt: '' }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (changes) => {
    setError('');
    setDraft((current) => ({ ...current, ...changes }));
  };
  const runAt = draft.when === 'later' && draft.runAt ? new Date(draft.runAt) : null;
  const validation = runValidation(draft)
    || (draft.when === 'later' && !(runAt?.getTime() > Date.now()) ? 'Choose a future date and time to save.' : '');

  async function save() {
    setSaving(true);
    setError('');
    try {
      const task = await scheduler().scheduleTask({
        ...runInput(draft),
        ...(runAt ? { runAt: runAt.toISOString() } : {}),
      });
      onCreated(task);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="New task" description="Run an instruction once, now or at a chosen time." onBack={onClose} />
      <div className="settings-content">
        <div className="settings-content-inner scheduled-jobs-editor">
          <RunFields draft={draft} update={update} models={models} folders={folders} disabled={saving} />
          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>When</h3>
              <p>Tasks run in a new thread; the app must be open at the scheduled time.</p>
            </div>
            <fieldset className="settings-section-card settings-form settings-row-card scheduled-jobs-fieldset" aria-label="When" disabled={saving}>
              <label className="settings-field">
                <span>Start</span>
                <select className="select" value={draft.when} onChange={(event) => update({ when: event.target.value })}>
                  <option value="now">Now</option>
                  <option value="later">At a date and time</option>
                </select>
              </label>
              {draft.when === 'later' && (
                <label className="settings-field">
                  <span>Date and time</span>
                  <small>Local time.</small>
                  <input className="input" type="datetime-local" value={draft.runAt}
                    aria-invalid={Boolean(draft.runAt) && !(runAt?.getTime() > Date.now())}
                    onChange={(event) => update({ runAt: event.target.value })} />
                </label>
              )}
            </fieldset>
          </section>
        </div>
      </div>
      <EditorFooter status={validation} error={error} saving={saving} canSave={!validation}
        label={draft.when === 'now' ? 'Run now' : 'Schedule task'} onCancel={onClose} onSave={() => void save()} />
    </>
  );
}

function ScheduleFields({ schedule, onChange, preview, disabled }) {
  const update = (changes) => onChange({ ...schedule, ...changes });
  const timeField = (
    <label className="settings-field">
      <span>Time</span>
      <small>Local time.</small>
      <input className="input" type="time" value={schedule.time} onChange={(event) => update({ time: event.target.value })} />
    </label>
  );

  return (
    <fieldset className="settings-section-card settings-form settings-row-card scheduled-jobs-fieldset" aria-label="Schedule" disabled={disabled}>
      <label className="settings-field">
        <span>Repeat</span>
        <select className="select" value={schedule.mode}
          onChange={(event) => update({ mode: event.target.value, cron: preview.cron || schedule.cron })}>
          {scheduleModes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {schedule.mode === 'minutes' && (
        <label className="settings-field">
          <span>Interval</span>
          <select className="select" value={schedule.interval} onChange={(event) => update({ interval: Number(event.target.value) })}>
            {minuteIntervals.map((value) => <option key={value} value={value}>Every {value === 1 ? 'minute' : `${value} minutes`}</option>)}
          </select>
        </label>
      )}
      {schedule.mode === 'hourly' && (
        <label className="settings-field">
          <span>Minute</span>
          <small>Minute past each hour, 0 to 59.</small>
          <input className="input" type="number" min={0} max={59} value={schedule.minute}
            onChange={(event) => update({ minute: event.target.value })} />
        </label>
      )}
      {schedule.mode === 'weekly' && (
        <div className="settings-field">
          <span>Days</span>
          <div className="maintenance-tabs scheduled-jobs-field-control" role="group" aria-label="Weekdays">
            {weekdayLabels.map((label, day) => (
              <button key={label} type="button" aria-pressed={schedule.weekdays.includes(day)}
                onClick={() => update({
                  weekdays: schedule.weekdays.includes(day)
                    ? schedule.weekdays.filter((value) => value !== day)
                    : [...schedule.weekdays, day],
                })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {schedule.mode === 'monthly' && (
        <label className="settings-field">
          <span>Day of month</span>
          <small>Months without this day are skipped.</small>
          <input className="input" type="number" min={1} max={31} value={schedule.day}
            onChange={(event) => update({ day: event.target.value })} />
        </label>
      )}
      {['daily', 'weekly', 'monthly'].includes(schedule.mode) && timeField}
      {schedule.mode === 'advanced' && (
        <label className="settings-field">
          <span>Cron expression</span>
          <small>Five fields: minute hour day-of-month month day-of-week.</small>
          <input className="input" type="text" value={schedule.cron} spellCheck={false} placeholder="0 9 * * 1-5"
            aria-invalid={Boolean(preview.error)} aria-describedby="scheduled-cron-preview"
            onChange={(event) => update({ cron: event.target.value })} />
        </label>
      )}
      <div className="settings-card-row scheduled-jobs-preview" id="scheduled-cron-preview" aria-live="polite">
        {preview.error ? (
          <p className="scheduled-jobs-preview-error" role="alert">{preview.error}</p>
        ) : (
          <>
            <span>
              <strong>Next runs</strong>
              <code>{preview.cron}</code>
            </span>
            <ol>
              {preview.next.length
                ? preview.next.map((date) => <li key={date.getTime()}>{date.toLocaleString()}</li>)
                : <li>{preview.endsAt ? 'No runs before the end date.' : 'No upcoming runs in the next five years.'}</li>}
            </ol>
          </>
        )}
      </div>
    </fieldset>
  );
}

function JobEditor({ id, models, folders, defaults, now, refreshKey, modelName, onClose, onSaved, onOpenTask }) {
  const [job, setJob] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState(() => (id ? null : { ...runDraft(null, defaults), enabled: true, schedule: defaultSchedule, endsAt: '' }));
  const [baseline, setBaseline] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!id) return undefined;
    let active = true;
    (async () => {
      try {
        const value = await scheduler().viewRecurringJob(id);
        if (!active) return;
        setJob(value);
        setLoadError('');
        const endsAt = value.endsAt ? new Date(value.endsAt) : null;
        const initial = {
          ...runDraft(value, defaults),
          enabled: value.enabled,
          schedule: cronToSchedule(value.cron),
          endsAt: endsAt ? new Date(endsAt.getTime() - endsAt.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '',
        };
        setDraft((current) => current ?? initial);
        setBaseline((current) => current ?? initial);
      } catch (reason) {
        if (active) setLoadError(errorText(reason));
      }
    })();
    return () => { active = false; };
  }, [defaults, id, refreshKey]);

  const preview = useMemo(() => {
    if (!draft) return { cron: '', next: [], error: '' };
    try {
      const cron = scheduleToCron(draft.schedule);
      parseCron(cron);
      const endsAt = draft.endsAt ? new Date(draft.endsAt) : null;
      const next = [];
      let from = new Date();
      while (next.length < 3) {
        const date = nextCronOccurrence(cron, from);
        if (!date || (endsAt && date > endsAt)) break;
        next.push(date);
        from = date;
      }
      return { cron, next, endsAt, error: '' };
    } catch (reason) {
      return { cron: '', next: [], error: errorText(reason) };
    }
  }, [draft]);

  if (!draft) {
    return (
      <>
        <PageHeader title="Recurring job" description="Loading job settings." onBack={onClose} />
        <div className="settings-content">
          <div className="settings-content-inner">
            {loadError
              ? <p className="settings-context-error" role="alert">{loadError}</p>
              : <p className="settings-empty" role="status">Loading recurring job...</p>}
          </div>
        </div>
      </>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const endsAtInvalid = Boolean(draft.endsAt) && draft.endsAt !== baseline?.endsAt
    && !(new Date(draft.endsAt).getTime() > Date.now());
  const validation = runValidation(draft)
    || (preview.error ? 'Fix the schedule to save.' : '')
    || (endsAtInvalid ? 'Choose a future end date to save.' : '');
  const update = (changes) => {
    setError('');
    setNotice('');
    setDraft((current) => ({ ...current, ...changes }));
  };
  const leave = () => {
    if (dirty && !window.confirm('Discard unsaved changes to this recurring job?')) return;
    onClose();
  };

  async function save() {
    setSaving(true);
    setError('');
    const input = {
      ...runInput(draft),
      cron: preview.cron,
      enabled: draft.enabled,
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
    };
    try {
      if (id) {
        const saved = await scheduler().updateRecurringJob({ id, changes: input });
        setJob((current) => ({ ...current, ...saved }));
        setBaseline(draft);
        setNotice('Saved');
      } else {
        onSaved(await scheduler().createRecurringJob(input));
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the recurring job "${job?.title || 'Untitled job'}"? Future runs stop. Existing task history is kept.`)) return;
    setSaving(true);
    try {
      await scheduler().deleteRecurringJob(id);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={id ? job?.title || 'Untitled job' : 'New recurring job'}
        description={id
          ? `${describeCron(job?.cron)}${job?.enabled ? '' : ' · Paused'}`
          : 'Run an instruction repeatedly on a schedule.'}
        onBack={leave}
      >
        {id && job?.enabled && job?.nextRunAt && (
          <span className="scheduled-jobs-header-note">Next run <TimeLabel value={job.nextRunAt} now={now} /></span>
        )}
      </PageHeader>
      <div className="settings-content">
        <div className="settings-content-inner scheduled-jobs-editor">
          <RunFields draft={draft} update={update} models={models} folders={folders} disabled={saving} />
          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>Schedule</h3>
              <p>Each occurrence creates a task. The app must be open for runs to start.</p>
            </div>
            <ScheduleFields schedule={draft.schedule} preview={preview} disabled={saving}
              onChange={(schedule) => update({ schedule })} />
            <fieldset className="settings-section-card settings-form settings-row-card scheduled-jobs-fieldset" aria-label="End" disabled={saving}>
              <label className="settings-field">
                <span>Ends</span>
                <small>Optional, local time. Runs up to and including this date and time; leave empty to repeat indefinitely.</small>
                <input className="input" type="datetime-local" value={draft.endsAt} aria-invalid={endsAtInvalid}
                  onChange={(event) => update({ endsAt: event.target.value })} />
              </label>
            </fieldset>
            <div className="settings-section-card settings-form settings-row-card">
              <label className="settings-toggle-row">
                <span><strong>Enabled</strong><small>Paused jobs keep their settings but create no new runs.</small></span>
                <input type="checkbox" className="toggle" checked={draft.enabled} disabled={saving}
                  onChange={(event) => update({ enabled: event.target.checked })} />
              </label>
            </div>
          </section>
          {id && (
            <section className="settings-section">
              <div className="settings-section-heading">
                <h3>Recent runs</h3>
                <p>Last run <TimeLabel value={job?.lastRunAt} now={now} />.</p>
              </div>
              {job?.recentTasks?.length ? (
                <div className="settings-entity-list">
                  {job.recentTasks.map((task) => (
                    <TaskRow key={task.id} task={task} now={now} jobTitle={job.title} modelName={modelName}
                      onOpen={() => onOpenTask(task.id)} />
                  ))}
                </div>
              ) : <p className="scheduled-jobs-muted">No runs yet.</p>}
            </section>
          )}
          {id && (
            <section className="settings-section">
              <div className="settings-section-card settings-form settings-row-card">
                <div className="settings-card-row">
                  <span><strong>Delete recurring job</strong><small>Stops future runs. Task history is kept.</small></span>
                  <button className="button danger" type="button" disabled={saving} onClick={() => void remove()}>
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      <EditorFooter
        status={validation || notice || (dirty ? 'Unsaved changes' : '')}
        error={error}
        saving={saving}
        canSave={!validation && (dirty || !id)}
        label={id ? 'Save changes' : 'Create job'}
        onCancel={leave}
        onSave={() => void save()}
      />
    </>
  );
}

function TaskDetail({ id, now, refreshKey, jobsById, modelName, onBack, onOpenThread }) {
  const [task, setTask] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const value = await scheduler().viewTask(id);
        if (active) {
          setTask(value);
          setLoadError('');
        }
      } catch (reason) {
        if (active) setLoadError(errorText(reason));
      }
    })();
    return () => { active = false; };
  }, [id, refreshKey]);

  async function run(action, confirmation) {
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setActionError('');
    try {
      const result = await action();
      if (result?.deleted) onBack();
      else setTask(result);
    } catch (reason) {
      setActionError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!task) {
    return (
      <>
        <PageHeader title="Task" description="Loading task details." onBack={onBack} />
        <div className="settings-content">
          <div className="settings-content-inner">
            {loadError
              ? <p className="settings-context-error" role="alert">{loadError}</p>
              : <p className="settings-empty" role="status">Loading task...</p>}
          </div>
        </div>
      </>
    );
  }

  const finished = ['completed', 'failed', 'cancelled'].includes(task.status);
  const job = task.recurringJobId ? jobsById.get(task.recurringJobId) : null;
  const facts = [
    ['Status', <StatusBadge key="status" status={task.status} />],
    ['Run at', <TimeLabel key="run" value={task.runAt} now={now} />],
    ['Started', <TimeLabel key="started" value={task.startedAt} now={now} empty="Not started" />],
    ['Finished', <TimeLabel key="finished" value={task.finishedAt} now={now} empty="Not finished" />],
    ['Folder', <span key="folder" title={task.folderPath}>{task.folderPath}</span>],
    ['Model', `${modelName(task.model)}${task.reasoningEffort ? ` · ${task.reasoningEffort}` : ''}`],
    ['Permission', permissionLabels[task.permissionMode] ?? task.permissionMode],
    ['Origin', task.recurringJobId ? `Recurring job: ${job?.title ?? task.recurringJobId}` : 'One-off task'],
    ['Created by', task.createdBy === 'agent' ? 'Agent' : 'You'],
  ];
  const stats = task.stats && [
    ['Duration', task.stats.durationMs < 60_000
      ? formatMetricDuration(task.stats.durationMs)
      : `${Math.floor(task.stats.durationMs / 60_000)}m ${Math.round((task.stats.durationMs % 60_000) / 1000)}s`],
    ['Input tokens', fullNumber.format(task.stats.inputTokens ?? 0)],
    ['Output tokens', fullNumber.format(task.stats.outputTokens ?? 0)],
    ['Total tokens', fullNumber.format(task.stats.totalTokens ?? 0)],
    ['Tool calls', fullNumber.format(task.stats.toolCalls ?? 0)],
  ];

  return (
    <>
      <PageHeader title={task.title || 'Untitled task'} description={statusLabels[task.status] ?? task.status} onBack={onBack}>
        {task.conversationId && (
          <button className="button" type="button" onClick={() => onOpenThread(task.conversationId)}>
            <ExternalLink size={14} aria-hidden="true" />
            Open thread
          </button>
        )}
        {['scheduled', 'running'].includes(task.status) && (
          <button className="button danger" type="button" disabled={busy}
            onClick={() => void run(() => scheduler().cancelTask(task.id), task.status === 'running'
              ? 'Stop this running task? Work already done in its thread is kept.'
              : 'Cancel this scheduled task? It will not run.')}>
            <Ban size={14} aria-hidden="true" />
            {task.status === 'running' ? 'Stop task' : 'Cancel task'}
          </button>
        )}
        {finished && (
          <button className="button danger" type="button" disabled={busy}
            onClick={() => void run(() => scheduler().deleteTask(task.id), 'Delete this task record? Its thread is not deleted.')}>
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        )}
      </PageHeader>
      <div className="settings-content">
        <div className="settings-content-inner scheduled-jobs-editor">
          {actionError && <p className="settings-context-error" role="alert">{actionError}</p>}
          <dl className="settings-section-card scheduled-jobs-facts">
            {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {stats && (
            <section className="settings-section">
              <div className="settings-section-heading"><h3>Usage</h3></div>
              <dl className="settings-section-card scheduled-jobs-facts">
                {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </section>
          )}
          <section className="settings-section">
            <div className="settings-section-heading"><h3>Instruction</h3></div>
            <div className="settings-section-card scheduled-jobs-text">{task.instruction}</div>
          </section>
          {task.error && (
            <section className="settings-section">
              <div className="settings-section-heading"><h3>Error</h3></div>
              <p className="settings-context-error scheduled-jobs-text">{task.error}</p>
            </section>
          )}
          {task.output && (
            <section className="settings-section">
              <div className="settings-section-heading"><h3>Output</h3></div>
              <div className="settings-section-card scheduled-jobs-output">
                <MarkdownSegment text={task.output} finalized />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export function ScheduledJobsPage({ models, defaultFolder, defaultModel, onOpenThread }) {
  const [tab, setTab] = useState('tasks');
  const [view, setView] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [tasks, setTasks] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyJobId, setBusyJobId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(Date.now);
  const runModels = useMemo(() => models.filter((model) => model.routerMode !== 'fusion'), [models]);
  const defaults = useMemo(() => ({
    folderPath: defaultFolder?.path ?? '',
    model: runModels.some((model) => model.id === defaultModel) ? defaultModel : runModels[0]?.id ?? '',
  }), [defaultFolder?.path, defaultModel, runModels]);
  const jobsById = useMemo(() => new Map((jobs ?? []).map((job) => [job.id, job])), [jobs]);
  const modelNames = useMemo(() => new Map(models.map((model) => [model.id, model.name || model.id])), [models]);
  const modelName = (id) => modelNames.get(id) ?? id;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const unsubscribe = scheduler().onEvent(() => {
      setNow(Date.now());
      setRefreshKey((key) => key + 1);
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const items = await window.chatApp.folders.list();
        if (active) setFolders(items.toSorted((a, b) => String(a.name).localeCompare(String(b.name))));
      } catch {
        // The folder picker still offers Browse and the default folder when the list cannot load.
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const [taskResult, jobResult] = await Promise.all([
          scheduler().listTasks({ status: statusFilter || undefined, limit: 200 }),
          scheduler().listRecurringJobs(),
        ]);
        if (!active) return;
        setTasks(taskResult?.tasks ?? []);
        setJobs(jobResult?.jobs ?? []);
        setError('');
      } catch (reason) {
        if (active) setError(errorText(reason));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshKey, statusFilter]);

  async function toggleJob(job, enabled) {
    setBusyJobId(job.id);
    setError('');
    try {
      const saved = await scheduler().updateRecurringJob({ id: job.id, changes: { enabled } });
      setJobs((current) => current.map((item) => (item.id === job.id ? { ...item, ...saved } : item)));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusyJobId(null);
    }
  }

  const backToList = () => setView(null);
  let body;
  if (view?.type === 'task') {
    body = (
      <TaskDetail key={view.id} id={view.id} now={now} refreshKey={refreshKey} jobsById={jobsById} modelName={modelName}
        onBack={() => setView(view.back ?? null)} onOpenThread={onOpenThread} />
    );
  } else if (view?.type === 'new-task') {
    body = (
      <TaskEditor models={runModels} folders={folders} defaults={defaults} onClose={backToList}
        onCreated={(task) => setView({ type: 'task', id: task.id })} />
    );
  } else if (view?.type === 'job') {
    body = (
      <JobEditor key={view.id ?? 'new'} id={view.id} models={runModels} folders={folders} defaults={defaults}
        now={now} refreshKey={refreshKey} modelName={modelName} onClose={backToList}
        onSaved={(job) => setView({ type: 'job', id: job.id })}
        onOpenTask={(taskId) => setView({ type: 'task', id: taskId, back: view })} />
    );
  } else {
    const list = tab === 'tasks' ? tasks : jobs;
    body = (
      <>
        <PageHeader title="Scheduled jobs" description="Run instructions later or on a recurring schedule, each in its own thread.">
          <button className="button" type="button" disabled={loading} onClick={() => setRefreshKey((key) => key + 1)}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </button>
          <button className="button primary" type="button"
            onClick={() => setView(tab === 'tasks' ? { type: 'new-task' } : { type: 'job', id: null })}>
            <Plus size={14} aria-hidden="true" />
            {tab === 'tasks' ? 'New task' : 'New recurring job'}
          </button>
        </PageHeader>
        <div className="settings-content">
          <div className="settings-content-inner scheduled-jobs-list">
            <div className="maintenance-tabs" role="tablist" aria-label="Scheduled jobs views">
              {tabs.map(([id, label], index) => (
                <button key={id} id={`scheduled-tab-${id}`} type="button" role="tab" aria-selected={tab === id}
                  aria-controls="scheduled-panel" tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                    event.preventDefault();
                    const next = tabs[(index + 1) % tabs.length][0];
                    setTab(next);
                    document.getElementById(`scheduled-tab-${next}`)?.focus();
                  }}>
                  {label}
                </button>
              ))}
            </div>
            <section id="scheduled-panel" className="settings-section" role="tabpanel"
              aria-labelledby={`scheduled-tab-${tab}`} aria-busy={loading}>
              {error && (
                <p className="settings-context-error" role="alert">
                  {error}
                </p>
              )}
              {tab === 'tasks' && (
                <div className="settings-list-summary">
                  <span>{tasks ? `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : ''}</span>
                  <select className="select" aria-label="Filter by status" value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="">All statuses</option>
                    {Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
              )}
              {!list ? (
                !error && <p className="settings-empty" role="status">Loading...</p>
              ) : list.length === 0 ? (
                <div className="settings-empty">
                  <CalendarClock size={22} aria-hidden="true" />
                  <strong>
                    {tab === 'jobs' ? 'No recurring jobs' : statusFilter ? `No ${statusLabels[statusFilter].toLowerCase()} tasks` : 'No tasks yet'}
                  </strong>
                  <span>{tab === 'jobs' ? 'Create a job to run an instruction on a schedule.' : 'Schedule a task to run an instruction now or later.'}</span>
                </div>
              ) : tab === 'tasks' ? (
                <div className="settings-entity-list">
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} now={now} jobTitle={jobsById.get(task.recurringJobId)?.title}
                      modelName={modelName} onOpen={() => setView({ type: 'task', id: task.id })} />
                  ))}
                </div>
              ) : (
                <div className="settings-entity-list">
                  {jobs.map((job) => (
                    <article key={job.id} className={classNames('settings-entity-row', !job.enabled && 'disabled')}>
                      <button className="settings-entity-main" type="button" onClick={() => setView({ type: 'job', id: job.id })}>
                        <span className="settings-entity-icon"><Repeat size={16} aria-hidden="true" /></span>
                        <span className="settings-entity-copy">
                          <strong>{job.title || 'Untitled job'}</strong>
                          <small>
                            {describeCron(job.cron)}{' · '}{folderName(job.folderPath)}
                            {' · Last run '}<TimeLabel value={job.lastRunAt} now={now} />
                          </small>
                        </span>
                        <span className="scheduled-jobs-next">
                          {!job.enabled
                            ? 'Paused'
                            : job.nextRunAt ? <>Next <TimeLabel value={job.nextRunAt} now={now} /></> : job.endsAt ? 'Ended' : 'Paused'}
                        </span>
                        <ArrowRight className="settings-entity-arrow" size={15} aria-hidden="true" />
                      </button>
                      <input type="checkbox" className="toggle" checked={job.enabled} disabled={busyJobId === job.id}
                        aria-label={`Enable ${job.title || 'Untitled job'}`} title={job.enabled ? 'Enabled' : 'Paused'}
                        onChange={(event) => void toggleJob(job, event.target.checked)} />
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </>
    );
  }

  return (
    <section className="settings-page scheduled-jobs-page" aria-label="Scheduled jobs">
      <main className="settings-main">{body}</main>
    </section>
  );
}
