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
  assert.doesNotMatch(await resolveDynamicContext(calls[0].invocationContext), /\btrivial(?:ity|ities)?\b/i);
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

  closeDatabase();
  database = null;
  console.log('Ultra mode tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
