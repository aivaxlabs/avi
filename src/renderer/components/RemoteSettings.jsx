import {
  AlertTriangle,
  Check,
  Copy,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

export function RemoteSettings() {
  const [state, setState] = useState(null);
  const [port, setPort] = useState('18992');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.chatApp.remote.state()
      .then((value) => {
        if (!active) return;
        setState(value);
        setPort(String(value.port));
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, []);

  async function mutate(action) {
    setBusy(true);
    setCopied(false);
    setError('');
    try {
      const value = await action();
      if (value?.port) {
        setState(value);
        setPort(String(value.port));
      }
      return value;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="settings-section remote-settings">
        <div className="settings-empty">Loading Remote settings...</div>
        {error && <div className="settings-context-error" role="alert">{error}</div>}
      </section>
    );
  }

  return (
    <section className="settings-section remote-settings">
      <div className="settings-section-card settings-row-card">
        <div className="settings-card-row remote-header">
          <div className="remote-heading">
            <h3>Remote MCP server</h3>
            <p>Allow local MCP clients to use Avi orchestration tools.</p>
          </div>
          <label className="remote-switch">
            <input
              type="checkbox"
              checked={state.enabled}
              disabled={busy}
              onChange={(event) => mutate(() => window.chatApp.remote.save({
                enabled: event.target.checked,
                port: Number(port),
              }))}
            />
            <span className="remote-switch-track" aria-hidden="true" />
            <strong>{state.enabled ? 'On' : 'Off'}</strong>
          </label>
        </div>

        {state.startError && (
          <div className="remote-start-warning" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{state.startError}</span>
          </div>
        )}

        <div className="settings-card-row">
          <div className="remote-row-copy">
            <strong>Port</strong>
            <span>Changes are applied when you leave the field.</span>
          </div>
          <input
            className="remote-port-input"
            type="number"
            min="1"
            max="65535"
            aria-label="Remote MCP server port"
            value={port}
            disabled={busy}
            onChange={(event) => setPort(event.target.value)}
            onBlur={() => {
              if (port !== String(state.port)) {
                mutate(() => window.chatApp.remote.save({
                  enabled: state.enabled,
                  port: Number(port),
                }));
              }
            }}
          />
        </div>

        <div className="settings-card-row remote-endpoint-row">
          <div className="remote-row-copy">
            <strong>Endpoint</strong>
            <span className={state.running ? 'remote-status running' : 'remote-status'}>
              <i aria-hidden="true" />
              {state.running ? 'Listening' : 'Not listening'}
            </span>
          </div>
          <code>{state.endpoint}</code>
        </div>

        <div className="settings-card-row">
          <div className="remote-row-copy">
            <strong>Access key</strong>
            <span>
              {state.hasApiKey
                ? 'Included in the endpoint URL and accepted as a Bearer token.'
                : 'No API key is configured.'}
            </span>
          </div>
          <div className="remote-key-controls">
            <span className={state.hasApiKey ? 'remote-key-status configured' : 'remote-key-status'}>
              {state.hasApiKey ? 'Configured' : 'Not configured'}
            </span>
            <div className="remote-key-actions">
              <button
                className="remote-action primary"
                type="button"
                disabled={busy || !state.hasApiKey}
                onClick={async () => {
                  const result = await mutate(() => window.chatApp.remote.copyKey());
                  if (result?.copied) setCopied(true);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy key'}
              </button>
              <button
                className="remote-action"
                type="button"
                disabled={busy}
                onClick={() => mutate(() => window.chatApp.remote.regenerateKey())}
              >
                <RefreshCw size={14} />
                Regenerate
              </button>
              <button
                className="remote-action danger"
                type="button"
                disabled={busy || !state.hasApiKey}
                onClick={() => mutate(() => window.chatApp.remote.removeKey())}
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="remote-footnote">
        Removing the key turns Remote mode off. A new key is created the next time you enable it.
      </p>
      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </section>
  );
}
