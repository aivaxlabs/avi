import { useEffect, useState } from 'react';
import {
  RefreshCw,
  Sparkles,
} from 'lucide-react';

export function ProviderPanel({
  panel,
  conversationId,
}) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadPanel() {
    setBusy(true);
    setError('');
    try {
      setData(await window.chatApp.providers.auxiliaryPanel({
        panelId: panel.id,
        conversationId,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function invokeAction(action) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.chatApp.providers.auxiliaryPanelAction({
        panelId: panel.id,
        conversationId,
        action: action.id,
        input: action.input,
      });
      if (result?.panel) setData(result.panel);
      if (result?.message) setError(result.message);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadPanel();
  }, [conversationId, panel.id]);

  return (
    <div className="provider-panel-shell">
      <header className="provider-panel-provenance">
        <span>
          Auxiliary panel provided by <strong>{panel.providerName}</strong>
        </span>
        <button
          type="button"
          disabled={busy}
          aria-label={`Refresh ${panel.title}`}
          title={`Refresh ${panel.title}`}
          onClick={loadPanel}
        >
          <RefreshCw className={busy ? 'spin' : undefined} size={15} />
        </button>
      </header>

      {!data && busy ? (
        <div className="provider-panel-state">
          <RefreshCw className="spin" size={18} />
          <span>Loading provider data…</span>
        </div>
      ) : data?.state ? (
        <div className="provider-panel-state">
          <Sparkles size={20} />
          <strong>{data.state.title}</strong>
          {data.state.description && <span>{data.state.description}</span>}
        </div>
      ) : (
        <div className="provider-usage-panel">
          {error && <div className="provider-panel-error" role="alert">{error}</div>}

          {(data?.sections ?? []).map((section) => {
            const progressSection = section.items.some((item) => item.type === 'progress');
            return (
              <section
                className={progressSection ? 'provider-usage-section' : 'provider-reset-section'}
                key={section.id}
              >
                <div className="provider-section-heading">
                  <h3>{section.title}</h3>
                  {section.caption && <small>{section.caption}</small>}
                </div>
                <div className={progressSection ? 'provider-limit-list' : 'provider-reset-list'}>
                  {section.items.map((item) => (
                    item.type === 'progress' ? (
                      <article className="provider-limit-card" key={item.id}>
                        <span className="provider-limit-copy">
                          <strong>{item.title}</strong>
                          {item.description && <small>{item.description}</small>}
                        </span>
                        <span className="provider-limit-value">
                          <span
                            className="provider-limit-track"
                            role="progressbar"
                            aria-label={item.title}
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow={item.value}
                          >
                            <span style={{ width: `${item.value}%` }} />
                          </span>
                          <span>{item.valueLabel}</span>
                        </span>
                      </article>
                    ) : (
                      <article key={item.id}>
                        <span>
                          <strong>{item.title}</strong>
                          {item.description && <small>{item.description}</small>}
                        </span>
                        {item.action && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => invokeAction(item.action)}
                          >
                            {item.action.label}
                          </button>
                        )}
                      </article>
                    )
                  ))}
                  {section.items.length === 0 && (
                    <div className="provider-panel-empty">{section.empty}</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
