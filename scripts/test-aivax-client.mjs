import assert from 'node:assert/strict';
import { loginToAivax, requestAivax } from '../src/main/aivax-client.js';

const originalFetch = globalThis.fetch;
const requests = [];
let response = null;

globalThis.fetch = async (url, options) => {
  requests.push({ url: String(url), options });
  return response;
};

const reply = (value, { status = 200, statusText = 'OK' } = {}) => {
  response = new Response(value === null ? '' : JSON.stringify(value), { status, statusText });
};

try {
  reply({
    message: null,
    data: {
      accessToken: 'test-access-token',
      account: { plan: ['Max'] },
    },
  });
  const login = await loginToAivax('test-login-key');
  assert.equal(login.accessToken, 'test-access-token');
  assert.deepEqual(login.account.plan, ['Max']);
  assert.equal(requests[0].url, 'https://inference.aivax.net/api/v1/auth/login');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[0].options.headers['X-Response-Truncating'], undefined);
  assert.deepEqual(JSON.parse(requests[0].options.body), { loginKey: 'test-login-key' });

  reply({ message: null, data: { balance: 999, usage24h: 0, plan: 'Max' } });
  const balance = await requestAivax('/api/v1/information/balance', {
    accessToken: 'test-access-token',
    responseType: 'object',
  });
  assert.deepEqual(balance, { balance: 999, usage24h: 0, plan: 'Max' });
  assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer test-access-token');

  const collectionsPayload = [{
    id: 'collection-id',
    name: 'Memory',
    documentCount: { totalDocuments: 4 },
  }];
  reply({ message: null, data: collectionsPayload });
  assert.deepEqual(await requestAivax('/api/v1/collections', {
    accessToken: 'test-access-token',
    responseType: 'array',
  }), collectionsPayload);

  const queryPayload = [{
    documentId: 'document-id',
    documentName: 'memory.md',
    documentContent: 'Stored memory',
    score: 0.8,
    metadata: {},
  }];
  reply({ message: null, data: queryPayload });
  assert.deepEqual(await requestAivax('/api/v1/query', {
    accessToken: 'test-access-token',
    body: {
      terms: ['memory'],
      collections: ['collection-id'],
      top: 20,
      includeReferences: false,
      reranker: 'rrf',
      minScore: 0.2,
    },
    responseType: 'array',
  }), queryPayload);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    terms: ['memory'],
    collections: ['collection-id'],
    top: 20,
    includeReferences: false,
    reranker: 'rrf',
    minScore: 0.2,
  });

  for (const [path, payload] of [
    ['/api/v1/collections', { collectionId: 'collection-id' }],
    ['/api/v1/collections/collection-id/documents', { documentId: 'document-id', state: 'Created' }],
    ['/api/v1/web/fetch', { results: [{ index: 0, extractedText: 'Text', processingUnits: 1, error: null }] }],
    ['/api/v1/web/search', { results: [{ url: 'https://example.com', title: 'Example', text: 'Text' }] }],
  ]) {
    reply({ message: null, data: payload });
    assert.deepEqual(await requestAivax(path, {
      accessToken: 'test-access-token',
      body: {},
      responseType: 'object',
    }), payload);
  }

  const rerankPayload = {
    id: 'request-id',
    model: '@aivax/reflex-v1',
    results: [{ index: 0, relevance_score: 1, document: { text: 'Document' } }],
    usage: { input_tokens: 1, cached_input_tokens: 0, total_tokens: 1, cost: 0 },
  };
  reply({ message: null, data: rerankPayload });
  assert.deepEqual(await requestAivax('/api/v1/generations/rerank', {
    accessToken: 'test-access-token',
    body: {
      model: '@aivax/reflex-v1',
      query: 'semantic query',
      documents: ['First conversation', 'Second conversation'],
      top_n: 20,
      min_score: 0,
    },
    responseType: 'object',
  }), rerankPayload);
  assert.equal(requests.at(-1).url, 'https://inference.aivax.net/api/v1/generations/rerank');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    model: '@aivax/reflex-v1',
    query: 'semantic query',
    documents: ['First conversation', 'Second conversation'],
    top_n: 20,
    min_score: 0,
  });

  reply({ message: null, data: { not: 'an array' } });
  await assert.rejects(
    requestAivax('/api/v1/collections', {
      accessToken: 'test-access-token',
      responseType: 'array',
    }),
    /expected an array/,
  );

  reply({ message: null, data: [] });
  await assert.rejects(
    requestAivax('/api/v1/information/balance', {
      accessToken: 'test-access-token',
      responseType: 'object',
    }),
    /expected an object/,
  );

  reply({ message: 'Invalid login key.', data: null }, { status: 401, statusText: 'Unauthorized' });
  await assert.rejects(
    loginToAivax('invalid-login-key'),
    (error) => error.message === 'Invalid login key.' && error.status === 401,
  );

  console.log('AIVAX client contract tests passed.');
} finally {
  globalThis.fetch = originalFetch;
}

process.exit(0);
