import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hasOpenBotUserAction } from '../src/shared/bot-work-items.js';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
try {
  const { AuxiliaryPanel } = await vite.ssrLoadModule('/src/renderer/components/AuxiliaryPanel.jsx');
  const inbox = [
    { id: 'new', title: 'Choose Acme export format', status: 'open', messages: [{ id: 'new-1', role: 'bot', content: 'Should I use CSV or JSON?', attachments: [], createdAt: '2026-09-04T14:00:00Z' }], updatedAt: '2026-09-04T14:00:00Z', approval: null },
    { id: 'replied', title: 'Review Acme invoice', status: 'open', messages: [{ id: 'reply-1', role: 'user', content: 'The totals are correct.', attachments: [], createdAt: '2026-09-04T15:00:00Z' }], updatedAt: '2026-09-04T15:00:00Z', approval: null },
    { id: 'completed', title: 'Acme export received', status: 'completed', messages: [{ id: 'complete-1', role: 'bot', content: 'I verified the delivered export.', attachments: [], createdAt: '2026-09-04T16:00:00Z' }], updatedAt: '2026-09-04T16:00:00Z', approval: null },
    { id: 'approval', title: 'Publish Acme report', status: 'open', messages: [{ id: 'approval-1', role: 'user', content: 'Where will you publish it?', attachments: [], createdAt: '2026-09-04T13:00:00Z' }], updatedAt: '2026-09-04T13:00:00Z', approval: { id: 'approval-id', status: 'pending' } },
  ];
  const props = {
    sideChats: [], subagents: [], bots: [{ id: 'bot-1', name: 'Acme bot' }],
    botDataByBot: { 'bot-1': { inbox, activity: [], error: null } },
    botQueueTabOpen: true, selectedBotId: 'bot-1', activeTab: 'bot-queue',
    visibleMessagesByConversation: {}, visibleRunning: {}, models: [], favorites: [], recentModels: [], recentProjects: [],
  };
  const render = (overrides = {}) => renderToStaticMarkup(React.createElement(AuxiliaryPanel, { ...props, ...overrides }));
  const { OrchestrationPage } = await vite.ssrLoadModule('/src/renderer/components/OrchestrationPage.jsx');
  const dashboard = renderToStaticMarkup(React.createElement(OrchestrationPage, { models: [], bots: props.bots, botDataByBot: props.botDataByBot }));
  assert.match(dashboard, /<h1>Overview<\/h1>/);
  assert.match(dashboard, /role="tab"[^>]*aria-selected="true"[^>]*>Inbox · 2/);
  assert.match(dashboard, /All bots Inbox/);
  assert.match(dashboard, /<img src="https:\/\/orb\.aivax\.net\/bot-1" width="30" height="30" alt=""\/>/);
  assert.match(dashboard, /Choose Acme export format/);
  const navigated = render({ inboxNavigation: { botId: 'bot-1', pendencyId: 'new' } });
  assert.match(navigated, /id="bot-pendency-title"[^>]*>Choose Acme export format/);
  assert.doesNotMatch(navigated, /Review Acme invoice/);
  assert.match(navigated, /<img src="https:\/\/orb\.aivax\.net\/bot-1" width="22" height="22" alt=""\/>/);
  assert.doesNotMatch(render({ inboxNavigation: { botId: 'bot-1', pendencyId: 'replied' } }), /https:\/\/orb\.aivax\.net\//);
  assert.match(render({ inboxNavigation: { botId: 'another-bot', pendencyId: 'new' } }), /Review Acme invoice/);
  const overviewProps = { inboxOnly: true, inboxNavigation: { botId: 'bot-1', pendencyId: 'new' } };
  const overviewPanel = render(overviewProps);
  assert.match(overviewPanel, /aria-label="Inbox conversation"/);
  assert.match(overviewPanel, /aria-label="Close Inbox panel"/);
  assert.match(overviewPanel, /id="bot-pendency-title"[^>]*>Choose Acme export format/);
  assert.match(overviewPanel, /Send reply/);
  assert.match(overviewPanel, /Requires your response/);
  const info = { ...inbox[0], messages: [{ ...inbox[0].messages[0], requiresUserResponse: false }] };
  const infoState = { 'bot-1': { inbox: [info], activity: [], error: null } };
  const infoPanel = render({ ...overviewProps, botDataByBot: infoState });
  assert.match(infoPanel, /No response required/);
  assert.match(infoPanel, />Unread<\/span>/);
  info.messages[0].readAt = '2026-09-04T17:00:00Z';
  assert.match(render({ ...overviewProps, botDataByBot: infoState }), />Read<\/span>/);
  const readDashboard = renderToStaticMarkup(React.createElement(OrchestrationPage, { models: [], bots: props.bots, botDataByBot: infoState }));
  assert.doesNotMatch(readDashboard, /orchestration-inbox-row needs-user/);
  assert.match(readDashboard, /aria-label="Read"/);
  assert.doesNotMatch(overviewPanel, /role="tablist"|role="tab"|role="tabpanel"|bot-work-selector|bot-inbox-filters|Review Acme invoice/);
  const richContent = [
    '::finding[Payment status]{level="P1"}',
    '',
    '::callout[Review required]{kind="warning"}',
    '',
    '::avi-chart{type="bar" title="Requests" data=\'[{"label":"GET","value":12}]\'}',
    '',
    '::finding[Unsupported]{level="P9"}',
    '',
    '<script>alert(1)</script>',
    '',
    '[Documentation](https://example.com)',
  ].join('\n');
  const richPanel = render({
    ...overviewProps,
    botDataByBot: { 'bot-1': { inbox: [{ ...inbox[0], messages: [{ ...inbox[0].messages[0], content: richContent }] }], activity: [], error: null } },
  });
  assert.match(richPanel, /finding-heading finding-p1/);
  assert.match(richPanel, /callout-heading callout-warning/);
  assert.match(richPanel, /rich-chart-bar/);
  assert.match(richPanel, /::finding\[Unsupported\]/);
  assert.doesNotMatch(richPanel, /<script>/);
  assert.match(richPanel, /href="https:\/\/example.com"/);
  const { MarkdownSegment } = await vite.ssrLoadModule('/src/renderer/components/Message.jsx');
  const activityContent = renderToStaticMarkup(React.createElement(MarkdownSegment, { text: richContent, finalized: true }));
  assert.match(activityContent, /finding-heading finding-p1/);
  assert.match(activityContent, /rich-chart-bar/);
  const panelSource = readFileSync(new URL('../src/renderer/components/AuxiliaryPanel.jsx', import.meta.url), 'utf8');
  assert.match(panelSource, /<MarkdownSegment text=\{entry\.description\} finalized \/>/);
  assert.doesNotMatch(panelSource, /ReactMarkdown|botWorkMarkdownComponents/);
  const completedPanel = render({ ...overviewProps, inboxNavigation: { botId: 'bot-1', pendencyId: 'completed' } });
  assert.match(completedPanel, /Acme export received/);
  assert.doesNotMatch(completedPanel, /Send reply/);
  assert.match(render({ ...overviewProps, inboxNavigation: { botId: 'bot-1', pendencyId: 'missing' } }), /no longer available/);
  assert.match(render({ ...overviewProps, botsLoading: true }), /Loading bots/);
  assert.match(render({ ...overviewProps, inboxNavigation: { botId: 'bot-1', pendencyId: 'approval' } }), /Approval required/);
  const markup = render();
  assert.match(markup, /role="tab"[^>]*aria-selected="true"[^>]*>[\s\S]*?Inbox[\s\S]*?<\/button>/);
  assert.match(markup, /id="bot-work-tab-activity"[\s\S]*?Activity[\s\S]*?<\/button>/);
  assert.doesNotMatch(markup, /Overview|All work|Current work|Up next|bot-work-dialog|Untracked workers/);
  assert.match(markup, /Choose Acme export format/);
  assert.match(markup, /Should I use CSV or JSON/);
  assert.match(markup, /Waiting for bot/);
  assert.match(markup, /Needs you/);
  assert.match(markup, /Completed/);
  assert.ok(markup.indexOf('Acme export received') < markup.indexOf('Choose Acme export format'));
  assert.ok(markup.indexOf('Review Acme invoice') < markup.indexOf('Choose Acme export format'));
  assert.deepEqual(inbox.filter(hasOpenBotUserAction).map((item) => item.id), ['new', 'approval']);
  assert.equal(hasOpenBotUserAction({ ...inbox[3], status: 'completed' }), false);
  assert.equal(hasOpenBotUserAction({ status: 'open', messages: [] }), false);
  assert.match(render({ botsLoading: true }), /Loading bots/);
  assert.doesNotMatch(render({ botsLoading: true, bots: [] }), /No bots/);
  assert.match(render({ bots: [] }), /No bots/);
  assert.match(render({ botDataByBot: { 'bot-1': { inbox: [], activity: [], error: null } } }), /Your Inbox is empty/);
  assert.match(render({ botDataByBot: { 'bot-1': { inbox: [], activity: [], error: 'Invalid inbox.json' } } }), /role="alert"[\s\S]*Invalid inbox\.json/);
  const isolated = render({ botDataByBot: { 'bot-1': { inbox, activity: [], error: 'Invalid activity.title', errors: { inbox: null, activity: 'Invalid activity.title' } } } });
  assert.match(isolated, /Choose Acme export format/);
  assert.doesNotMatch(isolated, /Invalid activity.title/);
  const failed = render({ botDataByBot: { 'bot-1': { inbox: [], activity: [], error: 'Invalid inbox.json', errors: { inbox: 'Invalid inbox.json', activity: null } } } });
  assert.doesNotMatch(failed, /Your Inbox is empty/);
  assert.match(failed, /<details[\s\S]*Invalid inbox.json/);
  const runtime = readFileSync(new URL('../src/main/runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /botDataByBot\[bot\.id\]\?\.inbox[\s\S]*?filter\(hasOpenBotUserAction\)\.length/);
  const taskFilter = runtime.match(/const conversations = allConversations\s*\.filter\((\(conversation\) => [^;]+)\);/);
  assert.ok(taskFilter, 'Overview filters task histories before classification');
  const includeTask = new Function(`return ${taskFilter[1]}`)();
  assert.deepEqual([
    { id: 'user', conversationType: 'thread', createdBy: 'user' },
    { id: 'agent', conversationType: 'thread', createdBy: 'agent' },
    { id: 'bot', conversationType: 'bot', createdBy: 'user' },
    { id: 'subagent', conversationType: 'subagent', createdBy: 'agent' },
    { id: 'side', conversationType: 'side', createdBy: 'user' },
  ].filter(includeTask).map((conversation) => conversation.id), ['user']);
  console.log('Bot Inbox rendering and notification tests passed.');
} finally {
  await vite.close();
}
