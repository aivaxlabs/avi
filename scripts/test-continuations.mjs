import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-continuations-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const {
    closeDatabase,
    createConversation,
    forkConversation,
    getMessages,
    insertMessage,
  } = database;

  const model = {
    id: 'test:model',
    modelId: 'conversation-model',
    providerId: 'test',
    providerName: 'Test',
    interface: 'responses',
    capabilities: {},
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };
  const auxiliaryModel = {
    ...model,
    id: 'test:auxiliary',
    modelId: 'auxiliary-model',
  };
  const events = [];
  const auxiliaryCalls = [];
  const completionNotifications = [];
  let continuationRepliesEnabled = true;
  let holdNextConversationResponse = false;
  let releaseConversationResponse;
  const provider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      if (request.invocationContext?.auxiliary) {
        auxiliaryCalls.push(request);
        return {
          assistantContent: JSON.stringify({
            continuations: [
              'Show me the implementation.',
              'Show me the implementation.',
              'Explain the tradeoffs.',
              'Add focused tests.',
              'What remains unverified?',
              'This fifth distinct reply must be discarded.',
            ],
          }),
          continuation: [],
          toolCalls: [],
        };
      }
      if (holdNextConversationResponse) {
        holdNextConversationResponse = false;
        await new Promise((resolveResponse) => {
          releaseConversationResponse = resolveResponse;
        });
      }
      return {
        assistantContent: 'The requested work is complete.',
        continuation: [],
        toolCalls: [],
      };
    },
  };
  const runner = new ChatRunner({
    registry: {
      resolve: (modelId) => ({
        model: modelId === auxiliaryModel.id ? auxiliaryModel : model,
        provider,
      }),
      listModels: () => [model, auxiliaryModel],
    },
    getPreferences: () => ({
      defaultModels: {
        auxiliary: { modelId: auxiliaryModel.id, reasoningEffort: null },
      },
      tuning: { continuationRepliesEnabled },
    }),
    sendEvent: (event) => events.push(event),
    sendCompletionNotification: (notification) => completionNotifications.push(notification),
  });

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  const conversation = createConversation({
    title: 'Continuation test',
    titleStatus: 'generated',
    model: model.id,
    projectPath: process.cwd(),
  });
  await runner.send({
    conversationId: conversation.id,
    model: model.id,
    text: 'Finish the requested work.',
    attachments: [],
  });
  await waitFor(() => getMessages(conversation.id).some(
    (message) => message.continuations.length > 0,
  ));

  const firstAssistant = getMessages(conversation.id)
    .findLast((message) => message.role === 'assistant');
  assert.deepEqual(firstAssistant.continuations, [
    'Show me the implementation.',
    'Explain the tradeoffs.',
    'Add focused tests.',
    'What remains unverified?',
  ]);
  assert.equal(auxiliaryCalls.length, 1);
  assert.deepEqual(
    completionNotifications.map(({ conversation: item }) => item.id),
    [conversation.id],
  );
  assert.equal(auxiliaryCalls[0].invocationContext.auxiliary, true);
  assert.deepEqual(auxiliaryCalls[0].tools, []);
  const continuationPrompt = auxiliaryCalls[0].messages
    .find((message) => message.role === 'system')
    ?.content;
  assert.match(continuationPrompt, /zero to 4/);
  assert.match(continuationPrompt, /complete, self-contained user message/);
  assert.match(continuationPrompt, /Never use placeholders/);
  assert.match(continuationPrompt, /empty array over/);
  assert.ok(auxiliaryCalls[0].messages.some(
    (message) => message.role === 'assistant',
  ));
  assert.ok(events.some((event) => (
    event.type === 'message'
    && event.message.id === firstAssistant.id
    && event.message.continuations.length === 4
  )));

  continuationRepliesEnabled = false;
  const disabledConversation = createConversation({
    title: 'Disabled continuation test',
    titleStatus: 'generated',
    model: model.id,
    projectPath: process.cwd(),
  });
  await runner.send({
    conversationId: disabledConversation.id,
    model: model.id,
    text: 'Finish without suggesting replies.',
    attachments: [],
  });
  await waitFor(() => !runner.runs.has(disabledConversation.id));
  assert.equal(auxiliaryCalls.length, 1);
  assert.deepEqual(
    completionNotifications.map(({ conversation: item }) => item.id),
    [conversation.id, disabledConversation.id],
  );
  assert.deepEqual(
    getMessages(disabledConversation.id)
      .findLast((message) => message.role === 'assistant')
      .continuations,
    [],
  );
  continuationRepliesEnabled = true;

  holdNextConversationResponse = true;
  await runner.send({
    conversationId: conversation.id,
    model: model.id,
    text: 'Use the first continuation.',
    attachments: [],
  });
  assert.deepEqual(
    getMessages(conversation.id).find((message) => message.id === firstAssistant.id).continuations,
    [],
  );
  releaseConversationResponse();
  await waitFor(() => !runner.runs.has(conversation.id));
  assert.deepEqual(
    completionNotifications.map(({ conversation: item }) => item.id),
    [conversation.id, disabledConversation.id, conversation.id],
  );

  const parent = createConversation({
    title: 'Parent continuation test',
    titleStatus: 'generated',
    model: model.id,
    projectPath: process.cwd(),
  });
  insertMessage({
    conversationId: parent.id,
    role: 'user',
    status: 'sent',
    content: 'Coordinate the remaining work.',
  });
  const parentAssistant = insertMessage({
    conversationId: parent.id,
    role: 'assistant',
    status: 'completed',
    content: 'I will wait for the sub-agent.',
  });
  const child = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Inspect the focused area.',
  }).conversation;

  holdNextConversationResponse = true;
  await runner.send({
    conversationId: child.id,
    model: model.id,
    text: 'Inspect the focused area.',
    attachments: [],
  });
  await runner.generateContinuations(parent.id);
  assert.deepEqual(
    getMessages(parent.id).find((message) => message.id === parentAssistant.id).continuations,
    [],
  );
  releaseConversationResponse();
  await waitFor(() => getMessages(parent.id).find(
    (message) => message.id === parentAssistant.id,
  ).continuations.length > 0);
  assert.deepEqual(
    completionNotifications.map(({ conversation: item }) => item.id),
    [conversation.id, disabledConversation.id, conversation.id],
    'sub-agent threads must not send completion notifications',
  );

  const agentConversation = createConversation({
    title: 'Agent-created thread',
    titleStatus: 'generated',
    model: model.id,
    projectPath: process.cwd(),
    createdBy: 'agent',
  });
  await runner.send({
    conversationId: agentConversation.id,
    model: model.id,
    text: 'Complete this agent-created thread.',
    attachments: [],
  });
  await waitFor(() => !runner.runs.has(agentConversation.id));
  assert.equal(
    completionNotifications.some(({ conversation: item }) => item.id === agentConversation.id),
    false,
    'agent-created threads must not send completion notifications',
  );

  const activeParent = createConversation({
    title: 'Parent with active sub-agent',
    titleStatus: 'generated',
    model: model.id,
    projectPath: process.cwd(),
  });
  const activeChild = forkConversation(activeParent.id, {
    subagent: true,
    subagentPrompt: 'Keep working while the parent responds.',
  }).conversation;
  holdNextConversationResponse = true;
  await runner.send({
    conversationId: activeChild.id,
    model: model.id,
    text: 'Keep working while the parent responds.',
    attachments: [],
  });
  await runner.send({
    conversationId: activeParent.id,
    model: model.id,
    text: 'Finish this response before the sub-agent.',
    attachments: [],
  });
  await waitFor(() => !runner.runs.has(activeParent.id));
  assert.equal(
    completionNotifications.some(({ conversation: item }) => item.id === activeParent.id),
    false,
    'a user-created thread must not notify while a sub-agent is active',
  );

  releaseConversationResponse();
  await waitFor(() => !runner.runs.has(activeChild.id));
  assert.equal(
    completionNotifications.filter(({ conversation: item }) => item.id === activeParent.id).length,
    1,
    'a deferred user-created thread notification must be sent after its sub-agents stop',
  );

  console.log('Continuation and completion notification tests passed.');
  await runner.shutdown();
  closeDatabase();
} finally {
  try {
    database?.closeDatabase();
  } catch {
  }
  rmSync(testProfile, { recursive: true, force: true });
}
process.exit(0);
