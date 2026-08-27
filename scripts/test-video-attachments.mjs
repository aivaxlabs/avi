import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import {
  createVideoFileResponse,
  importVideoAttachment,
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
        importVideo: (attachment) => importVideoAttachment(attachment),
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

  const transientDirectory = resolve(tmpdir(), `avi-video-test-${Date.now()}`);
  await mkdir(transientDirectory, { recursive: true });
  paths.push(transientDirectory);
  const transientName = `Avi_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}.mp4`;
  const transientSource = resolve(transientDirectory, transientName);
  await writeFile(transientSource, bytes);

  const imported = await importVideoAttachment({
    id: 'transient',
    name: transientName,
    mime: 'video/mp4',
    size: bytes.length,
    kind: 'video_url',
    path: transientSource,
  });
  paths.push(imported.path);
  assert.equal(imported.kind, 'video_url');
  assert.equal(imported.temporary, true);
  assert.notEqual(imported.path, transientSource);
  assert.equal(basename(imported.path).endsWith(`-${transientName}`), true);
  assert.deepEqual(await readFile(imported.path), bytes);

  const dropped = await fileToAttachment({
    name: transientName,
    type: 'video/mp4',
    size: bytes.length,
    path: transientSource,
  }, 'clipboard');
  assert.equal(dropped.kind, 'video_url');
  assert.equal(dropped.temporary, true);
  assert.equal(basename(dropped.path).endsWith(`-${transientName}`), true);
  assert.deepEqual(await readFile(dropped.path), bytes);
  paths.push(dropped.path);

  const stablePath = resolve('package.json');
  const stable = await importVideoAttachment({
    id: 'stable',
    name: 'stable.mp4',
    kind: 'video_url',
    path: stablePath,
  });
  assert.equal(stable.path, stablePath);
  assert.equal(stable.temporary, undefined);

  const missing = await importVideoAttachment({
    id: 'missing',
    name: 'Avi_missing.mp4',
    kind: 'video_url',
    path: resolve(tmpdir(), `avi-video-test-missing-${Date.now()}.mp4`),
  });
  assert.equal(missing.temporary, undefined);

  console.log('Video attachment tests passed.');
} finally {
  delete globalThis.window;
  await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true })));
}
