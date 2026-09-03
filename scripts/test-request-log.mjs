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

  console.log('Request log tests passed.');
} finally {
  rmSync(resolvedProfile, { recursive: true, force: true });
}
