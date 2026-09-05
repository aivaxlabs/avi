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
  const {
    createBot,
    createConversation,
    getBot,
    getComposerState,
    getConversation,
    getGoalForConversation,
    getMessages,
    insertGoal,
    insertMessage,
    listTasks,
    replaceTasks,
    setComposerState,
  } = database;
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
    workQueue: ['Verify folder isolation'],
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
    assert.deepEqual(JSON.parse(await readFile(join(dataFolder, 'inbox.json'), 'utf8')), []);
    assert.deepEqual(JSON.parse(await readFile(join(dataFolder, 'diary.json'), 'utf8')), []);
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
  const createPendency = firstRuntime.tools.find((tool) => tool.name === 'bot_pendency_create');
  assert.ok(createPendency);
  await createPendency.execute({
    title: 'Stored in the isolated folder',
    content: 'Prove work state remains isolated per bot.',
  });
  assert.equal(existsSync(join(workingFolder, 'inbox.json')), false);
  assert.equal(
    JSON.parse(await readFile(join(firstDataFolder, 'inbox.json'), 'utf8'))[0].title,
    'Stored in the isolated folder',
  );
  assert.equal(
    JSON.parse(await readFile(join(secondDataFolder, 'inbox.json'), 'utf8')).length,
    0,
  );

  const describedFirstBot = manager.describeBots().find((bot) => bot.id === firstBot.id);
  assert.equal(describedFirstBot.resolvedWorkingFolder, workingFolder);
  assert.equal(describedFirstBot.resolvedDataFolder, firstDataFolder);
  assert.equal(manager.describeInvocationBot(firstConversation.id).dataFolder, firstDataFolder);

  let activationRequest = null;
  const stoppedConversationIds = [];
  const priorUserMessage = insertMessage({
    conversationId: firstConversation.id,
    role: 'user',
    content: 'Work completed before this activation.',
    status: 'completed',
  });
  const priorAssistantMessage = insertMessage({
    conversationId: firstConversation.id,
    role: 'assistant',
    content: 'Prior activation outcome.',
    status: 'completed',
  });
  database.updateConversation(firstConversation.id, {
    checkpointMessageId: priorUserMessage.id,
    contextCheckpoint: 'STALE_COMPACTION_SUMMARY',
    contextTokens: 12345,
  });
  manager.attachChatRunner({
    runs: new Map(),
    stop: (conversationId) => stoppedConversationIds.push(conversationId),
    send: async (request) => {
      activationRequest = request;
      return { message: { id: 'assistant-message' } };
    },
  });
  assert.equal(await manager.activateBot(firstBot.id, { trigger: 'manual' }), true);
  assert.equal(activationRequest.project.path, workingFolder);
  assert.equal(getConversation(firstConversation.id).contextCheckpoint, '');
  assert.equal(getConversation(firstConversation.id).contextTokens, 0);
  assert.ok(!JSON.stringify(database.toModelMessages(firstConversation.id)).includes('STALE_COMPACTION_SUMMARY'));
  assert.equal(
    getConversation(firstConversation.id).checkpointMessageId,
    priorAssistantMessage.id,
    'bot activation marks the previous history as the checkpoint boundary',
  );
  assert.ok(
    !database.toModelMessages(firstConversation.id).some((message) => (
      message.content === priorUserMessage.content
      || message.content === priorAssistantMessage.content
    )),
    'bot activation checkpoint excludes earlier history from model context',
  );

  insertMessage({ conversationId: firstConversation.id, role: 'user', content: 'Reset me.' });
  replaceTasks(firstConversation.id, [{ title: 'Reset tracking', done: false }]);
  const now = new Date().toISOString();
  insertGoal({
    id: 'goal-to-reset',
    conversationId: firstConversation.id,
    specification: 'Reset this goal.',
    status: 'active',
    revision: 1,
    model: 'test/model',
    reasoningEffort: null,
    permissionMode: 'full_access',
    activeElapsedMs: 0,
    resumedAt: now,
    resultSummary: null,
    tokensTransacted: null,
    startedAt: now,
    updatedAt: now,
    endedAt: null,
  });
  setComposerState(firstConversation.id, {
    model: 'test/model',
    workMode: 'goal',
    draftText: 'Reset this draft.',
  });
  const workerConversation = createConversation({
    model: 'test/model',
    projectPath: workingFolder,
    createdBy: 'agent',
    parentConversationId: firstConversation.id,
  });
  insertMessage({ conversationId: workerConversation.id, role: 'user', content: 'Worker history.' });
  manager.approvals.set('approval-to-reset', { botId: firstBot.id });
  await writeFile(join(firstDataFolder, 'extra-tracking.json'), '{}\n', 'utf8');
  await writeFile(join(secondDataFolder, 'MEMORY.md'), '# Keep this memory\n', 'utf8');

  const resetConversation = await manager.fullResetBot(firstBot.id);
  assert.equal(resetConversation.id, firstConversation.id);
  assert.deepEqual(
    {
      name: getBot(firstBot.id)?.name,
      iconSeed: getBot(firstBot.id)?.iconSeed,
      workingFolder: getBot(firstBot.id)?.workingFolder,
      model: getBot(firstBot.id)?.model,
      activationPeriodMinutes: getBot(firstBot.id)?.activationPeriodMinutes,
      enabled: getBot(firstBot.id)?.enabled,
    },
    {
      name: firstBot.name,
      iconSeed: firstBot.iconSeed,
      workingFolder: firstBot.workingFolder,
      model: firstBot.model,
      activationPeriodMinutes: firstBot.activationPeriodMinutes,
      enabled: firstBot.enabled,
    },
    'full reset must keep the bot configuration',
  );
  assert.deepEqual(getMessages(firstConversation.id), []);
  assert.deepEqual(listTasks(firstConversation.id), []);
  assert.equal(getGoalForConversation(firstConversation.id), null);
  assert.equal(getComposerState(firstConversation.id), null);
  assert.equal(getConversation(workerConversation.id), null);
  assert.equal(manager.approvals.has('approval-to-reset'), false);
  assert.equal(existsSync(firstDataFolder), false);
  assert.equal(await readFile(join(secondDataFolder, 'MEMORY.md'), 'utf8'), '# Keep this memory\n');
  assert.ok(stoppedConversationIds.includes(firstConversation.id));
  assert.ok(stoppedConversationIds.includes(workerConversation.id));

  const dedicatedConversation = createConversation({
    model: 'test/model',
    conversationType: 'bot',
  });
  const dedicatedBot = createBot({
    conversationId: dedicatedConversation.id,
    name: 'Dedicated bot',
    iconSeed: 'dedicated-bot',
    model: 'test/model',
  });
  const dedicatedWorkingFolder = resolveBotWorkingFolder(dedicatedBot);
  const dedicatedDataFolder = resolveBotDataFolder(dedicatedBot);
  const dedicatedMcpConfig = join(
    dedicatedWorkingFolder,
    '.agents',
    'bots',
    dedicatedBot.id,
    'mcpconfig.json',
  );
  await ensureBotFolders(dedicatedBot);
  await mkdir(join(dedicatedWorkingFolder, '.agents', 'bots', dedicatedBot.id), { recursive: true });
  await writeFile(dedicatedMcpConfig, '{"mcpServers":{}}\n', 'utf8');
  await writeFile(join(dedicatedWorkingFolder, 'bot-output.txt'), 'remove me\n', 'utf8');

  await manager.fullResetBot(dedicatedBot.id);
  assert.ok(getBot(dedicatedBot.id), 'full reset must preserve a dedicated bot configuration');
  assert.equal(existsSync(dedicatedDataFolder), false);
  assert.equal(existsSync(join(dedicatedWorkingFolder, 'bot-output.txt')), false);
  assert.equal(await readFile(dedicatedMcpConfig, 'utf8'), '{"mcpServers":{}}\n');

  console.log('Bot folder tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
