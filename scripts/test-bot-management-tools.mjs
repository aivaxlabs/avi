import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-bot-management-tools-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { BotManager, resolveBotDataFolder } = await import('../src/main/bot-manager.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const {
    getBot,
    getConversation,
    listAllConversations,
  } = database;
  const workspace = join(resolvedProfile, 'workspace');
  await mkdir(workspace, { recursive: true });

  const model = {
    id: 'test/model',
    name: 'Test model',
    reasoning: ['medium'],
  };
  const activationRequests = [];
  const chatRunner = {
    runs: new Map(),
    semaphores: {
      holdings: () => [],
      waitSnapshot: () => null,
    },
    send: async (request) => {
      activationRequests.push(request);
      return { message: { id: `message-${activationRequests.length}` } };
    },
  };
  const botManager = new BotManager();
  botManager.attachChatRunner(chatRunner);
  const context = {
    botManager,
    chatRunner,
    models: [model],
  };
  const tool = (name) => {
    const result = CLIENT_TOOLS.find((item) => item.name === name);
    assert.ok(result, `${name} must be registered`);
    return result;
  };

  const created = await tool('bots_create').execute({
    name: 'Release coordinator',
    model: model.id,
    workingFolder: workspace,
    instructions: 'Coordinate release readiness.',
    activationMode: 'smart',
    activationPeriodMinutes: 15,
    enabled: false,
  }, context);
  assert.equal(created.bot.name, 'Release coordinator');
  assert.equal(created.bot.enabled, false);
  assert.equal(getConversation(created.bot.conversationId).conversationType, 'bot');

  const updated = await tool('bots_update').execute({
    id: created.bot.id,
    changes: {
      name: 'Release manager',
      maxActivations: 4,
      reasoningEffort: 'medium',
    },
  }, context);
  assert.equal(updated.bot.name, 'Release manager');
  assert.equal(updated.bot.maxActivations, 4);
  assert.equal(getConversation(created.bot.conversationId).title, 'Release manager');

  const createThreadResult = await tool('chat_create_thread').execute({
    folderPath: workspace,
    model_name: model.id,
  }, {
    ...context,
    conversationId: created.bot.conversationId,
    model: model.id,
    reasoningEffort: null,
    permissionMode: 'approve_for_me',
    workspacePath: workspace,
    defaultModels: {},
  });
  const workThreadId = /^ID: (.+)$/m.exec(createThreadResult)?.[1];
  assert.ok(workThreadId);
  assert.equal(getConversation(workThreadId).parentConversationId, created.bot.conversationId);

  const listed = await tool('bots_list').execute({}, context);
  const listedBot = listed.bots.find((bot) => bot.id === created.bot.id);
  assert.equal(listedBot.name, 'Release manager');
  assert.equal(listedBot.workThreads.length, 1);
  assert.equal(listedBot.workThreads[0].id, workThreadId);
  assert.equal(listedBot.workThreads[0].running, false);

  const activated = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.deepEqual(activated, {
    id: created.bot.id,
    activated: true,
    status: 'started',
  });
  assert.equal(activationRequests.length, 1, 'explicit activation must run a disabled bot');
  assert.equal(activationRequests[0].conversationId, created.bot.conversationId);
  assert.equal(getBot(created.bot.id).enabled, false, 'one-time activation must not enable the bot');

  chatRunner.runs.set(created.bot.conversationId, {});
  const duplicate = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(duplicate.activated, false);
  assert.equal(duplicate.status, 'already_running_or_start_failed');
  assert.equal(activationRequests.length, 1, 'explicit activation must not start duplicate runs');
  chatRunner.runs.clear();

  const botRuntime = botManager.getBotRuntimeContext(created.bot.conversationId);
  const workItem = await botRuntime.tools
    .find((item) => item.name === 'bot_work_create')
    .execute({ title: 'Protected work', objective: 'Verify approval ownership.' });
  await botManager.queueUserApproval(created.bot.conversationId, {
    workItemId: workItem.id,
    context: 'Confirm the protected action.',
    prompt: 'Continue the protected action.',
  });
  const dataFolder = resolveBotDataFolder(created.bot);
  const workItemsPath = join(dataFolder, 'work-items.json');
  const persistedItems = JSON.parse(await readFile(workItemsPath, 'utf8'));
  persistedItems[0].approval.botId = 'different-bot';
  await writeFile(workItemsPath, `${JSON.stringify(persistedItems, null, 2)}\n`, 'utf8');
  const reloadedManager = new BotManager();
  await reloadedManager.loadPersistedApprovals();
  assert.equal(
    reloadedManager.approvals.size,
    0,
    'persisted approvals must belong to the bot that owns the data folder',
  );

  assert.equal(tool('bots_delete').forceApproval, true);
  assert.equal(await tool('bots_delete').execute({ id: created.bot.id }, context).then((result) => result.deleted), true);
  assert.equal(getBot(created.bot.id), null);
  assert.equal(getConversation(created.bot.conversationId), null);
  assert.equal(
    listAllConversations().some((conversation) => conversation.id === workThreadId),
    true,
    'deleting a bot must preserve its work threads as history',
  );

  console.log('Bot management tool tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
