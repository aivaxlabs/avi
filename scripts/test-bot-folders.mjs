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
    BOT_DAILY_LOG_STATUSES,
  } = await import('../src/main/bot-daily-logs.js');
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

  const timestamp = '2026-08-22T12:00:00.000Z';
  const approvalEntries = [firstBot, secondBot].map((bot) => ({
    id: `approval-${bot.id}`,
    botId: bot.id,
    kind: 'work',
    title: `Approval for ${bot.name}`,
    content: 'Legacy approval',
    context: 'Legacy approval',
    prompt: 'Continue after approval.',
    status: 'waiting-user-approval',
    date: '2026-08-22',
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  await Promise.all([
    writeFile(join(workingFolder, 'MEMORY.md'), '# Legacy memory\n', 'utf8'),
    writeFile(join(workingFolder, 'backlog.json'), '[]\n', 'utf8'),
    writeFile(
      join(workingFolder, 'waiting-user-approval.json'),
      `${JSON.stringify(approvalEntries, null, 2)}\n`,
      'utf8',
    ),
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
  assert.equal(await readFile(join(firstDataFolder, '.gitignore'), 'utf8'), '*\n');
  assert.equal(await readFile(join(secondDataFolder, '.gitignore'), 'utf8'), '*\n');
  assert.equal(await readFile(join(firstDataFolder, 'MEMORY.md'), 'utf8'), '# Legacy memory\n');
  assert.equal(await readFile(join(workingFolder, 'MEMORY.md'), 'utf8'), '# Legacy memory\n');

  for (const status of BOT_DAILY_LOG_STATUSES) {
    assert.ok(existsSync(join(firstDataFolder, `${status}.json`)));
    assert.ok(existsSync(join(secondDataFolder, `${status}.json`)));
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(firstDataFolder, 'waiting-user-approval.json'), 'utf8')),
    [approvalEntries[0]],
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(secondDataFolder, 'waiting-user-approval.json'), 'utf8')),
    [approvalEntries[1]],
  );

  await writeFile(join(firstDataFolder, 'MEMORY.md'), '# Isolated memory\n', 'utf8');
  await writeFile(join(workingFolder, 'MEMORY.md'), '# Changed legacy memory\n', 'utf8');
  await ensureBotFolders(firstBot);
  assert.equal(
    await readFile(join(firstDataFolder, 'MEMORY.md'), 'utf8'),
    '# Isolated memory\n',
    'existing bot data must not be overwritten by legacy files',
  );

  const manager = new BotManager();
  const firstRuntime = manager.getBotRuntimeContext(firstConversation.id);
  assert.equal(firstRuntime.workingFolder, workingFolder);
  assert.equal(firstRuntime.dataFolder, firstDataFolder);
  const writeLog = firstRuntime.tools.find((tool) => tool.name === 'bot_daily_write_log');
  await writeLog.execute({
    title: 'Stored in the isolated folder',
    content: 'The workspace root must remain unchanged.',
    status: 'done',
  });
  assert.equal(existsSync(join(workingFolder, 'done.json')), false);
  assert.equal(
    JSON.parse(await readFile(join(firstDataFolder, 'done.json'), 'utf8'))[0].title,
    'Stored in the isolated folder',
  );
  assert.equal(
    JSON.parse(await readFile(join(secondDataFolder, 'done.json'), 'utf8')).length,
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

  console.log('Bot folder tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
