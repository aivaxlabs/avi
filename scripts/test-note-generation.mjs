import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const now = new Date();
const pad = (value) => String(value).padStart(2, '0');
const offsetMinutes = -now.getTimezoneOffset();
const timezone = `UTC${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}${pad(Math.abs(offsetMinutes) % 60)}`;
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${timezone}`;
const visualizationRoot = join(tmpdir(), '.avi', 'visualizations', stamp, 'note-generation');
mkdirSync(visualizationRoot, { recursive: true });
const testProfile = mkdtempSync(join(visualizationRoot, 'home-'));
const resolvedTemp = resolve(tmpdir());
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolvedTemp));
process.env.USERPROFILE = resolvedProfile;

let database;
let failed = false;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const {
    closeDatabase,
    createConversation,
    getConversation,
    getMessages,
    insertMessage,
    listInferenceUsage,
    notesStore,
  } = database;

  const auxiliaryModel = {
    id: 'test:auxiliary',
    modelId: 'auxiliary-model',
    providerName: 'Test',
    interface: 'responses',
    reasoning: ['high'],
    capabilities: {},
    context: { input: 100_000, output: 10_000 },
  };

  const scriptedTurns = [];
  const auxiliaryCalls = [];
  const auxiliaryProvider = {
    stream: async (request) => {
      auxiliaryCalls.push(request);
      const turn = scriptedTurns.shift();
      if (!turn) throw new Error('No scripted auxiliary turn available.');
      if (turn.usage) {
        request.onEvent({ type: 'usage', usage: turn.usage });
      }
      return {
        assistantContent: turn.content ?? '',
        toolCalls: turn.toolCalls ?? [],
      };
    },
  };

  function buildRunner({ resolveSelection, auxiliary } = {}) {
    return new ChatRunner({
      registry: {
        resolve: () => (resolveSelection === undefined
          ? { model: auxiliaryModel, provider: auxiliaryProvider }
          : resolveSelection),
        listModels: () => [auxiliaryModel],
      },
      getPreferences: () => ({
        defaultModels: {
          auxiliary: auxiliary === undefined
            ? { modelId: auxiliaryModel.id, reasoningEffort: 'high' }
            : auxiliary,
        },
        tuning: {},
      }),
      sendEvent: () => {},
    });
  }

  const runner = buildRunner();

  // Scenario A: existing list chosen, context request, usage request, no chat mutation.
  const workspace = join(resolvedProfile, 'project-alpha');
  mkdirSync(workspace, { recursive: true });
  const conversation = createConversation({
    model: auxiliaryModel.id,
    projectPath: workspace,
  });
  const workList = notesStore.saveList({ name: 'Work', folderPath: workspace });
  const elsewhereFolder = join(resolvedProfile, 'elsewhere');
  notesStore.saveList({ name: 'Other folder', folderPath: elsewhereFolder });

  for (let index = 0; index < 10; index += 1) {
    insertMessage({
      conversationId: conversation.id,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 0 ? 'This old message must be excluded.' : `Recent context ${index}`,
    });
  }
  insertMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Hidden internal instruction.',
    hidden: true,
  });
  insertMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Queued instruction.',
    status: 'queued',
  });

  const messagesBefore = getMessages(conversation.id);
  const conversationBefore = getConversation(conversation.id);
  const sourcePrompt = '  Create a note about the release review  ';
  scriptedTurns.push({
    usage: { inputTokens: 11, outputTokens: 12 },
    content: JSON.stringify({
      title: 'Review the release notes',
      description: 'Describe the review work discussed in the conversation.',
      listId: workList.id,
      priority: 'high',
      dueAt: '2026-03-01T12:00:00.000Z',
      subtasks: [{ text: 'Collect feedback', done: true }],
    }),
  });

  const note = await runner.createNote({ conversationId: conversation.id, prompt: sourcePrompt });

  assert.equal(note.title, 'Review the release notes');
  assert.equal(note.description, 'Describe the review work discussed in the conversation.');
  assert.equal(note.listId, workList.id);
  assert.equal(note.priority, 'high');
  assert.equal(note.dueAt, '2026-03-01T12:00:00.000Z');
  assert.equal(note.done, false);
  assert.equal(note.archived, false);
  assert.deepEqual(
    note.subtasks.map(({ text, done }) => ({ text, done })),
    [{ text: 'Collect feedback', done: false }],
  );
  assert.deepEqual(getMessages(conversation.id), messagesBefore);
  assert.deepEqual(getConversation(conversation.id), conversationBefore);

  assert.equal(auxiliaryCalls.length, 1);
  assert.equal(auxiliaryCalls[0].model.id, auxiliaryModel.id);
  assert.equal(auxiliaryCalls[0].reasoningEffort, 'high');
  assert.deepEqual(auxiliaryCalls[0].invocationContext, { auxiliary: true });
  assert.deepEqual(auxiliaryCalls[0].tools, []);
  assert.deepEqual(auxiliaryCalls[0].toolHistory, []);
  assert.equal(auxiliaryCalls[0].signal instanceof AbortSignal, true);
  assert.equal(auxiliaryCalls[0].messages.length, 10);
  assert.equal(auxiliaryCalls[0].messages[0].role, 'system');
  assert.match(auxiliaryCalls[0].messages[0].content, /Create one user note from the final user message/);
  assert.match(auxiliaryCalls[0].messages[0].content, /Choose the best existing listId/);
  assert.match(auxiliaryCalls[0].messages[0].content, /Do not call tools/);
  assert.ok(auxiliaryCalls[0].messages[0].content.includes(`Working folder: ${workspace}`));
  assert.ok(auxiliaryCalls[0].messages[0].content.includes(JSON.stringify([{ id: workList.id, name: 'Work' }])));
  assert.ok(!auxiliaryCalls[0].messages[0].content.includes('Other folder'));
  assert.equal(auxiliaryCalls[0].messages.at(-1).role, 'user');
  assert.equal(auxiliaryCalls[0].messages.at(-1).content, sourcePrompt);
  const snapshot = auxiliaryCalls[0].messages.slice(1, -1);
  assert.deepEqual(
    snapshot.map(({ role, content }) => ({ role, content })),
    Array.from({ length: 8 }, (_, position) => ({
      role: position % 2 === 0 ? 'user' : 'assistant',
      content: `Recent context ${position + 2}`,
    })),
  );
  assert.ok(!auxiliaryCalls[0].messages.some((message) => (
    String(message.content).includes('This old message must be excluded.')
    || String(message.content).includes('Hidden internal instruction.')
    || String(message.content).includes('Queued instruction.')
  )));

  assert.deepEqual(
    listInferenceUsage('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
      .map(({ type, model, projectPath, usage }) => ({ type, model, projectPath, usage })),
    [
      {
        type: 'auxiliary',
        model: auxiliaryModel.id,
        projectPath: resolve(workspace),
        usage: { inputTokens: 11, outputTokens: 12 },
      },
    ],
  );

  // Scenario B: new list created in the requested folder when no conversation is given.
  const inboxFolder = join(resolvedProfile, 'project-beta');
  mkdirSync(inboxFolder, { recursive: true });
  scriptedTurns.push({
    usage: { inputTokens: 21, outputTokens: 22 },
    content: JSON.stringify({
      title: 'Buy milk',
      description: 'Groceries for the week.',
      listId: null,
      listName: 'Inbox',
      priority: 'none',
      dueAt: null,
      subtasks: [],
    }),
  });
  const folderPrompt = 'Remember to buy milk.';
  const folderNote = await runner.createNote({ folderPath: inboxFolder, prompt: folderPrompt });
  assert.equal(folderNote.title, 'Buy milk');
  assert.equal(folderNote.description, 'Groceries for the week.');
  assert.equal(auxiliaryCalls.length, 2);
  assert.equal(auxiliaryCalls[1].messages.at(-1).content, folderPrompt);
  assert.ok(auxiliaryCalls[1].messages[0].content.includes(`Working folder: ${inboxFolder}`));
  assert.ok(auxiliaryCalls[1].messages[0].content.includes(JSON.stringify([])));
  const inboxLists = notesStore.lists({ folderPath: inboxFolder });
  assert.equal(inboxLists.length, 1);
  assert.equal(inboxLists[0].name, 'Inbox');
  assert.equal(inboxLists[0].folderPath, inboxFolder);
  assert.equal(folderNote.listId, inboxLists[0].id);
  assert.deepEqual(
    listInferenceUsage('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')
      .map(({ type, projectPath, usage }) => ({ type, projectPath, usage })),
    [
      { type: 'auxiliary', projectPath: resolve(workspace), usage: { inputTokens: 11, outputTokens: 12 } },
      { type: 'auxiliary', projectPath: resolve(inboxFolder), usage: { inputTokens: 21, outputTokens: 22 } },
    ],
  );

  // Scenario C: failures persist neither notes nor lists.
  const listsBefore = notesStore.lists({ archived: null });
  const notesBefore = notesStore.search({ archived: null });
  const rejectedCreateNote = (turn, options, matcher) => {
    scriptedTurns.push(turn);
    return assert.rejects(runner.createNote(options), matcher);
  };

  await rejectedCreateNote(
    { content: JSON.stringify({ title: 'X', description: '', listId: 'no-such-list', priority: 'low', dueAt: null, subtasks: [] }) },
    { conversationId: conversation.id, prompt: 'Create a note.' },
    /The auxiliary model selected an unavailable list\./,
  );
  await rejectedCreateNote(
    { content: JSON.stringify({ title: 'X', description: '', listId: null, listName: 'Must Not Exist 1', priority: 'critical', dueAt: null, subtasks: [] }) },
    { folderPath: inboxFolder, prompt: 'Create a note.' },
    /Invalid priority\./,
  );
  await rejectedCreateNote(
    { content: JSON.stringify({ title: 'X', description: '', listId: null, listName: 'Must Not Exist 2', priority: 'low', dueAt: 'not-a-date', subtasks: [] }) },
    { folderPath: inboxFolder, prompt: 'Create a note.' },
    /Invalid due date\./,
  );
  await rejectedCreateNote(
    { content: JSON.stringify({ title: '   ', description: '', listId: null, listName: 'Must Not Exist 3', priority: 'low', dueAt: null, subtasks: [] }) },
    { folderPath: inboxFolder, prompt: 'Create a note.' },
    /Invalid title\./,
  );
  await rejectedCreateNote(
    { content: JSON.stringify({ title: 'X', description: '', listId: null, listName: 'Must Not Exist 4', priority: 'low', dueAt: null, subtasks: [{ text: 'Ok' }, { text: '   ' }] }) },
    { folderPath: inboxFolder, prompt: 'Create a note.' },
    /Invalid subtask text\./,
  );
  await rejectedCreateNote(
    { content: 'definitely not json {' },
    { folderPath: inboxFolder, prompt: 'Create a note.' },
    SyntaxError,
  );
  await rejectedCreateNote(
    { content: '["not an object"]' },
    { folderPath: inboxFolder, prompt: 'Create a note.' },
    /The auxiliary model returned an invalid note\./,
  );
  await rejectedCreateNote(
    {
      content: JSON.stringify({ title: 'X', description: '', listId: workList.id, priority: 'low', dueAt: null, subtasks: [] }),
      toolCalls: [{ callId: 'call-1', name: 'note_create', argumentsText: '{}' }],
    },
    { conversationId: conversation.id, prompt: 'Create a note.' },
    /The auxiliary model attempted to call a tool\./,
  );

  await assert.rejects(
    runner.createNote({ prompt: '   ' }),
    /Write a note first \(up to 200,000 characters\)\./,
  );
  await assert.rejects(
    runner.createNote({ prompt: 'x'.repeat(200_001) }),
    /Write a note first \(up to 200,000 characters\)\./,
  );
  await assert.rejects(
    runner.createNote({ conversationId: 'missing', prompt: 'Create a note.' }),
    /Conversation not found\./,
  );
  await assert.rejects(
    buildRunner({ resolveSelection: null }).createNote({ prompt: 'Create a note.' }),
    /The configured auxiliary model is unavailable\./,
  );
  await assert.rejects(
    buildRunner({ auxiliary: null }).createNote({ prompt: 'Create a note.' }),
    /Configure an auxiliary model to create notes\./,
  );

  assert.deepEqual(notesStore.lists({ archived: null }), listsBefore);
  const notesAfter = notesStore.search({ archived: null });
  assert.equal(notesAfter.total, notesBefore.total);
  assert.deepEqual(notesAfter.notes, notesBefore.notes);

  // CLIENT_TOOLS note create/edit/search/list and Plan gating.
  const clientTool = (name) => CLIENT_TOOLS.find((item) => item.name === name);
  assert.ok(clientTool('note_lists'));
  assert.ok(clientTool('note_create'));
  assert.ok(clientTool('note_edit'));
  assert.ok(clientTool('note_search'));

  assert.deepEqual(
    (await clientTool('note_lists').execute({})).map((list) => list.name).sort(),
    ['Inbox', 'Other folder', 'Work'],
  );
  assert.deepEqual(
    (await clientTool('note_lists').execute({ folderPath: workspace })).map((list) => list.name),
    ['Work'],
  );
  const planLists = await clientTool('note_lists').execute({}, { workMode: 'plan' });
  assert.equal(planLists.length, 3);

  const created = await clientTool('note_create').execute(
    { title: 'Tool created note', listId: workList.id, description: 'From CLIENT_TOOLS.', priority: 'urgent' },
    { workMode: 'default' },
  );
  assert.equal(created.title, 'Tool created note');
  assert.equal(created.listId, workList.id);
  assert.equal(created.priority, 'urgent');
  assert.equal(created.done, false);

  const workNoteBeforePlan = notesStore.get(created.id);
  await assert.rejects(
    clientTool('note_create').execute(
      { title: 'Plan note', listId: workList.id, description: 'Blocked.' },
      { workMode: 'plan' },
    ),
    /note_create is unavailable in Plan mode\./,
  );
  await assert.rejects(
    clientTool('note_edit').execute({ id: created.id, title: 'Plan edit' }, { workMode: 'plan' }),
    /note_edit is unavailable in Plan mode\./,
  );
  assert.deepEqual(notesStore.get(created.id), workNoteBeforePlan);
  assert.equal(notesStore.search({ archived: null }).total, notesAfter.total + 1);

  const edited = await clientTool('note_edit').execute(
    { id: created.id, title: 'Edited note', done: true, subtasks: [{ text: 'Step one', done: true }] },
    { workMode: 'default' },
  );
  assert.equal(edited.title, 'Edited note');
  assert.equal(edited.done, true);
  assert.deepEqual(
    edited.subtasks.map(({ text, done }) => ({ text, done })),
    [{ text: 'Step one', done: true }],
  );

  const searchHit = await clientTool('note_search').execute(
    { query: 'Edited note' },
    { workMode: 'plan' },
  );
  assert.equal(searchHit.total, 1);
  assert.equal(searchHit.notes[0].id, created.id);
  const searchWorkspace = await clientTool('note_search').execute({ folderPath: workspace, query: 'Edited note' });
  assert.equal(searchWorkspace.total, 1);
  assert.equal(searchWorkspace.notes[0].id, created.id);
  const searchElsewhere = await clientTool('note_search').execute({ folderPath: inboxFolder, query: 'Edited note' });
  assert.equal(searchElsewhere.total, 0);

  closeDatabase();
  database = null;
  console.log('Note generation tests passed.');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  database?.closeDatabase?.();
  assert.ok(resolvedProfile.startsWith(resolvedTemp));
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
