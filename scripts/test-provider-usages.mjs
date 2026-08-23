import assert from 'node:assert/strict';
import { listAivaxUsageProviders } from '../src/main/aivax-usage-provider.js';
import { ProviderUsageService } from '../src/main/provider-usage-service.js';
import { formatTimeRemaining } from '../src/renderer/lib/provider-usages.js';

let resetCalls = 0;
let snapshotVersion = 0;
const nativeUsageProvider = {
  id: 'native:usage',
  title: 'Native usage',
  source: 'provider',
  providerId: 'native',
};
const pluginUsageProvider = {
  id: 'plugin:demo:usage',
  title: 'Plugin usage',
  source: 'plugin',
  pluginId: 'demo',
};
const nativeSnapshot = () => ({
  accountDetails: 'Pro plan',
  limits: [{
    label: 'Weekly limit',
    description: `Snapshot ${snapshotVersion}`,
    amountConsumed: 0.25,
    resetsAt: new Date('2030-01-02T03:04:05.000Z'),
    resetList: [{
      resetTitle: 'Banked reset',
      resetDescription: 'Restores the active window.',
      resetType: 'Credit',
      resetExpiresAt: '2030-02-03T04:05:06.000Z',
      async onReset() {
        resetCalls += 1;
        snapshotVersion += 1;
        return { usage: nativeSnapshot(), message: 'Reset applied.' };
      },
    }],
  }],
  counters: [{ label: 'Requests', description: 'Current request count.', valueString: '1,234' }],
});
const pluginEntry = {
  descriptor: pluginUsageProvider,
  handlers: {
    load: async () => ({ accountDetails: 'Team account', limits: [], counters: [] }),
  },
};
const service = new ProviderUsageService({
  providerRegistry: {
    listUsageProviders: () => [nativeUsageProvider],
    readUsageProvider: async () => nativeSnapshot(),
  },
  pluginRuntime: {
    listUsageProviders: () => [pluginUsageProvider],
    getUsageProvider: (id) => id === pluginUsageProvider.id ? pluginEntry : null,
  },
});

assert.deepEqual(service.list(), [nativeUsageProvider, pluginUsageProvider]);
const initial = await service.read(nativeUsageProvider.id);
assert.equal(initial.accountDetails, 'Pro plan');
assert.equal(initial.limits[0].amountConsumed, 0.25);
assert.equal(initial.limits[0].resetsAt, '2030-01-02T03:04:05.000Z');
assert.equal(initial.limits[0].resetList[0].expiresAt, '2030-02-03T04:05:06.000Z');
assert.equal(initial.counters[0].valueString, '1,234');
assert.equal('onReset' in initial.limits[0].resetList[0], false);

const firstResetId = initial.limits[0].resetList[0].id;
const result = await service.reset(nativeUsageProvider.id, firstResetId);
assert.equal(resetCalls, 1);
assert.equal(result.message, 'Reset applied.');
assert.equal(result.usage.limits[0].description, 'Snapshot 1');
await assert.rejects(
  () => service.reset(nativeUsageProvider.id, firstResetId),
  /reset is unavailable/,
);

const refreshed = await service.read(nativeUsageProvider.id);
const staleResetId = refreshed.limits[0].resetList[0].id;
await service.read(nativeUsageProvider.id);
await assert.rejects(
  () => service.reset(nativeUsageProvider.id, staleResetId),
  /reset is unavailable/,
);

const plugin = await service.read(pluginUsageProvider.id);
assert.equal(plugin.title, 'Plugin usage');
assert.equal(plugin.accountDetails, 'Team account');

const invalidService = new ProviderUsageService({
  providerRegistry: {
    listUsageProviders: () => [{ id: 'invalid:usage', title: 'Invalid usage' }],
    readUsageProvider: async () => ({
      accountDetails: 'Invalid',
      limits: [{ label: 'Bad limit', amountConsumed: 101, resetList: [] }],
      counters: [],
    }),
  },
  pluginRuntime: { listUsageProviders: () => [], getUsageProvider: () => null },
});
await assert.rejects(() => invalidService.read('invalid:usage'), /between 0 and 1/);

const aivaxAccount = {
  balance: 8616.89967080991,
  usage24h: 30.41571623,
  plan: 'Max',
  storageUsage: 186933006,
  planLimits: { includedStorage: 21474836480 },
};
assert.deepEqual(listAivaxUsageProviders({
  accessToken: null,
  settings: { webSearchEnabled: true },
  requestBalance: async () => aivaxAccount,
}), []);
assert.deepEqual(listAivaxUsageProviders({
  accessToken: 'token',
  settings: {},
  requestBalance: async () => aivaxAccount,
}), []);
const aivaxProviders = listAivaxUsageProviders({
  accessToken: 'token',
  settings: { webSearchEnabled: true },
  requestBalance: async () => aivaxAccount,
});
assert.equal(aivaxProviders.length, 1);
assert.equal(aivaxProviders[0].id, 'application:aivax');
const aivaxUsage = await aivaxProviders[0].load();
assert.equal(aivaxUsage.accountDetails, 'Max plan');
assert.equal(aivaxUsage.limits.length, 1);
assert.equal(aivaxUsage.limits[0].label, 'Storage usage');
assert.equal(aivaxUsage.limits[0].description, '178.3 MB of 20 GB used.');
assert.equal(aivaxUsage.limits[0].amountConsumed, 186933006 / 21474836480);
assert.deepEqual(aivaxUsage.counters.map(({ label, valueString }) => ({ label, valueString })), [
  { label: 'Balance', valueString: '$8,616.90' },
  { label: 'Usage · last 24 hours', valueString: '$30.42' },
  { label: 'Available storage', valueString: '19.8 GB' },
]);

let applicationBalanceReads = 0;
const applicationService = new ProviderUsageService({
  providerRegistry: { listUsageProviders: () => [], readUsageProvider: async () => null },
  pluginRuntime: { listUsageProviders: () => [], getUsageProvider: () => null },
  getApplicationUsageProviders: () => listAivaxUsageProviders({
    accessToken: 'token',
    settings: { mediaDescriptionsEnabled: true },
    requestBalance: async () => {
      applicationBalanceReads += 1;
      return aivaxAccount;
    },
  }),
});
assert.deepEqual(applicationService.list(), [{ id: 'application:aivax', title: 'AIVAX usage' }]);
assert.equal(applicationBalanceReads, 0);
assert.equal((await applicationService.read('application:aivax')).counters.length, 3);
assert.equal(applicationBalanceReads, 1);

const countdownNow = new Date('2026-08-23T00:00:00.000Z').getTime();
assert.equal(
  formatTimeRemaining('2026-08-26T00:12:00.000Z', countdownNow),
  'in 3d',
);
assert.equal(
  formatTimeRemaining('2026-08-23T02:12:00.000Z', countdownNow),
  'in 2h',
);
assert.equal(
  formatTimeRemaining('2026-08-23T00:12:00.000Z', countdownNow),
  'in <1h',
);
assert.equal(formatTimeRemaining('2026-08-22T23:59:00.000Z', countdownNow), 'now');
assert.equal(formatTimeRemaining('invalid', countdownNow), '');

console.log('Provider usage checks passed.');
