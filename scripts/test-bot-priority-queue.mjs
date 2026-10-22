import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(tmpdir(), '.avi', 'visualizations', `${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}-UTC`, 'bot-priority-queue');
mkdirSync(root, { recursive: true });
process.env.USERPROFILE = mkdtempSync(join(root, 'profile-'));
const database = await import('../src/main/database.js');
const { BotManager } = await import('../src/main/bot-manager.js');
const { decideActivation } = await import('../src/main/bot-scheduling.js');

try {
  const requests = [];
  const manager = new BotManager();
  const chatRunner = {
    runs: new Map(),
    async send(request) {
      requests.push(request);
      this.runs.set(request.conversationId, {});
      return { message: { id: `message-${requests.length}` } };
    },
    stop() {},
  };
  manager.attachChatRunner(chatRunner);
  database.setBotSettings({ maxConcurrentBots: 4, activationWindow: null });
  const bot = await manager.createBotFromConfig({
    name: 'Queue bot',
    model: 'test:model',
    workQueue: ['Sync A', 'Sync B'],
    workingFolder: join(process.env.USERPROFILE, 'work'),
  });
  const finishRun = (messageId = 'run') => {
    chatRunner.runs.delete(bot.conversationId);
    database.updateBotScheduler(bot.id, { activeAssistantMessageId: messageId });
    manager.noteRunFinished(bot.conversationId, messageId);
  };
  const makeDue = () => database.updateBotScheduler(bot.id, {
    nextActivationAt: new Date(Date.now() - 1_000).toISOString(),
    lastActivationAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  const enqueue = (sourceKey, text) => manager.enqueuePriorityWork(database.getBot(bot.id), {
    sourceKey,
    kind: 'inbox',
    title: sourceKey,
    text,
  });

  // Flowchart: no priority items -> next Work queue item.
  makeDue();
  await manager.tick();
  assert.equal(requests.length, 1);
  assert.match(requests[0].text, /kind="work"[\s\S]*<focus-task>Sync A<\/focus-task>/);
  finishRun();
  await manager.drainActivationQueue();
  assert.equal(requests.length, 1, 'nothing is chained without priority items');

  // Priority after a Work activation -> next priority item; merges by source.
  const first = enqueue('pendency:one', 'first reply');
  assert.equal(enqueue('pendency:one', 'second reply').id, first.id);
  enqueue('pendency:two', 'other reply');
  assert.equal(manager.describePriorityQueue(bot.id)[0].messageCount, 2);
  manager.continueAfterRun.clear();
  makeDue();
  await manager.tick();
  assert.equal(requests.length, 2);
  assert.match(requests[1].text, /kind="priority"[\s\S]*first reply[\s\S]*second reply/);
  assert.doesNotMatch(requests[1].text, /<focus-task>/);
  assert.equal(database.getBot(bot.id).workQueueIndex, 1, 'priority activation keeps the Work queue cursor');

  // A message from the source being processed creates a new item instead of joining the running one.
  const reopened = enqueue('pendency:one', 'late reply');
  assert.notEqual(reopened.id, first.id);

  // Auto-continue disabled: finishing does not chain; the scheduled tick alternates to Work.
  await manager.updateBotConfig(bot.id, { priorityAutoContinue: false });
  finishRun();
  await manager.drainActivationQueue();
  assert.equal(requests.length, 2, 'disabled auto-continuation waits for scheduled activations');
  makeDue();
  await manager.tick();
  assert.match(requests[2].text, /kind="work"[\s\S]*<focus-task>Sync B<\/focus-task>/, 'after priority, the Work queue runs');
  finishRun();

  // Auto-continue enabled: every finished run consumes the next priority item until empty.
  await manager.updateBotConfig(bot.id, { priorityAutoContinue: true });
  makeDue();
  await manager.tick();
  assert.match(requests[3].text, /kind="priority"[\s\S]*other reply/);
  finishRun();
  await manager.drainActivationQueue();
  assert.equal(requests.length, 5);
  assert.match(requests[4].text, /kind="priority"[\s\S]*late reply/);
  finishRun();
  await manager.drainActivationQueue();
  assert.equal(requests.length, 5, 'chaining stops when the priority queue is empty');
  assert.equal(manager.describePriorityQueue(bot.id).length, 0);

  // A run stopped by the user does not chain.
  enqueue('thread:x', 'prompt');
  database.insertMessage({ id: 'stopped-run', conversationId: bot.conversationId, role: 'assistant', status: 'aborted', stoppedByUser: true });
  finishRun('stopped-run');
  await manager.drainActivationQueue();
  assert.equal(requests.length, 5, 'stopped runs do not consume the priority queue');
  assert.equal(manager.continueAfterRun.has(bot.id), false);

  // Idle and pause only block the Work queue.
  database.updateBotScheduler(bot.id, { idleUntil: new Date(Date.now() + 3_600_000).toISOString() });
  makeDue();
  await manager.tick();
  assert.equal(requests.length, 6, 'priority work wakes an idle bot');
  assert.match(requests[5].text, /kind="priority"/);
  assert.ok(database.getBot(bot.id).idleUntil, 'priority work keeps the Work queue idle');
  finishRun();
  makeDue();
  await manager.tick();
  assert.equal(requests.length, 6, 'an idle bot without priority work stays asleep');
  database.updateBotScheduler(bot.id, { idleUntil: 'clear' });
  await manager.updateBotConfig(bot.id, { status: 'paused' });
  enqueue('thread:y', 'paused prompt');
  makeDue();
  await manager.tick();
  assert.equal(requests.length, 7, 'priority work activates a paused bot');
  assert.equal(database.getBot(bot.id).status, 'paused');
  finishRun();
  makeDue();
  await manager.tick();
  assert.equal(requests.length, 7, 'a paused bot does not run its Work queue');
  assert.equal(decideActivation({ bot: database.getBot(bot.id), hasPriorityWork: true }).action, 'activate');
  assert.equal(decideActivation({ bot: { ...database.getBot(bot.id), enabled: false }, hasPriorityWork: true }).reason, 'disabled');
  await manager.updateBotConfig(bot.id, { status: 'active' });

  // Explicit activation runs right after the current run and before priority items.
  enqueue('thread:z', 'queued prompt');
  chatRunner.runs.set(bot.conversationId, {});
  assert.deepEqual(await manager.activateBot(bot.id, { trigger: 'manual', force: true, workQueueId: 0 }), { queued: true, reason: 'working' });
  assert.equal(manager.describePriorityQueue(bot.id)[0].kind, 'activation');
  finishRun();
  await manager.drainActivationQueue();
  assert.match(requests[7].text, /kind="work"[\s\S]*<focus-task>Sync A<\/focus-task>/);
  finishRun();
  await manager.drainActivationQueue();
  assert.match(requests[8].text, /queued prompt/, 'priority continues after the explicit activation');
  finishRun();

  // Anti-concurrency: one claim wins, removal and reorder skip claimed items.
  const contested = enqueue('pendency:race', 'race');
  const claims = ['a', 'b', 'c'].map((claimId) => database.claimBotPriorityItem(contested.id, claimId));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.throws(() => database.removeBotPriorityItem(bot.id, contested.id), /already running/);
  enqueue('pendency:race', 'arrived while claimed');
  database.releaseBotPriorityItem(contested.id);
  const merged = manager.describePriorityQueue(bot.id);
  assert.equal(merged.length, 1, 'released claims merge with new messages from the same source');
  assert.equal(database.getBotPriorityItem(merged[0].id).entries.map((entry) => entry.text).join(','), 'race,arrived while claimed');
  database.claimBotPriorityItem(merged[0].id, 'stale');
  database.releaseStaleBotPriorityClaims();
  assert.equal(manager.describePriorityQueue(bot.id)[0].claimed, false, 'startup releases interrupted claims');

  // Duplicate source messages (mentions) are delivered once.
  assert.ok(manager.enqueueThreadMessage(bot.conversationId, { sourceConversationId: 's', kind: 'mention', title: 'm', text: 'x', sourceMessageId: 'msg-1' }));
  assert.equal(manager.enqueueThreadMessage(bot.conversationId, { sourceConversationId: 's', kind: 'mention', title: 'm', text: 'x', sourceMessageId: 'msg-1' }), null);

  await manager.fullResetBot(bot.id);
  assert.equal(manager.describePriorityQueue(bot.id).length, 0, 'full reset clears the priority queue');

  manager.stop();
  console.log('Bot priority queue tests passed.');
} finally {
  database.closeDatabase();
}
process.exit(0);
