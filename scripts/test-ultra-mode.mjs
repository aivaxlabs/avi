import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-ultra-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { resolveDynamicContext } = await import('../src/main/context-injection.js');
  const {
    closeDatabase,
    createConversation,
    getConversation,
    getGoalForConversation,
    getMessages,
    updateConversation,
  } = database;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: ['high'],
    context: { input: 100_000, output: 10_000 },
  };
  const calls = [];
  let round = 0;
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({
        model,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: async (request) => {
            calls.push(request);
            round += 1;
            if (round === 1) {
              return { assistantContent: 'Initial Ultra Goal pass.', toolCalls: [] };
            }
            if (round === 2) {
              return {
                assistantContent: '',
                toolCalls: [{
                  callId: 'complete-ultra-goal',
                  name: 'update_goal_status',
                  argumentsText: JSON.stringify({
                    status: 'completed',
                    summary: 'Ultra Goal verified.',
                    __requires_human_approval: false,
                    __invocation_goal: 'Complete the verified Ultra Goal.',
                  }),
                }],
              };
            }
            return { assistantContent: 'Ultra Goal complete.', toolCalls: [] };
          },
        },
      }),
      listModels: () => [model],
    },
    sendEvent: () => {},
  });
  const conversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });

  await runner.startGoal({
    conversationId: conversation.id,
    model: model.id,
    specification: 'Complete the objective with an Ultra team.',
    reasoningEffort: 'high',
    ultraMode: true,
    sendInitialPrompt: true,
  });
  const deadline = Date.now() + 5_000;
  while (runner.runs.has(conversation.id)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Ultra Goal completion.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }

  assert.equal(getGoalForConversation(conversation.id).status, 'completed');
  assert.ok(calls.length >= 3);
  assert.ok(calls.every((call) => call.invocationContext.ultraMode === true));
  assert.ok(calls.every((call) => call.invocationContext.workMode === 'goal'));
  assert.ok(calls.every((call) => call.invocationContext.orchestrationRole === 'orchestrator'));
  assert.equal(calls[0].invocationContext.goal.id, getGoalForConversation(conversation.id).id);
  assert.ok(calls[0].tools.some((tool) => tool.name === 'chat_spawn_subagent'));
  const ultraWorkModeContext = (await resolveDynamicContext(calls[0].invocationContext)).match(
    /<work_mode mode="ultra" role="orchestrator">[\s\S]*?<\/work_mode>/,
  )?.[0] ?? '';
  for (const requirement of [
    'selected Ultra for complex work',
    'must run a model-driven production, independent critique, correction, and fresh validation loop',
    'must not be the independent final reviewer',
    'Do not conclude before independent critique has challenged the latest relevant candidate',
    'There is no predetermined number of agents or rounds',
    'further work would only repeat existing evidence',
  ]) {
    assert.ok(ultraWorkModeContext.includes(requirement));
  }
  assert.doesNotMatch(ultraWorkModeContext, /\btrivial(?:ity|ities)?\b/i);
  assert.ok(
    getMessages(conversation.id)
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .every((message) => message.ultraMode),
  );
  assert.equal(getConversation(conversation.id).orchestrationMode, 'ultra');

  await runner.send({
    conversationId: conversation.id,
    model: model.id,
    text: 'Continue in the conversation mode.',
  });
  const persistentUltraDeadline = Date.now() + 5_000;
  while (runner.runs.has(conversation.id)) {
    if (Date.now() >= persistentUltraDeadline) {
      throw new Error('Timed out waiting for persistent Ultra mode.');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(getMessages(conversation.id).findLast((message) => message.role === 'user').ultraMode, true);

  updateConversation(conversation.id, { orchestrationMode: null });
  await runner.send({
    conversationId: conversation.id,
    model: model.id,
    text: 'Continue without Ultra mode.',
  });
  const regularModeDeadline = Date.now() + 5_000;
  while (runner.runs.has(conversation.id)) {
    if (Date.now() >= regularModeDeadline) {
      throw new Error('Timed out waiting after disabling Ultra mode.');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.equal(getMessages(conversation.id).findLast((message) => message.role === 'user').ultraMode, false);

  const planConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await assert.rejects(
    () => runner.send({
      conversationId: planConversation.id,
      model: model.id,
      text: 'Create a plan with Ultra.',
      workMode: 'plan',
      ultraMode: true,
    }),
    /Ultra mode cannot be used with Plan mode/,
  );
  assert.equal(getMessages(planConversation.id).length, 0);

  const scoutInvocations = [];
  const teamCalls = [];
  const teamRunner = new ChatRunner({
    registry: {
      resolve: (id) => id === model.id ? {
        model,
        provider: {
          getContributions: () => ({ tools: [] }),
          stream: async (request) => {
            teamCalls.push(request);
            const toolCall = (name, input) => ({
              assistantContent: '',
              toolCalls: [{
                callId: `${name}-${teamCalls.length}`,
                name,
                argumentsText: JSON.stringify({
                  ...input,
                  __requires_human_approval: false,
                  __invocation_goal: `Call ${name}.`,
                }),
              }],
            });
            if (teamCalls.length === 1) return toolCall('chat_spawn_subagent', { prompt: 'Review the work.' });
            if (teamCalls.length === 2) {
              return toolCall('ultra_set_context', {
                objective: 'Ship the importer.',
                expectedOutcome: 'Tested importer.',
              });
            }
            return { assistantContent: 'Team context ready.', toolCalls: [] };
          },
        },
      } : null,
      listModels: () => [model],
    },
    getPreferences: () => {
      const preferences = database.getPreferences();
      return {
        ...preferences,
        defaultModels: {
          ...preferences.defaultModels,
          auxiliary: { modelId: 'test:auxiliary', reasoningEffort: null },
        },
      };
    },
    sendEvent: () => {},
  });
  const scoutStepLabels = [];
  teamRunner.quickChatRunner = {
    invoke: async (request) => {
      scoutInvocations.push(request);
      request.onProgress({
        segments: [{ type: 'tool-call', name: 'read_file', invocationGoal: 'Read **the** importer\nspec' }],
      });
      scoutStepLabels.push(getMessages(request.ultraScout.threadId)
        .findLast((message) => message.role === 'assistant')
        .segments.find((segment) => segment.type === 'reasoning')?.text);
      return { status: 'completed', content: 'Scout map.', model: 'test:auxiliary', segments: [] };
    },
  };
  const teamConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  const waitForTeam = async () => {
    const teamDeadline = Date.now() + 5_000;
    while (teamRunner.runs.has(teamConversation.id)) {
      if (Date.now() >= teamDeadline) throw new Error('Timed out waiting for the Ultra team run.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  };
  await teamRunner.send({
    conversationId: teamConversation.id,
    model: model.id,
    text: 'Build the importer with Ultra.',
    permissionMode: 'full_access',
    ultraMode: true,
  });
  await waitForTeam();

  assert.equal(scoutInvocations.length, 1);
  assert.deepEqual(scoutStepLabels, ['**Mapping the task: Read the importer spec**']);
  assert.ok(!getMessages(teamConversation.id).some((message) => (
    message.segments?.some((segment) => segment.type === 'reasoning' && segment.text.startsWith('**Mapping the task'))
  )));
  assert.equal(scoutInvocations[0].model, 'test:auxiliary');
  assert.equal(scoutInvocations[0].ultraScout.threadId, teamConversation.id);
  assert.ok(teamCalls[0].tools.some((tool) => tool.name === 'ultra_set_context'));
  const ultraSpawnSchema = teamCalls[0].tools.find((tool) => tool.name === 'chat_spawn_subagent').inputSchema;
  for (const property of ['model_name', 'model_level', 'reasoning_effort']) {
    assert.equal(ultraSpawnSchema.properties[property], undefined);
  }
  assert.ok(!ultraSpawnSchema.required.includes('model_level'));
  assert.equal(teamCalls[0].invocationContext.ultraMap, 'Scout map.');
  assert.equal(teamCalls[0].invocationContext.ultraContext, null);
  const spawnSegment = getMessages(teamConversation.id)
    .flatMap((message) => message.segments ?? [])
    .find((segment) => segment.type === 'tool-call' && segment.name === 'chat_spawn_subagent');
  assert.match(spawnSegment.resultText, /Record the shared Ultra team context with ultra_set_context/);
  assert.equal(database.listSubagents(teamConversation.id).length, 0);
  assert.equal(teamCalls.at(-1).invocationContext.ultraContext.revision, 1);
  const teamState = getConversation(teamConversation.id);
  assert.equal(teamState.ultraMap, 'Scout map.');
  assert.ok(teamState.ultraScoutedAt);
  assert.equal(teamState.ultraContext.objective, 'Ship the importer.');
  assert.deepEqual(teamState.ultraContext.userRequests, ['Build the importer with Ultra.']);

  await teamRunner.send({
    conversationId: teamConversation.id,
    model: model.id,
    text: 'Keep going.',
    permissionMode: 'full_access',
  });
  await waitForTeam();
  assert.equal(scoutInvocations.length, 1);

  updateConversation(teamConversation.id, { title: 'Renamed Ultra thread' });
  assert.equal(getConversation(teamConversation.id).ultraMap, 'Scout map.');
  assert.equal(getConversation(teamConversation.id).ultraContext.revision, 1);

  updateConversation(teamConversation.id, { orchestrationMode: null });
  const resetState = getConversation(teamConversation.id);
  assert.equal(resetState.ultraMap, '');
  assert.equal(resetState.ultraContext, null);
  assert.equal(resetState.ultraScoutedAt, null);

  const streamCallsBeforeStop = teamCalls.length;
  const scoutStarted = Promise.withResolvers();
  let scoutSignalAborted = false;
  teamRunner.quickChatRunner = {
    invoke: ({ signal }) => new Promise((resolveScout, rejectScout) => {
      scoutStarted.resolve();
      signal.addEventListener('abort', () => {
        scoutSignalAborted = true;
        rejectScout(new Error('The response was stopped.'));
      }, { once: true });
    }),
  };
  await teamRunner.send({
    conversationId: teamConversation.id,
    model: model.id,
    text: 'Map this, then stop.',
    permissionMode: 'full_access',
    ultraMode: true,
  });
  await scoutStarted.promise;
  teamRunner.stop(teamConversation.id, { stoppedByUser: true });
  await waitForTeam();
  const stoppedAssistant = getMessages(teamConversation.id).findLast((message) => message.role === 'assistant');
  assert.equal(scoutSignalAborted, true);
  assert.equal(stoppedAssistant.status, 'aborted');
  assert.equal(stoppedAssistant.stoppedByUser, true);
  assert.ok(!stoppedAssistant.segments.some((segment) => segment.type === 'reasoning' || segment.type === 'error'));
  assert.equal(teamCalls.length, streamCallsBeforeStop);
  assert.equal(getConversation(teamConversation.id).ultraScoutedAt, null);

  closeDatabase();
  database = null;
  console.log('Ultra mode tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
