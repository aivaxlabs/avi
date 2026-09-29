import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-request-log-test-'));
const resolvedProfile = resolve(testProfile);
process.env.HOME = resolvedProfile;
process.env.USERPROFILE = resolvedProfile;
process.env.TMP = resolvedProfile;
process.env.TEMP = resolvedProfile;
process.env.TMPDIR = resolvedProfile;

const requestLogDirectory = join(resolvedProfile, '.avi', 'debug', 'request-logs');

try {
  const { setTraceLevel, logApiRequest } = await import('../src/main/trace-log.js');
  const { sendJsonRequest } = await import('../src/main/json-request-body.js');

  setTraceLevel('verbose');
  logApiRequest({
    model: 'gpt-test',
    providerId: 'openai',
    method: 'POST',
    url: 'https://api.example.com/v1',
    headers: [['Authorization', 'Bearer secret-token-123']],
    body: '{}',
    response: { status: 401, statusText: 'Unauthorized', headers: [], body: '{}' },
  });
  assert.ok(!existsSync(requestLogDirectory), 'must not write outside requests mode');

  setTraceLevel('requests');
  logApiRequest({
    model: 'gpt-test',
    providerId: 'openai',
    method: 'POST',
    url: 'https://api.example.com/v1/chat/completions',
    headers: [
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer secret-token-123'],
    ],
    body: '{"model":"gpt-test","messages":[{"role":"user","content":"hello"}]}',
    response: {
      status: 401,
      statusText: 'Unauthorized',
      headers: [['content-type', 'application/json']],
      body: '{"error":{"message":"Invalid API key"}}',
    },
  });

  assert.ok(existsSync(requestLogDirectory));
  const files = readdirSync(requestLogDirectory);
  assert.equal(files.length, 1);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.match(files[0], new RegExp(`^${date}-gpt-test-[a-f0-9]{8}\\.log$`));

  const content = readFileSync(join(requestLogDirectory, files[0]), 'utf8');
  assert.match(content, /## Request/);
  assert.match(content, /POST https:\/\/api\.example\.com\/v1\/chat\/completions HTTP\/1\.1/);
  assert.match(content, /Content-Type: application\/json/);
  assert.match(content, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(content, /secret-token-123/);
  assert.match(content, /## Response/);
  assert.match(content, /401 Unauthorized/);
  assert.match(content, /Invalid API key/);

  const server = createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'integration-failed' } }));
  });
  await new Promise((resolveListen) => server.listen(0, resolveListen));
  const { port } = server.address();
  const response = await sendJsonRequest(`http://127.0.0.1:${port}/v1/chat/completions`, {
    headers: { Authorization: 'Bearer integration-secret-456' },
    value: { model: 'gpt-test', messages: [] },
    logContext: { model: 'gpt-test', providerId: 'openai' },
  });
  await new Promise((resolveClose) => server.close(resolveClose));

  assert.equal(response.status, 401);
  assert.match(await response.text(), /integration-failed/);

  const integrationFiles = readdirSync(requestLogDirectory);
  assert.equal(integrationFiles.length, 2);
  const integrationLog = integrationFiles.find((file) => file !== files[0]);
  const integrationContent = readFileSync(join(requestLogDirectory, integrationLog), 'utf8');
  assert.match(integrationContent, /POST http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions HTTP\/1\.1/);
  assert.match(integrationContent, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(integrationContent, /integration-secret-456/);
  assert.match(integrationContent, /integration-failed/);

  const { withRequestDiagnostics, diagnosticFetch } = await import('../src/main/request-diagnostics.js');
  const { ModelProvider } = await import('../src/main/model-provider.js');
  const { chatCompletionsApi } = await import('../src/providers/openai-compatible.js');
  const originalFetch = globalThis.fetch;
  const count = () => readdirSync(requestLogDirectory).length;
  const before = count();
  try {
    globalThis.fetch = async () => new Response('{invalid', { status: 200 });
    await assert.rejects(withRequestDiagnostics({ model: 'json-test' }, async () => {
      const response = await diagnosticFetch('https://example.test/json');
      await response.json();
    }));
    assert.equal(count(), before + 1, 'JSON parsing failure creates one capture');

    globalThis.fetch = async () => new Response('{}', { status: 200 });
    await withRequestDiagnostics({}, async () => (await diagnosticFetch('https://example.test/ok')).json());
    assert.equal(count(), before + 1, 'success creates no capture');
    await assert.rejects(withRequestDiagnostics({ method: 'AVI', url: 'test:operation' }, async () => {
      throw new Error('local validation failed');
    }), /local validation failed/);
    assert.equal(count(), before + 2);

    const payload = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{}{}' } }] } }] };
    const provider = new ModelProvider({ id: 'test' }, {
      createBody: async () => ({}),
      request: async () => new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`),
      eventsFrom: chatCompletionsApi.eventsFrom,
    }, {});
    await assert.rejects(provider.stream({
      model: { modelId: 'test', reasoning: [] }, messages: [], tools: [], toolHistory: [],
      signal: new AbortController().signal, onEvent() {},
    }), (error) => error.code === 'incomplete_tool_call');
    assert.equal(count(), before + 3);
    const captures = readdirSync(requestLogDirectory).map((file) => readFileSync(join(requestLogDirectory, file), 'utf8'));
    assert.ok(captures.some((text) => text.includes('{}{}') && text.includes('incomplete tool call')));
    const trace = readFileSync(join(resolvedProfile, '.aivax', 'trace.log'), 'utf8');
    assert.match(trace, /request.capture-written/);
    assert.match(trace, /capture_path=/);
    assert.ok(trace.includes('request-logs'));
    assert.ok(!trace.includes('{}{}'), 'raw arguments stay out of trace');

    let start = count();
    globalThis.fetch = async () => { throw new TypeError('network offline'); };
    await assert.rejects(withRequestDiagnostics({}, () => diagnosticFetch('https://example.test/offline')), /network offline/);
    assert.equal(count(), start + 1, 'network error creates only one capture');

    start = count();
    globalThis.fetch = async () => new Response('denied', { status: 403 });
    await assert.rejects(withRequestDiagnostics({}, async () => {
      const response = await diagnosticFetch('https://example.test/denied', {
        headers: { Cookie: 'session=private-cookie', 'X-Api-Key': 'private-key' },
        body: '{"loginKey":"private-login"}', method: 'POST',
      });
      assert.equal(await response.text(), 'denied');
      throw new Error('denied');
    }), /denied/);
    assert.equal(count(), start + 1, 'non-ok response creates only one capture');
    for (const file of readdirSync(requestLogDirectory)) {
      assert.doesNotMatch(readFileSync(join(requestLogDirectory, file), 'utf8'), /private-cookie|private-key|private-login/);
    }

    const sseServer = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
    });
    await new Promise((ready) => sseServer.listen(0, '127.0.0.1', ready));
    try {
      provider.implementation.request = () => sendJsonRequest(`http://127.0.0.1:${sseServer.address().port}/chat`, {
        value: { model: 'test', messages: [{ role: 'user', content: 'capture-request-marker' }] },
      });
      start = count();
      await assert.rejects(provider.stream({
        model: { modelId: 'test', reasoning: [] }, messages: [], tools: [], toolHistory: [],
        signal: new AbortController().signal, onEvent() {},
      }), (error) => error.code === 'incomplete_tool_call');
      assert.equal(count(), start + 1);
      assert.ok(readdirSync(requestLogDirectory).some((file) => {
        const text = readFileSync(join(requestLogDirectory, file), 'utf8');
        return text.includes('capture-request-marker') && text.includes('{}{}');
      }), 'HTTP 200 parsing failure retains both request and SSE response');
    } finally {
      await new Promise((closed) => sseServer.close(closed));
    }

    let cancelled = false;
    provider.implementation.request = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {broken\n\n')); },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(provider.stream({
      model: { modelId: 'test', reasoning: [] }, messages: [], tools: [], toolHistory: [],
      signal: new AbortController().signal, onEvent() {},
    }), /invalid SSE payload/);
    assert.ok(cancelled, 'parsing failure cancels the underlying stream');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Request log tests passed.');
} finally {
  rmSync(resolvedProfile, { recursive: true, force: true });
}
