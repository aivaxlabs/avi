import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

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

const bot = { id: 'bot-1', name: 'Test bot' };
const markup = renderToStaticMarkup(React.createElement(AuxiliaryPanel, {
  sideChats: [],
  subagents: [],
  bots: [bot],
  botWorkStateByBot: {
    [bot.id]: {
      items: [
        item('active-action', 'active', {
          nextStep: 'Validate the active change.',
          evidence: [
            { type: 'file_reference', value: './src/main/bot-work-state.js' },
            { type: 'external_reference', value: 'https://example.com/pr/1' },
            { type: 'text', value: 'Focused tests passed.' },
          ],
        }),
        item('active-no-action', 'active'),
        item('planned-action', 'planned', { priority: 'high', nextStep: 'Implement the planned change.' }),
        item('planned-no-action', 'planned'),
        item('completed', 'completed', {
          summary: 'Implemented the fix to remove duplicate reporting, by reusing the existing summary field.',
          nextStep: 'Legacy completed next step must stay hidden.',
        }),
        item('cancelled', 'cancelled', { nextStep: 'Cancelled next step must stay hidden.' }),
      ],
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
assert.match(current, /active-action title/);
assert.match(current, /active-no-action title/);
assert.doesNotMatch(current, /Validate the active change\./);
assert.doesNotMatch(current, /Next step/);
assert.match(current, /<dt>Evidence<\/dt>/);
assert.match(current, /<ul class="bot-evidence-list">/);
assert.match(current, /<button type="button">\.\/src\/main\/bot-work-state\.js<\/button>/);
assert.match(current, /<a href="https:\/\/example\.com\/pr\/1" target="_blank" rel="noreferrer">https:\/\/example\.com\/pr\/1<\/a>/);
assert.match(current, /Focused tests passed\./);

const completed = section('Recently completed', 'Up next');
assert.match(completed, /completed title/);
assert.match(completed, /Implemented the fix to remove duplicate reporting/);
for (const hidden of ['completed objective', 'completed latest progress', 'completed evidence', 'Legacy completed next step']) {
  assert.doesNotMatch(completed, new RegExp(hidden));
}
assert.doesNotMatch(completed, /Objective|Latest progress|Next step|Completed/);

const upNext = section('Up next', 'Recent activity');
assert.match(upNext, /planned-action title/);
assert.match(upNext, /Implement the planned change\./);
assert.match(upNext, /active-action title/);
assert.match(upNext, /Validate the active change\./);
for (const hidden of ['planned-no-action title', 'active-no-action title', 'completed title', 'cancelled title']) {
  assert.doesNotMatch(upNext, new RegExp(hidden));
}
assert.ok(
  upNext.indexOf('planned-action title') < upNext.indexOf('active-action title'),
  'Up next must keep priority ordering.',
);

const runtimeSource = readFileSync(new URL('../src/main/runtime.js', import.meta.url), 'utf8');
const orchestrationSource = readFileSync(
  new URL('../src/renderer/components/OrchestrationPage.jsx', import.meta.url),
  'utf8',
);
assert.match(
  runtimeSource,
  /conversation\.isSubagent\s*\? 'subagent'\s*:\s*conversation\.isBot\s*\? 'bot'\s*:\s*'inference'/,
);
assert.match(runtimeSource, /\['bot', \{ id: 'bot', responses: 0, tokens: 0 \}\]/);
assert.match(orchestrationSource, /bot: 'Bot'/);

await vite.close();
console.log('Bot Overview tests passed.');
