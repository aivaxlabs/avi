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
  const { BotManager } = await import('../src/main/bot-manager.js');
  const {
    createBot,
    createConversation,
    getBot,
    getBotSchedulerSnoozeUntil,
    setBotSchedulerSnoozeUntil,
    updateBot,
    updateBotScheduler,
  } = database;
  const conversation = createConversation({ model: 'test/model', projectPath: resolvedProfile });
  const bot = createBot({
    conversationId: conversation.id,
    name: 'Enabled bot',
    iconSeed: 'enabled-bot',
    model: 'test/model',
  });

  assert.equal(bot.enabled, true, 'new bots are enabled by default');
  assert.deepEqual(bot.workQueue, [], 'new bots have an empty work queue by default');
  const configured = updateBot(bot.id, {
    workQueue: ['  Review releases  ', '', 'Triage failures'],
  });
  assert.deepEqual(configured.workQueue, ['Review releases', 'Triage failures']);
  assert.equal(configured.workQueueIndex, 0, 'editing the work queue restarts the round-robin cycle');
  assert.deepEqual(getBot(bot.id).workQueue, ['Review releases', 'Triage failures']);
  updateBotScheduler(bot.id, { workQueueIndex: 1 });
  assert.equal(
    updateBot(bot.id, { workQueue: ['Review releases', 'Triage failures'] }).workQueueIndex,
    1,
    'saving an unchanged work queue preserves the next task',
  );
  assert.equal(updateBot(bot.id, { enabled: false }).enabled, false, 'disabled state is persisted');
  assert.equal(getBot(bot.id).enabled, false, 'disabled state survives a fresh read');
  assert.equal(updateBot(bot.id, { enabled: true }).enabled, true, 'bots can be enabled again');

  const activationRequests = [];
  const manager = new BotManager();
  manager.attachChatRunner({
    runs: new Map(),
    send: async (request) => {
      activationRequests.push(request);
      return { message: { id: `message-${activationRequests.length}` } };
    },
  });
  const timedSnooze = manager.setSchedulerSnooze({ durationMinutes: 60 });
  assert.equal(timedSnooze.active, true);
  assert.equal(timedSnooze.mode, 'until');
  assert.equal(getBotSchedulerSnoozeUntil(), timedSnooze.until, 'timed Snooze is persisted');
  assert.equal(new BotManager().getSchedulerSnooze().until, timedSnooze.until, 'timed Snooze survives a new manager');
  const cumulativeSnooze = manager.setSchedulerSnooze({ durationMinutes: 60 });
  assert.equal(
    new Date(cumulativeSnooze.until).getTime(),
    new Date(timedSnooze.until).getTime() + 3_600_000,
    'timed Snooze adds to the active deadline',
  );

  const queueIndexBeforeSnooze = getBot(bot.id).workQueueIndex;
  await manager.tick();
  assert.equal(activationRequests.length, 0, 'Snooze blocks scheduled activations');
  assert.equal(getBot(bot.id).workQueueIndex, queueIndexBeforeSnooze, 'Snooze does not advance the work queue');

  assert.equal(await manager.activateBot(bot.id, { trigger: 'manual' }), true);
  assert.equal(activationRequests.length, 1, 'manual activation remains available during Snooze');
  assert.equal(getBot(bot.id).workQueueIndex, 0, 'manual activation keeps the existing queue order');

  const resetTimedSnooze = manager.setSchedulerSnooze({ reset: true });
  assert.deepEqual(resetTimedSnooze, { active: false, mode: null, until: null });
  assert.equal(getBotSchedulerSnoozeUntil(), null, 'Reset clears a timed Snooze deadline');

  const restartSnooze = manager.setSchedulerSnooze({ untilRestart: true });
  assert.deepEqual(restartSnooze, { active: true, mode: 'until-restart', until: null });
  assert.equal(getBotSchedulerSnoozeUntil(), null, 'restart Snooze is not persisted');
  assert.equal(new BotManager().getSchedulerSnooze().active, false, 'restart Snooze ends with the manager process');
  assert.deepEqual(
    manager.setSchedulerSnooze({ reset: true }),
    { active: false, mode: null, until: null },
    'Reset clears a restart Snooze',
  );
  assert.throws(
    () => manager.setSchedulerSnooze({ durationMinutes: 30 }),
    /must be 60, 360, or 1440 minutes/,
  );
  setBotSchedulerSnoozeUntil(null);

  console.log('Bot enabled and Snooze database tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
