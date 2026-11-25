import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = resolve(mkdtempSync(join(tmpdir(), 'aivax-specialized-agents-test-')));
assert.ok(testProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = testProfile;
process.env.HOME = testProfile;

const workspace = join(testProfile, 'workspace');
mkdirSync(join(workspace, '.agents', 'agents'), { recursive: true });
writeFileSync(join(workspace, '.agents', 'agents', 'reviewer.md'), [
  '---',
  'name: Review Agent',
  'description: Reviews code',
  'model: reviewer-model',
  'reasoning-effort: xhigh',
  '---',
  'You are a review agent.',
].join('\n'));
writeFileSync(join(workspace, '.agents', 'agents', 'verifier.md'), [
  '---',
  'name: Verifier',
  'description: Verifies findings',
  '---',
  'You verify findings.',
].join('\n'));

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostics())}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
};

let database;
let diagnostics = () => null;
try {
  database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { resolveDynamicContext } = await import('../src/main/context-injection.js');
  const { createConversation, getConversation, getMessages, listSubagents } = database;

  const model = (id, reasoning) => ({
    id,
    modelId: id.split(':')[1],
    name: id,
    providerId: 'test',
    providerName: 'Test',
    interface: 'responses',
    reasoning,
    capabilities: {},
    context: { input: 100_000, output: 1_000 },
  });
  const models = [model('test:main-model', ['low']), model('test:reviewer-model', ['high', 'xhigh'])];
  const requests = [];
  const invoked = new Set();
  const toolCall = (callId, name, input) => ({ callId, name, argumentsText: JSON.stringify({
    __invocation_goal: 'Delegate to a specialized agent',
    __requires_human_approval: false,
    ...input,
  }) });
  const stream = async ({ messages, tools, reasoningEffort, invocationContext }) => {
    const conversation = getConversation(invocationContext.conversationId);
    const system = [
      await resolveDynamicContext(invocationContext),
      ...messages.filter((message) => message.role === 'system').map((message) => message.content),
    ].join('\n');
    const toolNames = tools.map((tool) => tool.name);
    requests.push({ conversation, system, toolNames, reasoningEffort });
    const firstTurn = !invoked.has(conversation.id);
    invoked.add(conversation.id);
    if (conversation.conversationType === 'thread' && firstTurn) {
      return {
        assistantContent: '',
        continuation: [],
        toolCalls: [toolCall('call-root', 'invoke_specialized_agent', { agent: 'Reviewer', prompt: 'Review the change.' })],
      };
    }
    if (conversation.specializedAgent?.id === 'reviewer' && firstTurn) {
      return {
        assistantContent: '',
        continuation: [],
        toolCalls: [toolCall('call-nested', 'invoke_specialized_agent', { agent: 'verifier', prompt: 'Verify it.' })],
      };
    }
    return { assistantContent: `Done by ${conversation.title}`, continuation: [], toolCalls: [] };
  };
  const runner = new ChatRunner({
    registry: {
      resolve: (id) => {
        const selected = models.find((item) => item.id === id);
        return selected ? { model: selected, provider: { getContributions: () => ({ tools: [] }), stream } } : null;
      },
      listModels: () => models,
    },
    getPreferences: () => database.getPreferences(),
    sendEvent: () => {},
  });

  const root = createConversation({ model: 'test:main-model', projectPath: workspace });
  diagnostics = () => ({
    requests: requests.map((request) => ({ title: request.conversation.title, tools: request.toolNames.filter((name) => name.includes('agent')) })),
    messages: getMessages(root.id).map((message) => ({ role: message.role, status: message.status, content: message.content.slice(0, 200), segments: message.segments?.map((segment) => ({ type: segment.type, name: segment.name, result: segment.resultText?.slice(0, 300), message: segment.message })) })),
  });
  await runner.send({
    conversationId: root.id,
    model: 'test:main-model',
    reasoningEffort: 'low',
    permissionMode: 'full_access',
    text: 'Please review.',
  });

  await waitFor(() => listSubagents(root.id).length === 1, 'the specialized agent');
  const reviewer = listSubagents(root.id)[0];
  assert.deepEqual(reviewer.specializedAgent, { id: 'reviewer', name: 'Review Agent' });
  assert.equal(reviewer.model, 'test:reviewer-model');
  assert.ok(reviewer.title.startsWith('Review Agent · '));

  await waitFor(() => listSubagents(reviewer.id).length === 1, 'the nested specialized agent');
  const verifier = listSubagents(reviewer.id)[0];
  assert.equal(verifier.specializedAgent.id, 'verifier');
  assert.equal(verifier.model, 'test:reviewer-model');

  await waitFor(() => (
    getMessages(root.id).some((message) => message.content.includes(`thread_id="${reviewer.id}"`))
    && getMessages(reviewer.id).some((message) => message.content.includes(`thread_id="${verifier.id}"`))
  ), 'the reports');
  await waitFor(() => [root.id, reviewer.id, verifier.id].every((id) => !runner.runs.has(id)), 'idle runs');

  const report = getMessages(root.id).find((message) => message.content.includes(`thread_id="${reviewer.id}"`));
  assert.match(report.content, /specialized_agent="reviewer"/);
  assert.match(report.content, /This is a specialized agent report/);

  const rootRequest = requests.find((request) => request.conversation.id === root.id);
  assert.ok(rootRequest.toolNames.includes('invoke_specialized_agent'));
  assert.ok(rootRequest.system.includes('Specialized agents:'));
  assert.ok(!rootRequest.system.includes('You are a review agent.'));

  const reviewerRequest = requests.find((request) => request.conversation.id === reviewer.id);
  assert.equal(reviewerRequest.reasoningEffort, 'xhigh');
  assert.ok(reviewerRequest.system.includes('You are a review agent.'));
  assert.ok(reviewerRequest.toolNames.includes('chat_spawn_subagent'));
  assert.ok(reviewerRequest.toolNames.includes('invoke_specialized_agent'));

  const verifierRequest = requests.find((request) => request.conversation.id === verifier.id);
  assert.equal(verifierRequest.reasoningEffort, 'xhigh');
  assert.ok(verifierRequest.system.includes('You verify findings.'));

  const plain = database.forkConversation(root.id, { subagent: true, subagentPrompt: 'x' }).conversation;
  assert.equal(database.forkConversation(plain.id, { subagent: true, subagentPrompt: 'y' }), null);

  console.log('Specialized agent runtime passed.');
} finally {
  database?.closeDatabase();
  // Workspace watchers can still hold the temp profile on Windows; leftover temp files are harmless.
  try {
    rmSync(testProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {}
}
process.exit(0);
