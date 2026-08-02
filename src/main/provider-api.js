import { interceptToolSchemas } from './client-tools.js';
import {
  resolveDynamicContext,
  resolveDynamicUserContext,
} from './context-injection.js';

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

export async function prepareProviderInvocation(tools, invocationContext) {
  const [dynamicContext, dynamicUserContext] = await Promise.all([
    resolveDynamicContext(invocationContext),
    resolveDynamicUserContext(invocationContext),
  ]);
  return {
    dynamicContext,
    dynamicUserContext,
    tools: interceptToolSchemas(tools, invocationContext?.permissionMode),
  };
}
