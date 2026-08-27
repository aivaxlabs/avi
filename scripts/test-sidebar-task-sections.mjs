import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../src/renderer/components/Sidebar.jsx';

globalThis.window = {
  localStorage: {
    getItem: (key) => (key === 'aivax.sidebar.conversation-grouping' ? 'folder' : null),
  },
};

const conversation = (id, title, projectName, needsAttention = false) => ({
  id,
  title,
  projectName,
  projectPath: `C:\\Code\\${projectName}`,
  projectDisplayPath: `C:\\Code\\${projectName}`,
  needsAttention,
  createdAt: `2026-08-13T12:0${id}:00.000Z`,
  updatedAt: `2026-08-13T12:0${id}:00.000Z`,
});

const markup = renderToStaticMarkup(React.createElement(Sidebar, {
  conversations: [
    conversation('1', 'Active task', 'Alpha'),
    conversation('2', 'Needs attention', 'Beta', true),
    conversation('3', 'Completed task', 'Alpha'),
    conversation('4', 'Ordinary chat', 'Beta'),
    { ...conversation('5', 'Agent-created thread', 'Beta'), createdBy: 'agent' },
    { ...conversation('6', 'Blocked task', 'Gamma'), workStatus: 'blocked' },
  ],
  bots: [
    { id: 'working-bot', conversationId: 'bot-1', name: 'Working bot', running: true, scheduleState: 'working' },
    { id: 'active-bot', conversationId: 'bot-2', name: 'Active bot', running: false, scheduleState: 'active' },
    { id: 'sleeping-bot', conversationId: 'bot-3', name: 'Sleeping bot', running: false, scheduleState: 'sleep' },
    { id: 'notification-bot', conversationId: 'bot-4', name: 'Notification bot', running: false, scheduleState: 'active', attentionCount: 2 },
    { id: 'disabled-bot', conversationId: 'bot-5', name: 'Disabled bot', enabled: false, running: false, scheduleState: 'disabled' },
  ],
  selectedId: null,
  running: { 1: true },
  completedUnseen: { 2: true, 3: true },
  approvalPending: {},
  inputPending: {},
  onNewChat: () => {},
  onQuickChat: () => {},
  onSelect: () => {},
  onSelectBot: () => {},
  onBotSettings: () => {},
  onDeleteBot: () => {},
  onActivateBot: () => {},
  onSearch: () => {},
  onOpenOrchestration: () => {},
  onFork: () => {},
  onArchive: () => {},
  onOpenProject: () => {},
  onOpenTerminal: () => {},
  onCopyPath: () => {},
  onCopyThreadId: () => {},
  onSettings: () => {},
  collapsed: false,
  orchestrationOpen: false,
  onToggleCollapsed: () => {},
  homePath: 'C:\\Users\\test',
}));

const workingIndex = markup.indexOf('Working tasks');
const reviewIndex = markup.indexOf('Review');
const foldersIndex = markup.indexOf('Folders');
assert.ok(workingIndex >= 0, 'Working tasks should be rendered when work needs attention.');
assert.ok(reviewIndex > workingIndex, 'Review should be rendered after Working tasks.');
assert.ok(foldersIndex > reviewIndex, 'Folders should be rendered after both task sections.');

const workingMarkup = markup.slice(workingIndex, reviewIndex);
assert.match(workingMarkup, /Active task/);
assert.match(workingMarkup, /Needs attention/);
assert.match(workingMarkup, /Blocked task/);
assert.match(workingMarkup, /aria-label="Blocked"/);
assert.doesNotMatch(workingMarkup, /Completed task/);

const reviewMarkup = markup.slice(reviewIndex, foldersIndex);
assert.match(reviewMarkup, /Completed task/);
assert.doesNotMatch(reviewMarkup, /Needs attention/);

const foldersMarkup = markup.slice(foldersIndex);
for (const title of ['Active task', 'Needs attention', 'Completed task', 'Ordinary chat', 'Blocked task']) {
  assert.match(foldersMarkup, new RegExp(title));
}
assert.doesNotMatch(markup, /Agent-created thread/);

assert.match(markup, /class="lucide lucide-loader-circle run-spinner"[^>]*aria-label="Working"/);
assert.match(markup, /class="bot-status-dot active" aria-label="Active"/);
assert.match(markup, /class="lucide lucide-moon bot-status-sleep"[^>]*aria-label="Sleep"/);
assert.match(markup, /class="conversation-item bot-item disabled"/);
assert.match(markup, /class="bot-status-dot disabled" aria-label="Disabled"/);
assert.match(markup, /class="bot-item-indicator"/);

const notificationMarkup = markup.slice(
  markup.indexOf('Notification bot'),
  markup.indexOf('Disabled bot'),
);
assert.match(notificationMarkup, /class="bot-queue-badge"/);
assert.match(notificationMarkup, /title="Action required"/);
assert.match(notificationMarkup, /aria-label="2 actions required"/);
assert.match(notificationMarkup, />2<\/span>/);
assert.doesNotMatch(notificationMarkup, /bot-status|run-spinner/);

console.log('Sidebar task section, agent-created thread filter, and bot status tests passed.');
