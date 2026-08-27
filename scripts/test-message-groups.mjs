import assert from 'node:assert/strict';
import {
  groupAssistantTurns,
  isHumanUserMessage,
  parseStructuredUserMessage,
  startIndexForRecentHumanMessages,
} from '../src/renderer/lib/message-groups.js';
import { areComposerPropsEqual } from '../src/renderer/lib/composer-props.js';
import { areMessageRowPropsEqual } from '../src/renderer/lib/message-row-props.js';

const message = (id, role, content, createdAt = `2026-01-01T00:00:0${id}.000Z`) => ({
  id,
  role,
  content,
  createdAt,
});

const human = message('1', 'user', 'Start the task');
const assistantOne = message('2', 'assistant', 'First progress update');
const report = message(
  '3',
  'user',
  '<subagent_report thread_id="thread-1" title="Review">No findings</subagent_report>',
);
const assistantTwo = message('4', 'assistant', 'Second progress update');
const crossThread = message(
  '5',
  'user',
  '<cross-message from_thread_id="thread-2">Additional context</cross-message>',
);
const agentPrompt = {
  ...message('6', 'user', 'Additional instructions from a sub-agent'),
  fromAgent: true,
};
const finalAssistant = message('7', 'assistant', 'Final answer');
const nextHuman = message('8', 'user', 'Follow-up');

assert.equal(isHumanUserMessage(human), true);
assert.equal(isHumanUserMessage(report), false);
assert.equal(isHumanUserMessage(crossThread), false);
assert.equal(isHumanUserMessage(agentPrompt), false);
assert.equal(isHumanUserMessage(assistantOne), false);

const focusMessages = [human, assistantOne, report, agentPrompt, nextHuman, finalAssistant];
assert.equal(
  focusMessages.findLast(isHumanUserMessage)?.id,
  nextHuman.id,
  'focuses the last human message instead of the final assistant or agent-generated user rows',
);

const windowMessages = [
  message('11', 'user', 'User one'),
  message('12', 'assistant', 'Assistant one'),
  message('13', 'user', 'User two'),
  report,
  message('14', 'assistant', 'Assistant two'),
  { ...message('15', 'user', 'Agent update'), fromAgent: true },
  message('16', 'user', 'User three'),
  message('17', 'assistant', 'Assistant three'),
  message('18', 'user', 'User four'),
  message('19', 'assistant', 'Assistant four'),
  message('20', 'user', 'User five'),
  message('21', 'assistant', 'Assistant five'),
  message('22', 'user', 'User six'),
  message('23', 'assistant', 'Assistant six'),
];
assert.equal(startIndexForRecentHumanMessages(windowMessages, 4), 6);
assert.equal(startIndexForRecentHumanMessages(windowMessages, 8), 0);
assert.deepEqual(
  windowMessages.slice(startIndexForRecentHumanMessages(windowMessages, 4)),
  windowMessages.slice(6),
  'renders the fourth most recent human message and everything after it',
);

assert.deepEqual(groupAssistantTurns([
  human,
  assistantOne,
  report,
  assistantTwo,
  crossThread,
  agentPrompt,
  finalAssistant,
  nextHuman,
]), [
  { message: human, workedMessages: [] },
  {
    message: finalAssistant,
    workedMessages: [assistantOne, report, assistantTwo, crossThread, agentPrompt],
    workedStartedAt: assistantOne.createdAt,
  },
  { message: nextHuman, workedMessages: [] },
]);

const trailingReport = message(
  '10',
  'user',
  '<subagent_report thread_id="thread-3" title="Late review">Done</subagent_report>',
);
assert.deepEqual(groupAssistantTurns([human, assistantOne, trailingReport, nextHuman]), [
  { message: human, workedMessages: [] },
  {
    message: assistantOne,
    workedMessages: [trailingReport],
    workedStartedAt: assistantOne.createdAt,
  },
  { message: nextHuman, workedMessages: [] },
]);

assert.deepEqual(parseStructuredUserMessage(report), {
  id: report.id,
  type: 'subagent-report',
  threadId: 'thread-1',
  title: 'Review',
  body: 'No findings',
});
assert.deepEqual(parseStructuredUserMessage(crossThread), {
  id: crossThread.id,
  type: 'cross-thread-message',
  sourceThreadId: 'thread-2',
  body: 'Additional context',
});

const incompleteMarkup = message('8', 'user', '<subagent_report>Visible user content</subagent_report>');
assert.equal(parseStructuredUserMessage(incompleteMarkup), null);
assert.deepEqual(groupAssistantTurns([assistantOne, incompleteMarkup, finalAssistant]), [
  {
    message: assistantOne,
    workedMessages: [],
    workedStartedAt: assistantOne.createdAt,
  },
  { message: incompleteMarkup, workedMessages: [] },
  {
    message: finalAssistant,
    workedMessages: [],
    workedStartedAt: finalAssistant.createdAt,
  },
]);

const systemMessage = message('9', 'system', 'Context compressed');
assert.deepEqual(groupAssistantTurns([assistantOne, systemMessage, finalAssistant]), [
  {
    message: assistantOne,
    workedMessages: [],
    workedStartedAt: assistantOne.createdAt,
  },
  { message: systemMessage, workedMessages: [] },
  {
    message: finalAssistant,
    workedMessages: [],
    workedStartedAt: finalAssistant.createdAt,
  },
]);

const stableCallback = () => {};
const historicalRowProps = {
  message: assistantOne,
  workedMessages: [report],
  onRetry: stableCallback,
  runActive: false,
};
assert.equal(areMessageRowPropsEqual(historicalRowProps, {
  ...historicalRowProps,
  workedMessages: [report],
}), true);
assert.equal(areMessageRowPropsEqual(historicalRowProps, {
  ...historicalRowProps,
  message: { ...assistantOne, content: 'Updated response' },
}), false);
assert.equal(areMessageRowPropsEqual(historicalRowProps, {
  ...historicalRowProps,
  workedMessages: [{ ...report }],
}), false);
assert.equal(areMessageRowPropsEqual(historicalRowProps, {
  ...historicalRowProps,
  onRetry: () => {},
}), false);

const composerProps = {
  subagents: [
    { id: 'agent-1', status: 'working' },
    { id: 'agent-2', status: 'finished' },
  ],
  queuedMessages: [],
  editStats: { files: 1, additions: 2, deletions: 0 },
  onSend: stableCallback,
};
assert.equal(areComposerPropsEqual(composerProps, {
  ...composerProps,
  subagents: composerProps.subagents.map((subagent) => ({ ...subagent })),
  queuedMessages: [],
  editStats: { files: 1, additions: 2, deletions: 0 },
}), true);
assert.equal(areComposerPropsEqual(composerProps, {
  ...composerProps,
  subagents: [
    { id: 'agent-1', status: 'finished' },
    { id: 'agent-2', status: 'finished' },
  ],
}), false);
assert.equal(areComposerPropsEqual(composerProps, {
  ...composerProps,
  onSend: () => {},
}), false);

console.log('Message grouping tests passed.');
