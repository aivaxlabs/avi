import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-aivax-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

const {
  AIVAX_LONG_INFERENCE_BASE_URL,
  indexAivaxDocuments,
  loginToAivax,
  requestAivax,
} = await import('../src/main/aivax-client.js');
const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
const { closeDatabase } = await import('../src/main/database.js');

const originalFetch = globalThis.fetch;
const requests = [];
const materializedAttachmentPaths = [];
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

  reply({ message: null, data: { resultText: 'Long inference result.' } });
  assert.deepEqual(await requestAivax('/api/v1/generations/teach-skill', {
    accessToken: 'test-access-token',
    baseUrl: AIVAX_LONG_INFERENCE_BASE_URL,
    body: { videos: [] },
    responseType: 'object',
  }), { resultText: 'Long inference result.' });
  assert.equal(
    requests.at(-1).url,
    'https://direct.inference.aivax.net/api/v1/generations/teach-skill',
  );

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

  reply({ message: null, data: collectionsPayload });
  assert.deepEqual(await requestAivax('/api/v1/generations/descriptions', {
    accessToken: 'test-access-token',
    includeResponseEnvelope: true,
    responseType: 'array',
  }), { message: null, data: collectionsPayload });

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

  response = new Response(JSON.stringify({ data: { enqueued: 1, skipped: 2 } }), {
    headers: { 'Consumed-Credits': '0.00125' },
  });
  const indexed = await indexAivaxDocuments('collection/id', [{
    docid: 'avi-thread:thread-id:user-id',
    text: 'Title: Thread\nUser: Hello\nAssistant: Hi',
    __meta: { threadId: 'thread-id' },
  }], { accessToken: 'test-access-token' });
  assert.deepEqual(indexed, {
    data: { enqueued: 1, skipped: 2 },
    consumedCredits: 0.00125,
    status: 200,
  });
  const indexRequest = requests.at(-1);
  assert.equal(indexRequest.url, 'https://inference.aivax.net/api/v1/collections/collection%2Fid/documents?insert-mode=sync');
  assert.equal(indexRequest.options.method, 'POST');
  assert.equal(indexRequest.options.headers.Authorization, 'Bearer test-access-token');
  assert.equal(indexRequest.options.headers['Content-Type'], undefined);
  assert.ok(indexRequest.options.body instanceof FormData);
  assert.equal(indexRequest.options.body.get('insert-mode'), null);
  const jsonlFile = indexRequest.options.body.get('documents');
  assert.equal(jsonlFile.name, 'avi-thread-search.jsonl');
  assert.equal(jsonlFile.type, 'application/x-ndjson');
  assert.deepEqual(JSON.parse(await jsonlFile.text()), {
    docid: 'avi-thread:thread-id:user-id',
    text: 'Title: Thread\nUser: Hello\nAssistant: Hi',
    __meta: { threadId: 'thread-id' },
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

  const getChatAttachments = CLIENT_TOOLS.find((tool) => tool.name === 'get_chat_attachments');
  assert.ok(getChatAttachments);
  assert.match(getChatAttachments.description, /images, audio, and videos attached by the user/);
  assert.match(getChatAttachments.description, /temporary storage/);
  const existingImagePath = join(resolvedProfile, 'existing.png');
  writeFileSync(existingImagePath, Buffer.from('existing-image'));
  const chatAttachments = await getChatAttachments.execute({}, {
    userAttachments: [
      {
        id: 'existing-image',
        kind: 'image_url',
        name: 'existing.png',
        mime: 'image/png',
        path: existingImagePath,
        dataUrl: 'data:image/png;base64,aWdub3JlZA==',
      },
      {
        id: 'inference-image',
        kind: 'image_url',
        name: 'inference.png',
        mime: 'image/png',
        dataUrl: 'data:image/png;base64,aW5mZXJlbmNlLWltYWdl',
      },
      {
        id: 'inference-audio',
        kind: 'input_audio',
        name: 'inference.mp3',
        mime: 'audio/mpeg',
        base64: Buffer.from('inference-audio').toString('base64'),
      },
      {
        id: 'inference-video',
        kind: 'video_url',
        name: 'inference.mp4',
        mime: 'video/mp4',
        dataUrl: 'data:video/mp4;base64,aW5mZXJlbmNlLXZpZGVv',
      },
      {
        id: 'ignored-pdf',
        kind: 'file',
        name: 'ignored.pdf',
        mime: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,cGRm',
      },
    ],
  });
  assert.equal(chatAttachments.attachments.length, 4);
  assert.deepEqual(chatAttachments.attachments[0], {
    attachmentIndex: 0,
    name: 'existing.png',
    kind: 'image_url',
    mime: 'image/png',
    path: existingImagePath,
    temporary: false,
    materialized: false,
  });
  const materializedAttachments = chatAttachments.attachments.slice(1);
  assert.deepEqual(materializedAttachments.map(({ attachmentIndex, name }) => ({ attachmentIndex, name })), [
    { attachmentIndex: 1, name: 'inference.png' },
    { attachmentIndex: 2, name: 'inference.mp3' },
    { attachmentIndex: 3, name: 'inference.mp4' },
  ]);
  assert.ok(materializedAttachments.every(({ path, temporary, materialized }) => (
    path.startsWith(resolve(tmpdir(), '.avi', 'chat-attachments'))
    && temporary
    && materialized
  )));
  materializedAttachmentPaths.push(...materializedAttachments.map(({ path }) => path));
  assert.equal(readFileSync(materializedAttachments[0].path, 'utf8'), 'inference-image');
  assert.equal(readFileSync(materializedAttachments[1].path, 'utf8'), 'inference-audio');
  assert.equal(readFileSync(materializedAttachments[2].path, 'utf8'), 'inference-video');

  const readMediaFile = CLIENT_TOOLS.find((tool) => tool.name === 'read_media_file');
  assert.ok(readMediaFile);
  assert.match(readMediaFile.description, /images, videos, audio, and PDFs/);
  assert.match(readMediaFile.description, /AIVAX Media Descriptions converts unsupported media to text/);
  const mediaFixtures = [
    ['pixel.png', Buffer.from('image'), 'image_url'],
    ['clip.mp4', Buffer.from('video'), 'video_url'],
    ['sound.wav', Buffer.from('audio'), 'input_audio'],
    ['document.pdf', Buffer.from('pdf'), 'file'],
  ].map(([name, contents, type]) => {
    const path = join(resolvedProfile, name);
    writeFileSync(path, contents);
    return { path, contents, type };
  });
  const mediaRequests = [];
  for (const fixture of mediaFixtures) {
    assert.equal(await readMediaFile.execute({ path: fixture.path, extractionGuidance: 'Focus on visible text.' }, {
      aivax: { connected: true, mediaDescriptionsEnabled: true },
      capabilities: { images: false, audio: false, pdfFiles: false },
      requestAivax: async (path, options) => {
        mediaRequests.push({ path, options });
        return { data: [{ textContent: `Resolved ${options.body.input[0].type}` }] };
      },
      signal: new AbortController().signal,
    }), JSON.stringify({ textContent: `Resolved ${fixture.type}` }));
    const request = mediaRequests.at(-1);
    assert.equal(request.path, '/api/v1/generations/descriptions');
    assert.equal(request.options.includeResponseEnvelope, true);
    assert.equal(request.options.responseType, 'array');
    assert.equal(request.options.body.extractionGuidance, 'Focus on visible text.');
    const input = request.options.body.input[0];
    assert.equal(input.type, fixture.type);
    if (fixture.type === 'input_audio') {
      assert.equal(input.input_audio.format, 'wav');
      assert.equal(input.input_audio.data, fixture.contents.toString('base64'));
    }
    if (fixture.type === 'file') {
      assert.equal(input.file.filename, 'document.pdf');
      assert.match(input.file.file_data, /^data:application\/pdf;base64,/);
    }
  }
  assert.equal(await readMediaFile.execute({ path: mediaFixtures[1].path }, {
    aivax: { connected: true, mediaDescriptionsEnabled: true },
    capabilities: { images: false, audio: false, pdfFiles: false },
    requestAivax: async (path, options) => {
      mediaRequests.push({ path, options });
      return {
        data: [{ textContent: 'First video segment.' }],
      };
    },
  }), JSON.stringify({ textContent: 'First video segment.' }));
  assert.equal(mediaRequests.at(-1).options.body.extractionGuidance, undefined);

  const mediaRequestCount = mediaRequests.length;
  await assert.rejects(
    readMediaFile.execute({ path: mediaFixtures[0].path }, {
      aivax: { connected: true, mediaDescriptionsEnabled: false },
      capabilities: { images: false, audio: false, pdfFiles: false },
      requestAivax: async () => {
        throw new Error('The disabled fallback must not call AIVAX.');
      },
    }),
    /cannot read this media type/,
  );
  assert.equal(mediaRequests.length, mediaRequestCount);

  assert.equal(await readMediaFile.execute({ path: mediaFixtures[0].path }, {
    aivax: { connected: true, mediaDescriptionsEnabled: true },
    capabilities: { images: false, audio: false, pdfFiles: false },
    requestAivax: async () => ({ data: [{ type: 'invalid', textContent: null }] }),
  }), JSON.stringify({ type: 'invalid', textContent: null }));

  const directResult = await readMediaFile.execute({
    path: mediaFixtures[0].path,
    extractionGuidance: 'Focus on visible text.',
  }, {
    aivax: { connected: true, mediaDescriptionsEnabled: true },
    capabilities: { images: true, audio: false, pdfFiles: false },
    requestAivax: async () => {
      throw new Error('The direct model path must not call AIVAX.');
    },
  });
  assert.equal(directResult.mediaContent[0].type, 'image_url');

  const teachSkill = CLIENT_TOOLS.find((tool) => tool.name === 'aivax_teach_skill');
  assert.ok(teachSkill);
  assert.deepEqual(teachSkill.inputSchema.required, ['attachmentIndex']);
  let unauthenticatedRequestCalled = false;
  await assert.rejects(
    teachSkill.execute({ attachmentIndex: 0 }, {
      aivax: { connected: false },
      requestAivax: async () => {
        unauthenticatedRequestCalled = true;
      },
      userAttachments: [{ kind: 'video_url', mime: 'video/mp4', path: mediaFixtures[1].path }],
    }),
    /AIVAX is not authenticated.*user must connect an AIVAX account in Settings/,
  );
  assert.equal(unauthenticatedRequestCalled, false);

  const taughtSkill = await teachSkill.execute({ attachmentIndex: 0 }, {
    aivax: { connected: true },
    requestAivax: async (path, options) => {
      assert.equal(path, '/api/v1/generations/teach-skill');
      assert.equal(options.baseUrl, AIVAX_LONG_INFERENCE_BASE_URL);
      assert.equal(options.responseType, 'object');
      assert.equal(options.signal.aborted, false);
      assert.equal(options.body.videos.length, 1);
      assert.equal(options.body.videos[0].type, 'video_url');
      assert.equal(
        options.body.videos[0].video_url.url,
        `data:video/mp4;base64,${mediaFixtures[1].contents.toString('base64')}`,
      );
      return {
        resultText: '---\nname: example-skill\ndescription: Example skill.\n---\n# Example',
        usage: { processedUnits: 5 },
      };
    },
    signal: new AbortController().signal,
    userAttachments: [{
      kind: 'video_url',
      mime: 'video/mp4',
      path: mediaFixtures[1].path,
    }],
  });
  assert.deepEqual(taughtSkill, {
    resultText: '---\nname: example-skill\ndescription: Example skill.\n---\n# Example',
    usage: { processedUnits: 5 },
  });
  await assert.rejects(
    teachSkill.execute({ attachmentIndex: 0 }, {
      aivax: { connected: true },
      userAttachments: [{ kind: 'image_url', mime: 'image/png', path: mediaFixtures[0].path }],
    }),
    /requires a video attachment/,
  );
  await assert.rejects(
    teachSkill.execute({ attachmentIndex: 1 }, {
      aivax: { connected: true },
      userAttachments: [{ kind: 'video_url', mime: 'video/mp4', path: mediaFixtures[1].path }],
    }),
    /selected chat attachment is not available/,
  );
  await assert.rejects(
    teachSkill.execute({ attachmentIndex: 0 }, {
      aivax: { connected: true },
      requestAivax: async () => ({ resultText: '' }),
      userAttachments: [{ kind: 'video_url', mime: 'video/mp4', path: mediaFixtures[1].path }],
    }),
    /returned no skill instructions/,
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
  closeDatabase();
  globalThis.fetch = originalFetch;
  for (const path of materializedAttachmentPaths) rmSync(path, { force: true });
  rmSync(testProfile, { recursive: true, force: true });
}

process.exit(0);
