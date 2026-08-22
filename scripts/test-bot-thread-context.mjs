import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-bot-thread-context-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { BotManager } = await import('../src/main/bot-manager.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const { createBot, createConversation } = database;
  const contextFolder = join(resolvedProfile, 'bot-context');
  const workingFolder = join(resolvedProfile, 'bot-work');
  const otherFolder = join(resolvedProfile, 'other');
  const model = 'test/model';
  const botConversation = createConversation({
    title: 'Bot',
    model,
    projectPath: contextFolder,
    conversationType: 'bot',
  });
  createBot({
    conversationId: botConversation.id,
    name: 'Thread context bot',
    iconSeed: 'thread-context-bot',
    workingFolder,
    model,
  });
  const contextSubagent = createConversation({
    title: 'Context subagent',
    model,
    projectPath: contextFolder,
    conversationType: 'subagent',
    parentConversationId: botConversation.id,
  });
  const sharedSubagent = createConversation({
    title: 'Shared subagent',
    model,
    projectPath: workingFolder,
    conversationType: 'subagent',
    parentConversationId: botConversation.id,
  });
  const workingThread = createConversation({
    title: 'Working-folder thread',
    model,
    projectPath: workingFolder,
  });
  createConversation({
    title: 'Working-folder side chat',
    model,
    projectPath: workingFolder,
    conversationType: 'side',
    parentConversationId: workingThread.id,
  });
  createConversation({ title: 'Unrelated thread', model, projectPath: otherFolder });

  const chatRunner = {
    runs: new Map(),
    semaphores: {
      holdings: () => [],
      waitSnapshot: () => null,
    },
  };
  const contextTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_list_thread_context');
  const botRuntime = new BotManager().getBotRuntimeContext(botConversation.id);
  const botResult = await contextTool.execute({}, {
    chatRunner,
    conversationId: botConversation.id,
    botRuntime,
  });

  assert.deepEqual(
    new Set(botResult.threads.map(({ id }) => id)),
    new Set([contextSubagent.id, sharedSubagent.id, workingThread.id]),
    'bots see their standard context plus non-side-chat threads in their working folder',
  );
  assert.equal(
    botResult.threads.filter(({ id }) => id === sharedSubagent.id).length,
    1,
    'threads present in both sources are deduplicated',
  );
  assert.equal(
    botResult.threads.some(({ id }) => id === botConversation.id),
    false,
    'the current bot thread remains represented only by currentThread',
  );

  const normalConversation = createConversation({
    title: 'Normal thread',
    model,
    projectPath: workingFolder,
  });
  const normalSubagent = createConversation({
    title: 'Normal subagent',
    model,
    projectPath: otherFolder,
    conversationType: 'subagent',
    parentConversationId: normalConversation.id,
  });
  const normalResult = await contextTool.execute({}, {
    chatRunner,
    conversationId: normalConversation.id,
    botRuntime,
  });
  assert.deepEqual(
    normalResult.threads.map(({ id }) => id),
    [normalSubagent.id],
    'normal threads keep the standard orchestration-context visibility',
  );

  console.log('Bot thread context tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
