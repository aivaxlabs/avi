import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'aivax-plan-test-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;
const legacyStorage = join(resolvedProfile, '.aivax');
mkdirSync(legacyStorage, { recursive: true });
const legacyDatabase = new Database(join(legacyStorage, 'aivax.sqlite'));
legacyDatabase.exec(`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    segments TEXT NOT NULL DEFAULT '[]',
    attachments TEXT NOT NULL DEFAULT '[]',
    continuations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
legacyDatabase.close();

let database;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const {
    closeDatabase,
    createConversation,
    getMessages,
    insertMessage,
  } = database;
  const model = {
    id: 'test:model',
    modelId: 'test-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: [],
    context: { input: 100_000, output: 10_000 },
  };

  function buildRunner(provider, { events = [], mcpManager = null } = {}) {
    return {
      events,
      runner: new ChatRunner({
        registry: {
          resolve: () => ({ model, provider }),
          listModels: () => [model],
        },
        mcpManager,
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

  const planCalls = [];
  let contributionCalls = 0;
  let mcpInitializations = 0;
  const planProvider = {
    getContributions: () => {
      contributionCalls += 1;
      return { tools: [] };
    },
    stream: async (request) => {
      planCalls.push(request);
      request.onEvent({
        type: 'content',
        text: '<execution-plan>Complete plan</execution-plan>',
      });
      return { assistantContent: '', toolCalls: [] };
    },
  };
  const planMcpManager = {
    isWorkspaceReady: () => false,
    ensureWorkspace: async () => {
      mcpInitializations += 1;
      return {
        tools: [{
          name: 'mcp_mutation',
          mcp: true,
          inputSchema: { type: 'object', properties: {} },
          execute: async () => ({}),
        }],
        instructions: [{ from: 'test', text: 'MCP instructions' }],
      };
    },
  };
  const { runner: planRunner } = buildRunner(planProvider, { mcpManager: planMcpManager });
  const planConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await planRunner.send({
    conversationId: planConversation.id,
    model: model.id,
    text: 'Create a plan',
    permissionMode: 'full_access',
    workMode: 'plan',
  });
  await waitFor(() => !planRunner.runs.has(planConversation.id));
  assert.equal(mcpInitializations, 0);
  assert.equal(contributionCalls, 0);
  assert.equal(planCalls[0].invocationContext.workMode, 'plan');
  assert.deepEqual(
    planCalls[0].tools.map((tool) => tool.name).sort(),
    [
      'ask_question',
      'chat_inspect_thread',
      'chat_list_folders',
      'chat_list_threads',
      'read_file',
      'read_terminal_output',
      'read_url',
    ],
  );
  assert.deepEqual(
    getMessages(planConversation.id).map((message) => message.workMode),
    ['plan', 'plan'],
  );

  const mediaPath = join(resolvedProfile, 'pixel.png');
  writeFileSync(mediaPath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ));
  model.capabilities = { images: true, audio: false, pdfFiles: false };
  const mediaCalls = [];
  const mediaProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      mediaCalls.push(request);
      return mediaCalls.length === 1
        ? {
            assistantContent: '',
            toolCalls: [{
              callId: 'read-media',
              name: 'read_media_file',
              argumentsText: JSON.stringify({
                path: mediaPath,
                __invocation_goal: 'Inspect the image.',
                __requires_human_approval: false,
              }),
            }],
          }
        : { assistantContent: 'Image inspected.', toolCalls: [] };
    },
  };
  const { runner: mediaRunner } = buildRunner(mediaProvider);
  const mediaConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await mediaRunner.send({
    conversationId: mediaConversation.id,
    model: model.id,
    text: 'Inspect the image',
    permissionMode: 'full_access',
  });
  await waitFor(() => !mediaRunner.runs.has(mediaConversation.id));
  const exposedMediaTool = mediaCalls[0].tools.find((tool) => tool.name === 'read_media_file');
  assert.match(exposedMediaTool.description, /images/);
  assert.doesNotMatch(exposedMediaTool.description, /audio|PDF/);
  assert.equal(mediaCalls[1].toolHistory[0].results[0].mediaContent[0].type, 'image_url');
  assert.match(
    mediaCalls[1].toolHistory[0].results[0].mediaContent[0].image_url.url,
    /^data:image\/png;base64,/,
  );

  const readMediaFile = CLIENT_TOOLS.find((tool) => tool.name === 'read_media_file');
  const textPath = join(resolvedProfile, 'notes.txt');
  writeFileSync(textPath, 'text is not media');
  await assert.rejects(
    readMediaFile.execute({ path: textPath }, { capabilities: model.capabilities }),
    /does not read text files/,
  );

  model.capabilities = { images: false, audio: false, pdfFiles: false };
  const noMediaCalls = [];
  const noMediaProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      noMediaCalls.push(request);
      return { assistantContent: '', toolCalls: [] };
    },
  };
  const { runner: noMediaRunner } = buildRunner(noMediaProvider);
  const noMediaConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await noMediaRunner.send({
    conversationId: noMediaConversation.id,
    model: model.id,
    text: 'No media capability',
  });
  await waitFor(() => !noMediaRunner.runs.has(noMediaConversation.id));
  assert.equal(noMediaCalls[0].tools.some((tool) => tool.name === 'read_media_file'), false);

  const restoredConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  const restoredMessage = insertMessage({
    conversationId: restoredConversation.id,
    role: 'user',
    model: model.id,
    permissionMode: 'full_access',
    workMode: 'plan',
    status: 'queued',
    content: 'Restore this queued plan',
  });
  const { runner: restoredRunner } = buildRunner(planProvider);
  assert.deepEqual(restoredRunner.getQueuedItems(restoredConversation.id, model.id), [{
    userMessageId: restoredMessage.id,
    model: model.id,
    reasoningEffort: null,
    permissionMode: 'full_access',
    workMode: 'plan',
    ultraMode: false,
    queuePriority: false,
  }]);

  let finishQueuedRun;
  const queuedCalls = [];
  const queuedProvider = {
    getContributions: () => ({ tools: [] }),
    stream: (request) => {
      queuedCalls.push(request);
      if (queuedCalls.length === 1) {
        return new Promise((resolveStream) => {
          finishQueuedRun = () => resolveStream({ assistantContent: '', toolCalls: [] });
        });
      }
      return Promise.resolve({ assistantContent: '', toolCalls: [] });
    },
  };
  const { runner: queuedRunner } = buildRunner(queuedProvider);
  const queuedConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await queuedRunner.send({
    conversationId: queuedConversation.id,
    model: model.id,
    text: 'First run',
  });
  await waitFor(() => queuedCalls.length === 1);
  const queuedResult = await queuedRunner.send({
    conversationId: queuedConversation.id,
    model: model.id,
    text: 'Queued plan',
    workMode: 'plan',
  });
  assert.equal(queuedResult.message.workMode, 'plan');
  assert.equal(queuedRunner.runs.get(queuedConversation.id).queue[0].workMode, 'plan');
  finishQueuedRun();
  await waitFor(() => queuedCalls.length === 2);
  await waitFor(() => !queuedRunner.runs.has(queuedConversation.id));
  assert.equal(queuedCalls[1].invocationContext.workMode, 'plan');

  let finishSteeredRun;
  const steeredCalls = [];
  const steeredProvider = {
    getContributions: () => ({ tools: [] }),
    stream: (request) => {
      steeredCalls.push(request);
      if (steeredCalls.length === 1) {
        return new Promise((resolveStream) => {
          finishSteeredRun = () => resolveStream({ assistantContent: '', toolCalls: [] });
        });
      }
      return Promise.resolve({ assistantContent: '', toolCalls: [] });
    },
  };
  const { runner: steeredRunner } = buildRunner(steeredProvider);
  const steeredConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await steeredRunner.send({
    conversationId: steeredConversation.id,
    model: model.id,
    text: 'First run',
  });
  await waitFor(() => steeredCalls.length === 1);
  const steeredResult = await steeredRunner.send({
    conversationId: steeredConversation.id,
    model: model.id,
    text: 'Steered plan',
    steer: true,
    workMode: 'plan',
  });
  assert.equal(steeredResult.message.workMode, 'plan');
  finishSteeredRun();
  await waitFor(() => steeredCalls.length === 2);
  await waitFor(() => !steeredRunner.runs.has(steeredConversation.id));
  assert.equal(steeredCalls[1].invocationContext.workMode, 'plan');

  const retryCalls = [];
  const retryProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async (request) => {
      retryCalls.push(request);
      return { assistantContent: '', toolCalls: [] };
    },
  };
  const { runner: retryRunner } = buildRunner(retryProvider);
  const retryConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await retryRunner.send({
    conversationId: retryConversation.id,
    model: model.id,
    text: 'Retry this plan',
    workMode: 'plan',
  });
  await waitFor(() => !retryRunner.runs.has(retryConversation.id));
  const retryAssistant = getMessages(retryConversation.id)
    .find((message) => message.role === 'assistant');
  await retryRunner.retry({
    conversationId: retryConversation.id,
    model: model.id,
    assistantMessageId: retryAssistant.id,
  });
  await waitFor(() => retryCalls.length === 2);
  await waitFor(() => !retryRunner.runs.has(retryConversation.id));
  assert.equal(retryCalls[1].invocationContext.workMode, 'plan');
  assert.equal(
    getMessages(retryConversation.id).findLast((message) => message.role === 'assistant').workMode,
    'plan',
  );

  let inventedToolRound = 0;
  const inventedToolProvider = {
    getContributions: () => ({
      tools: [{
        name: 'run_in_terminal',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          throw new Error('Forbidden tool executed.');
        },
      }],
    }),
    stream: async () => {
      inventedToolRound += 1;
      return inventedToolRound === 1
        ? {
            assistantContent: '',
            toolCalls: [{
              callId: 'invented-tool',
              name: 'run_in_terminal',
              argumentsText: JSON.stringify({
                __invocation_goal: 'Attempt a mutation.',
                __requires_human_approval: false,
              }),
            }],
          }
        : { assistantContent: '', toolCalls: [] };
    },
  };
  const { runner: inventedToolRunner } = buildRunner(inventedToolProvider);
  const inventedToolConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await inventedToolRunner.send({
    conversationId: inventedToolConversation.id,
    model: model.id,
    text: 'Do not run tools',
    permissionMode: 'full_access',
    workMode: 'plan',
  });
  await waitFor(() => !inventedToolRunner.runs.has(inventedToolConversation.id));
  const blockedTool = getMessages(inventedToolConversation.id)
    .find((message) => message.role === 'assistant')
    .segments.find((segment) => segment.type === 'tool-call');
  assert.equal(blockedTool.status, 'error');
  assert.match(blockedTool.resultText, /Unknown client-side tool|not available in Plan mode/);

  const askQuestion = CLIENT_TOOLS.find((tool) => tool.name === 'ask_question');
  await assert.rejects(
    askQuestion.execute({
      questions: [{
        type: 'single_choice',
        question: 'Choose',
      }],
    }, {}),
    /options is required/,
  );
  await assert.rejects(
    askQuestion.execute({ questions: [] }, {}),
    /non-empty array/,
  );

  const invalidQuestionOutputs = [];
  let invalidQuestionRound = 0;
  const invalidQuestionProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ toolHistory }) => {
      invalidQuestionRound += 1;
      if (invalidQuestionRound > 1) {
        invalidQuestionOutputs.push(JSON.parse(toolHistory[0].results[0].output));
        return { assistantContent: '', toolCalls: [] };
      }
      return {
        assistantContent: '',
        toolCalls: [{
          callId: 'invalid-question',
          name: 'ask_question',
          argumentsText: JSON.stringify({
            questions: [{
              type: 'single_choice',
              question: 'Choose',
            }],
            __invocation_goal: 'Ask without valid options.',
            __requires_human_approval: false,
          }),
        }],
      };
    },
  };
  const { runner: invalidQuestionRunner } = buildRunner(invalidQuestionProvider);
  const invalidQuestionConversation = createConversation({
    model: model.id,
    projectPath: process.cwd(),
  });
  await invalidQuestionRunner.send({
    conversationId: invalidQuestionConversation.id,
    model: model.id,
    text: 'Do not invent an answer',
    workMode: 'plan',
  });
  await waitFor(() => !invalidQuestionRunner.runs.has(invalidQuestionConversation.id));
  assert.equal(invalidQuestionOutputs[0].userResponded, false);
  assert.match(invalidQuestionOutputs[0].instruction, /Do not infer an answer/);

  const questionEvents = [];
  const questionResults = [];
  let questionRound = 0;
  const questionProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ toolHistory }) => {
      questionRound += 1;
      if (questionRound > 1) {
        questionResults.push(JSON.parse(toolHistory[0].results[0].output));
        return { assistantContent: '', toolCalls: [] };
      }
      return {
        assistantContent: '',
        toolCalls: [{
          callId: 'ask-question',
          name: 'ask_question',
          argumentsText: JSON.stringify({
            questions: [
              {
                type: 'single_choice',
                question: 'Qual período deseja consultar?',
                options: ['Últimos 30 dias', 'Últimos 90 dias', 'Ano atual'],
              },
              {
                type: 'multiple_choice',
                question: 'Quais situações devem ser incluídas?',
                options: ['Pendentes', 'Pagas', 'Vencidas'],
              },
              {
                type: 'free_text',
                question: 'Informe a placa ou o nome da frota.',
                options: ['ABC-1234'],
              },
            ],
            __invocation_goal: 'Clarify the execution plan.',
            __requires_human_approval: true,
          }),
        }],
      };
    },
  };
  const { runner: questionRunner } = buildRunner(questionProvider, { events: questionEvents });
  const questionConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await questionRunner.send({
    conversationId: questionConversation.id,
    model: model.id,
    text: 'Ask before continuing',
    workMode: 'plan',
  });
  await waitFor(() => questionEvents.some((event) => event.type === 'question-request'));
  const questionRequest = questionEvents.find((event) => event.type === 'question-request');
  assert.equal(questionRunner.runs.get(questionConversation.id).phase, 'question');
  assert.equal(Object.hasOwn(questionRequest.questions[2], 'options'), false);
  assert.equal(questionRunner.answerQuestion({
    questionId: questionRequest.questionId,
    answers: [
      {
        question: 'Qual período deseja consultar?',
        answer: 'Últimos 30 dias',
      },
      {
        question: 'Quais situações devem ser incluídas?',
        answer: ['Pendentes', 'Vencidas'],
      },
      {
        question: 'Informe a placa ou o nome da frota.',
        answer: 'ABC-1234',
      },
    ],
  }), true);
  await waitFor(() => !questionRunner.runs.has(questionConversation.id));
  assert.deepEqual(questionResults[0], {
    cancelled: false,
    answers: [
      {
        question: 'Qual período deseja consultar?',
        answer: 'Últimos 30 dias',
      },
      {
        question: 'Quais situações devem ser incluídas?',
        answer: ['Pendentes', 'Vencidas'],
      },
      {
        question: 'Informe a placa ou o nome da frota.',
        answer: 'ABC-1234',
      },
    ],
  });
  assert.equal(
    getMessages(questionConversation.id)
      .filter((message) => message.role === 'assistant').length,
    1,
  );

  const cancelledEvents = [];
  const cancelledResults = [];
  let cancelledRound = 0;
  const cancelledProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async ({ toolHistory }) => {
      cancelledRound += 1;
      if (cancelledRound > 1) {
        cancelledResults.push(JSON.parse(toolHistory[0].results[0].output));
        return { assistantContent: '', toolCalls: [] };
      }
      return {
        assistantContent: '',
        toolCalls: [{
          callId: 'cancel-question',
          name: 'ask_question',
          argumentsText: JSON.stringify({
            questions: [{
              type: 'free_text',
              question: 'Optional detail?',
            }],
            __invocation_goal: 'Ask an optional detail.',
            __requires_human_approval: false,
          }),
        }],
      };
    },
  };
  const { runner: cancelledRunner } = buildRunner(cancelledProvider, { events: cancelledEvents });
  const cancelledConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await cancelledRunner.send({
    conversationId: cancelledConversation.id,
    model: model.id,
    text: 'Cancel the question',
  });
  await waitFor(() => cancelledEvents.some((event) => event.type === 'question-request'));
  const cancelledRequest = cancelledEvents.find((event) => event.type === 'question-request');
  assert.equal(cancelledRunner.answerQuestion({
    questionId: cancelledRequest.questionId,
    cancelled: true,
  }), true);
  await waitFor(() => !cancelledRunner.runs.has(cancelledConversation.id));
  assert.deepEqual(cancelledResults[0], {
    cancelled: true,
    answers: [],
  });
  assert.ok(cancelledEvents.some((event) => (
    event.type === 'question-cancelled'
    && event.questionId === cancelledRequest.questionId
  )));

  const abortedEvents = [];
  let abortedRound = 0;
  const abortedProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async () => {
      abortedRound += 1;
      return {
        assistantContent: '',
        toolCalls: [{
          callId: `abort-question-${abortedRound}`,
          name: 'ask_question',
          argumentsText: JSON.stringify({
            questions: [{
              type: 'free_text',
              question: 'Wait here?',
            }],
            __invocation_goal: 'Wait for the user.',
            __requires_human_approval: false,
          }),
        }],
      };
    },
  };
  const { runner: abortedRunner } = buildRunner(abortedProvider, { events: abortedEvents });
  const abortedConversation = createConversation({ model: model.id, projectPath: process.cwd() });
  await abortedRunner.send({
    conversationId: abortedConversation.id,
    model: model.id,
    text: 'Stop while waiting',
  });
  await waitFor(() => abortedEvents.some((event) => event.type === 'question-request'));
  const abortedRequest = abortedEvents.find((event) => event.type === 'question-request');
  await abortedRunner.shutdown();
  assert.equal(abortedRunner.runs.has(abortedConversation.id), false);
  assert.ok(abortedEvents.some((event) => (
    event.type === 'question-cancelled'
    && event.questionId === abortedRequest.questionId
  )));
  assert.equal(abortedRunner.pendingQuestions.size, 0);

  closeDatabase();
  database = null;
  console.log('Plan mode tests passed.');
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
