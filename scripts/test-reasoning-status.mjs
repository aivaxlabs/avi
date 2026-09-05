import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message } from '../src/renderer/components/Message.jsx';
import { answerTextFromTextualBlocks } from '../src/shared/textual-blocks.js';

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
      content: segments.length > 0
        ? `<think>${segments.map((segment) => segment.text).join('\n')}</think>`
        : '',
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

const renderContent = (content, segments = []) => renderToStaticMarkup(createElement(Message, {
  message: {
    id: 'assistant-message',
    role: 'assistant',
    status: 'completed',
    content,
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
  runActive: false,
  questionPending: false,
  showContinuations: false,
  canRetry: false,
  canResume: false,
}));

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

const batchedStatuses = renderMessage([
  '**Defining constructor logic****Refining option count rounding****Confirming implementation approach**',
]);
assert.match(batchedStatuses, /Confirming implementation approach/);
assert.doesNotMatch(batchedStatuses, /Defining constructor logic/);
assert.doesNotMatch(batchedStatuses, /Refining option count rounding/);
assert.doesNotMatch(batchedStatuses, /class="reasoning-text"/);

const statusSequenceWithReasoning = renderMessage([
  '**Defining constructor logic****Refining option count rounding**\nKeep this reasoning visible.',
]);
assert.match(statusSequenceWithReasoning, /Defining constructor logic/);
assert.match(statusSequenceWithReasoning, /Keep this reasoning visible\./);
assert.match(statusSequenceWithReasoning, /class="reasoning-text"/);

const leadingWhitespace = renderContent(' \n\t<think>Private reasoning</think>Final answer');
assert.match(leadingWhitespace, /class="worked-block"/);
assert.match(leadingWhitespace, /Final answer/);
assert.equal(answerTextFromTextualBlocks(' \n\t<think>Private reasoning</think>Final answer'), 'Final answer');

const inlineThink = renderContent('Initial answer <think>Private reasoning</think>Final answer');
assert.match(inlineThink, /class="worked-block"/);
assert.doesNotMatch(inlineThink, /Private reasoning/);
assert.match(inlineThink, /Final answer/);
assert.equal(
  answerTextFromTextualBlocks('Initial answer <think>Private reasoning</think>Final answer'),
  'Final answer',
);

const adjacentThink = renderContent('<think>First reasoning</think><think>Second reasoning</think>Final answer');
assert.equal((adjacentThink.match(/class="worked-block"/g) ?? []).length, 1);
assert.match(adjacentThink, /Final answer/);
assert.equal(
  answerTextFromTextualBlocks('<think>First reasoning</think><think>Second reasoning</think>Final answer'),
  'Final answer',
);

const afterCompression = renderContent('Answer<think>Private reasoning</think>Final answer', [{
  id: 'compression',
  type: 'context-compression',
  contentOffset: 6,
  status: 'completed',
  inputTokens: 100,
  outputTokens: 50,
}]);
assert.match(afterCompression, /class="worked-block"/);
assert.match(afterCompression, /Final answer/);

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
