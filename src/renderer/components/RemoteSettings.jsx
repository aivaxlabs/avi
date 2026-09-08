import {
  AlertTriangle,
  Copy,
  KeyRound,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

const REMOTE_MCP_PUBLIC_URL = 'https://avi-relay.projpw.workers.dev/mcp';

export function RemoteSettings() {
  const [state, setState] = useState(null);
  const [port, setPort] = useState('18992');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const keyMenuRef = useRef(null);
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

  useEffect(() => {
    if (!openMenuId) return undefined;
    const close = (event) => {
      if (!keyMenuRef.current?.contains(event.target)) setOpenMenuId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuId]);

  async function mutate(action) {
    setBusy(true);
    setCopied(null);
    setOpenMenuId(null);
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
            <p>Connect MCP and RPC clients on this computer.</p>
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

      </div>

      <section className="settings-section-card settings-row-card" aria-labelledby="aivax-remote-heading">
        <div className="settings-card-row remote-header">
          <div className="remote-heading">
            <h3 id="aivax-remote-heading">AIVAX Remote</h3>
            <p>Access this device through your AIVAX account.</p>
          </div>
          <label className="remote-switch">
            <input
              type="checkbox"
              aria-label="AIVAX Remote MCP and RPC bridge"
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
        <div className="settings-card-row">
          <div className="remote-row-copy">
            <span role="status">
              {{
                stopped: 'Inactive',
                unauthorized: 'Unavailable',
                connecting: 'Connecting...',
                connected: 'Connected',
                reconnecting: 'Connecting...',
                error: 'Unavailable',
              }[state.relay?.status ?? 'stopped']}
            </span>
            <span>Device ID: {state.relayDeviceId}</span>
          </div>
        </div>
        <div className="settings-card-row">
            <div className="remote-row-copy" aria-labelledby="remote-connect-heading">
              <strong id="remote-connect-heading">How to connect</strong>
              <div className="remote-row-copy">
                <strong>With an AIVAX API key</strong>
                {state.relay?.mcpUrl && <span>MCP URL: {state.relay.mcpUrl}</span>}
                <span>Authenticate with your AIVAX bearer token.</span>
                <strong>With an MCP instance key</strong>
                <span>Public MCP URL: {REMOTE_MCP_PUBLIC_URL}</span>
                <span>Copy MCP instance key from the API keys menu below.</span>
                <span>Pass instanceKey with every tool call: instanceId@key.</span>
                <span>Instance ID: {state.instanceId}</span>
                {state.relay?.status === 'unauthorized' && <span>Reconnect your AIVAX account.</span>}
                {state.relay?.error && <span>Diagnostic: {state.relay.error}</span>}
              </div>
            </div>
        </div>
      </section>

      <div className="settings-section-card settings-row-card">
        <div className="settings-card-row">
          <div className="remote-row-copy">
            <strong>API keys</strong>
            <span>Keys authenticate local MCP and RPC clients; the public MCP URL uses their MCP instance keys.</span>
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
              {copied?.id === key.id && (
                <span role="status">Copied {copied.kind === 'instance' ? 'MCP instance key' : 'API key'}</span>
              )}
            </div>
            <div
              className="remote-key-menu"
              ref={openMenuId === key.id ? keyMenuRef : undefined}
            >
              <button
                className="remote-action"
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenuId === key.id}
                aria-label={`API key actions for ${key.label || 'API key'}`}
                disabled={busy}
                onClick={() => setOpenMenuId(openMenuId === key.id ? null : key.id)}
              >
                <MoreVertical size={14} />
              </button>
              {openMenuId === key.id && (
                <DropdownMenu role="menu" aria-label="API key actions">
                  <DropdownMenuItem
                    icon={<Copy size={14} />}
                    role="menuitem"
                    onClick={async () => {
                      const result = await mutate(() => window.chatApp.remote.copyKey(key.id));
                      if (result?.copied) setCopied({ id: key.id, kind: 'api' });
                    }}
                  >
                    Copy API key
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<KeyRound size={14} />}
                    role="menuitem"
                    onClick={async () => {
                      const result = await mutate(() => window.chatApp.remote.copyInstanceKey(key.id));
                      if (result?.copied) setCopied({ id: key.id, kind: 'instance' });
                    }}
                  >
                    Copy MCP instance key
                  </DropdownMenuItem>
                  <hr className="dropdown-menu-divider" />
                  <DropdownMenuItem
                    icon={<Trash2 size={14} />}
                    role="menuitem"
                    className="danger"
                    onClick={() => mutate(() => window.chatApp.remote.removeKey(key.id))}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenu>
              )}
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
            <span>Expiration is optional. New keys are 6 characters (a–z, 0–9); existing keys keep working.</span>
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
        API key secrets are never displayed. Use each key menu to copy the API key, or its MCP instance key for the public MCP URL.
      </p>
      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </section>
  );
}
