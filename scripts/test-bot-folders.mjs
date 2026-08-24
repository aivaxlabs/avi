import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-bot-folders-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const {
    BotManager,
    ensureBotFolders,
    resolveBotDataFolder,
    resolveBotWorkingFolder,
  } = await import('../src/main/bot-manager.js');
  const { createBot, createConversation } = database;
  const workingFolder = join(resolvedProfile, 'workspace');
  await mkdir(workingFolder, { recursive: true });

  const firstConversation = createConversation({
    model: 'test/model',
    projectPath: workingFolder,
    conversationType: 'bot',
  });
  const firstBot = createBot({
    conversationId: firstConversation.id,
    name: 'First bot',
    iconSeed: 'first-bot',
    workingFolder,
    model: 'test/model',
  });
  const secondConversation = createConversation({
    model: 'test/model',
    projectPath: workingFolder,
    conversationType: 'bot',
  });
  const secondBot = createBot({
    conversationId: secondConversation.id,
    name: 'Second bot',
    iconSeed: 'second-bot',
    workingFolder,
    model: 'test/model',
  });

  await Promise.all([
    writeFile(join(workingFolder, 'MEMORY.md'), '# Existing memory\n', 'utf8'),
    writeFile(join(workingFolder, 'backlog.json'), '[{"legacy":true}]\n', 'utf8'),
  ]);

  const firstFolders = await ensureBotFolders(firstBot);
  const secondFolders = await ensureBotFolders(secondBot);
  const firstDataFolder = join(workingFolder, '.avi-bots', firstBot.id);
  const secondDataFolder = join(workingFolder, '.avi-bots', secondBot.id);

  assert.equal(resolveBotWorkingFolder(firstBot), workingFolder);
  assert.equal(resolveBotDataFolder(firstBot), firstDataFolder);
  assert.deepEqual(firstFolders, { workingFolder, dataFolder: firstDataFolder });
  assert.deepEqual(secondFolders, { workingFolder, dataFolder: secondDataFolder });
  assert.notEqual(firstDataFolder, secondDataFolder);

  for (const dataFolder of [firstDataFolder, secondDataFolder]) {
    assert.equal(await readFile(join(dataFolder, '.gitignore'), 'utf8'), '*\n');
    assert.equal(await readFile(join(dataFolder, 'MEMORY.md'), 'utf8'), '# Existing memory\n');
    assert.deepEqual(JSON.parse(await readFile(join(dataFolder, 'work-items.json'), 'utf8')), []);
    assert.deepEqual(JSON.parse(await readFile(join(dataFolder, 'activity.json'), 'utf8')), []);
    assert.equal(existsSync(join(dataFolder, 'backlog.json')), false);
  }

  await writeFile(join(firstDataFolder, 'MEMORY.md'), '# Isolated memory\n', 'utf8');
  await writeFile(join(workingFolder, 'MEMORY.md'), '# Changed existing memory\n', 'utf8');
  await ensureBotFolders(firstBot);
  assert.equal(
    await readFile(join(firstDataFolder, 'MEMORY.md'), 'utf8'),
    '# Isolated memory\n',
    'existing bot data must not be overwritten by workspace files',
  );

  const manager = new BotManager();
  const firstRuntime = manager.getBotRuntimeContext(firstConversation.id);
  assert.equal(firstRuntime.workingFolder, workingFolder);
  assert.equal(firstRuntime.dataFolder, firstDataFolder);
  const createWork = firstRuntime.tools.find((tool) => tool.name === 'bot_work_create');
  assert.ok(createWork);
  await createWork.execute({
    title: 'Stored in the isolated folder',
    objective: 'Prove work state remains isolated per bot.',
  });
  assert.equal(existsSync(join(workingFolder, 'work-items.json')), false);
  assert.equal(
    JSON.parse(await readFile(join(firstDataFolder, 'work-items.json'), 'utf8'))[0].title,
    'Stored in the isolated folder',
  );
  assert.equal(
    JSON.parse(await readFile(join(secondDataFolder, 'work-items.json'), 'utf8')).length,
    0,
  );

  const describedFirstBot = manager.describeBots().find((bot) => bot.id === firstBot.id);
  assert.equal(describedFirstBot.resolvedWorkingFolder, workingFolder);
  assert.equal(describedFirstBot.resolvedDataFolder, firstDataFolder);
  assert.equal(manager.describeInvocationBot(firstConversation.id).dataFolder, firstDataFolder);

  let activationRequest = null;
  manager.attachChatRunner({
    runs: new Map(),
    send: async (request) => {
      activationRequest = request;
      return { message: { id: 'assistant-message' } };
    },
  });
  assert.equal(await manager.activateBot(firstBot.id, { trigger: 'manual' }), true);
  assert.equal(activationRequest.project.path, workingFolder);
  assert.ok(activationRequest.text.includes(`Bot data folder: ${firstDataFolder}`));
  assert.ok(activationRequest.text.includes('bot_work_read'));

  console.log('Bot folder tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
