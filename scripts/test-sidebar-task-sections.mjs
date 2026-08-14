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
  ],
  selectedId: null,
  running: { 1: true },
  completedUnseen: { 2: true, 3: true },
  approvalPending: {},
  inputPending: {},
  onNewChat: () => {},
  onQuickChat: () => {},
  onSelect: () => {},
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
assert.doesNotMatch(workingMarkup, /Completed task/);

const reviewMarkup = markup.slice(reviewIndex, foldersIndex);
assert.match(reviewMarkup, /Completed task/);
assert.doesNotMatch(reviewMarkup, /Needs attention/);

const foldersMarkup = markup.slice(foldersIndex);
for (const title of ['Active task', 'Needs attention', 'Completed task', 'Ordinary chat']) {
  assert.match(foldersMarkup, new RegExp(title));
}

console.log('Sidebar task section tests passed.');
