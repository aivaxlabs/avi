import { openAiCompatibleProviderTypes } from './openai-compatible.js';
import { openAiSubscriptionProviderType } from './openai-subscription.js';
import { xSubscriptionProviderType } from './x-subscription.js';

export const providerTypes = [
  openAiSubscriptionProviderType,
  xSubscriptionProviderType,
  ...openAiCompatibleProviderTypes,
];
