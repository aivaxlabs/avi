import {
  ArrowRight,
  CheckCircle2,
  CircleOff,
  Eye,
  Folder,
  KeyRound,
  Pencil,
  RefreshCw,
  Save,
  Server,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
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

function serverStatusLabel(server) {
  return server.lifecycle === 'passive' && server.status === 'idle'
    ? 'Passive'
    : statusLabels[server.status] ?? server.status;
}

export function McpSettings({ initialFolder = null, botId = null, onNavigationChange }) {
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(initialFolder);
  const [folder, setFolder] = useState(null);
  const [inheritedServers, setInheritedServers] = useState([]);
  const [draft, setDraft] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setBusy(true);
    window.chatApp.mcp.folders()
      .then((items) => {
        if (active) setFolders(items);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedFolder) return undefined;
    let active = true;
    const load = () => Promise.all([
      botId
        ? window.chatApp.mcp.bot(botId)
        : window.chatApp.mcp.folder(selectedFolder.path),
      botId
        ? window.chatApp.mcp.workspace(selectedFolder.path)
        : Promise.resolve([]),
    ]).then(([value, inherited]) => {
      if (!active) return;
      setFolder(value);
      setInheritedServers(inherited.filter((server) => server.scope !== 'bot'));
    });
    load().catch((nextError) => {
      if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
    });
    const unsubscribe = window.chatApp.onMcpEvent((event) => {
      if (event.type !== 'state') return;
      load().catch(() => {});
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [botId, selectedFolder]);

  useEffect(() => {
    if (draft) {
      onNavigationChange({
        title: draft.previousName
          ? `Edit ${draft.name || draft.previousName}`
          : 'Add MCP server',
        description: folder?.configPath ?? '',
        backLabel: 'Back to servers',
        onBack: () => setDraft(null),
      });
    } else if (inspection) {
      onNavigationChange({
        title: inspection.name,
        description: `${serverStatusLabel(inspection)} · ${inspection.toolCount} tools`,
        backLabel: 'Back to servers',
        onBack: () => setInspection(null),
      });
    } else if (selectedFolder) {
      onNavigationChange({
        title: selectedFolder.name,
        description: folder?.configPath ?? '',
        backLabel: 'Back to scopes',
        onBack: () => {
          setSelectedFolder(null);
          setFolder(null);
          setError('');
        },
        actionLabel: 'Add server',
        onAction: () => editServer({
          name: '',
          config: {
            type: 'stdio',
            enabled: true,
            command: '',
            args: [],
            cwd: '',
            env: {},
          },
        }),
      });
    } else {
      onNavigationChange({
        title: 'MCP servers',
        description: 'Manage global and per-folder Model Context Protocol servers.',
      });
    }

    return () => onNavigationChange(null);
  }, [
    draft?.name,
    draft?.previousName,
    folder?.configPath,
    inspection?.name,
    inspection?.status,
    inspection?.toolCount,
    onNavigationChange,
    selectedFolder,
  ]);

  async function runMutation(mutation) {
    setBusy(true);
    setError('');
    try {
      const value = await mutation();
      if (value?.servers) setFolder(value);
      return value;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function editServer(server) {
    const config = server.config;
    setDraft({
      previousName: server.name,
      name: server.name,
      type: config.type,
      enabled: config.enabled,
      lifecycle: config.lifecycle ?? 'active',
      command: config.command ?? '',
      args: (config.args ?? []).join('\n'),
      cwd: config.cwd ?? '',
      env: pairsText(config.env),
      url: config.url ?? '',
      headers: pairsText(config.headers),
      authType: config.auth?.type ?? 'auto',
      token: config.auth?.token ?? '',
      clientId: config.auth?.clientId ?? '',
      clientSecret: config.auth?.clientSecret ?? '',
    });
    setInspection(null);
    setError('');
  }

  async function inspectServer(serverKey) {
    setBusy(true);
    setError('');
    try {
      setInspection(await window.chatApp.mcp.inspect(serverKey));
      setDraft(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  if (!selectedFolder) {
    return (
      <section className="settings-section mcp-settings">
        <div className="settings-list-summary">
          <span>{folders.length} {folders.length === 1 ? 'scope' : 'scopes'}</span>
          <span>Global and per-folder configuration</span>
        </div>
        {busy ? (
          <div className="settings-empty">Loading MCP scopes...</div>
        ) : (
          <div className="settings-entity-list">
            {folders.map((item) => (
              <article className="settings-entity-row settings-context-folder-row" key={item.path}>
                <button
                  className="settings-entity-main"
                  type="button"
                  onClick={() => {
                    setSelectedFolder(item);
                    setFolder(null);
                    setError('');
                  }}
                >
                  <span className="settings-entity-icon"><Folder size={16} /></span>
                  <span className="settings-entity-copy">
                    <strong>{item.name}</strong>
                    <small>{item.displayPath}</small>
                  </span>
                  <span className="settings-context-summary">
                    {item.serverCount} configured · {item.activeCount} connected
                  </span>
                  <ArrowRight className="settings-entity-arrow" size={15} />
                </button>
              </article>
            ))}
          </div>
        )}
        {error && <div className="settings-context-error" role="alert">{error}</div>}
      </section>
    );
  }

  if (draft) {
    return (
      <section className="settings-section mcp-settings">
        <div className="settings-section-card">
          <div className="settings-form">
            <label className="settings-field">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Contorso Inc"
              />
            </label>
            <label className="settings-field">
              <span>Transport</span>
              <select
                value={draft.type}
                onChange={(event) => setDraft({ ...draft, type: event.target.value })}
              >
                <option value="stdio">stdio</option>
                <option value="streamable-http">Streamable HTTP</option>
                <option value="sse">SSE (legacy)</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Lifecycle</span>
              <select
                value={draft.lifecycle}
                onChange={(event) => setDraft({ ...draft, lifecycle: event.target.value })}
              >
                <option value="active">Active</option>
                <option value="passive">Passive</option>
              </select>
              <small>Passive servers expose only an activation tool until the agent enables them.</small>
            </label>

            {draft.type === 'stdio' ? (
              <>
                <label className="settings-field settings-field-wide">
                  <span>Executable</span>
                  <input
                    value={draft.command}
                    onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                    placeholder="bunx"
                  />
                </label>
                <label className="settings-field settings-field-wide">
                  <span>Arguments</span>
                  <textarea
                    value={draft.args}
                    onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                    placeholder={'-y\n@contorso/mcp-server'}
                  />
                  <small>One argument per line.</small>
                </label>
                <label className="settings-field settings-field-wide">
                  <span>Working directory</span>
                  <input
                    value={draft.cwd}
                    onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                    placeholder={selectedFolder.path}
                  />
                </label>
                <label className="settings-field settings-field-wide">
                  <span>Environment variables</span>
                  <textarea
                    value={draft.env}
                    onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                    placeholder="API_TOKEN=value"
                    autoComplete="off"
                  />
                  <small>One NAME=value pair per line.</small>
                </label>
              </>
            ) : (
              <>
                <label className="settings-field settings-field-wide">
                  <span>URL</span>
                  <input
                    type="url"
                    value={draft.url}
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                    placeholder="https://example.com/mcp"
                  />
                </label>
                <label className="settings-field">
                  <span>Authentication</span>
                  <select
                    value={draft.authType}
                    onChange={(event) => setDraft({ ...draft, authType: event.target.value })}
                  >
                    <option value="auto">Automatic</option>
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="oauth2">OAuth 2.0</option>
                  </select>
                </label>
                {draft.authType === 'bearer' && (
                  <label className="settings-field">
                    <span>Bearer token</span>
                    <input
                      type="password"
                      value={draft.token}
                      onChange={(event) => setDraft({ ...draft, token: event.target.value })}
                      autoComplete="off"
                    />
                  </label>
                )}
                {draft.authType === 'oauth2' && (
                  <>
                    <label className="settings-field">
                      <span>Client ID</span>
                      <input
                        value={draft.clientId}
                        onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
                        placeholder="Optional with dynamic registration"
                      />
                    </label>
                    <label className="settings-field">
                      <span>Client secret</span>
                      <input
                        type="password"
                        value={draft.clientSecret}
                        onChange={(event) => setDraft({
                          ...draft,
                          clientSecret: event.target.value,
                        })}
                        autoComplete="off"
                      />
                    </label>
                  </>
                )}
                <label className="settings-field settings-field-wide">
                  <span>HTTP headers</span>
                  <textarea
                    value={draft.headers}
                    onChange={(event) => setDraft({ ...draft, headers: event.target.value })}
                    placeholder="X-Workspace=value"
                    autoComplete="off"
                  />
                  <small>One NAME=value pair per line.</small>
                </label>
              </>
            )}
          </div>
        </div>
        {error && <div className="settings-context-error" role="alert">{error}</div>}
        <div className="mcp-editor-actions">
          <button
            className="primary-mini"
            type="button"
            disabled={busy}
            onClick={async () => {
              const value = await runMutation(async () => {
                const config = draft.type === 'stdio'
                ? {
                    type: draft.type,
                    enabled: draft.enabled,
                    lifecycle: draft.lifecycle,
                    command: draft.command,
                    args: draft.args.split(/\r?\n/).filter((value) => value.length > 0),
                    cwd: draft.cwd,
                    env: parsePairs(draft.env),
                  }
                : {
                    type: draft.type,
                    enabled: draft.enabled,
                    lifecycle: draft.lifecycle,
                    url: draft.url,
                    headers: parsePairs(draft.headers),
                    auth: {
                      type: draft.authType,
                      token: draft.token,
                      clientId: draft.clientId,
                      clientSecret: draft.clientSecret,
                    },
                  };
                return window.chatApp.mcp.save({
                  folderPath: selectedFolder.path,
                  botId,
                  previousName: draft.previousName,
                  server: { name: draft.name, config },
                });
              });
              if (value) setDraft(null);
            }}
          >
            <Save size={14} />
            {busy ? 'Saving...' : 'Save server'}
          </button>
        </div>
      </section>
    );
  }

  if (inspection) {
    return (
      <section className="settings-section mcp-settings">
        {inspection.instructions && (
          <div className="settings-section-card mcp-inspection-section">
            <h4>Server instructions</h4>
            <pre>{inspection.instructions}</pre>
          </div>
        )}
        <div className="settings-section-card mcp-inspection-section">
          <h4>Tools</h4>
          {inspection.tools.length > 0 ? inspection.tools.map((tool) => (
            <details key={tool.exposedName}>
              <summary>
                <strong>{tool.name}</strong>
                <code>{tool.exposedName}</code>
              </summary>
              {tool.description && <p>{tool.description}</p>}
              <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
            </details>
          )) : <p className="settings-context-group-empty">No tools reported.</p>}
        </div>
        <div className="settings-section-card mcp-inspection-section">
          <h4>Error log</h4>
          {inspection.logs.length > 0 ? (
            <pre>{inspection.logs.map((entry) => (
              `[${entry.at}] [${entry.level.toUpperCase()}] ${entry.message}`
            )).join('\n')}</pre>
          ) : <p className="settings-context-group-empty">No log entries.</p>}
        </div>
        {error && <div className="settings-context-error" role="alert">{error}</div>}
      </section>
    );
  }

  return (
    <section className="settings-section mcp-settings">
      {!folder ? (
        <div className="settings-empty">Loading MCP servers...</div>
      ) : (
        <div className="settings-entity-list">
          {botId && (
            <div className="mcp-scope-heading">
              <strong>Workspace servers</strong>
              <small>Inherited by the bot and managed in workspace settings.</small>
            </div>
          )}
          {inheritedServers.map((server) => (
            <article
              className={classNames(
                'settings-entity-row',
                !server.enabled && 'disabled',
                server.status === 'error' && 'mcp-server-error',
              )}
              key={server.key}
            >
              <button
                className="settings-entity-main mcp-server-main"
                type="button"
                onClick={() => inspectServer(server.key)}
              >
                <span className="settings-entity-icon"><Server size={16} /></span>
                <span className="settings-entity-copy">
                  <strong>{server.name}</strong>
                  <small>{server.type} · {server.toolCount} tools · {server.scope === 'global' ? 'Global' : 'Workspace'}</small>
                </span>
                <span className={classNames('settings-status', server.status)}>
                  {serverStatusLabel(server)}
                </span>
                <ArrowRight className="settings-entity-arrow" size={15} />
              </button>
            </article>
          ))}
          {botId && inheritedServers.length === 0 && (
            <div className="settings-empty">No workspace MCP servers inherited.</div>
          )}
          {botId && (
            <div className="mcp-scope-heading">
              <strong>Bot servers</strong>
              <small>Exclusive to this bot and available after workspace servers.</small>
            </div>
          )}
          {folder.servers.map((server) => (
            <article
              className={classNames(
                'settings-entity-row',
                !server.enabled && 'disabled',
                server.status === 'error' && 'mcp-server-error',
              )}
              key={server.key}
            >
              <button
                className="settings-entity-main mcp-server-main"
                type="button"
                onClick={() => inspectServer(server.key)}
              >
                <span className="settings-entity-icon"><Server size={16} /></span>
                <span className="settings-entity-copy">
                  <strong>{server.name}</strong>
                  <small>
                    {server.type} · {server.toolCount} tools{server.lifecycle === 'passive' ? ' · Passive' : ''}
                  </small>
                </span>
                <span className={classNames('settings-status', server.status)}>
                  {serverStatusLabel(server)}
                </span>
                <ArrowRight className="settings-entity-arrow" size={15} />
              </button>
              <div className="mcp-server-actions">
                {server.status === 'auth-required' && (
                  <button
                    className="icon-button tiny"
                    type="button"
                    title="Authenticate"
                    aria-label={`Authenticate ${server.name}`}
                    onClick={() => runMutation(() => window.chatApp.mcp.authenticate(server.key))}
                  >
                    <KeyRound size={14} />
                  </button>
                )}
                <button
                  className="icon-button tiny"
                  type="button"
                  title="Inspect"
                  aria-label={`Inspect ${server.name}`}
                  onClick={() => inspectServer(server.key)}
                >
                  <Eye size={14} />
                </button>
                <button
                  className="icon-button tiny"
                  type="button"
                  title="Edit"
                  aria-label={`Edit ${server.name}`}
                  onClick={() => editServer(server)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-button tiny"
                  type="button"
                  title="Restart"
                  aria-label={`Restart ${server.name}`}
                  disabled={busy || !server.enabled}
                  onClick={() => runMutation(async () => {
                    await window.chatApp.mcp.restart(server.key);
                    return botId
                      ? window.chatApp.mcp.bot(botId)
                      : window.chatApp.mcp.folder(selectedFolder.path);
                  })}
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  className="icon-button tiny"
                  type="button"
                  title={server.enabled ? 'Disable' : 'Enable'}
                  aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
                  disabled={busy}
                  onClick={() => runMutation(() => window.chatApp.mcp.enabled({
                    serverKey: server.key,
                    enabled: !server.enabled,
                  }))}
                >
                  {server.enabled ? <CircleOff size={14} /> : <CheckCircle2 size={14} />}
                </button>
                <button
                  className="icon-button tiny danger"
                  type="button"
                  title="Remove"
                  aria-label={`Remove ${server.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Remove MCP server "${server.name}"?`)) return;
                    runMutation(() => window.chatApp.mcp.remove({
                      folderPath: selectedFolder.path,
                      botId,
                      name: server.name,
                    }));
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {server.error && <p className="mcp-server-message">{server.error}</p>}
            </article>
          ))}
          {folder.servers.length === 0 && (
            <div className="settings-empty">
              {botId
                ? 'No MCP servers configured exclusively for this bot.'
                : 'No MCP servers configured in this scope.'}
            </div>
          )}
        </div>
      )}
      {error && <div className="settings-context-error" role="alert">{error}</div>}
    </section>
  );
}

function pairsText(value = {}) {
  return Object.entries(value).map(([key, item]) => `${key}=${item}`).join('\n');
}

function parsePairs(value) {
  return Object.fromEntries(
    String(value)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const equalsIndex = line.indexOf('=');
        const colonIndex = line.indexOf(':');
        const separatorIndex = [equalsIndex, colonIndex]
          .filter((index) => index >= 0)
          .reduce((first, index) => Math.min(first, index), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(separatorIndex) || separatorIndex <= 0) {
          throw new Error(`Expected NAME=value, received "${line}".`);
        }
        return [
          line.slice(0, separatorIndex).trim(),
          line.slice(separatorIndex + 1).trim(),
        ];
      }),
  );
}
