import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityBar } from '../src/renderer/components/ActivityBar.jsx';

const render = (props) => renderToStaticMarkup(React.createElement(ActivityBar, {
  active: 'home',
  onSelect: () => {},
  updateAvailable: false,
  ...props,
}));

const defaultMarkup = render();
assert.doesNotMatch(defaultMarkup, /activity-count-badge/);

const zeroMarkup = render({ counts: { home: 0, inbox: 0 } });
assert.doesNotMatch(zeroMarkup, /activity-count-badge/);

const positiveMarkup = render({ counts: { home: 4, inbox: 7 } });
assert.match(positiveMarkup, /aria-label="Home, 4 chats need attention or review"/);
assert.match(positiveMarkup, /title="Home, 4 chats need attention or review"/);
assert.match(positiveMarkup, /aria-label="Inbox, 7 unread messages"/);
assert.match(positiveMarkup, /title="Inbox, 7 unread messages"/);
assert.match(positiveMarkup, /class="activity-count-badge"[^>]*>4<\/span>/);
assert.match(positiveMarkup, /class="activity-count-badge"[^>]*>7<\/span>/);

const cappedMarkup = render({ counts: { home: 120, inbox: 104 } });
assert.match(cappedMarkup, /aria-label="Home, 120 chats need attention or review"/);
assert.match(cappedMarkup, /title="Home, 120 chats need attention or review"/);
assert.match(cappedMarkup, /aria-label="Inbox, 104 unread messages"/);
assert.match(cappedMarkup, /title="Inbox, 104 unread messages"/);
assert.match(cappedMarkup, /class="activity-count-badge"[^>]*>99\+<\/span>/);
assert.equal((cappedMarkup.match(/>99\+<\/span>/g) ?? []).length, 2);

const inboxMarkup = render({ active: 'inbox', counts: { home: 2, inbox: 1 } });
assert.match(inboxMarkup, /aria-label="Inbox, 1 unread messages" aria-current="page"/);
assert.match(inboxMarkup, /aria-label="Home, 2 chats need attention or review"/);

const updatedSettingsMarkup = render({ updateAvailable: true });
assert.match(updatedSettingsMarkup, /class="activity-settings"[^>]*aria-label="Settings, update available"/);
assert.match(updatedSettingsMarkup, /class="activity-update-badge"/);

const selectedMarkup = render({ active: 'settings' });
assert.match(selectedMarkup, /aria-label="Settings" aria-current="page"/);

const appSource = readFileSync(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
const countsStart = appSource.indexOf('  const activityCounts = useMemo(() => ({');
const countsEnd = appSource.indexOf('  }), [conversations, approvalPending, inputPending, completedUnseen, botDataByBot]);', countsStart);
assert.ok(countsStart >= 0 && countsEnd > countsStart, 'App should derive ActivityBar counts in a memo.');
const deriveCounts = new Function(
  'conversations', 'approvalPending', 'inputPending', 'completedUnseen', 'botDataByBot',
  `return ${appSource.slice(countsStart).slice(0, countsEnd - countsStart).replace('  const activityCounts = useMemo(() => ', '')}});`,
);
const conversations = [
  { id: 'approval' },
  { id: 'input' },
  { id: 'blocked', workStatus: 'blocked' },
  { id: 'attention', needsAttention: true },
  { id: 'completed' },
  { id: 'running-only', running: true },
  { id: 'semaphore-only', semaphoreWaiting: true },
  { id: 'ordinary' },
];
const derived = deriveCounts(
  conversations,
  { approval: true },
  { input: true },
  { completed: true, approval: true, blocked: true },
  {
    botA: { inbox: [
      { status: 'resolved', messages: [
        { role: 'bot', status: 'informational' },
        { role: 'bot', status: 'awaiting-response', requiresUserResponse: false },
        { role: 'user' },
        { role: 'bot', readAt: '2025-01-01T00:00:00Z' },
      ] },
      { messages: [{ role: 'user' }] },
    ] },
    botB: { inbox: [
      { status: 'completed', messages: [{ role: 'bot' }] },
      { status: 'open', messages: [{ role: 'bot' }, { role: 'bot', readAt: '2026-09-26', requiresUserResponse: true }] },
      { status: 'open', messages: [{ role: 'bot' }, { role: 'user' }] },
      { status: 'open', messages: [{ role: 'bot' }, { role: 'bot', requiresUserResponse: false }] },
      { status: 'open', approval: {}, messages: [{ role: 'bot', readAt: '2026-09-26' }] },
    ] },
  },
);
assert.deepEqual(derived, { home: 5, inbox: 1 });

console.log('ActivityBar count rendering, derived counts, and navigation accessibility tests passed.');
