import {
  CircleOff,
  FolderCog,
  KeyRound,
  LoaderCircle,
  PlugZap,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { classNames } from '../lib/format.js';

const statusLabels = {
  idle: 'Not started',
  starting: 'Starting',
  ready: 'Connected',
  'auth-required': 'Authentication required',
  error: 'Failed',
  disabled: 'Disabled',
  shadowed: 'Overridden by folder',
};

export function McpOverlay({
  state,
  waitingCount,
  alert,
  workspaceServers,
  onCloseAlert,
  onCloseWorkspace,
  onAuthenticate,
  onDisable,
  onOpenSettings,
}) {
  const dialogRef = useRef(null);
  const dialogOpen = Boolean(alert || workspaceServers);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => (
      dialogRef.current?.querySelector('.primary-mini, button')?.focus()
    ));
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (alert?.type === 'auth-required') return;
      if (alert) onCloseAlert();
      else onCloseWorkspace();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus?.();
    };
  }, [alert?.type, dialogOpen]);

  return (
    <>
      {(state?.loadingCount > 0 || waitingCount > 0) && (
        <div className="mcp-progress" role="status" aria-live="polite">
          <LoaderCircle size={15} />
          <span>
            {waitingCount > 0
              ? `Waiting for MCP servers before sending ${waitingCount === 1 ? 'a message' : `${waitingCount} messages`}...`
              : `Starting ${state.loadingCount} MCP ${state.loadingCount === 1 ? 'server' : 'servers'}...`}
          </span>
        </div>
      )}

      {alert && (
        <div className="dialog-backdrop mcp-dialog-backdrop">
          <section
            ref={dialogRef}
            className="mcp-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="mcp-alert-title"
            aria-describedby="mcp-alert-description"
          >
            <div className="mcp-dialog-icon">
              {alert.type === 'auth-required' ? <KeyRound size={20} /> : <PlugZap size={20} />}
            </div>
            <div className="mcp-dialog-copy">
              <h2 id="mcp-alert-title">
                {alert.type === 'auth-required'
                  ? `${alert.server.name} needs authentication`
                  : `${alert.servers?.length === 1 ? 'MCP server' : 'MCP servers'} failed to start`}
              </h2>
              {alert.type === 'auth-required' ? (
                <p id="mcp-alert-description">
                  Authenticate in your browser, or disable this server without removing its configuration.
                </p>
              ) : (
                <div id="mcp-alert-description">
                  {alert.message && <p>{alert.message}</p>}
                  {alert.servers?.length > 0 && (
                    <ul>
                      {alert.servers.map((server) => (
                        <li key={server.key}>
                          <strong>{server.name}</strong>
                          <span>{server.error || 'Unknown initialization error.'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="mcp-dialog-actions">
              {alert.type === 'auth-required' ? (
                <>
                  <button
                    type="button"
                    onClick={() => onDisable(alert.server.key)}
                  >
                    <CircleOff size={14} />
                    Disable
                  </button>
                  <button
                    className="primary-mini"
                    type="button"
                    onClick={() => onAuthenticate(alert.server.key)}
                  >
                    <KeyRound size={14} />
                    Authenticate
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={onCloseAlert}>
                    Close
                  </button>
                  <button className="primary-mini" type="button" onClick={onOpenSettings}>
                    <FolderCog size={14} />
                    Open MCP settings
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {workspaceServers && !alert && (
        <div className="dialog-backdrop mcp-dialog-backdrop" onMouseDown={onCloseWorkspace}>
          <section
            ref={dialogRef}
            className="mcp-dialog mcp-status-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-status-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="mcp-status-title">MCP servers in this conversation</h2>
                <p>Global servers and servers configured for the current folder.</p>
              </div>
              <button type="button" aria-label="Close" onClick={onCloseWorkspace}>
                <X size={16} />
              </button>
            </header>
            <div className="mcp-status-list">
              {workspaceServers.map((server) => (
                <article key={server.key}>
                  <span className="mcp-status-server-icon"><PlugZap size={15} /></span>
                  <span>
                    <strong>{server.name}</strong>
                    <small>
                      {server.scope === 'global' ? 'Global' : 'Folder'} · {server.toolCount} tools
                      {server.lifecycle === 'passive' ? ' · Passive' : ''}
                    </small>
                  </span>
                  <span className={classNames('settings-status', server.status)}>
                    {server.lifecycle === 'passive' && server.status === 'idle'
                      ? 'Passive'
                      : statusLabels[server.status] ?? server.status}
                  </span>
                </article>
              ))}
              {workspaceServers.length === 0 && (
                <div className="settings-empty">No MCP servers apply to this conversation.</div>
              )}
            </div>
            <div className="mcp-dialog-actions">
              <button type="button" onClick={onOpenSettings}>
                <FolderCog size={14} />
                Manage servers
              </button>
              <button className="primary-mini" type="button" onClick={onCloseWorkspace}>
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
