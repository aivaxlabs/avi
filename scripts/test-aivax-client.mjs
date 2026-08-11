import assert from 'node:assert/strict';
import { loginToAivax, requestAivax } from '../src/main/aivax-client.js';
import { CLIENT_TOOLS } from '../src/main/client-tools.js';

const originalFetch = globalThis.fetch;
const requests = [];
let response = null;

globalThis.fetch = async (url, options) => {
  requests.push({ url: String(url), options });
  return typeof response === 'function' ? response(String(url), options) : response;
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

  const memoryDelete = CLIENT_TOOLS.find((tool) => tool.name === 'memory_delete');
  assert.ok(memoryDelete);
  assert.equal(memoryDelete.canPerformDestructiveActions, true);
  assert.deepEqual(memoryDelete.inputSchema.required, ['names']);
  assert.equal(memoryDelete.inputSchema.properties.names.minItems, 1);
  assert.equal(memoryDelete.inputSchema.properties.names.uniqueItems, true);

  response = (url, options) => {
    if (options.method === 'DELETE') return new Response('', { status: 200 });
    const name = new URL(url).searchParams.get('filter');
    return new Response(JSON.stringify({
      data: name === 'remove/me.md'
        ? [
            { id: 'wrong-document', name: 'remove/me.md.backup' },
            { id: 'document/id', name: 'remove/me.md' },
          ]
        : [],
    }), { status: 200 });
  };
  const deleteResult = await memoryDelete.execute({
    names: ['remove/me.md', 'missing.md'],
  }, {
    aivax: { memoryCollectionId: 'collection/id' },
    signal: new AbortController().signal,
  });
  assert.equal(deleteResult, [
    'Deleted memory files: remove/me.md.',
    'Memory files not found: missing.md.',
  ].join('\n'));
  assert.deepEqual(requests.slice(-3).map(({ url, options }) => ({
    url,
    method: options.method,
  })), [
    {
      url: 'https://inference.aivax.net/api/v1/collections/collection%2Fid/documents?filter=remove%2Fme.md',
      method: 'GET',
    },
    {
      url: 'https://inference.aivax.net/api/v1/collections/collection%2Fid/documents/document%2Fid',
      method: 'DELETE',
    },
    {
      url: 'https://inference.aivax.net/api/v1/collections/collection%2Fid/documents?filter=missing.md',
      method: 'GET',
    },
  ]);

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
