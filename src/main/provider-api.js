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
  return Object.freeze(provider);
}

export async function prepareProviderInvocation(invocationContext) {
  return {
    dynamicContext: await resolveDynamicContext(invocationContext),
  };
}
