import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-thread-input-approval-test-'));
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
  } = database;

  const listThreadsTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_list_threads');
  const listThreadContextTool = CLIENT_TOOLS.find(
    (tool) => tool.name === 'chat_list_thread_context',
  );
  const inspectThreadTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_inspect_thread');
  const approveToolCallTool = CLIENT_TOOLS.find(
    (tool) => tool.name === 'chat_approve_tool_call',
  );
  assert.deepEqual(approveToolCallTool.inputSchema.required, ['threadId', 'approvalId']);
  assert.equal(approveToolCallTool.inputSchema.additionalProperties, false);
  assert.equal(approveToolCallTool.inputSchema.properties.decision, undefined);
  assert.equal(approveToolCallTool.approval, undefined);
  assert.equal(approveToolCallTool.canPerformDestructiveActions, true);

  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    capabilities: {},
    context: { input: 100_000, output: 10_000 },
  };
  const parent = createConversation({ model: model.id, projectPath: resolvedProfile });
  const target = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Run the protected operations.',
  }).conversation;
  const sibling = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Observe the protected operations.',
  }).conversation;
  const questionTarget = forkConversation(parent.id, {
    subagent: true,
    subagentPrompt: 'Ask for the missing scope.',
  }).conversation;
  const sideChat = forkConversation(parent.id, { sideChat: true }).conversation;
  const independent = createConversation({ model: model.id, projectPath: resolvedProfile });
  const independentTarget = forkConversation(independent.id, {
    subagent: true,
    subagentPrompt: 'Own an unrelated approval.',
  }).conversation;
  const bot = createConversation({
    model: model.id,
    projectPath: resolvedProfile,
    conversationType: 'bot',
  });
  const botTarget = createConversation({
    model: model.id,
    projectPath: resolvedProfile,
    conversationType: 'bot',
    parentConversationId: parent.id,
  });

  const events = [];
  const toolResults = [];
  let protectedRound = 0;
  const approvedPath = join(resolvedProfile, 'approved.txt');
  const disallowedPath = join(resolvedProfile, 'disallowed.txt');
  const provider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ toolHistory }) => {
      protectedRound += 1;
      if (protectedRound > 1) {
        toolResults.push(...toolHistory[0].results);
        return { assistantContent: 'Protected work finished.', toolCalls: [] };
      }
      return {
        assistantContent: '',
        toolCalls: [
          {
            callId: 'approved-write',
            name: 'write_file',
            argumentsText: JSON.stringify({
              filePath: approvedPath,
              content: 'approved',
              __invocation_goal: 'Write the approved fixture.',
              __requires_human_approval: true,
            }),
          },
          {
            callId: 'disallowed-write',
            name: 'write_file',
            argumentsText: JSON.stringify({
              filePath: disallowedPath,
              content: 'disallowed',
              __invocation_goal: 'Write the disallowed fixture.',
              __requires_human_approval: true,
            }),
          },
        ],
      };
    },
  };
  const runner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider }),
      listModels: () => [model],
    },
    sendEvent: (event) => events.push(event),
  });

  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the test state.');
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  let questionResult = null;
  runner.runs.set(questionTarget.id, { phase: 'question' });
  runner.pendingQuestions.set('question-one', {
    conversationId: questionTarget.id,
    questions: [{ type: 'free_text', question: 'Which scope should be used?' }],
    finish: (result) => {
      questionResult = result;
    },
  });
  const questionThreads = await listThreadsTool.execute({}, {
    chatRunner: runner,
    conversationId: parent.id,
  });
  const questionContext = await listThreadContextTool.execute({}, {
    chatRunner: runner,
    conversationId: parent.id,
  });
  const inspectedQuestion = await inspectThreadTool.execute(
    { threadId: questionTarget.id },
    { chatRunner: runner, conversationId: parent.id },
  );
  assert.match(
    questionThreads,
    new RegExp(`ID: ${questionTarget.id}[\\s\\S]*?Status: waiting_for_input`),
  );
  assert.equal(
    questionContext.threads.find((thread) => thread.id === questionTarget.id)?.status,
    'waiting_for_input',
  );
  assert.match(inspectedQuestion, /status: waiting_for_input/);
  assert.equal(runner.answerQuestion({ questionId: 'question-one', cancelled: true }), true);
  runner.runs.delete(questionTarget.id);
  assert.deepEqual(questionResult, { cancelled: true, answers: [] });

  await runner.send({
    conversationId: target.id,
    model: model.id,
    text: 'Run both protected writes.',
    permissionMode: 'approve_for_me',
  });
  await waitFor(() => runner.getPendingApprovals(target.id).length === 2);
  assert.equal(runner.runs.get(target.id).phase, 'approval');

  let unrelatedApprovalResult = null;
  runner.pendingApprovals.set('unrelated-approval', {
    conversationId: independentTarget.id,
    toolName: 'write_file',
    invocationSummary: 'Write an unrelated fixture.',
    workspacePath: resolvedProfile,
    approvalPattern: 'unrelated',
    finish: (approved) => {
      unrelatedApprovalResult = approved;
    },
  });

  const approvalThreads = await listThreadsTool.execute({}, {
    chatRunner: runner,
    conversationId: parent.id,
  });
  const approvalContext = await listThreadContextTool.execute({}, {
    chatRunner: runner,
    conversationId: parent.id,
  });
  const inspectedApproval = await inspectThreadTool.execute(
    { threadId: target.id },
    { chatRunner: runner, conversationId: parent.id },
  );
  const pendingApprovals = runner.getPendingApprovals(target.id);
  const approvedRequest = pendingApprovals.find(
    (approval) => approval.invocationSummary === 'Write the approved fixture.',
  );
  const disallowedRequest = pendingApprovals.find(
    (approval) => approval.invocationSummary === 'Write the disallowed fixture.',
  );
  assert.match(
    approvalThreads,
    new RegExp(`ID: ${target.id}[\\s\\S]*?Status: waiting_for_input`),
  );
  assert.equal(
    approvalContext.threads.find((thread) => thread.id === target.id)?.status,
    'waiting_for_input',
  );
  assert.match(inspectedApproval, /status: waiting_for_input/);
  assert.match(inspectedApproval, new RegExp(`id: ${approvedRequest.approvalId}`));
  assert.match(inspectedApproval, new RegExp(`id: ${disallowedRequest.approvalId}`));
  assert.match(inspectedApproval, /name: write_file/);
  assert.match(inspectedApproval, /goal: Write the approved fixture\./);

  for (const sourceConversation of [target, sibling, sideChat, independent, bot]) {
    await assert.rejects(
      () => approveToolCallTool.execute(
        { threadId: target.id, approvalId: approvedRequest.approvalId },
        { chatRunner: runner, conversationId: sourceConversation.id },
      ),
      /direct orchestrator/,
    );
  }
  for (const invalidTarget of [parent, botTarget]) {
    await assert.rejects(
      () => approveToolCallTool.execute(
        { threadId: invalidTarget.id, approvalId: approvedRequest.approvalId },
        { chatRunner: runner, conversationId: parent.id },
      ),
      /direct orchestrator/,
    );
  }
  await assert.rejects(
    () => approveToolCallTool.execute(
      { threadId: target.id, approvalId: 'unrelated-approval' },
      { chatRunner: runner, conversationId: parent.id },
    ),
    /approval was not found for the specified thread/,
  );
  await assert.rejects(
    () => approveToolCallTool.execute(
      { threadId: target.id, approvalId: ' ' },
      { chatRunner: runner, conversationId: parent.id },
    ),
    /approvalId is required/,
  );
  await assert.rejects(
    () => approveToolCallTool.execute(
      { threadId: target.id, approvalId: 'missing' },
      { chatRunner: runner, conversationId: parent.id },
    ),
    /approval was not found for the specified thread/,
  );

  const approvedResult = await approveToolCallTool.execute(
    { threadId: target.id, approvalId: approvedRequest.approvalId },
    { chatRunner: runner, conversationId: parent.id },
  );
  assert.match(approvedResult, /Tool call approved\./);
  assert.match(approvedResult, new RegExp(`Approval ID: ${approvedRequest.approvalId}`));
  await waitFor(() => existsSync(approvedPath));
  assert.equal(existsSync(disallowedPath), false);
  assert.deepEqual(runner.getPendingApprovals(target.id), [disallowedRequest]);
  assert.ok(events.some((event) => (
    event.type === 'permission-resolved'
    && event.conversationId === target.id
    && event.approvalId === approvedRequest.approvalId
    && event.decision === 'allow'
  )));
  await assert.rejects(
    () => approveToolCallTool.execute(
      { threadId: target.id, approvalId: approvedRequest.approvalId },
      { chatRunner: runner, conversationId: parent.id },
    ),
    /approval was not found for the specified thread/,
  );
  assert.equal(await runner.resolveApproval({
    approvalId: disallowedRequest.approvalId,
    decision: 'disallow',
  }), true);
  assert.equal(await runner.resolveApproval({
    approvalId: 'unrelated-approval',
    decision: 'disallow',
  }), true);
  assert.equal(unrelatedApprovalResult, false);
  await waitFor(() => !runner.runs.has(target.id));
  assert.equal(existsSync(disallowedPath), false);
  assert.equal(toolResults.length, 2);

  let raceFinishCount = 0;
  runner.pendingApprovals.set('race-approval', {
    conversationId: target.id,
    toolName: 'write_file',
    invocationSummary: 'Resolve only once.',
    workspacePath: resolvedProfile,
    approvalPattern: 'race',
    finish: () => {
      raceFinishCount += 1;
    },
  });
  const raceResults = await Promise.allSettled([
    approveToolCallTool.execute(
      { threadId: target.id, approvalId: 'race-approval' },
      { chatRunner: runner, conversationId: parent.id },
    ),
    approveToolCallTool.execute(
      { threadId: target.id, approvalId: 'race-approval' },
      { chatRunner: runner, conversationId: parent.id },
    ),
  ]);
  assert.deepEqual(raceResults.map(({ status }) => status).sort(), ['fulfilled', 'rejected']);
  assert.equal(raceFinishCount, 1);
  assert.equal(runner.pendingApprovals.has('race-approval'), false);

  const planCalls = [];
  const planProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      planCalls.push(request);
      request.onEvent({
        type: 'content',
        text: '<execution-plan>Inspect without authorizing execution.</execution-plan>',
      });
      return { assistantContent: '', toolCalls: [] };
    },
  };
  const planRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: planProvider }),
      listModels: () => [model],
    },
    sendEvent: () => {},
  });
  const planConversation = createConversation({ model: model.id, projectPath: resolvedProfile });
  await planRunner.send({
    conversationId: planConversation.id,
    model: model.id,
    text: 'Inspect the approval flow.',
    permissionMode: 'full_access',
    workMode: 'plan',
  });
  await waitFor(() => !planRunner.runs.has(planConversation.id));
  assert.equal(
    planCalls[0].tools.some((tool) => tool.name === 'chat_approve_tool_call'),
    false,
  );

  const cancelledEvents = [];
  let cancelledRound = 0;
  const cancelledProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async () => {
      cancelledRound += 1;
      return cancelledRound > 1
        ? { assistantContent: '', toolCalls: [] }
        : {
            assistantContent: '',
            toolCalls: [{
              callId: 'cancelled-write',
              name: 'write_file',
              argumentsText: JSON.stringify({
                filePath: join(resolvedProfile, 'cancelled.txt'),
                content: 'cancelled',
                __invocation_goal: 'Wait for approval before cancellation.',
                __requires_human_approval: true,
              }),
            }],
          };
    },
  };
  const cancelledRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model, provider: cancelledProvider }),
      listModels: () => [model],
    },
    sendEvent: (event) => cancelledEvents.push(event),
  });
  await cancelledRunner.send({
    conversationId: sibling.id,
    model: model.id,
    text: 'Stop while approval is pending.',
    permissionMode: 'approve_for_me',
  });
  await waitFor(() => cancelledRunner.getPendingApprovals(sibling.id).length === 1);
  const cancelledApproval = cancelledRunner.getPendingApprovals(sibling.id)[0];
  cancelledRunner.stop(sibling.id);
  await waitFor(() => !cancelledRunner.runs.has(sibling.id));
  assert.equal(cancelledRunner.getPendingApprovals(sibling.id).length, 0);
  assert.ok(cancelledEvents.some((event) => (
    event.type === 'permission-cancelled'
    && event.conversationId === sibling.id
    && event.approvalId === cancelledApproval.approvalId
  )));
  await assert.rejects(
    () => approveToolCallTool.execute(
      { threadId: sibling.id, approvalId: cancelledApproval.approvalId },
      { chatRunner: cancelledRunner, conversationId: parent.id },
    ),
    /approval was not found for the specified thread/,
  );

  closeDatabase();
  database = null;
  console.log('Thread input status and cross-thread tool approval tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
