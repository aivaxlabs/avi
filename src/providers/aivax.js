import { AIVAX_LONG_INFERENCE_BASE_URL } from '../main/aivax-client.js';
import { getAivaxAccessToken } from '../main/database.js';
import { defineProvider } from '../main/provider-api.js';
import { openAiCompatibleProviderTypes } from './openai-compatible.js';

export const AIVAX_PROVIDER_ID = 'aivax';

const chatCompletions = openAiCompatibleProviderTypes.find(
  (type) => type.descriptor.id === 'chat-completions',
);

const routingModeField = {
  id: 'routingMode',
  label: 'Routing mode',
  type: 'select',
  placement: 'modelId',
  default: '',
  description: 'Sent as routing_options.preset. Default uses the AIVAX routing preference.',
  options: [
    { value: '', label: 'Default routing' },
    { value: 'Balanced', label: 'Balanced' },
    { value: 'Cheapest', label: 'Cheapest' },
    { value: 'Fastest', label: 'Fastest' },
    { value: 'Quality', label: 'Quality' },
    { value: 'Special', label: 'Special' },
  ],
};

function withAivaxConnection(context) {
  const apiKey = getAivaxAccessToken();
  if (!apiKey) {
    throw new Error('Connect an AIVAX account in Settings → AIVAX Features to use this provider.');
  }

  return {
    ...context,
    provider: { ...context.provider, baseUrl: AIVAX_LONG_INFERENCE_BASE_URL, apiKey },
  };
}

export const aivaxProviderType = defineProvider({
  ...chatCompletions,
  descriptor: {
    ...chatCompletions.descriptor,
    id: 'aivax',
    name: 'AIVAX',
    description: 'AIVAX account',
    connection: 'managed',
    creatable: false,
    modelFields: [routingModeField, ...chatCompletions.descriptor.modelFields],
  },
  async createBody(context) {
    const body = await chatCompletions.createBody(context);
    const preset = context.model.routingMode;

    return preset
      ? { ...body, routing_options: { ...body.routing_options, preset } }
      : body;
  },
  request: (context) => chatCompletions.request(withAivaxConnection(context)),
  listAvailableModels: (context) => chatCompletions.listAvailableModels(withAivaxConnection(context)),
  getState() {
    const connected = Boolean(getAivaxAccessToken());

    return {
      removable: !connected,
      connection: {
        status: connected ? 'connected' : 'disconnected',
        statusLabel: connected ? 'Connected' : 'Not connected',
        title: 'AIVAX account',
        description: connected
          ? 'Requests use the account connected in Settings → AIVAX Features. This provider can be disabled, but not deleted, while the account is connected.'
          : 'Connect an AIVAX account in Settings → AIVAX Features to use this provider.',
      },
    };
  },
  refresh({ provider }) {
    if (provider.id !== AIVAX_PROVIDER_ID) {
      throw new Error('The AIVAX provider is managed by Avi and cannot be added manually.');
    }
  },
  remove() {
    if (getAivaxAccessToken()) {
      throw new Error('The AIVAX provider cannot be deleted while the AIVAX account is connected. Disable it instead.');
    }
  },
});
