import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message } from '../src/renderer/components/Message.jsx';

const renderMessage = (
  reasoning = [],
  {
    status = 'streaming',
    runActive = true,
    canRetry = false,
    canResume = false,
    showContinuations = false,
  } = {},
) => {
  const segments = reasoning.map((text, index) => ({
    id: `reasoning-${index}`,
    sequence: index + 1,
    type: 'reasoning',
    text,
    status: 'streaming',
  }));
  return renderToStaticMarkup(createElement(Message, {
    message: {
      id: 'assistant-message',
      role: 'assistant',
      status,
      content: segments.map((segment) => `<think>${segment.text}</think>`).join(''),
      segments,
      attachments: [],
      edits: [],
      continuations: [],
      usage: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
    modelName: 'Test model',
    workedMessages: [],
    runActive,
    questionPending: false,
    showContinuations,
    canRetry,
    canResume,
  }));
};

const statusOnly = renderMessage(['**Inspecting the renderer flow**']);
assert.match(statusOnly, /Inspecting the renderer flow/);
assert.doesNotMatch(statusOnly, /class="reasoning-text"/);
assert.doesNotMatch(statusOnly, />Thinking</);

const multiline = renderMessage(['**Inspecting the renderer flow**\nNext step']);
assert.match(multiline, /class="reasoning-text"/);
assert.match(multiline, /Next step/);
assert.match(multiline, />Thinking</);

const surroundingWhitespace = renderMessage([' **Inspecting the renderer flow** ']);
assert.match(surroundingWhitespace, /class="reasoning-text"/);
assert.match(surroundingWhitespace, />Thinking</);

const partiallyBold = renderMessage(['**First status** plain text **Second status**']);
assert.match(partiallyBold, /class="reasoning-text"/);
assert.match(partiallyBold, /plain text/);
assert.match(partiallyBold, />Thinking</);

const mixedReasoning = renderMessage([
  '**Inspecting the renderer flow**',
  'The regular reasoning remains visible.',
]);
assert.match(mixedReasoning, /Inspecting the renderer flow/);
assert.match(mixedReasoning, /The regular reasoning remains visible\./);
assert.equal((mixedReasoning.match(/class="reasoning-text"/g) ?? []).length, 1);

const nextResponse = renderMessage();
assert.match(nextResponse, />Thinking</);
assert.doesNotMatch(nextResponse, /Inspecting the renderer flow/);

const retryableResponse = renderMessage([], {
  status: 'completed',
  runActive: false,
  canRetry: true,
});
assert.match(retryableResponse, /aria-label="Retry response"/);

const responseWithoutRetry = renderMessage([], {
  status: 'completed',
  runActive: false,
  showContinuations: true,
});
assert.doesNotMatch(responseWithoutRetry, /aria-label="Retry response"/);

const retryableFailure = renderMessage([], {
  status: 'error',
  runActive: false,
  canResume: true,
});
assert.match(retryableFailure, />Try again</);

const historicalFailure = renderMessage([], {
  status: 'error',
  runActive: false,
});
assert.doesNotMatch(historicalFailure, />Try again</);

console.log('Reasoning status tests passed.');
