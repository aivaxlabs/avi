import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Clock3,
  Cpu,
  Database,
  Dices,
  FolderOpen,
  Plus,
  RotateCcw,
  Save,
  Server,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import Avatar from 'boring-avatars';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '../lib/format.js';
import { McpSettings } from './McpSettings.jsx';

const botAvatarColors = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];
const builtInPersonalities = ['candid', 'cynical', 'friendly', 'pragmatic', 'quirky'];
const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const tabs = [
  { id: 'profile', label: 'Profile', description: 'Identity and behavior', icon: UserRound },
  { id: 'work', label: 'Work', description: 'Purpose and workspace', icon: BriefcaseBusiness },
  { id: 'mcp', label: 'MCP servers', description: 'External tool servers', icon: Server },
  { id: 'model', label: 'Model', description: 'AI and context', icon: Cpu },
  { id: 'schedule', label: 'Schedule', description: 'Timing and autonomy', icon: Clock3 },
  { id: 'data', label: 'Data', description: 'Storage and conversation', icon: Database },
];

function minuteToTimeString(minute) {
  if (!Number.isInteger(minute)) return '';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function timeStringToMinute(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const PERIOD_UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 };

export function BotSettingsDialog({
  bot,
  models,
  pluginPersonalities = [],
  onClose,
  onSave,
  onChooseFolder,
  onClearThread,
  onFullReset,
}) {
  const [tab, setTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mcpNavigation, setMcpNavigation] = useState(null);
  const [scheduleWindowEnabled, setScheduleWindowEnabled] = useState(() => Boolean(
    bot?.activationWindow?.days?.length
    || Number.isInteger(bot?.activationWindow?.startMinute)
    || Number.isInteger(bot?.activationWindow?.endMinute),
  ));
  const initialPeriodMinutes = Math.max(1, bot?.activationPeriodMinutes ?? 10);
  const initialPeriodUnit = initialPeriodMinutes % 1440 === 0
    ? 'days'
    : initialPeriodMinutes % 60 === 0
      ? 'hours'
      : 'minutes';
  const [draft, setDraft] = useState(() => ({
    name: bot?.name ?? '',
    iconSeed: bot?.iconSeed ?? crypto.randomUUID(),
    personality: bot?.personality ?? '',
    workingFolder: bot?.workingFolder ?? '',
    model: bot?.model ?? models[0]?.id ?? '',
    reasoningEffort: bot?.reasoningEffort ?? '',
    contextSize: bot?.contextSize > 0 ? String(bot.contextSize) : '',
    activationPeriod: initialPeriodMinutes / PERIOD_UNIT_MINUTES[initialPeriodUnit],
    activationPeriodUnit: initialPeriodUnit,
    activationMode: bot?.activationMode ?? 'static',
    enabled: bot?.enabled !== false,
    maxActivationsEnabled: (bot?.maxActivations ?? 10) > 0,
    maxActivations: bot?.maxActivations > 0 ? bot.maxActivations : 10,
    windowDays: bot?.activationWindow?.days ?? [],
    windowStart: minuteToTimeString(bot?.activationWindow?.startMinute),
    windowEnd: minuteToTimeString(bot?.activationWindow?.endMinute),
    instructions: bot?.instructions ?? '',
  }));

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === draft.model) ?? null,
    [draft.model, models],
  );
  const modelGroups = useMemo(() => {
    const groups = [];
    const byProvider = new Map();
    for (const model of models) {
      let group = byProvider.get(model.providerId);
      if (!group) {
        group = { id: model.providerId, name: model.providerName, models: [] };
        byProvider.set(model.providerId, group);
        groups.push(group);
      }
      group.models.push(model);
    }
    return groups;
  }, [models]);
  const personalityOptions = [
    { id: '', label: 'Default' },
    ...builtInPersonalities.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
    ...pluginPersonalities.map((personality) => ({ id: personality.id, label: personality.name ?? personality.id })),
  ];

  function update(changes) {
    setDraft((state) => ({ ...state, ...changes }));
  }

  function toggleDay(day) {
    update({
      windowDays: draft.windowDays.includes(day)
        ? draft.windowDays.filter((item) => item !== day)
        : [...draft.windowDays, day],
    });
  }

  async function save() {
    if (!bot) return;
    setSaving(true);
    setError('');
    try {
      await onSave?.({
        name: draft.name.trim() || 'New bot',
        iconSeed: draft.iconSeed,
        personality: draft.personality || null,
        workingFolder: draft.workingFolder.trim() || null,
        model: draft.model,
        reasoningEffort: draft.reasoningEffort || null,
        contextSize: draft.contextSize.trim() ? Number(draft.contextSize) : null,
        activationPeriodMinutes: Math.max(
          1,
          Math.round((Number(draft.activationPeriod) || 1) * PERIOD_UNIT_MINUTES[draft.activationPeriodUnit]) || 10,
        ),
        activationMode: draft.activationMode,
        enabled: draft.enabled,
        maxActivations: draft.maxActivationsEnabled
          ? Math.max(1, Number(draft.maxActivations) || 10)
          : 0,
        activationWindow: scheduleWindowEnabled
          ? {
            days: draft.windowDays,
            startMinute: timeStringToMinute(draft.windowStart),
            endMinute: timeStringToMinute(draft.windowEnd),
          }
          : { days: [], startMinute: null, endMinute: null },
        instructions: draft.instructions,
      });
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  }

  async function chooseFolder() {
    const folder = await onChooseFolder?.();
    if (folder) update({ workingFolder: folder });
  }

  function clearThread() {
    if (!window.confirm('Clear this bot conversation? Messages are removed. Memory, work state, and approvals are kept.')) return;
    onClearThread?.(bot?.id);
  }

  function fullReset() {
    const fileScope = bot?.workingFolder
      ? 'Only its isolated .avi-bots data folder will be deleted; project files stay untouched.'
      : 'Its dedicated working folder and all files inside it will be deleted.';
    if (!window.confirm(`Full reset "${bot?.name ?? 'this bot'}"? Conversation history, work threads, tasks, goals, memory, activity, work items, approvals, and bot-owned files are permanently deleted. ${fileScope} All bot and MCP settings are kept.`)) return;
    onFullReset?.(bot?.id);
  }

  function rerollIcon() {
    update({ iconSeed: crypto.randomUUID() });
  }

  return createPortal(
    <div className="dialog-backdrop bot-settings-backdrop" onMouseDown={onClose}>
      <section
        className="bot-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <span className="bot-settings-header-icon" aria-hidden="true">
            <Bot size={18} />
          </span>
          <div>
            <h2 id="bot-settings-title">{draft.name.trim() || 'New bot'}</h2>
            <p>Configure how this teammate works.</p>
          </div>
          <button className="icon-button tiny" type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="bot-settings-workspace">
          <nav className="bot-settings-tabs" role="tablist" aria-label="Bot settings domains">
            {tabs.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  id={`bot-settings-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  aria-controls="bot-settings-panel"
                  tabIndex={tab === item.id ? 0 : -1}
                  className={classNames('bot-settings-tab', tab === item.id && 'active')}
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => {
                    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
                    const nextIndex = event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : (index + direction + tabs.length) % tabs.length;
                    setTab(tabs[nextIndex].id);
                    document.getElementById(`bot-settings-tab-${tabs[nextIndex].id}`)?.focus();
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <span>{item.label}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div
            id="bot-settings-panel"
            className="bot-settings-body"
            role="tabpanel"
            aria-labelledby={`bot-settings-tab-${tab}`}
            tabIndex={0}
          >
            {tab === 'profile' && (
              <>
                <section className="bot-settings-section">
                  <header>
                    <h3>Who is this bot?</h3>
                    <p>Give it an identity that is easy to recognize in your workspace.</p>
                  </header>
                  <div className="bot-settings-profile">
                    <div className="bot-settings-avatar">
                      <span className="bot-avatar large" aria-hidden="true">
                        <Avatar
                          size={48}
                          name={draft.iconSeed}
                          variant="beam"
                          colors={botAvatarColors}
                        />
                      </span>
                      <button type="button" onClick={rerollIcon}>
                        <Dices size={14} aria-hidden="true" />
                        New icon
                      </button>
                    </div>
                    <label className="bot-settings-control grow">
                      <span>Name</span>
                      <input
                        type="text"
                        value={draft.name}
                        maxLength={60}
                        autoFocus
                        onChange={(event) => update({ name: event.target.value })}
                      />
                    </label>
                  </div>
                </section>
                <section className="bot-settings-section">
                  <header>
                    <h3>How should it communicate?</h3>
                    <p>Choose a personality for its tone and decision style.</p>
                  </header>
                  <label className="bot-settings-control">
                    <span>Personality</span>
                    <select
                      value={draft.personality}
                      onChange={(event) => update({ personality: event.target.value })}
                    >
                      {personalityOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </section>
              </>
            )}

            {tab === 'work' && (
              <>
                <section className="bot-settings-section">
                  <header>
                    <h3>What should it work on?</h3>
                    <p>Describe its responsibilities, priorities, and boundaries.</p>
                  </header>
                  <label className="bot-settings-control">
                    <span>Instructions</span>
                    <textarea
                      value={draft.instructions}
                      placeholder="Review open work, identify gaps, and coordinate tasks that need attention"
                      onChange={(event) => update({ instructions: event.target.value })}
                    />
                    <small>These instructions are included in every activation.</small>
                  </label>
                </section>
                <section className="bot-settings-section">
                  <header>
                    <h3>Where does it work?</h3>
                    <p>Its workspace provides project instructions, context, and MCP servers.</p>
                  </header>
                  <div className="bot-settings-control">
                    <span>Working folder</span>
                    <div className="bot-settings-folder">
                      <input
                        type="text"
                        value={draft.workingFolder}
                        placeholder="Dedicated bot folder"
                        readOnly
                        aria-label="Working folder"
                      />
                      <button type="button" onClick={chooseFolder}>
                        <FolderOpen size={14} aria-hidden="true" />
                        Choose
                      </button>
                      {draft.workingFolder && (
                        <button
                          type="button"
                          title="Use the dedicated folder in ~/.aivax/bots"
                          onClick={() => update({ workingFolder: '' })}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          Reset
                        </button>
                      )}
                    </div>
                    <small>Without a selection, Avi creates a dedicated folder in ~/.aivax/bots.</small>
                  </div>
                </section>
              </>
            )}

            {tab === 'mcp' && (
              <section className="bot-settings-section bot-settings-mcp">
                <header>
                  <h3>Which external tools can it use?</h3>
                  <p>Workspace servers are inherited. Bot servers are exclusive to this bot.</p>
                </header>
                {bot?.resolvedWorkingFolder ? (
                  <>
                    <div className="bot-settings-mcp-toolbar">
                      {mcpNavigation?.backLabel === 'Back to servers' && (
                        <button type="button" autoFocus onClick={mcpNavigation.onBack}>
                          <ArrowLeft size={14} aria-hidden="true" />
                          {mcpNavigation.backLabel}
                        </button>
                      )}
                      <span className="bot-settings-mcp-path" title={mcpNavigation?.description}>
                        {mcpNavigation?.description}
                      </span>
                      {mcpNavigation?.onAction && (
                        <button
                          className="primary-mini"
                          type="button"
                          onClick={mcpNavigation.onAction}
                        >
                          <Plus size={14} aria-hidden="true" />
                          {mcpNavigation.actionLabel}
                        </button>
                      )}
                    </div>
                    <div
                      className="settings-page bot-settings-mcp-scope"
                      key={bot.resolvedWorkingFolder}
                    >
                      <McpSettings
                        initialFolder={{ path: bot.resolvedWorkingFolder, name: 'Bot servers' }}
                        botId={bot.id}
                        onNavigationChange={setMcpNavigation}
                      />
                    </div>
                  </>
                ) : (
                  <p className="bot-settings-mcp-empty">
                    Save this bot first to configure its MCP servers.
                  </p>
                )}
              </section>
            )}

            {tab === 'model' && (
              <>
                <section className="bot-settings-section">
                  <header>
                    <h3>Which model powers this bot?</h3>
                    <p>This model and reasoning level are used for every activation.</p>
                  </header>
                  <div className="bot-settings-grid">
                    <label className="bot-settings-control">
                      <span>Model</span>
                      <select
                        value={draft.model}
                        onChange={(event) => update({ model: event.target.value, reasoningEffort: '' })}
                      >
                        {modelGroups.map((group) => (
                          <optgroup key={group.id} label={group.name}>
                            {group.models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.name || model.id}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label className="bot-settings-control">
                      <span>Reasoning</span>
                      <select
                        value={draft.reasoningEffort}
                        onChange={(event) => update({ reasoningEffort: event.target.value })}
                      >
                        <option value="">Default</option>
                        {(selectedModel?.reasoning ?? []).map((effort) => (
                          <option key={effort} value={effort}>{effort}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
                <section className="bot-settings-section">
                  <header>
                    <h3>Does it need a custom context limit?</h3>
                    <p>Most bots should inherit the context window from their model.</p>
                  </header>
                  <label className="bot-settings-control bot-settings-context-size">
                    <span>Context size</span>
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      value={draft.contextSize}
                      placeholder="Use model default"
                      onChange={(event) => update({ contextSize: event.target.value })}
                    />
                    <small>Only set this when you need to override the model value.</small>
                  </label>
                </section>
              </>
            )}

            {tab === 'schedule' && (
              <>
                <section className="bot-settings-section">
                  <label className="bot-settings-toggle">
                    <span>
                      <strong>Enable bot</strong>
                      <small>Allow scheduled and manual activations.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => update({ enabled: event.target.checked })}
                    />
                  </label>
                </section>

                <section className="bot-settings-section">
                  <header>
                    <h3>How often should it check for work?</h3>
                    <p>Avi activates the bot at this interval while it is awake.</p>
                  </header>
                  <label className="bot-settings-control bot-settings-period">
                    <span>Every</span>
                    <span className="bot-settings-number-unit">
                      <input
                        type="number"
                        min={1}
                        value={draft.activationPeriod}
                        onChange={(event) => update({ activationPeriod: event.target.value })}
                      />
                      <select
                        aria-label="Activation period unit"
                        value={draft.activationPeriodUnit}
                        onChange={(event) => {
                          const nextUnit = event.target.value;
                          const minutes = (Number(draft.activationPeriod) || 1)
                            * PERIOD_UNIT_MINUTES[draft.activationPeriodUnit];
                          update({
                            activationPeriodUnit: nextUnit,
                            activationPeriod: Math.max(1, Math.round(minutes / PERIOD_UNIT_MINUTES[nextUnit])),
                          });
                        }}
                      >
                        {Object.keys(PERIOD_UNIT_MINUTES).map((unit) => (
                          <option key={unit} value={unit}>
                            {Number(draft.activationPeriod) === 1 ? unit.slice(0, -1) : unit}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                </section>

                <section className="bot-settings-section">
                  <header>
                    <h3>How should it pause?</h3>
                    <p>Choose whether the bot follows the interval strictly or can idle intelligently.</p>
                  </header>
                  <fieldset className="bot-settings-choices">
                    <legend className="sr-only">Activation mode</legend>
                    <label className={classNames('bot-settings-choice', draft.activationMode === 'static' && 'active')}>
                      <input
                        type="radio"
                        name="bot-activation-mode"
                        checked={draft.activationMode === 'static'}
                        onChange={() => update({ activationMode: 'static' })}
                      />
                      <span>
                        <strong>Always on schedule</strong>
                        <small>Runs at every interval while allowed.</small>
                      </span>
                    </label>
                    <label className={classNames('bot-settings-choice', draft.activationMode === 'smart' && 'active')}>
                      <input
                        type="radio"
                        name="bot-activation-mode"
                        checked={draft.activationMode === 'smart'}
                        onChange={() => update({ activationMode: 'smart' })}
                      />
                      <span>
                        <strong>Pause when idle</strong>
                        <small>Can skip four intervals when there is no relevant work.</small>
                      </span>
                    </label>
                  </fieldset>
                  <label className="bot-settings-toggle">
                    <span>
                      <strong>Pause after repeated activations</strong>
                      <small>Pauses for four activation periods, then resumes automatically.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.maxActivationsEnabled}
                      onChange={(event) => update({ maxActivationsEnabled: event.target.checked })}
                    />
                  </label>
                  {draft.maxActivationsEnabled && (
                    <label className="bot-settings-control bot-settings-inline-detail">
                      <span>Activations before sleep</span>
                      <input
                        type="number"
                        min={1}
                        value={draft.maxActivations}
                        onChange={(event) => update({ maxActivations: event.target.value })}
                      />
                    </label>
                  )}
                </section>

                <section className="bot-settings-section">
                  <header>
                    <h3>When may it run?</h3>
                    <p>Keep it available at all times, or restrict it to a weekly window.</p>
                  </header>
                  <label className="bot-settings-toggle">
                    <span>
                      <strong>Use a schedule window</strong>
                      <small>Restrict activations by day and time.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={scheduleWindowEnabled}
                      onChange={(event) => setScheduleWindowEnabled(event.target.checked)}
                    />
                  </label>
                  {scheduleWindowEnabled && (
                    <div className="bot-settings-window">
                      <div className="bot-settings-control">
                        <span>Active days</span>
                        <div className="bot-settings-days" role="group" aria-label="Active days">
                          {dayLabels.map((day, index) => (
                            <button
                              key={day}
                              type="button"
                              className={classNames(
                                'bot-settings-day',
                                draft.windowDays.includes(index) && 'active',
                              )}
                              aria-pressed={draft.windowDays.includes(index)}
                              onClick={() => toggleDay(index)}
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                        <small>No selected days means every day.</small>
                      </div>
                      <div className="bot-settings-grid">
                        <label className="bot-settings-control">
                          <span>From</span>
                          <input
                            type="time"
                            value={draft.windowStart}
                            onChange={(event) => update({ windowStart: event.target.value })}
                          />
                        </label>
                        <label className="bot-settings-control">
                          <span>To</span>
                          <input
                            type="time"
                            value={draft.windowEnd}
                            onChange={(event) => update({ windowEnd: event.target.value })}
                          />
                        </label>
                      </div>
                      <small>Leave both times empty for the full day. Overnight ranges are supported.</small>
                    </div>
                  )}
                </section>
              </>
            )}

            {tab === 'data' && (
              <>
                <section className="bot-settings-section">
                  <header>
                    <h3>Where is its internal data?</h3>
                    <p>Memory and daily JSON logs live in the bot's isolated data folder.</p>
                  </header>
                  <label className="bot-settings-control">
                    <span>Bot data folder</span>
                    <input
                      className="bot-settings-path"
                      type="text"
                      value={bot?.resolvedDataFolder ?? ''}
                      readOnly
                    />
                    <small>These files are preserved when the conversation is cleared.</small>
                  </label>
                </section>
                <section className="bot-settings-section bot-settings-danger-zone">
                  <header>
                    <h3>What can be reset?</h3>
                    <p>Clear conversation history without deleting memory, work state, or approvals.</p>
                  </header>
                  <div className="bot-settings-danger-action">
                    <span>
                      <strong>Bot conversation</strong>
                      <small>Messages are removed permanently. Its working state is kept.</small>
                    </span>
                    <button type="button" className="danger" onClick={clearThread}>
                      <Trash2 size={14} aria-hidden="true" />
                      Clear conversation
                    </button>
                  </div>
                  <div className="bot-settings-danger-action">
                    <span>
                      <strong>Full reset</strong>
                      <small>Deletes all bot-owned history, tracking, memory, approvals, and files while keeping its settings.</small>
                    </span>
                    <button type="button" className="danger" onClick={fullReset}>
                      <RotateCcw size={14} aria-hidden="true" />
                      Full reset
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>

        {error && <p className="bot-settings-error" role="alert">{error}</p>}
        <footer className="dialog-footer">
          <div>
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary-mini" type="button" disabled={saving} onClick={save}>
              <Save size={14} aria-hidden="true" />
              {saving ? 'Saving' : 'Save bot'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
