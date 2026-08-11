import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { classNames } from '../lib/format.js';
import { themes } from '../lib/themes.js';

const schemeOptions = Object.freeze([
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
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

export function AppearanceSettings({ appearance, previewScheme, onChange, themeCatalog = themes }) {
  const activeTheme = themeCatalog.find((theme) => theme.id === appearance.themeId) ?? themeCatalog[0];
  const shownMode = previewScheme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : previewScheme;

  return (
    <div className="settings-appearance">
      <section className="settings-section">
        <div className="settings-section-heading">
          <h3>Mode</h3>
          <p>Follow the system preference or pin Avi to a light or dark appearance.</p>
        </div>
        <div className="settings-section-card">
          <div className="appearance-scheme-switch" role="radiogroup" aria-label="Color scheme">
            {schemeOptions.map((option) => {
              const Icon = option.icon;
              const selected = appearance.scheme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={classNames('appearance-scheme-option', selected && 'active')}
                  onClick={() => onChange({ ...appearance, scheme: option.id })}
                >
                  <Icon size={14} />
                  {option.label}
                </button>
              );
            })}
          </div>
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
          <h3>Preview</h3>
          <p>
            {activeTheme.name}
            {' · '}
            {shownMode === 'dark' ? 'Dark' : 'Light'}
            {' mode'}
          </p>
        </div>
        <div className="settings-section-card appearance-live-preview-card">
          <ThemePreview theme={activeTheme} mode={shownMode} active />
        </div>
      </section>
    </div>
  );
}
