import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  const otherConversation = createConversation({ model: 'test/model', projectPath: resolvedProfile });
  const otherBot = createBot({
    conversationId: otherConversation.id,
    name: 'Other bot',
    iconSeed: 'other-bot',
    model: 'test/model',
  });

  const invalidModeBot = createBot({
    conversationId: createConversation({ model: 'test/model', projectPath: resolvedProfile }).id,
    name: 'Invalid mode bot',
    iconSeed: 'invalid-mode-bot',
    model: 'test/model',
    permissionMode: 'invalid',
    enabled: false,
  });
  assert.equal(invalidModeBot.permissionMode, 'approve_for_me', 'invalid creation values use the safe default');
  assert.equal(bot.permissionMode, 'approve_for_me', 'new bots retain the existing approval mode');
  assert.equal(updateBot(bot.id, { permissionMode: 'full_access' }).permissionMode, 'full_access');
  assert.equal(getBot(bot.id).permissionMode, 'full_access', 'permission mode survives a fresh read');
  assert.equal(updateBot(bot.id, { name: bot.name }).permissionMode, 'full_access', 'unrelated changes preserve permission mode');
  for (const permissionMode of ['invalid', 'ask_for_approval', null, 'approve_for_me']) {
    assert.equal(updateBot(bot.id, { permissionMode }).permissionMode, 'approve_for_me');
  }
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
  const timedBotSnooze = manager.setBotSnooze(bot.id, { durationMinutes: 60 });
  assert.equal(timedBotSnooze.active, true);
  assert.equal(timedBotSnooze.mode, 'until');
  assert.equal(getBot(bot.id).snoozeUntil, timedBotSnooze.until, 'timed bot Snooze is persisted');
  assert.equal(getBot(otherBot.id).snoozeUntil, null, 'bot Snooze is isolated to its target');
  assert.equal(
    new BotManager().getBotSnooze(bot.id).until,
    timedBotSnooze.until,
    'timed bot Snooze survives a new manager',
  );
  assert.equal(
    manager.describeBots().find((item) => item.id === bot.id)?.scheduleState,
    'sleep',
    'a snoozed bot is described as sleeping',
  );
  const cumulativeBotSnooze = manager.setBotSnooze(bot.id, { durationMinutes: 60 });
  assert.equal(
    new Date(cumulativeBotSnooze.until).getTime(),
    new Date(timedBotSnooze.until).getTime() + 3_600_000,
    'timed bot Snooze adds to its active deadline',
  );

  const botQueueIndexBeforeSnooze = getBot(bot.id).workQueueIndex;
  await manager.tick();
  assert.deepEqual(
    activationRequests.map((request) => request.conversationId),
    [otherBot.conversationId],
    'bot Snooze blocks only the target bot scheduled activation',
  );
  assert.equal(
    getBot(bot.id).workQueueIndex,
    botQueueIndexBeforeSnooze,
    'bot Snooze does not advance the target work queue',
  );
  assert.equal(await manager.activateBot(bot.id, { trigger: 'manual', force: true }), true);
  assert.equal(
    activationRequests.at(-1)?.conversationId,
    bot.conversationId,
    'manual activation remains available during bot Snooze',
  );
  assert.deepEqual(
    manager.setBotSnooze(bot.id, { reset: true }),
    { active: false, mode: null, until: null },
    'Reset clears only the target bot Snooze',
  );
  assert.equal(getBot(otherBot.id).snoozeUntil, null);
  assert.deepEqual(
    manager.setBotSnooze(bot.id, { untilRestart: true }),
    { active: true, mode: 'until-restart', until: null },
  );
  assert.equal(getBot(bot.id).snoozeUntil, null, 'restart bot Snooze is not persisted');
  assert.equal(
    new BotManager().getBotSnooze(bot.id).active,
    false,
    'restart bot Snooze ends with the manager process',
  );
  manager.setBotSnooze(bot.id, { reset: true });
  assert.throws(
    () => manager.setBotSnooze(bot.id, { durationMinutes: 30 }),
    /must be 60, 360, or 1440 minutes/,
  );

  activationRequests.length = 0;
  updateBotScheduler(bot.id, { workQueueIndex: 1 });
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

  assert.equal(await manager.activateBot(bot.id, { trigger: 'manual', force: true }), true);
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

  database.closeDatabase();
  const legacy = new DatabaseSync(join(resolvedProfile, '.aivax', 'aivax.sqlite'));
  legacy.prepare('UPDATE bots SET permission_mode = ? WHERE id = ?').run('invalid', bot.id);
  legacy.close();
  database = await import('../src/main/database.js?permission-normalization');
  assert.equal(database.getBot(bot.id).permissionMode, 'approve_for_me', 'invalid stored modes use the safe default');
  database.closeDatabase();
  const legacySchema = new DatabaseSync(join(resolvedProfile, '.aivax', 'aivax.sqlite'));
  legacySchema.exec('ALTER TABLE bots DROP COLUMN permission_mode');
  legacySchema.close();
  database = await import('../src/main/database.js?permission-migration');
  assert.equal(database.getBot(bot.id).permissionMode, 'approve_for_me', 'existing bots migrate to the safe default');
  assert.equal(database.getBot(bot.id).name, bot.name, 'migration preserves existing configuration');
  database.updateBot(bot.id, { permissionMode: 'full_access' });
  database.closeDatabase();
  database = await import('../src/main/database.js?permission-reopen');
  assert.equal(database.getBot(bot.id).permissionMode, 'full_access', 'reopening preserves an explicit permission choice');

  console.log('Bot enabled, Snooze, and permission migration database tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
