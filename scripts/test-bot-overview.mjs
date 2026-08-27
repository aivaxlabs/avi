import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hasOpenBotUserAction } from '../src/shared/bot-work-items.js';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
const { AuxiliaryPanel } = await vite.ssrLoadModule('/src/renderer/components/AuxiliaryPanel.jsx');

const item = (id, state, overrides = {}) => ({
  id,
  title: `${id} title`,
  objective: `${id} objective`,
  state,
  summary: `${id} summary`,
  lastProgress: `${id} latest progress`,
  nextStep: '',
  attention: null,
  blocker: null,
  priority: 'normal',
  workerThreadIds: [],
  workers: [],
  evidence: [{ type: 'text', value: `${id} evidence` }],
  approval: null,
  createdAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
  completedAt: state === 'completed' ? '2026-08-24T12:00:00.000Z' : null,
  ...overrides,
});

const workItems = [
  item('active-progress', 'active', {
    lastProgress: 'Validated the active change.',
    evidence: [
      { type: 'file_reference', value: './src/main/bot-work-state.js' },
      { type: 'external_reference', value: 'https://example.com/pr/1' },
      { type: 'text', value: 'Focused tests passed.' },
    ],
  }),
  item('review-action', 'waiting', {
    attention: { type: 'review', summary: 'Review PR #1.' },
    blocker: { reason: 'Review is pending.', waitingOn: 'user' },
  }),
  item('answer-action', 'waiting', {
    attention: { type: 'answer', summary: 'Choose the release target.' },
  }),
  item('approval-action', 'waiting', {
    attention: { type: 'approval', summary: 'Approve the release.' },
    approval: { id: 'approval-1', kind: 'work', prompt: 'Approve the release?' },
  }),
  item('planned-review-action', 'planned', {
    attention: { type: 'review', summary: 'Review the plan.' },
    nextStep: 'Start the reviewed plan.',
  }),
  item('external-blocker', 'waiting', {
    blocker: { reason: 'CI is unavailable.', waitingOn: 'CI' },
  }),
  item('planned-action', 'planned', {
    priority: 'high',
    nextStep: 'Implement the planned change.',
  }),
  item('planned-no-action', 'planned'),
  item('completed', 'completed', {
    summary: 'Implemented the fix to remove duplicate reporting.',
    nextStep: 'Legacy completed next step must stay hidden.',
  }),
  item('completed-stale-attention', 'completed', {
    attention: { type: 'review', summary: 'Stale review request.' },
    summary: 'Completed despite legacy attention data.',
  }),
  item('cancelled', 'cancelled', {
    attention: { type: 'answer', summary: 'Stale answer request.' },
    nextStep: 'Cancelled next step must stay hidden.',
  }),
];

const bot = { id: 'bot-1', name: 'Test bot' };
const markup = renderToStaticMarkup(React.createElement(AuxiliaryPanel, {
  sideChats: [],
  subagents: [],
  bots: [bot],
  botWorkStateByBot: {
    [bot.id]: {
      items: workItems,
      activity: [],
      untrackedWorkers: [],
      error: null,
    },
  },
  botQueueTabOpen: true,
  selectedBotId: bot.id,
  activeTab: 'bot-queue',
  visibleMessagesByConversation: {},
  visibleRunning: {},
  models: [{ id: 'test-model', context: { input: 1000 } }],
  favorites: [],
  recentModels: [],
  recentProjects: [],
  fallbackModel: 'test-model',
  onSelectBot: () => {},
  onOpenBotQueueTab: () => {},
  onCloseBotQueueTab: () => {},
  onSelectTab: () => {},
  onClosePanel: () => {},
  onCreateSideChat: () => {},
}));

const section = (title, nextTitle) => {
  const start = markup.indexOf(`<strong>${title}</strong>`);
  const end = nextTitle ? markup.indexOf(`<strong>${nextTitle}</strong>`, start) : markup.length;
  assert.ok(start >= 0, `${title} section must exist.`);
  assert.ok(end > start, `${title} section must end after it starts.`);
  return markup.slice(start, end);
};

const current = section('Current work', 'Needs your attention');
assert.match(current, /active-progress title/);
assert.match(current, /Validated the active change\./);
for (const detail of ['active-progress objective', 'active-progress summary', 'active-progress evidence', 'Evidence']) {
  assert.doesNotMatch(current, new RegExp(detail));
}
assert.match(current, /class="bot-work-card bot-work-preview state-active summary"/);

const attention = section('Needs your attention', 'Recently completed');
assert.match(attention, /review-action title/);
assert.match(attention, /You need to review this\./);
assert.match(attention, /approval-action title/);
assert.match(attention, /You need to approve this\./);
assert.match(attention, /answer-action title/);
assert.match(attention, /You need to answer this\./);
assert.match(attention, /planned-review-action title/);
for (const hidden of [
  'Review PR #1',
  'Approve the release',
  'Choose the release target',
  'external-blocker title',
  'completed-stale-attention title',
  'cancelled title',
  'Objective',
  'Evidence',
]) {
  assert.doesNotMatch(attention, new RegExp(hidden));
}

const completed = section('Recently completed', 'Up next');
assert.match(completed, /completed title/);
assert.match(completed, /Implemented the fix to remove duplicate reporting/);
assert.match(completed, /completed-stale-attention title/);
assert.match(completed, /Completed despite legacy attention data/);
for (const hidden of ['completed objective', 'completed latest progress', 'completed evidence', 'Legacy completed next step']) {
  assert.doesNotMatch(completed, new RegExp(hidden));
}
assert.doesNotMatch(completed, /Objective|Latest progress|Next step|Evidence/);

const upNext = section('Up next', 'Recent activity');
assert.match(upNext, /planned-action title/);
assert.match(upNext, /Implement the planned change\./);
for (const hidden of ['planned-no-action title', 'planned-review-action title', 'active-progress title', 'completed title', 'cancelled title']) {
  assert.doesNotMatch(upNext, new RegExp(hidden));
}

assert.deepEqual(
  workItems.filter(hasOpenBotUserAction).map((entry) => entry.id),
  ['review-action', 'answer-action', 'approval-action', 'planned-review-action'],
  'Only open review, answer, and approval items count as user actions.',
);

const runtimeSource = readFileSync(new URL('../src/main/runtime.js', import.meta.url), 'utf8');
const orchestrationSource = readFileSync(
  new URL('../src/renderer/components/OrchestrationPage.jsx', import.meta.url),
  'utf8',
);
assert.match(runtimeSource, /filter\(hasOpenBotUserAction\)\.length/);
assert.match(
  runtimeSource,
  /conversation\.isSubagent\s*\? 'subagent'\s*:\s*conversation\.isBot\s*\? 'bot'\s*:\s*'inference'/,
);
assert.match(runtimeSource, /\['bot', \{ id: 'bot', responses: 0, tokens: 0 \}\]/);
assert.match(orchestrationSource, /bot: 'Bot'/);

await vite.close();
console.log('Bot Overview tests passed.');
