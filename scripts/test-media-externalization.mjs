import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = resolve(mkdtempSync(join(tmpdir(), 'aivax-media-store-test-')));
process.env.USERPROFILE = testProfile;
process.env.HOME = testProfile;
process.env.TEMP = testProfile;
process.env.TMP = testProfile;
process.env.TMPDIR = testProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const {
    archiveConversation,
    createConversation,
    deleteConversation,
    forkConversation,
    getMessage,
    hydratePersistedMediaContent,
    insertMessage,
    restoreConversation,
    updateMessage,
  } = database;
  const { activeMediaDirectory, archivedMediaDirectory } = await import('../src/main/storage/media-store.js');

  const png = Buffer.alloc(64 * 1024, 7);
  const audio = Buffer.from('audio-bytes');
  const inlinePng = `data:image/png;base64,${png.toString('base64')}`;
  const conversation = createConversation({ title: 'Media store' });
  const toolSegment = (id) => ({
    type: 'tool-call',
    id,
    name: 'computer_use',
    argumentsText: '{}',
    resultText: 'ok',
    mediaContent: [
      { type: 'image_url', image_url: { url: inlinePng } },
      { type: 'input_audio', input_audio: { data: audio.toString('base64'), format: 'wav' } },
    ],
  });

  const inserted = insertMessage({
    conversationId: conversation.id,
    role: 'assistant',
    status: 'streaming',
    segments: [toolSegment('tool-1')],
  });
  const [image, sound] = getMessage(inserted.id).segments[0].mediaContent;
  const activeDirectory = join(activeMediaDirectory(), conversation.id);

  assert.ok(activeMediaDirectory().startsWith(testProfile));
  assert.ok(archivedMediaDirectory().startsWith(testProfile));
  assert.ok(image.image_url.path.startsWith(activeDirectory));
  assert.equal(image.image_url.mime, 'image/png');
  assert.equal(Object.hasOwn(image.image_url, 'url'), false);
  assert.deepEqual(readFileSync(image.image_url.path), png);
  assert.equal(sound.input_audio.format, 'wav');
  assert.equal(Object.hasOwn(sound.input_audio, 'data'), false);

  const hydrated = hydratePersistedMediaContent([image, sound]);
  assert.equal(hydrated[0].image_url.path, image.image_url.path);
  assert.equal(hydrated[1].input_audio.data, audio.toString('base64'));

  const updated = updateMessage(inserted.id, {
    status: 'completed',
    segments: [toolSegment('tool-1'), toolSegment('tool-2')],
  });
  const paths = updated.segments.map((segment) => segment.mediaContent[0].image_url.path);
  assert.equal(paths[0], paths[1]);
  assert.ok(JSON.stringify(updated.segments).length < png.toString('base64').length / 10);

  const fork = forkConversation(conversation.id);
  const forkedImage = database.getMessages(fork.conversation.id)
    .find((message) => message.role === 'assistant')
    .segments[0].mediaContent[0];
  assert.ok(forkedImage.image_url.path.startsWith(join(activeMediaDirectory(), fork.conversation.id)));
  assert.deepEqual(readFileSync(forkedImage.image_url.path), png);

  assert.equal(archiveConversation(conversation.id), true);
  const archivedImage = getMessage(inserted.id).segments[0].mediaContent[0];
  assert.ok(archivedImage.image_url.path.startsWith(join(archivedMediaDirectory(), conversation.id)));
  assert.deepEqual(readFileSync(archivedImage.image_url.path), png);
  assert.equal(existsSync(activeDirectory), false);
  assert.deepEqual(readFileSync(forkedImage.image_url.path), png);

  assert.equal(restoreConversation(conversation.id), true);
  const restoredImage = getMessage(inserted.id).segments[0].mediaContent[0];
  assert.equal(restoredImage.image_url.path, image.image_url.path);
  assert.deepEqual(readFileSync(restoredImage.image_url.path), png);

  deleteConversation(conversation.id, { hard: true });
  assert.equal(existsSync(activeDirectory), false);
  assert.deepEqual(readFileSync(forkedImage.image_url.path), png);

  console.log('Media externalization tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(testProfile, { recursive: true, force: true });
}
process.exit(0);
