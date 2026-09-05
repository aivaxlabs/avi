import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scriptDirectory, '..');

const now = new Date();
const pad = (value) => String(value).padStart(2, '0');
const timeZone = Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
  .formatToParts(now)
  .find((part) => part.type === 'timeZoneName')?.value.replace(/[^A-Za-z0-9-]/g, '') ?? 'local';
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${timeZone}`;
const visualizationRoot = join(tmpdir(), '.avi', 'visualizations', stamp, 'retry-recovery');
mkdirSync(visualizationRoot, { recursive: true });
const outputDirectory = mkdtempSync(join(visualizationRoot, 'run-'));
const profile = mkdtempSync(join(outputDirectory, 'profile-'));
process.env.USERPROFILE = profile;
process.env.HOME = profile;
assert.equal(resolve(homedir()), resolve(profile));
mkdirSync(join(profile, 'workspace'));
globalThis.fetch = async () => { throw new Error('Network disabled in retry recovery test'); };
const results = [];
let database;
const watchdog = setTimeout(() => {
  console.error('Retry recovery test timeout');
  process.exit(2);
}, 60000);

async function waitFor(predicate) {
  const until = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for mocked run');
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
}

function blockText(block) {
  if (typeof block?.content === 'string') return block.content;
  if (Array.isArray(block?.content)) {
    return block.content.map((part) => part?.text ?? '').join('');
  }
  return '';
}

function assertResumedCurrentPrompt(mode, observation) {
  assert.equal(observation.queued, false, `${mode}: retry must start a run, not queue`);
  assert.equal(observation.returnedMessage, true, `${mode}: retry must return the same assistant message`);
  assert.equal(observation.hasRunImmediatelyAfterRetry, true, `${mode}: run must be registered synchronously`);
  assert.equal(observation.retryProviderCalls, 1, `${mode}: resume must make exactly one provider call`);
  assert.equal(observation.finalMessageRole, 'user', `${mode}: request must end on the user turn`);
  assert.equal(observation.finalUserContent, 'CURRENT PROMPT', `${mode}: must resume the current prompt`);
  assert.equal(observation.assistantStatusAfter, 'completed', `${mode}: same assistant must complete`);
  assert.ok(observation.assistantContentAfter.includes('Recovered response.'), `${mode}: resumed assistant must hold the recovery content`);
  assert.equal(observation.stoppedByUserAfter, false, `${mode}: stoppedByUser must be cleared after resume`);
  assert.equal(observation.userStatusAfter, 'sent', `${mode}: failed user message must return to sent`);
  if (!mode.startsWith('mcp-')) {
    assert.equal(observation.preservedPartialHistory, true, `${mode}: partial assistant work must stay in the resume history`);
  }
  assert.deepEqual(observation.runEventsAfterRetry, [true, false], `${mode}: run-state must go running then idle`);
  if (observation.hasOlderHistory) {
    assert.ok(observation.requestedUserPrompts.includes('OLD PROMPT'), `${mode}: older kept history must remain`);
  }
}

try {
  database = await import(pathToFileURL(join(repository, 'src/main/database.js')));
  const { ChatRunner } = await import(pathToFileURL(join(repository, 'src/main/chat-runner.js')));
  const { canResumeAssistantMessage } = await import(pathToFileURL(join(repository, 'src/renderer/lib/message-actions.js')));
  const model = {
    id: 'test:model', modelId: 'test-model', name: 'Test', providerName: 'Test',
    interface: 'responses', reasoning: [], context: { input: 100000, output: 10000 },
  };
  const preferences = database.getPreferences();
  preferences.tuning.continuationRepliesEnabled = false;
  const makeRunner = (provider, events, mcpManager = null) => new ChatRunner({
    registry: { resolve: () => ({ model, provider }), listModels: () => [model] },
    mcpManager,
    getPreferences: () => preferences,
    sendEvent: (event) => events.push(event),
  });
  const resumeEligibleModes = new Set([
    'error', 'shutdown', 'crash-recovery',
    'mcp-shutdown-empty', 'mcp-crash-empty', 'mcp-crash-history',
  ]);

  for (const mode of ['error', 'stop', 'shutdown', 'crash-recovery', 'mcp-stop-empty', 'mcp-stop-history', 'mcp-shutdown-empty', 'mcp-crash-empty', 'mcp-crash-history']) {
    const events = [];
    const calls = [];
    let recovering = false;
    let enteredMcp = false;
    const provider = {
      getContributions: () => ({ tools: [] }),
      stream: async (request) => {
        calls.push({ messages: structuredClone(request.messages), toolHistory: structuredClone(request.toolHistory) });
        if (!recovering) {
          request.onEvent({ type: 'content', text: 'Partial response.' });
          if (mode === 'error') throw new Error('Simulated inference failure');
          await new Promise((_resolveStream, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
          });
        }
        request.onEvent({ type: 'content', text: 'Recovered response.' });
        return { assistantContent: 'Recovered response.', continuation: [], toolCalls: [] };
      },
    };
    const mcpManager = mode.startsWith('mcp-') ? {
      isWorkspaceReady: () => recovering,
      ensureWorkspace: async (_workspace, signal) => {
        if (recovering) return;
        enteredMcp = true;
        await new Promise((_ready, reject) => {
          signal.addEventListener('abort', () => reject(new Error('MCP preparation stopped')), { once: true });
        });
      },
      runtimeForWorkspace: () => ({ tools: [], instructions: [] }),
    } : null;
    let runner = makeRunner(provider, events, mcpManager);
    const conversation = database.createConversation({
      title: mode, titleStatus: 'generated', model: model.id, projectPath: join(profile, 'workspace'),
    });
    const hasOlderHistory = mode.endsWith('history');
    if (hasOlderHistory) {
      database.insertMessage({ conversationId: conversation.id, role: 'user', status: 'sent', content: 'OLD PROMPT' });
      database.insertMessage({ conversationId: conversation.id, role: 'assistant', status: 'completed', content: 'OLD ANSWER' });
    }
    let userId;
    let assistantId;
    if (mode.includes('crash')) {
      userId = database.insertMessage({
        conversationId: conversation.id, role: 'user', status: mode.startsWith('mcp-') ? 'waiting_mcp' : 'sent', content: 'CURRENT PROMPT',
      }).id;
      assistantId = database.insertMessage({
        conversationId: conversation.id, role: 'assistant', model: model.id, status: 'streaming',
        content: 'Partial before process exit.',
        segments: [{ id: 'partial', type: 'content', text: 'Partial before process exit.', sequence: 1, status: 'streaming' }],
      }).id;
      assert.equal(database.abortInterruptedMessages(), 1, `${mode}: startup recovery must abort the orphaned stream`);
    } else {
      const sent = await runner.send({
        conversationId: conversation.id, model: model.id, text: 'CURRENT PROMPT', permissionMode: 'full_access',
      });
      userId = sent.message.id;
      assistantId = sent.assistantMessage.id;
      if (mode.startsWith('mcp-')) await waitFor(() => enteredMcp);
      else await waitFor(() => calls.length === 1);
      if (mode === 'shutdown' || mode === 'mcp-shutdown-empty') await runner.shutdown();
      else if (mode !== 'error') runner.stop(conversation.id, { stoppedByUser: true });
      await waitFor(() => !runner.runs.has(conversation.id));
    }
    const userBefore = database.getMessage(userId);
    const assistantBefore = database.getMessage(assistantId);
    const eligible = canResumeAssistantMessage(assistantBefore, assistantBefore, false);
    assert.equal(assistantBefore.status === 'completed', false, `${mode}: interrupted assistant must not be completed`);
    if (resumeEligibleModes.has(mode)) {
      assert.equal(eligible, true, `${mode}: recovery state must be resumable`);
    } else {
      assert.equal(assistantBefore.stoppedByUser, true, `${mode}: explicit stop must flag stoppedByUser`);
      assert.equal(eligible, true, `${mode}: stopped response must still offer Try again`);
    }
    const eventsBefore = events.length;
    const callsBefore = calls.length;
    recovering = true;
    runner = makeRunner(provider, events, mcpManager);
    const result = await runner.retry({
      conversationId: conversation.id, model: model.id, assistantMessageId: assistantId,
      resumeFromFailure: true, permissionMode: 'full_access',
    });
    const hasRunImmediatelyAfterRetry = runner.runs.has(conversation.id);
    await waitFor(() => !runner.runs.has(conversation.id));
    const retryCalls = calls.slice(callsBefore);
    const lastRequest = retryCalls.at(-1);
    const requestedUserPrompts = lastRequest?.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content) ?? [];
    const assistantAfter = database.getMessage(assistantId);
    const userAfter = database.getMessage(userId);
    const observation = {
      mode,
      eligible,
      userStatusBefore: userBefore.status,
      assistantStatusBefore: assistantBefore.status,
      stoppedByUserBefore: assistantBefore.stoppedByUser,
      returnedMessage: result.message !== null,
      queued: result.queued,
      hasRunImmediatelyAfterRetry,
      retryProviderCalls: retryCalls.length,
      requestedUserPrompts,
      finalMessageRole: lastRequest?.messages.at(-1)?.role ?? null,
      finalUserContent: requestedUserPrompts.at(-1) ?? null,
      assistantStatusAfter: assistantAfter.status,
      assistantContentAfter: assistantAfter.content,
      stoppedByUserAfter: assistantAfter.stoppedByUser,
      userStatusAfter: userAfter.status,
      preservedPartialHistory: lastRequest?.toolHistory.some((round) => round.assistantContent?.includes('Partial')) ?? false,
      hasOlderHistory,
      runEventsAfterRetry: events.slice(eventsBefore)
        .filter((event) => event.type === 'run-state')
        .map((event) => event.running),
    };
    assertResumedCurrentPrompt(mode, observation);
    results.push(observation);
    console.log(`[OK] mode=${mode}`);
  }

  const helperConversation = database.createConversation({
    title: 'helper-exclusions', titleStatus: 'generated', model: model.id, projectPath: join(profile, 'workspace'),
  });
  database.insertMessage({ conversationId: helperConversation.id, role: 'user', status: 'sent', content: 'OLD PROMPT' });
  database.insertMessage({ conversationId: helperConversation.id, role: 'assistant', status: 'completed', content: 'OLD ANSWER' });
  database.insertMessage({ conversationId: helperConversation.id, role: 'user', status: 'queued', content: 'QUEUED PROMPT' });
  database.insertMessage({ conversationId: helperConversation.id, role: 'user', status: 'steered', content: 'STEERED PROMPT' });
  const helperCurrentUserId = database.insertMessage({
    conversationId: helperConversation.id, role: 'user', status: 'waiting_mcp', content: 'CURRENT PROMPT',
  }).id;
  const helperFailedAssistantId = database.insertMessage({
    conversationId: helperConversation.id, role: 'assistant', status: 'error', content: 'FAILED ANSWER',
  }).id;
  database.insertMessage({ conversationId: helperConversation.id, role: 'user', status: 'sent', content: 'LATER PROMPT' });

  const resumedBlocks = database.toModelMessagesThroughUser(helperConversation.id, helperFailedAssistantId, { includeFailedUser: true });
  const resumedTexts = resumedBlocks.map(blockText);
  assert.equal(resumedBlocks.at(-1)?.role, 'user', 'resumed history must end on the anchor user');
  assert.equal(resumedTexts.at(-1), 'CURRENT PROMPT', 'resume must anchor the current prompt');
  assert.ok(!resumedTexts.includes('QUEUED PROMPT'), 'queued user must be excluded from the resume anchor');
  assert.ok(!resumedTexts.includes('STEERED PROMPT'), 'steered user must be excluded from the resume anchor');
  assert.ok(!resumedTexts.includes('LATER PROMPT'), 'later user must be excluded from the resume anchor');
  assert.ok(resumedTexts.includes('OLD PROMPT'), 'kept older history must remain in the resume');

  database.updateMessage(helperCurrentUserId, { status: 'aborted' });
  const resumedAfterAbort = database.toModelMessagesThroughUser(helperConversation.id, helperFailedAssistantId, { includeFailedUser: true });
  assert.equal(blockText(resumedAfterAbort.at(-1)), 'CURRENT PROMPT', 'aborted user must anchor the resume');

  const plainBlocks = database.toModelMessagesThroughUser(helperConversation.id, helperFailedAssistantId);
  assert.equal(blockText(plainBlocks.at(-1)), 'OLD PROMPT', 'non-resume helper must keep ignoring failed users');
  console.log('[OK] helper exclusions (queued/steered/later, aborted/waiting_mcp, non-resume unchanged)');

  database.updateConversation(helperConversation.id, {
    contextCheckpoint: 'COMPACTED CURRENT PROMPT',
    checkpointMessageId: helperCurrentUserId,
  });
  const checkpointBlocks = database.toModelMessagesThroughUser(
    helperConversation.id, helperFailedAssistantId, { includeFailedUser: true },
  );
  assert.deepEqual(checkpointBlocks.map(blockText), [
    '<conversation_checkpoint>\nCOMPACTED CURRENT PROMPT\n</conversation_checkpoint>',
  ], 'recovery at the checkpoint boundary must use the checkpoint, not empty or pre-compaction history');

  for (const changedModel of [false, true]) {
    const conversation = database.createConversation({
      title: 'checkpoint-tool-recovery', model: model.id, projectPath: join(profile, 'workspace'),
    });
    const user = database.insertMessage({
      conversationId: conversation.id, role: 'user', status: 'error', content: 'COMPACTED PROMPT',
    });
    const imagePath = join(outputDirectory, 'recovery.png');
    writeFileSync(imagePath, 'mock image');
    const continuation = [{ type: 'reasoning', id: 'opaque-item', encrypted_content: 'opaque-test-data' }];
    const failed = database.insertMessage({
      conversationId: conversation.id, role: 'assistant', status: 'error', content: 'Partial work.',
      segments: [
        { type: 'content', text: 'Partial work.', sequence: 1 },
        { type: 'tool-call', key: 'round:0:done', callId: 'done', name: 'confirmed_tool', argumentsText: '{}', resultText: 'CONFIRMED', status: 'completed', sequence: 2,
          mediaContent: [{ type: 'image_url', image_url: { path: imagePath } }] },
        { type: 'provider-continuation', round: 0, model: changedModel ? 'other:model' : model.id, interface: model.interface, items: continuation, sequence: 3 },
        { type: 'tool-call', key: 'round:1:pending', callId: 'pending', name: 'pending_tool', argumentsText: JSON.stringify({ __invocation_goal: 'Finish pending work', __requires_human_approval: false }), sequence: 4 },
        { type: 'error', code: 'invalid_prompt', text: 'Simulated provider rejection', sequence: 5 },
      ],
    });
    database.updateConversation(conversation.id, { contextCheckpoint: 'RECOVERY CHECKPOINT', checkpointMessageId: user.id });
    const calls = [];
    const executed = [];
    const events = [];
    const runner = makeRunner({
      getContributions: () => ({ tools: [
        { name: 'confirmed_tool', description: 'Already completed', inputSchema: { type: 'object', properties: {} }, execute: () => { executed.push('confirmed'); return 'wrong'; } },
        { name: 'pending_tool', description: 'Still pending', inputSchema: { type: 'object', properties: {} }, execute: () => { executed.push('pending'); return 'PENDING RESULT'; } },
      ] }),
      stream: async (request) => {
        calls.push(request);
        request.onEvent({ type: 'content', text: 'Recovered checkpoint.' });
        return { assistantContent: 'Recovered checkpoint.', toolCalls: [], continuation: [] };
      },
    }, events);
    const result = await runner.retry({
      conversationId: conversation.id, model: model.id, assistantMessageId: failed.id,
      resumeFromFailure: true, permissionMode: 'full_access',
    });
    assert.equal(result.message.id, failed.id);
    await waitFor(() => !runner.runs.has(conversation.id));
    assert.equal(calls.length, 1, 'checkpoint recovery must reach the provider');
    assert.deepEqual(executed, ['pending'], 'confirmed tool results must not execute again');
    assert.deepEqual(calls[0].messages.map(blockText), ['<conversation_checkpoint>\nRECOVERY CHECKPOINT\n</conversation_checkpoint>']);
    assert.deepEqual(calls[0].toolHistory[0].continuation, changedModel ? [] : continuation);
    assert.equal(calls[0].toolHistory[0].results[0].output, 'CONFIRMED');
    assert.equal(calls[0].toolHistory[0].messages[0].content[0].image_url.path, imagePath);
    assert.equal(database.getMessage(failed.id).status, 'completed');
    assert.ok(database.getMessage(failed.id).segments.some((segment) => segment.callId === 'pending' && segment.resultText !== undefined));
    assert.deepEqual(events.filter((event) => event.type === 'run-state').map((event) => event.running), [true, false]);
    await assert.rejects(runner.retry({ conversationId: conversation.id, model: model.id, assistantMessageId: failed.id, resumeFromFailure: true }), /no longer available/);
  }
  const emptyConversation = database.createConversation({ model: model.id, projectPath: join(profile, 'workspace') });
  const emptyRunner = makeRunner({ getContributions: () => ({ tools: [] }) }, []);
  await assert.rejects(emptyRunner.retry({ conversationId: emptyConversation.id, model: model.id }), /no prompt or checkpoint/);
  const orphan = database.insertMessage({ conversationId: emptyConversation.id, role: 'assistant', status: 'error' });
  await assert.rejects(emptyRunner.retry({ conversationId: emptyConversation.id, model: model.id, assistantMessageId: orphan.id, resumeFromFailure: true }), /prompt or checkpoint.*unavailable/);
  const { PluginRuntime } = await import(pathToFileURL(join(repository, 'src/main/plugin-runtime.js')));
  const { createPluginDomainApi } = await import(pathToFileURL(join(repository, 'src/main/plugin-domain-api.js')));
  const pluginRuntime = new PluginRuntime({
    pluginsDir: join(profile, 'plugins'),
    services: { chatRunner: emptyRunner, createDomainApi: createPluginDomainApi },
  });
  try {
    const avi = await pluginRuntime.activate({ id: 'retry-contract', capabilities: ['threads.read', 'threads.run'] });
    const thread = await avi.threads.get(emptyConversation.id);
    await assert.rejects(thread.retry(), /no prompt or checkpoint/);
  } finally {
    await pluginRuntime.deactivateAll();
  }
  const { RemoteMcpServer } = await import(pathToFileURL(join(repository, 'src/main/remote-mcp-server.js')));
  const rpc = new RemoteMcpServer({
    chatRunner: emptyRunner,
    subscribeChatEvents: () => {},
    invokeApplicationRequest: (_channel, payload) => emptyRunner.retry(payload),
  });
  const rpcReply = await rpc.executeRpcRequest({
    jsonrpc: '2.0', id: 1, method: 'chat:retry',
    params: { conversationId: emptyConversation.id, model: model.id, assistantMessageId: orphan.id, resumeFromFailure: true },
  }, 'conversation', new Set(['chat:retry']), (_method, payload) => payload);
  assert.equal(rpcReply.error.code, -32603);
  assert.match(rpcReply.error.data.message, /prompt or checkpoint.*unavailable/);
  assert.equal(Object.hasOwn(rpcReply, 'result'), false, 'RPC must not report successful no-op');
  console.log('[OK] checkpoint recovery, canonical tool history, continuation compatibility, and explicit runner/Core/RPC rejection');

  const app = readFileSync(join(repository, 'src/renderer/App.jsx'), 'utf8');
  const start = app.indexOf('  async function retryAssistantMessage(');
  const end = app.indexOf('\n  async function cancelQueuedMessage(', start);
  assert.ok(start >= 0 && end > start, 'retryAssistantMessage extraction markers must exist');
  const callbackFactory = new Function(
    'api', 'window', 'appState', 'currentModel', 'selectedId',
    'setRunning', 'setConversations', 'setSubagents', 'setRubberDucks', 'setSideChats', 'refreshBots', 'setError',
    'upsertById', 'sortByUpdatedAt',
    `${app.slice(start, end)}; return retryAssistantMessage;`,
  );
  const conversationStub = {
    id: 'conv-1', isBot: false, isSubagent: false, isRubberDuck: false, isSideChat: false,
  };
  const runCallback = async (result, initialRunning, delayResponse = false) => {
    const state = { running: { 'conv-1': initialRunning }, runningWrites: 0, conversationCalls: 0 };
    let resolveRetry;
    const api = delayResponse
      ? { chat: { retry: () => new Promise((resolvePromise) => { resolveRetry = resolvePromise; }) } }
      : { chat: { retry: async () => { if (result instanceof Error) throw result; return result; } } };
    const callback = callbackFactory(
      api,
      { localStorage: { getItem: () => null } },
      { tuning: {} },
      model.id,
      conversationStub.id,
      (update) => {
        state.runningWrites += 1;
        state.running = typeof update === 'function' ? update(state.running) : { ...state.running, ...update };
      },
      () => { state.conversationCalls += 1; },
      () => {}, () => {}, () => {}, async () => {},
      (error) => { state.error = error; },
      (list, item) => [...(list ?? []), item],
      () => 0,
    );
    const pending = callback('assistant-1', { resumeFromFailure: true });
    if (delayResponse) {
      state.running = { 'conv-1': true };
      state.running = { 'conv-1': false };
      resolveRetry(result);
    }
    await pending;
    return state;
  };
  {
    const rejected = await runCallback(new Error('Recovery unavailable'), false);
    assert.equal(rejected.error, 'Recovery unavailable', 'retry rejection must reach visible error state');
    assert.equal(rejected.runningWrites, 0);
    const noOp = await runCallback({ conversation: conversationStub, message: null, queued: false }, false);
    assert.equal(noOp.runningWrites, 0, 'null no-op: callback must not touch running state (events own it)');
    assert.equal(noOp.running['conv-1'], false, 'null no-op: running state must remain false');
    assert.equal(noOp.conversationCalls, 1, 'null no-op: conversation list must still update');
    console.log('[OK] app-callback null no-op: running stays false, no phantom');
    const busy = await runCallback({ conversation: conversationStub, message: null, queued: true }, true);
    assert.equal(busy.runningWrites, 0, 'busy: callback must not touch running state');
    assert.equal(busy.running['conv-1'], true, 'busy: running state must remain true');
    console.log('[OK] app-callback busy: running stays true, not enqueued');
    const fastCompleted = await runCallback(
      { conversation: conversationStub, message: { id: 'assistant-1' }, queued: false },
      false,
      true,
    );
    assert.equal(fastCompleted.runningWrites, 0, 'successful: callback must not touch running state');
    assert.equal(fastCompleted.running['conv-1'], false, 'successful: run-state false must not be overwritten to true');
    assert.equal(fastCompleted.conversationCalls, 1, 'successful: conversation list must still update');
    console.log('[OK] app-callback successful/fast-completed: run-state true/false wins, no phantom running');
  }

  writeFileSync(join(outputDirectory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Retry recovery regression passed. Results: ${join(outputDirectory, 'results.json')}`);
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  database?.closeDatabase();
}
process.exit(process.exitCode || 0);
