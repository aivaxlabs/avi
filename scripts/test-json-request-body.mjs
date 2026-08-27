import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createJsonRequestBody,
  fileBase64JsonValue,
} from '../src/main/json-request-body.js';

const root = await mkdtemp(join(tmpdir(), 'avi-json-request-body-'));
try {
  const bytes = Buffer.alloc((512 * 1024) + 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  const filePath = join(root, 'video.mp4');
  await writeFile(filePath, bytes);

  const body = {
    model: 'test-ü',
    input: [{
      type: 'input_video',
      video_url: fileBase64JsonValue(filePath, 'video/mp4'),
    }],
    optional: undefined,
    array: [undefined, 'text', true, null],
  };
  const expected = JSON.stringify({
    model: 'test-ü',
    input: [{
      type: 'input_video',
      video_url: `data:video/mp4;base64,${bytes.toString('base64')}`,
    }],
    array: [null, 'text', true, null],
  });
  const request = createJsonRequestBody(body);
  const chunks = [];
  for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
  const serialized = Buffer.concat(chunks);

  assert.equal(serialized.toString('utf8'), expected);
  assert.equal(request.contentLength, Buffer.byteLength(expected));
  assert.ok(Math.max(...chunks.map((chunk) => chunk.length)) < 300 * 1024);
  assert.ok(chunks.length > 3);

  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const aborted = createJsonRequestBody(body, controller.signal);
  await assert.rejects(async () => {
    for await (const _chunk of aborted.body) {}
  }, /cancelled/);

  console.log('JSON request body tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
