import { getAivaxAccessToken } from './database.js';

const AIVAX_API_BASE_URL = 'https://inference.aivax.net';

export async function loginToAivax(loginKey, { signal } = {}) {
  const key = String(loginKey ?? '').trim();
  if (!key) throw new Error('Enter your AIVAX login key.');
  return requestAivax('/api/v1/auth/login', {
    body: { loginKey: key },
    accessToken: null,
    responseType: 'object',
    signal,
  });
}

export async function requestAivax(path, {
  accessToken = getAivaxAccessToken(),
  body,
  includeResponseEnvelope = false,
  includeResponseMetadata = false,
  method = body === undefined ? 'GET' : 'POST',
  responseType,
  signal,
} = {}) {
  if (accessToken === undefined || accessToken === '') {
    throw new Error('Connect an AIVAX account in Settings first.');
  }

  const multipart = body instanceof FormData;
  const response = await fetch(new URL(path, AIVAX_API_BASE_URL), {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    signal,
  });
  const text = await response.text();
  let value = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!response.ok) {
    const message = typeof value === 'object' && value
      ? value.error?.message ?? value.error ?? value.message
      : value;
    const error = new Error(message || `AIVAX returned ${response.status} ${response.statusText}.`);
    error.status = response.status;
    throw error;
  }
  const result = value && typeof value === 'object' && !Array.isArray(value) && 'data' in value
    ? value.data
    : value;
  if (responseType === 'array' && !Array.isArray(result)) {
    throw new Error('AIVAX returned an invalid response: expected an array.');
  }
  if (responseType === 'object' && (!result || typeof result !== 'object' || Array.isArray(result))) {
    throw new Error('AIVAX returned an invalid response: expected an object.');
  }
  if (includeResponseMetadata) {
    return {
      data: result,
      consumedCredits: Number(response.headers.get('Consumed-Credits')) || 0,
      status: response.status,
    };
  }
  if (includeResponseEnvelope) return value;
  return result;
}

export function indexAivaxDocuments(collectionId, documents, options = {}) {
  const form = new FormData();
  form.append('documents', new Blob([
    documents.map((document) => JSON.stringify(document)).join('\n'),
  ], { type: 'application/x-ndjson' }), 'avi-thread-search.jsonl');
  return requestAivax(
    `/api/v1/collections/${encodeURIComponent(collectionId)}/documents?insert-mode=sync`,
    {
      ...options,
      body: form,
      includeResponseMetadata: true,
      responseType: 'object',
    },
  );
}
