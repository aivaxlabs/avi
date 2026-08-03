import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-goal-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const {
    closeDatabase,
    createConversation,
    forkConversation,
    getConversation,
    getGoalForConversation,
    getMessages,
  } = database;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: ['high'],
    context: { input: 100_000, output: 10_000 },
  };
  const startGoalTool = CLIENT_TOOLS.find((tool) => tool.name === 'start_goal');
  assert.match(startGoalTool.description, /only when explicitly requested/);
  assert.match(startGoalTool.description, /do not infer Goals from ordinary tasks/);

  function buildRunner(provider, events = []) {
    return {
      events,
      runner: new ChatRunner({
        registry: {
          resolve: () => ({ model, provider }),
          listModels: () => [model],
        },
        sendEvent: (event) => events.push(event),
      }),
    };
  }

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  const originalGoalPrompt = 'Add export support.';
  const preparedGoalSpecification = [
    'Objective: Add export support.',
    'Acceptance criteria: Export produces the requested output.',
    'Execution rules: Preserve existing behavior.',
    'Validation: Run the focused export test.',
  ].join('\n');
  const auxiliaryCalls = [];
  const goalTaskCalls = [];
  const auxiliaryModel = {
    ...model,
    id: 'test:auxiliary',
    modelId: 'auxiliary-model',
  };
  let completeTitleGeneration;
  const auxiliaryProvider = {
    stream: async (request) => {
      auxiliaryCalls.push(request);
      if (auxiliaryCalls.length === 2) {
        return new Promise((resolveTitle) => {
          completeTitleGeneration = () => resolveTitle({
            assistantContent: JSON.stringify({ title: 'Review export documentation' }),
            toolCalls: [],
          });
        });
      }
      return {
        assistantContent: JSON.stringify({
          title: 'Add export support',
          goalSpecification: preparedGoalSpecification,
        }),
        toolCalls: [],
      };
    },
  };
  const goalTaskProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      goalTaskCalls.push(request);
      if (goalTaskCalls.length === 1) {
        return {
          assistantContent: '',
          toolCalls: [{
            callId: 'complete-auxiliary-goal',
            name: 'update_goal_status',
            argumentsText: JSON.stringify({
              status: 'completed',
              summary: 'Export support was validated.',
              __requires_human_approval: false,
              __invocation_goal: 'Complete the Goal after validation.',
            }),
          }],
        };
      }
      return { assistantContent: 'Export support completed.', toolCalls: [] };
    },
  };
  const auxiliaryRunner = new ChatRunner({
    registry: {
      resolve: (modelId) => modelId === auxiliaryModel.id
        ? { model: auxiliaryModel, provider: auxiliaryProvider }
        : { model, provider: goalTaskProvider },
      listModels: () => [model, auxiliaryModel],
    },
    getPreferences: () => ({
      defaultModels: {
        auxiliary: { modelId: auxiliaryModel.id, reasoningEffort: 'high' },
      },
      tuning: {},
    }),
    sendEvent: () => {},
  });
  const auxiliaryConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await auxiliaryRunner.startGoal({
    conversationId: auxiliaryConversation.id,
    model: model.id,
    specification: originalGoalPrompt,
    sendInitialPrompt: true,
  });
  await waitFor(() => !auxiliaryRunner.runs.has(auxiliaryConversation.id));
  assert.equal(auxiliaryCalls.length, 1);
  assert.equal(auxiliaryCalls[0].reasoningEffort, 'high');
  assert.equal(auxiliaryCalls[0].invocationContext.auxiliary, true);
  assert.deepEqual(auxiliaryCalls[0].tools, []);
  assert.equal(auxiliaryCalls[0].messages.at(-1).content, originalGoalPrompt);
  assert.equal(getConversation(auxiliaryConversation.id).title, 'Add export support');
  assert.equal(getGoalForConversation(auxiliaryConversation.id).specification, preparedGoalSpecification);
  assert.equal(getMessages(auxiliaryConversation.id)[0].content, originalGoalPrompt);
  assert.equal(goalTaskCalls.length, 2);

  const titleConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await auxiliaryRunner.send({
    conversationId: titleConversation.id,
    model: model.id,
    text: 'Review the export documentation.',
  });
  assert.equal(auxiliaryCalls.length, 2);
  assert.equal(goalTaskCalls.length, 3);
  assert.equal(getConversation(titleConversation.id).title, 'Review the export documentation.');
  completeTitleGeneration();
  await waitFor(() => getConversation(titleConversation.id).title === 'Review export documentation');
  await waitFor(() => !auxiliaryRunner.runs.has(titleConversation.id));
  assert.equal(getConversation(titleConversation.id).title, 'Review export documentation');
  await auxiliaryRunner.send({
    conversationId: titleConversation.id,
    model: model.id,
    text: 'Focus on the examples.',
  });
  await waitFor(() => !auxiliaryRunner.runs.has(titleConversation.id));
  assert.equal(auxiliaryCalls.length, 2);
  assert.equal(getConversation(titleConversation.id).title, 'Review export documentation');

  const completionCalls = [];
  const completionProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      completionCalls.push(request);
      if (completionCalls.length === 1) {
        request.onEvent({
          type: 'usage',
          usage: { inputTokens: 100, outputTokens: 10 },
        });
        return {
          assistantContent: '',
          toolCalls: [{
            callId: 'complete-goal',
            name: 'update_goal_status',
            argumentsText: JSON.stringify({
              status: 'completed',
              summary: 'All acceptance terms were verified.',
              __requires_human_approval: false,
              __invocation_goal: 'Complete the active Goal with verified evidence.',
            }),
          }],
        };
      }
      return { assistantContent: 'Goal completed.', toolCalls: [] };
    },
  };
  const { runner: completionRunner } = buildRunner(completionProvider);
  const completionConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await completionRunner.startGoal({
    conversationId: completionConversation.id,
    model: model.id,
    specification: 'Produce and verify the requested result.',
    attachments: [{
      id: 'goal-attachment',
      name: 'acceptance.txt',
      type: 'text/plain',
      size: 18,
      text: 'Acceptance context.',
    }],
    reasoningEffort: 'high',
    permissionMode: 'full_access',
    sendInitialPrompt: true,
  });
  await waitFor(() => !completionRunner.runs.has(completionConversation.id));
  const completedGoal = getGoalForConversation(completionConversation.id);
  assert.equal(completedGoal.status, 'completed');
  assert.equal(completionCalls.length, 2);
  assert.ok(completionCalls[0].tools.some((tool) => tool.name === 'update_goal_status'));
  assert.ok(!completionCalls[0].tools.some((tool) => tool.name === 'start_goal'));
  const completionResult = JSON.parse(completionCalls[1].toolHistory[0].results[0].output);
  assert.equal(completionResult.status, 'completed');
  assert.equal(completionResult.tokens_transacted, 110);
  assert.equal(typeof completionResult.elapsed_ms, 'number');
  assert.match(completionResult.final_response_instruction, /token volume.*time spent/);
  assert.deepEqual(
    getMessages(completionConversation.id).map((message) => message.workMode),
    ['goal', 'goal'],
  );
  assert.equal(getMessages(completionConversation.id)[0].attachments[0].name, 'acceptance.txt');

  const continuationCalls = [];
  const continuationProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      continuationCalls.push(request);
      if (continuationCalls.length === 1) {
        request.onEvent({ type: 'content', text: 'Work remains.' });
        return { assistantContent: '', toolCalls: [] };
      }
      if (continuationCalls.length === 2) {
        return {
          assistantContent: '',
          toolCalls: [{
            callId: 'block-goal',
            name: 'update_goal_status',
            argumentsText: JSON.stringify({
              status: 'blocked',
              summary: 'A required external credential is unavailable.',
              __requires_human_approval: false,
              __invocation_goal: 'Report the real external blocker.',
            }),
          }],
        };
      }
      return { assistantContent: 'The blocker is recorded.', toolCalls: [] };
    },
  };
  const { runner: continuationRunner } = buildRunner(continuationProvider);
  const continuationConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await continuationRunner.startGoal({
    conversationId: continuationConversation.id,
    model: model.id,
    specification: 'Continue until completion or a real blocker.',
    sendInitialPrompt: true,
  });
  await waitFor(() => !continuationRunner.runs.has(continuationConversation.id));
  assert.equal(getGoalForConversation(continuationConversation.id).status, 'blocked');
  assert.equal(continuationCalls.length, 3);
  assert.ok(continuationCalls.slice(0, 2).every((request) => request.invocationContext.goal?.id));
  assert.equal(continuationCalls[2].invocationContext.goal, null);
  assert.ok(getMessages(continuationConversation.id).some((message) => (
    message.hidden
    && message.role === 'user'
    && message.content.includes('<goal_continuation')
  )));
  const forkedContinuation = forkConversation(continuationConversation.id);
  assert.ok(forkedContinuation.messages.every((message) => !message.hidden));

  const pauseCalls = [];
  let finishPausedIteration;
  const pauseProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      pauseCalls.push(request);
      if (pauseCalls.length === 1) {
        return new Promise((resolveStream) => {
          finishPausedIteration = () => resolveStream({ assistantContent: '', toolCalls: [] });
        });
      }
      if (pauseCalls.length === 2) {
        return {
          assistantContent: '',
          toolCalls: [{
            callId: 'complete-resumed-goal',
            name: 'update_goal_status',
            argumentsText: JSON.stringify({
              status: 'completed',
              summary: 'The resumed Goal was verified.',
              __requires_human_approval: false,
              __invocation_goal: 'Complete the resumed Goal.',
            }),
          }],
        };
      }
      return { assistantContent: 'Done after resume.', toolCalls: [] };
    },
  };
  const { runner: pauseRunner } = buildRunner(pauseProvider);
  const pauseConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await pauseRunner.startGoal({
    conversationId: pauseConversation.id,
    model: model.id,
    specification: 'Pause and resume this Goal.',
    sendInitialPrompt: true,
  });
  await waitFor(() => pauseCalls.length === 1);
  await pauseRunner.changeGoal({ conversationId: pauseConversation.id, action: 'pause' });
  finishPausedIteration();
  await waitFor(() => !pauseRunner.runs.has(pauseConversation.id));
  await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  assert.equal(pauseCalls.length, 1);
  assert.equal(getGoalForConversation(pauseConversation.id).status, 'paused');
  await pauseRunner.changeGoal({ conversationId: pauseConversation.id, action: 'resume' });
  await waitFor(() => !pauseRunner.runs.has(pauseConversation.id));
  assert.equal(pauseCalls.length, 3);
  assert.equal(getGoalForConversation(pauseConversation.id).status, 'completed');

  let stopSignal;
  const stopProvider = {
    getContributions: () => ({ tools: [] }),
    stream: ({ signal }) => new Promise((resolveStream, rejectStream) => {
      stopSignal = signal;
      signal.addEventListener('abort', () => rejectStream(new Error('Stopped.')), { once: true });
    }),
  };
  const { runner: stopRunner } = buildRunner(stopProvider);
  const stopConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await stopRunner.startGoal({
    conversationId: stopConversation.id,
    model: model.id,
    specification: 'Pause this Goal when its inference is stopped.',
    sendInitialPrompt: true,
  });
  await waitFor(() => Boolean(stopSignal));
  stopRunner.stop(stopConversation.id);
  await waitFor(() => !stopRunner.runs.has(stopConversation.id));
  const stoppedGoal = getGoalForConversation(stopConversation.id);
  assert.equal(stopSignal.aborted, true);
  assert.equal(stoppedGoal.status, 'paused');
  assert.equal(stoppedGoal.resumedAt, null);
  assert.ok(stoppedGoal.activeElapsedMs >= 0);

  const editCalls = [];
  let finishOriginalIteration;
  const editProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      editCalls.push(request);
      if (editCalls.length === 1) {
        return new Promise((resolveStream) => {
          finishOriginalIteration = () => resolveStream({ assistantContent: '', toolCalls: [] });
        });
      }
      if (editCalls.length === 2) {
        assert.equal(request.invocationContext.goal.specification, 'Revised Goal specification.');
        return {
          assistantContent: '',
          toolCalls: [{
            callId: 'block-edited-goal',
            name: 'update_goal_status',
            argumentsText: JSON.stringify({
              status: 'blocked',
              summary: 'The revised requirement depends on unavailable input.',
              __requires_human_approval: false,
              __invocation_goal: 'Classify the revised Goal accurately.',
            }),
          }],
        };
      }
      return { assistantContent: 'Revised Goal assessed.', toolCalls: [] };
    },
  };
  const { runner: editRunner } = buildRunner(editProvider);
  const editConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await editRunner.startGoal({
    conversationId: editConversation.id,
    model: model.id,
    specification: 'Original Goal specification.',
    sendInitialPrompt: true,
  });
  await waitFor(() => editCalls.length === 1);
  await editRunner.changeGoal({
    conversationId: editConversation.id,
    action: 'edit',
    specification: 'Revised Goal specification.',
  });
  finishOriginalIteration();
  await waitFor(() => !editRunner.runs.has(editConversation.id));
  assert.equal(getGoalForConversation(editConversation.id).revision, 2);
  assert.ok(getMessages(editConversation.id).some((message) => (
    message.hidden
    && message.content.includes('<goal_update')
  )));

  const planSwitchCalls = [];
  let finishGoalBeforePlan;
  const planSwitchProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      planSwitchCalls.push(request);
      if (planSwitchCalls.length === 1) {
        return new Promise((resolveStream) => {
          finishGoalBeforePlan = () => resolveStream({ assistantContent: '', toolCalls: [] });
        });
      }
      return { assistantContent: '<execution-plan>Plan after Goal</execution-plan>', toolCalls: [] };
    },
  };
  const { runner: planSwitchRunner } = buildRunner(planSwitchProvider);
  const planSwitchConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await planSwitchRunner.startGoal({
    conversationId: planSwitchConversation.id,
    model: model.id,
    specification: 'Goal replaced by Plan mode.',
    sendInitialPrompt: true,
  });
  await waitFor(() => planSwitchCalls.length === 1);
  const switchedPlan = await planSwitchRunner.send({
    conversationId: planSwitchConversation.id,
    model: model.id,
    text: 'Create a plan instead.',
    workMode: 'plan',
  });
  assert.equal(switchedPlan.queued, true);
  finishGoalBeforePlan();
  await waitFor(() => !planSwitchRunner.runs.has(planSwitchConversation.id));
  assert.equal(getGoalForConversation(planSwitchConversation.id).status, 'cancelled');
  assert.equal(planSwitchCalls.length, 2);
  assert.equal(planSwitchCalls[1].invocationContext.workMode, 'plan');
  assert.equal(planSwitchCalls[1].invocationContext.goal, null);

  const selfStartedCalls = [];
  const selfStartedProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      selfStartedCalls.push(request);
      if (selfStartedCalls.length === 1) {
        assert.ok(request.tools.some((tool) => tool.name === 'start_goal'));
        assert.ok(!request.tools.some((tool) => tool.name === 'update_goal_status'));
        return {
          assistantContent: '',
          toolCalls: [{
            callId: 'start-self-goal',
            name: 'start_goal',
            argumentsText: JSON.stringify({
              specification: 'Agent-defined persistent Goal.',
              __requires_human_approval: false,
              __invocation_goal: 'Start a persistent Goal for this work.',
            }),
          }],
        };
      }
      if (selfStartedCalls.length === 2) {
        return { assistantContent: 'The Goal is now active.', toolCalls: [] };
      }
      if (selfStartedCalls.length === 3) {
        assert.ok(request.tools.some((tool) => tool.name === 'update_goal_status'));
        assert.ok(!request.tools.some((tool) => tool.name === 'start_goal'));
        return {
          assistantContent: '',
          toolCalls: [{
            callId: 'complete-self-goal',
            name: 'update_goal_status',
            argumentsText: JSON.stringify({
              status: 'completed',
              summary: 'The agent-defined Goal was verified.',
              __requires_human_approval: false,
              __invocation_goal: 'Complete the agent-defined Goal.',
            }),
          }],
        };
      }
      return { assistantContent: 'Agent-defined Goal complete.', toolCalls: [] };
    },
  };
  const { runner: selfStartedRunner } = buildRunner(selfStartedProvider);
  const selfStartedConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await selfStartedRunner.send({
    conversationId: selfStartedConversation.id,
    model: model.id,
    text: 'Decide whether this work needs a persistent Goal.',
  });
  await waitFor(() => !selfStartedRunner.runs.has(selfStartedConversation.id));
  assert.equal(selfStartedCalls.length, 4);
  assert.equal(getGoalForConversation(selfStartedConversation.id).status, 'completed');

  closeDatabase();
  database = null;
  console.log('Goal mode tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
