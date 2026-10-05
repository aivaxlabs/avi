import { resolveDynamicContext } from './context-injection.js';

export const REASONING_EFFORTS = Object.freeze([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

// Harness responsibilities a provider type covers. Avi always executes tools and owns compaction; providers may own sessions and retries.
export const PROVIDER_HARNESS_DEFAULTS = Object.freeze({
  session: 'stateless',
  retries: 'avi',
  compaction: 'avi',
  instructions: 'system',
  toolExecution: 'avi',
});

const PROVIDER_HARNESS_VALUES = Object.freeze({
  session: ['stateless', 'stateful'],
  retries: ['avi', 'provider'],
  compaction: ['avi'],
  instructions: ['system', 'context'],
  toolExecution: ['avi'],
});

export function normalizeProviderHarness(harness) {
  if (harness == null) return PROVIDER_HARNESS_DEFAULTS;
  if (typeof harness !== 'object' || Array.isArray(harness)) {
    throw new Error('Provider harness must be an object.');
  }
  const unknown = Object.keys(harness).find((key) => !Object.hasOwn(PROVIDER_HARNESS_VALUES, key));
  if (unknown) throw new Error(`Unknown provider harness capability "${unknown}".`);
  return Object.freeze(Object.fromEntries(Object.entries(PROVIDER_HARNESS_VALUES).map(([key, values]) => {
    const value = harness[key] ?? PROVIDER_HARNESS_DEFAULTS[key];
    if (!values.includes(value)) {
      throw new Error(`Provider harness "${key}" must be one of: ${values.join(', ')}.`);
    }
    return [key, value];
  })));
}

export function defineProvider(provider) {
  if (
    !provider?.descriptor?.id
    || !provider.descriptor.name
    || typeof provider.createBody !== 'function'
    || typeof provider.request !== 'function'
    || typeof provider.eventsFrom !== 'function'
  ) {
    throw new Error('Invalid model provider contract.');
  }
  if (provider.descriptor.supportsModelListing === true && typeof provider.listAvailableModels !== 'function') {
    throw new Error('Providers that support model listing must implement listAvailableModels.');
  }
  normalizeProviderHarness(provider.descriptor.harness);
  return Object.freeze(provider);
}

export async function prepareProviderInvocation(invocationContext) {
  return {
    dynamicContext: await resolveDynamicContext(invocationContext),
  };
}
