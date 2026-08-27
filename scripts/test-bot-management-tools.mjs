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
  const administrativeSemaphoreCalls = [];
  let failNextActivation = false;
  const externalHolder = database.createConversation({
    title: 'External holder',
    model: model.id,
    projectPath: workspace,
  });
  const externalWaiter = database.createConversation({
    title: 'External waiter',
    model: model.id,
    projectPath: workspace,
  });
  const chatRunner = {
    runs: new Map([[externalHolder.id, {}]]),
    semaphores: {
      holdings: () => [],
      waitSnapshot: () => null,
      globalSnapshot: () => [{
        name: 'release-coordination',
        maxCount: 1,
        waitingCount: 1,
        holders: [{ conversationId: externalHolder.id, count: 1 }],
        queue: [{ conversationId: externalWaiter.id, position: 1 }],
      }],
    },
    releaseSemaphoreHolder: async (request) => {
      administrativeSemaphoreCalls.push({ action: 'release', ...request });
      return { ...request, released: 1, activated: 1, resumed: true };
    },
    releaseAllSemaphoreHolders: (name) => {
      administrativeSemaphoreCalls.push({ action: 'release-all', name });
      return { name, stopped: [externalHolder.id, externalWaiter.id] };
    },
    send: async (request) => {
      if (failNextActivation) {
        failNextActivation = false;
        throw new Error('Activation failed');
      }
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
    workQueue: ['Review releases & risks', 'Triage failures'],
    enabled: false,
  }, context);
  assert.equal(created.bot.name, 'Release coordinator');
  assert.equal(created.bot.enabled, false);
  assert.deepEqual(created.bot.workQueue, ['Review releases & risks', 'Triage failures']);
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
  assert.match(
    activationRequests[0].text,
    /<focus-task>Review releases &amp; risks<\/focus-task>/,
    'the activation prompt must include the current focus task safely',
  );
  assert.equal(getBot(created.bot.id).workQueueIndex, 1);
  assert.equal(getBot(created.bot.id).enabled, false, 'one-time activation must not enable the bot');

  failNextActivation = true;
  const failed = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(failed.activated, false);
  assert.equal(getBot(created.bot.id).workQueueIndex, 1, 'failed activation must not consume its task');

  const secondActivation = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(secondActivation.activated, true);
  assert.match(activationRequests[1].text, /<focus-task>Triage failures<\/focus-task>/);
  assert.equal(getBot(created.bot.id).workQueueIndex, 0, 'the queue must wrap after its final task');

  const botRuntime = botManager.getBotRuntimeContext(created.bot.conversationId);
  const administrativeToolNames = botRuntime.tools
    .filter((item) => item.name.startsWith('bot_semaphore_'))
    .map((item) => item.name);
  assert.deepEqual(administrativeToolNames, [
    'bot_semaphore_inspect',
    'bot_semaphore_release_thread',
    'bot_semaphore_release_all',
  ]);
  assert.equal(botManager.getBotRuntimeContext(externalHolder.id), null, 'normal threads must not receive bot tools');
  assert.equal(botManager.getBotRuntimeContext(workThreadId), null, 'bot work threads must not receive root tools');
  const inspectedSemaphore = await botRuntime.tools
    .find((item) => item.name === 'bot_semaphore_inspect')
    .execute({ name: 'release-coordination' });
  assert.equal(inspectedSemaphore.holders[0].title, 'External holder');
  assert.equal(inspectedSemaphore.holders[0].running, true);
  assert.equal(inspectedSemaphore.queue[0].title, 'External waiter');
  await botRuntime.tools
    .find((item) => item.name === 'bot_semaphore_release_thread')
    .execute({ name: 'release-coordination', threadId: externalHolder.id });
  await botRuntime.tools
    .find((item) => item.name === 'bot_semaphore_release_all')
    .execute({ name: 'release-coordination' });
  assert.deepEqual(administrativeSemaphoreCalls, [
    {
      action: 'release',
      name: 'release-coordination',
      conversationId: externalHolder.id,
    },
    { action: 'release-all', name: 'release-coordination' },
  ]);
  const botInstructions = await readFile(
    new URL('../src/prompts/bot-instructions.md', import.meta.url),
    'utf8',
  );
  for (const instruction of [
    'central orchestrator and may act as a supervisor',
    'advanced delegation tools',
    'application-wide root authority',
    'including threads you did not create',
    'Never acquire semaphore permits for this bot',
  ]) assert.ok(botInstructions.includes(instruction), `Missing bot instruction: ${instruction}`);

  const activeWorkItem = await botRuntime.tools
    .find((item) => item.name === 'bot_work_create')
    .execute({ title: 'Current release & follow-up', objective: 'Finish the active release work.' });
  await botRuntime.tools
    .find((item) => item.name === 'bot_work_update')
    .execute({ id: activeWorkItem.id, state: 'active' });
  const activeWorkActivation = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(activeWorkActivation.activated, true);
  assert.match(
    activationRequests[2].text,
    /<focus-task>Current release &amp; follow-up<\/focus-task>/,
    'active Current work must replace the recurring queue task in the activation prompt',
  );
  assert.equal(
    getBot(created.bot.id).workQueueIndex,
    0,
    'active Current work must not advance the recurring work queue',
  );
  await botRuntime.tools
    .find((item) => item.name === 'bot_work_update')
    .execute({ id: activeWorkItem.id, state: 'completed', summary: 'Active release work finished.' });

  await tool('bots_update').execute({
    id: created.bot.id,
    changes: { workQueue: [] },
  }, context);
  const emptyQueue = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.deepEqual(emptyQueue, {
    id: created.bot.id,
    activated: true,
    status: 'started',
  });
  assert.equal(activationRequests.length, 4, 'an empty queue must allow forced activation');
  assert.doesNotMatch(
    activationRequests[3].text,
    /<focus-task>/,
    'an empty queue must activate without a specific focus task',
  );
  assert.equal(getBot(created.bot.id).workQueueIndex, 0, 'an empty queue must preserve its queue index');
  await tool('bots_update').execute({
    id: created.bot.id,
    changes: { workQueue: ['Resume protected work'] },
  }, context);

  chatRunner.runs.set(created.bot.conversationId, {});
  const duplicate = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(duplicate.activated, false);
  assert.equal(duplicate.status, 'already_running_or_start_failed');
  assert.equal(activationRequests.length, 4, 'explicit activation must not start duplicate runs');
  chatRunner.runs.clear();
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
  persistedItems.find((item) => item.id === workItem.id).approval.botId = 'different-bot';
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
