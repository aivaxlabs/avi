import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  projectChatEventForClient,
  projectMessageForClient,
} from '../src/main/client-message-projection.js';

const message = {
  id: 'message-1',
  conversationId: 'conversation-1',
  role: 'assistant',
  segments: [{
    id: 'tool-call-1',
    type: 'tool-call',
    name: 'read_file',
    status: 'completed',
    argumentsText: '{"path":"large.txt"}',
    resultText: 'large output',
    mediaContent: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,large' } }],
  }, {
    id: 'content-1',
    type: 'content',
    text: 'Done',
  }],
};

const projected = projectMessageForClient(message);
assert.notEqual(projected, message);
assert.equal(projected.segments[1], message.segments[1]);
assert.deepEqual(projected.segments[0], {
  id: 'tool-call-1',
  type: 'tool-call',
  name: 'read_file',
  status: 'completed',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  detailsAvailable: true,
  hasArguments: true,
  hasResult: true,
  hasMediaContent: true,
});
assert.equal(Object.hasOwn(projected.segments[0], 'argumentsText'), false);
assert.equal(Object.hasOwn(projected.segments[0], 'resultText'), false);
assert.equal(Object.hasOwn(projected.segments[0], 'mediaContent'), false);
assert.equal(message.segments[0].resultText, 'large output');

const pending = projectMessageForClient({
  ...message,
  segments: [{
    id: 'tool-call-2',
    type: 'tool-call',
    name: 'sleep',
    status: 'running',
    argumentsText: '{}',
  }],
});
assert.equal(pending.segments[0].hasResult, false);
assert.equal(pending.segments[0].hasArguments, true);

const event = { type: 'message', conversationId: message.conversationId, message };
const projectedEvent = projectChatEventForClient(event);
assert.notEqual(projectedEvent, event);
assert.equal(projectedEvent.message.segments[0].hasResult, true);
assert.equal(Object.hasOwn(projectedEvent.message.segments[0], 'resultText'), false);
const runEvent = { type: 'run-state', conversationId: message.conversationId, running: false };
assert.equal(projectChatEventForClient(runEvent), runEvent);

const runtimeSource = readFileSync(new URL('../src/main/runtime.js', import.meta.url), 'utf8');
assert.match(runtimeSource, /applicationIpc\.handle\('conversations:tool-call-details'/);
assert.match(runtimeSource, /message\.conversationId !== payload\.conversationId/);
assert.match(runtimeSource, /item\.type === 'tool-call' && item\.id === payload\.segmentId/);
assert.match(runtimeSource, /hydratedMessages\.map\(projectMessageForClient\)/);
assert.match(runtimeSource, /for \(const listener of remoteChatEventListeners\) listener\(clientEvent\)/);

const preloadSource = readFileSync(new URL('../src/preload/preload.cjs', import.meta.url), 'utf8');
assert.match(preloadSource, /toolCallDetails: \(payload\) => invoke\('conversations:tool-call-details', payload\)/);

const messageSource = readFileSync(new URL('../src/renderer/components/Message.jsx', import.meta.url), 'utf8');
assert.match(messageSource, /window\.chatApp\.conversations\.toolCallDetails\(/);
assert.match(messageSource, /const hasResult = segment\.hasResult \?\? Object\.hasOwn\(segment, 'resultText'\)/);
assert.match(messageSource, /className=\{!hasResult \? 'tool-line-pending-text' : undefined\}/);
assert.doesNotMatch(messageSource, /segment\.resultText === undefined \? 'tool-line-pending-text'/);
assert.match(messageSource, /Loading tool details\.\.\./);
assert.match(messageSource, /Could not load tool details:/);

console.log('Tool-call detail projection and lazy hydration tests passed.');
