import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = join(tmpdir(), '.avi', 'visualizations', `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`, 'bot-admission');
mkdirSync(root, { recursive: true });
process.env.USERPROFILE = mkdtempSync(join(root, 'profile-'));
const database = await import('../src/main/database.js');
const { BotManager } = await import('../src/main/bot-manager.js');
try {
  const manager = new BotManager();
  const requests = [];
  const resumed = [];
  manager.attachChatRunner({
    runs: new Map(),
    async send(request) {
      requests.push(request);
      this.runs.set(request.conversationId, {});
      return { message: { id: `message-${requests.length}` } };
    },
    async retry(request) {
      resumed.push(request);
      this.runs.set(request.conversationId, {});
      return { message: { id: request.assistantMessageId } };
    },
  });
  const bots = [];
  for (let index = 0; index < 3; index += 1) {
    bots.push(await manager.createBotFromConfig({ name: `Bot ${index}`, model: 'test:model', workQueue: ['Work'], workingFolder: join(process.env.USERPROFILE, 'work') }));
  }
  const outside = { days: [(new Date().getDay() + 1) % 7], startMinute: null, endMinute: null };
  database.setBotSettings({ maxConcurrentBots: 1, activationWindow: outside });
  await manager.activateBot(bots[0].id, { force: true, trigger: 'manual' });
  assert.equal(requests.length, 0);
  assert.equal(database.getMessages(bots[0].conversationId).length, 0);
  assert.equal(manager.describeBots()[0].scheduleState, 'outside-window');
  assert.equal(manager.describeBots()[0].running, false);
  assert.equal(database.getBot(bots[0].id).activationCount, 0);
  database.setBotSettings({ activationWindow: null });
  await manager.drainActivationQueue();
  assert.equal(requests.length, 1);
  await manager.activateBot(bots[1].id, { force: true });
  await manager.activateBot(bots[2].id, { force: true });
  await manager.activateBot(bots[1].id, { force: true });
  assert.equal(manager.activationQueue.size, 2);
  assert.equal(manager.describeBots()[1].scheduleState, 'queued');
  assert.equal(manager.describeBots()[1].running, false);
  assert.equal(database.getMessages(bots[1].conversationId).length, 0);
  database.setBotSettings({ activationWindow: outside });
  assert.equal(manager.describeBots()[0].scheduleState, 'working');
  manager.chatRunner.runs.delete(bots[0].conversationId);
  await manager.drainActivationQueue();
  assert.equal(requests.length, 1);
  database.setBotSettings({ activationWindow: null });
  await manager.drainActivationQueue();
  assert.equal(requests[1].conversationId, bots[1].conversationId);
  manager.chatRunner.runs.delete(bots[1].conversationId);
  await manager.drainActivationQueue();
  assert.equal(requests[2].conversationId, bots[2].conversationId);
  database.setBotSettings({ activationWindow: outside });
  database.updateBotScheduler(bots[0].id, { activeAssistantMessageId: 'existing-response' });
  await manager.tick();
  assert.equal(resumed[0].conversationId, bots[0].conversationId);
  assert.equal(requests.length, 3);
  assert.equal(database.getBot(bots[0].id).activationCount, 1);
  assert.throws(() => database.setBotSettings({ maxConcurrentBots: 0 }));
  assert.throws(() => database.setBotSettings({ activationWindow: { days: [8] } }));
  assert.throws(() => database.setBotSettings({ activationWindow: { days: [], startMinute: 600, endMinute: 600 } }));
  assert.equal(database.getBotSettings().maxConcurrentBots, 1);
  assert.equal(database.getBotSettings().executionMode, 'orchestrator');
  database.updateBot(bots[1].id, { executionMode: 'direct' });
  assert.equal(manager.describeBots().find((bot) => bot.id === bots[1].id).effectiveExecutionMode, 'direct');
  database.updateBot(bots[1].id, { executionMode: null });
  assert.equal(manager.describeBots().find((bot) => bot.id === bots[1].id).effectiveExecutionMode, 'orchestrator');
  await manager.activateBot(bots[1].id, { force: true });
  assert.equal(manager.activationQueue.has(bots[1].id), true);
  await manager.updateBotConfig(bots[1].id, { enabled: false });
  assert.equal(manager.activationQueue.has(bots[1].id), false);
  assert.equal(database.getBotUsageMessages(7).length, 0);
  assert.ok(database.getBotUsageConversations().some((item) => item.id === bots[0].conversationId));

  database.setBotSettings({ activationWindow: null, maxConcurrentBots: 3 });
  for (const bot of bots) {
    manager.chatRunner.runs.delete(database.getBot(bot.id).conversationId);
    database.updateBotScheduler(bot.id, { activeAssistantMessageId: null });
  }
  manager.activationQueue.clear();

  const worker = database.createConversation({
    model: 'test:model',
    parentConversationId: bots[2].conversationId,
    createdBy: 'agent',
  });
  const nestedWorker = database.createConversation({
    model: 'test:model',
    parentConversationId: worker.id,
    createdBy: 'agent',
  });
  manager.chatRunner.runs.set(nestedWorker.id, {});
  const requestsBeforeBusy = requests.length;
  assert.equal(await manager.activateBot(bots[2].id, { force: true }), null);
  assert.equal(requests.length, requestsBeforeBusy);
  assert.equal(manager.describeBots()[2].scheduleState, 'working');
  manager.chatRunner.runs.delete(nestedWorker.id);
  manager.chatRunner.semaphores = {
    waitSnapshot: (conversationId) => (conversationId === bots[2].conversationId ? { position: 1 } : null),
  };
  assert.equal(await manager.activateBot(bots[2].id, { force: true }), null);
  assert.equal(requests.length, requestsBeforeBusy);
  delete manager.chatRunner.semaphores;

  const lostThreadId = database.getBot(bots[1].id).conversationId;
  assert.throws(() => database.deleteConversation(lostThreadId), /belongs to a bot/);
  const sqlite = new DatabaseSync(join(process.env.USERPROFILE, '.aivax', 'aivax.sqlite'));
  sqlite.prepare('UPDATE conversations SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), lostThreadId);
  sqlite.close();
  assert.equal(database.getConversation(lostThreadId), null);
  database.updateBotScheduler(bots[1].id, { activeAssistantMessageId: 'lost-response' });
  assert.equal(await manager.resumeInterruptedRun(database.getBot(bots[1].id)), false);
  const recreated = database.getBot(bots[1].id);
  assert.notEqual(recreated.conversationId, lostThreadId);
  assert.equal(recreated.activeAssistantMessageId, null);
  const recreatedThread = database.getConversation(recreated.conversationId);
  assert.equal(recreatedThread.conversationType, 'bot');
  assert.equal(recreatedThread.isBot, true);
  assert.equal(database.getBotByConversation(recreatedThread.id).id, bots[1].id);
  const repliesBefore = requests.length;
  await manager.replyToPendency(bots[1].id, 'missing-pendency').catch(() => {});
  assert.equal(database.getBot(bots[1].id).conversationId, recreated.conversationId);
  assert.equal(requests.length, repliesBefore);

  const pendencyRequests = requests.length;
  const activationBot = await manager.createBotFromConfig({
    name: 'Activation context',
    model: 'test:model',
    workQueue: ['Work'],
    workingFolder: join(process.env.USERPROFILE, 'work'),
  });
  const previousTurn = database.insertMessage({
    conversationId: activationBot.conversationId,
    role: 'user',
    content: 'previous activation',
    status: 'completed',
  });
  database.insertMessage({
    conversationId: activationBot.conversationId,
    role: 'assistant',
    content: 'previous answer',
    status: 'completed',
  });
  await manager.activateBot(activationBot.id, { force: true });
  assert.equal(requests.length, pendencyRequests + 1);
  assert.equal(requests.at(-1).conversationId, activationBot.conversationId);
  const modelMessages = database.toModelMessages(activationBot.conversationId);
  assert.equal(modelMessages.some((message) => JSON.stringify(message).includes(previousTurn.content)), false);

  manager.stop();
  console.log('Bot activation admission: passed (window, FIFO, no phantom messages, ongoing/resumed work, busy workers, thread recreation, activation context reset, validation).');
} finally {
  database.closeDatabase();
}
process.exit(0);
