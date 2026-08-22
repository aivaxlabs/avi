import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-bot-enabled-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { createBot, createConversation, getBot, updateBot } = database;
  const conversation = createConversation({ model: 'test/model', projectPath: resolvedProfile });
  const bot = createBot({
    conversationId: conversation.id,
    name: 'Enabled bot',
    iconSeed: 'enabled-bot',
    model: 'test/model',
  });

  assert.equal(bot.enabled, true, 'new bots are enabled by default');
  assert.equal(updateBot(bot.id, { enabled: false }).enabled, false, 'disabled state is persisted');
  assert.equal(getBot(bot.id).enabled, false, 'disabled state survives a fresh read');
  assert.equal(updateBot(bot.id, { enabled: true }).enabled, true, 'bots can be enabled again');

  console.log('Bot enabled database tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
