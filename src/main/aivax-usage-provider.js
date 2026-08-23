const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const storageFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const storageUnits = Object.freeze(['B', 'KB', 'MB', 'GB', 'TB']);

function formatStorage(bytes) {
  const unitIndex = bytes > 0
    ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), storageUnits.length - 1)
    : 0;
  return `${storageFormatter.format(bytes / 1024 ** unitIndex)} ${storageUnits[unitIndex]}`;
}

export function listAivaxUsageProviders({ accessToken, settings, requestBalance }) {
  const active = Boolean(accessToken) && Boolean(
    settings?.memoryEnabled
    || settings?.advancedFetchEnabled
    || settings?.webSearchEnabled
    || settings?.mediaDescriptionsEnabled
    || settings?.threadSearchCollectionId,
  );
  if (!active) return [];

  return [{
    id: 'application:aivax',
    title: 'AIVAX usage',
    async load() {
      const account = await requestBalance();
      const balance = Number(account?.balance);
      const usage24h = Number(account?.usage24h);
      const storageUsage = Math.max(0, Number(account?.storageUsage) || 0);
      const includedStorage = Math.max(0, Number(account?.planLimits?.includedStorage) || 0);
      const availableStorage = Math.max(0, includedStorage - storageUsage);
      const storageConsumed = includedStorage > 0
        ? Math.min(storageUsage / includedStorage, 1)
        : 0;
      const plan = Array.isArray(account?.plan)
        ? account.plan.filter(Boolean).join(', ')
        : String(account?.plan ?? '').trim();

      return {
        accountDetails: plan ? `${plan} plan` : 'AIVAX account',
        limits: [{
          label: 'Storage usage',
          description: `${formatStorage(storageUsage)} of ${formatStorage(includedStorage)} used.`,
          amountConsumed: storageConsumed,
          resetsAt: null,
          resetList: [],
        }],
        counters: [
          {
            label: 'Balance',
            description: 'Current AIVAX account balance.',
            valueString: currencyFormatter.format(Number.isFinite(balance) ? balance : 0),
          },
          {
            label: 'Usage · last 24 hours',
            description: 'AIVAX consumption during the last 24 hours.',
            valueString: currencyFormatter.format(Number.isFinite(usage24h) ? usage24h : 0),
          },
          {
            label: 'Available storage',
            description: 'Included plan storage that is not currently in use.',
            valueString: formatStorage(availableStorage),
          },
        ],
      };
    },
  }];
}
