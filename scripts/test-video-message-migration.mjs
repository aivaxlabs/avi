import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-video-message-migration-'));
assert.ok(resolve(testProfile).startsWith(resolve(tmpdir())));
process.env.USERPROFILE = testProfile;

let database;
let migratedPath = null;
try {
  database = await import('../src/main/database.js');
  const { materializeLegacyVideoAttachments } = await import('../src/main/files.js');
  const conversation = database.createConversation({
    title: 'Legacy video migration',
    model: 'test:model',
    projectPath: testProfile,
  });
  const bytes = Buffer.from('legacy-video');
  const message = database.insertMessage({
    conversationId: conversation.id,
    role: 'user',
    status: 'sent',
    content: 'Video',
    attachments: [{
      id: crypto.randomUUID(),
      name: 'legacy.mp4',
      mime: 'video/mp4',
      size: bytes.length,
      kind: 'video_url',
      dataUrl: `data:video/mp4;base64,${bytes.toString('base64')}`,
    }],
  });
  const updatedAt = database.getConversation(conversation.id).updatedAt;
  const attachments = await materializeLegacyVideoAttachments(message.attachments);
  migratedPath = attachments[0].path;
  database.updateMessage(message.id, { attachments }, { touch: false });

  const persisted = database.getMessage(message.id).attachments[0];
  assert.equal(persisted.kind, 'video_url');
  assert.equal(persisted.dataUrl, undefined);
  assert.equal(typeof persisted.path, 'string');
  assert.equal(database.getConversation(conversation.id).updatedAt, updatedAt);

  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const readMediaFile = CLIENT_TOOLS.find((tool) => tool.name === 'read_media_file');
  const probePath = join(testProfile, 'probe.mp4');
  await writeFile(probePath, bytes);
  const freshRead = await readMediaFile.execute(
    { path: probePath },
    { capabilities: { video: true }, userAttachments: [] },
  );
  assert.ok(Array.isArray(freshRead.mediaContent));
  const duplicateRead = await readMediaFile.execute(
    { path: probePath },
    { capabilities: { video: true }, userAttachments: [{ id: 'probe', kind: 'video_url', path: probePath }] },
  );
  assert.equal(duplicateRead.mediaContent, undefined);
  assert.match(duplicateRead.output, /already attached to this conversation/i);

  console.log('Video message migration tests passed.');
} finally {
  database?.closeDatabase();
  if (migratedPath) await rm(migratedPath, { force: true });
  rmSync(testProfile, { recursive: true, force: true });
}
process.exit(0);
