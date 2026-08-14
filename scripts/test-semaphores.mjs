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
  const { resolveDynamicContext } = await import('../src/main/context-injection.js');
  const {
    closeDatabase,
    createConversation,
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

  const sleepTool = CLIENT_TOOLS.find((tool) => tool.name === 'sleep_semaphore');
  const releaseTool = CLIENT_TOOLS.find((tool) => tool.name === 'release_semaphore');
  assert.ok(sleepTool);
  assert.ok(releaseTool);
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
  assert.match(runtimeSource, /userInitiated: true/);
  assert.match(appSource, /api\.chat\.runSemaphoreNow\(conversationId\)/);
  assert.match(appSource, /api\.chat\.cancelSemaphore\(conversationId\)/);
  assert.match(chatViewSource, /Agent sleeping/);
  assert.match(chatViewSource, /Queue position/);
  assert.match(chatViewSource, />\s*Run now\s*</);
  assert.match(chatViewSource, />\s*Cancel semaphore\s*</);
  assert.match(sidebarSource, /aria-label="Waiting for semaphore"/);

  setSemaphoreState({ semaphores: {}, waiting: {} });
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const runnerEvents = [];
  const providerRequests = [];
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
  await waitFor(() => providerRequests.length === 2 && !runner.runs.has(waiter.id));
  const resumedUserMessage = database.getMessages(waiter.id).findLast((message) => (
    message.role === 'user' && message.fromAgent
  ));
  assert.ok(resumedUserMessage);
  assert.match(resumedUserMessage.content, /granted 1 permit/);
  assert.equal(runner.semaphores.holdings(waiter.id)[0].count, 1);
  assert.equal(runner.reloadSnapshot().semaphoreWaits.length, 0);
  runner.releaseSemaphore({
    conversationId: waiter.id,
    name: 'runner-lock',
    count: 1,
  });

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
  await runner.shutdown();

  closeDatabase();
  database = null;
  console.log('Semaphore tests passed.');
} finally {
  if (database) database.closeDatabase();
  rmSync(testProfile, { recursive: true, force: true });
}

process.exit(0);
