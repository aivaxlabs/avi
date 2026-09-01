import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIENT_TOOLS, decorateToolsForInvocation } from '../src/main/client-tools.js';
import { registerPluginTool } from '../src/main/plugin-domain-api.js';
import { QuickChatRunner } from '../src/main/quick-chat-runner.js';
import {
  limitToolHistoryResults,
  toolOutputLimitForTool,
} from '../src/main/tool-output.js';

const memorySearchTool = CLIENT_TOOLS.find((tool) => tool.name === 'memory_search');
assert.equal(memorySearchTool.forcedTruncationLength, 5_000);
assert.equal(toolOutputLimitForTool(memorySearchTool, 8_192), 20_000);
assert.equal(toolOutputLimitForTool(memorySearchTool, null), 20_000);
const limitedMemoryHistory = limitToolHistoryResults([{
  toolCalls: [{ callId: 'memory-search-call', name: 'memory_search' }],
  results: [{ callId: 'memory-search-call', output: 'm'.repeat(20_001) }],
}], CLIENT_TOOLS, 8_192);
assert.match(limitedMemoryHistory[0].results[0].output, /\[\.\.\. 1 chars truncated,/);
assert.throws(() => decorateToolsForInvocation([{
  name: 'invalid_limit',
  description: 'Invalid limit.',
  inputSchema: { type: 'object', properties: {} },
  forcedTruncationLength: 0,
}]), /forcedTruncationLength must be a positive integer/);
const pluginToolRuntime = {
  tools: new Map(),
  services: { reservedToolNames: new Set() },
  assertActive() {},
  track(_record, disposable) { return disposable; },
};
const pluginToolRecord = { id: 'test-plugin' };
registerPluginTool({
  runtime: pluginToolRuntime,
  record: pluginToolRecord,
  tool: {
    name: 'plugin_limit',
    description: 'Plugin limit.',
    inputSchema: { type: 'object', properties: {} },
    forcedTruncationLength: 750,
    execute: async () => 'ok',
  },
  storage: {},
});
assert.equal(pluginToolRuntime.tools.get('*\0plugin_limit').tool.forcedTruncationLength, 750);
assert.throws(() => registerPluginTool({
  runtime: pluginToolRuntime,
  record: pluginToolRecord,
  tool: {
    name: 'invalid_plugin_limit',
    description: 'Invalid plugin limit.',
    inputSchema: { type: 'object', properties: {} },
    forcedTruncationLength: 0,
    execute: async () => 'ok',
  },
  storage: {},
}), /forcedTruncationLength must be a positive integer/);

const model = {
  id: 'test:quick',
  modelId: 'quick',
  providerId: 'test',
  providerName: 'Test',
  interface: 'test',
  reasoning: [],
  capabilities: {},
  context: { input: 8192, output: 2048 },
};
const events = [];
const provider = {
  getContributions: () => ({ tools: [] }),
  stream: async ({ onEvent, invocationContext, messages }) => {
    assert.equal(invocationContext.quickChat, true);
    assert.equal(invocationContext.workspacePath.length > 0, true);
    assert.equal(messages.at(-1).content, 'Hello');
    onEvent({ type: 'content', text: 'Hi' });
    return { assistantContent: 'Hi', continuation: [], toolCalls: [] };
  },
};
const preferences = {
  defaultModels: { quickChat: { modelId: model.id, reasoningEffort: null } },
  tuning: { toolOutputLimit: 2048 },
};
const runner = new QuickChatRunner({
  registry: {
    listModels: () => [model],
    resolve: (id) => id === model.id ? { model, provider } : null,
  },
  mcpManager: { ensureWorkspace: async () => ({ tools: [], instructions: [] }) },
  chatRunner: {},
  getPreferences: () => preferences,
  sendEvent: (sessionId, event) => events.push({ sessionId, ...event }),
  stopBackgroundTasks: () => {},
});

const session = runner.createSession();
assert.equal(session.model, model.id);
assert.deepEqual(session.messages, []);
await runner.send({ sessionId: session.id, text: 'Hello', attachments: [], model: model.id });
while (runner.state(session.id).running) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
const completed = runner.state(session.id);
assert.equal(completed.messages.length, 2);
assert.equal(completed.messages[0].content, 'Hello');
assert.equal(completed.messages[1].content, 'Hi');
assert.equal(completed.messages[1].status, 'completed');
assert.equal(events.some((event) => event.type === 'run-state' && event.running), true);
assert.equal(events.some((event) => event.type === 'run-state' && !event.running), true);
runner.close(session.id);
assert.throws(() => runner.state(session.id), /no longer available/);

let tasksRound = 0;
let tasksOutput = null;
provider.stream = async ({ toolHistory, onEvent }) => {
  tasksRound += 1;
  if (tasksRound === 1) {
    const toolCall = {
      key: 'tasks-tool',
      callId: 'tasks-call',
      name: 'update_tasks',
      argumentsText: JSON.stringify({
        __invocation_goal: 'Track Quick Chat progress.',
        __requires_human_approval: false,
        tasks: [{
          title: 'Verify text output',
          description: 'Confirm lifecycle tools return plain text.',
          done: false,
          result: null,
        }],
      }),
    };
    onEvent({ type: 'tool-call', ...toolCall });
    return { assistantContent: '', continuation: [], toolCalls: [toolCall] };
  }
  tasksOutput = toolHistory[0].results[0].output;
  return { assistantContent: 'Tasks updated.', continuation: [], toolCalls: [] };
};
const tasksSession = runner.createSession();
await runner.send({
  sessionId: tasksSession.id,
  text: 'Track this task.',
  attachments: [],
  model: model.id,
});
while (runner.state(tasksSession.id).running) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
assert.equal(tasksOutput, 'Task list updated: 1 task(s).');
assert.equal(typeof tasksOutput, 'string');
runner.close(tasksSession.id);

let jsonRound = 0;
let jsonOutput = null;
provider.getContributions = () => ({
  tools: [{
    name: 'formatted_json',
    description: 'Return formatted JSON text.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => '{\n  "weather": "sunny",\n  "temperature": 28\n}',
  }],
});
provider.stream = async ({ toolHistory, onEvent }) => {
  jsonRound += 1;
  if (jsonRound === 1) {
    const toolCall = {
      key: 'formatted-json-tool',
      callId: 'formatted-json-call',
      name: 'formatted_json',
      argumentsText: JSON.stringify({
        __invocation_goal: 'Verify JSON tool output minification.',
        __requires_human_approval: false,
      }),
    };
    onEvent({ type: 'tool-call', ...toolCall });
    return { assistantContent: '', continuation: [], toolCalls: [toolCall] };
  }
  jsonOutput = toolHistory[0].results[0].output;
  return { assistantContent: 'JSON minified.', continuation: [], toolCalls: [] };
};
const jsonSession = runner.createSession();
await runner.send({
  sessionId: jsonSession.id,
  text: 'Return formatted JSON.',
  attachments: [],
  model: model.id,
});
while (runner.state(jsonSession.id).running) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
assert.equal(jsonOutput, '{"weather":"sunny","temperature":28}');
runner.close(jsonSession.id);

const longOutput = `${'a'.repeat(1024)}${'b'.repeat(1024)}${'c'.repeat(1024)}`;
let truncationRound = 0;
let truncatedOutput = null;
provider.getContributions = () => ({
  tools: [{
    name: 'long_output',
    description: 'Return output longer than the configured limit.',
    forcedTruncationLength: 640,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => longOutput,
  }],
});
provider.stream = async ({ toolHistory, onEvent }) => {
  truncationRound += 1;
  if (truncationRound === 1) {
    const toolCall = {
      key: 'long-output-tool',
      callId: 'long-output-call',
      name: 'long_output',
      argumentsText: JSON.stringify({
        __invocation_goal: 'Verify Quick Chat output truncation.',
        __requires_human_approval: false,
      }),
    };
    onEvent({ type: 'tool-call', ...toolCall });
    return { assistantContent: '', continuation: [], toolCalls: [toolCall] };
  }
  truncatedOutput = toolHistory[0].results[0].output;
  return { assistantContent: 'Output truncated.', continuation: [], toolCalls: [] };
};
const truncationSession = runner.createSession();
await runner.send({
  sessionId: truncationSession.id,
  text: 'Return a long output.',
  attachments: [],
  model: model.id,
});
while (runner.state(truncationSession.id).running) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
const truncationMatch = /^([\s\S]*)\n\n\[\.\.\. (\d+) chars truncated, (\d+) lines total, full result available at (.+)\]\n\n([\s\S]*)$/.exec(truncatedOutput);
assert.ok(truncationMatch);
assert.equal(truncationMatch[1], 'a'.repeat(640));
assert.equal(Number(truncationMatch[2]), 512);
assert.equal(Number(truncationMatch[3]), 1);
assert.equal(truncationMatch[5], `${'b'.repeat(896)}${'c'.repeat(1024)}`);
assert.equal(readFileSync(truncationMatch[4], 'utf8'), longOutput);
runner.close(truncationSession.id);

const generatedAttachment = {
  id: 'generated-image-1',
  kind: 'image_url',
  source: 'generated_image',
  name: 'kitten.png',
  path: 'C:\\Temp\\kitten.png',
  dataUrl: 'data:image/png;base64,a2l0dGVu',
};
let imageRound = 0;
provider.getContributions = () => ({
  tools: [{
    name: 'openai_subscription_generate_or_edit_image',
    description: 'Generate an image.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    execute: async (input) => {
      assert.deepEqual(input.referenced_image_paths, [generatedAttachment.path]);
      return {
        output: `Image generated.\nSaved to: ${generatedAttachment.path}`,
        mediaContent: [{ type: 'image_url', image_url: { url: generatedAttachment.dataUrl } }],
        attachments: [generatedAttachment, generatedAttachment],
      };
    },
  }],
});
provider.stream = async ({ onEvent }) => {
  imageRound += 1;
  if (imageRound === 1) {
    const toolCall = {
      key: 'image-tool',
      callId: 'image-call',
      name: 'openai_subscription_generate_or_edit_image',
      argumentsText: JSON.stringify({
        __invocation_goal: 'Generate a kitten image.',
        __requires_human_approval: false,
        prompt: 'A cute kitten.',
        referenced_image_paths: [generatedAttachment.path],
      }),
    };
    onEvent({ type: 'tool-call', ...toolCall });
    return { assistantContent: '', continuation: [], toolCalls: [toolCall] };
  }
  onEvent({ type: 'content', text: 'Here is the kitten.' });
  return { assistantContent: 'Here is the kitten.', continuation: [], toolCalls: [] };
};

const imageSession = runner.createSession();
imageSession.messages.push(runner.createMessage({
  role: 'assistant',
  model: model.id,
  content: 'Previous image.',
  attachments: [generatedAttachment],
  status: 'completed',
}));
await runner.send({
  sessionId: imageSession.id,
  text: 'Generate a kitten.',
  attachments: [],
  model: model.id,
});
while (runner.state(imageSession.id).running) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
const imageMessage = runner.state(imageSession.id).messages.at(-1);
assert.deepEqual(imageMessage.attachments, [generatedAttachment]);
assert.equal(imageMessage.status, 'completed');
assert.equal(events.some((event) => (
  event.sessionId === imageSession.id
  && event.type === 'message'
  && event.message.status === 'completed'
  && event.message.attachments?.[0]?.id === generatedAttachment.id
)), true);
runner.close(imageSession.id);

preferences.defaultModels.quickChat = null;
assert.throws(() => runner.createSession(), /Choose a Quick chat model/);

console.log('Quick chat tests passed.');
process.exit(0);
