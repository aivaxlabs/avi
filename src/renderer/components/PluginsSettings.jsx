import { AlertTriangle, BookOpen, FileCode2, FolderOpen, PackagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PluginsSettings() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => window.chatApp.plugins.list().then(setState).catch((nextError) => {
    setError(nextError instanceof Error ? nextError.message : String(nextError));
  });

  useEffect(() => { load(); }, []);

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

  const plugins = state?.plugins ?? [];
  const failures = state?.failures ?? [];
  const directory = state?.directory ?? state?.pluginsDir;

  return (
    <div className="plugins-settings">
      <div className="plugins-trust-warning" role="note">
        <AlertTriangle size={18} />
        <div><strong>Plugins are trusted code</strong><p>Only install JavaScript files you trust. Plugins run with Avi’s desktop permissions and load when Avi starts.</p></div>
      </div>
      <section className="settings-section">
        <div className="settings-section-heading"><h3>Installed plugins</h3><p>{directory || 'Loading plugin directory...'}</p></div>
        <div className="plugins-actions">
          <button className="primary-mini" type="button" disabled={busy} onClick={sideload}><PackagePlus size={14} />{busy ? 'Selecting...' : 'Sideload .js'}</button>
          <button className="secondary-mini" type="button" onClick={() => window.chatApp.plugins.docs()}><BookOpen size={14} />Plugin docs</button>
        </div>
        {state?.restartRequired && <div className="plugins-restart"><AlertTriangle size={15} />Restart Avi to load the newly sideloaded plugin.</div>}
        {error && <div className="settings-context-error" role="alert">{error}</div>}
        <div className="plugins-list">
          {plugins.map((plugin) => {
            const capabilities = Array.isArray(plugin.capabilities)
              ? plugin.capabilities
              : Object.entries(plugin.contributions ?? {})
                .filter(([, count]) => Number(count) > 0)
                .map(([capability]) => capability);
            return (
              <article className="settings-section-card plugin-card" key={plugin.id || plugin.fileName}>
                <FileCode2 size={18} />
                <div className="plugin-card-main">
                  <div className="plugin-card-title"><strong>{plugin.name || plugin.id || plugin.fileName}</strong>{plugin.version && <span>{plugin.version}</span>}<span className={`plugin-status ${plugin.status || 'loaded'}`}>{plugin.status || 'loaded'}</span></div>
                  {plugin.description && <p>{plugin.description}</p>}
                  <small>{plugin.fileName}</small>
                  {!!capabilities.length && <div className="plugin-capabilities">{capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>}
                  {plugin.error && <div className="plugin-error">{plugin.error}</div>}
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
