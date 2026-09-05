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
  const { appendBotPendencyMessage } = await import('../src/main/bot-work-state.js');
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
  let failNextReplySends = 0;
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
      if (failNextReplySends > 0) {
        failNextReplySends -= 1;
        throw new Error('Delivery failed');
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

  const threadList = await tool('chat_list_threads').execute({ folderPath: workspace }, context);
  const botThread = threadList.split('\n--------\n')
    .find((thread) => thread.includes(`ID: ${created.bot.conversationId}`));
  assert.ok(botThread, 'chat_list_threads must include the bot main thread');
  assert.match(botThread, /(?:^|\n)- Release manager\n/);
  assert.match(botThread, /\n  Model: ~avi-bot\/Release manager\n/);

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

  await assert.rejects(
    () => tool('bots_update').execute({
      id: created.bot.id,
      changes: { workQueueIndex: 2 },
    }, context),
    /Work queue index is out of range/,
  );
  assert.equal(getBot(created.bot.id).workQueueIndex, 1, 'invalid queue selection must not mutate the bot');
  await tool('bots_update').execute({
    id: created.bot.id,
    changes: { workQueueIndex: 0 },
  }, context);
  assert.equal(getBot(created.bot.id).workQueueIndex, 0, 'queue selection must change the next task');
  const selectedActivation = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(selectedActivation.activated, true);
  assert.match(activationRequests[1].text, /<focus-task>Review releases &amp; risks<\/focus-task>/);
  assert.equal(getBot(created.bot.id).workQueueIndex, 1, 'selected task must advance normally after activation');

  failNextActivation = true;
  const failed = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(failed.activated, false);
  assert.equal(getBot(created.bot.id).workQueueIndex, 1, 'failed activation must not consume its task');

  const secondActivation = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(secondActivation.activated, true);
  assert.match(activationRequests[2].text, /<focus-task>Triage failures<\/focus-task>/);
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
    'bot_pendencies_list',
    'bot_pendency_create',
    'bot_pendency_message',
    'bot_pendency_complete',
    'bot_activity_append',
    'queue_user_approval',
    'Never acquire semaphore permits for this bot',
  ]) assert.ok(botInstructions.includes(instruction), `Missing bot instruction: ${instruction}`);

  const activePendency = await botRuntime.tools
    .find((item) => item.name === 'bot_pendency_create')
    .execute({ title: 'Current release & follow-up', content: 'Finish the active release work.' });
  // A user reply makes the pendency the bot's actionable focus task.
  await appendBotPendencyMessage(resolveBotDataFolder(created.bot), {
    pendencyId: activePendency.id,
    role: 'user',
    content: 'Please proceed with the release work.',
  });
  const activeWorkActivation = await tool('bots_activate').execute({ id: created.bot.id }, context);
  assert.equal(activeWorkActivation.activated, true);
  assert.match(
    activationRequests[3].text,
    /<focus-task>Current release &amp; follow-up<\/focus-task>/,
    'active Current work must replace the recurring queue task in the activation prompt',
  );
  assert.equal(
    getBot(created.bot.id).workQueueIndex,
    0,
    'active Current work must not advance the recurring work queue',
  );
  await botRuntime.tools
    .find((item) => item.name === 'bot_pendency_complete')
    .execute({ id: activePendency.id });

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
  assert.equal(activationRequests.length, 5, 'an empty queue must allow forced activation');
  assert.doesNotMatch(
    activationRequests[4].text,
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
  assert.equal(activationRequests.length, 5, 'explicit activation must not start duplicate runs');
  chatRunner.runs.clear();
  const protectedPendency = await botRuntime.tools
    .find((item) => item.name === 'bot_pendency_create')
    .execute({ title: 'Protected work', content: 'Verify approval ownership.' });
  const approvalQueueMessage = await botManager.queueUserApproval(created.bot.conversationId, {
    title: 'Confirm the protected action',
    context: 'Confirm the protected action.',
    prompt: 'Continue the protected action.',
  });
  assert.match(approvalQueueMessage, /approval id: /);
  assert.match(approvalQueueMessage, /pendency id: /);
  const dataFolder = resolveBotDataFolder(created.bot);
  const inboxPath = join(dataFolder, 'inbox.json');
  const persistedItems = JSON.parse(await readFile(inboxPath, 'utf8'));
  const queuedApprovalPendency = persistedItems.find((item) => item.approval);
  assert.ok(queuedApprovalPendency, 'queue_user_approval must persist a protected pendency');
  assert.equal(queuedApprovalPendency.approval.kind, 'work');
  assert.equal(queuedApprovalPendency.approval.pendencyId, queuedApprovalPendency.id);
  assert.equal(queuedApprovalPendency.approval.status, 'pending');
  assert.notEqual(queuedApprovalPendency.id, protectedPendency.id);
  assert.equal(queuedApprovalPendency.messages[0].content, 'Confirm the protected action.');
  queuedApprovalPendency.approval.botId = 'different-bot';
  await writeFile(inboxPath, `${JSON.stringify(persistedItems, null, 2)}\n`, 'utf8');
  const reloadedManager = new BotManager();
  await reloadedManager.loadPersistedApprovals();
  assert.equal(
    reloadedManager.approvals.size,
    0,
    'persisted approvals must belong to the bot that owns the data folder',
  );

  // --- Pendency reply, delivery, completion, and approval resolution ---
  const replyResult = await botManager.replyToPendency(created.bot.id, protectedPendency.id, {
    content: 'Please proceed carefully.  ',
  });
  assert.equal(replyResult.delivered, true);
  assert.equal(replyResult.error, undefined);
  assert.equal(replyResult.item.messages.at(-1).role, 'user');
  assert.equal(replyResult.item.messages.at(-1).content, 'Please proceed carefully.');
  assert.deepEqual(replyResult.item.messages.at(-1).attachments, []);
  const replyRequest = activationRequests.at(-1);
  assert.equal(replyRequest.queuePriority, true);
  assert.equal(replyRequest.fromAgent, true);
  assert.match(replyRequest.text, new RegExp(`<bot-pendency-update id="${protectedPendency.id}"`));
  assert.match(replyRequest.text, /<title>Protected work<\/title>/);
  assert.match(replyRequest.text, /Please proceed carefully\./);

  failNextReplySends = 1;
  const failedReply = await botManager.replyToPendency(created.bot.id, protectedPendency.id, {
    content: 'This delivery must fail.',
  });
  assert.equal(failedReply.delivered, false);
  assert.equal(failedReply.error, 'Delivery failed');
  assert.ok(failedReply.item, 'a failed delivery must still return the persisted pendency');
  let persistedInbox = JSON.parse(await readFile(inboxPath, 'utf8'));
  let persistedPendency = persistedInbox.find((item) => item.id === protectedPendency.id);
  assert.equal(persistedPendency.messages.at(-1).role, 'user');
  assert.equal(persistedPendency.messages.at(-1).content, 'This delivery must fail.');

  const concurrentReplies = await Promise.all(['a', 'b', 'c'].map((suffix) => (
    botManager.replyToPendency(created.bot.id, protectedPendency.id, { content: `Concurrent ${suffix}.` })
  )));
  for (const result of concurrentReplies) {
    assert.equal(result.delivered, true);
  }
  persistedInbox = JSON.parse(await readFile(inboxPath, 'utf8'));
  persistedPendency = persistedInbox.find((item) => item.id === protectedPendency.id);
  assert.deepEqual(
    persistedPendency.messages.slice(-3).map((message) => message.content).sort(),
    ['Concurrent a.', 'Concurrent b.', 'Concurrent c.'],
    'concurrent replies must all be persisted exactly once',
  );
  assert.equal(
    new Set(persistedPendency.messages.map((message) => message.id)).size,
    persistedPendency.messages.length,
    'concurrent replies must not collide on message ids',
  );

  // Fresh approval: the earlier one was corrupted on purpose for the ownership check.
  await botManager.queueUserApproval(created.bot.conversationId, {
    title: 'Second protected action',
    context: 'Confirm the second protected action.',
    prompt: 'Continue the second protected action.',
  });
  persistedInbox = JSON.parse(await readFile(inboxPath, 'utf8'));
  const approvalPendency = persistedInbox.filter((item) => item.approval).at(-1);
  assert.ok(approvalPendency?.approval?.id);
  const approvalId = approvalPendency.approval.id;

  await assert.rejects(
    () => botManager.completePendency(created.bot.id, approvalPendency.id),
    /Resolve the pending approval/,
  );
  await assert.rejects(() => botManager.resolveApproval(approvalId, 'yes'), /explicit boolean/);
  await assert.rejects(() => botManager.resolveApproval(approvalId, 1), /explicit boolean/);
  await assert.rejects(() => botManager.resolveApproval(approvalId, null), /explicit boolean/);

  const resolved = await botManager.resolveApproval(approvalId, true);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.delivered, true);
  assert.equal(resolved.pendencyId, approvalPendency.id);
  assert.equal(botManager.approvals.has(approvalId), false);
  const resolveRequest = activationRequests.at(-1);
  assert.equal(resolveRequest.queuePriority, true);
  assert.match(
    resolveRequest.text,
    new RegExp(`<bot-approval-resolved pendency-id="${approvalPendency.id}" decision="approved">`),
  );
  assert.match(resolveRequest.text, /Continue the second protected action\./);
  persistedInbox = JSON.parse(await readFile(inboxPath, 'utf8'));
  persistedPendency = persistedInbox.find((item) => item.id === approvalPendency.id);
  assert.equal(persistedPendency.approval, null);
  assert.equal(persistedPendency.messages.at(-1).role, 'user');
  assert.match(persistedPendency.messages.at(-1).content, /approved this request/);

  const completedPendency = await botManager.completePendency(created.bot.id, approvalPendency.id);
  assert.equal(completedPendency.status, 'completed');
  assert.ok(completedPendency.completedAt);

  await botManager.queueUserApproval(created.bot.conversationId, {
    title: 'Denied action',
    context: 'Confirm the denied action.',
    prompt: 'Continue the denied action.',
  });
  persistedInbox = JSON.parse(await readFile(inboxPath, 'utf8'));
  const deniedPendency = persistedInbox.filter((item) => item.approval).at(-1);
  const denied = await botManager.resolveApproval(deniedPendency.approval.id, false);
  assert.equal(denied.delivered, true);
  assert.match(activationRequests.at(-1).text, /decision="denied"/);
  persistedInbox = JSON.parse(await readFile(inboxPath, 'utf8'));
  const deniedAfter = persistedInbox.find((item) => item.id === deniedPendency.id);
  assert.match(deniedAfter.messages.at(-1).content, /denied this request/);
  assert.equal(deniedAfter.status, 'open');

  await assert.rejects(
    () => botManager.completePendency(created.bot.id, 'missing-pendency'),
    /Pendency not found/,
  );

  // Attachment descriptors: bot tools persist full attachment objects.
  await writeFile(join(workspace, 'sample-attachment.txt'), 'attachment body\n', 'utf8');
  const contentOnlyPendency = await botRuntime.tools
    .find((item) => item.name === 'bot_pendency_create')
    .execute({ title: 'Content only', content: 'No attachments here.' });
  assert.deepEqual(contentOnlyPendency.messages[0].attachments, []);
  const attachmentPendency = await botRuntime.tools
    .find((item) => item.name === 'bot_pendency_create')
    .execute({
      title: 'With file',
      content: 'See attached.',
      attachmentPaths: [join(workspace, 'sample-attachment.txt')],
    });
  const storedAttachments = attachmentPendency.messages[0].attachments;
  assert.equal(storedAttachments.length, 1);
  assert.equal(storedAttachments[0].kind, 'text_inline');
  assert.equal(storedAttachments[0].name, 'sample-attachment.txt');
  assert.match(storedAttachments[0].text, /attachment body/);

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
