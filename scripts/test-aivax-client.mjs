import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-aivax-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

const {
  AIVAX_LONG_INFERENCE_BASE_URL,
  importAivaxDocuments,
  loginToAivax,
  requestAivax,
} = await import('../src/main/aivax-client.js');
const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
const { closeDatabase, getRemoteSettings } = await import('../src/main/database.js');

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

  const sockets = [];
  class FakeImportSocket {
    constructor(url, options) {
      this.url = String(url);
      this.options = options;
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.sent = [];
      this.listeners = new Map();
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit('open');
      });
    }

    on(event, listener) {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event, listener) {
      const wrapped = (...args) => {
        this.listeners.set(event, (this.listeners.get(event) ?? []).filter((item) => item !== wrapped));
        listener(...args);
      };
      return this.on(event, wrapped);
    }

    emit(event, ...args) {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
    }

    send(data) {
      this.sent.push(String(data));
      if (String(data).includes('END')) {
        queueMicrotask(() => this.emit('message', JSON.stringify({
          type: 'completed',
          received: 1,
          updated: 1,
          skipped: 0,
          removed: 2,
        })));
      }
    }

    close() {
      this.readyState = 3;
    }

    terminate() {
      this.close();
    }
  }
  const indexed = await importAivaxDocuments('collection/id', [{
    docid: 'avi-thread:thread-id:user-id',
    text: 'Title: Thread\nUser: Hello\nAssistant: Hi',
    __meta: { threadId: 'thread-id' },
  }], { accessToken: 'test-access-token', WebSocket: FakeImportSocket });
  assert.deepEqual(indexed, { received: 1, updated: 1, skipped: 0, removed: 2 });
  assert.equal(sockets[0].url, 'wss://inference.aivax.net/api/v2/collections/collection%2Fid/documents/index-jsonl?insert-mode=sync');
  assert.equal(sockets[0].options.headers.Authorization, 'Bearer test-access-token');
  const lines = sockets.flatMap((socket) => socket.sent).join('').trim().split('\n');
  assert.deepEqual(JSON.parse(lines[0]), {
    docId: 'avi-thread:thread-id:user-id',
    text: 'Title: Thread\nUser: Hello\nAssistant: Hi',
    __meta: { threadId: 'thread-id' },
  });
  assert.equal(lines.at(-1), 'END');

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
  await assert.rejects(
    readMediaFile.execute({ path: mediaFixtures[0].path }, {
      capabilities: { images: true },
      mediaSizeLimit: 2,
    }),
    /exceeds the .* MB media size limit/,
  );
  assert.equal(await readMediaFile.execute({ path: mediaFixtures[0].path }, {
    aivax: { connected: true, mediaDescriptionsEnabled: true },
    capabilities: { images: true },
    mediaSizeLimit: 2,
    requestAivax: async () => ({ data: [{ textContent: 'Described oversized image.' }] }),
  }), JSON.stringify({ textContent: 'Described oversized image.' }));
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
  assert.equal(directResult.mediaContent[0].image_url.path, mediaFixtures[0].path);
  assert.equal(directResult.mediaContent[0].image_url.url, undefined);

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

  const memorySearch = CLIENT_TOOLS.find((tool) => tool.name === 'memory_search');
  reply({
    message: null,
    data: [{
      documentId: 'document-id',
      collectionId: 'collection-id',
      documentName: 'decisao-de-arquitetura',
      documentContent: 'Stored memory',
      metadata: { thread_role: 'orchestrator' },
      timestamps: { createdAt: '2026-10-01T10:00:00', updatedAt: '2026-10-02T11:00:00' },
      score: 0.8,
      referencedDocuments: [],
    }],
  });
  assert.deepEqual(JSON.parse(await memorySearch.execute({
    search_terms: ['architecture'],
    filter: 'metadata.thread_role = "orchestrator"',
    detailed: true,
  }, {
    aivax: { memoryCollectionId: 'collection-id' },
    signal: new AbortController().signal,
  })), [{
    id: 'document-id',
    name: 'decisao-de-arquitetura',
    createdAt: '2026-10-01T10:00:00',
    updatedAt: '2026-10-02T11:00:00',
    score: 0.8,
    metadata: { thread_role: 'orchestrator' },
    content: 'Stored memory',
  }]);
  assert.equal(JSON.parse(requests.at(-1).options.body).filter, 'metadata.thread_role = "orchestrator"');
  reply({ message: null, data: [] });
  assert.equal(await memorySearch.execute({ search_terms: ['nothing'], detailed: true }, {
    aivax: { memoryCollectionId: 'collection-id' },
    signal: new AbortController().signal,
  }), '[]');

  const memoryWrite = CLIENT_TOOLS.find((tool) => tool.name === 'memory_write');
  assert.deepEqual(memoryWrite.inputSchema.required, ['title', 'contents']);
  reply({ message: null, data: {} });
  assert.equal(await memoryWrite.execute({
    title: '  Decisão de Arquitetura: API v2!  ',
    contents: 'Body',
    tags: ['decision'],
  }, {
    aivax: { memoryCollectionId: 'collection/id' },
    signal: new AbortController().signal,
    workspacePath: 'C:\\Code\\repo',
    model: 'provider:claude',
    models: [{ id: 'provider:claude', modelId: 'claude-sonnet' }],
    conversationId: 'quick-session-id',
  }), 'Memory file written: decisao-de-arquitetura-api-v2.');
  assert.equal(requests.at(-1).url, 'https://inference.aivax.net/api/v1/collections/collection%2Fid/documents');
  assert.equal(requests.at(-1).options.method, 'PUT');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    name: 'decisao-de-arquitetura-api-v2',
    contents: 'Body',
    tags: ['decision'],
    metadata: {
      directory: 'C:\\Code\\repo',
      model_name: 'claude-sonnet',
      task_title: null,
      thread_id: 'quick-session-id',
      thread_role: 'quick_chat',
      parent_thread_id: null,
      device_name: hostname(),
      device_id: getRemoteSettings().relayDeviceId,
    },
  });
  await assert.rejects(
    memoryWrite.execute({ title: '!!!', contents: 'Body' }, { aivax: { memoryCollectionId: 'collection-id' } }),
    /title must contain at least one letter or digit/,
  );

  const memoryDelete = CLIENT_TOOLS.find((tool) => tool.name === 'memory_delete');
  assert.ok(memoryDelete);
  assert.equal(memoryDelete.canPerformDestructiveActions, true);
  assert.deepEqual(memoryDelete.inputSchema.required, ['names']);
  assert.equal(memoryDelete.inputSchema.properties.names.minItems, 1);

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

  const generateImage = CLIENT_TOOLS.find((tool) => tool.name === 'generate_image');
  const generateAudio = CLIENT_TOOLS.find((tool) => tool.name === 'generate_audio');
  assert.ok(generateImage && generateAudio);
  const generationWorkspace = join(resolvedProfile, 'generation-workspace');
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  await assert.rejects(
    generateImage.execute({ prompt: 'A cat' }, {
      aivax: { connected: true, imageGenerationEnabled: false, imageGenerationModel: 'model' },
      requestAivax: async () => assert.fail('Disabled image generation must not call AIVAX.'),
    }),
    /image generation is not enabled/,
  );

  const imageRequests = [];
  const imageAivax = { connected: true, imageGenerationEnabled: true, imageGenerationModel: 'flare' };
  const imageRequest = (flags) => async (path, options) => {
    imageRequests.push({ path, options });
    if (path === '/api/v1/information/image-models.json') return [{ name: 'flare', flags }];
    if (path.startsWith('/api/v1/shell/io/file/public-address')) return { publicUrl: 'https://aivax.example/ref.png' };
    if (path.startsWith('/api/v1/shell/io/file')) return null;
    return [{ input: options.body.input, images: ['https://aivax.example/out-1', 'https://aivax.example/out-2'] }];
  };
  const imageResult = await generateImage.execute({
    prompt: ' A cat ',
    count: 2,
    referenceImages: [mediaFixtures[0].path, 'https://example.com/ref.jpg'],
  }, {
    aivax: imageAivax,
    requestAivax: imageRequest(['AllowReferenceImage']),
    fetch: async () => new Response(pngBytes),
    signal: new AbortController().signal,
    workspacePath: generationWorkspace,
  });
  const generationCall = imageRequests.find((request) => request.path === '/api/v1/generations/images');
  assert.equal(generationCall.options.baseUrl, AIVAX_LONG_INFERENCE_BASE_URL);
  assert.deepEqual(generationCall.options.body, {
    input: 'A cat',
    count: 2,
    model: 'flare',
    referenceImages: ['https://aivax.example/ref.png', 'https://example.com/ref.jpg'],
  });
  const upload = imageRequests.find((request) => request.options.body instanceof Blob);
  assert.match(upload.path, /^\/api\/v1\/shell\/io\/file\?path=image-references%2F.+\.png$/);
  assert.equal(upload.options.headers['X-Shell-User-Id'], 'avi-media-generation');
  assert.equal(imageRequests.at(-1).options.method, 'DELETE');
  assert.equal(imageRequests.at(-1).path, upload.path);
  assert.equal(imageResult.attachments.length, 2);
  assert.equal(imageResult.mediaContent.length, 2);
  for (const attachment of imageResult.attachments) {
    assert.equal(attachment.source, 'generated_image');
    assert.equal(attachment.mime, 'image/png');
    assert.ok(attachment.path.startsWith(join(generationWorkspace, '.aivax', 'generated-images')));
    assert.deepEqual(readFileSync(attachment.path), pngBytes);
  }

  imageRequests.length = 0;
  await assert.rejects(
    generateImage.execute({ prompt: 'A cat', referenceImages: ['https://example.com/ref.jpg'] }, {
      aivax: imageAivax,
      requestAivax: imageRequest([]),
      workspacePath: generationWorkspace,
    }),
    /does not support reference images/,
  );
  assert.deepEqual(imageRequests.map((request) => request.path), ['/api/v1/information/image-models.json']);

  await assert.rejects(
    generateAudio.execute({ text: 'Hello' }, {
      aivax: { connected: true, audioGenerationEnabled: false, audioGenerationModel: null },
    }),
    /audio generation is not enabled/,
  );
  const audioOutput = await generateAudio.execute({ text: 'Hello', voice: 'onyx' }, {
    aivax: { connected: true, audioGenerationEnabled: true, audioGenerationModel: 'GrokVoice' },
    requestAivax: async (path, options) => {
      assert.equal(path, '/api/v1/generations/speech');
      assert.equal(options.baseUrl, AIVAX_LONG_INFERENCE_BASE_URL);
      assert.deepEqual(options.body, { model: 'GrokVoice', input: 'Hello', voice: 'onyx', format: 'mp3' });
      return { format: 'mp3', mimeType: 'audio/mpeg', data: Buffer.from('audio').toString('base64') };
    },
    workspacePath: generationWorkspace,
  });
  const audioPath = audioOutput.match(/Saved to: (.+)$/)[1];
  assert.ok(audioPath.startsWith(join(generationWorkspace, '.aivax', 'generated-audio')));
  assert.equal(readFileSync(audioPath, 'utf8'), 'audio');

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
