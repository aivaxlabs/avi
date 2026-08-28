import assert from 'node:assert/strict';
import { readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createVideoFileResponse,
  materializeLegacyVideoAttachments,
  materializeVideoAttachment,
  normalizeAttachmentsForModel,
} from '../src/main/files.js';
import { fileToAttachment } from '../src/renderer/lib/files.js';
import { attachmentContentSizeLimit } from '../src/shared/attachments.js';

const bytes = Buffer.from('clipboard-video-payload');
const attachment = {
  id: crypto.randomUUID(),
  name: 'clipboard.mp4',
  mime: 'video/mp4',
  size: bytes.length,
  kind: 'video_url',
  source: 'clipboard',
  dataUrl: `data:video/mp4;base64,${bytes.toString('base64')}`,
};
const paths = [];

try {
  globalThis.window = {
    chatApp: {
      files: {
        pathForFile: () => '',
      },
    },
  };
  await assert.rejects(
    fileToAttachment({
      name: 'large-clipboard.mp4',
      type: 'video/mp4',
      size: attachmentContentSizeLimit + 1,
    }, 'clipboard'),
    /Save this video to disk before attaching it/,
  );

  const materialized = await materializeVideoAttachment(attachment);
  paths.push(materialized.path);
  assert.equal(materialized.kind, 'video_url');
  assert.equal(materialized.temporary, true);
  assert.equal(materialized.dataUrl, undefined);
  assert.equal(materialized.base64, undefined);
  assert.deepEqual(await readFile(materialized.path), bytes);

  const unchanged = { id: 'image', kind: 'image_url', dataUrl: 'data:image/png;base64,AA==' };
  const [legacyVideo, unchangedImage] = await materializeLegacyVideoAttachments([
    attachment,
    unchanged,
  ]);
  paths.push(legacyVideo.path);
  assert.equal(legacyVideo.kind, 'video_url');
  assert.equal(legacyVideo.dataUrl, undefined);
  assert.deepEqual(await readFile(legacyVideo.path), bytes);
  assert.equal(unchangedImage, unchanged);

  const fullResponse = await createVideoFileResponse(materialized.path);
  assert.equal(fullResponse.status, 200);
  assert.equal(fullResponse.headers.get('accept-ranges'), 'bytes');
  assert.equal(fullResponse.headers.get('content-type'), 'video/mp4');
  assert.equal(fullResponse.headers.get('content-length'), String(bytes.length));
  assert.deepEqual(Buffer.from(await fullResponse.arrayBuffer()), bytes);

  const rangeResponse = await createVideoFileResponse(materialized.path, 'bytes=2-7');
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get('content-range'), `bytes 2-7/${bytes.length}`);
  assert.equal(rangeResponse.headers.get('content-length'), '6');
  assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()), bytes.subarray(2, 8));

  const suffixResponse = await createVideoFileResponse(materialized.path, 'bytes=-4');
  assert.equal(suffixResponse.status, 206);
  assert.deepEqual(Buffer.from(await suffixResponse.arrayBuffer()), bytes.subarray(-4));

  const invalidRangeResponse = await createVideoFileResponse(materialized.path, 'bytes=999-');
  assert.equal(invalidRangeResponse.status, 416);
  assert.equal(invalidRangeResponse.headers.get('content-range'), `bytes */${bytes.length}`);

  const multiRangeResponse = await createVideoFileResponse(materialized.path, 'bytes=0-1,4-5');
  assert.equal(multiRangeResponse.status, 200);
  assert.deepEqual(Buffer.from(await multiRangeResponse.arrayBuffer()), bytes);

  const [normalized] = await normalizeAttachmentsForModel([attachment], { video: true });
  paths.push(normalized.path);
  assert.equal(normalized.kind, 'video_url');
  assert.equal(normalized.temporary, true);
  assert.equal(normalized.dataUrl, undefined);
  assert.equal(normalized.base64, undefined);
  assert.deepEqual(await readFile(normalized.path), bytes);

  const explorerSource = resolve('scripts/test-video-attachments.mjs');
  const explorerAttachment = await fileToAttachment({
    name: 'copied-from-explorer.mp4',
    type: 'video/mp4',
    size: bytes.length,
    path: explorerSource,
  }, 'clipboard');
  const [copiedFromExplorer] = await normalizeAttachmentsForModel(
    [explorerAttachment],
    { video: true },
  );
  assert.equal(copiedFromExplorer.path, await realpath(explorerSource));
  assert.equal(copiedFromExplorer.temporary, false);

  console.log('Video attachment tests passed.');
} finally {
  delete globalThis.window;
  await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true })));
}
