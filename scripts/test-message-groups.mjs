import assert from 'node:assert/strict';
import {
  groupAssistantTurns,
  parseStructuredUserMessage,
} from '../src/renderer/lib/message-groups.js';

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

console.log('Message grouping tests passed.');
