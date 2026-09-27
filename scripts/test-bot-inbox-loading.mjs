import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-bot-inbox-loading-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { BotManager, ensureBotFolders } = await import('../src/main/bot-manager.js');
  const { createBotPendency } = await import('../src/main/bot-work-state.js');
  const { createBot, createConversation, listBots } = database;

  const workingFolder = join(resolvedProfile, 'workspace');
  await mkdir(workingFolder, { recursive: true });

  const bots = [];
  for (let index = 0; index < 4; index += 1) {
    const conversation = createConversation({
      model: 'test/model',
      projectPath: workingFolder,
      conversationType: 'bot',
    });
    bots.push(createBot({
      conversationId: conversation.id,
      name: `Inbox bot ${index}`,
      iconSeed: `inbox-bot-${index}`,
      workingFolder,
      model: 'test/model',
      enabled: false,
    }));
  }

  const manager = new BotManager();
  const folders = [];
  for (const bot of bots) folders.push((await ensureBotFolders(bot)).dataFolder);
  const pending = await createBotPendency(folders[0], {
    title: 'Choose export format',
    content: 'Should the Acme export use CSV or JSON?',
  });
  await writeFile(join(folders[1], 'diary.json'), '{}\n', 'utf8');
  await writeFile(join(folders[2], 'inbox.json'), '{}\n', 'utf8');

  const byBot = await manager.listBotDataByBot();
  assert.deepEqual(Object.keys(byBot), listBots().map((bot) => bot.id));
  assert.equal(byBot[bots[0].id].inbox[0].id, pending.id);
  assert.deepEqual(byBot[bots[0].id].errors, { inbox: null, activity: null });
  assert.deepEqual(byBot[bots[1].id].inbox, []);
  assert.equal(byBot[bots[1].id].errors.inbox, null);
  assert.match(byBot[bots[1].id].errors.activity, /Invalid diary.json/);
  assert.match(byBot[bots[1].id].error, /^Activity: /);
  assert.match(byBot[bots[2].id].errors.inbox, /Invalid inbox.json/);
  assert.equal(byBot[bots[2].id].errors.activity, null);
  assert.deepEqual(byBot[bots[2].id].activity, []);
  assert.deepEqual(byBot[bots[3].id].errors, { inbox: null, activity: null });

  const single = await manager.listBotDataByBot(bots[0].id);
  assert.deepEqual(Object.keys(single), [bots[0].id]);
  await assert.rejects(manager.listBotDataByBot('missing-bot'), /Bot not found/);

  console.log('Bot inbox loading tests passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(process.exitCode || 0);
