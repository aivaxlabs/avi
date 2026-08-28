import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  FileCode2,
  FolderOpen,
  PackagePlus,
  Power,
  PowerOff,
  RefreshCw,
  Settings2,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { PluginSettingsEditor } from './PluginSettingsEditor.jsx';

export function PluginsSettings() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pluginBusy, setPluginBusy] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState(null);
  const [developerToolsOpen, setDeveloperToolsOpen] = useState(false);
  const developerToolsRef = useRef(null);
  const load = () => window.chatApp.plugins.list().then(setState).catch((nextError) => {
    setError(nextError instanceof Error ? nextError.message : String(nextError));
  });

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!developerToolsOpen) return undefined;
    const close = (event) => {
      if (!developerToolsRef.current?.contains(event.target)) setDeveloperToolsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [developerToolsOpen]);

  const runDeveloperTool = async (action) => {
    setDeveloperToolsOpen(false);
    setError('');
    try {
      await window.chatApp.plugins[action]();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const sideload = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.chatApp.plugins.sideload();
      if (result) setState(await window.chatApp.plugins.list());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const updatePlugin = async (plugin, action) => {
    setPluginBusy(`${action}:${plugin.id}`);
    setError('');
    try {
      const result = action === 'remove'
        ? await window.chatApp.plugins.remove({ id: plugin.id })
        : await window.chatApp.plugins.setEnabled({
          id: plugin.id,
          enabled: action === 'enable',
        });
      if (result) setState(await window.chatApp.plugins.list());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPluginBusy('');
    }
  };

  const plugins = state?.plugins ?? [];
  const failures = state?.failures ?? [];
  const directory = state?.directory ?? state?.pluginsDir;

  if (selectedPlugin) {
    return <PluginSettingsEditor plugin={selectedPlugin} onBack={() => setSelectedPlugin(null)} />;
  }

  return (
    <div className="plugins-settings">
      <div className="plugins-trust-warning" role="note">
        <AlertTriangle size={18} />
        <div><strong>Plugins are trusted code</strong><p>Only install JavaScript or ZIP packages you trust. Avi validates them by executing their entrypoint with desktop permissions.</p></div>
      </div>
      <section className="settings-section">
        <div className="settings-section-heading"><h3>Installed plugins</h3><p>{directory || 'Loading plugin directory...'}</p></div>
        <div className="plugins-actions">
          <button className="primary-mini" type="button" disabled={busy} onClick={sideload}><PackagePlus size={14} />{busy ? 'Selecting...' : 'Install .js or .zip'}</button>
          <div className="plugins-developer-tools" ref={developerToolsRef}>
            <button
              className="secondary-mini"
              type="button"
              aria-haspopup="menu"
              aria-expanded={developerToolsOpen}
              onClick={() => setDeveloperToolsOpen((open) => !open)}
            >
              <Wrench size={14} />Developer tools<ChevronDown size={13} />
            </button>
            {developerToolsOpen && (
              <DropdownMenu role="menu" aria-label="Plugin developer tools">
                <DropdownMenuItem icon={<RefreshCw size={14} />} role="menuitem" onClick={() => runDeveloperTool('restartAvi')}>Restart Avi</DropdownMenuItem>
                <DropdownMenuItem icon={<BookOpen size={14} />} role="menuitem" onClick={() => runDeveloperTool('docs')}>Open plugin docs</DropdownMenuItem>
                <DropdownMenuItem icon={<FileCode2 size={14} />} role="menuitem" onClick={() => runDeveloperTool('create')}>Create plugin</DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
        </div>
        {state?.restartRequired && <div className="plugins-restart"><AlertTriangle size={15} />Restart Avi to apply plugin changes.</div>}
        {error && <div className="settings-context-error" role="alert">{error}</div>}
        <div className="plugins-list">
          {plugins.map((plugin) => {
            const capabilities = Array.isArray(plugin.capabilities)
              ? plugin.capabilities
              : Object.entries(plugin.contributions ?? {})
                .filter(([, count]) => Number(count) > 0)
                .map(([capability]) => capability);
            return (
              <article className={`settings-section-card plugin-card ${plugin.enabled === false ? 'disabled' : ''}`} key={plugin.id}>
                <FileCode2 size={18} />
                <div className="plugin-card-main">
                  <div className="plugin-card-title"><strong>{plugin.name || plugin.id || plugin.fileName}</strong>{plugin.version && <span>{plugin.version}</span>}<span className={`plugin-status ${String(plugin.status || 'loaded').replaceAll(' ', '-')}`}>{plugin.status || 'loaded'}</span></div>
                  {plugin.description && <p>{plugin.description}</p>}
                  {plugin.enabled === false && !plugin.runtimeLoaded && <p>Disabled — this plugin's code was not executed.</p>}
                  <small>{plugin.id}/{plugin.fileName}</small>
                  {!!capabilities.length && <div className="plugin-capabilities">{capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>}
                  {plugin.error && <div className="plugin-error">{plugin.error}</div>}
                </div>
                <div className="plugin-card-actions">
                  {plugin.settings > 0 && plugin.enabled !== false && plugin.status === 'active' && (
                    <button
                      className="secondary-mini"
                      type="button"
                      disabled={!!pluginBusy}
                      onClick={() => setSelectedPlugin(plugin)}
                    >
                      <Settings2 size={14} />Settings
                    </button>
                  )}
                  <button
                    className="secondary-mini"
                    type="button"
                    disabled={!!pluginBusy}
                    onClick={() => updatePlugin(plugin, plugin.enabled === false ? 'enable' : 'disable')}
                  >
                    {plugin.enabled === false ? <Power size={14} /> : <PowerOff size={14} />}
                    {pluginBusy.endsWith(`:${plugin.id}`) && !pluginBusy.startsWith('remove:')
                      ? 'Saving...'
                      : plugin.enabled === false ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    className="secondary-mini danger"
                    type="button"
                    disabled={!!pluginBusy}
                    onClick={() => updatePlugin(plugin, 'remove')}
                  >
                    <Trash2 size={14} />{pluginBusy === `remove:${plugin.id}` ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              </article>
            );
          })}
          {state && plugins.length === 0 && <div className="settings-section-card plugins-empty"><FolderOpen size={18} />No plugins found.</div>}
        </div>
      </section>
      {!!failures.length && <section className="settings-section"><div className="settings-section-heading"><h3>Load failures</h3><p>These files could not be loaded at startup.</p></div>{failures.map((failure) => <div className="settings-context-error" role="alert" key={`${failure.id || ''}:${failure.fileName}`}><strong>{failure.id || failure.fileName || 'Plugin'}</strong>{failure.id && failure.fileName ? ` (${failure.fileName})` : ''}: {failure.error}</div>)}</section>}
    </div>
  );
}
