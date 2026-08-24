import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-semaphore-test-'));
assert.ok(resolve(testProfile).startsWith(resolve(tmpdir())));
process.env.USERPROFILE = testProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { SemaphoreManager } = await import('../src/main/semaphore-manager.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const { createPluginDomainApi } = await import('../src/main/plugin-domain-api.js');
  const { PluginRuntime } = await import('../src/main/plugin-runtime.js');
  const { resolveDynamicContext } = await import('../src/main/context-injection.js');
  const {
    closeDatabase,
    createConversation,
    replaceTasks,
    setSemaphoreState,
  } = database;

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for semaphore state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  setSemaphoreState({ semaphores: {}, waiting: {} });
  const conversations = Array.from({ length: 5 }, (_, index) => createConversation({
    title: `Semaphore ${index + 1}`,
    model: 'test:model',
    projectPath: index === 1 ? join(process.cwd(), 'another-project') : process.cwd(),
  }));
  const ready = [];
  const snapshots = [];
  let manager = new SemaphoreManager({
    onChanged: (waits) => snapshots.push(waits),
    onReady: (waiter) => ready.push(waiter),
  });

  assert.deepEqual(manager.acquire({
    conversationId: conversations[0].id,
    name: 'implementation',
    count: 1,
    maxCount: 1,
  }), {
    acquired: true,
    name: 'implementation',
    count: 1,
    maxCount: 1,
  });
  assert.equal(manager.holdings(conversations[0].id)[0].count, 1);
  assert.throws(() => manager.acquire({
    conversationId: conversations[0].id,
    name: 'implementation',
    count: 1,
    maxCount: 1,
  }), /cannot wait behind itself/);

  const secondWait = manager.acquire({
    conversationId: conversations[1].id,
    name: 'implementation',
    count: 1,
    maxCount: 1,
  });
  const thirdWait = manager.acquire({
    conversationId: conversations[2].id,
    name: 'implementation',
    count: 1,
    maxCount: 1,
  });
  assert.equal(secondWait.position, 1);
  assert.equal(thirdWait.position, 2);
  assert.throws(() => manager.acquire({
    conversationId: conversations[2].id,
    name: 'another',
    count: 1,
    maxCount: 1,
  }), /already waiting/);
  assert.throws(() => manager.acquire({
    conversationId: conversations[3].id,
    name: 'implementation',
    count: 1,
    maxCount: 2,
  }), /already has maxCount 1/);

  assert.deepEqual(manager.release({
    conversationId: conversations[0].id,
    name: 'implementation',
    count: 1,
  }), {
    name: 'implementation',
    released: 1,
    remaining: 0,
    activated: 1,
  });
  assert.equal(ready.at(-1).conversationId, conversations[1].id);
  assert.equal(manager.waitSnapshot(conversations[2].id).position, 1);
  assert.equal(manager.holdings(conversations[1].id)[0].count, 1);

  const restored = new SemaphoreManager();
  assert.equal(restored.waitSnapshot(conversations[2].id).position, 1);
  assert.equal(restored.holdings(conversations[1].id)[0].count, 1);
  manager = restored;

  manager.release({
    conversationId: conversations[1].id,
    name: 'implementation',
    count: 1,
  });
  assert.equal(manager.holdings(conversations[2].id)[0].count, 1);

  manager.removeConversations([conversations[2].id]);
  assert.deepEqual(manager.holdings(conversations[2].id), []);

  manager.acquire({
    conversationId: conversations[3].id,
    name: 'auto',
    count: 1,
    maxCount: 1,
  });
  manager.acquire({
    conversationId: conversations[4].id,
    name: 'auto',
    count: 1,
    maxCount: 1,
  });
  const autoSnapshot = manager.globalSnapshot().find((entry) => entry.name === 'auto');
  assert.deepEqual(autoSnapshot.holders, [{ conversationId: conversations[3].id, count: 1 }]);
  assert.deepEqual(autoSnapshot.queue, [{ conversationId: conversations[4].id, position: 1 }]);
  assert.deepEqual(manager.releaseAll(conversations[3].id), [{
    name: 'auto',
    count: 1,
    maxCount: 1,
  }]);
  assert.equal(manager.waitSnapshot(conversations[4].id), null);
  assert.equal(manager.holdings(conversations[4].id)[0].count, 1);
  assert.deepEqual(manager.releaseAll(conversations[3].id), []);
  manager.release({
    conversationId: conversations[4].id,
    name: 'auto',
    count: 1,
  });

  manager.acquire({
    conversationId: conversations[0].id,
    name: 'capacity',
    count: 2,
    maxCount: 3,
  });
  manager.acquire({
    conversationId: conversations[1].id,
    name: 'capacity',
    count: 2,
    maxCount: 3,
  });
  manager.acquire({
    conversationId: conversations[2].id,
    name: 'capacity',
    count: 1,
    maxCount: 3,
  });
  assert.equal(manager.waitSnapshot(conversations[1].id).position, 1);
  assert.equal(manager.waitSnapshot(conversations[2].id).position, 2);
  assert.deepEqual(manager.holdings(conversations[2].id), []);

  const forced = manager.runNow(conversations[1].id);
  assert.equal(forced.conversationId, conversations[1].id);
  assert.equal(manager.waitSnapshot(conversations[1].id), null);
  assert.equal(manager.holdings(conversations[2].id)[0].count, 1);

  manager.acquire({
    conversationId: conversations[3].id,
    name: 'capacity',
    count: 1,
    maxCount: 3,
  });
  assert.equal(manager.cancel(conversations[3].id), true);
  assert.equal(manager.waitSnapshot(conversations[3].id), null);
  assert.equal(manager.cancel(conversations[3].id), false);
  assert.ok(snapshots.length > 0);

  const resetResult = manager.reset('capacity');
  assert.deepEqual(resetResult, {
    name: 'capacity',
    maxCount: 3,
    released: [
      { conversationId: conversations[0].id, count: 2 },
      { conversationId: conversations[2].id, count: 1 },
    ],
    activated: 0,
  });
  assert.equal(manager.globalSnapshot().find((entry) => entry.name === 'capacity'), undefined);
  assert.deepEqual(manager.holdings(conversations[0].id), []);
  assert.throws(() => manager.reset('capacity'), /does not exist/);
  assert.throws(() => manager.reset('  '), /name is required/);

  manager = new SemaphoreManager({ onReady: (waiter) => ready.push(waiter) });
  manager.acquire({
    conversationId: conversations[0].id,
    name: 'reset-wait',
    count: 1,
    maxCount: 1,
  });
  manager.acquire({
    conversationId: conversations[1].id,
    name: 'reset-wait',
    count: 1,
    maxCount: 1,
  });
  const readyCount = ready.length;
  const resetWait = manager.reset('reset-wait');
  assert.deepEqual(resetWait.released, [{ conversationId: conversations[0].id, count: 1 }]);
  assert.equal(resetWait.activated, 1);
  assert.equal(ready.length, readyCount + 1);
  assert.equal(ready.at(-1).conversationId, conversations[1].id);
  assert.equal(manager.holdings(conversations[1].id)[0].count, 1);
  manager.release({
    conversationId: conversations[1].id,
    name: 'reset-wait',
    count: 1,
  });

  const sleepTool = CLIENT_TOOLS.find((tool) => tool.name === 'sleep_semaphore');
  const releaseTool = CLIENT_TOOLS.find((tool) => tool.name === 'release_semaphore');
  const listTool = CLIENT_TOOLS.find((tool) => tool.name === 'list_semaphores');
  assert.ok(sleepTool);
  assert.ok(releaseTool);
  assert.ok(listTool);
  assert.deepEqual(sleepTool.inputSchema.required, ['name', 'count', 'maxCount']);
  assert.deepEqual(releaseTool.inputSchema.required, ['name', 'count']);
  assert.equal(sleepTool.approval, 'never');
  assert.equal(releaseTool.approval, 'never');
  const lockContext = await resolveDynamicContext({
    semaphoreHoldings: [{ name: 'implementation', count: 1, maxCount: 1 }],
  });
  assert.match(lockContext, /<semaphore_locks>/);
  assert.match(lockContext, /name="implementation" count="1" max_count="1"/);
  assert.match(lockContext, /call release_semaphore/);

  const runnerSource = readFileSync(
    new URL('../src/main/chat-runner.js', import.meta.url),
    'utf8',
  );
  const runtimeSource = readFileSync(
    new URL('../src/main/runtime.js', import.meta.url),
    'utf8',
  );
  const appSource = readFileSync(
    new URL('../src/renderer/App.jsx', import.meta.url),
    'utf8',
  );
  const chatViewSource = readFileSync(
    new URL('../src/renderer/components/ChatView.jsx', import.meta.url),
    'utf8',
  );
  const sidebarSource = readFileSync(
    new URL('../src/renderer/components/Sidebar.jsx', import.meta.url),
    'utf8',
  );
  assert.match(runnerSource, /tool\.name === 'sleep_semaphore' && value\.suspendRun === true/);
  assert.match(runnerSource, /if \(run\.suspendAfterTools\)/);
  assert.match(runnerSource, /fromAgent: true/);
  assert.match(runnerSource, /release_semaphore\(name:/);
  assert.match(runtimeSource, /applicationIpc\.handle\('semaphores:state', semaphoreState\)/);
  assert.match(runtimeSource, /applicationIpc\.handle\('semaphores:reset'/);
  assert.match(runtimeSource, /userInitiated: true/);
  assert.match(appSource, /api\.chat\.runSemaphoreNow\(conversationId\)/);
  assert.match(appSource, /api\.chat\.cancelSemaphore\(conversationId\)/);
  assert.match(chatViewSource, /Agent sleeping/);
  assert.match(chatViewSource, /Queue position/);
  assert.match(chatViewSource, />\s*Run now\s*</);
  assert.match(chatViewSource, />\s*Cancel semaphore\s*</);
  assert.match(sidebarSource, /label: 'Waiting for semaphore'/);

  setSemaphoreState({ semaphores: {}, waiting: {} });
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const runnerEvents = [];
  const providerRequests = [];
  let ignoredTaskConversationId = null;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerId: 'test',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    capabilities: {},
    context: { input: 100_000, output: 10_000 },
  };
  const provider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      providerRequests.push(request);
      if (providerRequests.length === 1) {
        return {
          assistantContent: '',
          continuation: [],
          toolCalls: [{
            callId: 'sleep-call',
            name: 'sleep_semaphore',
            argumentsText: JSON.stringify({
              __invocation_goal: 'Wait for protected implementation work',
              __requires_human_approval: false,
              name: 'runner-lock',
              count: 1,
              maxCount: 1,
            }),
          }],
        };
      }
      const latestUserMessage = request.messages.findLast((message) => message.role === 'user');
      if (latestUserMessage?.content.includes('<task_continuation>')) {
        if (request.invocationContext.conversationId === ignoredTaskConversationId) {
          return { assistantContent: 'Ignored the task reminder.', continuation: [], toolCalls: [] };
        }
        replaceTasks(request.invocationContext.conversationId, [{
          title: 'Finish the runner task',
          description: 'Exercise the invisible internal-task hook.',
          done: true,
          status: 'completed',
          result: 'Completed after the hook.',
        }]);
        return { assistantContent: 'Pending task completed.', continuation: [], toolCalls: [] };
      }
      if (
        latestUserMessage?.content.includes('<semaphore_release_required>')
        && request.toolHistory.length === 0
      ) {
        const holding = request.invocationContext.semaphoreHoldings[0];
        return {
          assistantContent: '',
          continuation: [],
          toolCalls: [{
            callId: `finish-${providerRequests.length}`,
            name: holding.name === 'idle-lock'
              && request.invocationContext.conversationId === idleHolder.id
              ? 'update_semaphore_status'
              : 'release_semaphore',
            argumentsText: JSON.stringify(
              holding.name === 'idle-lock'
              && request.invocationContext.conversationId === idleHolder.id
                ? {
                  __invocation_goal: 'Report the user blocker',
                  __requires_human_approval: false,
                  name: holding.name,
                  status: 'blocked',
                  summary: 'User input is required before releasing the protected work.',
                }
                : {
                  __invocation_goal: 'Release completed protected work',
                  __requires_human_approval: false,
                  name: holding.name,
                  count: holding.count,
                }),
          }],
        };
      }
      return { assistantContent: 'Resumed safely.', continuation: [], toolCalls: [] };
    },
  };
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: (event) => runnerEvents.push(event),
  });
  const holder = createConversation({ model: model.id, projectPath: process.cwd() });
  const waiter = createConversation({ model: model.id, projectPath: process.cwd() });
  runner.acquireSemaphore({
    conversationId: holder.id,
    name: 'runner-lock',
    count: 1,
    maxCount: 1,
  });
  await runner.send({
    conversationId: waiter.id,
    model: model.id,
    text: 'Begin protected work.',
  });
  await waitFor(() => !runner.runs.has(waiter.id));
  assert.equal(providerRequests.length, 1);
  assert.equal(runner.reloadSnapshot().semaphoreWaits[0].conversationId, waiter.id);
  assert.equal(
    runnerEvents.some((event) => event.type === 'run-state' && event.sleeping === true),
    true,
  );
  const externalPrompt = await runner.send({
    conversationId: waiter.id,
    model: model.id,
    text: 'A prioritized agent prompt must remain queued while sleeping.',
    steer: true,
    fromAgent: true,
  });
  assert.equal(externalPrompt.queued, true);
  assert.equal(providerRequests.length, 1);
  assert.equal(runner.reloadSnapshot().semaphoreWaits[0].conversationId, waiter.id);
  runner.cancelQueuedMessage({
    conversationId: waiter.id,
    messageId: externalPrompt.message.id,
  });
  runner.releaseSemaphore({
    conversationId: holder.id,
    name: 'runner-lock',
    count: 1,
  });
  await waitFor(() => providerRequests.length >= 4 && !runner.runs.has(waiter.id));
  assert.deepEqual(providerRequests[1].invocationContext.semaphoreHoldings, [{
    name: 'runner-lock',
    count: 1,
    maxCount: 1,
  }]);
  const resumedUserMessage = database.getMessages(waiter.id).findLast((message) => (
    message.role === 'user' && message.fromAgent
  ));
  assert.ok(resumedUserMessage);
  assert.match(resumedUserMessage.content, /granted 1 permit/);
  assert.equal(runner.reloadSnapshot().semaphoreWaits.length, 0);
  assert.deepEqual(runner.semaphores.holdings(waiter.id), []);

  const forcedHolder = createConversation({ model: model.id, projectPath: process.cwd() });
  const forcedWaiter = createConversation({ model: model.id, projectPath: process.cwd() });
  runner.acquireSemaphore({
    conversationId: forcedHolder.id,
    name: 'forced-lock',
    count: 1,
    maxCount: 1,
  });
  runner.acquireSemaphore({
    conversationId: forcedWaiter.id,
    name: 'forced-lock',
    count: 1,
    maxCount: 1,
  });
  const requestsBeforeForce = providerRequests.length;
  await runner.runSemaphoreNow(forcedWaiter.id);
  await waitFor(() => providerRequests.length === requestsBeforeForce + 1
    && !runner.runs.has(forcedWaiter.id));
  const forcedMessage = database.getMessages(forcedWaiter.id).findLast((message) => (
    message.role === 'user' && message.fromAgent
  ));
  assert.match(forcedMessage.content, /overridden by the user/);
  assert.deepEqual(runner.semaphores.holdings(forcedWaiter.id), []);
  runner.releaseSemaphore({
    conversationId: forcedHolder.id,
    name: 'forced-lock',
    count: 1,
  });

  const humanHolder = createConversation({ model: model.id, projectPath: process.cwd() });
  const humanWaiter = createConversation({ model: model.id, projectPath: process.cwd() });
  const followingWaiter = createConversation({ model: model.id, projectPath: process.cwd() });
  runner.acquireSemaphore({
    conversationId: humanHolder.id,
    name: 'human-message-lock',
    count: 1,
    maxCount: 1,
  });
  runner.acquireSemaphore({
    conversationId: humanWaiter.id,
    name: 'human-message-lock',
    count: 1,
    maxCount: 1,
  });
  runner.acquireSemaphore({
    conversationId: followingWaiter.id,
    name: 'human-message-lock',
    count: 1,
    maxCount: 1,
  });
  const requestsBeforeHumanMessage = providerRequests.length;
  await runner.send({
    conversationId: humanWaiter.id,
    model: model.id,
    text: 'Handle this new human request instead.',
    userInitiated: true,
  });
  await waitFor(() => providerRequests.length === requestsBeforeHumanMessage + 1
    && !runner.runs.has(humanWaiter.id));
  assert.equal(runner.semaphores.waitSnapshot(humanWaiter.id), null);
  assert.deepEqual(runner.semaphores.holdings(humanWaiter.id), []);
  assert.equal(runner.semaphores.waitSnapshot(followingWaiter.id).position, 1);
  assert.equal(
    database.getMessages(humanWaiter.id).findLast((message) => message.role === 'user').fromAgent,
    false,
  );
  assert.equal(runner.cancelSemaphore(followingWaiter.id), true);
  runner.releaseSemaphore({
    conversationId: humanHolder.id,
    name: 'human-message-lock',
    count: 1,
  });

  const cancelledHolder = createConversation({ model: model.id, projectPath: process.cwd() });
  const cancelledWaiter = createConversation({ model: model.id, projectPath: process.cwd() });
  runner.acquireSemaphore({
    conversationId: cancelledHolder.id,
    name: 'cancelled-lock',
    count: 1,
    maxCount: 1,
  });
  runner.acquireSemaphore({
    conversationId: cancelledWaiter.id,
    name: 'cancelled-lock',
    count: 1,
    maxCount: 1,
  });
  const requestsBeforeCancel = providerRequests.length;
  assert.equal(runner.cancelSemaphore(cancelledWaiter.id), true);
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  assert.equal(providerRequests.length, requestsBeforeCancel);
  assert.equal(runner.semaphores.waitSnapshot(cancelledWaiter.id), null);
  assert.equal(database.getMessages(cancelledWaiter.id).length, 0);
  runner.releaseSemaphore({
    conversationId: cancelledHolder.id,
    name: 'cancelled-lock',
    count: 1,
  });
  const idleHolder = createConversation({ model: model.id, projectPath: process.cwd() });
  const idleWaiter = createConversation({ model: model.id, projectPath: process.cwd() });
  runner.acquireSemaphore({
    conversationId: idleHolder.id,
    name: 'idle-lock',
    count: 1,
    maxCount: 1,
  });
  runner.acquireSemaphore({
    conversationId: idleWaiter.id,
    name: 'idle-lock',
    count: 1,
    maxCount: 1,
  });
  await waitFor(() => runner.semaphores.waitSnapshot(idleWaiter.id) !== null);
  const listResult = await listTool.execute({}, { chatRunner: runner, conversationId: idleHolder.id });
  assert.deepEqual(listResult.holdings, [{ name: 'idle-lock', count: 1, maxCount: 1 }]);
  const globalEntry = listResult.all.find((entry) => entry.name === 'idle-lock');
  assert.equal(globalEntry.waitingCount, 1);
  assert.deepEqual(globalEntry.holders, [{ conversationId: idleHolder.id, count: 1 }]);
  assert.deepEqual(globalEntry.queue, [{ conversationId: idleWaiter.id, position: 1 }]);
  const subagent = createConversation({
    model: model.id,
    projectPath: process.cwd(),
    conversationType: 'subagent',
    parentConversationId: idleHolder.id,
  });
  runner.acquireSemaphore({
    conversationId: subagent.id,
    name: 'sub-lock',
    count: 1,
    maxCount: 1,
  });
  const contextTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_list_thread_context');
  const contextResult = await contextTool.execute({}, { chatRunner: runner, conversationId: idleHolder.id });
  assert.deepEqual(contextResult.threads.map((thread) => thread.semaphoreHoldings), [[{
    name: 'sub-lock',
    count: 1,
    maxCount: 1,
  }]]);
  const threadsTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_list_threads');
  const threadsText = await threadsTool.execute({}, { chatRunner: runner, conversationId: idleHolder.id });
  assert.match(threadsText, /Semaphore permits: idle-lock \(1\)/);
  const requestsBeforeIdle = providerRequests.length;
  await runner.send({
    conversationId: idleHolder.id,
    model: model.id,
    text: 'Finish without releasing.',
  });
  await waitFor(() => providerRequests.length >= requestsBeforeIdle + 3
    && !runner.runs.has(idleHolder.id));
  assert.deepEqual(runner.semaphores.holdings(idleHolder.id), [{
    name: 'idle-lock',
    count: 1,
    maxCount: 1,
    blocked: 'User input is required before releasing the protected work.',
  }]);
  assert.equal(runner.semaphores.waitSnapshot(idleWaiter.id).position, 1);
  assert.equal(runner.isConversationBlocked(idleHolder.id), true);
  const releaseHook = database.getMessages(idleHolder.id).findLast((message) => (
    message.hidden && message.content.includes('<semaphore_release_required>')
  ));
  assert.match(releaseHook.content, /with 1 thread\(s\) waiting/);
  runner.releaseSemaphore({
    conversationId: idleHolder.id,
    name: 'idle-lock',
    count: 1,
  });
  await waitFor(() => !runner.runs.has(idleWaiter.id)
    && runner.semaphores.holdings(idleWaiter.id).length === 0);

  const taskConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  replaceTasks(taskConversation.id, [{
    title: 'Finish the runner task',
    description: 'Exercise the invisible internal-task hook.',
    done: false,
    status: 'pending',
    result: null,
  }]);
  const requestsBeforeTask = providerRequests.length;
  await runner.send({
    conversationId: taskConversation.id,
    model: model.id,
    text: 'Start the internal task.',
  });
  await waitFor(() => providerRequests.length >= requestsBeforeTask + 2
    && !runner.runs.has(taskConversation.id));
  const taskHook = database.getMessages(taskConversation.id).find((message) => (
    message.hidden && message.content.includes('<task_continuation>')
  ));
  assert.ok(taskHook);
  assert.equal(database.listTasks(taskConversation.id)[0].status, 'completed');

  const ignoredTaskConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  ignoredTaskConversationId = ignoredTaskConversation.id;
  replaceTasks(ignoredTaskConversation.id, [{
    title: 'Ignored task',
    description: 'Verify repeated hooks are suppressed.',
    done: false,
    status: 'pending',
    result: null,
  }]);
  const requestsBeforeIgnoredTask = providerRequests.length;
  await runner.send({
    conversationId: ignoredTaskConversation.id,
    model: model.id,
    text: 'Ignore the reminder once.',
  });
  await waitFor(() => providerRequests.length >= requestsBeforeIgnoredTask + 2
    && !runner.runs.has(ignoredTaskConversation.id));
  assert.equal(providerRequests.length, requestsBeforeIgnoredTask + 2);
  assert.equal(database.getMessages(ignoredTaskConversation.id).filter((message) => (
    message.hidden && message.content.includes('<task_continuation>')
  )).length, 1);
  assert.equal(database.listTasks(ignoredTaskConversation.id)[0].status, 'pending');

  const failedResumeHolder = createConversation({ model: model.id, projectPath: process.cwd() });
  const failedResumeWaiter = createConversation({ model: model.id, projectPath: process.cwd() });
  runner.acquireSemaphore({
    conversationId: failedResumeHolder.id,
    name: 'failed-resume-lock',
    count: 1,
    maxCount: 1,
  });
  runner.acquireSemaphore({
    conversationId: failedResumeWaiter.id,
    name: 'failed-resume-lock',
    count: 1,
    maxCount: 1,
  });
  const resumeSemaphore = runner.resumeSemaphore.bind(runner);
  runner.resumeSemaphore = async () => { throw new Error('Simulated resume failure.'); };
  runner.releaseSemaphore({
    conversationId: failedResumeHolder.id,
    name: 'failed-resume-lock',
    count: 1,
  });
  await waitFor(() => runner.semaphores.holdings(failedResumeWaiter.id)[0]?.blocked);
  assert.match(
    runner.semaphores.holdings(failedResumeWaiter.id)[0].blocked,
    /Simulated resume failure/,
  );
  runner.resumeSemaphore = resumeSemaphore;
  runner.releaseSemaphore({
    conversationId: failedResumeWaiter.id,
    name: 'failed-resume-lock',
    count: 1,
  });

  const apiConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  runner.acquireSemaphore({
    conversationId: apiConversation.id,
    name: 'plugin-api-lock',
    count: 1,
    maxCount: 1,
  });
  const pluginRuntime = new PluginRuntime({
    pluginsDir: testProfile,
    services: {
      appInfo: () => ({ name: 'Avi', version: 'test' }),
      chatRunner: runner,
      createDomainApi: createPluginDomainApi,
      cleanupConversation: () => {},
    },
  });
  const pluginApi = await pluginRuntime.activate({
    id: 'conceptual-lock-api-test',
    capabilities: ['threads.read', 'threads.update'],
    activate() {},
  });
  const apiThread = await pluginApi.threads.get(apiConversation.id);
  const apiTasks = await apiThread.tasks.replace([{
    title: 'Blocked API task',
    description: 'Exercise Plugin API task status.',
    done: false,
    status: 'inconclusive',
    result: 'Waiting for the user.',
  }]);
  assert.equal(apiTasks[0].status, 'inconclusive');
  await apiThread.semaphores.setStatus(
    'plugin-api-lock',
    'blocked',
    'Plugin API blocker.',
  );
  const apiSnapshot = await apiThread.getSnapshot();
  assert.equal(apiSnapshot.workStatus, 'blocked');
  assert.equal(apiSnapshot.tasks[0].status, 'inconclusive');
  assert.equal(apiSnapshot.semaphoreHoldings[0].blocked, 'Plugin API blocker.');
  assert.deepEqual(await apiThread.tasks.list(), apiTasks);
  assert.equal((await apiThread.semaphores.list())[0].name, 'plugin-api-lock');
  const apiSemaphores = await pluginApi.semaphores.list();
  assert.equal(apiSemaphores.find((item) => item.name === 'plugin-api-lock').waitingCount, 0);
  await apiThread.semaphores.release('plugin-api-lock', 1);
  assert.deepEqual(await apiThread.semaphores.list(), []);
  const readOnlyApi = await pluginRuntime.activate({
    id: 'conceptual-lock-read-only-test',
    capabilities: ['threads.read'],
    activate() {},
  });
  const readOnlyThread = await readOnlyApi.threads.get(apiConversation.id);
  await assert.rejects(() => readOnlyThread.tasks.replace([]), /requires capability "threads.update"/);
  await assert.rejects(
    () => readOnlyThread.semaphores.setStatus('plugin-api-lock', 'active'),
    /requires capability "threads.update"/,
  );
  await pluginRuntime.deactivateAll('test');

  await runner.shutdown();

  const mixedEvents = [];
  const mixedRequests = [];
  const mixedProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      mixedRequests.push(request);
      if (mixedRequests.length === 1) {
        return {
          assistantContent: '',
          continuation: [],
          toolCalls: [
            {
              callId: 'mixed-sleep',
              name: 'sleep_semaphore',
              argumentsText: JSON.stringify({
                __invocation_goal: 'Acquire the lock first',
                __requires_human_approval: false,
                name: 'mixed-lock',
                count: 1,
                maxCount: 1,
              }),
            },
            {
              callId: 'mixed-list',
              name: 'list_semaphores',
              argumentsText: JSON.stringify({
                __invocation_goal: 'Inspect queues',
                __requires_human_approval: false,
              }),
            },
          ],
        };
      }
      return { assistantContent: 'Recovered after feedback.', continuation: [], toolCalls: [] };
    },
  };
  const mixedRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: mixedProvider }),
      listModels: () => [model],
    },
    mcpManager: null,
    sendEvent: (event) => mixedEvents.push(event),
  });
  const mixedConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await mixedRunner.send({
    conversationId: mixedConversation.id,
    model: model.id,
    text: 'Start protected work.',
  });
  await waitFor(() => !mixedRunner.runs.has(mixedConversation.id));
  assert.equal(mixedRequests.length, 2);
  const mixedRound = mixedRequests[1].toolHistory[0];
  assert.equal(mixedRound.toolCalls.length, 2);
  assert.deepEqual(
    mixedRound.results.map((result) => [result.callId, result.isError]),
    [['mixed-sleep', true], ['mixed-list', true]],
  );
  assert.match(mixedRound.results[0].output, /must be the only tool call/);
  assert.deepEqual(mixedRunner.semaphores.holdings(mixedConversation.id), []);
  assert.equal(mixedRunner.reloadSnapshot().semaphoreWaits.length, 0);
  assert.equal(mixedEvents.some((event) => event.type === 'error'), false);
  const mixedAssistant = database.getMessages(mixedConversation.id)
    .findLast((message) => message.role === 'assistant');
  assert.equal(mixedAssistant.status, 'completed');
  await mixedRunner.shutdown();

  closeDatabase();
  database = null;
  console.log('Semaphore tests passed.');
} finally {
  if (database) database.closeDatabase();
  rmSync(testProfile, { recursive: true, force: true });
}

process.exit(0);
