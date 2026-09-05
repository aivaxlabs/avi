import {
  AlertTriangle,
  Check,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

export function RemoteSettings() {
  const [state, setState] = useState(null);
  const [port, setPort] = useState('18992');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyExpires, setNewKeyExpires] = useState('');
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

  useEffect(() => {
    if (busy) return undefined;
    let active = true;
    const timer = setInterval(() => {
      window.chatApp.remote.state()
        .then((value) => {
          if (active) setState(value);
        })
        .catch((nextError) => {
          if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
        });
    }, 2_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [busy]);

  async function mutate(action) {
    setBusy(true);
    setCopiedId(null);
    setError('');
    try {
      const value = await action();
      const next = await window.chatApp.remote.state();
      setState(next);
      setPort(String(next.port));
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
            <h3>Local MCP and RPC</h3>
            <p>Expose MCP and RPC locally, with an optional RPC-only WAN bridge.</p>
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
            aria-label="Remote MCP and RPC port"
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

        <div className="settings-card-row">
          <div className="remote-row-copy">
            <strong>Server status</strong>
            <span className={state.running ? 'remote-status running' : 'remote-status'}>
              <i aria-hidden="true" />
              {state.running ? 'Listening' : 'Not listening'}
            </span>
          </div>
        </div>

        <div className="settings-card-row">
          <div className="remote-row-copy">
            <strong>RPC WAN bridge</strong>
            <span>Uses your connected AIVAX account. MCP remains local.</span>
            <span>Device: {state.relayDeviceId}</span>
            <span role="status">
              {{
                stopped: 'Inactive — enable the bridge and connect an AIVAX account.',
                unauthorized: 'Authorization required — reconnect your AIVAX account.',
                connecting: 'Connecting...',
                connected: 'Published — available to your AIVAX account.',
                reconnecting: 'Reconnecting...',
                error: 'Unavailable',
              }[state.relay?.status ?? 'stopped']}
            </span>
            {state.relay?.error && <span role="alert">{state.relay.error}</span>}
            <span>AIVAX authentication grants WAN access. No Desktop API key is needed. Cloudflare terminates TLS.</span>
          </div>
          <label className="remote-switch">
            <input
              type="checkbox"
              aria-label="RPC WAN bridge"
              checked={state.relayEnabled}
              disabled={busy}
              onChange={(event) => mutate(() => window.chatApp.remote.save({
                relayEnabled: event.target.checked,
              }))}
            />
            <span className="remote-switch-track" aria-hidden="true" />
            <strong>{state.relayEnabled ? 'On' : 'Off'}</strong>
          </label>
        </div>
      </div>

      <div className="settings-section-card settings-row-card">
        <div className="settings-card-row">
          <div className="remote-row-copy">
            <strong>API keys</strong>
            <span>Authenticate local MCP and RPC clients only. WAN uses your AIVAX account.</span>
          </div>
        </div>

        {state.apiKeys.map((key) => (
          <div className="settings-card-row" key={key.id}>
            <div className="remote-row-copy">
              <strong>
                {key.label || 'API key'}
                {key.expired && <span className="remote-key-expired">Expired</span>}
              </strong>
              <span>
                Created {new Date(key.createdAt).toLocaleString()}
                {' · '}
                {key.expiresAt ? `Expires ${new Date(key.expiresAt).toLocaleString()}` : 'No expiration'}
              </span>
            </div>
            <div className="remote-key-actions">
              <button
                className="remote-action"
                type="button"
                disabled={busy}
                onClick={async () => {
                  const result = await mutate(() => window.chatApp.remote.copyKey(key.id));
                  if (result?.copied) setCopiedId(key.id);
                }}
              >
                {copiedId === key.id ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === key.id ? 'Copied' : 'Copy'}
              </button>
              <button
                className="remote-action danger"
                type="button"
                disabled={busy}
                onClick={() => mutate(() => window.chatApp.remote.removeKey(key.id))}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        ))}

        {state.apiKeys.length === 0 && (
          <div className="remote-keys-empty">No API keys yet.</div>
        )}

        <form
          className="settings-card-row remote-key-create"
          onSubmit={async (event) => {
            event.preventDefault();
            const label = newKeyLabel.trim();
            if (!label) {
              setError('Enter a name for the new API key.');
              return;
            }
            const expiresAt = newKeyExpires ? new Date(newKeyExpires).toISOString() : null;
            const created = await mutate(() => window.chatApp.remote.createKey({ label, expiresAt }));
            if (created !== null) {
              setNewKeyLabel('');
              setNewKeyExpires('');
            }
          }}
        >
          <div className="remote-row-copy">
            <strong>New API key</strong>
            <span>Expiration is optional.</span>
          </div>
          <div className="remote-create-inputs">
            <input
              className="remote-create-input"
              type="text"
              placeholder="Key name"
              aria-label="API key name"
              value={newKeyLabel}
              disabled={busy}
              onChange={(event) => setNewKeyLabel(event.target.value)}
            />
            <input
              className="remote-create-input"
              type="datetime-local"
              aria-label="API key expiration (optional)"
              value={newKeyExpires}
              disabled={busy}
              onChange={(event) => setNewKeyExpires(event.target.value)}
            />
            <button className="remote-action primary" type="submit" disabled={busy}>
              <Plus size={14} />
              Create API key
            </button>
          </div>
        </form>
      </div>

      <p className="remote-footnote">
        API key secrets are never displayed. Use Copy to place a key on the clipboard for your MCP client.
      </p>
      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </section>
  );
}
