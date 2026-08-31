import { Check, ImagePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { classNames } from '../lib/format.js';
import { themes } from '../lib/themes.js';
import { Message } from './Message.jsx';

const schemeOptions = Object.freeze([
  { id: 'system', label: 'System', description: 'Follow the operating-system appearance.' },
  { id: 'light', label: 'Light', description: 'Keep Avi in light mode.' },
  { id: 'dark', label: 'Dark', description: 'Keep Avi in dark mode.' },
]);
const blendModeOptions = Object.freeze([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);
const backgroundPreviewMessages = Object.freeze([
  {
    id: 'background-preview-user',
    role: 'user',
    content: 'Can you help me personalize this workspace without making the chat harder to read?',
    status: 'completed',
    attachments: [],
    segments: [],
    continuations: [],
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
  },
  {
    id: 'background-preview-assistant',
    role: 'assistant',
    content: 'Absolutely. Try a subtle image, then use [blend mode](https://developer.mozilla.org/docs/Web/CSS/mix-blend-mode) and [opacity](https://developer.mozilla.org/docs/Web/CSS/opacity) to keep every message clear.\n\nThis preview uses the same message components as your chat.',
    status: 'completed',
    attachments: [],
    segments: [],
    continuations: [],
    createdAt: '2026-01-01T12:00:05.000Z',
    updatedAt: '2026-01-01T12:00:05.000Z',
  },
]);

function ThemePreview({ theme, mode, active }) {
  return (
    <div
      className={classNames('theme-preview', active && 'active')}
      data-theme={theme.id}
      data-color-scheme={mode}
      aria-hidden="true"
    >
      <div className="theme-preview-bar">
        <span className="dot danger" />
        <span className="dot warn" />
        <span className="dot success" />
        <span className="theme-preview-bar-title">Avi</span>
      </div>
      <div className="theme-preview-body">
        <div className="theme-preview-sidebar">
          <div className="theme-preview-sidebar-item active" />
          <div className="theme-preview-sidebar-item" />
          <div className="theme-preview-sidebar-item" />
        </div>
        <div className="theme-preview-chat">
          <div className="theme-preview-message assistant">
            <div className="line strong" />
            <div className="line soft" />
          </div>
          <div className="theme-preview-message user">
            <div className="line on-primary" />
          </div>
          <div className="theme-preview-code">
            <span className="tk tk-keyword">const</span>
            {' '}
            <span className="tk tk-function">build</span>
            {' = '}
            <span className="tk tk-string">&quot;ready&quot;</span>
            <span className="tk tk-punctuation">;</span>
          </div>
          <div className="theme-preview-composer">
            <div className="line faint" />
            <span className="theme-preview-send" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceSettings({
  appearance,
  backgroundUrl,
  previewScheme,
  desktop,
  onChange,
  onDesktopChange,
  onBackgroundSelect,
  onBackgroundRemove,
  themeCatalog = themes,
}) {
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');
  const shownMode = previewScheme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : previewScheme;
  const selectedScheme = schemeOptions.find((option) => option.id === appearance.scheme);

  return (
    <div className="settings-appearance">
      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Mode</h3>
          <p>Control Avi’s color scheme and native window appearance.</p>
        </div>
        <div className="settings-section-card settings-form settings-row-card">
          <label className="settings-field settings-field-wide">
            <span>Color mode</span>
            <select
              value={appearance.scheme}
              onChange={(event) => onChange({ ...appearance, scheme: event.target.value })}
            >
              {schemeOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <small>{selectedScheme.description}</small>
          </label>
          <label className="settings-toggle-row">
            <span>
              <strong>Transparent sidebar</strong>
              <small>Use the operating system’s native transparency effect with the active theme surfaces.</small>
            </span>
            <input
              className="appearance-desktop-switch"
              type="checkbox"
              checked={desktop.sidebarTransparency}
              onChange={(event) => onDesktopChange({
                ...desktop,
                sidebarTransparency: event.target.checked,
              })}
            />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Theme</h3>
          <p>Select a theme to preview it live. The change is applied immediately.</p>
        </div>
        <div className="appearance-theme-grid">
          {themeCatalog.map((theme) => {
            const selected = theme.id === appearance.themeId;
            return (
              <button
                key={theme.id}
                type="button"
                className={classNames('appearance-theme-card', selected && 'selected')}
                aria-pressed={selected}
                onClick={() => onChange({ ...appearance, themeId: theme.id })}
              >
                <ThemePreview theme={theme} mode={shownMode} active={selected} />
                <span className="appearance-theme-meta">
                  <span className="appearance-theme-name">
                    {theme.name}
                    {selected && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="appearance-theme-tagline">{theme.tagline}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Background</h3>
          <p>Choose an image shown behind the main chat. Avi stores its own managed copy.</p>
        </div>
        <div className="settings-section-card appearance-background-card">
          <div
            className="appearance-background-preview chat-area"
            aria-label={backgroundUrl ? 'Chat background preview' : 'Chat preview without a background image'}
          >
            {backgroundUrl && (
              <div
                className="chat-background-image"
                style={{
                  backgroundImage: `url(${JSON.stringify(backgroundUrl)})`,
                  mixBlendMode: appearance.backgroundBlendMode,
                  opacity: appearance.backgroundOpacity,
                }}
                aria-hidden="true"
              />
            )}
            <div className="chat-scroll" inert aria-hidden="true">
              <div className="messages-column">
                {backgroundPreviewMessages.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    modelName="Avi"
                    workedMessages={[]}
                    showContinuations={false}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="appearance-background-editor">
            <label className="appearance-background-control">
              <span>Blend mode</span>
              <select
                value={appearance.backgroundBlendMode}
                onChange={(event) => onChange({
                  ...appearance,
                  backgroundBlendMode: event.target.value,
                })}
              >
                {blendModeOptions.map((mode) => (
                  <option key={mode} value={mode}>{mode}</option>
                ))}
              </select>
            </label>

            <div className="appearance-background-control appearance-background-opacity">
              <span className="appearance-background-control-heading">
                <label htmlFor="chat-background-opacity">Opacity</label>
                <output htmlFor="chat-background-opacity">
                  {Math.round(appearance.backgroundOpacity * 100)}%
                </output>
              </span>
              <input
                id="chat-background-opacity"
                type="range"
                min="0.05"
                max="0.8"
                step="0.05"
                value={appearance.backgroundOpacity}
                onChange={(event) => onChange({
                  ...appearance,
                  backgroundOpacity: Number(event.target.value),
                })}
              />
            </div>

            <div className="appearance-background-actions">
              <button
                type="button"
                className="settings-button appearance-background-select"
                disabled={backgroundBusy}
                onClick={async () => {
                  setBackgroundBusy(true);
                  setBackgroundError('');
                  try {
                    await onBackgroundSelect();
                  } catch (error) {
                    setBackgroundError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setBackgroundBusy(false);
                  }
                }}
              >
                <ImagePlus size={14} />
                {backgroundBusy ? 'Selecting...' : backgroundUrl ? 'Change image' : 'Select image'}
              </button>
              {backgroundUrl && (
                <button
                  type="button"
                  className="appearance-background-remove"
                  disabled={backgroundBusy}
                  onClick={async () => {
                    setBackgroundBusy(true);
                    setBackgroundError('');
                    try {
                      await onBackgroundRemove();
                    } catch (error) {
                      setBackgroundError(error instanceof Error ? error.message : String(error));
                    } finally {
                      setBackgroundBusy(false);
                    }
                  }}
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
            </div>
            {backgroundError && <p className="appearance-background-error" role="alert">{backgroundError}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
