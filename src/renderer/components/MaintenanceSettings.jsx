import { useState } from 'react';
import { ArchiveSettings } from './ArchiveSettings.jsx';
import { SemaphoreSettings } from './SemaphoreSettings.jsx';

export function MaintenanceSettings() {
  const [tab, setTab] = useState('archive');

  return (
    <div className="maintenance-settings">
      <div className="maintenance-tabs" role="tablist" aria-label="Maintenance views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'archive'}
          onClick={() => setTab('archive')}
        >
          Archive
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'semaphores'}
          onClick={() => setTab('semaphores')}
        >
          Semaphores
        </button>
      </div>
      {tab === 'archive' ? <ArchiveSettings /> : <SemaphoreSettings />}
    </div>
  );
}
