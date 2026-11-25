import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { Presence } from './Overlay.jsx';
import { ProfileAvatar, ProfileDialog, useProfiles } from './ProfileMenu.jsx';

export function ProfilesSettings() {
  const [state, , loadError] = useProfiles();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [dialogProfile, setDialogProfile] = useState(null);

  async function run(action) {
    setBusy(true);
    setStatus('');
    setError('');
    try {
      setStatus(await action() ?? '');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="settings-section profiles-settings">
        <div className="settings-empty">Loading profiles...</div>
        {loadError && <div className="settings-context-error" role="alert">{loadError}</div>}
      </section>
    );
  }

  return (
    <section className="settings-section profiles-settings">
      <div className="settings-section-heading">
        <h3>Import</h3>
        <p>Add a profile from an <code>.aviprofile</code> file. It opens as a new profile and never replaces an existing one.</p>
      </div>
      <div className="settings-section-card settings-row-card">
        <div className="settings-card-row">
          <div className="remote-row-copy">
            <strong>Import profile</strong>
            <span>Provider credentials and API keys are not included in exports; sign in again after importing.</span>
          </div>
          <button className="button" type="button" disabled={busy} onClick={() => run(async () => {
            const result = await window.chatApp.profiles.import();
            const imported = result?.profiles.find((profile) => profile.id === result.importedId);
            return imported ? `Imported ${imported.name}.` : '';
          })}>
            <Upload size={14} />
            Import
          </button>
        </div>
      </div>

      <div className="settings-section-heading">
        <h3>Export</h3>
        <p>Save a profile's conversations, settings, bots, and media to a file. Open Avi in that profile at least once before exporting it.</p>
      </div>
      <div className="settings-section-card settings-row-card">
        {state.profiles.map((profile) => (
          <div className="settings-card-row" key={profile.id}>
            <div className="profiles-settings-name">
              <ProfileAvatar color={profile.color} size={24} />
              <div className="remote-row-copy">
                <strong>{profile.name}</strong>
                <span>{profile.id === state.activeId ? 'Current profile' : profile.running ? 'Open in another window' : 'Closed'}</span>
              </div>
            </div>
            <span className="profiles-settings-actions">
              {!profile.isDefault && (
                <button className="button" type="button" disabled={busy} onClick={() => setDialogProfile(profile)}>
                  Edit
                </button>
              )}
              <button className="button" type="button" disabled={busy} onClick={() => run(async () => {
                const result = await window.chatApp.profiles.export(profile.id);
                return result ? `Exported ${profile.name} to ${result.path}.` : '';
              })}>
                <Download size={14} />
                Export
              </button>
            </span>
          </div>
        ))}
      </div>
      {busy && <p className="profiles-settings-status" role="status">Working...</p>}
      {!busy && status && <p className="profiles-settings-status" role="status">{status}</p>}
      {error && <div className="settings-context-error" role="alert">{error}</div>}
      <Presence when={dialogProfile}>{(profile) => (
        <ProfileDialog profile={profile} onClose={() => setDialogProfile(null)} />
      )}</Presence>
    </section>
  );
}
