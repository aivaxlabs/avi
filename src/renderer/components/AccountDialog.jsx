import { LogOut, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { classNames, formatPrice, formatQuota } from '../lib/format.js';

const tabs = ['Account', 'Usage'];

export function AccountDialog({ account, onClose, onLogout }) {
  const [tab, setTab] = useState('Account');
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');

  useEffect(() => {
    loadUsage();
  }, []);

  async function loadUsage() {
    setUsageLoading(true);
    setUsageError('');
    try {
      setUsage(await window.aivax.account.balance());
    } catch (error) {
      setUsage(null);
      setUsageError(error instanceof Error ? error.message : String(error));
    } finally {
      setUsageLoading(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="account-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Account</h2>
            <p>{account?.email || 'AIVAX account'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="account-body">
          <div className="account-tabs">
            {tabs.map((item) => (
              <button
                key={item}
                className={classNames(tab === item && 'active')}
                type="button"
                onClick={() => setTab(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="account-content">
            {tab === 'Account' ? (
              <div className="account-card">
                <div className="profile-row">
                  {account?.emailSha256 && (
                    <img src={`https://www.gravatar.com/avatar/${account.emailSha256}?d=identicon&s=96`} alt="" />
                  )}
                  <div>
                    <h3>{account?.name || 'Account'}</h3>
                    <p>{account?.plan || 'Plan'}</p>
                  </div>
                </div>
                <button className="danger-button" type="button" onClick={onLogout}>
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            ) : (
              <>
                <div className="usage-toolbar">
                  <button type="button" onClick={loadUsage} disabled={usageLoading}>
                    <RefreshCw size={14} />
                    {usageLoading ? 'Loading' : 'Refresh'}
                  </button>
                </div>
                <div className="usage-grid">
                  <Metric label="Balance" value={usageLoading ? 'Loading...' : formatPrice(usage?.balance)} />
                  <Metric label="Usage in 24h" value={usageLoading ? 'Loading...' : formatPrice(usage?.usage24h)} />
                  <Metric
                    label="Remaining storage quota"
                    value={usageLoading ? 'Loading...' : formatRemainingQuota(usage)}
                  />
                </div>
                {usageError && <div className="usage-error">{usageError}</div>}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatRemainingQuota(usage) {
  const included = usage?.planLimits?.includedStorage;
  const used = usage?.storageUsage;
  if (included === null || included === undefined || used === null || used === undefined) {
    return '—';
  }
  return formatQuota(Math.max(0, included - used));
}
