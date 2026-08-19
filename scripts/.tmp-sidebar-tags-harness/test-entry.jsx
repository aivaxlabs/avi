import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from '../../src/renderer/components/Sidebar.jsx';

const initialTags = [
  { id: 'review', name: 'Review', color: '#e3b341' },
  { id: 'important', name: 'Important', color: '#e5484d' },
  { id: 'blocked', name: 'Blocked', color: '#8b8d98' },
];

const initialConversations = [
  {
    id: 'conv-1',
    title: 'Correção do bug',
    firstPrompt: 'Correção do bug',
    model: 'test-model',
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    contextTokens: 39500,
    tags: [],
    projectPath: null,
    projectName: null,
    projectDisplayPath: null,
  },
  {
    id: 'conv-2',
    title: 'Outro chat',
    firstPrompt: 'Outro chat',
    model: 'test-model',
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    contextTokens: 1000,
    tags: ['important'],
    projectPath: null,
    projectName: null,
    projectDisplayPath: null,
  },
];

function TestApp() {
  const [conversations, setConversations] = useState(initialConversations);
  const [savedTags, setSavedTags] = useState(initialTags);
  const calls = useRef([]);
  const saveCalls = useRef([]);

  async function setConversationTags(conversationId, tags) {
    calls.current.push({ conversationId, tags: [...tags] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    setConversations((state) => state.map((item) => (
      item.id === conversationId ? { ...item, tags: [...tags] } : item
    )));
  }

  async function onSaveChatTags(tags) {
    saveCalls.current.push(tags);
    await new Promise((resolve) => setTimeout(resolve, 30));
    setSavedTags(tags);
    setConversations((state) => state.map((item) => ({ ...item, tags: [] })));
  }

  window.__harness = { calls: calls.current, saveCalls: saveCalls.current };

  return (
    <Sidebar
      conversations={conversations}
      models={[]}
      selectedId="conv-1"
      running={{}}
      runStartedAt={{}}
      completedUnseen={{}}
      approvalPending={{}}
      inputPending={{}}
      semaphoreWaiting={{}}
      collapsed={false}
      orchestrationOpen={false}
      homePath="/home/test"
      chatTags={savedTags}
      folderColors={{}}
      onNewChat={() => {}}
      onQuickChat={() => {}}
      onSelect={() => {}}
      onSearch={() => {}}
      onOpenOrchestration={() => {}}
      onFork={() => {}}
      onArchive={() => {}}
      onOpenProject={() => {}}
      onOpenTerminal={() => {}}
      onCopyPath={() => {}}
      onCopyThreadId={() => {}}
      onSettings={() => {}}
      onSetConversationTags={setConversationTags}
      onSetFolderColor={() => {}}
      onSaveChatTags={onSaveChatTags}
      onToggleCollapsed={() => {}}
    />
  );
}

createRoot(document.getElementById('root')).render(<TestApp />);
