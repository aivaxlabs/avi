import { openAiCompatibleProviderTypes } from './openai-compatible.js';
import { openAiSubscriptionProviderType } from './openai-subscription.js';

export const providerTypes = [
  openAiSubscriptionProviderType,
  ...openAiCompatibleProviderTypes,
];
